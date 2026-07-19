# Millwright — Development Phases

Each phase has explicit **exit criteria**. A phase is not complete until every
criterion is validated against a live system, not merely implemented.

**Current position: Phase 4 (Hardening), just started.**
**Last updated:** 2026-07-18

---

## Phase 0 — Foundation ✅ COMPLETE

Establish a working MCP server skeleton with the Linux execution layer.

**Delivered:** TypeScript project, stdio transport, `JobManager` process
registry, `run_command` with blocklist and truncation, background job tools.
Six tools total. Verified over real MCP `tools/list`.

**Key decision:** rejected forking Desktop Commander MCP. It carries large
unrelated surface area (PDF editing, Excel, Obsidian, remote pairing, telemetry).
Borrowed two patterns instead — persistent process management and zod-schema
tool registration.

**Exit criteria:** ✅ compiles clean · ✅ `tools/list` returns all tools ·
✅ `run_command` executes for real · ✅ ROS tools degrade gracefully when ROS absent

---

## Phase 1 — ROS validation ✅ COMPLETE

Install ROS 2 and validate every ROS tool against a live system.

**Environment established:** Windows 11 + WSL2, Ubuntu 26.04 "Resolute Raccoon",
ROS 2 Lyrical Luth, WSLg for GUI. (Initially assumed Ubuntu 24.04 / ROS Jazzy —
wrong, corrected during setup.)

**Three real bugs found and fixed:**
1. `sample_ros_topic` passed `messageType` as a positional to `ros2 topic echo`,
   failing hard on any stale type. turtlesim's messages had moved to
   `turtlesim_msgs` in Lyrical, so the documented type errored. Fix: drop the
   positional entirely; echo auto-resolves.
2. `list_ros_nodes` returned duplicates from discovery races.
3. `get_ros_graph` had a no-op ternary — `include_hidden=true` never actually
   added the flag.

**Exit criteria:** ✅ all five ROS tools exercised against live turtlesim ·
✅ ownership refusal path verified · ✅ CLAUDE.md reflects only what actually ran

---

## Phase 2 — The develop loop ✅ COMPLETE

Make the tools compose into a real edit → build → read error → fix cycle.

**Delivered:** `patch_file` (exact search/replace, refuses zero and ambiguous
matches, byte-identical on refusal, literal insertion with no regex expansion);
`create_ros_package`; `build_ros_workspace` returning real compiler errors.
Then `sample_ros_topic` rewritten to use one persistent subscription instead of
N cold starts — 20 messages in 1.5s versus ~1s startup *per message* previously.

**Validation caught a race:** the kill contract resolved the promise before
sending SIGINT. Fixed so "tool returned" implies "process is gone."

**Exit criteria:** ✅ full loop validated with a genuine gcc error ·
✅ `patch_file` all six cases verified on disk · ✅ zero orphaned processes ·
✅ MCP round-trip re-verified

---

## Phase 3 — Packaging and identity ✅ COMPLETE

Make it installable and give it a name that can survive public distribution.

**Delivered:** MCPB bundle (manifest_version 0.3), Apache-2.0 license, accurate
annotations on all 13 tools, three `user_config` settings, privacy policy,
graceful shell degradation, blocklist hardening (`rm -rf ~` now caught).

**Critical architectural finding:** Claude Desktop does **not** launch the server
from a ROS-sourced shell. Every ROS tool would have silently failed on a real
install. Required a `rosInvocation()` wrapper that sources the setup script
before every ROS call. This worked perfectly from a developer terminal and would
have broken for every real user.

**Naming:** "ROSNode" rejected — `rosnode` is a literal existing ROS 1 CLI tool,
and Open Robotics' trademark guidelines prohibit product-name use without
revocable written approval. Renamed to **Millwright**.

**Install findings:** double-clicking a `.mcpb` does not work on Windows (no file
association). Settings → Extensions → Advanced settings → Install Extension is the
working route. Generic tool names can lose to a client's built-in sandbox —
users may need to name the extension explicitly at first.

