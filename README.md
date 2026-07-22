# Millwright

**Millwright — an MCP server for Linux and ROS 2 development.**

A model-agnostic [MCP](https://modelcontextprotocol.io) server that lets any
MCP-capable LLM (Claude, Codex, Gemini, …) work as a competent **Linux
developer** and **ROS 2 robotics developer** through one consistent tool schema.
It's an execution layer, not a chat wrapper: the model calls tools, the tools
run real commands, real output comes back, the model reacts. Like the trade
it's named for, it installs, maintains, and fixes your machines' software.

> Deeper design notes, decisions, and the full live-testing log live in
> [`CLAUDE.md`](./CLAUDE.md).

## Status

**v0.5** — 13 tools over stdio, installable as an MCP Bundle (`.mcpb`),
Docker-sandboxed by default. Validated live (2026-07) on **Ubuntu 26.04**
(WSL2):

- **ROS 2 Lyrical Luth** — every ROS tool, `workspace_edit`, a full MCP JSON-RPC
  round-trip, and the create → edit → build develop loop, all against a live
  turtlesim, not mocked.
- **`ros_build` also validated on Jazzy and Humble** — the build
  runs in the matching `ros:<distro>-ros-base` container, so it is genuinely
  distro-portable; verified building a package in `ros:jazzy-ros-base` and
  `ros:humble-ros-base`.
- **Docker sandbox** — adversarially tested (path-traversal/symlink escape,
  workbench isolation, and the pids/memory/CPU caps all holding under attack).

### Coverage boundaries (honest)

- **The ROS introspection/launch tools are validated against Lyrical only, and
  that is an accepted limit, not a gap we're closing.** `ros_nodes`,
  `ros_graph`, `ros_topic`, `ros_launch` and
  `ros_restart` run on the *host*, because they depend on DDS discovery —
  which does not survive containerisation without `--network=host`, and that
  flag doesn't work meaningfully on Docker Desktop's VM (the primary Windows
  setup) and would discard most of the isolation the sandbox exists to provide.
  These are structured `ros2 <verb>` calls, not arbitrary shell, and the
  genuinely dangerous lanes (shell execution, CMake-executing builds) *are*
  sandboxed. The ROS 2 CLI surface is stable across distros, so Jazzy/Humble are
  expected to work — but they are **untested**, and we say so rather than imply
  coverage we don't have. Real coverage would come from a self-hosted CI runner
  with another distro installed (the `ros` job is stubbed in `ci.yml`).
- `ros_pkg_new` also runs on the host and emits a generic ament scaffold,
  so it is not distro-varied either.
- The Windows host-build carve-out has not been tested on Jazzy/Humble.
- macOS is out of scope (no realistic upstream ROS 2 support).

## The develop loop

The ROS and file tools together give the model a tight edit/build/fix cycle it
can drive on its own:

```
ros_pkg_new   ->  scaffold a package
workspace_edit           ->  edit the source
ros_build  ->  colcon build
   (on failure, the real compiler errors come back in stderr)
workspace_edit           ->  fix
ros_build  ->  rebuild, green
```

## Tools

**Linux execution**
- `workbench_shell` — bounded shell exec (blocklist check, hard timeout, truncated output)
- `workspace_edit` — exact search/replace file editing; refuses a no-match or ambiguous
  match (unless `replace_all`) and leaves the file untouched on refusal

**Background jobs** (shared by Linux and ROS)
- `job_start`, `job_list`, `job_logs`, `job_stop`

**ROS 2 introspection & control** (needs `ros2` on PATH)
- `ros_nodes`, `ros_graph`, `ros_topic`
- `ros_launch`, `ros_restart`

**ROS 2 workspace** (needs `colcon` from `ros-dev-tools`)
- `ros_pkg_new` — wraps `ros2 pkg create`
- `ros_build` — wraps `colcon build`; on failure returns
  `{ success: false, exitCode, stderr }` with the real compiler errors

All ROS tools degrade gracefully: if `ros2`/`colcon` isn't found they return a
clear `{ available: false, message }` instead of throwing.

## Setup

```bash
npm install
npm run build
```

Node 20+ (built and tested on Node 24), and Docker for the default sandboxed
mode — it fails closed without it (set `SANDBOX_MODE=off` to knowingly run
unsandboxed). For the ROS tools, run the server from a
shell that has sourced your ROS 2 setup (e.g. `source /opt/ros/lyrical/setup.bash`)
so `ros2` and `colcon` are on PATH and node discovery works.

## Install as an MCP Bundle (recommended)

**Prerequisites: Node 20+ and Docker.** Docker is a hard prerequisite of the
default configuration — sandboxing is on by default and **fails closed**: with
Docker missing or stopped, `workbench_shell`, background jobs, and (on Linux)
builds refuse to run and return instructions instead. On Windows that means
Docker Desktop with WSL integration enabled for your distro. Seeing "Docker is
not reachable" on a fresh install is the sandbox working as designed, not a
bug — start Docker, or knowingly set Sandbox mode to `off`.

Build the bundle and install it with one click — no JSON editing:

```bash
npm install && npm run build
npx @anthropic-ai/mcpb pack
```

Then install it in Claude Desktop: **Settings → Extensions → Advanced
settings → Install Extension…** and pick the `.mcpb` file (or drag the file
into the Claude Desktop window). Don't rely on double-clicking the file: on
Windows, `.mcpb` frequently has no file association, so Windows shows an
"open with" app picker that doesn't list Claude Desktop and the double-click
goes nowhere — observed on a real install.

The install dialog prompts for these settings — with sandboxing on (the
default), **Workspace folder is effectively required**; the rest are optional:

- **ROS 2 setup script path** — e.g. `/opt/ros/lyrical/setup.bash` (works for
  `jazzy`/`humble` too). The server sources it before every ROS command, so
  ROS tools work even though desktop apps never launch from a ROS-sourced
  shell. On Windows, give the path *inside* your WSL distro — ROS commands
  are routed through WSL automatically.
- **WSL distro** (Windows only) — where ROS lives; default `Ubuntu`.
- **Shell for workbench_shell** — default `bash`; on Windows point it at Git
  Bash if `bash` isn't on PATH.
- **Sandbox mode** — `docker` (default: commands run in containers, edits
  confined to the workspace) or `off` (everything runs directly on your
  machine). Needs Docker if left on — on Windows, Docker Desktop with WSL
  integration enabled for your distro. Without Docker these tools refuse to
  run (fail closed) with instructions — expected behavior, not a bug.
- **Workspace folder** (required unless sandbox is off) — the project
  directory Millwright works in: mounted into sandbox containers and the only
  place file edits are allowed while sandboxing is on. Left blank with
  sandboxing on, file edits refuse until it is set. Scope it to ONE project,
  not a parent of many — everything under it is writable, and
  filesystem/drive/home roots are refused outright. On Windows pick a folder
  inside WSL (`\\wsl.localhost\…`).
- **Sandbox network** — `all` (default) or `none` for the workbench;
  builds are always network-isolated regardless.
- **Sandbox CPU limit** — max CPU cores a sandbox container may use (default
  `2`; decimals like `1.5` allowed). Keeps a runaway process from pegging the
  machine; raise it for faster container builds on many-core hosts.

Leave the setup script blank if you don't use ROS: the Linux tools work
independently, and ROS tools reply with a clear `available: false` message.

### Changing settings requires restarting the extension

Claude Desktop does **not** restart the MCP server when you change its
settings. A running server keeps the **workspace scope and code version it
started with** — potentially for hours. You can rescope **Workspace folder** to
a smaller directory, believe edits are now confined there, and still have an
older server running with the *previous, broader* scope. (Observed in
development: one server ran ~15 hours across three workspace changes and two
version installs without ever picking them up.)

After changing any setting, **restart the server** — but note that **toggling
the extension Off/On in Settings → Extensions is often NOT enough**: in practice
it can leave the previous `node` process running. What reliably restarts it:
**fully quit Claude Desktop** (system tray / menu → Quit, not just closing the
window) and reopen. If a stale server persists, kill the orphaned process —
Task Manager → end the `node` process, or in WSL `pkill -f dist/index.js`. Even
*installing a new version* does not restart a running server (observed: one ran
~15 hours across three workspace changes and two version installs; and a 0.5.0
install served stale 0.4.x until a full quit).

**Confirm which build is actually live** — every tool result carries
`millwright_version`, so a single call settles it: if the version isn't the one
you just installed, the running process is stale — restart it (full quit). The
older refusal readout still confirms the live *workspace scope*: ask Millwright
to edit a file you *know* is outside your intended workspace; the refusal names
the workspace the running server really has:

```
refused: '…' is outside the configured workspace (⟵ this is the live workspace_dir).
```

If that path isn't the folder you set, the server is stale. On Windows, give the
edit target as a WSL UNC path (`\\wsl.localhost\<distro>\home\…`), not a POSIX
`/home/…` path (a POSIX path fails host-side with a generic "path not found").

### Two surfaces, two instances (Desktop vs Claude Code)

If you run **both** Claude Desktop and Claude Code, each has its **own**
Millwright instance with a **separate config and lifecycle** — they don't share
state, and updating one does not update the other:

- **Claude Desktop** runs the **installed `.mcpb`** copy. Updating it means
  install the new `.mcpb` *and* fully restart (above).
- **Claude Code** runs `node <path>/dist/index.js` **directly** (see Manual
  config below), so it tracks your **dist build**: `npm run build`, let it
  reconnect, and it's current — no `.mcpb`, no reinstall. Installing a `.mcpb`
  does **nothing** for Claude Code.

**Which one am I talking to?** Check `millwright_version` in any tool result and
note the client. To see how Claude Code's Millwright is wired, run
`claude mcp list` in a Claude Code terminal — the config location varies and may
not be in the obvious files, so `claude mcp list` is authoritative; edit it as
the `mcpServers` entry shown under Manual config.

### First prompts: name the extension

Millwright's tool names are deliberately generic (`workbench_shell`,
`workspace_edit`), and some Claude surfaces have built-in tools with similar
jobs — so a bare "run uname -a" may get routed to a built-in sandbox
instead of your real machine (observed on a real install: the built-in
answered with its own container's kernel). Until the model has used
Millwright once in a conversation, say so explicitly: **"Using Millwright,
run uname -a."** After the first routed call it generally sticks.

## Manual config (Claude Code / other MCP clients)

```json
{
  "mcpServers": {
    "linux-ros-bridge": {
      "command": "node",
      "args": ["/absolute/path/to/millwright/dist/index.js"],
      "env": { "ROS_SETUP_SCRIPT": "/opt/ros/lyrical/setup.bash" }
    }
  }
}
```

`ROS_SETUP_SCRIPT` is optional — without it, launch the client from a
ROS-sourced environment so the ROS tools can find `ros2`/`colcon`.
`ROS_WSL_DISTRO` (default `Ubuntu`) and `SHELL_BIN` (default `bash`) are the
env equivalents of the other two bundle settings.

## Privacy Policy

This server runs entirely on your machine and makes **no network calls of its
own** — no telemetry, no analytics, no external services, no phoning home.
Concretely, here is everything it touches:

- **Filesystem**: `workspace_edit` reads and writes files at paths the model asks
  for. With sandboxing on (the default), edits are restricted to your
  configured workspace folder; with `sandbox_mode: off`, access is limited
  only by your OS user's permissions.
- **Process execution**: with sandboxing on, `workbench_shell` and background
  jobs execute inside Docker containers (resource-limited, workspace-mounted);
  ROS introspection commands (`ros2`) run locally as your user, and on Linux
  `colcon` builds run in a network-isolated container. With `sandbox_mode:
  off` — or for builds on Windows, where the result carries an explicit
  warning — commands run directly as your user.
- **ROS 2 data**: the ROS tools read node names, topic names, and message
  contents from your local ROS 2 domain, and can start/stop ROS processes.
- **In-memory state**: background-job logs (last 2000 lines per job) are held
  in server memory only and vanish when the server exits. Nothing is written
  to disk by the server itself except what tools are explicitly asked to write.

**What leaves your machine**: nothing is transmitted anywhere *by this
server*. However, every tool result (file contents, command output, ROS topic
data) is returned over stdio to the MCP client that called it — Claude
Desktop, Claude Code, or another client — which sends it to its AI model
provider as part of your conversation. If a topic or file contains sensitive
data and you ask the model to read it, that content enters the conversation
like anything else you'd paste into chat.

## Safety model

- **Simulation-first.** Real hardware is never driven directly from a prompt;
  ROS work happens in the simulation lane, hardware sits behind an approval gate.
- **`ros_restart` only restarts nodes this server launched** (via
  `ros_launch`). It refuses to kill processes it doesn't own — a
  deliberate boundary, not a limitation.
- **Bounded output everywhere**, so a runaway log or build can't blow the model's context.
- **Docker sandbox, on by default.** Shell commands and background jobs run in
  an `ubuntu:24.04` workbench container (memory- and pid-limited) with only
  your workspace folder mounted; on Linux, `colcon` builds run in the official
  `ros:<distro>-ros-base` image with **no network**. File edits are confined
  to the workspace. If Docker isn't available, these tools **fail closed**
  with instructions rather than silently running unsandboxed. Set
  `sandbox_mode: off` to opt out. Full design: [`docs/sandboxing.md`](./docs/sandboxing.md).
- **⚠️ Windows limitation**: `colcon` builds run on the host (inside WSL),
  not in a container — a hostile `CMakeLists.txt` executes with your user's
  privileges. Every unsandboxed build result says so explicitly. Only build
  workspaces whose build files you trust.
- **Starter command blocklist** (`rm -rf /` and `~`-targeting variants, `mkfs`,
  `dd … of=/dev/…`, fork bombs) as a backstop when the sandbox is off.

## Development

The repo includes validation harnesses that exercise the tools against real
ROS/colcon rather than mocks:

```bash
npm run build
node harness.mjs            # ROS tools vs. a live turtlesim
node patch-harness.mjs      # workspace_edit on real files
node workspace-harness.mjs  # create -> patch -> build develop loop with colcon
bash mcp-roundtrip.sh       # raw JSON-RPC over stdio (spawns dist/index.js)
bash sandbox-harness.sh     # Docker sandbox: workbench, limits, network, builds
```

## Roadmap

See [`CLAUDE.md`](./CLAUDE.md) for the full, prioritized roadmap. Next up:
make the blocklist a configurable policy, Gazebo/Isaac Sim tools, and a
status dashboard.
