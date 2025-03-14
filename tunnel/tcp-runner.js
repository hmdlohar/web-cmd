const WebSocket = require('ws');
const net = require('net');
const http = require('http');
const https = require('https');
const minimist = require('minimist');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');
const url = require('url');

// Get system temp directory
const TEMP_DIR = os.tmpdir();

// Parse command line arguments
const argv = minimist(process.argv.slice(2), {
  default: {
    server: 'http://localhost:8001',
    port: 8080,
    requestedPort: 0,
    background: false,
    logFile: path.join(TEMP_DIR, 'hmd-tunnel-runner.log')
  },
  alias: {
    server: ['s', 'server-address'],
    port: ['p', 'local-port'],
    requestedPort: ['r', 'remote-port'],
    background: ['b', 'bg'],
    logFile: ['l', 'log']
  },
  boolean: ['background']
});

// Convert string values to numbers for port arguments
if (typeof argv.port === 'string') argv.port = parseInt(argv.port, 10);
if (typeof argv.requestedPort === 'string') argv.requestedPort = parseInt(argv.requestedPort, 10);

// Display help if requested
if (argv.help || argv.h) {
  console.log(`
  TCP Tunnel Runner

  Usage: tcp-tunnel-runner [options]

  Options:
    -s, --server, --server-address <url>  Server URL (default: http://localhost:8001)
    -p, --port, --local-port <port>       Local port to forward (default: 8080)
    -r, --remote-port, --requestedPort <port>  Requested public port (default: 0, which means any available port)
    -b, --bg, --background                Run in background mode (detached from terminal)
    -l, --log, --logFile <path>           Log file path when running in background (default: in system temp dir)
    -h, --help                            Display this help message

  Example:
    tcp-tunnel-runner --server http://example.com:8001 --port 3000 --remote-port 8000 --bg
  `);
  process.exit(0);
}

// Background process handling (same as before)
// ... existing background process code ...

// Configuration
const SERVER_ADDRESS = argv.server;
const LOCAL_PORT = parseInt(argv.port);
const REQUESTED_PORT = parseInt(argv.requestedPort);

// Store active connections and tunnel info
const connections = new Map();
let tunnelInfo = null;
let controlWs = null;

// Register with the tunnel server
function registerTunnel() {
  console.log(`Registering with tunnel server at ${SERVER_ADDRESS}...`);
  console.log(`Forwarding local port ${LOCAL_PORT}${REQUESTED_PORT ? ` to requested port ${REQUESTED_PORT}` : ''}`);
  
  const parsedUrl = url.parse(SERVER_ADDRESS);
  const httpModule = parsedUrl.protocol === 'https:' ? https : http;
  
  const registerData = JSON.stringify({
    localPort: LOCAL_PORT,
    requestedPort: REQUESTED_PORT,
    forceRequestedPort: REQUESTED_PORT > 0
  });
  
  // Log the actual data being sent to the server for debugging
  console.log(`Sending registration data: ${registerData}`);
  
  const options = {
    method: 'POST',
    path: '/api/register',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(registerData)
    }
  };
  
  const req = httpModule.request(SERVER_ADDRESS, options, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      if (res.statusCode === 200) {
        try {
          tunnelInfo = JSON.parse(data);
          console.log(`Tunnel registered successfully!`);
          console.log(`Local port ${LOCAL_PORT} is now accessible at public port ${tunnelInfo.publicPort}`);
          console.log(`Tunnel ID: ${tunnelInfo.tunnelId}`);
          
          // Connect to control channel
          connectControlChannel(tunnelInfo.tunnelId);
          
          // Start TCP proxy server
          startProxyServer(tunnelInfo);
        } catch (err) {
          console.error('Error parsing tunnel info:', err);
          setTimeout(registerTunnel, 5000);
        }
      } else {
        console.error(`Failed to register tunnel: ${res.statusCode} ${res.statusMessage}`);
        console.error(data);
        setTimeout(registerTunnel, 5000);
      }
    });
  });
  
  req.on('error', (err) => {
    console.error('Error registering tunnel:', err);
    setTimeout(registerTunnel, 5000);
  });
  
  req.write(registerData);
  req.end();
}

// Connect to the control channel
function connectControlChannel(tunnelId) {
  const wsUrl = SERVER_ADDRESS.replace(/^http/, 'ws') + `/api/control/${tunnelId}`;
  console.log(`Connecting to control channel at ${wsUrl}...`);
  
  controlWs = new WebSocket(wsUrl);
  
  controlWs.on('open', () => {
    console.log('Connected to control channel');
    
    // Set up heartbeat to keep connection alive
    const heartbeatInterval = setInterval(() => {
      if (controlWs.readyState === WebSocket.OPEN) {
        controlWs.send(JSON.stringify({ type: 'heartbeat' }));
      } else {
        clearInterval(heartbeatInterval);
      }
    }, 30000);
  });
  
  controlWs.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'new-connection') {
        console.log(`Control channel notified of new connection: ${data.connectionId}`);
        // The actual connection will be handled by the proxy server
      }
      else if (data.type === 'port-changed') {
        console.log(`Server changed tunnel port to ${data.newPort}`);
        tunnelInfo.publicPort = data.newPort;
      }
      else if (data.type === 'error') {
        console.error(`Server error: ${data.message}`);
      }
    } catch (err) {
      console.error('Error processing control message:', err);
    }
  });
  
  controlWs.on('close', () => {
    console.log('Control channel closed. Reconnecting in 5 seconds...');
    setTimeout(() => connectControlChannel(tunnelId), 5000);
  });
  
  controlWs.on('error', (err) => {
    console.error('Control channel error:', err);
  });
}

