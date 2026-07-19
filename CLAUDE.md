# Millwright — project context

Read this file fully before making changes. It captures the research,
decisions, and reasoning behind this project so you don't have to
re-derive them. Update this file when you make significant decisions,
so the next session (human or AI) has the same context.

## Naming (decided 2026-07-18 — do not relitigate)

The product is **Millwright**. Tagline (trademark-compliant, use this
form): **"Millwright — an MCP server for Linux and ROS 2 development."**

History and rationale, so this doesn't get reopened:

- The original candidate name was **ROSNode**. Rejected for two
  independent reasons:
  1. **Trademark.** The official ROS Trademark Rules and Guidelines
     (ros.org) state the ROS trademarks "should not be used in names of
     companies, organizations, applications, products, or services
     without the prior written approval of Open Robotics" — and any
     permission granted is revocable at their sole discretion. "ROS" is
     a registered trademark (USPTO 90076684, Open Source Robotics
     Foundation) covering downloadable robot-control software — exactly
     this product's category.
  2. **Collision.** `rosnode` is a literal, existing ROS 1 CLI tool
     (`rosnode list/info/kill`), and "node" is the core unit of ROS
     vocabulary — the name was both unsearchable and confusing
     ("restart the ROSNode node").
- **Millwright** was chosen for exact semantic fit (the trade that
  installs, maintains, and fixes industrial machinery — this project's
  vision in one word), industrial-robotics character without any ROS
  vocabulary, and a near-empty search space in software.
- **Rules going forward:** ROS may only ever be used DESCRIPTIVELY
  ("an MCP server for Linux and ROS 2 development", "works with ROS 2"),
  never as part of the product name. Style it "ROS 2" — all caps, space
  before the version number, never plural or possessive.
- The MCP tool names (`run_command`, `list_ros_nodes`, ...) were
  deliberately NOT renamed — they're API surface; renaming would break
  existing configs for zero benefit.
- **Collision verification + conscious decision (2026-07-18/19).** The
  earlier "essentially clean" claim was WRONG; verified across npm, GitHub,
  and web:
  - npm `millwright` is TAKEN (a JS build tool, dormant since March 2017).
    Consequence: **if we ever publish to npm, publish scoped**
    (`@berryjames/millwright` or similar), not bare `millwright`.
  - `github.com/crertel/millwright` (crertel, minor.gripe blog, March 2026)
    is an agent tool-selection system — **the SAME ecosystem** (MCP / agent
    tooling). Currently a months-old personal project with no visible
    adoption. **This is the one to watch**: it's the only name clash that
    could actually cause confusion in our space.
  - Others (a Vintage Story game mod, real-world trade firms) are irrelevant.
  - **Decision (Berry James, 2026-07-19): keep Millwright.** No blocker
    today. Revisit ONLY if crertel/millwright gains real traction — at that
    point reassess whether a rename or clearer differentiation is worth it.
    The trademark rationale (no ROS in the name) is unchanged and separate.

## Vision

A model-agnostic MCP (Model Context Protocol) server that lets any LLM
(Claude, Codex, Gemini) act as a competent Linux developer AND a
competent ROS 2 robotics developer, through one consistent tool schema.
Write code, run it, test it in simulation, debug it, and — once
verified safe — operate real hardware.

Not a chat wrapper. An execution layer: the LLM calls tools, the tools
run real commands, real output comes back, the LLM reacts.

## Why this project, not something already built

We researched the space before writing code. Findings:

- **Multi-LLM CLI bridges already exist**: `ai-cli-mcp`, `claude-mcp-bridge`,
  `gemini-mcp-bridge`, `codex-mcp-server`, `tmux-bridge-mcp`. These solve
  "let one LLM call another's CLI." Useful pattern reference, not our
  core problem.
- **General Linux/terminal control already exists**: `Desktop Commander
  MCP` (6.8k+ stars) gives full terminal + filesystem control. We looked
  at its source (`wonderwhy-er/DesktopCommanderMCP`) and deliberately
  did NOT fork it — it carries a lot of unrelated surface area (PDF
  editing, Excel, Obsidian vaults, remote pairing, telemetry, a UI
  runtime) that we don't want to maintain. We borrowed its two useful
  patterns instead: persistent background-process management, and
  zod-schema tool registration.
- **ROS + LLM integration exists but is fragmented**: `ROSA` (NASA JPL,
  reference implementation, natural-language ROS diagnostics), `ros-mcp-server`,
  `rosbag-mcp`, `gazebo-mcp`. As of early 2026 there are 50+ robotics MCP
  servers but no single one that unifies general Linux dev work with ROS
  work under one tool schema and a simulation-first safety gate.
- **The gap we're filling**: nobody combines (a) general-purpose Linux
  coding tools, (b) ROS 2 introspection/control tools, and (c) a hard
  simulation-before-hardware safety boundary, in one MCP server with a
  consistent schema regardless of which LLM is calling it. That's this
  project.

