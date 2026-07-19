import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { readdirSync, existsSync } from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);

// ---- configuration (MCPB user_config -> env; see docs/sandboxing.md) -------
// SANDBOX_MODE: "docker" (default) | "off". Default-on is deliberate: the
// one-click MCPB audience is exactly who won't audit what they install.
// WORKBENCH_NETWORK: "all" (default) | "none" - the toggle ships ahead of a
// deny-by-default future so the config surface doesn't change later.
// WORKSPACE_DIR: bind-mounted into containers at the same absolute path and
// used as patch_file's allowlist root - one mental model, one folder.
const SANDBOX_MODE = (process.env.SANDBOX_MODE || "docker").toLowerCase();
const WORKBENCH_NETWORK = process.env.WORKBENCH_NETWORK === "none" ? "none" : "all";
const RAW_WORKSPACE_DIR = process.env.WORKSPACE_DIR || undefined;
const WSL_DISTRO = process.env.ROS_WSL_DISTRO || "Ubuntu";
const IS_WINDOWS = process.platform === "win32";

// v1 resource limits (decision: one flag each). --pids-limit also makes the
// blocklist's fork-bomb regex redundant whenever the sandbox is active.
const WORKBENCH_IMAGE = "ubuntu:24.04";
const MEMORY_LIMIT = "2g";
const BUILD_MEMORY_LIMIT = "4g";
const PIDS_LIMIT = "512";

export function sandboxEnabled(): boolean {
  return SANDBOX_MODE !== "off";
}

export const SANDBOX_UNAVAILABLE_MSG =
  "Sandboxing is on (sandbox_mode=docker, the default) but Docker is not reachable. " +
  "Two ways forward: (1) install/start Docker (on Windows: Docker Desktop with WSL " +
  "integration for your distro), or (2) explicitly set sandbox_mode to 'off' in the " +
  "extension settings (SANDBOX_MODE env) - commands will then run directly on your " +
  "machine with no isolation. There is deliberately no silent fallback.";

/** On Windows the server runs Windows-side but Docker + the workspace live in
 * WSL, so docker commands are routed through the distro (mounts then use WSL
 * paths natively). On POSIX hosts the docker CLI is used directly. */
export function dockerInvocation(dockerArgs: string[]): { cmd: string; args: string[] } {
  return IS_WINDOWS
    ? { cmd: "wsl.exe", args: ["-d", WSL_DISTRO, "-e", "docker", ...dockerArgs] }
    : { cmd: "docker", args: dockerArgs };
}

/** A Windows file picker hands back \\wsl.localhost\<distro>\home\x for a WSL
 * directory; docker (running inside WSL) needs /home/x. Accept both. */
export function workspaceMountPath(): string | undefined {
  if (!RAW_WORKSPACE_DIR) return undefined;
  const unc = RAW_WORKSPACE_DIR.match(/^\\\\wsl(?:\.localhost|\$)\\[^\\]+(\\.*)$/i);
  if (unc) return unc[1].replace(/\\/g, "/");
  return RAW_WORKSPACE_DIR;
}

let dockerAvailableCache: boolean | null = null;

export async function isDockerAvailable(): Promise<boolean> {
  if (dockerAvailableCache !== null) return dockerAvailableCache;
  try {
    const inv = dockerInvocation(["version", "--format", "{{.Server.Version}}"]);
    const { stdout } = await execFileAsync(inv.cmd, inv.args, { timeout: 10000 });
    dockerAvailableCache = /\d/.test(stdout);
  } catch {
    dockerAvailableCache = false;
  }
  return dockerAvailableCache;
}

// ---- workbench: one long-lived container per server session ----------------

// One label per server process: lets the exit sweep remove anything this
// session created (a SIGKILLed docker-run client strands its container).
const SESSION_LABEL = `millwright-session=${randomUUID().slice(0, 12)}`;

const workbenchName = `millwright-workbench-${randomUUID().slice(0, 8)}`;
let workbenchStarted = false;

