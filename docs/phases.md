# Millwright — Development Phases

Each phase has explicit **exit criteria**. A phase is not complete until every
criterion is validated against a live system, not merely implemented.

**Current position: Phase 4 (Hardening) COMPLETE (2026-07-21) — all five exit criteria met, CI green on GitHub. Deferred sub-items 4.2/4.3 do not gate the phase; see verdict. Phase 5 not started.**
**Last updated:** 2026-07-21

---

## Phase 0 — Foundation ✅ COMPLETE

Establish a working MCP server skeleton with the Linux execution layer.

**Delivered:** TypeScript project, stdio transport, `JobManager` process
registry, `workbench_shell` with blocklist and truncation, background job tools.
Six tools total. Verified over real MCP `tools/list`.

**Key decision:** rejected forking Desktop Commander MCP. It carries large
unrelated surface area (PDF editing, Excel, Obsidian, remote pairing, telemetry).
Borrowed two patterns instead — persistent process management and zod-schema
tool registration.

**Exit criteria:** ✅ compiles clean · ✅ `tools/list` returns all tools ·
✅ `workbench_shell` executes for real · ✅ ROS tools degrade gracefully when ROS absent

---

## Phase 1 — ROS validation ✅ COMPLETE

Install ROS 2 and validate every ROS tool against a live system.

**Environment established:** Windows 11 + WSL2, Ubuntu 26.04 "Resolute Raccoon",
ROS 2 Lyrical Luth, WSLg for GUI. (Initially assumed Ubuntu 24.04 / ROS Jazzy —
wrong, corrected during setup.)

**Three real bugs found and fixed:**
1. `ros_topic` passed `messageType` as a positional to `ros2 topic echo`,
   failing hard on any stale type. turtlesim's messages had moved to
   `turtlesim_msgs` in Lyrical, so the documented type errored. Fix: drop the
   positional entirely; echo auto-resolves.
2. `ros_nodes` returned duplicates from discovery races.
3. `ros_graph` had a no-op ternary — `include_hidden=true` never actually
   added the flag.

**Exit criteria:** ✅ all five ROS tools exercised against live turtlesim ·
✅ ownership refusal path verified · ✅ CLAUDE.md reflects only what actually ran

---

## Phase 2 — The develop loop ✅ COMPLETE

Make the tools compose into a real edit → build → read error → fix cycle.

**Delivered:** `workspace_edit` (exact search/replace, refuses zero and ambiguous
matches, byte-identical on refusal, literal insertion with no regex expansion);
`ros_pkg_new`; `ros_build` returning real compiler errors.
Then `ros_topic` rewritten to use one persistent subscription instead of
N cold starts — 20 messages in 1.5s versus ~1s startup *per message* previously.

**Validation caught a race:** the kill contract resolved the promise before
sending SIGINT. Fixed so "tool returned" implies "process is gone."

**Exit criteria:** ✅ full loop validated with a genuine gcc error ·
✅ `workspace_edit` all six cases verified on disk · ✅ zero orphaned processes ·
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
- `workspace_edit` host-side with a path allowlist equal to the mount
- ROS introspection lane host-side in v1 (DDS doesn't survive Docker Desktop's VM)
- `--memory` and `--pids-limit` set
- Fail closed with no Docker; default-on for bundle installs
- Windows carve-out: host-side builds with `sandboxed: false` per-call warning

Delivered as specced, plus beyond it: a `--cpus` limit (default 2, configurable),
session-labelled container cleanup, and — post-incident — a workspace-root
hard-refusal with a multi-repo scope warning surfaced in tool results
(0.4.2/0.4.3).

**Resolved (0.4.4 / 0.4.5):** the `ros_build` containment gap — it was
the one path argument skipping `isInsideWorkspace`, so a Windows host-side build
could execute CMake from any directory — is closed. `workspace_path` is now
gated like `workspace_edit` / `ros_pkg_new` (with `allowRoot`, since building
the workspace root is the normal colcon flow). 0.4.5 additionally translates
model-supplied POSIX paths to host-addressable form BEFORE the gate, closing a
Windows-wide hole where a container-native path (`/home/...`) failed to resolve
host-side and never reached the guard at all. Translate-then-gate is
adversarially verified on win32: `/mnt/c/...`→`C:\...` (incl. a real
`C:\Windows\...\hosts`) and post-translation `..` escapes are refused.

