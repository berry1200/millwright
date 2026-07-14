# linux-ros-mcp-bridge — project context

Read this file fully before making changes. It captures the research,
decisions, and reasoning behind this project so you don't have to
re-derive them. Update this file when you make significant decisions,
so the next session (human or AI) has the same context.

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

## Current repo state (v0.1)

TypeScript, `@modelcontextprotocol/sdk`, stdio transport. Files:

```
src/
  index.ts        entrypoint, connects server to stdio transport
  server.ts       registers all 11 tools with zod schemas
  job-manager.ts  background process registry (Linux + ROS jobs share this)
  shell-tools.ts  run_command implementation + blocklist + truncation
  file-tools.ts   patch_file (exact search/replace file editing)
  ros-tools.ts    list_ros_nodes, get_ros_graph, sample_ros_topic,
                  start_ros_launch_job, restart_ros_node
```

Tools currently registered:
`run_command`, `patch_file`, `start_background_job`, `list_background_jobs`,
`read_job_logs`, `stop_background_job`, `list_ros_nodes`, `get_ros_graph`,
`sample_ros_topic`, `start_ros_launch_job`, `restart_ros_node`.

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
  (`~/projects/linux-ros-mcp-bridge`, Node via nvm — no sudo) and a harness
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
3. **Harden `sample_ros_topic` for `max_messages > 1`** (recorded, not
   yet done). The current loop cold-starts a fresh `ros2 topic echo
   --once` per message with a per-message timeout of `timeout_sec /
   max_messages` — i.e. the budget SHRINKS as you ask for more messages,
   while each fresh echo also pays ~1s of process/discovery startup. Fine
   for `max_messages=1` (the only path exercised so far, ~1.2s), but
   fragile and slow for multi-message capture. Future fix: a single
   persistent subscription that captures N messages, instead of N cold
   starts. Unvalidated — nothing calls it with `max_messages > 1` yet.
4. **Make the blocklist a configurable policy** (JSON/YAML), not
   hardcoded in `shell-tools.ts`.
5. **Docker sandboxing for `run_command`** — run the target environment
   in a container, bind-mount the working dir, so `apt-get` and system
   changes are contained. This is the real safety layer; the blocklist
   is a stopgap until this lands.
6. **Gazebo/IsaacSim-specific tools** — `spawn_model`, `reset_pose`,
   `pause_physics`. Build after ROS layer is verified against turtlesim.
7. **Dashboard** (Claude Design candidate, not yet) — job status, ROS
   graph, log tail. Sequence this AFTER the ROS layer is verified live —
   don't build a UI for data we haven't confirmed is real.

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
- **Source of truth is a git repo at `~/projects/linux-ros-mcp-bridge`**
  (git-inited 2026-07-14, canonical in the WSL Linux fs). The earlier habit
  of hand-copying files between `D:\Linux CLI\project` (Windows) and this
  dir is RETIRED — that manual sync was a silent-drift risk. `dist/` and
  `node_modules/` are gitignored; `package-lock.json` IS committed. Edit
  here directly; from a Windows session the repo is reachable at
  `\\wsl.localhost\Ubuntu\home\berry_james\projects\linux-ros-mcp-bridge`
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
