import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir } from "node:fs/promises";
import { jobManager } from "./job-manager.js";
import { truncateOutput } from "./shell-tools.js";
import {
  sandboxEnabled,
  isDockerAvailable,
  isInsideWorkspace,
  buildRunInvocation,
  forceRemoveContainer,
  SANDBOX_UNAVAILABLE_MSG,
  workspaceHardRefusal,
  workspaceScopeWarning,
} from "./sandbox.js";

const execFileAsync = promisify(execFile);

// ---- environment adaptation (surfaced as MCPB user_config) -----------------
// An MCP client like Claude Desktop spawns this server WITHOUT a ROS-sourced
// shell, so "ros2 is on PATH" - previously a buried assumption - is now
// explicit config. Empty string counts as unset (Desktop substitutes "" when
// an optional field is left blank).
const ROS_SETUP_SCRIPT = process.env.ROS_SETUP_SCRIPT || undefined;
const ROS_WSL_DISTRO = process.env.ROS_WSL_DISTRO || "Ubuntu";
const IS_WINDOWS = process.platform === "win32";

/** True when ROS commands run through the sourcing wrapper below (and thus
 * cwd/mkdir must happen inside the wrapper script, not via Node - a WSL path
 * like /home/... means nothing to a Windows-side Node process). */
const rosWrapperActive = Boolean(ROS_SETUP_SCRIPT);

interface RosInvocation {
  cmd: string;
  args: string[];
}

/** Builds the real process invocation for a ros2/colcon command:
 * - ROS_SETUP_SCRIPT unset: run directly (server was started from a
 *   ROS-sourced shell, e.g. a manually configured Linux setup). Unchanged
 *   legacy behavior.
 * - Set, POSIX host: `bash -c` wrapper that sources the script first.
 * - Set, Windows host: same wrapper routed into WSL via `wsl.exe -d <distro>`
 *   (the documented dev environment is Windows 11 + ROS inside WSL2).
 * The wrapper uses bash positional params ($0 = setup script, then optional
 * cwd/mkdir dir, then the command) so no value is ever spliced into shell
 * source - topic names, paths etc. can't break quoting. */
function rosInvocation(argv: string[], opts: { cwd?: string; mkdir?: string } = {}): RosInvocation {
  if (!ROS_SETUP_SCRIPT) return { cmd: argv[0], args: argv.slice(1) };
  let script = 'source "$0" >/dev/null 2>&1; ';
  const params: string[] = [ROS_SETUP_SCRIPT];
  if (opts.mkdir) {
    script += 'mkdir -p "$1" || exit 1; shift; ';
    params.push(opts.mkdir);
  } else if (opts.cwd) {
    script += 'cd "$1" || exit 1; shift; ';
    params.push(opts.cwd);
  }
  script += 'exec "$@"';
  const bashArgs = ["-c", script, ...params, ...argv];
  return IS_WINDOWS
    ? { cmd: "wsl.exe", args: ["-d", ROS_WSL_DISTRO, "-e", "bash", ...bashArgs] }
    : { cmd: "bash", args: bashArgs };
}

let ros2AvailableCache: boolean | null = null;

/** Checked lazily and cached - ROS may not be installed (fine, most tools
 * should say so clearly instead of throwing a raw ENOENT). */
export async function isRos2Available(): Promise<boolean> {
  if (ros2AvailableCache !== null) return ros2AvailableCache;
  try {
    const inv = rosInvocation(["ros2", "--help"]);
    // 8s: generous because the sourcing wrapper (and wsl.exe on Windows) adds
    // startup cost on top of the ros2 CLI's own.
    await execFileAsync(inv.cmd, inv.args, { timeout: 8000 });
    ros2AvailableCache = true;
  } catch {
    ros2AvailableCache = false;
  }
  return ros2AvailableCache;
}

const ROS_NOT_AVAILABLE_MSG =
  "ros2 CLI not found. Either start this server from a ROS-sourced shell, or set the " +
  "ros_setup_script setting (MCPB install: extension settings; manual: ROS_SETUP_SCRIPT env var) " +
  "to your distro's setup script, e.g. /opt/ros/lyrical/setup.bash - also works for 'jazzy' or " +
  "'humble'. On Windows the path is inside your WSL distro (wsl_distro setting, default Ubuntu). " +
  "Linux/general tools in this server work independently of ROS.";