### 4.2 Configurable blocklist policy ⬜ not started
Replace the hardcoded stopgap with a JSON/YAML policy. Note that `--pids-limit`
retires the fork-bomb rule when the sandbox is active.

### 4.3 Multi-environment validation 🟡 partial
Jazzy and Humble: ✅ for the containerized build lane (real builds in
`ros:jazzy-ros-base` and `ros:humble-ros-base`). The host-side introspection
lane is accepted as **Lyrical-only** — a documented decision, not a gap being
closed. Native Linux (non-WSL) ⬜ and Windows without WSL ⬜ are untested
(graceful degradation for the latter is coded, unverified).

### 4.4 CI test suite ✅ green on GitHub
Convert the validation harnesses into automated tests. This is what prevents a
regression six months from now.

**Status (2026-07-21): green on GitHub.** After the Actions outage cleared, the
first real runs exposed two *measurement* artifacts on the hosted 2-core runner
(not safety failures): the pids test asserted on the host process table (container
PIDs are visible under native Docker but not under Docker Desktop's VM), and the
memory bomb (`tail /dev/zero`) couldn't fill 2g in bounded time on 2 cores. Both
were fixed to measure the real property — host responsiveness for pids, a
core-independent allocator for memory — without loosening a threshold. Run on
`acdb4b8` is **green**: unit + sandbox jobs both pass, ~2m27s, containers
genuinely ran. `actions/checkout` + `setup-node` bumped v4→v7 (Node 24 runtime).

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
- ✅ tests run in CI — **confirmed green on GitHub** (`acdb4b8`, ~2m27s): Tier-1
  unit (12/12) + Tier-2 sandbox suite against real containers. Two runner-specific
  measurement artifacts were fixed to test the real property, not thresholds.
- ✅ install docs accurate for an installed user — Docker prerequisite up front,
  `Sandbox CPU limit` documented, Workspace folder marked effectively required,
  fail-closed explained, stale-server restart + refusal-readout documented. A
  true never-seen-it cold trial remains a Phase 5 item.

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
author's machine; and the `ros_build` containment gap (4.1 open
finding) surfaced only because live verification deliberately targeted a
directory outside the configured workspace.

**Smallest remaining set before handing to one other person:**
1. ✅ verified the guards through the INSTALLED extension (2026-07-21): patch
   applies inside the workspace; refuses an outside path by name with the live
   `workspace_dir` in the parenthetical; hard-refuses the workspace ROOT; passes
   the gate on an in-workspace absent file (stops only on absence). Raw JSON on
   file. The six-session verification gap is closed.
2. ✅ fire the Windows build carve-out — warning observed in a real result
3. ✅ README: `Sandbox CPU limit` documented, Workspace folder marked
   effectively required, Docker stated as an up-front hard prerequisite
4. ✅ README: Docker-absent fail-closed described as expected behavior
5. ✅ refusal messages no longer advertise disabling the sandbox — containment
   and config refusals rewritten to state the boundary and the legitimate paths
   (move the file in, or rescope `workspace_dir` + restart). The Docker-absent
   message still names the opt-out: it is a missing-dependency notice, not a
   containment refusal.

**Verdict (2026-07-21): Phase 4 is CLOSED.** All five exit criteria are met and
independently verified — real-container validation, adversarial escape testing
(including the 0.4.5 translation attack surface), the rewritten distro criterion,
install-doc accuracy, and now a confirmed-green CI run on GitHub (`acdb4b8`).
Critically, the guards are verified through the *installed* extension, not just
by module import.

**Still honestly not done, and deliberately NOT ticked:**
- **4.2 configurable blocklist** — still the hardcoded stopgap. Not an exit
  criterion, and the `--pids-limit` cap already retires the fork-bomb rule under
  the default sandbox, so it does not gate the safety goal. Deferred to a later
  hardening pass.
- **4.3 breadth** — native-Linux-non-WSL and Windows-without-WSL remain untested
  (graceful degradation for the latter is coded, unverified).

**Does either block handing this to one other person? No — with one scoping
condition.** For a second person on the *same* Windows + WSL2 + Docker Desktop
setup, neither 4.2 nor 4.3 blocks: the safety guards, sandbox, and install docs
are all verified for that configuration. 4.3 breadth is the gate for *broad*
distribution — a stranger on native Linux or Windows-without-WSL — which is
Phase 5's job, not Phase 4's. So: **closed for a one-person WSL handoff; 4.3 must
close before Phase 5 distribution.**

