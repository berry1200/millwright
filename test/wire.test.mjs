// Tier-1 wire tests: spawn the BUILT server, run a real MCP handshake, and
// assert the live surface. This is the permanent form of the 0.5.0 rename gates
// - it catches (a) server.tool() names drifting from the manifest, and (b) a
// tool result losing its millwright_version. No Docker or ROS needed: tools/list
// and job_list answer with SANDBOX_MODE=off, so this runs on any CI runner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const SERVER = path.join(process.cwd(), "dist", "index.js");

/** Spawn the server, complete the handshake, issue `requests`, and resolve a
 * map of id -> result. Always kills the server. Rejects on timeout so a hang
 * fails loudly instead of stalling CI. */
function rpc(requests, { timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const srv = spawn(process.execPath, [SERVER], {
      env: { ...process.env, SANDBOX_MODE: "off" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const results = {};
    const wanted = new Set(requests.map((r) => r.id));
    let buf = "";
    const timer = setTimeout(() => {
      srv.kill();
      reject(new Error(`rpc timeout; received ids [${Object.keys(results)}]`));
    }, timeoutMs);
    srv.stdout.on("data", (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let m;
        try { m = JSON.parse(line); } catch { continue; }
        if (m.id != null && wanted.has(m.id)) {
          results[m.id] = m.result ?? m.error;
          wanted.delete(m.id);
          if (wanted.size === 0) {
            clearTimeout(timer);
            srv.kill();
            resolve(results);
          }
        }
      }
    });
    srv.on("error", (e) => { clearTimeout(timer); reject(e); });
    srv.stdin.write(JSON.stringify({
      jsonrpc: "2.0", id: 0, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "wire-test", version: "1" } },
    }) + "\n");
    // Send the notification + requests after initialize is on the wire.
    setTimeout(() => {
      srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
      for (const r of requests) srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...r }) + "\n");
    }, 300);
  });
}

test("wire: tools/list matches manifest tools[] exactly (catches rename drift)", async () => {
  const manifest = JSON.parse(readFileSync(path.join(process.cwd(), "manifest.json"), "utf8"));
  const manifestNames = manifest.tools.map((t) => t.name).sort();
  const res = await rpc([{ id: 1, method: "tools/list" }]);
  const liveNames = res[1].tools.map((t) => t.name).sort();
  assert.equal(liveNames.length, 13, `expected 13 tools, got ${liveNames.length}`);
  assert.deepEqual(liveNames, manifestNames, "server tools/list must equal manifest tools[] (a partial rename drifts here)");
});

test("wire: every tool result carries millwright_version matching package.json", async () => {
  const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
  const res = await rpc([{ id: 2, method: "tools/call", params: { name: "job_list", arguments: {} } }]);
  const text = res[2].content[0].text;
  assert.match(text, new RegExp(`"millwright_version":\\s*"${pkg.version.replace(/\./g, "\\.")}"`),
    `result must carry millwright_version=${pkg.version} (server.ts VERSION and package.json must agree)`);
});
