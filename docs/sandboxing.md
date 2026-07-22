# Docker sandboxing for millwright — design (APPROVED)

Status: **DESIGN APPROVED 2026-07-18 — not yet implemented.** All four
open questions answered in review (see Decisions at the bottom).
Implementation is on hold pending the product-name decision and the
MCPB install-experience report; when it starts, this doc is the spec.
Context: roadmap item, prioritized ahead of the blocklist-policy work.
The blocklist in `shell-tools.ts` is a stopgap; this is the real defense.

## Threat model (what we're actually defending against)

An LLM drives `workbench_shell` / `job_start` with arbitrary shell.
The threat is not a malicious user — it's a *confused or prompt-injected
model* wrecking the host: deleting files outside the project, mutating
system state, exfiltrating credentials it can read. The defense goal is
**blast-radius containment**, not perfect isolation. Out of scope: data
leaving via the conversation itself (the model legitimately reads what the
tools return — that's a privacy-policy matter, not a sandbox matter), and
kernel-level container escapes.

## What runs inside vs. outside

```
HOST (server process, Node)
├── MCP stdio endpoint, JobManager, zod schemas      — outside (always)
├── workspace_edit                                        — outside, but SCOPED (see below)
├── ROS introspection/control: list/graph/sample/
│   launch/restart, ros_pkg_new               — outside (DDS lives on the host)
├── ros_build                               — INSIDE a ROS container on Linux;
│                                                       host-side on Windows (PROMINENT
│                                                       limitation — see ROS section)
└── Linux lane: workbench_shell, job_start     — INSIDE the workbench container
```

- **The server itself stays on the host.** Containerizing the whole server
  would break the ROS lane (DDS discovery), complicate MCPB install, and
  gain little: the dangerous surface is command *execution*, not the
  server's own code.
- **Linux-lane execution moves into one long-lived "workbench" container**
  per server session: created lazily on first use (`docker run -d` with the
  workspace mount, official `ubuntu:24.04` image — decision: upstream
  images only, we publish nothing), then `docker exec` per command.
  Containers run with `--memory` and `--pids-limit` caps (decision: one
  flag each in v1) so a fork bomb or runaway build can't take down the
  host — which makes the blocklist's fork-bomb regex redundant when the
  sandbox is active: real defense replacing stopgap, exactly the intended
  direction. Background jobs become tracked `docker exec` processes —
  JobManager semantics (job_id, logs, SIGINT) carry over unchanged. One
  container per session (not per command) keeps apt installs and build
  caches usable *within* a session, at ~50–150 ms exec overhead per call.
- **workspace_edit stays host-side but gains a path allowlist**: when the
  sandbox is enabled, writes are restricted to the configured workspace
  root (realpath-checked, symlink-resolved). This gives filesystem scoping
  without containerizing the editor — same files, same speed.

## How ROS tools reach ROS (which lives on the host)

**Introspection/control (list, graph, sample, launch, restart) and
`ros_pkg_new` stay on the host in v1.** Reasons:

- ROS 2 discovery is host-scoped (DDS multicast / shared memory; zenoh
  router ports). A containerized `ros2 node list` sees nothing unless the
  container shares the host network AND the RMW agrees — `--network=host`
  works on native Linux/WSL2 but not meaningfully on Docker Desktop's VM
  on Windows, which is exactly our documented dev environment.
- These commands are structured (`ros2 <verb>`), not arbitrary shell, and
  the launch/restart tools only touch processes the server itself started
  (existing boundary). `ros_pkg_new` writes scaffolding inside the
  workspace, which the workspace_edit allowlist already scopes.

**`ros_build` is containerized in v1 on Linux hosts.** Decided
2026-07-18: a hostile `CMakeLists.txt` executes arbitrary code at
configure time, and "clone this repo and build it" is a completely normal
instruction for this tool — it's the most realistic attack path, so the
build lane can't be a hole. Mechanics: image `ros:<distro>-ros-base`
matching the user's distro, workspace bind-mounted at the identical
absolute path, `colcon build` inside the container. **No network access
needed**: building requires the ROS install and the workspace, not DDS
discovery — so this avoids the host-network problem entirely and the
build container can run with `--network=none` (deny-by-default lands here
first, whatever Q3 decides for the workbench).

### ⚠️ PROMINENT LIMITATION: Windows builds stay on the host in v1

On Windows the server runs Windows-side and reaches ROS through the
`wsl.exe` bridge; layering Docker on top means Docker Desktop socket +
cross-distro mount plumbing through that same bridge, which is exactly
the fragile path this design avoids in v1. Consequence, stated plainly:
**on Windows, `ros_build` executes CMake/colcon on the host
(inside WSL) with NO sandbox — a hostile CMakeLists.txt runs with your
user's privileges.** This must be:

1. **A runtime warning, not a doc footnote**: on Windows (or whenever the
   build runs unsandboxed), the `ros_build` result MUST include
   `sandboxed: false` and a `warning` string saying arbitrary code from
   the workspace's build files ran on the host — every call, not just the
   first.
2. Repeated in the README's security/limitations section and the MCPB
   long_description.
3. Revisited when the Windows story matures (e.g. server-in-WSL mode,
   where Linux-host mechanics apply and this carve-out disappears).

## Workspace mounting

New `user_config` entry `workspace_dir` (type `directory`). Mounted into
the workbench container **at the same absolute path** as on the host
(`-v /home/me/ws:/home/me/ws`), so compiler errors, colcon paths, and
`workspace_edit` targets are identical inside and outside — no path-mapping
layer for the model to get confused by. `workspace_edit`'s allowlist and the
container mount are the *same* directory, one mental model: "the sandbox
is this folder."

Windows + WSL note: the server runs on Windows (Desktop) but Docker and
the workspace live in WSL. Mount syntax then uses the WSL path; Docker
Desktop's WSL integration handles it. Path parity holds as long as the
workspace is given as a WSL path (which it must be anyway for colcon).

## Users without Docker

`sandbox_mode` user_config, enum: `"docker"` (default) | `"off"`.
A second field, `workbench_network`, enum `"all"` (default) | `"none"`,
ships in v1 even though the default is allow-all — the config surface is
being laid down now so tightening later isn't a breaking change. (The
build container ignores it: always `--network=none`.)

