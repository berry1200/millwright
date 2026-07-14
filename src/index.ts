#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.js";

async function main() {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("linux-ros-mcp-bridge running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting server:", err);
  process.exit(1);
});
