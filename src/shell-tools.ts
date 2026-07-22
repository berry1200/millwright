import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  sandboxEnabled,
  ensureWorkbench,
  workbenchExecInvocation,
  workspaceScopeWarning,
  workspaceHardRefusal,
} from "./sandbox.js";

const execFileAsync = promisify(execFile);

// STOPGAP, not a defense. This blocklist only catches the most catastrophic
// obvious patterns; it is trivially bypassable by design (e.g. `cd / && rm
// -rf .`, variables, base64 | sh) and no amount of regex will change that.
// The real defense is the Docker sandbox (roadmap; see docs/sandboxing.md) -
// do NOT keep growing this list in pursuit of completeness.
const BLOCKED_PATTERNS = [
  // rm with any flags aimed at /, /*, ~, ~/, $HOME, or /home - catches the
  // separated-flags forms (`rm -r -f ~`) too, since flags are matched as a
  // repeated group rather than one literal `-rf`.
  /\brm\s+(?:-{1,2}[\w-]+\s+)*["']?(?:\/\*?|~\/?|\$HOME\b\/?|\/home\/?\*?)["']?\s*(?:\s|$|;|&|\|)/,
  /--no-preserve-root/,
  /\bmkfs\b/,
  /\bdd\s+.*of=\/dev\//,
  /:\(\)\{.*\};:/,
];

const MAX_OUTPUT_LINES = 200;

export function isCommandBlocked(command: string): string | null {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) return `Command matches blocked pattern: ${pattern}`;
  }
  return null;
}

// Surfaced as MCPB user_config (shell_bin) because "bash" was a buried
// hardcoded assumption - e.g. a Windows host may want Git Bash's full path.
const SHELL_BIN = process.env.SHELL_BIN || "bash";

export async function runCommand(command: string, timeoutMs = 30000, cwd?: string) {
  const blocked = isCommandBlocked(command);
  if (blocked) return { blocked: true, reason: blocked };

  // Sandbox lane (default): execute inside the session's workbench container.
  // Fails CLOSED with guidance when Docker is unavailable - no silent
  // fallthrough to unsandboxed execution (see docs/sandboxing.md).
  if (sandboxEnabled()) {
    const refusal = workspaceHardRefusal();
    if (refusal) return { blocked: false, workspace_refused: true, message: refusal };
    const gate = await ensureWorkbench();
    if (!gate.ok) return { blocked: false, sandbox_available: false, message: gate.message };
    const warn = workspaceScopeWarning();
    const inv = workbenchExecInvocation(gate.container, command, timeoutMs, cwd);
    try {
      const { stdout, stderr } = await execFileAsync(inv.cmd, inv.args, {
        timeout: inv.clientTimeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      });
      return {
        blocked: false,
        sandboxed: true,
        ...(warn ? { workspace_warning: warn } : {}),
        exitCode: 0,
        stdout: truncateOutput(stdout),
        stderr: truncateOutput(stderr),
      };
    } catch (err: any) {
      // Exit 124 = the container-side coreutils `timeout` fired. That inner
      // timeout is the real enforcement - killing only the docker-exec client
      // would leave the process running inside the container.
      return {
        blocked: false,
        sandboxed: true,
        ...(warn ? { workspace_warning: warn } : {}),
        exitCode: err.code ?? 1,
        stdout: truncateOutput(err.stdout ?? ""),
        stderr: truncateOutput(err.stderr ?? err.message),
        timedOut: err.code === 124 || Boolean(err.killed),
      };
    }
  }

  try {
    const { stdout, stderr } = await execFileAsync(SHELL_BIN, ["-lc", command], {
      timeout: timeoutMs,
      cwd,
      maxBuffer: 10 * 1024 * 1024,
    });
    return {
      blocked: false,
      exitCode: 0,
      stdout: truncateOutput(stdout),
      stderr: truncateOutput(stderr),
    };
  } catch (err: any) {
    // Shell binary itself missing (e.g. Windows without Git Bash/WSL): degrade
    // with an actionable message, like the ROS tools do, instead of a raw ENOENT.
    if (err.code === "ENOENT") {
      return {
        blocked: false,
        shell_available: false,
        message:
          `Shell '${SHELL_BIN}' was not found on this system, so workbench_shell (and background ` +
          `jobs using it) cannot work. Install a POSIX shell - on Windows, Git Bash or WSL - ` +
          `or set the shell_bin setting (SHELL_BIN env var) to a full path, e.g. ` +
          `C:\\Program Files\\Git\\bin\\bash.exe. ROS and file tools are unaffected.`,
      };
    }
    return {
      blocked: false,
      exitCode: err.code ?? 1,
      stdout: truncateOutput(err.stdout ?? ""),
      stderr: truncateOutput(err.stderr ?? err.message),
      timedOut: Boolean(err.killed),
    };
  }
}

export function truncateOutput(output: string): string {
  const lines = output.split("\n");
  if (lines.length <= MAX_OUTPUT_LINES) return output;
  const head = lines.slice(0, MAX_OUTPUT_LINES / 2);
  const tail = lines.slice(-MAX_OUTPUT_LINES / 2);
  return [...head, `... [${lines.length - MAX_OUTPUT_LINES} lines truncated] ...`, ...tail].join("\n");
}