export type SandboxGate = { ok: true; container: string } | { ok: false; message: string };

/** Lazily creates (or verifies) the session's workbench container. */
export async function ensureWorkbench(): Promise<SandboxGate> {
  if (!(await isDockerAvailable())) return { ok: false, message: SANDBOX_UNAVAILABLE_MSG };
  if (workbenchStarted) {
    try {
      const inv = dockerInvocation(["inspect", "-f", "{{.State.Running}}", workbenchName]);
      const { stdout } = await execFileAsync(inv.cmd, inv.args, { timeout: 10000 });
      if (stdout.trim() === "true") return { ok: true, container: workbenchName };
    } catch {
      // fall through and recreate
    }
    workbenchStarted = false;
  }
  const ws = workspaceMountPath();
  const runArgs = [
    "run", "-d",
    "--init", // tini as PID 1: reaps zombies left by finished exec sessions
    "--name", workbenchName,
    "--label", SESSION_LABEL,
    "--memory", MEMORY_LIMIT,
    "--pids-limit", PIDS_LIMIT,
    ...(WORKBENCH_NETWORK === "none" ? ["--network", "none"] : []),
    ...(ws ? ["-v", `${ws}:${ws}`] : []),
    WORKBENCH_IMAGE,
    "sleep", "infinity",
  ];
  try {
    const inv = dockerInvocation(runArgs);
    await execFileAsync(inv.cmd, inv.args, { timeout: 120000 });
    workbenchStarted = true;
    return { ok: true, container: workbenchName };
  } catch (err: any) {
    return {
      ok: false,
      message:
        `Could not start the sandbox workbench container (${WORKBENCH_IMAGE}): ` +
        `${(err.stderr || err.message || "").toString().trim().slice(0, 500)}`,
    };
  }
}

/** Bounded exec inside the workbench. The inner `timeout` (coreutils) is the
 * real enforcement: killing the docker-exec CLIENT on a timeout would leave
 * the inner process running, so the container-side timeout does the killing
 * and the client is given a small grace on top. Exit 124 = timed out. */
export function workbenchExecInvocation(
  container: string,
  command: string,
  timeoutMs: number,
  cwd?: string
): { cmd: string; args: string[]; clientTimeoutMs: number } {
  const secs = Math.max(1, Math.ceil(timeoutMs / 1000));
  const args = [
    "exec",
    ...(cwd ? ["-w", cwd] : []),
    container,
    "timeout", "-k", "5", `${secs}s`,
    "bash", "-lc", command,
  ];
  const inv = dockerInvocation(args);
  return { cmd: inv.cmd, args: inv.args, clientTimeoutMs: timeoutMs + 10000 };
}

/** Background jobs run as their own attached `docker run` (no -d): the client
 * process streams logs and forwards SIGINT to the container (--sig-proxy
 * default), so JobManager's spawn/log/stop semantics carry over unchanged.
 * Signal forwarding is NOT sufficient on its own - a PID-1 bash ignores
 * SIGINT (observed live in validation), so JobManager also force-removes the
 * container by name on stop, and the exit sweep catches anything stranded. */
export function jobRunInvocation(
  executable: string,
  args: string[]
): { cmd: string; args: string[]; containerName: string } {
  const ws = workspaceMountPath();
  const containerName = `millwright-job-${randomUUID().slice(0, 8)}`;
  const inv = dockerInvocation([
    "run", "--rm",
    "--init", // tini forwards signals to the real command and reaps zombies
    "--name", containerName,
    "--label", SESSION_LABEL,
    "--memory", MEMORY_LIMIT,
    "--pids-limit", PIDS_LIMIT,
    ...(WORKBENCH_NETWORK === "none" ? ["--network", "none"] : []),
    ...(ws ? ["-v", `${ws}:${ws}`, "-w", ws] : []),
    WORKBENCH_IMAGE,
    executable, ...args,
  ]);
  return { ...inv, containerName };
}

/** Build-lane container (Linux hosts): official OSRF image for the user's
 * distro, workspace mounted at the identical path, and ALWAYS --network=none -
 * builds need the ROS install and the workspace, not DDS or the internet. */