## Architecture (5 layers)

1. **Interface layer** — chat/CLI/IDE. Not our concern; any MCP client works.
2. **Model router** — whichever LLM the user picked (Claude/Codex/Gemini).
   Not something we build — MCP is client-agnostic by design, this is
   handled by the client the user connects with.
3. **This MCP server** — the actual product. One consistent tool schema
   whether the underlying call is a shell command or a ROS command.
4. **Execution lanes**:
   - Linux sandbox lane: containers, git, tests, general dev work.
   - Simulation lane: Gazebo/IsaacSim, ROS nodes, robot control — always
     simulation-first.
5. **Safety & audit layer** — cuts across everything. Command
   allowlist/blocklist, output truncation, and critically: **real
   hardware is never touched directly from a prompt** — it sits behind
   the simulation-gated lane, approval required.

## Key design decisions (don't relitigate these without reason)

- **Async job pattern for anything long-running.** MCP tool calls are
  request/response; a raw `ros2 launch` or Gazebo sim would hang a call
  forever. Solution: `start_background_job` / `start_ros_launch_job`
  spawn, detach into a `JobManager` registry, return a `job_id`
  immediately. LLM polls `read_job_logs` / `list_background_jobs`.
- **`restart_ros_node` only restarts nodes this server launched itself**
  (tracked via `job.rosNodeName`). It refuses to touch processes it
  doesn't own. This is a deliberate safety boundary, not a limitation to
  "fix" — don't make this tool killable-by-name against arbitrary
  system processes.
- **Bounded output everywhere.** `run_command` truncates to ~200 lines
  (head + tail) so a runaway build log doesn't blow the LLM's context.
  `sample_ros_topic` takes a `max_messages` + `timeout_sec`, never a raw
  unbounded `topic echo`.
- **Graceful degradation when ROS isn't installed.** All ROS tools call
  `isRos2Available()` first and return a clear, actionable message
  (`available: false, message: "..."`) instead of throwing raw ENOENT.
  Verified working — see Testing done, below.
- **Small starter command blocklist**, not a full sandbox. Blocks
  obviously destructive patterns (`rm -rf /`, `mkfs`, `dd ... of=/dev/`,
  fork bombs). Real isolation is meant to come from running the whole
  server inside a container later (see Roadmap) — the blocklist is a
  backstop, not the primary defense.
- **Environment adaptation via `rosInvocation()` (added for MCPB).** MCP
  clients like Claude Desktop spawn the server WITHOUT a ROS-sourced shell,
  so "ros2 on PATH" became explicit config: if `ROS_SETUP_SCRIPT` is set
  (user_config `ros_setup_script`), every ros2/colcon command runs through a
  `bash -c` wrapper that sources it first — routed via `wsl.exe -d
  $ROS_WSL_DISTRO` on Windows, where `cwd`/`mkdir` also happen inside the
  wrapper script because WSL paths mean nothing to Windows Node. Values are
  passed as bash positional params, never spliced into shell source, so
  paths/topic names can't break quoting. Unset = legacy direct mode,
  byte-identical to pre-0.2 behavior.

## Current repo state (v0.3)

TypeScript, `@modelcontextprotocol/sdk`, stdio transport. Packaged as an
MCP Bundle (`manifest.json` manifest_version 0.3, `.mcpbignore`, pack via
`npx @anthropic-ai/mcpb pack`). Files:

```
manifest.json     MCPB manifest: 13 tools, user_config (ros_setup_script,
                  wsl_distro, shell_bin), privacy_policies
src/
  index.ts        entrypoint, connects server to stdio transport
  server.ts       registers all 13 tools with zod schemas
  job-manager.ts  background process registry (Linux + ROS jobs share this)
  shell-tools.ts  run_command + blocklist + truncation (exports truncateOutput);
                  shell binary configurable via SHELL_BIN env
  file-tools.ts   patch_file (exact search/replace file editing)
  ros-tools.ts    rosInvocation() env wrapper + list_ros_nodes, get_ros_graph,
                  sample_ros_topic, start_ros_launch_job, restart_ros_node,
                  create_ros_package, build_ros_workspace
```

Tools currently registered:
`run_command`, `patch_file`, `start_background_job`, `list_background_jobs`,
`read_job_logs`, `stop_background_job`, `list_ros_nodes`, `get_ros_graph`,
`sample_ros_topic`, `start_ros_launch_job`, `restart_ros_node`,
`create_ros_package`, `build_ros_workspace`.

### Testing done so far

