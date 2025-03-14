const net = require("net");
const http = require("http");
const WebSocket = require("ws");
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const dotenv = require("dotenv");
const fs = require("fs");

// Load environment variables from .env file if it exists
if (fs.existsSync('.env')) {
  dotenv.config();
}

// Configuration with fallback to defaults
const SERVER_PORT = process.env.SERVER_PORT || 8000;
const WS_PORT = process.env.WS_PORT || 8001;

// Store active tunnels
const activeTunnels = new Map();

// Create Express app for the web interface
const app = express();
app.use(express.static("public"));
app.use(express.json());

// API endpoint to list active tunnels
app.get("/api/tunnels", (req, res) => {
  const tunnelList = Array.from(activeTunnels.entries()).map(
    ([id, tunnel]) => ({
      id: id,
      localPort: tunnel.localPort,
      publicPort: tunnel.publicPort,
      createdAt: tunnel.createdAt,
      connections: tunnel.connections,
    })
  );

  res.json(tunnelList);
});

// Ensure the root route serves the index.html
app.get("/", (req, res) => {
  res.sendFile("index.html", { root: "./public" });
});

// Create HTTP server from Express app
const httpServer = http.createServer(app);

// WebSocket server for tunnel connections
const wss = new WebSocket.Server({ port: WS_PORT });

// Handle new WebSocket connections from runners
wss.on("connection", (ws) => {
  console.log("Runner connected");

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === "heartbeat") {
        // Respond to heartbeat to confirm connection is alive
        ws.send(JSON.stringify({ type: "heartbeat-ack" }));
        return;
      }
      
      if (data.type === "register") {
        // Register a new tunnel
        const tunnelId = uuidv4();
        const publicPort = data.requestedPort || findAvailablePort();

        // Create a TCP server for this tunnel
        const server = createTunnelServer(publicPort, ws);

        // Only register if server creation was successful
        if (server) {
          activeTunnels.set(tunnelId, {
            ws,
            server,
            localPort: data.localPort,
            publicPort,
            createdAt: new Date(),
            connections: 0,
          });

          // Send confirmation to the runner
          ws.send(
            JSON.stringify({
              type: "registered",
              tunnelId,
              publicPort,
            })
          );

          console.log(
            `Registered new tunnel: local port ${data.localPort} -> public port ${publicPort}`
          );
        } else {
          // Notify runner of failure
          ws.send(
            JSON.stringify({
              type: "error",
              message: `Failed to create tunnel on port ${publicPort}`,
            })
          );
        }
      }
      
      // 2. Handle chunked data
      if (data.type === "chunked-data-start") {
        // Initialize buffer for this connection
        const tunnelId = data.tunnelId;
        const connectionId = data.connectionId;
        
        // Find the socket for this connection
        const tunnel = activeTunnels.get(tunnelId);
        if (!tunnel) return;
        
        // Initialize chunk storage for this connection if not exists
        if (!tunnel.chunks) tunnel.chunks = new Map();
        
        // Initialize chunks for this connection
        tunnel.chunks.set(connectionId, {
          receivedChunks: 0,
          totalChunks: data.totalChunks,
          data: []
        });
      }
      else if (data.type === "chunked-data") {
        const tunnelId = data.tunnelId;
        const connectionId = data.connectionId;
        
        // Find the tunnel
        const tunnel = activeTunnels.get(tunnelId);
        if (!tunnel || !tunnel.chunks || !tunnel.chunks.has(connectionId)) return;
        
        // Store this chunk
        const chunkInfo = tunnel.chunks.get(connectionId);
        chunkInfo.data[data.chunkIndex] = data.data;
        chunkInfo.receivedChunks++;
        
        // If all chunks received, process them
        if (chunkInfo.receivedChunks === chunkInfo.totalChunks) {
          // Combine all chunks
          const completeData = chunkInfo.data.join('');
          
          // Find the socket for this connection
          for (const socket of tunnel.connections.values()) {
            if (socket.connectionId === connectionId) {
              // Send the complete data
              const buffer = Buffer.from(completeData, "base64");
              socket.write(buffer);
              break;
            }
          }
          
          // Clean up
          tunnel.chunks.delete(connectionId);
        }
      }
      else if (data.type === "chunked-data-end") {
        // This is just a marker, actual processing happens when all chunks are received
      }
    } catch (err) {
      console.error("Error processing message:", err);
      // Try to notify the client about the error
      try {
        ws.send(
          JSON.stringify({
            type: "error",
            message: `Server error: ${err.message}`,
          })
        );
      } catch (sendErr) {
        console.error("Failed to send error message to client:", sendErr);
      }
    }
  });

  ws.on("close", () => {
    // Clean up tunnels when runner disconnects
    for (const [id, tunnel] of activeTunnels.entries()) {
      if (tunnel.ws === ws) {
        tunnel.server.close();
        activeTunnels.delete(id);
        console.log(`Tunnel ${id} closed due to runner disconnection`);
      }
    }
  });
});

