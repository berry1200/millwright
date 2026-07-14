# linux-ros-mcp-bridge

A model-agnostic [MCP](https://modelcontextprotocol.io) server that lets any
MCP-capable LLM (Claude, Codex, Gemini, …) work as a competent **Linux
developer** and **ROS 2 robotics developer** through one consistent tool schema.
It's an execution layer, not a chat wrapper: the model calls tools, the tools
run real commands, real output comes back, the model reacts.

> Deeper design notes, decisions, and the full live-testing log live in
> [`CLAUDE.md`](./CLAUDE.md).

## Status

**v0.1** — 13 tools over stdio. Validated live (2026-07-14) against **ROS 2
Lyrical Luth** + turtlesim on **Ubuntu 26.04** (WSL2): every ROS tool, the
`patch_file` editor, a full MCP JSON-RPC round-trip, and the create → edit →
build develop loop were all exercised for real, not mocked.

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

## Connect to Claude Desktop / Claude Code

```json
{
  "mcpServers": {
    "linux-ros-bridge": {
      "command": "node",
      "args": ["/absolute/path/to/linux-ros-mcp-bridge/dist/index.js"]
    }
  }
}
```

For ROS support, launch the client (or the server) from a ROS-sourced
environment so the ROS tools can find `ros2`/`colcon`.

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
harden `sample_ros_topic` for multi-message capture, make the blocklist a
configurable policy, Docker sandboxing for `run_command`, Gazebo/Isaac Sim
tools, and a status dashboard.
