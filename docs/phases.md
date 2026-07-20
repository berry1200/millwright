# Millwright — Development Phases

Each phase has explicit **exit criteria**. A phase is not complete until every
criterion is validated against a live system, not merely implemented.

**Current position: Phase 4 (Hardening) — exit review 2026-07-20, recorded in Phase 4 below.**
**Last updated:** 2026-07-20

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
⬜ icon assets (outstanding — blocks Phase 5 directory submission, not Phase 4) ·
✅ name collision verification (done 2026-07; findings and the conscious keep-decision in CLAUDE.md)

---

## Phase 4 — Hardening 🔵 CURRENT

**Goal: make it safe for someone other than the author to install.**

This is the phase that separates a tool from a product. Claude Desktop's own
install warning — "this extension will have access to everything on your
computer" — is accurate today, and the one-click bundle *removes* the filter that
manual JSON config accidentally provided.

### 4.1 Sandboxing ✅ implemented and adversarially validated
Per `docs/sandboxing.md`:
- Workbench container (`ubuntu:24.04`) for the Linux lane via `docker exec`
- Workspace bind-mounted at the **same absolute path** inside and out
- Build container (OSRF `ros:<distro>`) with `--network=none`
- `patch_file` host-side with a path allowlist equal to the mount
- ROS introspection lane host-side in v1 (DDS doesn't survive Docker Desktop's VM)
- `--memory` and `--pids-limit` set
- Fail closed with no Docker; default-on for bundle installs
- Windows carve-out: host-side builds with `sandboxed: false` per-call warning

Delivered as specced, plus beyond it: a `--cpus` limit (default 2, configurable),
session-labelled container cleanup, and — post-incident — a workspace-root
hard-refusal with a multi-repo scope warning surfaced in tool results
(0.4.2/0.4.3).

**Open finding (2026-07-20 verification):** `build_ros_workspace` does not
containment-check its `workspace_path` argument. `patch_file` and
`create_ros_package` are gated to the configured workspace; builds are not, on
either lane — observed live: a Windows host-side build succeeded against a
directory *outside* the configured workspace. Covered by the carve-out warning's
"only build workspaces you trust", but inconsistent with the one-folder mental
model, and on Windows it means host-executed CMake from any path.

### 4.2 Configurable blocklist policy ⬜ not started
Replace the hardcoded stopgap with a JSON/YAML policy. Note that `--pids-limit`
retires the fork-bomb rule when the sandbox is active.

### 4.3 Multi-environment validation 🟡 partial
Jazzy and Humble: ✅ for the containerized build lane (real builds in
`ros:jazzy-ros-base` and `ros:humble-ros-base`). The host-side introspection
lane is accepted as **Lyrical-only** — a documented decision, not a gap being
closed. Native Linux (non-WSL) ⬜ and Windows without WSL ⬜ are untested
(graceful degradation for the latter is coded, unverified).

### 4.4 CI test suite 🟡 written, never executed
Convert the validation harnesses into automated tests. This is what prevents a
regression six months from now.

**Status:** the tiered suite exists and is green locally (Tier-1 unit tests,
Tier-2 sandbox suite against real Docker), but both GitHub runs to date died in
a confirmed GitHub Actions outage — the workflow has **never executed on
GitHub**. Local green does not satisfy this item.

**Exit criteria (reviewed 2026-07-20):**

- ✅ sandbox implemented and validated with real containers — limits confirmed
  statically (`docker inspect`) and dynamically under load
- ✅ escape attempts tested, not assumed — six adversarial scenarios (path
  traversal, symlink escape, workbench isolation, hostile CMakeLists, pids
  bomb, memory bomb, CPU spinner), all contained, zero leaked containers
- ✅ **build lane** validated on ≥2 ROS distros (Lyrical + Jazzy + Humble);
  introspection lane accepted as Lyrical-only, documented. *Criterion rewritten
  2026-07-20: the original "validated on ≥2 ROS distros" implied whole-server
  coverage the introspection lane doesn't have — ticking it unqualified would
  have been self-deception.*
- ⬜ tests run in CI — written and locally green, never executed on GitHub
  (Actions outage); local green does not count
- 🟡 install docs accurate for a cold user — author-corrected (Docker
  prerequisite up front, `Sandbox CPU limit` documented, Workspace folder
  marked effectively required, fail-closed explained), but never exercised by
  an actual cold user; that test belongs to Phase 5

### Phase 4 exit review (2026-07-20)

**Genuinely done:** both safety-critical criteria (real-container validation,
adversarial escape testing), plus beyond-spec hardening: `--cpus`, fail-closed
without Docker, workspace-root hard-refusal, multi-repo scope warning.

**Verified through a live MCP client connection (2026-07-20):**
outside-workspace patch refusal (exact coded message, echoing the configured
root), inside-workspace patch applied and confirmed on disk, Windows build
carve-out `sandboxed: false` + warning present in a real result, Docker-absent
fail-closed message returned to a real client. Caveat: that connection ran a
stale pre-0.4.3 server process (its config snapshot predated the incident), so
the 0.4.3-specific guards — workspace-ROOT refusal, dangerous-root
hard-refusal — still need one pass through the freshly installed extension.
The stale process is itself a lesson: settings changes only apply after the
server restarts, and the refusal messages double as a readout of which config
is actually live.

**Self-deception risks named:** the distro criterion held only for the build
lane (now rewritten); CI exists but has never run — an unexecuted suite
prevents no regressions; every validation so far was by the author on the
author's machine; and the `build_ros_workspace` containment gap (4.1 open
finding) surfaced only because live verification deliberately targeted a
directory outside the configured workspace.

**Smallest remaining set before handing to one other person:**
1. ⬜ verify the 0.4.3 guards through the installed extension
   (`sandboxed: true` on run_command; patch inside/outside the workspace;
   ROOT and dangerous-root refusals)
2. ✅ fire the Windows build carve-out — warning observed in a real result
3. ✅ README: `Sandbox CPU limit` documented, Workspace folder marked
   effectively required, Docker stated as an up-front hard prerequisite
4. ✅ README: Docker-absent fail-closed described as expected behavior

CI green is regression prevention, not a handoff gate for one trusted person.

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