export async function listRosNodes(filter?: string) {
  if (!(await isRos2Available())) return { available: false, message: ROS_NOT_AVAILABLE_MSG };
  const inv = rosInvocation(["ros2", "node", "list"]);
  const { stdout } = await execFileAsync(inv.cmd, inv.args, { timeout: 15000 });
  // `ros2 node list` can emit the same fully-qualified name more than once
  // (discovery races / multiple DDS participants), so de-duplicate. Verified
  // live on Lyrical: a single turtlesim node was listed twice.
  let nodes = [...new Set(stdout.split("\n").map((n) => n.trim()).filter(Boolean))];
  if (filter) nodes = nodes.filter((n) => n.includes(filter));
  return { available: true, nodes };
}

export async function getRosGraph(includeHidden = false) {
  if (!(await isRos2Available())) return { available: false, message: ROS_NOT_AVAILABLE_MSG };
  const nodesInv = rosInvocation(["ros2", "node", "list"]);
  const topicsInv = rosInvocation(
    includeHidden ? ["ros2", "topic", "list", "--include-hidden-topics"] : ["ros2", "topic", "list"]
  );
  const [nodesRes, topicsRes] = await Promise.all([
    execFileAsync(nodesInv.cmd, nodesInv.args, { timeout: 15000 }),
    execFileAsync(topicsInv.cmd, topicsInv.args, { timeout: 15000 }),
  ]);
  // De-duplicate for the same reason as listRosNodes (discovery can repeat names).
  const nodes = [...new Set(nodesRes.stdout.split("\n").map((s) => s.trim()).filter(Boolean))];
  let topics = [...new Set(topicsRes.stdout.split("\n").map((s) => s.trim()).filter(Boolean))];
  if (!includeHidden) topics = topics.filter((t) => !t.split("/").pop()?.startsWith("_"));
  return { available: true, nodes, topics };
}

