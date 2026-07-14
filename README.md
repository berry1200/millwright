# linux-ros-mcp-bridge

A model-agnostic MCP server for Linux development and ROS 2 robotics.
Connect it to Claude, Codex, Gemini, or any MCP-compatible client - the
tool schema stays the same regardless of which model is calling it.

## Status

v0.1 - Linux execution layer is fully working. ROS 2 layer is implemented
and tested for graceful degradation, but not yet tested against a live
ROS 2 install (none on this machine yet). Next milestone: install ROS 2
and validate the ROS tools against turtlesim.

## Setup

```bash
npm install
npm run build
```

## Connect to Claude Desktop / Claude Code

Add to your MCP config:

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

## Tools

**Linux layer** (works today, no ROS required):
- `run_command` - bounded shell execution, blocked-pattern check, output truncation
- `start_background_job` / `list_background_jobs` / `read_job_logs` / `stop_background_job`

**ROS 2 layer** (needs `ros2` on PATH):
- `list_ros_nodes`, `get_ros_graph`, `sample_ros_topic`
- `start_ros_launch_job`, `restart_ros_node`

## Known limitation (by design)

`restart_ros_node` only restarts nodes this server itself launched via
`start_ros_launch_job`. It will not kill or restart a process it doesn't
own - that's a safety boundary, not a bug. Bring a node under management
first, then restart it.

## Roadmap

1. Install ROS 2 (jazzy or humble) + turtlesim, validate the ROS tools for real
2. Add `patch_file` (diff-based file editing, avoid round-tripping whole files)
3. Add the command allowlist/blocklist as a configurable policy, not hardcoded
4. Docker sandboxing for `run_command` before this touches anything beyond a throwaway VM
5. Gazebo/IsaacSim-specific tools (spawn, reset pose, pause physics)