// Create a TCP server for a specific tunnel
function createTunnelServer(port, ws) {
  const server = net.createServer((socket) => {
    const tunnelId = Array.from(activeTunnels.entries()).find(
      ([_, tunnel]) => tunnel.ws === ws && tunnel.publicPort === port
    )?.[0];

    if (!tunnelId) {
      socket.end();
      return;
    }

    const tunnel = activeTunnels.get(tunnelId);
    const connectionId = uuidv4();

    // Increment connection count
    tunnel.connections++;

    console.log(`New connection to tunnel ${tunnelId} on port ${port}`);

    // Tell the runner about the new connection
    ws.send(
      JSON.stringify({
        type: "connection",
        tunnelId,
        connectionId,
      })
    );

    // Handle data from the client
    socket.on("data", (data) => {
      ws.send(
        JSON.stringify({
          type: "data",
          tunnelId,
          connectionId,
          data: data.toString("base64"),
        })
      );
    });

    // Handle socket events
    socket.on("close", () => {
      ws.send(
        JSON.stringify({
          type: "close",
          tunnelId,
          connectionId,
        })
      );

      tunnel.connections--;
    });

    // Handle data from the runner to send back to the client
    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message);
        if (data.type === "data" && data.connectionId === connectionId) {
          const buffer = Buffer.from(data.data, "base64");
          socket.write(buffer);
        }
      } catch (err) {
        console.error("Error processing message from runner:", err);
      }
    });
  });

  // Add error handling for the server
  server.on("error", (err) => {
    console.error(`Error on tunnel server port ${port}:`, err.message);

    // If port is already in use, try another port
    if (err.code === "EADDRINUSE") {
      console.log(`Port ${port} is already in use, trying another port...`);

      // Find a new available port
      const newPort = findAvailablePort();

      // Find the tunnel using this server
      for (const [tunnelId, tunnel] of activeTunnels.entries()) {
        if (tunnel.server === server) {
          // Update the tunnel with a new server on a new port
          const newServer = createTunnelServer(newPort, ws);

          // Update the tunnel information
          tunnel.publicPort = newPort;
          tunnel.server = newServer;

          // Notify the runner about the port change
          ws.send(
            JSON.stringify({
              type: "port-changed",
              tunnelId,
              newPort,
            })
          );

          console.log(`Tunnel ${tunnelId} moved to port ${newPort}`);
          break;
        }
      }
    }
  });

  // Try to listen on the port with error handling
  try {
    server.listen(port, () => {
      console.log(`Tunnel server listening on port ${port}`);
    });
  } catch (err) {
    console.error(
      `Failed to start tunnel server on port ${port}:`,
      err.message
    );
    // Return null to indicate failure
    return null;
  }

  return server;
}

// Find an available port with better checking
function findAvailablePort() {
  // Simple implementation - in production you'd want to check if ports are actually available
  const usedPorts = Array.from(activeTunnels.values()).map((t) => t.publicPort);
  let port = 10000;
  while (usedPorts.includes(port)) {
    port++;
  }
  return port;
}

// Start the HTTP server with error handling
try {
  httpServer.listen(SERVER_PORT, () => {
    console.log(`Web interface available at http://localhost:${SERVER_PORT}`);
    console.log(`WebSocket server running on port ${WS_PORT}`);
  });

  httpServer.on("error", (err) => {
    console.error(`HTTP server error:`, err.message);
    if (err.code === "EADDRINUSE") {
      console.error(
        `Port ${SERVER_PORT} is already in use. Please set a different port in the .env file.`
      );
      process.exit(1);
    }
  });
} catch (err) {
  console.error(
    `Failed to start HTTP server on port ${SERVER_PORT}:`,
    err.message
  );
  console.log("Please set a different HTTP port in the .env file");
  process.exit(1);
}

// Add process-level error handling to prevent crashes
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  // Don't exit the process, just log the error
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  // Don't exit the process, just log the error
});

// Display startup information
console.log(`
Node Tunnel Server

Server configuration:
  Web interface port: ${SERVER_PORT}
  WebSocket port: ${WS_PORT}

To change these settings, create a .env file with:
  SERVER_PORT=<port>
  WS_PORT=<port>
`);
