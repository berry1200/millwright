#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer, VERSION } from "./server.js";
import { sandboxStartupLine } from "./sandbox.js";

async function main() {
  const server = buildServer();
  // clientInfo (name/version) is self-reported and arrives with `initialize`.
  // Log it for DIAGNOSTICS ONLY (which client/surface connected). It is
  // spoofable, so it must never influence the sandbox or any safety decision —
  // those stay config-driven (SANDBOX_MODE). Ergonomics, never gating.
  server.server.oninitialized = () => {
    const ci = server.server.getClientVersion();
    console.error(`millwright client: ${ci ? `${ci.name}/${ci.version ?? "?"}` : "unknown"}`);
  };
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(sandboxStartupLine(VERSION));
}

main().catch((err) => {
  console.error("Fatal error starting server:", err);
  process.exit(1);
});