export async function sampleRosTopic(
  topicName: string,
  messageType: string | undefined,
  maxMessages = 1,
  timeoutSec = 3.0
) {
  if (!(await isRos2Available())) return { available: false, message: ROS_NOT_AVAILABLE_MSG };
  // We deliberately do NOT pass `messageType` as the positional to
  // `ros2 topic echo`. Verified live on ROS 2 Lyrical: passing an explicit type
  // makes echo fail hard ("The passed message type is invalid") whenever the
  // caller's type string is stale/wrong - e.g. turtlesim moved its messages from
  // `turtlesim/msg/Pose` to `turtlesim_msgs/msg/Pose`, so the once-correct type
  // now breaks the call. `ros2 topic echo` resolves the type from the live topic
  // on its own, so the positional is unnecessary. `messageType` is retained in
  // the signature for tool-schema/API compatibility and as caller documentation.
  void messageType;

  // One persistent `ros2 topic echo` subscription streams all N messages. This
  // replaced an N-cold-starts loop where every message paid ~1s of process +
  // discovery startup and the per-message budget SHRANK as N grew. Messages are
  // YAML documents each terminated by a `---` line: we buffer stdout, peel off
  // complete documents as they arrive (a partial document simply stays in the
  // buffer until its terminator shows up), and stop at N messages or when the
  // overall timeoutSec budget elapses - whichever comes first. In every exit
  // path the child is killed: SIGINT first, SIGKILL 2s later if it ignored that.
  return await new Promise<Record<string, unknown>>((resolve) => {
    const messages: string[] = [];
    let buffer = "";
    let stderrBuf = "";
    let settled = false;

    const inv = rosInvocation(["ros2", "topic", "echo", topicName]);
    const child = spawn(inv.cmd, inv.args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const finish = (extra: Record<string, unknown> = {}) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      const resolveNow = (more: Record<string, unknown> = {}) =>
        resolve({
          available: true,
          topic: topicName,
          messages,
          sampled: messages.length,
          ...extra,
          ...more,
        });
      // Resolve only AFTER the child is confirmed dead, so "the tool returned"
      // always implies "the subscription is gone" - a ps check right after the
      // call must find nothing. (First harness run resolved before the kill
      // landed, and ps caught the still-dying child. Racy contracts rot.)
      if (child.exitCode !== null || child.signalCode !== null) {
        resolveNow();
        return;
      }
      const hardKill = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
      }, 2000);
      // Failsafe: never hang the tool call even if SIGKILL somehow can't land.
      const failsafe = setTimeout(() => resolveNow({ kill_confirmed: false }), 3500);
      child.once("exit", () => {
        clearTimeout(hardKill);
        clearTimeout(failsafe);
        resolveNow();
      });
      try {
        child.kill("SIGINT");
      } catch {
        // kill() threw synchronously (already reaped); exit has fired or will.
      }
    };

    const deadline = setTimeout(() => {
      finish(messages.length < maxMessages ? { timed_out: true } : {});
    }, timeoutSec * 1000);

    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) return;
      buffer += chunk.toString("utf8");
      // Defensive: a separator at the very start of the stream would otherwise
      // get glued onto the front of the first document.
      if (buffer.startsWith("---\n")) buffer = buffer.slice(4);
      // Peel complete documents. The separator is a line that is exactly `---`;
      // YAML block scalars indent continuation lines, so a bare `---` at column
      // 0 can't appear inside a message body.
      let sep: number;
      while (!settled && (sep = buffer.indexOf("\n---\n")) !== -1) {
        const doc = buffer.slice(0, sep).trim();
        buffer = buffer.slice(sep + 5);
        if (doc) messages.push(doc);
        if (messages.length >= maxMessages) finish();
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrBuf.length < 8192) stderrBuf += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      finish({ error: `failed to spawn ros2: ${err.message}` });
    });

    child.on("exit", (code) => {
      // Child died before N messages and before the deadline (e.g. the topic
      // doesn't exist, or echo couldn't resolve a type). Anything left in the
      // buffer is an unterminated partial document - dropped rather than
      // returned as half a message.
      if (settled) return;
      finish({
        process_exited_early: true,
        exit_code: code,
        ...(stderrBuf.trim() ? { stderr: truncateOutput(stderrBuf.trim()) } : {}),
      });
    });
  });
}

export async function startRosLaunchJob(
  packageName: string,
  launchFile: string,
  args: Record<string, string> = {},
  rosNodeName?: string
) {
  if (!(await isRos2Available())) return { available: false, message: ROS_NOT_AVAILABLE_MSG };
  const argList = Object.entries(args).map(([k, v]) => `${k}:=${v}`);
  const inv = rosInvocation(["ros2", "launch", packageName, launchFile, ...argList]);
  const job = jobManager.start(inv.cmd, inv.args, `${packageName}/${launchFile}`, rosNodeName);
  return { available: true, job_id: job.id, status: job.status };
}

export async function restartRosNode(nodeName: string, gracePeriodSec = 5.0) {
  if (!(await isRos2Available())) return { available: false, message: ROS_NOT_AVAILABLE_MSG };
  const existing = jobManager.findByRosNodeName(nodeName);
  if (!existing) {
    return {
      available: true,
      restarted: false,
      message:
        `No tracked job for node '${nodeName}'. This server can only restart nodes it launched ` +
        `itself via start_ros_launch_job (it won't kill processes it doesn't own). ` +
        `Launch it through start_ros_launch_job first, then restart_ros_node will work.`,
    };
  }
  await jobManager.stop(existing.id, "SIGINT", gracePeriodSec * 1000);
  const newJob = jobManager.start(existing.command, existing.args, existing.name, nodeName);
  return { available: true, restarted: true, job_id: newJob.id, previous_job_id: existing.id };
}

// ---- ROS 2 workspace management (create + build) --------------------------
// These turn the introspection/control tools into a real develop loop:
// create_ros_package -> patch_file (edit code) -> build_ros_workspace ->
// read the returned stderr -> patch_file again to fix -> rebuild.

let colconAvailableCache: boolean | null = null;

/** colcon ships with `ros-dev-tools`, separately from the `ros2` CLI, so a
 * ros-base-only install has ros2 but no colcon. Checked lazily/cached so
 * build_ros_workspace degrades gracefully instead of throwing a raw ENOENT. */
