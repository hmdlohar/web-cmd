const { spawn } = require("child_process");
const fs = require("fs");

try {
  // Start the server in the background
  const server = spawn("node", ["index.js"], {
    stdio: "inherit",
  });

  // Start the SSH tunnel in parallel
  const tunnel = spawn("ssh", [
    "-o",
    "StrictHostKeyChecking=no",
    "-p",
    "443",
    "-R0:localhost:3000",
    "qr@a.pinggy.io",
  ]);

  // Handle tunnel output in realtime
  tunnel.stdout.on("data", (data) => {
    // Write data to ping.txt as it comes in
    fs.promises
      .appendFile("ping.txt", data)
      .catch((err) => console.error("Error writing to ping.txt:", err));
    // Also log to console
    process.stdout.write(data);
  });

  // Handle errors for both processes
  server.on("error", (error) => {
    console.error("Error starting server:", error);
    process.exit(1);
  });

  tunnel.on("error", (error) => {
    console.error("Error establishing SSH tunnel:", error);
    process.exit(1);
  });
} catch (error) {
  console.error("Error:", error);
  process.exit(1);
}
