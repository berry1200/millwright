#!/usr/bin/env bash
# Tier-3 tests: the ROS lane against a REAL ROS 2 install + live turtlesim.
# These CANNOT run on a GitHub-hosted runner (no ROS 2, no display) - run them
# manually on a ROS machine, or wire a self-hosted runner labelled `ros`.
# Requires: a sourced ROS 2 install (ros2, colcon), Node on PATH.
set -uo pipefail
cd "$(dirname "$0")"

command -v ros2 >/dev/null || { echo "ros2 not found - source your ROS 2 setup first (e.g. source /opt/ros/lyrical/setup.bash)"; exit 2; }
npm run build

export QT_QPA_PLATFORM=offscreen
echo "== ROS tools vs live turtlesim ==";     node harness.mjs
echo "== persistent-subscription sampling =="; node sample-harness.mjs
echo "== develop loop (create/patch/build) =="; node workspace-harness.mjs
echo
echo "NOTE: build_ros_workspace multi-distro (ros:jazzy / ros:humble) and the MCP"
echo "stdio round-trip are separate manual runs - see README / CLAUDE.md."
