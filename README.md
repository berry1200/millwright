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

**v0.3** — 13 tools over stdio, installable as an MCP Bundle (`.mcpb`).
Validated live (2026-07) against **ROS 2 Lyrical Luth** + turtlesim on
**Ubuntu 26.04** (WSL2): every ROS tool, the `patch_file` editor, a full MCP
JSON-RPC round-trip, and the create → edit → build develop loop were all
exercised for real, not mocked. Other distros (Jazzy, Humble) are supported
via the `ros_setup_script` setting but have not been validated yet.

## The develop loop

The ROS and file tools together give the model a tight edit/build/fix cycle it
can drive on its own:

```
create_ros_package   ->  scaffold a package
patch_file           ->  edit the source
build_ros_workspace  ->  colcon build
   (on failure, the real compiler errors come back in stderr)
patch_file           ->  fix
build_ros_workspace  ->  rebuild, green
```

## Tools

**Linux execution**
- `run_command` — bounded shell exec (blocklist check, hard timeout, truncated output)
- `patch_file` — exact search/replace file editing; refuses a no-match or ambiguous
  match (unless `replace_all`) and leaves the file untouched on refusal

**Background jobs** (shared by Linux and ROS)
- `start_background_job`, `list_background_jobs`, `read_job_logs`, `stop_background_job`

**ROS 2 introspection & control** (needs `ros2` on PATH)
- `list_ros_nodes`, `get_ros_graph`, `sample_ros_topic`
- `start_ros_launch_job`, `restart_ros_node`

**ROS 2 workspace** (needs `colcon` from `ros-dev-tools`)
- `create_ros_package` — wraps `ros2 pkg create`
- `build_ros_workspace` — wraps `colcon build`; on failure returns
  `{ success: false, exitCode, stderr }` with the real compiler errors

All ROS tools degrade gracefully: if `ros2`/`colcon` isn't found they return a
clear `{ available: false, message }` instead of throwing.

## Setup

```bash
npm install
npm run build
```

Node 20+ (built and tested on Node 24). For the ROS tools, run the server from a
shell that has sourced your ROS 2 setup (e.g. `source /opt/ros/lyrical/setup.bash`)
so `ros2` and `colcon` are on PATH and node discovery works.

## Install as an MCP Bundle (recommended)

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

The install dialog prompts for three optional settings:

- **ROS 2 setup script path** — e.g. `/opt/ros/lyrical/setup.bash` (works for
  `jazzy`/`humble` too). The server sources it before every ROS command, so
  ROS tools work even though desktop apps never launch from a ROS-sourced
  shell. On Windows, give the path *inside* your WSL distro — ROS commands
  are routed through WSL automatically.
- **WSL distro** (Windows only) — where ROS lives; default `Ubuntu`.
- **Shell for run_command** — default `bash`; on Windows point it at Git
  Bash if `bash` isn't on PATH.

Leave the setup script blank if you don't use ROS: the Linux tools work
independently, and ROS tools reply with a clear `available: false` message.

### First prompts: name the extension

Millwright's tool names are deliberately generic (`run_command`,
`patch_file`), and some Claude surfaces have built-in tools with similar
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

- **Filesystem**: `patch_file` reads and writes files at paths the model asks
  for; `run_command` and background jobs can do whatever the shell user can.
  Access is limited only by your OS user's permissions — there is currently
  **no path allowlist or sandbox** (see Safety model and Roadmap).
- **Process execution**: `run_command`, background jobs, and the ROS tools
  execute real commands (`bash`, `ros2`, `colcon`) locally, as your user.
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
- **`restart_ros_node` only restarts nodes this server launched** (via
  `start_ros_launch_job`). It refuses to kill processes it doesn't own — a
  deliberate boundary, not a limitation.
- **Bounded output everywhere**, so a runaway log or build can't blow the model's context.
- **Starter command blocklist** (`rm -rf /`, `mkfs`, `dd … of=/dev/…`, fork bombs)
  as a backstop. Real isolation is meant to come from running the server inside a
  container (roadmap).

## Development

The repo includes validation harnesses that exercise the tools against real
ROS/colcon rather than mocks:

```bash
npm run build
node harness.mjs            # ROS tools vs. a live turtlesim
node patch-harness.mjs      # patch_file on real files
node workspace-harness.mjs  # create -> patch -> build develop loop with colcon
bash mcp-roundtrip.sh       # raw JSON-RPC over stdio (spawns dist/index.js)
```

## Roadmap

See [`CLAUDE.md`](./CLAUDE.md) for the full, prioritized roadmap. Next up:
make the blocklist a configurable policy, Docker sandboxing for `run_command`,
Gazebo/Isaac Sim tools, and a status dashboard.
