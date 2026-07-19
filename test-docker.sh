#!/usr/bin/env bash
# Tier-2 tests: the sandbox security guarantees, exercised against REAL Docker
# containers (ubuntu:24.04 only - no ROS). Runs on any Linux host with Docker,
# including GitHub-hosted `ubuntu-latest` runners. Each adversarial scenario
# exits non-zero if any check fails, so this script's exit code gates CI.
set -uo pipefail
cd "$(dirname "$0")"

command -v docker >/dev/null || { echo "docker not found - skipping Tier-2"; exit 2; }
docker pull -q ubuntu:24.04 >/dev/null

rc=0
for s in traversal symlink escape pids memory cpus; do
  echo "################ adversarial: $s ################"
  SANDBOX_MODE=docker WORKSPACE_DIR=/tmp/mw_ci node adversarial-harness.mjs "$s" || rc=1
done

echo "################ cleanup ################"
docker ps -aq --filter "name=millwright-" | xargs -r docker rm -f >/dev/null 2>&1 || true
docker rm -f mw_pidbomb mw_cpubomb >/dev/null 2>&1 || true
echo "leftover millwright containers: $(docker ps -aq --filter "name=millwright-" | wc -l)"
exit $rc
