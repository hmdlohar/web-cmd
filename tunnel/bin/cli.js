#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');

// Display help message
console.log(`
hmd-tunnel - A simple tunneling service similar to ngrok

Usage:
  npx hmd-tunnel server        Start the tunnel server
  npx hmd-tunnel runner [args] Start the tunnel runner

Examples:
  npx hmd-tunnel server
  npx hmd-tunnel runner --server ws://example.com:8001 --port 3000 --bg

For more detailed help:
  npx hmd-tunnel-server --help
  npx hmd-tunnel-runner --help
`);

// Get the command (server or runner)
const command = process.argv[2];

if (command === 'server') {
  // Run the server
  console.log('Starting hmd-tunnel server...');
  try {
    require('../tcp-server.js');
  } catch (error) {
    console.error('Error starting server:', error);
    process.exit(1);
  }
} else if (command === 'runner') {
  // Run the runner with all arguments after 'runner'
  console.log('Starting hmd-tunnel runner...');
  try {
    // Pass all arguments after 'runner' to the runner script
    const args = process.argv.slice(3);
    require('../tcp-runner.js');
  } catch (error) {
    console.error('Error starting runner:', error);
    process.exit(1);
  }
} else {
  console.error(`
Error: Unknown command '${command}'
Please use 'server' or 'runner' as the command.
`);
  process.exit(1);
} 