#!/usr/bin/env node
import { startHubServer } from "./hub_server.js";
import { startConnectedNode, startNodeServer } from "./node_server.js";

const args = process.argv.slice(2);
const command = args.shift() || "help";

try {
  if (command === "hub") {
    const options = parseOptions(args, { host: "127.0.0.1", port: "8090" });
    startHubServer({ host: options.host, port: Number(options.port) });
  } else if (command === "node") {
    const options = parseOptions(args, { host: "127.0.0.1", port: "8091", connect: "", name: "" });
    if (options.connect) {
      await startConnectedNode({ hub: options.connect, name: options.name });
    } else {
      startNodeServer({ host: options.host, port: Number(options.port) });
    }
  } else if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
  } else {
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
}

function parseOptions(values, defaults) {
  const options = { ...defaults };
  for (let index = 0; index < values.length; index += 1) {
    const item = values[index];
    if (item === "--host") options.host = values[++index];
    else if (item === "--port") options.port = values[++index];
    else if (item === "--connect") options.connect = values[++index];
    else if (item === "--name") options.name = values[++index];
    else throw new Error(`Unknown option: ${item}`);
  }
  return options;
}

function printHelp() {
  console.log(`tmuxfleet

Usage:
  node src/cli.js hub  --host 127.0.0.1 --port 8090
  node src/cli.js node --host 127.0.0.1 --port 8091
  node src/cli.js node --connect http://hub.example.com:8090 --name devbox

Environment:
  TMUXFLEET_HUB_TOKEN   Browser -> Hub auth token
  TMUXFLEET_NODE_TOKEN  Hub -> Node auth token
  TMUXFLEET_STATE_DIR   Optional state directory for nodes.json
`);
}
