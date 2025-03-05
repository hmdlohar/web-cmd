const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');

// Store active command processes
const activeCommands = new Map();

/**
 * Execute a shell command and return the output
 * @param {string} command - The command to execute
 * @returns {Promise<{output: string, commandId: string}>} - The command output and ID
 */
function executeCommand(command) {
    return new Promise((resolve, reject) => {
        // Generate a unique ID for this command
        const commandId = uuidv4();
        
        // Split the command into the base command and arguments
        const args = command.split(' ');
        const cmd = args.shift();
        
        let output = '';
        let error = '';
        
        // Use spawn instead of exec to get better control over the process
        const process = spawn(cmd, args, {
            shell: true
        });
        
        // Store the process for potential interruption
        activeCommands.set(commandId, process);
        
        process.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        process.stderr.on('data', (data) => {
            error += data.toString();
        });
        
        process.on('close', (code) => {
            // Remove from active commands
            activeCommands.delete(commandId);
            
            if (code === 0 || code === null) {
                resolve({ output: output || error, commandId });
            } else {
                resolve({ output: `Error (${code}): ${error || output}`, commandId });
            }
        });
        
        process.on('error', (err) => {
            // Remove from active commands
            activeCommands.delete(commandId);
            resolve({ output: `Failed to start command: ${err.message}`, commandId });
        });
    });
}

/**
 * Interrupt a running command
 * @param {string} commandId - The ID of the command to interrupt
 * @returns {boolean} - Whether the command was successfully interrupted
 */
function interruptCommand(commandId) {
    const process = activeCommands.get(commandId);
    if (process) {
        // Kill the process
        process.kill('SIGTERM');
        activeCommands.delete(commandId);
        return true;
    }
    return false;
}

module.exports = {
    executeCommand,
    interruptCommand
}; 