# Millwright — Development Phases

Each phase has explicit **exit criteria**. A phase is not complete until every
criterion is validated against a live system, not merely implemented.

**Current position: Phase 5 (Distribution) — code-complete, provisioning-gated. Every engineering track is done and verified live (rename, Claude Code profile, version-in-results, multi-env breadth with the whole root-ownership class closed, fail-closed on all four instances). What remains is not code: a design asset (icon), a hosting decision (privacy URL), and a real box + real tester (cold trial → submission). CI green on GitHub through `9e64a01` (0.5.4). See the Phase 5 status pass at the end of this file.**
**Last updated:** 2026-07-29

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

**Resolved (0.4.4 / 0.4.5):** the `build_ros_workspace` containment gap — it was
the one path argument skipping `isInsideWorkspace`, so a Windows host-side build
could execute CMake from any directory — is closed. `workspace_path` is now
gated like `patch_file` / `create_ros_package` (with `allowRoot`, since building
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
author's machine; and the `build_ros_workspace` containment gap (4.1 open
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

### 5.1 Claude Code profile (clientInfo) — ergonomics, after 5.0 ✅ done 2026-07-22 (0.5.2)
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

### 5.2 Multi-environment breadth (was 4.3) — 🟡 partial (2026-07-22, 0.5.3)
Native Linux (non-WSL) and Windows-without-WSL. Gates the honesty of any "works
for a stranger" claim.

**What's validated (Approach A — direct uid assertion on native Docker):**
- CI runs on GitHub hosted ubuntu = **native Linux with a root Docker daemon**
  (not a Docker-Desktop VM). The sandbox adversarial suite, wire tests, and unit
  tests all run there — so the non-WSL code paths + sandbox behaviour are
  exercised on genuine native Linux.
- **The prediction held and surfaced a real bug.** A new `ownership` adversarial
  scenario asserts a `workbench_shell`-created file is owned by the invoking
  user, not root. It **surfaced that the workbench exec (and background jobs) ran
  as root** — leaving root-owned files a host-side `workspace_edit` couldn't
  touch. This reproduced *locally* on a WSL-path workspace (correcting the earlier
  "invisible on Docker Desktop" claim — see CLAUDE.md). **Fixed:** workbench exec
  + jobs now run as the host `uid:gid` (`--user`, `HOME=/tmp`), like builds; the
  `ownership` scenario is green and guards the regression in CI.
- **Windows-without-WSL (config-unset proxy):** a wire test asserts a ROS tool
  degrades to a clean `available:false` result (never a crash) when ROS is
  absent — the ROS-lane degradation path.

**Explicitly NOT covered (honest ⬜):**
- ⬜ **Desktop-install UX on native Linux** (Approach C — a real Linux box +
  Claude Desktop-for-Linux `.mcpb` install). Deferred to the cold-user trial
  (5.5) before submission; it needs a provisioned box and drags in Claude
  Desktop-Linux maturity as a separate variable.
- ⬜ **A true Windows-without-WSL host.** The config-unset test *simulates* the
  config-level absence; the machine still has WSL, so the `wsl.exe`-routing
  failure mode (no distro at all) is only approximated — a true test needs a
  Windows box without WSL (VM).
- ✅ **Windows-host workbench uid (0.5.4).** The Windows workbench exec no longer
  runs as root: it detects the WSL uid via `wsl.exe -d <distro> id` and passes
  `--user`, **failing closed** if it can't get a numeric uid (validates output, not
  the exit code — a bad distro exits 0). Proven first on a real Windows-node
  server (`workbench_shell` → uid-1000 file; host-side `workspace_edit` applied —
  was EPERM), then **confirmed live through the installed Claude Desktop extension**
  (0.5.4, full quit): `workbench_shell` created `uidtest.txt` owned by `ubuntu` not
  root, `workspace_edit` returned `"applied": true` — the 0.5.3 EPERM is gone.
  Failure modes unit-tested (`parseWslIdOutput`); CI green through `9e64a01`
  (#10, 2m18s). **The root-ownership class is now fully closed across all four
  instances** — build artifacts, native-Linux workspace files, WSL-path workspace
  files, and Windows-host workspace files — each fixed and guarded by the permanent
  `ownership` scenario against regression.
- ⬜ Host-side ROS introspection on native Linux (still Lyrical-only, accepted).

### 5.3 Brand assets — parallel track ⬜ (asset-gated, not code-gated)
Icon at all required sizes. Required for directory submission. Direction chosen
(monoline node-chevron); to be produced in Claude Design as a separate,
non-code task. No engineering dependency — does not block anything else.

### 5.4 Hosted privacy-policy URL — parallel track 🟡 (wired; pending Pages-enable + final text)
Required for directory review. **Approach: GitHub Pages from an orphan `gh-pages`
branch containing only `index.html`**, served at
`https://berry1200.github.io/millwright/`. (Chosen over a `/site` folder on `main`
because Pages' branch-deploy can only target `/ (root)` or `/docs` — a dedicated
subfolder isn't selectable — and an orphan branch keeps `main`'s `/docs` (phase
notes, incident records, memory) unpublished. See CLAUDE.md distribution-readiness
#5 for the full branch-strategy note.) **Done:** `manifest.privacy_policies` points
at the URL (0.5.5); the abandoned `site/` placeholder removed from `main`.
**Remaining, both non-engineering and user-side:** (1) replace the placeholder
`index.html` on `gh-pages` with the full policy text; (2) enable Pages in the repo
settings (Source = branch `gh-pages`, `/ (root)`) so the URL resolves. Goes ✅ once
the live URL loads the real policy.

### 5.5 Cold-user install trial ⬜ (needs a provisioned box + a real tester)
A real never-seen-it person installs and uses it. Depends on 5.0 (final names in
docs — done) and 5.2 (breadth, so the claim is honest — code-complete). This IS
the exit criterion "a stranger can install without asking questions." Planned as
a separate session with a genuine Linux box and a genuine first-time tester.

### 5.6 Directory submission ⬜
The convergence point. Depends on 5.0, 5.2, 5.3, 5.4, 5.5, plus accurate
README / changelog / versioning.

---

### Phase 5 status pass (2026-07-29)

The line that matters: **everything that is code is done and verified live.**
What's left is not engineering — it's an asset, a hosting choice, and access to a
machine and a stranger.

**✅ Genuinely done — code-complete AND verified live:**
- **5.0 rename** (0.5.0) — 13 semantic names, cross-file consistency + over-the-wire
  `tools/list` gates, now permanent CI tests.
- **5.1 Claude Code profile** (0.5.2) — `clientInfo` logged for diagnostics only,
  never gates the sandbox; all 13 tools kept; descriptions state the
  container-vs-host boundary. Plus `millwright_version` on every result (0.5.1).
- **5.2 breadth, Approach A** (0.5.3 + 0.5.4) — the honest, container-provable part
  of breadth: native-Linux non-WSL code paths + sandbox behaviour exercised on a
  real root Docker daemon in CI, and the **entire root-ownership class closed on
  all four instances** (build artifacts, native-Linux files, WSL-path files,
  Windows-host files), each guarded by the permanent `ownership` scenario. Windows
  fail-closed proven live in the installed Desktop extension.

**🟡 Substance-done, provisioning-deferred — the code is proven as far as a
container can prove it; the rest needs real hardware, and is deliberately NOT
ticked:**
- **5.2 breadth, the machine-dependent tail.** Three honest ⬜s remain and are
  unchanged: **Desktop-install UX on a real native-Linux box** (Approach C, drags
  in Claude-Desktop-for-Linux maturity as its own variable); **a true
  Windows-without-WSL host** (the config-unset test only *simulates* config-level
  absence — the box still has WSL); **host-side ROS introspection on native Linux**
  (still Lyrical-only, accepted). None is a code gap; each needs a provisioned box.

**⬜ Untouched — blocked on a non-code input, not on engineering:**
- **5.3 icon** — needs a design asset (direction chosen, being produced separately).
- **5.4 privacy URL** — 🟡 wired: hosted on an orphan `gh-pages` branch
  (`https://berry1200.github.io/millwright/`), `manifest.privacy_policies` filled
  (0.5.5). Remaining (user-side): swap the placeholder for the full policy text and
  enable Pages so the URL resolves.
- **5.5 cold trial** — needs a real box + a real first-time tester.
- **5.6 submission** — the convergence point; waits on 5.3–5.5.

**Verdict:** Phase 5's engineering is finished. The phase does not *close* until
the cold trial (5.5) actually happens and submission (5.6) is accepted — those are
its exit criteria, and neither can be self-certified by the author. Nothing left
on the critical path is code; the shortest path to "done" runs through a
provisioned machine and a stranger, not another commit.

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
