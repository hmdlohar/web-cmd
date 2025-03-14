const WebSocket = require('ws');
const net = require('net');
const minimist = require('minimist');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');

// Get system temp directory
const TEMP_DIR = os.tmpdir();

// Parse command line arguments
const argv = minimist(process.argv.slice(2), {
  default: {
    server: 'ws://localhost:8001',
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

// Display help if requested
if (argv.help || argv.h) {
  console.log(`
  hmd-tunnel Runner

  Usage: hmd-tunnel-runner [options]

  Options:
    -s, --server, --server-address <url>  WebSocket URL of the tunnel server (default: ws://localhost:8001)
    -p, --port, --local-port <port>       Local port to forward (default: 8080)
    -r, --remote-port, --requestedPort <port>  Requested public port (default: 0, which means any available port)
    -b, --bg, --background                Run in background mode (detached from terminal)
    -l, --log, --logFile <path>           Log file path when running in background (default: in system temp dir)
    -h, --help                            Display this help message

  Example:
    hmd-tunnel-runner --server ws://example.com:8001 --port 3000 --remote-port 8000 --bg
  `);
  process.exit(0);
}

// Check if this is the child process
const IS_CHILD = process.env.HMD_TUNNEL_CHILD === 'true';

// If background mode is requested and this is not the child process, spawn a new process
if (argv.background && !IS_CHILD) {
  const logFile = path.resolve(argv.logFile);
  const pidFile = path.join(TEMP_DIR, 'hmd-tunnel-runner.pid');
  
  console.log(`Starting hmd-tunnel runner in background mode...`);
  
  // Create log directory if it doesn't exist
  const logDir = path.dirname(logFile);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  
  // Open log file for writing
  const out = fs.openSync(logFile, 'a');
  const err = fs.openSync(logFile, 'a');
  
  // Prepare arguments for the child process
  const args = process.argv.slice(2).filter(arg => arg !== '--bg' && arg !== '-b' && arg !== '--background');
  
  // Create child process using spawn instead of fork
  const child = spawn(process.execPath, [__filename, ...args], {
    detached: true,
    stdio: ['ignore', out, err],
    env: { ...process.env, HMD_TUNNEL_CHILD: 'true' }
  });
  
  // Unref the child to allow the parent to exit
  child.unref();
  
  console.log(`Background process started with PID: ${child.pid}`);
  console.log(`Log file: ${logFile}`);
  console.log(`PID file: ${pidFile}`);
  console.log(`To stop the background process: kill ${child.pid}`);
  console.log(`Or: kill $(cat ${pidFile})`);
  
  // Write the PID to a file for management
  fs.writeFileSync(pidFile, child.pid.toString());
  
  // Exit the parent process
  process.exit(0);
}

// If this is the child process, set up logging
if (IS_CHILD) {
  const LOG_FILE = path.resolve(argv.logFile);
  const PID_FILE = path.join(TEMP_DIR, 'hmd-tunnel-runner.pid');
  
  // Write PID to file for management
  fs.writeFileSync(PID_FILE, process.pid.toString());
  
  console.log(`Background process started (PID: ${process.pid})`);
  
  // Handle process signals
  process.on('SIGINT', () => {
    console.log('Received SIGINT signal, shutting down...');
    try {
      fs.unlinkSync(PID_FILE);
    } catch (err) {
      console.error(`Error removing PID file: ${err.message}`);
    }
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    console.log('Received SIGTERM signal, shutting down...');
    try {
      fs.unlinkSync(PID_FILE);
    } catch (err) {
      console.error(`Error removing PID file: ${err.message}`);
    }
    process.exit(0);
  });
}

// Configuration
const SERVER_ADDRESS = argv.server;
const LOCAL_PORT = parseInt(argv.port);
const REQUESTED_PORT = parseInt(argv.requestedPort);

// Store active connections
const connections = new Map();

// Connect to the tunnel server
function connectToServer() {
  console.log(`Connecting to tunnel server at ${SERVER_ADDRESS}...`);
  console.log(`Forwarding local port ${LOCAL_PORT}${REQUESTED_PORT ? ` to requested port ${REQUESTED_PORT}` : ''}`);
  
  const ws = new WebSocket(SERVER_ADDRESS);
  
  ws.on('open', () => {
    console.log('Connected to tunnel server');
    
    // Register this runner with the server
    ws.send(JSON.stringify({
      type: 'register',
      localPort: LOCAL_PORT,
      requestedPort: REQUESTED_PORT
    }));
  });
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'registered') {
        console.log(`Tunnel registered successfully!`);
        console.log(`Local port ${LOCAL_PORT} is now accessible at public port ${data.publicPort}`);
      }
      else if (data.type === 'port-changed') {
        console.log(`Server changed tunnel port to ${data.newPort}`);
        console.log(`Local port ${LOCAL_PORT} is now accessible at public port ${data.newPort}`);
      }
      else if (data.type === 'error') {
        console.error(`Server error: ${data.message}`);
      }
      else if (data.type === 'connection') {
        handleNewConnection(ws, data.tunnelId, data.connectionId);
      }
      else if (data.type === 'data') {
        const connection = connections.get(data.connectionId);
        if (connection) {
          const buffer = Buffer.from(data.data, 'base64');
          connection.write(buffer);
        }
      }
      else if (data.type === 'close') {
        const connection = connections.get(data.connectionId);
        if (connection) {
          connection.end();
          connections.delete(data.connectionId);
        }
      }
    } catch (err) {
      console.error('Error processing message:', err);
    }
  });
  
  ws.on('close', () => {
    console.log('Disconnected from tunnel server. Reconnecting in 5 seconds...');
    
    // Close all active connections
    for (const connection of connections.values()) {
      connection.end();
    }
    connections.clear();
    
    // Reconnect after a delay
    setTimeout(connectToServer, 5000);
  });
  
  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
}

// Handle a new connection from the server
function handleNewConnection(ws, tunnelId, connectionId) {
  console.log(`New connection: ${connectionId}`);
  
  // Connect to the local service
  const socket = net.createConnection({
    host: 'localhost',
    port: LOCAL_PORT
  }, () => {
    console.log(`Connected to local service on port ${LOCAL_PORT}`);
  });
  
  // Store the connection
  connections.set(connectionId, socket);
  
  // Handle data from the local service
  socket.on('data', (data) => {
    ws.send(JSON.stringify({
      type: 'data',
      tunnelId,
      connectionId,
      data: data.toString('base64')
    }));
  });
  
  // Handle socket events
  socket.on('close', () => {
    console.log(`Connection closed: ${connectionId}`);
    ws.send(JSON.stringify({
      type: 'close',
      tunnelId,
      connectionId
    }));
    connections.delete(connectionId);
  });
  
  socket.on('error', (err) => {
    console.error(`Socket error for ${connectionId}:`, err);
    socket.end();
  });
}

// Add process-level error handling to prevent crashes
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  // Don't exit the process, just log the error
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit the process, just log the error
});

// Start the runner
connectToServer();

console.log(`Tunnel runner started. Forwarding local port ${LOCAL_PORT}`); 