- `docker` + Docker present: behavior above.
- `docker` + Docker missing/not running: Linux-lane tools return
  `{available: false, message: "..."}` explaining the two choices —
  install/start Docker, or explicitly set `sandbox_mode: off`. **No silent
  fallback to unsandboxed execution.** Failing closed with a clear message
  matches the existing graceful-degradation pattern (ROS-absent, shell-
  absent) and makes the risk decision the *user's*, made once, visibly.
- `off`: current behavior, unsandboxed, with the stopgap blocklist still
  active. The install dialog wording should say plainly: "commands run
  directly on your machine."

## Default-on or opt-in?

**Recommendation: default-on for the MCPB install; `off` remains one
setting away.** Rationale: the .mcpb's audience is exactly the population
that won't audit what they install, and MCPB removed the technical filter
that manual JSON config imposed. Power users (you) flip one switch.

What default-on costs someone like you on your own machine — stated
honestly:

| Cost | Impact |
|---|---|
| Container can't see host services (localhost dev servers, DBs) | Real annoyance for general dev work; `off` or port-publish flags are the answers |
| `apt install` / tool state vanishes with the container | Per-session persistence only; a pinned project image is the durable fix |
| First-use latency | Image pull (~30 s–2 min once) + container start (~1 s/session) |
| Per-command overhead | ~50–150 ms per `docker exec` — negligible vs. builds, noticeable on `echo` |
| Bind-mount I/O on Docker Desktop | Meaningful slowdown for big builds vs. native WSL fs |
| GUI apps from the Linux lane | Won't render without WSLg socket mounts — but turtlesim etc. live in the host-side ROS lane anyway, so unaffected in practice |
| Docker Desktop must be running | Extra moving part; WSL idle RAM |

For this machine specifically: ROS work is untouched (host lane), and the
Linux lane is mostly builds/tests inside the workspace — the mount covers
it. Expected day-to-day friction: low, but not zero. If review disagrees
with default-on, the fallback position is: default-on only when installed
via MCPB, `off` default for manual configs (env `SANDBOX_MODE`).

## What this does NOT fix (so nobody over-trusts it)

- ROS introspection/control still executes on the host (structured
  commands, owned-process boundary — but host nonetheless).
- **On Windows, builds run unsandboxed on the host** (see the prominent
  limitation above — mitigated only by the runtime warning).
- `workspace_edit` can still write anything *inside* the workspace, including
  `.bashrc`-style files if the workspace is a home directory — the docs
  should tell users not to mount `~`.
- Secrets readable inside the mounted workspace are readable, period.
- Container escape via kernel exploit: out of scope.

## Decisions (review closed 2026-07-18)

All four open questions were answered in review; the design above already
incorporates them. Recorded here with rationale so they aren't relitigated:

1. **Containerize the build lane in v1 on Linux — YES.** "Clone this repo
   and build it" is a completely normal instruction for this tool, and a
   hostile CMakeLists.txt executes arbitrary code at configure time —
   the most realistic attack path. A sandbox with a build-shaped hole
   undercuts the whole story. Windows keeps the host-side build with the
   prominent per-call runtime warning (see ROS section).
2. **Official upstream images only; publish nothing of our own in v1.**
   Plain `ubuntu:24.04` for the workbench, official OSRF `ros:<distro>`
   for the build lane. Publishing our own image means a registry, rebuild
   cadence, CVE patching, and asking users to trust our supply chain —
   not worth it for a convenience we don't need. Revisit only if
   per-session setup cost becomes a real complaint.
3. **`--memory` and `--pids-limit` in v1 — YES.** One flag each; prevents
   a fork bomb or runaway build taking down the host. Note: `--pids-limit`
   makes the blocklist's fork-bomb entry redundant when the sandbox is
   active — real defense replacing stopgap is exactly the direction this
   project wants.
4. **Workbench network: allow-all in v1, toggle ships now.** Deny-by-
   default breaks npm/pip/apt/git-clone — most real usage. The
   `workbench_network` user_config field ships in this version anyway
   (default `"all"`) so the config surface doesn't change when the
   default tightens later. The build container stays `--network=none`
   regardless.