// Start the TCP proxy server
function startProxyServer(info) {
  const proxyPort = info.proxyPort || (info.publicPort + 10000); // Use a different port for the proxy
  
  const server = net.createServer((clientSocket) => {
    const connectionId = generateConnectionId();
    console.log(`New proxy connection: ${connectionId}`);
    
    // Connect to the local service
    const localSocket = net.createConnection({
      host: 'localhost',
      port: LOCAL_PORT
    }, () => {
      console.log(`Connected to local service on port ${LOCAL_PORT} for connection ${connectionId}`);
      
      // Store the connection
      connections.set(connectionId, {
        clientSocket,
        localSocket,
        createdAt: Date.now()
      });
      
      // Pipe data between client and local service
      clientSocket.pipe(localSocket);
      localSocket.pipe(clientSocket);
    });
    
    // Handle socket events
    localSocket.on('error', (err) => {
      console.error(`Local socket error for ${connectionId}:`, err);
      clientSocket.end();
    });
    
    clientSocket.on('error', (err) => {
      console.error(`Client socket error for ${connectionId}:`, err);
      localSocket.end();
    });
    
    const cleanup = () => {
      connections.delete(connectionId);
      console.log(`Connection closed: ${connectionId}`);
    };
    
    clientSocket.on('close', cleanup);
    localSocket.on('close', cleanup);
    
    // Set socket timeouts
    clientSocket.setTimeout(300000); // 5 minutes
    localSocket.setTimeout(300000);
    
    clientSocket.on('timeout', () => {
      console.log(`Client socket timeout for ${connectionId}`);
      clientSocket.end();
    });
    
    localSocket.on('timeout', () => {
      console.log(`Local socket timeout for ${connectionId}`);
      localSocket.end();
    });
  });
  
  server.on('error', (err) => {
    console.error('Proxy server error:', err);
    setTimeout(() => startProxyServer(info), 5000);
  });
  
  server.listen(proxyPort, () => {
    console.log(`TCP proxy server listening on port ${proxyPort}`);
    
    // Connect to the tunnel server's proxy endpoint
    connectToTunnelProxy(info, proxyPort);
  });
}

// Connect to the tunnel server's proxy endpoint
function connectToTunnelProxy(info, proxyPort) {
  const proxyUrl = `${SERVER_ADDRESS}/api/proxy/${info.tunnelId}`;
  console.log(`Connecting to tunnel proxy at ${proxyUrl}...`);
  
  const parsedUrl = url.parse(proxyUrl);
  const httpModule = parsedUrl.protocol === 'https:' ? https : http;
  
  const proxyData = JSON.stringify({
    proxyPort: proxyPort
  });
  
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(proxyData)
    }
  };
  
  const req = httpModule.request(proxyUrl, options, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      if (res.statusCode === 200) {
        console.log(`Connected to tunnel proxy successfully!`);
      } else {
        console.error(`Failed to connect to tunnel proxy: ${res.statusCode} ${res.statusMessage}`);
        console.error(data);
        setTimeout(() => connectToTunnelProxy(info, proxyPort), 5000);
      }
    });
  });
  
  req.on('error', (err) => {
    console.error('Error connecting to tunnel proxy:', err);
    setTimeout(() => connectToTunnelProxy(info, proxyPort), 5000);
  });
  
  req.write(proxyData);
  req.end();
}

// Generate a unique connection ID
function generateConnectionId() {
  return Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
}

// Send heartbeat to keep tunnel alive
function sendHeartbeat() {
  if (!tunnelInfo) return;
  
  const heartbeatUrl = `${SERVER_ADDRESS}/api/heartbeat/${tunnelInfo.tunnelId}`;
  const parsedUrl = url.parse(heartbeatUrl);
  const httpModule = parsedUrl.protocol === 'https:' ? https : http;
  
  const req = httpModule.request(heartbeatUrl, { method: 'POST' }, (res) => {
    if (res.statusCode !== 200) {
      console.error(`Heartbeat failed: ${res.statusCode} ${res.statusMessage}`);
      // If heartbeat fails, re-register
      tunnelInfo = null;
      setTimeout(registerTunnel, 5000);
    }
  });
  
  req.on('error', (err) => {
    console.error('Error sending heartbeat:', err);
    // If heartbeat fails, re-register
    tunnelInfo = null;
    setTimeout(registerTunnel, 5000);
  });
  
  req.end();
}

// Set up periodic heartbeat
setInterval(sendHeartbeat, 30000);

// Add process-level error handling to prevent crashes
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  // Don't exit the process, just log the error
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit the process, just log the error
});

// Start the tunnel
registerTunnel();

console.log(`TCP Tunnel runner started. Forwarding local port ${LOCAL_PORT}`); 