- `npm run build` compiles clean (tsc, strict mode).
- Verified live over actual MCP protocol (stdio, manual JSON-RPC):
  `tools/list` returned all tools correctly. (That original run predated the
  11th tool `patch_file`; the full 11-tool set was later re-verified over the
  MCP stdio protocol — see "MCP protocol round-trip" below.)
  `run_command` executed `echo` + `uname -a` for real, correct output returned.
  `list_ros_nodes` correctly returned `{available: false, message: "..."}`
  at that time, since ROS 2 was not yet installed on the dev machine.
- **ROS layer validated live (2026-07-14)** against ROS 2 **Lyrical** +
  turtlesim on Ubuntu 26.04 (WSL2). The project was built in the Linux fs
  (`~/projects/millwright`, Node via nvm — no sudo) and a harness
  (`harness.mjs`, project root) imported the compiled functions and called
  each one for real against a live turtlesim. Per-function results:
  - `list_ros_nodes` — worked. **Fixed:** `ros2 node list` emitted the same
    node name twice (discovery race); output is now de-duplicated.
  - `get_ros_graph` — worked (1 node, 5 turtlesim topics). **Fixed** a latent
    no-op: `include_hidden` never actually passed `--include-hidden-topics`
    (both ternary branches were identical), so hidden topics could never be
    surfaced. Re-verified after the fix: `include_hidden=true` now additionally
    surfaces the hidden action topics
    `/turtle1/rotate_absolute/_action/{feedback,status}`.
  - `sample_ros_topic` — **was broken, now fixed.** Root cause was NOT the
    `--once` flag (valid in Lyrical) but the trailing `messageType` positional
    passed to `ros2 topic echo`: a stale/wrong type makes echo fail hard
    ("The passed message type is invalid"). turtlesim moved Pose to
    `turtlesim_msgs/msg/Pose`, so the long-documented `turtlesim/msg/Pose` now
    errors. Fix: stop passing the positional — `ros2 topic echo` resolves the
    type from the live topic itself. Now returns Pose YAML regardless of the
    type string the caller passes. Timing ~1.2s per single-message sample,
    well under the 3s default, so the wrapper timeout did NOT need changing.
    Follow-up: `message_type` is now `.optional()` in the `sample_ros_topic`
    zod schema (`server.ts`), documented as accepted-but-ignored, so callers
    aren't required to supply a value the tool no longer uses.
  - `start_ros_launch_job` — worked against turtlesim's real
    `multisim.launch.py`; brought up `/turtlesim1/turtlesim` and
    `/turtlesim2/turtlesim`.
  - `restart_ros_node` — worked for the owned launch job (stopped + relaunched
    under the same label); correctly refused a node it did not launch.
  turtlesim ran headless (`QT_QPA_PLATFORM=offscreen`); the compiled-default
  RMW discovered nodes fine with no zenoh router needed.
- **`patch_file` validated live (2026-07-14)** on real files via
  `patch-harness.mjs` (imports the compiled `patchFile` from `dist/`, mutates a
  sandbox file, and re-reads it from disk to confirm each result). All cases
  passed: unique-match apply; not-found refusal (file byte-identical); ambiguous
  2-match refusal without `replace_all` (file byte-identical); `replace_all`
  replacing both occurrences; missing-file refusal; and `$`-in-replacement
  inserted literally (on-disk text kept `$5 & $10 [$& $1 stay literal]` verbatim,
  proving no regex `$`-expansion). Registered in `server.ts` and also
  exercised end-to-end over the MCP stdio protocol (see next bullet).
- **Full MCP protocol round-trip verified live (2026-07-14)** via
  `mcp-roundtrip.sh` (+ `mcp-report.mjs`): spawned `dist/index.js` as a real
  stdio server and fed it raw newline-delimited JSON-RPC — `initialize`
  handshake, `notifications/initialized`, `tools/list`, then real `tools/call`s
  — exactly as an MCP client (Claude Desktop / Claude Code) would, NOT by
  importing the functions. Results: `initialize` negotiated protocol
  `2024-11-05`; `tools/list` returned all **11** tools; `sample_ros_topic`'s
  schema shows `required: ["topic_name"]` only, so `message_type` is genuinely
  optional over the wire, and calling it with NO `message_type` returned Pose
  YAML; `patch_file` called over the wire flipped `SECRET = 123` -> `SECRET =
  999` on disk; `list_ros_nodes` returned the deduped `["/turtlesim"]`. Every
  result matched the earlier function-level runs exactly — no discrepancies, so
  no fixes were needed.