**Exit criteria:** ✅ `mcpb validate` passes · ✅ installs in Claude Desktop ·
✅ all 13 tools appear · ✅ verified end-to-end through the installed extension ·
⬜ icon assets (outstanding) · ⬜ name collision verification (outstanding)

---

## Phase 4 — Hardening 🔵 CURRENT

**Goal: make it safe for someone other than the author to install.**

This is the phase that separates a tool from a product. Claude Desktop's own
install warning — "this extension will have access to everything on your
computer" — is accurate today, and the one-click bundle *removes* the filter that
manual JSON config accidentally provided.

### 4.1 Sandboxing (spec approved, implementation pending)
Per `docs/sandboxing.md`:
- Workbench container (`ubuntu:24.04`) for the Linux lane via `docker exec`
- Workspace bind-mounted at the **same absolute path** inside and out
- Build container (OSRF `ros:<distro>`) with `--network=none`
- `patch_file` host-side with a path allowlist equal to the mount
- ROS introspection lane host-side in v1 (DDS doesn't survive Docker Desktop's VM)
- `--memory` and `--pids-limit` set
- Fail closed with no Docker; default-on for bundle installs
- Windows carve-out: host-side builds with `sandboxed: false` per-call warning

### 4.2 Configurable blocklist policy
Replace the hardcoded stopgap with a JSON/YAML policy. Note that `--pids-limit`
retires the fork-bomb rule when the sandbox is active.

### 4.3 Multi-environment validation
Jazzy and Humble; native Linux (non-WSL); Windows without WSL.

### 4.4 CI test suite
Convert the validation harnesses into automated tests. This is what prevents a
regression six months from now.

**Exit criteria:** ⬜ sandbox implemented and validated with real containers ·
⬜ escape attempts tested, not assumed · ⬜ validated on ≥2 ROS distros ·
⬜ tests run in CI · ⬜ install docs accurate for a cold user

---

## Phase 5 — Distribution ⬜ FUTURE

Get it into other people's hands legitimately.

- Public repo with accurate README, changelog, versioning
- Hosted privacy policy URL (required for directory review)
- Directory submission requirements met
- Brand assets complete (icon at all required sizes)
- Install documentation verified by someone who has never seen the project

**Exit criteria:** ⬜ a stranger can install and use it without asking questions ·
⬜ directory submission accepted

---

## Phase 6 — Simulation depth ⬜ FUTURE

Make the simulation-first promise real rather than architectural.

- Gazebo / Isaac Sim tools: `spawn_model`, `reset_pose`, `pause_physics`
- Simulation-gated hardware path with explicit approval
- Rosbag tools for recorded-data analysis

**Exit criteria:** ⬜ a robotics task can be developed, tested, and verified
entirely in simulation before any hardware is touched

---

## Phase 7 — Product layer ⬜ FUTURE

The difference between a toolbox and a product.

Fusion 360's value isn't its API surface — it's that it encodes *how to do the
work*. Millwright's equivalent is opinionated workflows:
- "Diagnose why my node isn't publishing"
- "Set up a new ROS package with tests"
- "Profile this node's CPU usage"

Plus a dashboard (job status, ROS graph, live log tail) — sequenced here, after
the sandbox determines what's visible, so the UI isn't built twice.

**Exit criteria:** ⬜ someone chooses Millwright over wiring up raw MCP servers
themselves, and can say why

---

## Sequencing principles

1. **Validate before extending.** Every phase ends with live validation. Building
   on unverified code compounds errors.
2. **Safety before reach.** Phase 4 gates Phase 5 absolutely. Do not distribute
   an unsandboxed tool that has full machine access.
3. **Don't build UI for unproven data.** The dashboard waits until the sandbox
   decides what's observable.
4. **Cheap-and-reversible first.** Packaging (Phase 3) came before hardening
   because it was cheap, surfaced real bugs, and forced the docs to exist.
