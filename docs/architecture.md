# Millwright — Architecture

**Version:** 0.3.0
**Last updated:** 2026-07-18

---

## 1. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | Best-supported MCP SDK; required for MCPB bundling; strong static typing catches schema drift |
| Runtime | Node.js 22+ | Claude Desktop ships its own Node runtime for bundles |
| MCP SDK | `@modelcontextprotocol/sdk` ^1.11 | Official SDK |
| Schema validation | `zod` ^3.23 | Idiomatic for the TS SDK; generates the JSON Schema clients see |
| Transport | stdio | Required — Millwright touches the local filesystem and local ROS. Remote HTTP transport is architecturally impossible for this product. |
| Packaging | MCPB (`.mcpb`), manifest_version 0.3 | Single-click install in Claude Desktop |
| License | Apache-2.0 | Patent grant + automatic contribution licensing (§5) without requiring a CLA |
| Target ROS | ROS 2 (Lyrical validated; Jazzy/Humble expected) | ROS 1 is EOL and out of scope |
| Sandbox runtime | Docker (approved, not implemented) | See `docs/sandboxing.md` |

**Deliberately not used:** no web framework, no database, no ORM, no telemetry,
no analytics, no network client. Millwright makes zero outbound network calls.
Dependencies are kept to two on purpose — every added dependency is
supply-chain surface a user must trust to run code on their machine.

---

## 2. Layered architecture

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1 — Interface                                    │
│  Claude Desktop / Claude Code / Codex / Gemini / any     │
│  MCP client. Not built by us.                            │
└────────────────────────┬────────────────────────────────┘
                         │ JSON-RPC 2.0 over stdio
┌────────────────────────▼────────────────────────────────┐
│  Layer 2 — MCP Server (src/server.ts, src/index.ts)     │
│  Tool registration, zod schemas, annotations,            │
│  structured responses. The API contract.                 │
└───────┬──────────────────┬───────────────────┬──────────┘
        │                  │                   │
┌───────▼───────┐  ┌───────▼────────┐  ┌───────▼─────────┐
│ Layer 3a      │  │ Layer 3b       │  │ Layer 3c        │
│ Shell tools   │  │ ROS tools      │  │ File tools      │
│ shell-tools.ts│  │ ros-tools.ts   │  │ file-tools.ts   │
└───────┬───────┘  └───────┬────────┘  └───────┬─────────┘
        │                  │                   │
        └────────┬─────────┘                   │
                 │                             │
       ┌─────────▼──────────┐                  │
       │ Layer 4 — Job      │                  │
       │ Manager            │                  │
       │ job-manager.ts     │                  │
       │ Shared process     │                  │
       │ registry           │                  │
       └─────────┬──────────┘                  │
                 │                             │
┌────────────────▼─────────────────────────────▼──────────┐
│  Layer 5 — Execution targets                            │
│  Host shell │ WSL bridge │ ROS 2 install │ Filesystem   │
│  (future: workbench container, build container)         │
└─────────────────────────────────────────────────────────┘
```

### Layer responsibilities

**Layer 2 — Server.** Owns the public contract: tool names, schemas,
descriptions, annotations. Contains no execution logic. Every handler is a thin
adapter that calls into Layer 3 and wraps the result.

**Layer 3 — Tool implementations.** Each module owns one domain and returns
structured objects, never throws to the caller. Modules do not import each
other's internals; shared helpers (e.g. `truncateOutput`) are explicitly
exported from `shell-tools.ts`.

**Layer 4 — Job Manager.** A single in-memory registry of spawned processes,
shared by both the Linux and ROS lanes. Exists because MCP tool calls are
request/response: a `ros2 launch` or a Gazebo sim would hang a call forever.
Tools spawn, register, and return a `job_id` immediately.

**Layer 5 — Execution targets.** On Windows, ROS commands are routed through
`wsl.exe` into the configured distro; `cwd` and `mkdir` are handled *inside* the
wrapper because WSL paths are meaningless to Windows Node.

---

## 3. Key data flows

### 3.1 The develop loop (the core value proposition)

```
User: "the node won't build, fix it"
  │
  ├─► build_ros_workspace  ──► colcon build ──► exit 2
  │                                            stderr: real gcc error
  ├─► (model reads the actual compiler error)
  │
  ├─► patch_file           ──► exact search/replace on disk
  │
  ├─► build_ros_workspace  ──► colcon build ──► exit 0
  │
  ├─► restart_ros_node     ──► stop + relaunch owned job
  │
  └─► sample_ros_topic     ──► confirm it's publishing again
```

No human interpretation at any step. This loop is validated end-to-end.

### 3.2 Long-running process handling

```
start_ros_launch_job ──► spawn ──► register in JobManager ──► return job_id
                                          │
                                          ├── stdout/stderr → ring buffer (2000 lines)
                                          └── exit handler → status update

