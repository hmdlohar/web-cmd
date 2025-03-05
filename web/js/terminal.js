$(document).ready(function() {
    // Command history array
    let commandHistory = [];
    
    // Client ID for SSE connection
    const clientId = Date.now().toString();
    
    // Single SSE connection for all commands
    let sseConnection = null;
    
    // Flag to track if SSE connection is ready
    let sseReady = false;
    
    // Queue of commands waiting for SSE connection
    const commandQueue = [];
    
    // Map to store command output handlers
    const commandHandlers = new Map();
    
    // Map to track command completion status
    const commandStatus = new Map();
    
    // Global working directory
    let globalWorkingDir = '';
    
    // Current block ID for PWD modal
    let currentPwdBlockId = null;
    
    // Debug flag
    const DEBUG = true;
    
    function log(...args) {
        if (DEBUG) {
            console.log(`[CLIENT ${new Date().toISOString()}]`, ...args);
        }
    }
    
    /**
     * Load command history from localStorage
     */
    async function loadCommandHistory() {
        try {
            if (localStorage.getItem('commandHistory')) {
                commandHistory = JSON.parse(localStorage.getItem('commandHistory'));
            }
        } catch (e) {
            console.error('Error loading command history:', e);
            commandHistory = [];
        }
    }
    
    /**
     * Save command to history
     */
    function saveCommandToHistory(command) {
        // Don't add duplicates or empty commands
        if (command.trim() === '' || (commandHistory.length > 0 && commandHistory[0] === command)) {
            return;
        }
        
        // Add to beginning of array
        commandHistory.unshift(command);
        
        // Limit history size
        if (commandHistory.length > 100) {
            commandHistory.pop();
        }
        
        // Save to localStorage
        try {
            localStorage.setItem('commandHistory', JSON.stringify(commandHistory));
        } catch (e) {
            console.error('Error saving command history:', e);
        }
    }
    
    /**
     * Load global working directory from localStorage or server
     */
    async function loadWorkingDirectory() {
        try {
            if (localStorage.getItem('globalWorkingDir')) {
                globalWorkingDir = localStorage.getItem('globalWorkingDir');
                $('#global-pwd-text').text(`Working Directory: ${globalWorkingDir}`);
            } else {
                const response = await $.get('/default-working-dir');
                globalWorkingDir = response.workingDir;
                localStorage.setItem('globalWorkingDir', globalWorkingDir);
                $('#global-pwd-text').text(`Working Directory: ${globalWorkingDir}`);
            }
        } catch (error) {
            console.error('Error loading working directory:', error);
            // Set a fallback directory
            globalWorkingDir = '/';
            $('#global-pwd-text').text(`Working Directory: ${globalWorkingDir}`);
        }
    }
    
    /**
     * Process queued commands
     */
    function processCommandQueue() {
        log(`Processing command queue (${commandQueue.length} items)`);
        
        while (commandQueue.length > 0) {
            const queuedCommand = commandQueue.shift();
            executeCommand(
                queuedCommand.command, 
                queuedCommand.workingDir, 
                queuedCommand.blockId
            );
        }
    }
    
    /**
     * Initialize SSE connection
     */
    function initSSE() {
        log("Initializing SSE connection...");
        
        if (sseConnection) {
            // Close existing connection
            sseConnection.close();
        }
        
        sseConnection = new EventSource(`/sse?clientId=${clientId}`);
        
        sseConnection.onopen = function() {
            log("SSE connection opened");
            sseReady = true;
            processCommandQueue();
        };
        
        sseConnection.onmessage = function(event) {
            try {
                const eventData = JSON.parse(event.data);
                
                if (eventData.type === 'connected') {
                    log("SSE connection confirmed");
                    sseReady = true;
                    processCommandQueue();
                    return;
                } else if (eventData.type === 'ping') {
                    // Just a keepalive, ignore
                    return;
                }
                
                // If this is a command message
                if (eventData.topic && eventData.topic.startsWith('command-')) {
                    const commandId = eventData.topic.replace('command-', '');
                    log(`Received message for command ${commandId}: ${eventData.data.type}`);
                    
                    const handler = commandHandlers.get(commandId);
                    
                    if (handler) {
                        handler(eventData.data);
                    } else {
                        log(`No handler found for command ${commandId}`);
                    }
                }
            } catch (error) {
                console.error('Error processing SSE message:', error);
            }
        };
        
        sseConnection.onerror = function(error) {
            console.error('SSE Error:', error);
            sseReady = false;
            
            // Try to reconnect after a delay
            setTimeout(() => {
                initSSE();
            }, 3000);
        };
    }
    
    /**
     * Execute a command
     * @param {string} command - The command to execute
     * @param {string} workingDir - The working directory
     * @param {string} blockId - The block ID
     */
    async function executeCommand(command, workingDir, blockId) {
        try {
            // If SSE is not ready, queue the command
            if (!sseReady) {
                log("SSE not ready, queueing command:", command);
                commandQueue.push({ command, workingDir, blockId });
                return;
            }
            
            log("Executing command:", command);
            
            const outputArea = $(`#block-${blockId} .command-output`);
            const inputElement = $(`#block-${blockId} .command-input`);
            
            // Generate a command ID client-side
            const commandId = Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9);
            
            // Mark command as not completed
            commandStatus.set(commandId, false);
            
            // Register handler BEFORE sending the command
            registerCommandHandler(commandId, blockId);
            
            // Store command ID for interrupt functionality
            $(`#block-${blockId} .interrupt-btn`).data('command-id', commandId);
            
            // Send command to server
            try {
                const response = await $.ajax({
                    url: '/execute',
                    method: 'POST',
                    contentType: 'application/json',
                    data: JSON.stringify({ 
                        command, 
                        workingDir, 
                        clientId,
                        commandId // Send our generated commandId to the server
                    })
                });
                
                // If server returns a different commandId, update our references
                if (response.commandId && response.commandId !== commandId) {
                    log(`Server assigned different commandId: ${response.commandId} (was: ${commandId})`);
                    
                    // Copy the handler to the new ID
                    const handler = commandHandlers.get(commandId);
                    if (handler) {
                        commandHandlers.set(response.commandId, handler);
                        commandHandlers.delete(commandId);
                    }
                    
                    // Update command status
                    commandStatus.set(response.commandId, commandStatus.get(commandId));
                    commandStatus.delete(commandId);
                    
                    // Update the interrupt button
                    $(`#block-${blockId} .interrupt-btn`).data('command-id', response.commandId);
                }
            } catch (error) {
                console.error('Error executing command:', error);
                outputArea.text('Error executing command: ' + (error.responseJSON?.error || error.statusText || 'Unknown error'));
                
                // Re-enable input and hide interrupt button
                inputElement.prop('disabled', false);
                $(`#block-${blockId} .interrupt-btn`).hide();
                
                // Remove the handler
                commandHandlers.delete(commandId);
                commandStatus.delete(commandId);
            }
        } catch (error) {
            console.error('Error in executeCommand:', error);
        }
    }
    
    /**
     * Register a command output handler
     */
    function registerCommandHandler(commandId, blockId) {
        const outputArea = $(`#block-${blockId} .command-output`);
        const inputElement = $(`#block-${blockId} .command-input`);
        
        log(`Registering handler for command ${commandId}`);
        
        // Clear the output area
        outputArea.text('');
        outputArea.show();
        
        // Set a timeout to detect if we don't receive any messages
        const timeoutId = setTimeout(() => {
            if (commandStatus.get(commandId) === false) {
                log(`No completion message received for command ${commandId} after 10 seconds`);
                
                // Re-enable input and hide interrupt button
                inputElement.prop('disabled', false);
                $(`#block-${blockId} .interrupt-btn`).hide();
                
                outputArea.append('\n\nWarning: No completion message received from server. The command may still be running.');
                
                // Don't remove the handler in case messages arrive late
            }
        }, 10000); // 10 second timeout
        
        // Register handler for this command
        commandHandlers.set(commandId, function(data) {
            log(`Received data for command ${commandId}: ${data.type}`);
            
            // Clear the timeout since we received a response
            clearTimeout(timeoutId);
            
            if (data.type === 'start') {
                outputArea.append(data.message);
            } else if (data.type === 'output' || data.type === 'error') {
                outputArea.append(data.message);
                // Auto-scroll to bottom
                outputArea.scrollTop(outputArea[0].scrollHeight);
            } else if (data.type === 'end' || data.type === 'interrupt') {
                // Mark command as completed
                commandStatus.set(commandId, true);
                
                outputArea.append(data.message);
                // Auto-scroll to bottom
                outputArea.scrollTop(outputArea[0].scrollHeight);
                
                // Re-enable input and hide interrupt button
                inputElement.prop('disabled', false);
                $(`#block-${blockId} .interrupt-btn`).hide();
                
                // Remove the handler after a short delay to catch any late messages
                setTimeout(() => {
                    commandHandlers.delete(commandId);
                    commandStatus.delete(commandId);
                }, 500);
                
                // Add a new command block if this is the last one
                const isLastBlock = $(`#block-${blockId}`).is(':last-child');
                if (isLastBlock) {
                    addCommandBlock();
                }
            }
        });
    }
    
    /**
     * Add a new command block
     */
    function addCommandBlock() {
        const blockId = Date.now();
        const commandBlock = `
            <div class="command-block" id="block-${blockId}">
                <button class="remove-btn" title="Remove">×</button>
                <button class="interrupt-btn" data-block-id="${blockId}" title="Interrupt Command">⚡ Stop</button>
                <button class="pwd-btn" data-block-id="${blockId}" title="Working Directory: ${globalWorkingDir}">
                    <i class="fas fa-folder"></i>
                </button>
                <input type="text" class="command-input" placeholder="Enter command..." data-block-id="${blockId}">
                <div class="command-suggestions" id="suggestions-${blockId}"></div>
                <div class="command-output" style="display: none;"></div>
            </div>
        `;
        $('#terminal-container').append(commandBlock);
        
        // Set the working directory to the global one
        $(`#block-${blockId}`).data('working-dir', globalWorkingDir);
        
        // Focus on the new input
        $(`#block-${blockId} .command-input`).focus();
        
        // Set up event handlers for the new block
        setupCommandBlockHandlers(blockId);
    }
    
    /**
     * Set up event handlers for command blocks
     */
    function setupCommandBlockHandlers(blockId) {
        const inputElement = $(`#block-${blockId} .command-input`);
        const suggestionsElement = $(`#suggestions-${blockId}`);
        let currentSuggestionIndex = -1;
        let filteredSuggestions = [];
        let historyPosition = -1; // Track position in command history for up/down navigation
        
        // Remove button handler
        $(`#block-${blockId} .remove-btn`).on('click', function() {
            $(`#block-${blockId}`).remove();
        });

        // Interrupt button handler
        $(`#block-${blockId} .interrupt-btn`).on('click', async function() {
            const commandId = $(this).data('command-id');
            if (commandId) {
                try {
                    // Send interrupt request to server
                    await $.ajax({
                        url: `/interrupt/${commandId}`,
                        method: 'POST',
                        contentType: 'application/json',
                        data: JSON.stringify({ clientId })
                    });
                } catch (error) {
                    console.error('Error interrupting command:', error);
                }
            }
            // Hide interrupt button
            $(this).hide();
        });
        
        // PWD button handler
        $(`#block-${blockId} .pwd-btn`).on('click', function() {
            currentPwdBlockId = blockId;
            const currentPwd = $(`#block-${blockId}`).data('working-dir') || globalWorkingDir;
            $('#pwd-input').val(currentPwd);
            $('#pwd-modal').show();
        });
        
        // Function to show command suggestions
        function showSuggestions(input) {
            if (!input.trim()) {
                suggestionsElement.hide();
                return;
            }
            
            // Filter command history for suggestions
            filteredSuggestions = commandHistory.filter(cmd => 
                cmd.toLowerCase().includes(input.toLowerCase())
            );
            
            if (filteredSuggestions.length === 0) {
                suggestionsElement.hide();
                return;
            }
            
            // Build suggestion HTML
            let suggestionsHtml = '';
            filteredSuggestions.forEach((cmd, index) => {
                suggestionsHtml += `<div class="suggestion-item" data-index="${index}">${cmd}</div>`;
            });
            
            suggestionsElement.html(suggestionsHtml);
            suggestionsElement.show();
            
            // Add click handler for suggestions
            $('.suggestion-item').on('click', function() {
                const selectedCommand = filteredSuggestions[$(this).data('index')];
                inputElement.val(selectedCommand);
                suggestionsElement.hide();
                inputElement.focus();
            });
            
            currentSuggestionIndex = -1;
        }
        
        // Input event for showing suggestions
        inputElement.on('input', function() {
            // Reset history position when user types
            historyPosition = -1;
            showSuggestions($(this).val());
        });
        
        // Focus out event to hide suggestions
        inputElement.on('blur', function() {
            // Delay hiding to allow for clicks on suggestions
            setTimeout(() => {
                suggestionsElement.hide();
            }, 200);
        });

        // Command input handler
        inputElement.on('keydown', function(e) {
            // Handle up/down arrow keys for shell-like history navigation
            if (!suggestionsElement.is(':visible')) {
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    
                    // If we're at the beginning of history, do nothing
                    if (historyPosition + 1 >= commandHistory.length) {
                        return;
                    }
                    
                    // Move up in history
                    historyPosition++;
                    $(this).val(commandHistory[historyPosition]);
                    return;
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    
                    // If we're at the end of history, clear input
                    if (historyPosition <= 0) {
                        historyPosition = -1;
                        $(this).val('');
                        return;
                    }
                    
                    // Move down in history
                    historyPosition--;
                    $(this).val(commandHistory[historyPosition]);
                    return;
                }
            } else {
                // Handle up/down arrow keys for suggestion navigation
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    
                    if (currentSuggestionIndex > 0) {
                        currentSuggestionIndex--;
                    } else {
                        currentSuggestionIndex = filteredSuggestions.length - 1;
                    }
                    
                    $('.suggestion-item').removeClass('selected');
                    $(`.suggestion-item[data-index="${currentSuggestionIndex}"]`).addClass('selected');
                    return;
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    
                    if (currentSuggestionIndex < filteredSuggestions.length - 1) {
                        currentSuggestionIndex++;
                    } else {
                        currentSuggestionIndex = 0;
                    }
                    
                    $('.suggestion-item').removeClass('selected');
                    $(`.suggestion-item[data-index="${currentSuggestionIndex}"]`).addClass('selected');
                    return;
                } else if (e.key === 'Enter' && currentSuggestionIndex >= 0) {
                    e.preventDefault();
                    
                    const selectedCommand = filteredSuggestions[currentSuggestionIndex];
                    $(this).val(selectedCommand);
                    suggestionsElement.hide();
                    return;
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    suggestionsElement.hide();
                    return;
                }
            }
            
            if (e.key === 'Enter') {
                const command = $(this).val();
                if (command.trim() === '') return;
                
                // Save command to history
                saveCommandToHistory(command);
                
                // Reset history position
                historyPosition = -1;
                
                // Disable input while command is executing
                $(this).prop('disabled', true);
                
                // Show output area with loading message
                const outputArea = $(`#block-${blockId} .command-output`);
                outputArea.text('Initializing command...').show();
                
                // Get the working directory for this block
                const workingDir = $(`#block-${blockId}`).data('working-dir') || globalWorkingDir;
                
                // Execute the command
                executeCommand(command, workingDir, blockId);
                
                // Show interrupt button while command is running
                $(`#block-${blockId} .interrupt-btn`).show();
                
                // Hide suggestions
                suggestionsElement.hide();
            }
        });
    }
    
    // PWD Modal handlers
    $('#pwd-cancel-btn').on('click', function() {
        $('#pwd-modal').hide();
    });
    
    $('#pwd-save-btn').on('click', function() {
        const newPwd = $('#pwd-input').val().trim();
        if (newPwd) {
            if (currentPwdBlockId === 'global') {
                // Update global working directory
                globalWorkingDir = newPwd;
                localStorage.setItem('globalWorkingDir', globalWorkingDir);
                $('#global-pwd-text').text(`Working Directory: ${globalWorkingDir}`);
            } else if (currentPwdBlockId) {
                // Update block-specific working directory
                $(`#block-${currentPwdBlockId}`).data('working-dir', newPwd);
                $(`#block-${currentPwdBlockId} .pwd-btn`).attr('title', `Working Directory: ${newPwd}`);
                $(`#block-${currentPwdBlockId} .pwd-btn`).addClass('active');
            }
        }
        $('#pwd-modal').hide();
    });
    
    // Global PWD edit button handler
    $('#global-pwd-edit-btn').on('click', function() {
        currentPwdBlockId = 'global';
        $('#pwd-input').val(globalWorkingDir);
        $('#pwd-modal').show();
    });
    
    // Initialize the application
    async function init() {
        try {
            await loadCommandHistory();
            await loadWorkingDirectory();
            initSSE();
            addCommandBlock();
            
            // Add command button click handler
            $('#add-command-btn').on('click', function() {
                addCommandBlock();
            });
        } catch (error) {
            console.error('Error initializing application:', error);
            alert('Failed to initialize the application. Please refresh the page.');
        }
    }
    
    // Start the application
    init();
}); 