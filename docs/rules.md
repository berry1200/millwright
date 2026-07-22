# Millwright — Development Rules

Rules for anyone working on this codebase, human or AI. These exist because each
one was learned the expensive way.

**Last updated:** 2026-07-19

---

## 1. The prime directive: prove it

**Compiling is not working. Running once is not validated.**

Every tool must be exercised against a live system before being called done —
real ROS, real colcon, real files on disk, re-read after the operation. This rule
has already caught four bugs that code review missed entirely:

| Bug | How review missed it |
|---|---|
| `sample_ros_topic` passed `messageType` as a positional to `ros2 topic echo`, failing hard on any stale type | Looked correct; the type string *was* correct in older distros |
| `include_hidden ? ["topic","list"] : ["topic","list"]` — a no-op ternary | Reads as intentional at a glance |
| `list_ros_nodes` returned duplicates from discovery races | Only visible with a live graph |
| Kill contract resolved the promise *before* sending SIGINT | Only visible with per-case orphan checks |

**Corollaries:**
- Write the test so it *can* fail. A "passing" test that never exercised the code
  path is worse than no test — one develop-loop run showed 0.11s builds and
  unchanged file sizes because the patch anchor never matched.
- Check both directions. A blocklist must be tested for what it allows, not only
  what it blocks.
- Check for orphaned processes after every case, not once at the end.

---

## 2. Dependencies

**Rule: two runtime dependencies. Adding a third requires justification in the PR.**

Currently `@modelcontextprotocol/sdk` and `zod`. Every dependency is
supply-chain surface that users must trust to execute code on their machine.

- ❌ No HTTP clients, no telemetry, no analytics, no crash reporters
- ❌ No test framework yet — harnesses are plain `.mjs` scripts (revisit when CI lands)
- ❌ No logging library — `console.error` to stderr is sufficient for stdio servers
- ✅ Commit `package-lock.json` always
- ✅ Prefer Node built-ins (`node:child_process`, `node:fs`, `node:crypto`)

**Container images:** use official upstream images only (`ubuntu:24.04`, OSRF
`ros:<distro>`). Do not publish project-owned images — that means a registry, a
rebuild cadence, CVE patching, and asking users to trust our supply chain.

---

## 3. Error handling

**Tools return structured results. Tools do not throw to the caller.**

```ts
// ✅ Correct
return { available: false, message: "ros2 CLI not found. Install ROS 2 and set..." };

// ❌ Wrong
throw new Error("ENOENT");
```

Rules:
- **Every failure message must be actionable.** Say what's missing and what to do
  about it. `"ros2 CLI not found on this machine. Install ROS 2 (e.g. 'jazzy' or
  'humble') and source /opt/ros/<distro>/setup.bash"` — not `"ROS unavailable"`.
- **Degrade gracefully, never silently.** Missing ROS, missing shell, missing
  Docker each return a clear flag plus explanation. Never fall back to a
  less-safe path without saying so.
- **Fail closed.** If the sandbox is unavailable, refuse — do not run unsandboxed
  quietly. Where an unsandboxed path is unavoidable (Windows builds), every
  result must carry `sandboxed: false` and a warning string.
- **Bound all output.** Truncate to head+tail with an explicit
  `[N lines truncated]` marker. An unbounded build log destroys the model's context.
- **Bound all waits.** Every spawned process needs a timeout and a guaranteed
  kill path. Resolve only after exit is confirmed.

---

## 4. Tool design

- **Names are API.** Renaming a tool breaks every user's config. Treat tool names
  as frozen after release.
- **Schemas describe reality.** If a parameter is ignored, mark it optional and
  say so in the description. Do not leave required-but-unused parameters.
- **Annotations must be accurate, not permissive.** MCP defaults are permissive —
  absent `destructiveHint` reads as true — so state the negatives explicitly.
  When in doubt, mark destructive: `job_start` is destructive because
  it executes arbitrary commands.
- **Descriptions are prompts.** They are the only thing the model sees when
  choosing a tool. Generic names like `workbench_shell` can lose to a client's
  built-in sandbox; descriptions should be specific about when the tool applies.
- **Own what you touch.** Never act on processes or files the server didn't
  create or wasn't explicitly pointed at.

---

## 5. AI agent boundaries

Rules for an AI agent (Claude Code or otherwise) working on this repo.