read_job_logs(job_id) ──► tail N lines from the buffer
stop_background_job   ──► SIGINT ──► (grace period) ──► SIGKILL
```

### 3.3 Bounded topic sampling

`sample_ros_topic` runs **one** persistent `ros2 topic echo` subscription,
buffers stdout, and peels off complete `---`-terminated YAML documents as they
stream. A partial document stays in the buffer until its terminator arrives. The
call returns when N messages are captured or the overall timeout elapses.

**Kill contract:** the promise resolves only after the child process's exit is
confirmed. "Tool returned" therefore implies "subscription process is gone."
This was tightened after validation caught a race where SIGINT was sent after
resolution.

Message type is **not** passed to `ros2 topic echo` — echo resolves it from the
live topic. Passing a stale type string causes hard failure, which is exactly
what happened when turtlesim moved its messages to `turtlesim_msgs` in Lyrical.

---

## 4. File structure

```
millwright/
├── CLAUDE.md                  # Auto-loaded project context for Claude Code
├── README.md                  # Public-facing docs, includes Privacy Policy
├── LICENSE                    # Apache-2.0
├── manifest.json              # MCPB manifest: tools, user_config, metadata
├── package.json
├── package-lock.json          # Committed for reproducibility
├── tsconfig.json
├── .gitignore                 # node_modules/, dist/, logs, sandbox artifacts
├── .mcpbignore                # Excludes dev files from the bundle
│
├── docs/
│   └── sandboxing.md          # Approved sandbox design spec
│
├── src/
│   ├── index.ts               # Entrypoint: stdio transport wiring
│   ├── server.ts              # Tool registration, schemas, annotations
│   ├── job-manager.ts         # Background process registry
│   ├── shell-tools.ts         # run_command, blocklist, truncateOutput
│   ├── ros-tools.ts           # All ROS 2 + workspace tools, rosInvocation()
│   └── file-tools.ts          # patch_file
│
├── dist/                      # Compiled output (gitignored)
│
└── (validation harnesses)     # harness.mjs, patch-harness.mjs,
                               # workspace-harness.mjs, MCP round-trip scripts
```

### Module boundaries

- `server.ts` imports from all tool modules; **no tool module imports `server.ts`**
- `job-manager.ts` is imported by both `shell-tools.ts` and `ros-tools.ts`; it
  imports neither
- `file-tools.ts` is standalone
- Shared utilities live in `shell-tools.ts` and are exported explicitly

---

## 5. Environment abstraction

Three user-configurable settings absorb all environment variance, discovered
during MCPB packaging when it emerged that **Claude Desktop does not launch the
server from a ROS-sourced shell**:

| Setting | Purpose |
|---|---|
| `ros_setup_script` | Path to `setup.bash`. A `rosInvocation()` wrapper sources it before every `ros2`/`colcon` call. Without this, every ROS tool silently fails on a real install. |
| `wsl_distro` | On Windows, ROS commands route through `wsl.exe` into this distro. |
| `shell_bin` | Shell binary for `run_command`. Defaults to `bash`. |

This was a genuine architectural finding: it worked perfectly from a developer's
terminal and would have failed for every real installer.

---

## 6. Safety architecture

Defense layers, weakest to strongest:

1. **Command blocklist** — stopgap only. Catches `rm` aimed at `/`, `/*`, `~`,
   `$HOME`, `/home`, separated-flag forms, `--no-preserve-root`, `mkfs`,
   `dd of=/dev/`, fork bombs. Explicitly documented as bypassable. **Must not be
   grown as a substitute for sandboxing.**
2. **Output truncation** — prevents a runaway log from destroying the model's context.
3. **Ownership boundary** — `restart_ros_node` and `stop_background_job` only act
   on processes Millwright spawned.
4. **Refusal semantics** — `patch_file` refuses ambiguous or zero matches and
   leaves files byte-identical.
5. **Tool annotations** — `destructiveHint` set accurately (and conservatively:
   `start_background_job` is marked destructive because it executes arbitrary
   commands).
6. **Container sandbox** *(approved, not implemented)* — the real defense. Once
   active, `--pids-limit` retires the blocklist's fork-bomb rule.

---

## 7. Testing architecture

Two levels, both required before any feature is called done:

**Function-level harnesses** — import the *compiled* modules from `dist/` and
exercise them against a live system (real turtlesim, real colcon, real files),
re-reading disk state after each operation. Orphan-process checks run after
every case.

**MCP protocol round-trip** — spawns `dist/index.js` as a real stdio server and
drives it with raw JSON-RPC (`initialize` → `notifications/initialized` →
`tools/list` → `tools/call`), exactly as a client would. This catches schema and
wire-format problems that function-level testing cannot.

Neither is currently automated in CI. That is a known gap.
