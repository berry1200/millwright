import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { jobManager } from "./job-manager.js";

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
  "ros2 CLI not found on this machine. Install ROS 2 (e.g. the 'jazzy' or 'humble' distro) " +
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