export async function isColconAvailable(): Promise<boolean> {
  if (colconAvailableCache !== null) return colconAvailableCache;
  try {
    const inv = rosInvocation(["colcon", "--help"]);
    await execFileAsync(inv.cmd, inv.args, { timeout: 10000 });
    colconAvailableCache = true;
  } catch {
    colconAvailableCache = false;
  }
  return colconAvailableCache;
}

const COLCON_NOT_AVAILABLE_MSG =
  "colcon not found. Install ROS 2 dev tools (`ros-dev-tools`, which provides colcon + " +
  "rosdep), and either start this server from a ROS-sourced shell or set the " +
  "ros_setup_script setting so the server can source it automatically.";

/**
 * Wraps `ros2 pkg create`. Creates <packageName> inside destinationDirectory
 * (a workspace's `src/`), which is created if missing. Synchronous/bounded -
 * package scaffolding is fast, so this returns the result directly rather than
 * going through the async JobManager (that's for long-running launches/sims).
 */
export async function createRosPackage(
  packageName: string,
  destinationDirectory: string,
  buildType: "ament_cmake" | "ament_python" = "ament_cmake",
  dependencies: string[] = [],
  nodeName?: string
) {
  if (!(await isRos2Available())) return { available: false, message: ROS_NOT_AVAILABLE_MSG };
  // Sandbox allowlist: scaffolding writes files, so the destination must be
  // inside the configured workspace when sandboxing is on - same rule as
  // patch_file (one folder, one mental model).
  if (sandboxEnabled()) {
    const gate = await isInsideWorkspace(destinationDirectory);
    if (!gate.ok) return { available: true, created: false, reason: gate.reason };
  }
  // When the sourcing wrapper is active, mkdir happens inside the wrapper
  // script - destinationDirectory may be a WSL-internal path the host Node
  // can't create. Direct mode keeps the old Node-side mkdir.
  if (!rosWrapperActive) await mkdir(destinationDirectory, { recursive: true });
  const args = [
    "ros2",
    "pkg",
    "create",
    packageName,
    "--build-type",
    buildType,
    "--destination-directory",
    destinationDirectory,
  ];
  if (dependencies.length) args.push("--dependencies", ...dependencies);
  if (nodeName) args.push("--node-name", nodeName);
  try {
    const inv = rosInvocation(args, { mkdir: destinationDirectory });
    const { stdout, stderr } = await execFileAsync(inv.cmd, inv.args, { timeout: 60000 });
    return {
      available: true,
      created: true,
      package: packageName,
      path: `${destinationDirectory.replace(/\/+$/, "")}/${packageName}`,
      build_type: buildType,
      stdout: truncateOutput(stdout),
      stderr: truncateOutput(stderr),
    };
  } catch (err: any) {
    return {
      available: true,
      created: false,
      error: err.message,
      stdout: truncateOutput(err.stdout ?? ""),
      stderr: truncateOutput(err.stderr ?? err.message),
    };
  }
}

/**
 * Wraps `colcon build`, run from the workspace root. Bounded + output-truncated
 * exactly like run_command, so a compile failure comes back as
 * `{ success: false, exitCode, stderr }` with the real compiler errors in
 * `stderr` (colcon echoes a failed package's stderr in its own output). A build
 * exits (unlike a launch/sim), so this is a blocking call with a timeout rather
 * than a JobManager job. For very large workspaces, raise timeout_ms.
 */
const WINDOWS_BUILD_WARNING =
  "UNSANDBOXED BUILD: on Windows this build ran on the host (inside WSL), NOT in a " +
  "container - arbitrary code in the workspace's CMakeLists.txt/setup.py executed with " +
  "your user's privileges. This is the documented v1 Windows limitation (docs/sandboxing.md). " +
  "Only build workspaces whose build files you trust.";

