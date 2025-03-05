const express = require('express');
const { setupSSE } = require('./sseHandler');
const { executeCommand, interruptCommand } = require('./commandExecutor');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON
app.use(express.json());

// Serve static files from the web directory
app.use(express.static(path.join(__dirname, 'web')));

// Setup SSE endpoint
app.get('/sse', setupSSE);

// Command execution endpoint
app.post('/execute', async (req, res) => {
    try {
        const { command } = req.body;
        if (!command) {
            return res.status(400).json({ error: 'Command is required' });
        }
        
        const result = await executeCommand(command);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Command interrupt endpoint
app.post('/interrupt/:commandId', (req, res) => {
    const { commandId } = req.params;
    const success = interruptCommand(commandId);
    
    if (success) {
        res.json({ message: 'Command interrupted successfully' });
    } else {
        res.status(404).json({ error: 'Command not found or already completed' });
    }
});

// Serve the main HTML page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'web', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
