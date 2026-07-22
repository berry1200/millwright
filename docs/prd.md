# Millwright — Product Requirements Document

**Version:** 0.3.0
**Status:** Working tool, pre-distribution. Not yet safe for third-party install.
**Last updated:** 2026-07-18

---

## 1. What Millwright is

Millwright is a Model Context Protocol (MCP) server that gives any MCP-compatible
LLM — Claude, Codex, Gemini — the ability to actually operate a Linux machine and
a ROS 2 robotics stack, rather than only describe how to.

The name comes from the trade: a millwright installs, aligns, maintains, and
repairs industrial machinery. That is precisely the role this software plays for
a developer's Linux and robotics environment.

**One-sentence pitch:** an execution layer that lets a language model work as a
competent Linux developer and a competent ROS 2 robotics developer through one
consistent tool schema.

### The problem

Coding assistants stop at the editor. They write code but cannot compile it, run
it, read the compiler error, inspect a live robot, or restart a failing node.
The developer becomes a manual relay: copy the error out of the terminal, paste
it into the chat, copy the fix back, run it again. On robotics work this loop is
especially expensive because the feedback lives in places a chat window cannot
reach — the ROS computational graph, sensor topics, simulator state, colcon build
logs.

### The insight

The loop closes if the model can execute and observe. Given `build →
read real stderr → patch → rebuild`, a model can iterate without the human in the
middle. This is already proven in the codebase: a deliberately broken C++ node
produced a genuine gcc error through `ros_build`, which `workspace_edit`
then fixed, with the rebuild passing — no human interpretation at any step.

---

## 2. Target users

### Primary — the robotics developer on Linux
Works in ROS 2, spends significant time on the write/build/launch/inspect/debug
cycle. Comfortable in a terminal; uses an AI assistant already but is frustrated
by the copy-paste relay. Values not having to re-explain the environment on
every prompt.

### Secondary — the Linux developer
Doesn't touch ROS. Wants an assistant that can genuinely run commands, manage
background processes, and edit files in place. Millwright's Linux layer works
standalone with no ROS installed — ROS tools degrade with a clear message rather
than failing.

### Tertiary — robotics teams and labs
Want a consistent, auditable interface between AI assistants and shared robot
infrastructure, with hard boundaries around what an AI may touch. This audience
is **blocked until sandboxing ships** and is explicitly not a v0.x target.

### Explicit non-users (for now)
- Anyone wanting autonomous unsupervised operation. Millwright executes discrete
  tool calls; it is not a background agent.
- Anyone controlling production robot hardware directly. The design is
  simulation-first, and hardware control is deliberately not exposed.

---

## 3. Product principles

1. **Model-agnostic.** The tool schema is identical regardless of which LLM
   calls it. Switching models must never require rewriting tool definitions.
2. **Prove it, don't assume it.** No feature is "done" because it compiles.
   Every tool is validated against a live system before being marked complete.
   This has already caught four real bugs that review alone missed.
3. **Fail closed, fail loud.** When a precondition is missing (no ROS, no shell,
   no Docker), tools return a clear, actionable message — never a silent
   fallback to a less-safe path, never a raw ENOENT.
4. **Own what you touch.** Tools do not act on processes or files they did not
   create or were not explicitly pointed at. `ros_restart` refuses to
   restart nodes Millwright didn't launch.
5. **Simulation before hardware.** Real actuators sit behind simulation, always.
6. **Honest documentation.** Docs record what was actually tested, what is merely
   written, and what is known broken.

---

## 4. Feature set

### 4.1 Shipped (v0.3.0) — 13 tools

**Linux execution layer** (works with no ROS installed)

| Tool | Purpose |
|---|---|
| `workbench_shell` | Bounded shell execution. Blocklist check, output truncation (~200 lines head+tail), hard timeout. |
| `job_start` | Spawns a long-running process, returns a `job_id` immediately. |
| `job_list` | Lists all tracked jobs with status. |
| `job_logs` | Tails stdout/stderr for a job. |
| `job_stop` | SIGINT, then SIGKILL after a grace period. |

**File editing**

| Tool | Purpose |
|---|---|
| `workspace_edit` | Exact search/replace. Refuses zero-match and ambiguous multi-match (unless `replace_all`), leaves the file byte-identical on refusal, inserts replacement text literally with no regex expansion. |

**ROS 2 introspection and control**

