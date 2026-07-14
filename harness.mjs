// Validation harness: calls each ros-tools.ts function for real against turtlesim.
// Run from the project root with ROS sourced and QT_QPA_PLATFORM=offscreen.
import { setTimeout as sleep } from "node:timers/promises";
import { spawn } from "node:child_process";
import {
  listRosNodes,
  getRosGraph,
  sampleRosTopic,
  startRosLaunchJob,
  restartRosNode,
} from "./dist/ros-tools.js";
import { jobManager } from "./dist/job-manager.js";

const hr = (t) => console.log("\n========== " + t + " ==========");
const show = (label, v) => console.log(label + " => " + JSON.stringify(v, null, 2));
async function timed(label, fn) {
  const t0 = Date.now();
  try {
    const r = await fn();
    console.log(`[timing] ${label}: ${Date.now() - t0}ms`);
    return r;
  } catch (e) {
    console.log(`[timing] ${label}: ${Date.now() - t0}ms (threw)`);
    return { threw: String(e && e.message || e) };
  }
}

process.env.QT_QPA_PLATFORM = "offscreen";

// Bring up a standalone turtlesim_node as the introspection target.
hr("bring up turtlesim_node (offscreen)");
const sim = spawn("ros2", ["run", "turtlesim", "turtlesim_node"], {
  stdio: ["ignore", "pipe", "pipe"],
});
let simLog = "";
sim.stdout.on("data", (d) => (simLog += d));
sim.stderr.on("data", (d) => (simLog += d));
console.log("spawned turtlesim_node pid=" + sim.pid + ", waiting 5s for discovery...");
await sleep(5000);

hr("1) list_ros_nodes()");
show("result", await timed("list_ros_nodes", () => listRosNodes()));

hr("2) get_ros_graph()");
show("result", await timed("get_ros_graph", () => getRosGraph()));

hr("2b) get_ros_graph(include_hidden=true)  [exercises --include-hidden-topics]");
show("result", await timed("get_ros_graph(hidden)", () => getRosGraph(true)));

hr("3) sample_ros_topic('/turtle1/pose','turtlesim/msg/Pose',1,3.0)  [type AS GIVEN]");
show("result", await timed("sample:given-type", () =>
  sampleRosTopic("/turtle1/pose", "turtlesim/msg/Pose", 1, 3.0)));

hr("3b) sample_ros_topic('/turtle1/pose','turtlesim_msgs/msg/Pose',1,3.0)  [CORRECT type]");
show("result", await timed("sample:correct-type", () =>
  sampleRosTopic("/turtle1/pose", "turtlesim_msgs/msg/Pose", 1, 3.0)));

hr("4) start_ros_launch_job('turtlesim','multisim.launch.py',{},'multisim')");
const launch = await startRosLaunchJob("turtlesim", "multisim.launch.py", {}, "multisim");
show("result", launch);
await sleep(6000);
console.log("-- nodes after launch --");
show("list_ros_nodes", await listRosNodes());
console.log("-- launch job log tail --");
console.log((jobManager.get(launch.job_id)?.logLines || []).slice(-12).join("\n") || "(none)");

hr("5) restart_ros_node('multisim')");
const restart = await restartRosNode("multisim", 5.0);
show("result", restart);
await sleep(6000);
console.log("-- nodes after restart --");
show("list_ros_nodes", await listRosNodes());

hr("5b) restart_ros_node('/not_ours')  [expect polite refusal]");
show("result", await restartRosNode("/not_ours"));

hr("cleanup");
for (const j of jobManager.list()) {
  try { await jobManager.stop(j.id, "SIGINT", 3000); } catch {}
}
try { sim.kill("SIGINT"); } catch {}
await sleep(1500);
try { sim.kill("SIGKILL"); } catch {}
console.log("standalone turtlesim log head:\n" + simLog.split("\n").slice(0, 3).join("\n"));
console.log("\nDONE.");
process.exit(0);
