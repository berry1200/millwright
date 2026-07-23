#!/usr/bin/env bash
# Tier-2 tests: the sandbox security guarantees, exercised against REAL Docker
# containers (ubuntu:24.04 only - no ROS). Runs on any Linux host with Docker,
# including GitHub-hosted `ubuntu-latest` runners. Each adversarial scenario
# exits non-zero if any check fails, so this script's exit code gates CI.
set -uo pipefail
cd "$(dirname "$0")"

# Probe that Docker WORKS, not merely that the CLI is on PATH: Docker Desktop's
# WSL integration installs a shim that stays on PATH even when the daemon is
# unreachable, so `command -v docker` passed while every container command failed
# - producing a full run of vacuous results. Query the server version instead.
docker version --format '{{.Server.Version}}' >/dev/null 2>&1 || {
  echo "Docker daemon not reachable (stopped, or Docker Desktop WSL integration dropped) - aborting Tier-2."
  echo "On a hosted runner this correctly fails the job; locally, start Docker Desktop / re-enable WSL integration."
  exit 2
}
docker pull -q ubuntu:24.04 >/dev/null

# Create the workspace dir up front, owned by THIS user, so a container bind
# mount never creates it root-owned (see adversarial-harness.mjs for the full
# rationale). Defense in depth alongside the harness's own mkdir.
WS_DIR=/tmp/mw_ci
mkdir -p "$WS_DIR"

rc=0
for s in traversal symlink escape ownership pids memory cpus; do
  echo "################ adversarial: $s ################"
  SANDBOX_MODE=docker WORKSPACE_DIR="$WS_DIR" node adversarial-harness.mjs "$s" || rc=1
done

echo "################ cleanup ################"
docker ps -aq --filter "name=millwright-" | xargs -r docker rm -f >/dev/null 2>&1 || true
docker rm -f mw_pidbomb mw_cpubomb >/dev/null 2>&1 || true
echo "leftover millwright containers: $(docker ps -aq --filter "name=millwright-" | wc -l)"
exit $rc
