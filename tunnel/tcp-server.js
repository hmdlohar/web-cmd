const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const net = require("net");
const { v4: uuidv4 } = require("uuid");

// Configuration
const HTTP_PORT = process.env.HTTP_PORT || 8001;
const PUBLIC_PORT_RANGE_START = parseInt(process.env.PORT_RANGE_START || 8010);
const PUBLIC_PORT_RANGE_END = parseInt(process.env.PORT_RANGE_END || 8099);
const HOST = process.env.HOST || "0.0.0.0";
const EXTERNAL_HOST = process.env.EXTERNAL_HOST || "localhost"; // Set this to your public hostname

// Store active tunnels and their information
const tunnels = new Map();
const usedPorts = new Set();

// Create Express app for HTTP endpoints
const app = express();
app.use(express.json());

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server for control channels
const wss = new WebSocket.Server({ server });

// Initialize the server
function init() {
  console.log("Initializing TCP tunnel server...");

  // Start HTTP server
  server.listen(HTTP_PORT, HOST, () => {
    console.log(`HTTP server listening on ${HOST}:${HTTP_PORT}`);
  });

  // Set up WebSocket server events
  setupWebSocketServer();

  // Set up HTTP endpoints
  setupHttpEndpoints();

  console.log(`TCP tunnel server initialized. Ready to accept connections.`);
  console.log(
    `Public port range: ${PUBLIC_PORT_RANGE_START}-${PUBLIC_PORT_RANGE_END}`
  );
}

// Set up WebSocket server for control channels
function setupWebSocketServer() {
  wss.on("connection", (ws, req) => {
    const urlParts = req.url.split("/");
    const tunnelId = urlParts[urlParts.length - 1];

    if (!tunnels.has(tunnelId)) {
      console.error(
        `WebSocket connection attempt for unknown tunnel: ${tunnelId}`
      );
      ws.close(1008, "Unknown tunnel ID");
      return;
    }

    console.log(`Control channel connected for tunnel: ${tunnelId}`);

    // Store the WebSocket connection in the tunnel info
    const tunnelInfo = tunnels.get(tunnelId);
    tunnelInfo.controlWs = ws;
    tunnelInfo.lastSeen = Date.now();
    tunnelInfo.active = true; // Mark the tunnel as active
    tunnels.set(tunnelId, tunnelInfo);

    // Handle WebSocket messages
    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message);

        if (data.type === "heartbeat") {
          // Update last seen timestamp
          tunnelInfo.lastSeen = Date.now();
          tunnels.set(tunnelId, tunnelInfo);
        }
      } catch (err) {
        console.error(`Error processing message from tunnel ${tunnelId}:`, err);
      }
    });

    // Handle WebSocket close
    ws.on("close", () => {
      console.log(`Control channel closed for tunnel: ${tunnelId}`);

      // Mark the tunnel as inactive when the control channel closes
      if (tunnels.has(tunnelId)) {
        const tunnelInfo = tunnels.get(tunnelId);
        tunnelInfo.active = false;
        tunnelInfo.controlWs = null;
        tunnels.set(tunnelId, tunnelInfo);
        console.log(`Tunnel ${tunnelId} marked as inactive`);
        // tunnelInfo.server.close();
        // usedPorts.delete(tunnelInfo.publicPort);
        // tunnels.delete(tunnelId);
        closeTunnel(tunnelId);
      }
    });

    // Handle WebSocket errors
    ws.on("error", (err) => {
      console.error(`Control channel error for tunnel ${tunnelId}:`, err);
    });
  });
}

