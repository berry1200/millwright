// Validation harness for the Docker sandbox (docs/sandboxing.md). Each
// scenario runs in its own process because sandbox config is read from env at
// import time — drive with sandbox-harness.sh, which sets the env per case.
import { writeFile, mkdir, rm, readFile, access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";

const pexec = promisify(execFile);
const scenario = process.argv[2];
const hr = (t) => console.log("\n===== " + t + " =====");
const show = (l, v) => console.log(l, "=>", JSON.stringify(v, null, 2));
const docker = async (...args) => (await pexec("docker", args, { timeout: 30000 })).stdout.trim();

const { runCommand } = await import("./dist/shell-tools.js");
const { patchFile } = await import("./dist/file-tools.js");

if (scenario === "off") {
  hr("MODE OFF: legacy behavior, no containers");
  show("uname", await runCommand("uname -a && hostname"));
  await writeFile("/tmp/mw_outside.txt", "alpha SECRET beta\n");
  show("patch outside ws (must APPLY - no allowlist when off)",
    await patchFile("/tmp/mw_outside.txt", "SECRET", "S3CR3T"));
} else if (scenario === "unavailable") {
  hr("DOCKER UNREACHABLE: must fail CLOSED with guidance");
  show("run_command", await runCommand("echo should-not-run"));
} else if (scenario === "workbench") {
  hr("WORKBENCH: container exec, mount, reuse, limits, timeout, blocklist");
  await mkdir("/tmp/mw_ws", { recursive: true });
  await writeFile("/tmp/mw_ws/hello.txt", "hello-from-host\n");
  const r1 = await runCommand("head -1 /etc/os-release && hostname && whoami");
  show("os/hostname/user (expect Ubuntu 24.04 container, root)", r1);
  const r2 = await runCommand("cat /tmp/mw_ws/hello.txt");
  show("workspace mount visible in container", r2);
  const h1 = r1.stdout?.split("\n")[1], h2 = (await runCommand("hostname")).stdout?.trim();
  console.log("container reused across calls?", h1 === h2, `(${h1} vs ${h2})`);
  const name = await docker("ps", "--filter", "name=millwright-workbench", "--format", "{{.Names}}");
  const limits = await docker("inspect", "-f", "Memory={{.HostConfig.Memory}} Pids={{.HostConfig.PidsLimit}} Net={{.HostConfig.NetworkMode}}", name);
  console.log("limits on", name, "->", limits, "(expect Memory=2147483648 Pids=512)");
  const t0 = Date.now();
  const rt = await runCommand("echo start; sleep 30; echo never", 3000);
  show(`timeout: sleep 30 with 3s budget (elapsed ${Date.now() - t0}ms)`, rt);
  await sleep(1500);
  let leftover = "";
  try { leftover = await docker("exec", name, "pgrep", "-a", "sleep"); } catch { /* none */ }
  console.log("sleep left inside container after timeout?", leftover || "(none - inner timeout killed it)");
  show("blocklist still active in sandbox", await runCommand("rm -rf ~"));
  hr("NETWORK default=all: outbound probe should succeed");
  show("net probe", await runCommand("timeout 5 bash -c 'echo > /dev/tcp/1.1.1.1/443' && echo NET_OK || echo NO_NETWORK"));
  hr("patch_file allowlist (workspace_dir=/tmp/mw_ws)");
  await writeFile("/tmp/mw_ws/code.txt", "x = OLD\n");
  show("inside ws (must apply)", await patchFile("/tmp/mw_ws/code.txt", "OLD", "NEW"));
  await writeFile("/tmp/mw_forbidden.txt", "x = OLD\n");
  show("outside ws (must refuse)", await patchFile("/tmp/mw_forbidden.txt", "OLD", "NEW"));
  console.log("outside file untouched?", (await readFile("/tmp/mw_forbidden.txt", "utf8")).includes("OLD"));
} else if (scenario === "network-none") {
  hr("WORKBENCH_NETWORK=none: outbound probe must fail");
  show("net probe", await runCommand("timeout 5 bash -c 'echo > /dev/tcp/1.1.1.1/443' && echo NET_OK || echo NO_NETWORK"));
} else if (scenario === "no-workspace") {
  hr("SANDBOX ON, NO workspace_dir: patch refused w/ guidance, run_command fine");
  await writeFile("/tmp/mw_any.txt", "x = OLD\n");
  show("patch anywhere (must refuse, actionable msg)", await patchFile("/tmp/mw_any.txt", "OLD", "NEW"));
  show("run_command (no mount, still works)", await runCommand("echo ok-in-container && hostname"));
} else if (scenario === "job") {
  hr("BACKGROUND JOB as attached docker run: logs stream, SIGINT stops, --rm cleans");
  const { jobManager } = await import("./dist/job-manager.js");
  const { jobRunInvocation } = await import("./dist/sandbox.js");
  const inv = jobRunInvocation("bash", ["-c", "for i in 1 2 3; do echo tick $i; sleep 1; done; sleep 120"]);
  const job = jobManager.start(inv.cmd, inv.args, "sandbox-job-test", undefined, inv.containerName);
  await sleep(4500);
  console.log("logs after 4.5s:", JSON.stringify(jobManager.tailLogs(job.id, 10)));
  await jobManager.stop(job.id, "SIGINT", 5000);
  console.log("status after stop:", jobManager.get(job.id)?.status);
  await sleep(2000);
  const remnants = await docker("ps", "-a", "--filter", "name=millwright-job", "--format", "{{.Names}}");
  console.log("job containers remaining:", remnants || "(none - --rm cleaned up)");
} else if (scenario === "build") {
  hr("BUILD LANE: ros container, --network=none, real colcon, break/fix");
  const { createRosPackage, buildRosWorkspace } = await import("./dist/ros-tools.js");
  const WS = "/tmp/mw_build_ws";
  await rm(WS, { recursive: true, force: true });
  await mkdir(WS + "/src", { recursive: true });
  show("create pkg OUTSIDE ws (must refuse)", await createRosPackage("bad_pkg", "/tmp/not_ws/src", "ament_cmake"));
  const created = await createRosPackage("sbx_demo", WS + "/src", "ament_cmake", ["rclcpp"], "demo");
  console.log("create in ws:", JSON.stringify({ created: created.created, path: created.path }));
  const b1 = await buildRosWorkspace(WS);
  show("build #1 (expect success, sandboxed:true, network none)", { ...b1, stdout: b1.stdout?.split("\n").slice(-2).join(" | "), stderr: (b1.stderr || "").slice(0, 200) });
  const CPP = WS + "/src/sbx_demo/src/demo.cpp";
  show("patch: inject error", await patchFile(CPP, "char ** argv)", "char ** argv) GARBAGE_ZZZ"));
  const b2 = await buildRosWorkspace(WS);
  show("build #2 (expect FAIL w/ real gcc error)", { success: b2.success, sandboxed: b2.sandboxed, exitCode: b2.exitCode, stderr_head: (b2.stderr || "").split("\n").slice(0, 4).join("\n") });
  show("patch: fix", await patchFile(CPP, "char ** argv) GARBAGE_ZZZ", "char ** argv)"));
  const b3 = await buildRosWorkspace(WS);
  console.log("build #3:", JSON.stringify({ success: b3.success, sandboxed: b3.sandboxed }));
  try { await access(WS + "/build"); console.log("host sees build/ artifacts: yes"); } catch { console.log("host sees build/ artifacts: NO"); }
  await rm(WS, { recursive: true, force: true });
} else {
  console.error("unknown scenario:", scenario);
  process.exit(2);
}
console.log("\nSCENARIO DONE:", scenario);
process.exit(0);
