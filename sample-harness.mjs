// Validation harness for the persistent-subscription sample_ros_topic.
// Exercises max_messages 1/5/20 against the continuously-publishing
// /turtle1/pose (~62 Hz), a timeout case on a topic that exists but never
// publishes (/turtle1/cmd_vel - turtlesim subscribes, nobody publishes), and a
// nonexistent topic. After every case we check for orphaned `topic echo`
// processes with ps.
import { spawn, execSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { sampleRosTopic } from "./dist/ros-tools.js";

process.env.QT_QPA_PLATFORM = "offscreen";
const hr = (t) => console.log("\n========== " + t + " ==========");

function orphans() {
  try {
    const out = execSync("ps -ef | grep 'topic echo' | grep -v grep", { encoding: "utf8" });
    return out.trim() || "(none)";
  } catch {
    return "(none)"; // grep exits 1 when there are no matches
  }
}

async function run(label, topic, n, timeoutSec) {
  hr(label);
  const t0 = Date.now();
  const r = await sampleRosTopic(topic, undefined, n, timeoutSec);
  const ms = Date.now() - t0;
  const { messages, ...rest } = r;
  console.log(`elapsed: ${ms}ms`);
  console.log("result (messages elided):", JSON.stringify(rest));
  if (messages?.length) {
    console.log(`first message:\n${messages[0]}`);
    if (messages.length > 1) console.log(`last message:\n${messages[messages.length - 1]}`);
  }
  console.log("orphan check (ps -ef | grep 'topic echo'):", orphans());
  return { ms, r };
}

hr("bring up turtlesim_node (offscreen)");
const sim = spawn("ros2", ["run", "turtlesim", "turtlesim_node"], { stdio: ["ignore", "ignore", "ignore"] });
console.log("pid=" + sim.pid + ", waiting 5s for discovery...");
await sleep(5000);

await run("A) /turtle1/pose  max_messages=1  timeout=5s   [expect 1]", "/turtle1/pose", 1, 5);
await run("B) /turtle1/pose  max_messages=5  timeout=10s  [expect 5]", "/turtle1/pose", 5, 10);
await run("C) /turtle1/pose  max_messages=20 timeout=15s  [expect 20]", "/turtle1/pose", 20, 15);
await run("D) /turtle1/cmd_vel  max_messages=3  timeout=4s  [topic exists, never publishes -> expect 0 + timed_out, ~4000ms]", "/turtle1/cmd_vel", 3, 4);
await run("E) /definitely_no_such_topic  max_messages=1  timeout=5s  [expect early exit + stderr]", "/definitely_no_such_topic", 1, 5);

hr("cleanup");
sim.kill("SIGINT");
await sleep(1500);
try { sim.kill("SIGKILL"); } catch {}
console.log("final orphan check:", orphans());
console.log("\nDONE.");
process.exit(0);
