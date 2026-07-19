#!/usr/bin/env bash
# Drives sandbox-harness.mjs: one process per scenario, env set per case.
# Linux-host semantics (run inside WSL). Requires docker + the images pulled.
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null
cd "$HOME/projects/millwright"

run() {
  echo; echo "################ scenario: $1 ################"
  shift
  env "$@" node sandbox-harness.mjs "${SCENARIO}" 2>&1
}

SCENARIO=off              run off          SANDBOX_MODE=off
SCENARIO=unavailable      run unavailable  SANDBOX_MODE=docker DOCKER_HOST=tcp://127.0.0.1:9
SCENARIO=workbench        run workbench    SANDBOX_MODE=docker WORKSPACE_DIR=/tmp/mw_ws
SCENARIO=network-none     run network-none SANDBOX_MODE=docker WORKSPACE_DIR=/tmp/mw_ws WORKBENCH_NETWORK=none
SCENARIO=no-workspace     run no-workspace SANDBOX_MODE=docker
SCENARIO=job              run job          SANDBOX_MODE=docker WORKSPACE_DIR=/tmp/mw_ws
SCENARIO=build            run build        SANDBOX_MODE=docker WORKSPACE_DIR=/tmp/mw_build_ws ROS_SETUP_SCRIPT=/opt/ros/lyrical/setup.bash

echo
echo "################ leak check ################"
LEFT=$(docker ps -a --filter "name=millwright-" --format "{{.Names}}")
echo "millwright containers remaining: ${LEFT:-"(none)"}"
