const { spawn } = require("child_process");

try {
  // Start the server in the background
  const server = spawn("node", ["index.js"], {
    stdio: "inherit",
  });

  // Start the tunnel in parallel
  const tunnel = spawn("npx", [
    "hmd-tunnel",
    "runner",
    "--server",
    "ws://140.245.27.200:8001",
    "--port",
    "3000",
    "--remote-port",
    "8080"
  ]);

  // Handle tunnel output in realtime
  tunnel.stdout.on("data", (data) => {
    // Log to console
    process.stdout.write(data);
  });

  // Handle errors for both processes
  server.on("error", (error) => {
    console.error("Error starting server:", error);
    process.exit(1);
  });

  tunnel.on("error", (error) => {
    console.error("Error establishing tunnel:", error);
    process.exit(1);
  });
} catch (error) {
  console.error("Error:", error);
  process.exit(1);
}