---

## Phase 5 — Distribution ⬜ FUTURE

**Goal: a stranger can install and use Millwright without asking the author
questions, and it's accepted into a public directory.**

Sequenced by what actually blocks what. The critical path runs through the tool
rename; three independent tracks converge with a cold-user trial at submission.

### 5.0 Tool rename — the front gate (breaking; do FIRST) ✅ done 2026-07-22 (0.5.0)
Tool names are API. While the author is the only user the rename is free; after
one handoff it is a breaking change for someone else, and `run_command` had
already lost a call to a client's built-in once. Renamed to a semantic scheme
that makes ownership AND the sandbox boundary unambiguous (which also does the
disambiguation 5.1 needs):

| Old | New |
|---|---|
| run_command | workbench_shell |
| patch_file | workspace_edit |
| start_background_job | job_start |
| list_background_jobs | job_list |
| read_job_logs | job_logs |
| stop_background_job | job_stop |
| list_ros_nodes | ros_nodes |
| get_ros_graph | ros_graph |
| sample_ros_topic | ros_topic |
| start_ros_launch_job | ros_launch |
| restart_ros_node | ros_restart |
| create_ros_package | ros_pkg_new |
| build_ros_workspace | ros_build |

Internal handler names stay (`runCommand`, `patchFile`, …). One atomic commit,
`0.5.0`. Two gates enforced before "done": (a) a cross-file name-consistency
check (server.ts ↔ manifest ↔ README ↔ CLAUDE.md — a 13-name rename is where a
four-of-five typo hides); (b) over-the-wire `tools/list` proving all 13 new names
appear and zero old names survive. Author re-runs the four guard checks against
the new names after a fresh install (renaming shouldn't change guard behaviour,
but that's an assumption until installed).

### 5.1 Claude Code profile (clientInfo) — ergonomics, after 5.0 ⬜
MCP `initialize` carries `clientInfo` (name/version), currently ignored. In
Claude Code, Millwright's shell/file tools overlap with native ones that run on
the HOST while ours run in a CONTAINER — same session, two filesystems, the
path-confusion class we already hit.
- **Decision: keep all 13 tools; do NOT reduce the set for Claude Code.** The
  sandboxed shell's whole value there is the isolation native Bash doesn't
  provide; hiding it throws away the differentiator, and a tool surface that
  changes on a spoofable field is unpredictable.
- The 5.0 rename does the real disambiguation (the name signals
  container-vs-host); descriptions state the boundary ("runs in a container;
  only the workspace is shared with the host").
- `clientInfo` is used ONLY for ergonomics: log it on the startup banner
  (diagnostics), optionally sharpen descriptions when it is Claude Code.
  **Never gate the sandbox on it** — it is self-reported and spoofable; sandbox
  posture stays config-driven (`SANDBOX_MODE`). Baseline descriptions must be
  correct without it.

### 5.2 Multi-environment breadth (was 4.3) — parallel track ⬜
Native Linux (non-WSL) and Windows-without-WSL, currently untested. Gates the
honesty of any "works for a stranger" claim. **Expect the uid-mapping
root-ownership class here** (see Engineering lessons in CLAUDE.md): native Docker
is genuinely root, unlike Docker Desktop's uid-mapped VM.

### 5.3 Brand assets — parallel track ⬜
Icon at all required sizes. Required for directory submission.

### 5.4 Hosted privacy-policy URL — parallel track ⬜
Required for directory review.

### 5.5 Cold-user install trial ⬜
A real never-seen-it person installs and uses it. Depends on 5.0 (final names in
docs) and 5.2 (breadth, so the claim is honest). This IS the exit criterion "a
stranger can install without asking questions."

### 5.6 Directory submission ⬜
The convergence point. Depends on 5.0, 5.2, 5.3, 5.4, 5.5, plus accurate
README / changelog / versioning.

**Sequencing warning (don't fool yourself):** icon (5.3) and privacy-URL (5.4)
are the easy, visible tasks — doing them first manufactures the *illusion* of
Phase 5 progress while the rename (the actual blocker) slips and gets more
expensive with every day there's a second user. 5.0 goes first (done); icon /
privacy-URL / breadth are independent tracks, never a reason to defer the gate.

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
