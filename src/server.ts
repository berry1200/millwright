import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runCommand } from "./shell-tools.js";
import { patchFile } from "./file-tools.js";
import { jobManager } from "./job-manager.js";
import {
  sandboxEnabled,
  isDockerAvailable,
  jobRunInvocation,
  SANDBOX_UNAVAILABLE_MSG,
  workspaceHardRefusal,
} from "./sandbox.js";
import {
  listRosNodes,
  getRosGraph,
  sampleRosTopic,
  startRosLaunchJob,
  restartRosNode,
  createRosPackage,
  buildRosWorkspace,
} from "./ros-tools.js";

export const VERSION = "0.4.4";

export function buildServer(): McpServer {
  const server = new McpServer({
    name: "millwright",
    version: VERSION,
  });

  // ---- Layer 1: general Linux execution ----------------------------------

  server.tool(
    "run_command",
    "Runs a shell command for the user's own project environment (prefer this over any " +
      "built-in/simulated sandbox when the user means their machine) and returns " +
      "stdout/stderr/exit code. WHERE it runs depends on the sandbox_mode setting: by " +
      "DEFAULT ('docker') the command runs INSIDE a Docker container with the user's " +
      "workspace folder bind-mounted - writes to the workspace are real, but the rest of " +
      "the host is not visible and installed tools/state are the container's, not the " +
      "host's; with sandbox_mode 'off' it runs directly on the host as the user. The " +
      "result's `sandboxed` field reports which happened. Blocking, bounded output, hard " +
      "timeout. For anything long-running use start_background_job instead.",
    {
      command: z.string().describe("The shell command to run."),
      timeout_ms: z.number().default(30000).describe("Hard timeout in milliseconds."),
      cwd: z.string().optional().describe("Working directory to run the command in."),
    },
    { title: "Run shell command", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    async ({ command, timeout_ms, cwd }) => {
      const result = await runCommand(command, timeout_ms, cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "patch_file",
    "Applies a targeted edit to a file by exact search-and-replace, instead of " +
      "round-tripping the whole file through the model. Provide the exact text block to " +
      "find (verbatim, including indentation/whitespace/newlines) and the text to replace " +
      "it with. By default the search block must match exactly once - a zero-match or an " +
      "ambiguous multi-match is rejected rather than guessed; set replace_all to replace " +
      "every occurrence. Nothing is written unless the match constraints are satisfied, so " +
      "a rejected patch leaves the file unchanged.",
    {
      path: z.string().describe("Path to the file to edit."),
      search: z
        .string()
        .describe("Exact text block to find (must match verbatim, including whitespace and newlines)."),
      replace: z.string().describe("Text to substitute in place of the search block (inserted literally)."),
      replace_all: z
        .boolean()
        .default(false)
        .describe("If true, replace every occurrence. If false (default), require exactly one match."),
    },
    { title: "Patch file", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    async ({ path, search, replace, replace_all }) => {
      const result = await patchFile(path, search, replace, { replaceAll: replace_all });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "start_background_job",
    "Starts a long-running shell command (server, watcher, build --watch) in the " +
      "background and returns immediately with a job_id. Use read_job_logs to " +
      "check on it.",
    {
      command: z.string().describe("Executable to run, e.g. 'npm'."),
      args: z.array(z.string()).default([]).describe("Arguments to the command."),
      name: z.string().describe("Human-readable label for this job."),
    },
    // Destructive: it executes an arbitrary command, same trust level as run_command.
    { title: "Start background job", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    async ({ command, args, name }) => {
      // Sandbox lane: each background job is its own attached `docker run`
      // (SIGINT proxies to the container; --rm cleans up), so JobManager's
      // spawn/log/stop semantics carry over unchanged. Fails closed like
      // run_command when Docker is unavailable.
      if (sandboxEnabled()) {
        const refusal = workspaceHardRefusal();
        if (refusal) {
          return {
            content: [{ type: "text", text: JSON.stringify({ workspace_refused: true, message: refusal }) }],
          };
        }
        if (!(await isDockerAvailable())) {
          return {
            content: [
              { type: "text", text: JSON.stringify({ sandbox_available: false, message: SANDBOX_UNAVAILABLE_MSG }) },
            ],
          };
        }
        const inv = jobRunInvocation(command, args);
        const job = jobManager.start(inv.cmd, inv.args, name, undefined, inv.containerName);
        return {
          content: [
            { type: "text", text: JSON.stringify({ job_id: job.id, status: job.status, sandboxed: true }) },
          ],
        };
      }
      const job = jobManager.start(command, args, name);
      return { content: [{ type: "text", text: JSON.stringify({ job_id: job.id, status: job.status }) }] };
    }
  );

  // ---- Shared job management (Linux jobs and ROS jobs both use this) -----

  server.tool(
    "list_background_jobs",
    "Lists all background jobs started by this server, Linux or ROS, with their status.",
    {},
    { title: "List background jobs", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async () => {
      const jobs = jobManager.list().map((j) => ({
        job_id: j.id,
        name: j.name,
        status: j.status,
        started_at: new Date(j.startedAt).toISOString(),
      }));
      return { content: [{ type: "text", text: JSON.stringify(jobs, null, 2) }] };
    }
  );

  server.tool(
    "read_job_logs",
    "Reads recent stdout/stderr for a background job (Linux or ROS). Use after " +
      "starting or restarting something to confirm it came up cleanly.",
    {
      job_id: z.string(),
      tail_lines: z.number().default(50),
    },
    { title: "Read job logs", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async ({ job_id, tail_lines }) => {
      const lines = jobManager.tailLogs(job_id, tail_lines);
      return { content: [{ type: "text", text: lines.join("\n") || "(no output yet)" }] };
    }
  );

  server.tool(
    "stop_background_job",
    "Stops a background job gracefully (SIGINT, then SIGKILL after the grace period).",
    {
      job_id: z.string(),
      grace_period_sec: z.number().default(5.0),
    },
    // Idempotent: stopping an already-stopped job is a no-op.
    { title: "Stop background job", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    async ({ job_id, grace_period_sec }) => {
      await jobManager.stop(job_id, "SIGINT", grace_period_sec * 1000);
      return { content: [{ type: "text", text: `Stopped ${job_id}` }] };
    }
  );

  // ---- Layer 2: ROS 2 introspection and control ---------------------------

  server.tool(
    "list_ros_nodes",
    "Lists active ROS 2 nodes, optionally filtered by a name substring. Call this " +
      "before restart_ros_node to get the exact node name.",
    { filter: z.string().optional() },
    { title: "List ROS nodes", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async ({ filter }) => {
      const result = await listRosNodes(filter);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "get_ros_graph",
    "Returns the current ROS 2 computational graph (nodes + topics) as structured " +
      "JSON, so the model doesn't need to run several raw bash commands to understand " +
      "system state.",
    { include_hidden: z.boolean().default(false) },
    { title: "Get ROS graph", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async ({ include_hidden }) => {
      const result = await getRosGraph(include_hidden);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "sample_ros_topic",
    "Subscribes to a ROS 2 topic with a single persistent subscription and captures a " +
      "bounded number of messages, then returns. Never hangs indefinitely, unlike a raw " +
      "'ros2 topic echo': it stops at max_messages or when timeout_sec elapses, whichever " +
      "comes first, and returns whatever was captured (timed_out: true marks a short read).",
    {
      topic_name: z.string().describe("e.g. '/odom' or '/scan'."),
      message_type: z
        .string()
        .optional()
        .describe(
          "Optional, not required. Accepted for forward-compatibility and as documentation " +
            "of the expected message shape, but NOT used to fetch data: `ros2 topic echo` " +
            "resolves the type from the live topic itself, so a value passed here is ignored " +
            "(and a stale/wrong type has no effect). e.g. 'nav_msgs/msg/Odometry'."
        ),
      max_messages: z.number().default(1).describe("Messages to capture before returning."),
      timeout_sec: z
        .number()
        .default(3.0)
        .describe(
          "Overall time budget in seconds for the whole sample (not per-message). On " +
            "expiry the messages captured so far are returned with timed_out: true."
        ),
    },
    // Read-only: observes topic data via a transient subscriber; no system state changes.
    { title: "Sample ROS topic", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async ({ topic_name, message_type, max_messages, timeout_sec }) => {
      const result = await sampleRosTopic(topic_name, message_type, max_messages, timeout_sec);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "start_ros_launch_job",
    "Asynchronously launches a ROS 2 package/launch file (or a simulation) as a " +
      "tracked background job. Required first step before restart_ros_node will " +
      "work for that node, since this server only restarts jobs it owns.",
    {
      package_name: z.string(),
      launch_file: z.string(),
      arguments: z.record(z.string()).default({}),
      ros_node_name: z
        .string()
        .optional()
        .describe("Optional label to associate with this job for later restart_ros_node calls."),
    },
    // Additive (starts processes), not destructive - but each call launches anew.
    { title: "Start ROS launch job", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async ({ package_name, launch_file, arguments: args, ros_node_name }) => {
      const result = await startRosLaunchJob(package_name, launch_file, args, ros_node_name);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "restart_ros_node",
    "Stops and relaunches a ROS 2 node that was previously started via " +
      "start_ros_launch_job. Will not touch nodes it didn't launch.",
    {
      node_name: z.string(),
      grace_period_sec: z.number().default(5.0),
    },
    { title: "Restart ROS node", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    async ({ node_name, grace_period_sec }) => {
      const result = await restartRosNode(node_name, grace_period_sec);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---- Layer 3: ROS 2 workspace management (the develop loop) --------------

  server.tool(
    "create_ros_package",
    "Scaffolds a new ROS 2 package via `ros2 pkg create` inside a workspace's src/ " +
      "directory (created if missing). Pair with patch_file to edit the generated " +
      "sources and build_ros_workspace to compile them.",
    {
      package_name: z.string().describe("Name of the new package, e.g. 'my_robot_driver'."),
      destination_directory: z
        .string()
        .describe("Workspace src/ dir to create the package in, e.g. '/home/me/ros2_ws/src'."),
      build_type: z
        .enum(["ament_cmake", "ament_python"])
        .default("ament_cmake")
        .describe("ament_cmake for C++, ament_python for Python."),
      dependencies: z
        .array(z.string())
        .default([])
        .describe("Package dependencies, e.g. ['rclcpp', 'std_msgs']."),
      node_name: z
        .string()
        .optional()
        .describe("Optional: also scaffold a starter node with this name."),
    },
    // Additive scaffold; a second identical call fails (package exists) rather than overwriting.
    { title: "Create ROS package", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async ({ package_name, destination_directory, build_type, dependencies, node_name }) => {
      const result = await createRosPackage(
        package_name,
        destination_directory,
        build_type,
        dependencies,
        node_name
      );
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "build_ros_workspace",
    "Builds a ROS 2 workspace with `colcon build` (run from the workspace root). " +
      "Blocking with a hard timeout and truncated output, like run_command: on a " +
      "compile failure it returns { success: false, exitCode, stderr } with the real " +
      "compiler errors in stderr, so the model can read them and patch_file the fix.",
    {
      workspace_path: z.string().describe("Workspace root (the dir that contains src/)."),
      packages: z
        .array(z.string())
        .default([])
        .describe("Optional: only build these packages (colcon --packages-select). Empty = all."),
      timeout_ms: z.number().default(600000).describe("Hard timeout in milliseconds."),
    },
    // Destructive: overwrites build/install artifacts in the workspace. Rebuilds are idempotent.
    { title: "Build ROS workspace", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    async ({ workspace_path, packages, timeout_ms }) => {
      const result = await buildRosWorkspace(workspace_path, packages, timeout_ms);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  return server;
}