- **ROS workspace tools + full develop loop validated live (2026-07-14)** via
  `workspace-harness.mjs` against real colcon on ROS 2 Lyrical. `create_ros_package`
  scaffolded an `ament_cmake` package (`dev_loop_demo`, dep `rclcpp`, node
  `demo_node`); `build_ros_workspace` built it (`success: true`, ~5.9s, real colcon
  output). Then the loop: `patch_file` appended a garbage token to `main()` ->
  `build_ros_workspace` returned `{ success: false, exitCode: 2 }` with the REAL
  gcc error in `stderr` (`error: expected initializer before 'GARBAGE_TOKEN_ZZZ'`
  plus the gmake failure chain) -> `patch_file` removed the token ->
  `build_ros_workspace` succeeded again (incremental, ~0.6s). This run also caught
  a wrong assumption: Lyrical's `ros2 pkg create` C++ template has NO `return 0;`
  line (implicit return, `[[maybe_unused]]` params), so the first break anchor
  didn't match — `patch_file` correctly returned `applied: false` (search not
  found) instead of silently mis-editing, which is exactly the guardrail it's for.
- **Persistent-subscription `sample_ros_topic` validated live (2026-07-18)** via
  `sample-harness.mjs` against turtlesim (`/turtle1/pose` publishes ~62 Hz).
  Results: `max_messages=1` -> 1 msg in ~2.0s; `max_messages=5` -> 5 msgs in
  ~1.3s; `max_messages=20` -> 20 msgs in ~1.5s (the old N-cold-starts design
  would have paid ~1s startup PER message). Timeout path: `/turtle1/cmd_vel`
  (exists — turtlesim subscribes — but nothing publishes) with a 4s budget
  returned `sampled: 0, timed_out: true` in ~4.2s. Error path: a nonexistent
  topic returned `process_exited_early, exit_code: 1` with the real stderr
  ("Could not determine the type for the passed topic") in ~0.5s. Orphan checks:
  `ps -ef | grep 'topic echo'` was clean immediately after every single call and
  at the end. NOTE the first harness run FAILED that check: `finish()` resolved
  the promise before the SIGINT landed, so ps caught the still-dying child —
  fixed by only resolving after the child's exit is confirmed (the fix is the
  wait-for-exit contract now described in roadmap #4). The full MCP round-trip
  (`mcp-roundtrip.sh`) was then re-run: `tools/list` returns all **13** tools,
  and `sample_ros_topic` called over the wire with `max_messages: 3` returned
  `sampled: 3` clean YAML docs (no trailing `---`), with zero orphan processes
  after the run.
- **MCPB bundle validated three ways (2026-07-18).** `mcpb validate` passes;
  packed 6.4MB (1934 files; src/harnesses excluded via `.mcpbignore`).
  (1) *Legacy direct mode* (ROS_SETUP_SCRIPT unset, WSL): sample-harness
  re-run — identical results, zero orphans, so manual-config users see no
  change. (2) *Wrapper mode* (ROS_SETUP_SCRIPT set, node process deliberately
  UNSOURCED — exactly how a desktop app spawns servers): all ROS tools worked
  through the sourcing wrapper — node list, hidden-topic graph, sample x3
  (1.8s), create+colcon build (5.5s), launch multisim, restart. (3) *Windows
  simulation of Claude Desktop*: extracted the actual packed .mcpb on the
  Windows side and spawned it with Windows Node using the manifest's literal
  mcp_config (env substituted as Desktop would). All 13 tools listed;
  run_command, patch_file (Windows path), list_ros_nodes (via wsl.exe
  routing!), and sample_ros_topic max_messages:3 -> sampled:3 all correct;
  ps inside WSL afterward: zero orphaned `topic echo` processes — the kill
  contract holds through the wsl.exe indirection. Observed: on this machine
  `bash` on the Windows PATH resolves to the WSL bridge, so run_command
  output showed the WSL kernel (see Distribution readiness #7).
- **Installed-extension verification completed (2026-07-18).** The user
  installed `millwright-0.3.0.mcpb` through Claude Desktop's real install
  dialog (found: `.mcpb` has NO file association on a fresh Windows box —
  `assoc .mcpb` errors — so double-click may do nothing; drag-and-drop into
  the Desktop window or Settings > Extensions > Advanced > Install
  Extension are the reliable paths). Post-install, the extension's 13 tools
  came up live and were exercised through the installed server with the
  user's real config values (`/opt/ros/lyrical/setup.bash`, `Ubuntu`,
  `bash`): `list_ros_nodes` -> `/turtlesim`; `run_command` -> WSL kernel
  via the bash bridge; `sample_ros_topic max_messages:3` -> `sampled: 3`
  clean YAML docs; zero orphaned `topic echo` processes afterward. This
  closes the last NOT-verified item from the MCPB round of testing.
