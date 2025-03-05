// Store client connections and their subscribed topics
const clients = new Map();

function setupSSE(req, res) {
    // Set headers for SSE
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    // Parse topics from query parameters
    const topics = req.query.topics ? req.query.topics.split(',') : [];
    
    // Generate unique client ID
    const clientId = Date.now();

    // Store client connection with their topics
    clients.set(clientId, {
        topics,
        response: res
    });

    // Send initial connection message
    res.write(`data: Connected to topics: ${topics.join(', ')}\n\n`);

    // Handle client disconnect
    req.on('close', () => {
        clients.delete(clientId);
    });
}

// Utility function to publish messages to specific topics
function publishToTopic(topic, data) {
    clients.forEach((client, clientId) => {
        if (client.topics.includes(topic)) {
            client.response.write(`data: ${JSON.stringify({ topic, data })}\n\n`);
        }
    });
}

module.exports = {
    setupSSE,
    publishToTopic
}; 