| Tool | Purpose |
|---|---|
| `ros_nodes` | Active nodes, de-duplicated, optional filter. |
| `ros_graph` | Nodes + topics as structured JSON, with working hidden-topic support. |
| `ros_topic` | Bounded topic capture via one persistent subscription. Never hangs. Type is auto-resolved. |
| `ros_launch` | Launches a package/launch file as a tracked background job. |
| `ros_restart` | Restarts a node Millwright launched. Refuses unowned processes. |

**Workspace management**

| Tool | Purpose |
|---|---|
| `ros_pkg_new` | Wraps `ros2 pkg create`. |
| `ros_build` | Wraps `colcon build`, returning real compiler errors in `stderr` on failure. |

### 4.2 Packaging

- Distributed as an MCP Bundle (`.mcpb`), manifest_version 0.3, for single-click
  install in Claude Desktop.
- Three user-configurable settings: `ros_setup_script`, `wsl_distro`, `shell_bin`.
- Apache-2.0 licensed. All 13 tools carry accurate MCP annotations
  (`readOnlyHint`, `destructiveHint`, etc.).

### 4.3 Approved but not implemented — sandboxing

Full spec committed at `docs/sandboxing.md`. Summary:

- Linux lane (`workbench_shell`, background jobs) runs inside a long-lived per-session
  workbench container via `docker exec`, on plain `ubuntu:24.04`.
- Workspace bind-mounted **at the same absolute path** inside and outside, so
  paths never change meaning for the model.
- Build lane runs in an official OSRF `ros:<distro>` container with
  `--network=none` — the most locked-down component, since builds need ROS but
  not DDS discovery.
- `workspace_edit` stays host-side with a path allowlist equal to the mount.
- ROS introspection lane stays host-side in v1 (DDS discovery does not survive
  Docker Desktop's VM on Windows).
- `--memory` and `--pids-limit` set. No Docker → tools fail closed.
- Default-on for bundle installs, one visible setting away from off.
- **Windows carve-out:** builds run host-side, with `sandboxed: false` plus a
  warning string in every affected result.

### 4.4 Backlog

- Configurable blocklist policy (replacing the hardcoded stopgap)
- Multi-distro validation (Humble, Jazzy) and native-Linux validation
- CI test suite replacing ad-hoc validation harnesses
- Gazebo / Isaac Sim tools (`spawn_model`, `reset_pose`, `pause_physics`)
- Dashboard: job status, ROS graph, live log tail
- Opinionated workflow prompts ("diagnose why my node isn't publishing")

---

## 5. Success criteria

**v0.x (current) — works for its author**
- [x] All 13 tools validated against live ROS 2
- [x] Full develop loop proven with real compiler errors
- [x] MCP protocol round-trip verified over stdio
- [x] Installs as a `.mcpb` and runs from Claude Desktop
- [ ] Icon and brand assets complete

**v1.0 — safe for others**
- [ ] Sandboxing implemented and validated
- [ ] Validated on at least two ROS distros and native Linux
- [ ] Automated test suite in CI
- [ ] Install documentation accurate for a cold user
- [ ] Name collision verification completed

**v2.0 — a product, not a tool**
- [ ] Workflow layer that encodes *how* to do robotics tasks, not just what tools exist
- [ ] Listed in the Claude connector directory
- [ ] Dashboard for job/graph visibility

---

## 6. Known limitations (as of 0.3.0)

| Limitation | Severity | Notes |
|---|---|---|
| No sandboxing | **Blocking for distribution** | Tools act as the OS user, unscoped. Claude Desktop's own install warning states the extension gets access to everything on the computer — accurate. |
| Blocklist is a stopgap | High | Trivially bypassable by design. Sandbox is the real defense; the blocklist must not be grown as a substitute. |
| Single-environment validation | High | Only Ubuntu 26.04 + ROS 2 Lyrical + WSL2 has been exercised. Jazzy/Humble are believed to work but untested. |
| Windows without WSL | Medium | ROS tools degrade politely; shell tools now do too, but the path is untested. |
| No CI tests | Medium | Validation harnesses are manual scripts. |
| `.mcpb` double-click does not install on Windows | Medium | No file association; Windows shows an "open with" dialog. Settings → Extensions → Advanced settings is the working route. |
| Generic tool names may lose to built-ins | Medium | `workbench_shell` can be shadowed by a client's own sandbox. Users may need to name Millwright explicitly at first. |
| Job ownership does not survive restarts | Low | `ros_restart` loses track of jobs across Claude Desktop session restarts. |
| Icon is a placeholder | Low | Brand assets outstanding. |
