const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const { publishToClient, isClientConnected } = require('./sseHandler');
const path = require('path');
const os = require('os');

// Store active command processes
const activeCommands = new Map();

// Default working directory is user's home directory
const DEFAULT_WORKING_DIR = os.homedir();

// Debug flag
const DEBUG = true;

function log(...args) {
    if (DEBUG) {
        console.log(`[CMD ${new Date().toISOString()}]`, ...args);
    }
}

/**
 * Execute a shell command and stream the output
 * @param {string} command - The command to execute
 * @param {string} workingDir - Working directory for the command
 * @param {string} clientId - The client ID to send output to
 * @param {string} [clientCommandId] - Optional client-provided command ID
 * @returns {Promise<{commandId: string}>} - The command ID
 */
async function executeCommand(command, workingDir = DEFAULT_WORKING_DIR, clientId, clientCommandId) {
    return new Promise((resolve, reject) => {
        try {
            // Use client-provided command ID or generate a new one
            const commandId = clientCommandId || uuidv4();
            
            log(`Executing command: ${command}, ID: ${commandId}, Client: ${clientId}`);
            
            // Check if client is connected before proceeding
            if (!isClientConnected(clientId)) {
                log(`Client ${clientId} not connected, command will be queued`);
            }
            
            // Send initial message immediately
            publishToClient(clientId, `command-${commandId}`, {
                type: 'start',
                message: `Working directory: ${workingDir}\n`
            });
            
            // Split the command into the base command and arguments
            const parts = command.trim().split(/\s+/);
            const cmd = parts[0];
            const args = parts.slice(1);
            
            // Use spawn instead of exec to get better control over the process
            const process = spawn(cmd, args, {
                shell: true,
                cwd: workingDir
            });
            
            // Store the process for potential interruption
            activeCommands.set(commandId, process);
            
            let hasOutput = false;
            let outputBuffer = '';
            let errorBuffer = '';
            
            // Function to flush buffers
            const flushBuffers = () => {
                if (outputBuffer) {
                    hasOutput = true;
                    publishToClient(clientId, `command-${commandId}`, {
                        type: 'output',
                        message: outputBuffer
                    });
                    outputBuffer = '';
                }
                
                if (errorBuffer) {
                    hasOutput = true;
                    publishToClient(clientId, `command-${commandId}`, {
                        type: 'error',
                        message: errorBuffer
                    });
                    errorBuffer = '';
                }
            };
            
            // Set up a timer to periodically flush buffers
            const flushInterval = setInterval(flushBuffers, 50);
            
            // Handle stdout data
            process.stdout.on('data', (data) => {
                outputBuffer += data.toString();
                // For large chunks, flush immediately
                if (outputBuffer.length > 1024) {
                    flushBuffers();
                }
            });
            
            // Handle stderr data
            process.stderr.on('data', (data) => {
                errorBuffer += data.toString();
                // For large chunks, flush immediately
                if (errorBuffer.length > 1024) {
                    flushBuffers();
                }
            });
            
            // Handle process exit
            process.on('close', (code) => {
                // Clear the flush interval
                clearInterval(flushInterval);
                
                // Final flush of any remaining data
                flushBuffers();
                
                // Remove from active commands
                activeCommands.delete(commandId);
                
                log(`Command completed: ${command}, ID: ${commandId}, Exit code: ${code}, Had output: ${hasOutput}`);
                
                // If there was no output, send a message indicating command completed
                if (!hasOutput) {
                    publishToClient(clientId, `command-${commandId}`, {
                        type: 'output',
                        message: 'Command executed successfully with no output.'
                    });
                }
                
                // Always send an end message
                publishToClient(clientId, `command-${commandId}`, {
                    type: 'end',
                    message: `\nCommand execution ${code === 0 ? 'completed' : 'failed'} with exit code ${code}`,
                    exitCode: code
                });
            });
            
            // Handle process errors
            process.on('error', (err) => {
                // Clear the flush interval
                clearInterval(flushInterval);
                
                // Remove from active commands
                activeCommands.delete(commandId);
                
                log(`Command error: ${command}, ID: ${commandId}, Error: ${err.message}`);
                
                publishToClient(clientId, `command-${commandId}`, {
                    type: 'error',
                    message: `Failed to start command: ${err.message}`
                });
                
                publishToClient(clientId, `command-${commandId}`, {
                    type: 'end',
                    message: `\nCommand execution failed`,
                    exitCode: -1
                });
            });
            
            // Resolve immediately with the command ID
            resolve({ commandId });
        } catch (error) {
            console.error('Error executing command:', error);
            reject(error);
        }
    });
}

/**
 * Interrupt a running command
 * @param {string} commandId - The ID of the command to interrupt
 * @param {string} clientId - The client ID to send output to
 * @returns {boolean} - Whether the command was successfully interrupted
 */
function interruptCommand(commandId, clientId) {
    try {
        const process = activeCommands.get(commandId);
        if (process) {
            log(`Interrupting command ID: ${commandId}, Client: ${clientId}`);
            
            // Kill the process
            process.kill('SIGTERM');
            
            publishToClient(clientId, `command-${commandId}`, {
                type: 'interrupt',
                message: '\nCommand was interrupted by user'
            });
            
            publishToClient(clientId, `command-${commandId}`, {
                type: 'end',
                message: `\nCommand execution interrupted`,
                exitCode: -1
            });
            
            activeCommands.delete(commandId);
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error interrupting command:', error);
        return false;
    }
}

/**
 * Get the default working directory
 * @returns {string} - The default working directory
 */
function getDefaultWorkingDir() {
    return DEFAULT_WORKING_DIR;
}

module.exports = {
    executeCommand,
    interruptCommand,
    getDefaultWorkingDir
}; 