### Must do
- Read `CLAUDE.md` before making changes
- Update `CLAUDE.md`'s "Testing done so far" to reflect **only what actually ran**
- Record architecture-affecting decisions so they aren't relitigated
- Verify assumptions against the live system rather than documentation memory —
  the spec version, package names, and CLI flags have all been wrong at least once
- Stop and ask when a decision is irreversible or affects the public contract
  (naming, tool schemas, source-of-truth location)

### Must not do
- **Claim something works because it compiles.** State plainly what is tested,
  what is written-but-untested, and what is known broken.
- **Delete files it didn't create** without explicit approval.
- **Grow the blocklist as a substitute for sandboxing.** It is a stopgap by
  design and saying otherwise is a safety regression.
- **Silently fix a flagged-but-deferred item** with a half-measure. If a proper
  fix is out of scope, leave it queued and say why.
- **Claim asynchronous capabilities it doesn't have.** An agent cannot "watch" a
  directory between turns; it observes only when it runs a command.

### Escalate to the human
- Naming and branding decisions
- Anything touching trademark or licensing
- Which environment is the source of truth
- Any GUI interaction (installs, dialogs) — the agent cannot click
- Trade-offs between safety and usability

---

## 6. Documentation rules

- `CLAUDE.md` is the working context file, auto-loaded by Claude Code. Keep it
  current; it is the handoff mechanism between sessions and models.
- Mark decisions as closed explicitly (e.g. "Naming — decided 2026-07-18, do not
  relitigate") with the reasoning, so they survive personnel and model changes.
- Distinguish **validated** from **implemented** from **designed** everywhere.
- When docs and reality conflict, reality wins and docs get fixed the same session.
- Record environment discoveries (WSL quirks, distro codenames, install paths) —
  these cost the most time to rediscover.

---

## 7. Git and repo hygiene

- One canonical repo, in WSL's Linux filesystem (`~/projects/millwright`).
  Never maintain parallel copies — manual sync is how silent drift starts.
- Windows access via `\\wsl.localhost\Ubuntu\home\<user>\projects\millwright`.
- `.gitignore`: `node_modules/`, `dist/`, logs, sandbox artifacts.
- Commit `package-lock.json`.
- Commit messages state what was *validated*, not only what was changed.

---

## 8. ROS-specific rules

- **ROS 2 only.** ROS 1 is EOL and out of scope.
- **Never pass a message type to `ros2 topic echo`.** It auto-resolves from the
  live topic; a stale type string is a hard failure. Message packages move
  between distros (turtlesim → `turtlesim_msgs` in Lyrical).
- **Never run an unbounded `ros2 topic echo`.** It streams forever and hangs the
  tool call.
- **Always source the setup script explicitly.** Never assume the server was
  launched from a ROS-sourced shell — Claude Desktop is not.
- **Style the trademark correctly:** "ROS 2" — all caps, space before the version,
  never possessive. Use it descriptively only; never in a product name.
  Open Robotics' guidelines require written approval for product-name use, and
  such permission is revocable.

---

## 9. Incident response — snapshot before you restore

Learned the expensive way on 2026-07-19: `~/projects/vigil247` was emptied during
a sandboxed session, and the very first recovery step — restoring from
`vigil247.zip` — recreated the directory (new inode, new birth time) and
**overwrote the emptied state before anyone captured it.** With `--rm` containers
already gone and Docker events not surviving daemon restarts, the root cause
became undiagnosable. It cost the ability to answer "did our tool do this?"

**Rule: when something is destroyed, SNAPSHOT first, restore second.** Recovery
can wait five minutes; forensic evidence cannot be recreated. Before touching the
damaged state:

- Copy it as-is: `cp -a <dir> <dir>.forensic` or `tar czf incident.tgz <dir>`.
- Capture `stat <dir>`, and the current wall-clock time.
- Save `docker ps -a`, `docker inspect <container>`, and container logs **before**
  anything with `--rm` reaps them.
- Copy `~/.bash_history` (and note that a sandboxed tool's commands will NOT be
  there — they ran non-interactively inside a container).
- Only then restore.

Corollary for the tool itself: this is *why* a broad `workspace_dir` is dangerous
(§ safety) — a pass-through bind mount turns one bad command into real, immediate,
multi-project host deletion, with the evidence gone the moment recovery starts.