- **User install report (2026-07-18), three findings, all acted on:**
  1. *Install route*: double-click failed with a Windows "open with" app
     picker (Claude Desktop not listed); Settings > Extensions > Advanced
     settings > Install Extension worked. README now leads with the
     Settings route and calls double-click unreliable on Windows.
  2. *Config-field UX*: the ros_setup_script description packed four ideas
     (path format, sourcing rationale, Windows caveat, blank case) into
     one paragraph, and the install UI reuses the description as the
     in-box placeholder, so it read as a wall of text. Fixed: description
     is now example-first and terse; the four ideas live in the README.
     The short fields (wsl_distro, shell_bin) were fine as-is — pattern
     to follow for future config.
  3. *Tool routing*: the user's first "run uname -a" was routed to
     Claude's BUILT-IN sandbox (hostname `claude`, Ubuntu 22.04), not
     Millwright — generically-named tools lose to built-ins until the
     extension is named explicitly ("Using Millwright, ..."), after which
     routing sticks. Mitigations: run_command's description (server +
     manifest) now says it runs on the user's REAL system and to prefer
     it when the user means their own machine; README tells users to name
     the extension in first prompts. Keep this in mind for any future
     generically-named tool.
- **Docker sandbox validated live (2026-07-19)** via `sandbox-harness.sh`
  (one process per scenario; real containers on Docker 29.6.1 via Docker
  Desktop WSL integration — enabled during this session by setting
  `EnableIntegrationWithDefaultWslDistro: true` in Docker's
  settings-store.json). Scenario results:
  - *off*: byte-identical legacy behavior (host kernel, no allowlist).
  - *unavailable* (poisoned DOCKER_HOST): fails CLOSED with guidance;
    the probe command never executed.
  - *workbench*: exec in Ubuntu 24.04 container as root; workspace mount
    visible; container REUSED across calls (same hostname); `docker
    inspect` confirms Memory=2147483648, Pids=512; blocklist still active;
    network default reachable; `WORKBENCH_NETWORK=none` -> "Network is
    unreachable". Timeout: `sleep 30` under a 3s budget returned in 3.2s
    with exitCode 124 + timedOut, and the inner process was killed by the
    container-side coreutils timeout.
  - *allowlist*: patch inside ws applies; outside ws refused byte-intact;
    sandbox-on-without-workspace_dir refused with actionable guidance
    while run_command still works (no mount).
  - *jobs*: attached `docker run` streams logs into JobManager; stop
    terminates AND removes the container; `--rm` cleans; status reports
    `killed` for deliberate stops.
  - *build lane*: create-outside-ws refused; full break/fix loop ran in
    `ros:lyrical-ros-base` with network=none (success 1.6s, real gcc
    error through the container, fix, success); artifacts visible AND
    deletable on the host.
  - Leak check after every scenario: zero `millwright-*` containers.
  **Three real bugs the harness caught (all fixed + re-verified):**
  (1) stopping a sandboxed job stranded its container — PID-1 bash
  ignores SIGINT, SIGKILL only killed the docker client; fixed with
  `--init` + force-remove-by-name on stop + a session-label exit sweep.
  (2) zombie processes accumulated in the workbench after timeouts —
  PID-1 `sleep infinity` reaps nothing; fixed with `--init` (tini).
  (3) build artifacts landed ROOT-OWNED in the mounted workspace (host
  user couldn't delete build/COLCON_IGNORE); fixed by running the build
  container as the host uid:gid.
- **Adversarial validation (2026-07-19)** via `adversarial-harness.mjs` —
  genuine break-out attempts, not just fence inspection. All contained:
  - *patch_file path traversal*: `<ws>/../../../etc/passwd`, extra-depth,
    `./`-normalized, `%2e%2e`-encoded, the prefix-sibling trap
    (`/tmp/mw_ws_evil/...`), and bare `/etc/passwd` — ALL refused;
    /etc/passwd byte-unchanged. (realpath + symlink resolution + `startsWith(root+sep)`.)
  - *symlink escape*: a file-symlink and a dir-symlink inside the workspace
    pointing at /etc — both refused (realpath resolves before the check).
  - *workbench escape*: a host sentinel file outside the mount was NOT
    visible in the container; `/var/run/docker.sock` absent; `docker` CLI
    absent; `/proc/1/root` showed the container's own root, not the host.
  - *hostile CMakeLists* (build lane): `curl` at configure time → network
    unreachable (`--network=none`); write to container `/etc` → blocked
    (non-root); no host file written outside the mount; build ran in
    `ros:lyrical-ros-base`.
  - *fork bomb* vs `--pids-limit 512`: a dedicated container requesting 2000
    sleeps SATURATED at exactly 512 (host-side `docker stats`); host process
    table unmoved; turtlesim alive. NOTE: a `docker exec` bomb's children
    don't survive the exec exiting, and a saturated container can't fork its
    own measurement — hence the dedicated-container + host-side measurement.
  - *memory bomb* (`tail /dev/zero`) THROUGH run_command vs `--memory 2g`:
    OOM-killed (exit 137, cgroup `oom_kill 1`) at the 2g cap; host memory
    barely moved; sandbox still usable after.
  - **The harness caught two of its own measurement flaws** (pgrep absent in
    the minimal image; bash string-doubling too slow to reach 2g), both
    fixed before any cap was reported as validated — i.e. no cap was
    green-lit on a silent no-op. Honest residual gap: no `--cpus` cap in v1
    (see Distribution readiness #1).
- **ROS introspection harness re-run against 0.4.0 (2026-07-19)**: all five
  tools green (list_ros_nodes, get_ros_graph incl. hidden, sample_ros_topic
  both type args, start_ros_launch_job, restart_ros_node + refusal). Closes
  the "not re-run post-sandbox" gap — that lane is unchanged by the sandbox.

## Roadmap (priority order)

1. **[DONE 2026-07-14] Install ROS 2 (Lyrical Luth for Ubuntu 26.04) +
   turtlesim; validate every ROS tool for real.** Completed — see
   "Testing done so far". Three real defects found and fixed in
   `ros-tools.ts`: `sampleRosTopic` type positional, `listRosNodes`
   duplicate entries, `getRosGraph` include-hidden no-op. The predicted
   `sampleRosTopic` adjustment was real, though the cause differed from the
   guess (the message-type positional, not the `--once` flag).
2. **[DONE 2026-07-14] `patch_file` tool** — diff-based file editing
   (exact search block / replace block) instead of round-tripping whole
   files through the LLM. Implemented in `src/file-tools.ts`, registered
   in `server.ts`. Refuses zero-match and ambiguous multi-match edits
   (unless `replace_all`), leaves the file byte-for-byte unchanged on any
   refusal, and inserts replacement text literally (no `$&`/`$1` regex
   expansion). Validated on real files via `patch-harness.mjs` — see
   "Testing done so far".
3. **[DONE 2026-07-14] ROS 2 workspace tools** — `create_ros_package`
   (wraps `ros2 pkg create`) and `build_ros_workspace` (wraps `colcon
   build`, bounded + output-truncated like run_command, returning the real
   compiler errors in `stderr` on failure). With `patch_file` these close
   the develop loop: scaffold -> edit -> build -> read the compiler errors
   -> patch -> rebuild. Validated live against real colcon — see "Testing
   done so far".
4. **[DONE 2026-07-18] Harden `sample_ros_topic` for `max_messages > 1`.**
   Replaced the N-cold-starts loop (per-message budget of `timeout_sec /
   max_messages` that SHRANK as N grew, plus ~1s startup per message) with
   a single persistent `ros2 topic echo` subscription: stdout is buffered
   and complete `---`-terminated YAML documents are peeled off as they
   stream (partial documents stay in the buffer until terminated), stopping
   at N messages or when the overall `timeout_sec` budget elapses. The
   child is killed on every exit path (SIGINT, SIGKILL after 2s, plus a
   3.5s failsafe so the call can never hang), and the tool only returns
   AFTER the child's exit is confirmed — "returned" implies "subscription
   gone". Return-shape notes: messages no longer include the trailing
   `---` separator; a short read is flagged `timed_out: true`; a child
   that dies early (e.g. nonexistent topic) returns
   `process_exited_early` + its real stderr. Validated live — see
   "Testing done so far".
5. **[DONE 2026-07-18] Package as an MCP Bundle (`.mcpb`).**
   `manifest.json` (manifest_version 0.3) with all 13 tools, user_config
   for the previously buried env assumptions (`ros_setup_script`,
   `wsl_distro`, `shell_bin`), README Privacy Policy section +
   `privacy_policies` manifest field, `mcpb validate` passing, packed at
   6.4MB. Validated three ways — see "Testing done so far". Version
   bumped to 0.2.0 (package.json, manifest, serverInfo).
6. **Make the blocklist a configurable policy** (JSON/YAML), not
   hardcoded in `shell-tools.ts`.
7. **[DONE 2026-07-19] Docker sandboxing** — implemented per the approved
   spec in `docs/sandboxing.md` (v0.4.0, `src/sandbox.ts`). Default-on
   (`sandbox_mode=docker`): run_command + background jobs execute in a
   per-session `ubuntu:24.04` workbench (`--init`, `--memory 2g`,
   `--pids-limit 512`, workspace mounted at the identical path, container
   reused across calls, session-labeled + swept on exit); patch_file and
   create_ros_package are confined to `workspace_dir`; Linux colcon builds
   run in `ros:<distro>-ros-base` with `--network=none`, `--init`, and the
   HOST uid:gid; Windows builds stay host-side with a mandatory per-call
   warning; Docker-unavailable fails CLOSED with guidance. Timeouts are
   enforced INSIDE the container (coreutils `timeout`), because killing
   the docker client alone leaves the inner process running. Validated
   live against real containers — see "Testing done so far".
8. **Gazebo/IsaacSim-specific tools** — `spawn_model`, `reset_pose`,
   `pause_physics`. Build after ROS layer is verified against turtlesim.
9. **Dashboard** (Claude Design candidate, not yet) — job status, ROS
   graph, log tail. Sequence this AFTER the ROS layer is verified live —
   don't build a UI for data we haven't confirmed is real.

## INCIDENT 2026-07-19 — a project directory was emptied (read this)

`~/projects/vigil247` was emptied ~09:06 in a separate Claude Desktop session
running Millwright 0.4.0, with `workspace_dir` set to **`~/projects`** — the
parent of ALL projects. Millwright was a suspect. Investigation outcome:

- **Millwright's shipped code contains NO file-deletion logic.** Deterministic
  source audit: every destructive op is `docker rm -f <container>` /
  `docker run --rm` (containers by name/ID) — no `rm` of files, no `git clean`,
  no `docker volume prune`, no `fs.rm`/`unlink` against any path. The
  session-label cleanup sweep and force-remove operate on container IDs only.
- **Ruled out**: colcon-build-against-parent (no `build/install/log` artifacts
  at `~/projects` root); vigil247 is a Python project, not ROS, so ROS tools
  weren't operating on it.
- **Could NOT determine root cause.** vigil247 was restored from a backup zip
  at 10:08 (its own GitHub repo `berry1200/vigil247` exists), which overwrote
  the original inode/state; Docker WSL integration was off and events were
  gone; the incident session's tool calls were non-interactive + containerized
  so they never hit `~/.bash_history` (which showed only the user's own
  interactive recovery: `rm -rf vigil247` + unzip). **Honest answer: I cannot
  confirm whether Millwright issued the deleting command.**
- **The real design flaw, independent of what fired**: a whole-`~/projects`
  bind mount is pass-through, so ANY destructive command inside the sandbox
  (`rm -rf <mount>/<project>`, `git clean`, etc.) deletes real host files
  across every project, and the blocklist does NOT catch deep/relative targets
  like `rm -rf vigil247` (it only guards `/`, `~`, `$HOME`, `/home`).
- **FORENSICS LESSON (process fix).** The single most damaging move for the
  investigation was restoring vigil247 from `vigil247.zip` at 10:08 — it
  recreated the directory (new inode/birth time) and overwrote the emptied
  state BEFORE anyone captured it. Combined with `--rm` containers already gone
  and Docker events not surviving restarts, this left the root cause
  undiagnosable. **Rule for next time: when something is destroyed, SNAPSHOT
  first, restore second.** Concretely, before any recovery: copy the damaged
  dir as-is (`cp -a`/tar), `stat` it, save `docker ps -a`/`docker inspect`
  output and `~/.bash_history`, note the wall-clock time. Recovery can wait five
  minutes; the evidence cannot. (Recorded here and worth adding to
  `docs/rules.md`.)

**Fixes shipped 0.4.1 → 0.4.2 (2026-07-19):**
- **0.4.1** `isInsideWorkspace` refuses the workspace ROOT itself (patch_file /
  create_ros_package act only on paths strictly beneath it). Unit-verified.
- **0.4.1** `run_command` description rewritten — the 0.3.0 "runs on your REAL
  system" text was false under default sandboxing and caused the confusion in
  that session.
- **0.4.2 broad-workspace split** (per user decision): `workspaceHardRefusal()`
  HARD-REFUSES a filesystem/drive/home root (`/`, `/home`, `$HOME`, `/root`,
  `/mnt/<drive>`) at every sandbox entry point (run_command, jobs, build,
  patch/create) BEFORE Docker is touched — no click-past. A directory that
  merely holds multiple repos (e.g. `~/projects`) is still ALLOWED (blocking it
  would push users to disable sandboxing) but `workspaceScopeWarning()` now
  rides in `run_command`/`build`/`create` RESULTS, not just startup. All
  unit-verified without Docker.

**Still-open (the real, harder fix):**
- Even the root guard + hard-refusal does NOT stop `rm -rf <ws>/<child>` inside
  an allowed multi-repo workspace. The only robust protections are (a) scoping
  `workspace_dir` to a SINGLE project (user is doing this), and (b) a future
  NON-passthrough mount (copy-in/overlay) so container writes don't hit host
  files directly. (b) remains unbuilt.

## Distribution readiness — honest blockers (as of 2026-07-18)

The .mcpb installs and runs, but do NOT hand this to strangers yet:

1. ~~No sandbox behind a one-click install~~ **LARGELY RESOLVED
   2026-07-19**: Docker sandbox implemented and validated, default-on
   (see roadmap #7 and `docs/sandboxing.md`). Remaining honest gaps:
   Windows builds run on the host (per-call warning); ROS
   introspection/launch stays host-side by design (structured commands,
   owned-process boundary); `sandbox_mode: off` restores the old
   unsandboxed behavior; workbench runs as root inside the container, so
   files it writes into the mounted workspace are root-owned on the host
   (build lane fixed to host uid:gid; workbench kept root so apt works —
   documented tradeoff). Adversarially validated 2026-07-19 (six break-out
   attempts, all contained — see "Testing done so far"). Remaining sandbox
   gap: **no `--cpus` limit in v1**, so a CPU spinner degrades the shared
   Docker Desktop VM (not the Windows host) for its duration — pids/memory
   are capped, CPU is not. Candidate follow-up.
2. **Single-environment validation**: Ubuntu 26.04 + Lyrical + WSL2 only.
   Jazzy/Humble "supported" via ros_setup_script but never actually run;
   plain-Linux Claude Desktop untested. *(macOS: resolved 2026-07-18 by
   dropping the `darwin` claim from manifest compatibility — ROS on macOS
   isn't realistically supported upstream.)*
3. ~~Windows-without-WSL breaks non-gracefully~~ **FIXED 2026-07-18**:
   a missing shell now returns `{shell_available: false, message}` with
   install/config guidance, mirroring the ROS tools' degradation.
4. ~~No LICENSE~~ **FIXED 2026-07-18**: Apache-2.0 (chosen over MIT for
   the explicit patent grant + automatic contribution licensing, §5);
   LICENSE file + `license` field in manifest and package.json.
5. **`privacy_policies` needs a public URL for directory review** — the
   policy text lives in README (good) but there's no public repo/site to
   host it; directory submission requires a real URL. STILL OPEN.
6. ~~No tool annotations~~ **FIXED 2026-07-18**: all 13 tools carry
   explicit `title`/`readOnlyHint`/`destructiveHint`/`idempotentHint`/
   `openWorldHint` (all four set explicitly because spec defaults are
   permissive). Destructive: run_command, patch_file, start_background_job
   (arbitrary exec — added beyond the obvious five), stop_background_job,
   restart_ros_node, build_ros_workspace. Verified over the wire.
7. **run_command's `bash` resolution on Windows is PATH-dependent** —
   observed live: it resolved to the WSL bridge bash, so shell commands
   silently ran in WSL, not Windows. Mitigated by the `shell_bin` setting
   but the default remains PATH-dependent. STILL OPEN (support burden).
8. **JobManager state is per-process**: Desktop restarts the server per
   session, so restart_ros_node ownership doesn't survive restarts.
   STILL OPEN.

## Development environment

- **Host**: Windows 11 with WSL2, Ubuntu 26.04 "Resolute Raccoon", WSLg
  enabled (GUI apps like turtlesim/rviz2 render natively on the Windows
  desktop, no X server config needed). Confirmed via `wsl --version` and
  the apt codename (`resolute`) during setup - initially assumed 24.04,
  that was wrong, corrected here.
- **ROS distro**: Lyrical Luth (LTS, released May 2026), not Jazzy -
  Jazzy targets Ubuntu 24.04, Lyrical Luth is the distro built for
  26.04. Install package is `ros-lyrical-desktop`, setup script is
  `/opt/ros/lyrical/setup.bash`. If you see references to Jazzy
  anywhere in this repo's history, they're stale - Lyrical is correct.
- **Keep the project inside the Linux filesystem** (`~/projects/...`),
  not under `/mnt/c/...` — meaningfully faster for npm/colcon builds.
- **Source of truth is a git repo at `~/projects/millwright`**
  (git-inited 2026-07-14, canonical in the WSL Linux fs). The earlier habit
  of hand-copying files between `D:\Linux CLI\project` (Windows) and this
  dir is RETIRED — that manual sync was a silent-drift risk. `dist/` and
  `node_modules/` are gitignored; `package-lock.json` IS committed. Edit
  here directly; from a Windows session the repo is reachable at
  `\\wsl.localhost\Ubuntu\home\berry_james\projects\millwright`
  (Read/Edit over that UNC path works). Any `D:\Linux CLI\...` copies are
  now stale — do not edit them.
- Run both Node and `ros2` from inside the WSL Ubuntu terminal. Claude
  Code should also be launched from inside WSL for this project, not
  from Windows, so it has direct access to `ros2` on PATH.
- Sanity check before debugging anything else: `ros2 run turtlesim
  turtlesim_node` should pop a window on the Windows desktop. If it
  doesn't, that's a WSLg/environment issue, not a bug in this server.

## How to work in this repo

- This is a from-scratch project being built collaboratively (human +
  Claude, across both claude.ai chat and Claude Code). Chat is used for
  architecture/research/diagrams; Claude Code is used for hands-on
  implementation, running ROS locally, and iterating.
- Keep the "Testing done so far" section honest and current — note
  what's actually been run and verified vs. what's written but untested.
  Don't let compiled-but-unrun code get described as "working."
- When you make an architecture-affecting decision, add it to "Key
  design decisions" above so it isn't relitigated later.
