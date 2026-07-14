import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runCommand } from "./shell-tools.js";
import { patchFile } from "./file-tools.js";
import { jobManager } from "./job-manager.js";
import {
  listRosNodes,
  getRosGraph,
  sampleRosTopic,
  startRosLaunchJob,
  restartRosNode,
} from "./ros-tools.js";

export function buildServer(): McpServer {
  const server = new McpServer({
    name: "linux-ros-mcp-bridge",
    version: "0.1.0",
  });

  // ---- Layer 1: general Linux execution ----------------------------------

  server.tool(
    "run_command",
    "Runs a shell command and returns stdout/stderr/exit code. Blocking, bounded " +
      "output, hard timeout. For anything long-running (servers, launches, sims) " +
      "use start_background_job instead.",
    {
      command: z.string().describe("The shell command to run."),
      timeout_ms: z.number().default(30000).describe("Hard timeout in milliseconds."),
      cwd: z.string().optional().describe("Working directory to run the command in."),
    },
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
    async ({ command, args, name }) => {
      const job = jobManager.start(command, args, name);
      return { content: [{ type: "text", text: JSON.stringify({ job_id: job.id, status: job.status }) }] };
    }
  );

  // ---- Shared job management (Linux jobs and ROS jobs both use this) -----

  server.tool(
    "list_background_jobs",
    "Lists all background jobs started by this server, Linux or ROS, with their status.",
    {},
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
    async ({ include_hidden }) => {
      const result = await getRosGraph(include_hidden);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "sample_ros_topic",
    "Subscribes to a ROS 2 topic and captures a bounded number of messages, then " +
      "returns. Never hangs indefinitely, unlike a raw 'ros2 topic echo'.",
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
      max_messages: z.number().default(1),
      timeout_sec: z.number().default(3.0),
    },
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
    async ({ node_name, grace_period_sec }) => {
      const result = await restartRosNode(node_name, grace_period_sec);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  return server;
}
