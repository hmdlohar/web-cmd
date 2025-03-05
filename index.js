const express = require('express');
const { setupSSE } = require('./sseHandler');
const { executeCommand, interruptCommand, getDefaultWorkingDir } = require('./commandExecutor');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON
app.use(express.json());

// Serve static files from the web directory
app.use(express.static(path.join(__dirname, 'web')));

// Setup SSE endpoint
app.get('/sse', (req, res) => {
    try {
        setupSSE(req, res);
    } catch (error) {
        console.error('Error setting up SSE:', error);
        res.status(500).end('Internal Server Error');
    }
});

// Command execution endpoint
app.post('/execute', async (req, res) => {
    try {
        const { command, workingDir, clientId, commandId } = req.body;
        
        if (!command) {
            return res.status(400).json({ error: 'Command is required' });
        }
        
        if (!clientId) {
            return res.status(400).json({ error: 'Client ID is required' });
        }
        
        // Use client-provided command ID if available
        const result = await executeCommand(command, workingDir, clientId, commandId);
        res.json(result);
    } catch (error) {
        console.error('Error executing command:', error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});

// Command interrupt endpoint
app.post('/interrupt/:commandId', async (req, res) => {
    try {
        const { commandId } = req.params;
        const { clientId } = req.body;
        
        if (!clientId) {
            return res.status(400).json({ error: 'Client ID is required' });
        }
        
        const success = interruptCommand(commandId, clientId);
        
        if (success) {
            res.json({ message: 'Command interrupted successfully' });
        } else {
            res.status(404).json({ error: 'Command not found or already completed' });
        }
    } catch (error) {
        console.error('Error interrupting command:', error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});

// Get default working directory
app.get('/default-working-dir', (req, res) => {
    try {
        res.json({ workingDir: getDefaultWorkingDir() });
    } catch (error) {
        console.error('Error getting default working directory:', error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});

// Serve the main HTML page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'web', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