export function buildRunInvocation(
  distro: string,
  workspacePath: string,
  colconArgs: string[]
): { cmd: string; args: string[]; containerName: string } {
  const containerName = `millwright-build-${randomUUID().slice(0, 8)}`;
  // Build as the HOST user, not root: otherwise build/install/log artifacts
  // land root-owned in the mounted workspace and the user can't delete their
  // own files (hit live in validation: EACCES on build/COLCON_IGNORE).
  // colcon logs under the workspace, so no root-owned $HOME is needed.
  // (POSIX-only API is fine here - Windows builds never take this path.)
  const uidGid = typeof process.getuid === "function" ? `${process.getuid()}:${process.getgid!()}` : undefined;
  const inv = dockerInvocation([
    "run", "--rm",
    "--init",
    "--name", containerName,
    "--label", SESSION_LABEL,
    "--network", "none",
    "--memory", BUILD_MEMORY_LIMIT,
    "--pids-limit", PIDS_LIMIT,
    ...(uidGid ? ["--user", uidGid, "-e", "HOME=/tmp"] : []),
    "-v", `${workspacePath}:${workspacePath}`,
    "-w", workspacePath,
    `ros:${distro}-ros-base`,
    "bash", "-c", 'source "$0" >/dev/null 2>&1; exec "$@"',
    `/opt/ros/${distro}/setup.bash`,
    "colcon", ...colconArgs,
  ]);
  return { ...inv, containerName };
}

/** Force-remove a named container (used when a build's client times out). */
export function forceRemoveContainer(name: string): void {
  const inv = dockerInvocation(["rm", "-f", name]);
  try {
    execFile(inv.cmd, inv.args, { timeout: 15000 }, () => {});
  } catch {
    // best effort
  }
}

// ---- patch_file / create_ros_package allowlist -----------------------------

export const WORKSPACE_REQUIRED_MSG =
  "Sandboxing is on, so file edits are restricted to the configured workspace - but no " +
  "workspace_dir is set. Set workspace_dir in the extension settings (WORKSPACE_DIR env), " +
  "or set sandbox_mode to 'off' to edit files anywhere.";

/** Checks containment against the workspace root, symlink-resolved. On
 * Windows both the UNC form (\\wsl.localhost\...) and the raw configured form
 * are valid roots, since the model may address WSL files either way. */
export async function isInsideWorkspace(candidate: string): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  if (!RAW_WORKSPACE_DIR) return { ok: false, reason: WORKSPACE_REQUIRED_MSG };
  const roots = [RAW_WORKSPACE_DIR];
  const posix = workspaceMountPath();
  if (IS_WINDOWS && posix && posix !== RAW_WORKSPACE_DIR) {
    roots.push(`\\\\wsl.localhost\\${WSL_DISTRO}${posix.replace(/\//g, "\\")}`);
  } else if (IS_WINDOWS && RAW_WORKSPACE_DIR.startsWith("/")) {
    roots.push(`\\\\wsl.localhost\\${WSL_DISTRO}${RAW_WORKSPACE_DIR.replace(/\//g, "\\")}`);
  }
  let real: string;
  try {
    real = await realpath(candidate);
  } catch (err: any) {
    if (err.code === "ENOENT") {
      // Target doesn't exist yet (e.g. create_ros_package dest): containment
      // is judged on the nearest existing ancestor instead.
      try {
        real = path.join(await realpath(path.dirname(candidate)), path.basename(candidate));
      } catch {
        return { ok: false, reason: `path not found: ${candidate}` };
      }
    } else {
      return { ok: false, reason: `could not resolve ${candidate}: ${err.message}` };
    }
  }
  const norm = (p: string) => (IS_WINDOWS ? p.toLowerCase() : p);
  for (const root of roots) {
    try {
      const rootReal = await realpath(root);
      if (norm(real) === norm(rootReal)) {
        // GUARD (incident 2026-07-19): the workspace ROOT directory itself is
        // never an operable target - Millwright acts only on paths strictly
        // BENEATH it, and never edits or removes the workspace directory.
        return {
          ok: false,
          reason:
            `refused: '${candidate}' resolves to the workspace ROOT itself. Millwright only ` +
            `operates on paths strictly beneath the workspace, never on the root directory.`,
        };
      }
      if (norm(real).startsWith(norm(rootReal + path.sep))) {
        return { ok: true };
      }
    } catch {
      // root form not resolvable on this host - try the next
    }
  }
  return {
    ok: false,
    reason:
      `refused: '${candidate}' is outside the configured workspace (${RAW_WORKSPACE_DIR}). ` +
      `The sandbox restricts edits to the workspace; set sandbox_mode to 'off' to lift this.`,
  };
}

