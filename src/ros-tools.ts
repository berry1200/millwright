import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir } from "node:fs/promises";
import { jobManager } from "./job-manager.js";
import { truncateOutput } from "./shell-tools.js";

const execFileAsync = promisify(execFile);

let ros2AvailableCache: boolean | null = null;

/** Checked lazily and cached - ROS may not be installed (fine, most tools
 * should say so clearly instead of throwing a raw ENOENT). */
export async function isRos2Available(): Promise<boolean> {
  if (ros2AvailableCache !== null) return ros2AvailableCache;
  try {
    await execFileAsync("ros2", ["--help"], { timeout: 3000 });
    ros2AvailableCache = true;
  } catch {
    ros2AvailableCache = false;
  }
  return ros2AvailableCache;
}

const ROS_NOT_AVAILABLE_MSG =
  "ros2 CLI not found on this machine. Install ROS 2 (e.g. the 'lyrical', 'jazzy' or 'humble' distro) " +
  "and source /opt/ros/<distro>/setup.bash before ROS tools will work. Linux/general " +
  "tools in this server work independently of ROS.";

export async function listRosNodes(filter?: string) {
  if (!(await isRos2Available())) return { available: false, message: ROS_NOT_AVAILABLE_MSG };
  const { stdout } = await execFileAsync("ros2", ["node", "list"], { timeout: 8000 });
  // `ros2 node list` can emit the same fully-qualified name more than once
  // (discovery races / multiple DDS participants), so de-duplicate. Verified
  // live on Lyrical: a single turtlesim node was listed twice.
  let nodes = [...new Set(stdout.split("\n").map((n) => n.trim()).filter(Boolean))];
  if (filter) nodes = nodes.filter((n) => n.includes(filter));
  return { available: true, nodes };
}

export async function getRosGraph(includeHidden = false) {
  if (!(await isRos2Available())) return { available: false, message: ROS_NOT_AVAILABLE_MSG };
  const [nodesRes, topicsRes] = await Promise.all([
    execFileAsync("ros2", ["node", "list"], { timeout: 8000 }),
    execFileAsync(
      "ros2",
      includeHidden ? ["topic", "list", "--include-hidden-topics"] : ["topic", "list"],
      { timeout: 8000 }
    ),
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
  const messages: string[] = [];
  const perMessageTimeoutMs = Math.max(500, (timeoutSec * 1000) / maxMessages);
  // We deliberately do NOT pass `messageType` as the positional to
  // `ros2 topic echo`. Verified live on ROS 2 Lyrical: passing an explicit type
  // makes echo fail hard ("The passed message type is invalid") whenever the
  // caller's type string is stale/wrong - e.g. turtlesim moved its messages from
  // `turtlesim/msg/Pose` to `turtlesim_msgs/msg/Pose`, so the once-correct type
  // now breaks the call. `ros2 topic echo` resolves the type from the live topic
  // on its own, so the positional is unnecessary. `messageType` is retained in
  // the signature for tool-schema/API compatibility and as caller documentation.
  void messageType;
  for (let i = 0; i < maxMessages; i++) {
    try {
      const { stdout } = await execFileAsync(
        "ros2",
        ["topic", "echo", "--once", topicName],
        { timeout: perMessageTimeoutMs }
      );
      if (stdout.trim()) messages.push(stdout.trim());
    } catch (err: any) {
      // Timeout on this sample just means no message arrived in time - not fatal.
      if (err.killed) continue;
      return { available: true, error: err.message, messages };
    }
  }
  return { available: true, topic: topicName, messages, sampled: messages.length };
}

export async function startRosLaunchJob(
  packageName: string,
  launchFile: string,
  args: Record<string, string> = {},
  rosNodeName?: string
) {
  if (!(await isRos2Available())) return { available: false, message: ROS_NOT_AVAILABLE_MSG };
  const argList = Object.entries(args).map(([k, v]) => `${k}:=${v}`);
  const job = jobManager.start(
    "ros2",
    ["launch", packageName, launchFile, ...argList],
    `${packageName}/${launchFile}`,
    rosNodeName
  );
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
    await execFileAsync("colcon", ["--help"], { timeout: 5000 });
    colconAvailableCache = true;
  } catch {
    colconAvailableCache = false;
  }
  return colconAvailableCache;
}

const COLCON_NOT_AVAILABLE_MSG =
  "colcon not found on this machine. Install ROS 2 dev tools (`ros-dev-tools`, which " +
  "provides colcon + rosdep) and source your ROS setup before build_ros_workspace will work.";

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
  await mkdir(destinationDirectory, { recursive: true });
  const args = [
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
    const { stdout, stderr } = await execFileAsync("ros2", args, { timeout: 30000 });
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
export async function buildRosWorkspace(
  workspacePath: string,
  packages: string[] = [],
  timeoutMs = 600000
) {
  if (!(await isColconAvailable())) return { available: false, message: COLCON_NOT_AVAILABLE_MSG };
  const args = ["build"];
  if (packages.length) args.push("--packages-select", ...packages);
  try {
    const { stdout, stderr } = await execFileAsync("colcon", args, {
      cwd: workspacePath,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    return {
      available: true,
      success: true,
      exitCode: 0,
      stdout: truncateOutput(stdout),
      stderr: truncateOutput(stderr),
    };
  } catch (err: any) {
    return {
      available: true,
      success: false,
      exitCode: err.code ?? 1,
      timedOut: Boolean(err.killed),
      stdout: truncateOutput(err.stdout ?? ""),
      stderr: truncateOutput(err.stderr ?? err.message),
    };
  }
}