export async function buildRosWorkspace(
  workspacePath: string,
  packages: string[] = [],
  timeoutMs = 600000
) {
  // Sandbox lane (default). Linux hosts: build inside the official
  // ros:<distro>-ros-base container with --network=none (builds need the ROS
  // install and the workspace - not DDS, not the internet). Windows hosts:
  // the v1 carve-out - host build with a MANDATORY per-call warning.
  if (sandboxEnabled()) {
    const refusal = workspaceHardRefusal();
    if (refusal) return { available: true, success: false, workspace_refused: true, reason: refusal };
    // Containment gate (2026-07-20 finding): builds execute the workspace's
    // CMakeLists/setup.py, so workspace_path must obey the same allowlist as
    // patch_file/create_ros_package - builds were previously the one ungated
    // path argument, and on Windows they run host-side. allowRoot because
    // building the configured workspace root itself IS the normal colcon flow.
    const buildGate = await isInsideWorkspace(workspacePath, { allowRoot: true });
    if (!buildGate.ok) {
      return { available: true, success: false, workspace_refused: true, reason: buildGate.reason };
    }
    if (!IS_WINDOWS) {
      if (!(await isDockerAvailable())) return { available: false, message: SANDBOX_UNAVAILABLE_MSG };
      const distro = ROS_SETUP_SCRIPT?.match(/\/opt\/ros\/([a-z0-9_]+)\//)?.[1];
      if (!distro) {
        return {
          available: true,
          success: false,
          reason:
            "Sandboxed builds pick the container image from ros_setup_script " +
            "(/opt/ros/<distro>/setup.bash -> ros:<distro>-ros-base). Set ros_setup_script, " +
            "or set sandbox_mode to 'off' to build on the host.",
        };
      }
      const warn = workspaceScopeWarning();
      const colconArgs = ["build", ...(packages.length ? ["--packages-select", ...packages] : [])];
      const inv = buildRunInvocation(distro, workspacePath, colconArgs);
      try {
        const { stdout, stderr } = await execFileAsync(inv.cmd, inv.args, {
          timeout: timeoutMs,
          maxBuffer: 10 * 1024 * 1024,
        });
        return {
          available: true,
          success: true,
          sandboxed: true,
          ...(warn ? { workspace_warning: warn } : {}),
          image: `ros:${distro}-ros-base`,
          network: "none",
          exitCode: 0,
          stdout: truncateOutput(stdout),
          stderr: truncateOutput(stderr),
        };
      } catch (err: any) {
        // A killed docker-run CLIENT leaves the container going; remove it by
        // name so a timed-out build can't keep compiling in the background.
        if (err.killed) forceRemoveContainer(inv.containerName);
        return {
          available: true,
          success: false,
          sandboxed: true,
          ...(warn ? { workspace_warning: warn } : {}),
          image: `ros:${distro}-ros-base`,
          exitCode: err.code ?? 1,
          timedOut: Boolean(err.killed),
          stdout: truncateOutput(err.stdout ?? ""),
          stderr: truncateOutput(err.stderr ?? err.message),
        };
      }
    }
    // Windows: fall through to the host build below, then attach the warning.
  }

  if (!(await isColconAvailable())) return { available: false, message: COLCON_NOT_AVAILABLE_MSG };
  const windowsCarveOut = sandboxEnabled() && IS_WINDOWS;
  const args = ["colcon", "build"];
  if (packages.length) args.push("--packages-select", ...packages);
  try {
    // Wrapper active: cd into the workspace inside the wrapper script (the
    // path may be WSL-internal). Direct mode: plain Node cwd, as before.
    const inv = rosInvocation(args, { cwd: workspacePath });
    const { stdout, stderr } = await execFileAsync(inv.cmd, inv.args, {
      ...(rosWrapperActive ? {} : { cwd: workspacePath }),
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    return {
      available: true,
      success: true,
      ...(windowsCarveOut ? { sandboxed: false, warning: WINDOWS_BUILD_WARNING } : {}),
      exitCode: 0,
      stdout: truncateOutput(stdout),
      stderr: truncateOutput(stderr),
    };
  } catch (err: any) {
    return {
      available: true,
      success: false,
      ...(windowsCarveOut ? { sandboxed: false, warning: WINDOWS_BUILD_WARNING } : {}),
      exitCode: err.code ?? 1,
      timedOut: Boolean(err.killed),
      stdout: truncateOutput(err.stdout ?? ""),
      stderr: truncateOutput(err.stderr ?? err.message),
    };
  }
}
