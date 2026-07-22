// ADVERSARIAL harness: genuinely tries to break OUT of the sandbox and reports
// PASS (attack contained) / **FAIL** (attack succeeded) for each. Config comes
// from env at import time; drive with adversarial-harness.sh. Linux-host paths.
import { writeFile, mkdir, rm, readFile, symlink, access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";

const pexec = promisify(execFile);
const scenario = process.argv[2];
const hr = (t) => console.log("\n===== " + t + " =====");
let FAILS = 0;
const verdict = (ok, label, detail) => {
  if (!ok) FAILS++;
  console.log(`${ok ? "PASS" : "**FAIL**"}  ${label}${detail ? "  — " + detail : ""}`);
};

const { runCommand } = await import("./dist/shell-tools.js");
const { patchFile } = await import("./dist/file-tools.js");

const WS = process.env.WORKSPACE_DIR || "/tmp/mw_ws";

// Fixture setup and the scenario body run inside main() so ANY thrown error (a
// broken fixture, an unwritable workspace) is caught and reported as SETUP
// FAILED - distinct from a containment FAIL that verdict() records. A top-level
// `await` rejection would instead dump a raw stack trace and exit 1,
// indistinguishable at a glance from a real guard failure (and process-level
// 'unhandledRejection' does NOT fire for top-level await), which is exactly what
// we're avoiding.
async function main() {
  // Create the workspace dir as THIS (unprivileged) user BEFORE any container
  // bind-mounts it. Otherwise the smoke probe's `docker run -v $WS:$WS` makes a
  // missing $WS root-owned (the Docker daemon is root on native-Docker runners),
  // and the symlink scenario then can't write its fixture into it (EACCES) - the
  // same class as the root-owned build-artifacts bug. Docker Desktop's VM hides
  // this via uid-mapping, which is why it only bit on the hosted runner.
  await mkdir(WS, { recursive: true });

  // Preflight: Docker Desktop's WSL integration drops intermittently. If the
  // sandbox is meant to be on but the workbench doesn't actually run, ABORT
  // LOUDLY (exit 2) rather than run assertions against a dead sandbox and emit a
  // page of vacuous PASS/FAIL. A CLI-presence check ("command -v docker") is not
  // enough: the shim stays on PATH when the daemon is unreachable, so we probe
  // that a command REALLY executed in the workbench.
  if ((process.env.SANDBOX_MODE || "docker") !== "off") {
    const smoke = await runCommand("echo __mw_smoke__");
    if (smoke.sandbox_available === false || !/__mw_smoke__/.test(smoke.stdout || "")) {
      console.error("\n**ABORT** sandbox not functioning: SANDBOX_MODE is on but the workbench did not run.");
      console.error("  Likely Docker Desktop stopped or its WSL integration dropped.");
      console.error("  smoke probe:", JSON.stringify(smoke).slice(0, 200));
      console.error("  Refusing to run adversarial assertions against a dead sandbox.\n");
      process.exit(2);
    }
  }

  if (scenario === "traversal") {
    hr("patch_file path traversal (workspace = " + WS + ")");
    await mkdir(WS, { recursive: true });
    const before = await readFile("/etc/passwd", "utf8");
    const cases = [
      `${WS}/../../../etc/passwd`,
      `${WS}/../../../../../../etc/passwd`,
      `${WS}/./../mw_ws/../../etc/passwd`,
      `${WS}/%2e%2e/%2e%2e/%2e%2e/etc/passwd`,
      `${WS}_evil/passwd`,             // prefix-sibling trap (must NOT be treated as inside)
      "/etc/passwd",                   // absolute, plainly outside
    ];
    for (const c of cases) {
      const r = await patchFile(c, "root", "pwned");
      verdict(r.applied === false, `refuse ${c}`, r.reason?.slice(0, 60));
    }
    const after = await readFile("/etc/passwd", "utf8");
    verdict(before === after, "/etc/passwd byte-unchanged");
  } else if (scenario === "symlink") {
    hr("patch_file via symlink escaping the workspace");
    await mkdir(WS, { recursive: true });
    const before = await readFile("/etc/passwd", "utf8");
    await rm(`${WS}/passwd_link`, { force: true });
    await rm(`${WS}/etclink`, { force: true });
    await symlink("/etc/passwd", `${WS}/passwd_link`);       // file symlink -> outside
    await symlink("/etc", `${WS}/etclink`);                   // dir symlink -> outside
    const r1 = await patchFile(`${WS}/passwd_link`, "root", "pwned");
    verdict(r1.applied === false, "refuse file-symlink -> /etc/passwd", r1.reason?.slice(0, 55));
    const r2 = await patchFile(`${WS}/etclink/passwd`, "root", "pwned");
    verdict(r2.applied === false, "refuse dir-symlink -> /etc/passwd", r2.reason?.slice(0, 55));
    const after = await readFile("/etc/passwd", "utf8");
    verdict(before === after, "/etc/passwd byte-unchanged");
  } else if (scenario === "escape") {
    hr("run_command trying to reach the host from inside the workbench");
    // Sentinel on the WSL host, OUTSIDE the mounted workspace.
    await writeFile("/tmp/mw_host_secret.txt", "TOP-SECRET-HOST-ONLY\n");
    const sees = await runCommand("cat /tmp/mw_host_secret.txt 2>&1 || echo NOT_VISIBLE");
    verdict(!/(TOP-SECRET)/.test(sees.stdout || ""), "host file outside mount NOT visible", (sees.stdout || "").trim());
    const sock = await runCommand("ls -la /var/run/docker.sock 2>&1 || echo NO_SOCKET");
    verdict(/NO_SOCKET|No such/.test(sock.stdout || ""), "docker socket absent", (sock.stdout || "").trim());
    const dcli = await runCommand("command -v docker || echo NO_DOCKER_CLI");
    verdict(/NO_DOCKER_CLI/.test(dcli.stdout || ""), "docker CLI absent in container", (dcli.stdout || "").trim());
    const up = await runCommand(`ls -a ${WS}/../ 2>&1 | head -5`);
    console.log("     info: contents of mount-parent inside container:", JSON.stringify((up.stdout || "").trim()));
    const root = await runCommand("cat /etc/hostname && echo --- && ls / | tr '\\n' ' '");
    console.log("     info: container hostname + / listing:", JSON.stringify((root.stdout || "").trim()));
    const priv = await runCommand("cat /proc/1/root/etc/hostname 2>&1 | head -1 || echo BLOCKED");
    console.log("     info: /proc/1/root probe:", JSON.stringify((priv.stdout || "").trim()));
  } else if (scenario === "hostile-build") {
    hr("hostile CMakeLists: network (--network=none) + write-outside attempts");
    const { createRosPackage, buildRosWorkspace } = await import("./dist/ros-tools.js");
    const BWS = "/tmp/mw_hostile_ws";
    await rm(BWS, { recursive: true, force: true });
    await mkdir(`${BWS}/src`, { recursive: true });
    await createRosPackage("evil", `${BWS}/src`, "ament_cmake", [], "n");
    const cml = `${BWS}/src/evil/CMakeLists.txt`;
    const hostile = `cmake_minimum_required(VERSION 3.8)
project(evil)
execute_process(COMMAND bash -c "curl -m 5 -s http://1.1.1.1 >/dev/null 2>&1 && echo NET_REACHED || echo NET_BLOCKED" OUTPUT_VARIABLE NET)
execute_process(COMMAND bash -c "echo pwned > /etc/mw_pwned 2>/dev/null && echo ETC_WRITE_OK || echo ETC_WRITE_BLOCKED" OUTPUT_VARIABLE ETC)
execute_process(COMMAND bash -c "echo pwned > /tmp/mw_host_escape.txt 2>/dev/null && echo TMP_WRITE_OK || echo TMP_WRITE_BLOCKED" OUTPUT_VARIABLE TMP)
message(FATAL_ERROR "PROBE net=\${NET} etc=\${ETC} tmp=\${TMP}")
`;
    await writeFile(cml, hostile);
    await rm("/tmp/mw_host_escape.txt", { force: true });
    const b = await buildRosWorkspace(BWS);
    const probe = (b.stderr || "").match(/PROBE[^\n]*/)?.[0] || "(probe line not found)";
    console.log("     build probe:", probe);
    verdict(/net=NET_BLOCKED/.test(b.stderr || ""), "network blocked at configure time");
    verdict(/etc=ETC_WRITE_BLOCKED/.test(b.stderr || ""), "write to container /etc blocked (non-root)");
    let hostEscaped = true;
    try { await access("/tmp/mw_host_escape.txt"); } catch { hostEscaped = false; }
    verdict(!hostEscaped, "no host file written outside the mount");
    verdict(b.sandboxed === true, "build ran sandboxed", `image=${b.image} net=${b.network}`);
    await rm(BWS, { recursive: true, force: true });
  } else if (scenario === "pids") {
    hr("--pids-limit 512 under a real fork bomb (host-side measurement)");
    const hostBefore = (await pexec("bash", ["-c", "ps -e | wc -l"])).stdout.trim();
    // The workbench/job/build containers all carry --pids-limit 512 (confirmed by
    // docker inspect). Proving it CONTAINS an attack needs a PERSISTENT bomb: a
    // `docker exec` bomb's backgrounded children don't survive the exec exiting,
    // and once a container saturates it can't fork its own measurement. So we
    // launch a dedicated container with the SAME cap, a bomb that keeps PID 1
    // alive, and read its pid count from the HOST while it runs. (The memory cap
    // IS proven through the live run_command path - a foreground bomb survives to
    // be OOM-killed; a pid bomb's children don't survive to be counted.)
    await pexec("bash", ["-c", "docker rm -f mw_pidbomb >/dev/null 2>&1 || true"]);
    await pexec("bash", [
      "-c",
      "docker run -d --name mw_pidbomb --init --pids-limit 512 --memory 2g ubuntu:24.04 " +
        "bash -c 'for i in $(seq 2000); do sleep 300 & done; sleep 300'",
    ]);
    await sleep(4000);
    const pids = (await pexec("bash", ["-c", "docker stats --no-stream --format '{{.PIDs}}' mw_pidbomb"])).stdout.trim();
    const hostAfter = (await pexec("bash", ["-c", "ps -e | wc -l"])).stdout.trim();
    // Real property (same shape as the cpus test): with the bomb saturated, is the
    // HOST still responsive? Trivial host work should round-trip fast. We do NOT
    // assert on the host process count: container PIDs appearing in the host table
    // is an artifact of WHERE Docker runs - native on hosted runners (they show
    // up), in a Linux VM on Docker Desktop (they don't) - not a safety signal.
    const t0 = Date.now();
    await pexec("bash", ["-c", "for i in $(seq 200); do :; done"]);
    const hostLatency = Date.now() - t0;
    await pexec("bash", ["-c", "docker rm -f mw_pidbomb >/dev/null 2>&1 || true"]);
    console.log(`     dedicated container (cap 512, 2000 sleeps requested): host-side PIDs = ${pids}`);
    console.log(`     host process count before/after (informational, env-dependent): ${hostBefore} -> ${hostAfter}; host round-trip ${hostLatency}ms`);
    verdict(Number(pids) === 512, "cap SATURATED at 512 - bomb contained (did not reach 2000)", `pids=${pids}`);
    verdict(hostLatency < 2000, "host stayed responsive during the pid bomb", `round-trip ${hostLatency}ms`);
  } else if (scenario === "memory") {
    hr("memory bomb vs --memory 2g (host must stay healthy)");
    const freeBefore = (await pexec("bash", ["-c", "free -m | awk '/Mem:/{print $7}'"])).stdout.trim();
    const maxProbe = await runCommand("cat /sys/fs/cgroup/memory.max");
    const t0 = Date.now();
    // Fill RAM fast enough to hit the 2g cap on a 2-core hosted runner. Capture a
    // >2g stream into a shell variable: command substitution accumulates the whole
    // output in the PARENT bash's memory, so bash (highest RSS) is the OOM target
    // (exit 137). `tr` converts the NULs to a printable byte first, because bash
    // variables can't hold NUL. This replaces `tail /dev/zero`, which on a 2-core
    // runner did not reach 2g within a bounded time - a timeout-kill (124) proves
    // nothing about the cap. Throughput here is `tr`-bound (~GB/s), not core-bound,
    // so it crosses 2g in seconds regardless of how many cores the runner has.
    const bomb = "A=$(head -c 3000000000 /dev/zero | tr '\\0' 'a'); echo filled=${#A}";
    const r = await runCommand(bomb, 60000);
    const oom = await runCommand("grep oom_kill /sys/fs/cgroup/memory.events 2>/dev/null || echo none");
    console.log(`     memory.max=${(maxProbe.stdout||"").trim()}  attempt exit=${r.exitCode} timedOut=${r.timedOut} in ${Date.now() - t0}ms`);
    console.log(`     cgroup memory.events oom: ${(oom.stdout||"").trim()}`);
    await sleep(1500);
    const freeAfter = (await pexec("bash", ["-c", "free -m | awk '/Mem:/{print $7}'"])).stdout.trim();
    const still = await runCommand("echo container-still-responsive");
    console.log(`     host available MB before/after: ${freeBefore} -> ${freeAfter}`);
    const oomKilled = /oom_kill (\d+)/.exec(oom.stdout || "");
    verdict(r.exitCode === 137 || (oomKilled && Number(oomKilled[1]) > 0), "attacker OOM-killed at the 2g cap (exit 137 / oom_kill>0)", `exit=${r.exitCode}`);
    verdict(/still-responsive/.test(still.stdout || ""), "sandbox still usable after the bomb");
  } else if (scenario === "cpus") {
    hr("CPU spinner vs --cpus cap (host must stay responsive)");
    // Like pids/memory: a spinner burns CPU indefinitely and a docker-exec child
    // doesn't survive its exec, so measure a dedicated container capped at
    // --cpus 1 running ONE busy loop PER HOST CORE, read its CPU% from the HOST.
    // Uncapped it would read ~cores*100%; the cap should hold it near 100%.
    await pexec("bash", ["-c", "docker rm -f mw_cpubomb >/dev/null 2>&1 || true"]);
    const cores = (await pexec("bash", ["-c", "nproc"])).stdout.trim();
    await pexec("bash", [
      "-c",
      `docker run -d --name mw_cpubomb --init --cpus 1 --memory 1g --pids-limit 256 ubuntu:24.04 ` +
        `bash -c 'for i in $(seq ${cores}); do while :; do :; done & done; wait'`,
    ]);
    await sleep(5000);
    const cpu = (await pexec("bash", ["-c", "docker stats --no-stream --format '{{.CPUPerc}}' mw_cpubomb"])).stdout.trim();
    const t0 = Date.now();
    await pexec("bash", ["-c", "for i in $(seq 200); do :; done"]); // trivial host work
    const hostLatency = Date.now() - t0;
    await pexec("bash", ["-c", "docker rm -f mw_cpubomb >/dev/null 2>&1 || true"]);
    const cpuNum = parseFloat((cpu || "0").replace("%", "").trim());
    console.log(`     host cores=${cores}; container capped at --cpus 1; measured CPU=${cpu} (uncapped ~${Number(cores) * 100}%); host round-trip ${hostLatency}ms`);
    verdict(cpuNum > 0 && cpuNum <= 135, "CPU held near 1 core despite spinning all cores", `measured ${cpu}`);
    verdict(hostLatency < 2000, "host stayed responsive during the spinner", `round-trip ${hostLatency}ms`);
  } else {
    console.error("unknown scenario:", scenario);
    process.exit(2);
  }
}

main().then(() => {
  console.log(`\nADVERSARIAL SCENARIO DONE: ${scenario} (${FAILS} failed)`);
  process.exit(FAILS > 0 ? 1 : 0);
}).catch((err) => {
  // A thrown error is a fixture/environment failure, NOT a containment failure:
  // the guard under test was never exercised. Report it distinctly (exit 2) so it
  // reads at a glance as setup, not a breach.
  console.error(`\n**SETUP FAILED** (${scenario ?? "?"}): ${err?.message ?? err}`);
  console.error("  Fixture/environment error - the guard was never exercised.");
  process.exit(2);
});
