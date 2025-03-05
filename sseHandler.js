// Store client connections
const clients = new Map();

// Store pending messages for clients that haven't connected yet
const pendingMessages = new Map();

// Debug flag
const DEBUG = true;

function log(...args) {
    if (DEBUG) {
        console.log(`[SSE ${new Date().toISOString()}]`, ...args);
    }
}

/**
 * Setup SSE connection for a client
 */
function setupSSE(req, res) {
    try {
        // Get client ID from query parameter
        const clientId = req.query.clientId;
        
        if (!clientId) {
            return res.status(400).end('Client ID is required');
        }
        
        log(`Setting up SSE connection for client ${clientId}`);
        
        // Set headers for SSE
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });

        // Store client connection
        clients.set(clientId, res);

        // Send initial connection message
        const initialMessage = JSON.stringify({ type: 'connected', clientId });
        res.write(`data: ${initialMessage}\n\n`);
        log(`Sent initial connection message to client ${clientId}`);

        // Send any pending messages for this client
        if (pendingMessages.has(clientId)) {
            const messages = pendingMessages.get(clientId);
            log(`Sending ${messages.length} pending messages to client ${clientId}`);
            
            messages.forEach(message => {
                res.write(`data: ${JSON.stringify(message)}\n\n`);
            });
            
            pendingMessages.delete(clientId);
        }

        // Handle client disconnect
        req.on('close', () => {
            log(`Client ${clientId} disconnected`);
            clients.delete(clientId);
        });
        
        // Keep the connection alive with a ping every 30 seconds
        const pingInterval = setInterval(() => {
            if (clients.has(clientId)) {
                try {
                    res.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`);
                } catch (err) {
                    log(`Error sending ping to client ${clientId}:`, err);
                    clearInterval(pingInterval);
                    clients.delete(clientId);
                }
            } else {
                clearInterval(pingInterval);
            }
        }, 30000);
        
    } catch (error) {
        console.error('Error in setupSSE:', error);
        if (!res.headersSent) {
            res.status(500).end('Internal Server Error');
        }
    }
}

/**
 * Publish a message to a specific client
 */
function publishToClient(clientId, topic, data) {
    try {
        const message = { topic, data };
        log(`Publishing to client ${clientId}, topic ${topic}, type ${data.type}`);
        
        const client = clients.get(clientId);
        
        if (client) {
            try {
                client.write(`data: ${JSON.stringify(message)}\n\n`);
            } catch (err) {
                log(`Error sending message to client ${clientId}:`, err);
                // Store message for when client reconnects
                if (!pendingMessages.has(clientId)) {
                    pendingMessages.set(clientId, []);
                }
                pendingMessages.get(clientId).push(message);
                clients.delete(clientId);
            }
        } else {
            log(`Client ${clientId} not connected, storing message`);
            // Store message for when client connects
            if (!pendingMessages.has(clientId)) {
                pendingMessages.set(clientId, []);
            }
            pendingMessages.get(clientId).push(message);
        }
    } catch (error) {
        console.error('Error in publishToClient:', error);
    }
}

/**
 * Check if a client is connected
 */
function isClientConnected(clientId) {
    return clients.has(clientId);
}

module.exports = {
    setupSSE,
    publishToClient,
    isClientConnected
}; 