// ---- blast-radius guard ----------------------------------------------------

let scopeWarningCache: string | null | undefined;

/**
 * Non-fatal warning when `workspace_dir` is dangerously BROAD (incident
 * 2026-07-19: it was set to `~/projects`, the parent of every project). Because
 * the workspace is bind-mounted into the sandbox and bind mounts are
 * pass-through, a single destructive command inside the container hits real
 * host files across EVERY project under the mount - and the blocklist only
 * guards top-level paths, not `rm -rf <workspace>/<some_project>`. Scoping
 * `workspace_dir` to a single project is the real mitigation; this surfaces the
 * risk in tool results. Cached (one filesystem probe per process).
 */
export function workspaceScopeWarning(): string | null {
  if (scopeWarningCache !== undefined) return scopeWarningCache;
  scopeWarningCache = null;
  if (!sandboxEnabled() || !RAW_WORKSPACE_DIR) return scopeWarningCache;
  const posix = workspaceMountPath() || RAW_WORKSPACE_DIR;
  const broad = ["/", "/home", "/root", "/mnt", "/mnt/c", "/tmp", "/usr", "/var"];
  if (broad.includes(posix)) {
    scopeWarningCache =
      `workspace_dir is '${posix}', a very broad location. Everything under it is writable ` +
      `inside the sandbox; scope workspace_dir to a single project directory.`;
    return scopeWarningCache;
  }
  // Parent-of-many-repos: if the workspace directly contains >=2 independent
  // git repos, it's almost certainly a projects-parent, not a single project.
  try {
    const kids = readdirSync(RAW_WORKSPACE_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
    const repos = kids.filter((d) => existsSync(path.join(RAW_WORKSPACE_DIR, d.name, ".git"))).length;
    if (repos >= 2) {
      scopeWarningCache =
        `workspace_dir '${posix}' contains ${repos} separate git repositories - it looks like a ` +
        `parent of multiple projects, not one project. A destructive command inside the sandbox ` +
        `would reach ALL of them (bind mounts are pass-through). Strongly recommend scoping ` +
        `workspace_dir to a single project directory to limit blast radius.`;
    }
  } catch {
    // unreadable workspace - nothing to warn about here
  }
  return scopeWarningCache;
}

// ---- cleanup ---------------------------------------------------------------

function cleanupSync(): void {
  // Sweep everything this session created (workbench + any stranded job
  // containers) by session label. Best effort - anything missed remains
  // visible in `docker ps -a` under the millwright- name prefix.
  try {
    const list = dockerInvocation(["ps", "-aq", "--filter", `label=${SESSION_LABEL}`]);
    const res = spawnSync(list.cmd, list.args, { timeout: 15000, encoding: "utf8" });
    const ids = (res.stdout || "").split("\n").map((s) => s.trim()).filter(Boolean);
    if (ids.length) {
      const rm = dockerInvocation(["rm", "-f", ...ids]);
      spawnSync(rm.cmd, rm.args, { timeout: 20000 });
    }
  } catch {
    // best effort
  }
}

process.on("exit", cleanupSync);
process.on("SIGINT", () => { cleanupSync(); process.exit(130); });
process.on("SIGTERM", () => { cleanupSync(); process.exit(143); });
