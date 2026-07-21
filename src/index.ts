#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer, VERSION } from "./server.js";
import { sandboxStartupLine } from "./sandbox.js";

async function main() {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(sandboxStartupLine(VERSION));
}

main().catch((err) => {
  console.error("Fatal error starting server:", err);
  process.exit(1);
});
