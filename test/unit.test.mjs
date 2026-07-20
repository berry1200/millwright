// Tier-1 unit tests: pure logic only, NO Docker and NO ROS - runnable on any
// machine or CI runner. Uses the built-in node:test runner (no dependency).
// Run with `npm test`. Docker/ROS behavior is covered by the harness runners
// (npm run test:sandbox / test:ros), which need their environments.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { isCommandBlocked, truncateOutput } from "../dist/shell-tools.js";
import { patchFile } from "../dist/file-tools.js";
import { isDangerousWorkspaceRoot } from "../dist/sandbox.js";

test("blocklist blocks catastrophic rm/mkfs/dd/forkbomb", () => {
  for (const c of [
    "rm -rf /",
    "rm -rf ~",
    "rm -r -f ~",
    "rm -rf $HOME",
    "rm -rf /*",
    "rm -rf /home",
    "sudo rm --recursive --force /",
    "rm -rf / --no-preserve-root",
    "mkfs.ext4 /dev/sda",
    "dd if=/dev/zero of=/dev/sda",
    ":(){ :|:& };:",
  ]) {
    assert.ok(isCommandBlocked(c), `should block: ${c}`);
  }
});

test("blocklist allows normal commands (no false positives)", () => {
  for (const c of [
    "ls -la",
    "rm file.txt",
    "rm -rf ./build",
    "rm -rf /tmp/foo",
    "rm -rf dist node_modules",
    "echo ~ is home",
    "npm run build",
    "git clean -n",
  ]) {
    assert.equal(isCommandBlocked(c), null, `should allow: ${c}`);
  }
});

test("truncateOutput keeps short output, truncates long with a marker", () => {
  assert.equal(truncateOutput("a\nb\nc"), "a\nb\nc");
  const long = Array.from({ length: 500 }, (_, i) => `line${i}`).join("\n");
  const out = truncateOutput(long);
  assert.ok(out.includes("lines truncated"), "has truncation marker");
  assert.ok(out.split("\n").length < 500, "is shorter than input");
});

test("isDangerousWorkspaceRoot: refuses fs/drive/home roots", () => {
  for (const p of ["/", "/home", "/home/", "/home/berry_james", "/root", "/mnt", "/mnt/c", "/mnt/d", "/usr", "/tmp"]) {
    assert.ok(isDangerousWorkspaceRoot(p), `should be dangerous: ${p}`);
  }
});

test("isDangerousWorkspaceRoot: allows real project dirs", () => {
  for (const p of ["/home/berry_james/projects", "/home/berry_james/projects/millwright", "/mnt/c/Users/me/proj", "/tmp/my_ws"]) {
    assert.equal(isDangerousWorkspaceRoot(p), false, `should be allowed: ${p}`);
  }
});

test("patchFile: applies a unique match and rejects zero/ambiguous/$-expansion", async () => {
  // sandbox_mode unset here -> no workspace allowlist, pure file logic.
  const dir = mkdtempSync(path.join(tmpdir(), "mw-unit-"));
  try {
    const f = path.join(dir, "f.txt");
    writeFileSync(f, "alpha\nSECRET = 123\nomega\nSECRET = 123\n");

    // ambiguous (2 matches) without replace_all -> refused, file unchanged
    const before = readFileSync(f, "utf8");
    const amb = await patchFile(f, "SECRET = 123", "SECRET = 999");
    assert.equal(amb.applied, false);
    assert.equal(readFileSync(f, "utf8"), before);

    // replace_all -> both replaced
    const all = await patchFile(f, "SECRET = 123", "SECRET = 999", { replaceAll: true });
    assert.equal(all.applied, true);
    assert.equal(all.replacements, 2);

    // not found -> refused
    const nf = await patchFile(f, "does-not-exist", "x");
    assert.equal(nf.applied, false);

    // $-sequences inserted literally (no regex expansion)
    writeFileSync(f, "total = PRICE;\n");
    await patchFile(f, "PRICE", "$5 & $10 [$& $1]");
    assert.ok(readFileSync(f, "utf8").includes("$5 & $10 [$& $1]"));

    // missing file -> refused, no throw
    const miss = await patchFile(path.join(dir, "nope.txt"), "a", "b");
    assert.equal(miss.applied, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- sandbox allowlist (subprocess probes) ---------------------------------
// WORKSPACE_DIR / SANDBOX_MODE are read at module load, so each combination
// runs in a child process with its own env rather than in-process.
// ROS_SETUP_SCRIPT is force-cleared so the root-build probe can never reach a
// real docker build on a machine where both happen to be configured.
function probeModule(env, file, expr) {
  const url = pathToFileURL(path.join(process.cwd(), "dist", file)).href;
  const script = `const m = await import(${JSON.stringify(url)}); const r = await (${expr}); console.log("__R__" + JSON.stringify(r));`;
  const p = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, ROS_SETUP_SCRIPT: "", ...env },
    encoding: "utf8",
    timeout: 30000,
  });
  const line = (p.stdout || "").split("\n").find((l) => l.startsWith("__R__"));
  assert.ok(line, `probe produced no result (stderr: ${p.stderr})`);
  return JSON.parse(line.slice(5));
}

test("isInsideWorkspace: inside ok, outside refused, root refused unless allowRoot", () => {
  const ws = mkdtempSync(path.join(tmpdir(), "mw-ws-"));
  const outside = mkdtempSync(path.join(tmpdir(), "mw-out-"));
  const env = { SANDBOX_MODE: "docker", WORKSPACE_DIR: ws };
  try {
    const inside = probeModule(env, "sandbox.js",
      `m.isInsideWorkspace(${JSON.stringify(path.join(ws, "f.txt"))})`);
    assert.equal(inside.ok, true);

    const out = probeModule(env, "sandbox.js",
      `m.isInsideWorkspace(${JSON.stringify(path.join(outside, "f.txt"))})`);
    assert.equal(out.ok, false);
    assert.match(out.reason, /outside the configured workspace/);

    const root = probeModule(env, "sandbox.js", `m.isInsideWorkspace(${JSON.stringify(ws)})`);
    assert.equal(root.ok, false);
    assert.match(root.reason, /ROOT/);

    const rootAllowed = probeModule(env, "sandbox.js",
      `m.isInsideWorkspace(${JSON.stringify(ws)}, { allowRoot: true })`);
    assert.equal(rootAllowed.ok, true);
  } finally {
    rmSync(ws, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("buildRosWorkspace: sandboxed build refuses workspace_path outside the workspace, admits the root", () => {
  const ws = mkdtempSync(path.join(tmpdir(), "mw-bws-"));
  const outside = mkdtempSync(path.join(tmpdir(), "mw-bout-"));
  const env = { SANDBOX_MODE: "docker", WORKSPACE_DIR: ws };
  try {
    const refused = probeModule(env, "ros-tools.js",
      `m.buildRosWorkspace(${JSON.stringify(outside)})`);
    assert.equal(refused.workspace_refused, true, `expected gate refusal, got: ${JSON.stringify(refused)}`);
    assert.match(refused.reason, /outside the configured workspace/);

    // The workspace root itself is the normal colcon operand: it must pass
    // the containment gate. Whatever fails LATER (no Docker on this machine,
    // no ros_setup_script) is fine - it just must not be the gate.
    const rootBuild = probeModule(env, "ros-tools.js",
      `m.buildRosWorkspace(${JSON.stringify(ws)})`);
    assert.notEqual(rootBuild.workspace_refused, true, `root build hit the gate: ${JSON.stringify(rootBuild)}`);
  } finally {
    rmSync(ws, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