// Set up HTTP endpoints
function setupHttpEndpoints() {
  // Serve static files from the public directory
  app.use(express.static("public"));

  // Register a new tunnel
  app.post("/api/register", (req, res) => {
    try {
      const { localPort, requestedPort } = req.body;

      if (!localPort) {
        return res.status(400).json({ error: "Local port is required" });
      }

      // Generate a unique tunnel ID
      const tunnelId = uuidv4();

      // Assign a public port
      const publicPort = assignPort(requestedPort);

      if (!publicPort) {
        return res.status(503).json({ error: "No ports available" });
      }

      // Create tunnel info
      const tunnelInfo = {
        tunnelId,
        localPort,
        publicPort,
        createdAt: Date.now(),
        lastSeen: Date.now(),
        connections: new Map(),
        proxyPort: null,
        active: false, // Start as inactive until control channel connects
      };

      // Store tunnel info
      tunnels.set(tunnelId, tunnelInfo);

      // Create a TCP server for this tunnel
      createTunnelServer(tunnelInfo);

      console.log(
        `Registered new tunnel: ${tunnelId}, public port: ${publicPort}`
      );

      // Return tunnel info to client
      res.json({
        tunnelId,
        publicPort,
        url: `http://${EXTERNAL_HOST}:${publicPort}`,
      });
    } catch (err) {
      console.error("Error registering tunnel:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Connect to tunnel proxy
  app.post("/api/proxy/:tunnelId", (req, res) => {
    try {
      const { tunnelId } = req.params;
      const { proxyPort } = req.body;

      if (!tunnels.has(tunnelId)) {
        return res.status(404).json({ error: "Tunnel not found" });
      }

      if (!proxyPort) {
        return res.status(400).json({ error: "Proxy port is required" });
      }

      // Update tunnel info with proxy port
      const tunnelInfo = tunnels.get(tunnelId);
      tunnelInfo.proxyPort = proxyPort;
      tunnelInfo.lastSeen = Date.now();
      tunnels.set(tunnelId, tunnelInfo);

      console.log(`Updated proxy port for tunnel ${tunnelId}: ${proxyPort}`);

      res.json({ success: true });
    } catch (err) {
      console.error("Error connecting to proxy:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Heartbeat endpoint
  app.post("/api/heartbeat/:tunnelId", (req, res) => {
    try {
      const { tunnelId } = req.params;

      if (!tunnels.has(tunnelId)) {
        return res.status(404).json({ error: "Tunnel not found" });
      }

      // Update last seen timestamp
      const tunnelInfo = tunnels.get(tunnelId);
      tunnelInfo.lastSeen = Date.now();
      tunnels.set(tunnelId, tunnelInfo);

      res.json({ success: true });
    } catch (err) {
      console.error("Error processing heartbeat:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // List active tunnels (admin endpoint)
  app.get("/api/tunnels", (req, res) => {
    try {
      const tunnelList = Array.from(tunnels.values()).map((tunnel) => ({
        tunnelId: tunnel.tunnelId,
        publicPort: tunnel.publicPort,
        localPort: tunnel.localPort,
        createdAt: tunnel.createdAt,
        lastSeen: tunnel.lastSeen,
        connectionCount: tunnel.connections.size,
        url: `http://${EXTERNAL_HOST}:${tunnel.publicPort}`,
        connections: Array.from(tunnel.connections.entries()).map(
          ([connId, conn]) => ({
            id: connId,
            createdAt: conn.createdAt,
          })
        ),
      }));

      res.json(tunnelList);
    } catch (err) {
      console.error("Error listing tunnels:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get details for a specific tunnel
  app.get("/api/tunnels/:tunnelId", (req, res) => {
    try {
      const { tunnelId } = req.params;

      if (!tunnels.has(tunnelId)) {
        return res.status(404).json({ error: "Tunnel not found" });
      }

      const tunnel = tunnels.get(tunnelId);
      const tunnelDetails = {
        tunnelId: tunnel.tunnelId,
        publicPort: tunnel.publicPort,
        localPort: tunnel.localPort,
        createdAt: tunnel.createdAt,
        lastSeen: tunnel.lastSeen,
        connectionCount: tunnel.connections.size,
        url: `http://${EXTERNAL_HOST}:${tunnel.publicPort}`,
        connections: Array.from(tunnel.connections.entries()).map(
          ([connId, conn]) => ({
            id: connId,
            createdAt: conn.createdAt,
          })
        ),
      };

      res.json(tunnelDetails);
    } catch (err) {
      console.error("Error getting tunnel details:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Delete a tunnel (admin endpoint)
  app.delete("/api/tunnels/:tunnelId", (req, res) => {
    try {
      const { tunnelId } = req.params;

      if (!tunnels.has(tunnelId)) {
        return res.status(404).json({ error: "Tunnel not found" });
      }

      // Close the tunnel
      closeTunnel(tunnelId);

      res.json({ success: true });
    } catch (err) {
      console.error("Error deleting tunnel:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Status endpoint
  app.get("/api/status", (req, res) => {
    try {
      res.json({
        status: "ok",
        tunnelCount: tunnels.size,
        usedPorts: Array.from(usedPorts),
        availablePorts:
          PUBLIC_PORT_RANGE_END - PUBLIC_PORT_RANGE_START + 1 - usedPorts.size,
      });
    } catch (err) {
      console.error("Error getting status:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Root endpoint - serve the index.html file
  app.get("/", (req, res) => {
    res.sendFile("index.html", { root: "./public" });
  });
}

// Create a TCP server for a tunnel
function createTunnelServer(tunnelInfo) {
  const server = net.createServer((socket) => {
    const connectionId = uuidv4();
    console.log(
      `New connection on port ${tunnelInfo.publicPort} for tunnel ${tunnelInfo.tunnelId}: ${connectionId}`
    );

    // Check if the tunnel is active before proceeding
    if (!tunnelInfo.active) {
      console.log(
        `Rejecting connection ${connectionId} - tunnel ${tunnelInfo.tunnelId} is inactive`
      );
      socket.end();
      return;
    }

    // Store the connection
    tunnelInfo.connections.set(connectionId, {
      socket,
      createdAt: Date.now(),
    });

    // Notify the client of the new connection via control channel
    if (
      tunnelInfo.controlWs &&
      tunnelInfo.controlWs.readyState === WebSocket.OPEN
    ) {
      tunnelInfo.controlWs.send(
        JSON.stringify({
          type: "new-connection",
          connectionId,
        })
      );
    }

    // If we have a proxy port, forward the connection
    if (tunnelInfo.proxyPort) {
      forwardConnection(tunnelInfo, connectionId, socket);
    } else {
      // No proxy port yet, close the connection
      socket.end();
      console.error(
        `No proxy port for tunnel ${tunnelInfo.tunnelId}, closing connection ${connectionId}`
      );
    }

    // Handle socket close
    socket.on("close", () => {
      console.log(`Connection closed: ${connectionId}`);
      tunnelInfo.connections.delete(connectionId);
    });

    // Handle socket errors
    socket.on("error", (err) => {
      console.error(`Socket error for connection ${connectionId}:`, err);
      tunnelInfo.connections.delete(connectionId);
    });
  });

  // Handle server errors
  server.on("error", (err) => {
    console.error(`Server error for tunnel ${tunnelInfo.tunnelId}:`, err);

    // If the port is in use, try to assign a new one
    if (err.code === "EADDRINUSE") {
      console.log(
        `Port ${tunnelInfo.publicPort} is in use, trying to assign a new one...`
      );

      // Release the current port
      usedPorts.delete(tunnelInfo.publicPort);

      // Assign a new port
      const newPort = assignPort();

      if (newPort) {
        tunnelInfo.publicPort = newPort;

        // Notify the client of the port change
        if (
          tunnelInfo.controlWs &&
          tunnelInfo.controlWs.readyState === WebSocket.OPEN
        ) {
          tunnelInfo.controlWs.send(
            JSON.stringify({
              type: "port-changed",
              newPort,
            })
          );
        }

        // Create a new server with the new port
        createTunnelServer(tunnelInfo);
      } else {
        console.error(`No ports available for tunnel ${tunnelInfo.tunnelId}`);
        closeTunnel(tunnelInfo.tunnelId);
      }
    }
  });

  // Start listening
  server.listen(tunnelInfo.publicPort, HOST, () => {
    console.log(
      `TCP server for tunnel ${tunnelInfo.tunnelId} listening on ${HOST}:${tunnelInfo.publicPort}`
    );

    // Store the server in the tunnel info
    tunnelInfo.server = server;
    tunnels.set(tunnelInfo.tunnelId, tunnelInfo);
  });
}

// Forward a connection to the client's proxy
function forwardConnection(tunnelInfo, connectionId, socket) {
  // Connect to the client's proxy
  const proxySocket = net.createConnection(
    {
      host: "localhost", // Assuming the client is on the same machine, change if needed
      port: tunnelInfo.proxyPort,
    },
    () => {
      console.log(
        `Connected to proxy for tunnel ${tunnelInfo.tunnelId}, connection ${connectionId}`
      );

      // Pipe data between the public socket and the proxy socket
      socket.pipe(proxySocket);
      proxySocket.pipe(socket);
    }
  );

  // Handle proxy socket errors
  proxySocket.on("error", (err) => {
    console.error(`Proxy socket error for connection ${connectionId}:`, err);
    socket.end();
  });

  // Handle proxy socket close
  proxySocket.on("close", () => {
    console.log(`Proxy connection closed for ${connectionId}`);
    socket.end();
  });

  // Set socket timeouts
  proxySocket.setTimeout(300000); // 5 minutes
  proxySocket.on("timeout", () => {
    console.log(`Proxy socket timeout for ${connectionId}`);
    proxySocket.end();
  });
}

// Assign a port from the available range
function assignPort(requestedPort) {
  // If a specific port is requested and it's available, use it
  if (
    requestedPort &&
    requestedPort >= PUBLIC_PORT_RANGE_START &&
    requestedPort <= PUBLIC_PORT_RANGE_END
  ) {
    if (!usedPorts.has(requestedPort)) {
      usedPorts.add(requestedPort);
      return requestedPort;
    }
  }

  // Otherwise, find the first available port in the range
  for (
    let port = PUBLIC_PORT_RANGE_START;
    port <= PUBLIC_PORT_RANGE_END;
    port++
  ) {
    if (!usedPorts.has(port)) {
      usedPorts.add(port);
      return port;
    }
  }

  // No ports available
  return null;
}

// Close a tunnel and clean up resources
function closeTunnel(tunnelId) {
  if (!tunnels.has(tunnelId)) {
    return false;
  }

  const tunnelInfo = tunnels.get(tunnelId);

  // Close the server
  if (tunnelInfo.server) {
    tunnelInfo.server.close();
  }

  // Close the control channel
  if (tunnelInfo.controlWs) {
    tunnelInfo.controlWs.close();
  }

  // Close all connections
  for (const connection of tunnelInfo.connections.values()) {
    if (connection.socket) {
      connection.socket.end();
    }
  }

  // Release the port
  usedPorts.delete(tunnelInfo.publicPort);

  // Remove the tunnel
  tunnels.delete(tunnelId);

  console.log(`Closed tunnel: ${tunnelId}`);

  return true;
}

// Periodic cleanup of inactive tunnels
function cleanupInactiveTunnels() {
  const now = Date.now();
  const inactiveThreshold = 5 * 60 * 1000; // 5 minutes

  for (const [tunnelId, tunnelInfo] of tunnels.entries()) {
    // Close tunnels that have been inactive for too long
    if (!tunnelInfo.active && now - tunnelInfo.lastSeen > inactiveThreshold) {
      console.log(`Cleaning up inactive tunnel: ${tunnelId}`);
      closeTunnel(tunnelId);
    }
  }
}

// Set up periodic cleanup
setInterval(cleanupInactiveTunnels, 60 * 1000); // Run every minute

// Handle process signals
process.on("SIGINT", () => {
  console.log("Shutting down...");

  // Close all tunnels
  for (const tunnelId of tunnels.keys()) {
    closeTunnel(tunnelId);
  }

  // Close the HTTP server
  server.close(() => {
    console.log("HTTP server closed");
    process.exit(0);
  });
});

// Start the server
init();
