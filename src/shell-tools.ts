import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Minimal starter blocklist. Extend deliberately - don't let this grow by
// accident. The point is to block obviously destructive/irreversible
// commands, not to sandbox everything (that's the container's job).
const BLOCKED_PATTERNS = [/\brm\s+-rf\s+\/(\s|$)/, /\bmkfs\b/, /\bdd\s+.*of=\/dev\//, /:\(\)\{.*\};:/];

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
