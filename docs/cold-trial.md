# Millwright — Cold-Trial Checklist

**For a first-time installer. You do not need to have seen the code, the repo
history, or any prior conversation.** Follow the steps top to bottom; each one
tells you exactly what a *pass* looks like. If any step doesn't match, stop and
copy the raw result to whoever gave you this file.

**Time:** ~20 minutes.

---

## What Millwright is (30 seconds)

Millwright is an extension for **Claude Desktop**. It gives Claude a set of tools
to work as a Linux / ROS 2 developer on *your* machine: run shell commands, edit
files, run background jobs, and inspect a ROS 2 system. By default those shell
commands run **inside a Docker container** that can see **only one folder you
choose** (the "workspace") — not the rest of your disk. That sandbox is the whole
point: it's why you can let Claude run commands without handing it your entire
computer.

You interact with it entirely through **normal chat in Claude Desktop.** You ask
Claude to do something; Claude calls a Millwright tool; Claude Desktop shows the
tool call, and you can **click to expand it and see the raw result** (a block of
JSON). This checklist is about reading those raw results.

---

## Scope of this trial

This checklist is written for a machine set up like the author's:

- **Windows 11**, with **WSL2** and a Linux distribution installed (e.g. Ubuntu)
- **Docker Desktop** installed
- **Claude Desktop** installed
- A copy of the **`millwright-0.5.4.mcpb`** file (the extension bundle)

If your setup differs (native Linux, or Windows without WSL), this trial doesn't
apply cleanly — tell the person who gave you the file; that's a different,
not-yet-validated path.

Throughout, two placeholders:
- `<distro>` — your WSL distribution name (usually `Ubuntu`).
- `<you>` — your Linux username inside WSL. To find it: open a terminal for your
  distro and run `whoami`.

---

## Part 1 — Prerequisites (do these before installing)

### 1.1 Docker Desktop is running

Start Docker Desktop and wait until its whale icon says it's running.

### 1.2 Docker's WSL integration is enabled **for your distro** ← the easy-to-miss one

Docker Desktop's WSL integration is **per-distro**. If your distro isn't Docker's
*default* one, Docker can work in a plain terminal while Millwright's calls (which
are routed through *your* distro) still fail — and it looks intermittent, not
like a clean "off." Turn it on explicitly:

1. Docker Desktop → **Settings** → **Resources** → **WSL integration**
2. Make sure **"Enable integration with additional distros"** lists your distro
   (e.g. `Ubuntu`) and its toggle is **on**
3. **Apply & Restart**

**Confirm it works.** Open a terminal for your distro and run:

```bash
docker ps
```

**Pass:** you get a table header (`CONTAINER ID   IMAGE   ...`), even with no rows.
**Fail:** "command not found," "cannot connect to the Docker daemon," or a hang —
go back and fix WSL integration before continuing. Millwright cannot work until
`docker ps` succeeds here.

### 1.3 Node.js

The extension runs on Node 18+. Claude Desktop normally provides this for node
extensions; if the extension later fails to start and mentions `node`, install
Node 18+ inside your distro and retry.

### 1.4 Make a workspace folder

Pick one folder for the trial. In a terminal for your distro:

```bash
mkdir -p ~/millwright-trial
```

Note its two addresses — you'll need both:
- **Linux path:** `/home/<you>/millwright-trial`
- **Windows path:** `\\wsl.localhost\<distro>\home\<you>\millwright-trial`

---

## Part 2 — Install the extension

1. Open **Claude Desktop**.
2. **Settings → Extensions → Advanced settings → Install Extension…**
3. Pick the **`millwright-0.5.4.mcpb`** file.
   (Don't double-click the `.mcpb` in File Explorer — on Windows it often has no
   file association and nothing happens. Install it from inside Claude Desktop.)
4. The install dialog asks for settings. Fill in:
   - **Workspace folder** — set this to your trial folder. Use the **Windows
     path**: `\\wsl.localhost\<distro>\home\<you>\millwright-trial`.
     *(This field is effectively required — with the sandbox on, file edits
     refuse until it's set.)*
   - **WSL distro** — your distro name (e.g. `Ubuntu`).
   - **Sandbox mode** — leave as **`docker`** (the default). This trial is
     testing the sandbox; don't set it to `off`.
   - **ROS 2 setup script path** — if you have ROS 2 installed, set it to your
     distro's setup script, e.g. `/opt/ros/lyrical/setup.bash` (also works for
     `jazzy` / `humble`). **If you don't use ROS, leave it blank** — the ROS
     smoke test below has a "no ROS" pass path.
   - Leave the rest at their defaults.
5. Enable the extension.

> **Important — after any settings change, fully restart.** Claude Desktop does
> **not** restart the extension's background process when you toggle it off/on.
> If you change a setting, **fully quit Claude Desktop** (system tray → Quit, not
> just closing the window) and reopen. You won't need this for a first install,
> but you will if you change the workspace later.

---

## Part 3 — Confirm you're on the right build (30 seconds)

In a new Claude Desktop chat, send:

> Use the workbench_shell tool to run: `echo ready`

Claude will call the tool. **Click the tool call to expand it** and read the raw
result. It's JSON that begins like this:

```json
{
  "millwright_version": "0.5.4",
  "blocked": false,
  "sandboxed": true,
  "exitCode": 0,
  "stdout": "ready\n",
  "stderr": ""
}
```

**Pass:** the very first field is `"millwright_version": "0.5.4"`.
**Fail — wrong version:** if it's any other version, an *older* process is still
running. Fully quit Claude Desktop and reopen, then retry.
**Fail — sandbox not available:** if instead you see
`"sandbox_available": false` with a message about Docker, Docker isn't reachable —
return to step 1.2.

Keep this habit: **`millwright_version` is the first field of every result**, so
you can always tell which build answered.

---

## Part 4 — Three smoke actions

These three, in order, exercise the whole critical path: the sandbox runs as
**you** (not root), a file it creates is **yours**, and the host-side editor can
then edit that same file. (That "created by the sandbox, then edited on the host"
handoff is exactly what used to break, so it's the heart of the trial.)

Use `<you>` = your WSL username throughout.

### Action 1 — Create a file with `workbench_shell`, and check who owns it

Send to Claude:

> Use the workbench_shell tool to run:
> `echo hello > /home/<you>/millwright-trial/trial.txt && id -un && ls -l /home/<you>/millwright-trial/trial.txt`

Expand the tool call. Expected raw result:

```json
{
  "millwright_version": "0.5.4",
  "blocked": false,
  "sandboxed": true,
  "exitCode": 0,
  "stdout": "<you>\n-rw-r--r-- 1 <you> <you> 6 ... trial.txt\n",
  "stderr": ""
}
```

**Pass, all three must hold:**
1. `"sandboxed": true` — the command ran in the container, not directly on your host.
2. `"exitCode": 0` — it succeeded.
3. In `stdout`, the file is owned by **your username**, not `root` —
   `... 1 <you> <you> ...`, and the `id -un` line prints `<you>`.

**Fail — owned by `root`:** if `ls -l` shows `root root`, the sandbox-runs-as-you
fix isn't active (you're likely on an older build — recheck Part 3). Report this;
it's the exact regression this trial guards against.

### Action 2 — Edit that same file with `workspace_edit` (the handoff)

This edits the file **on the host**, and it must succeed on the file the sandbox
just created. Send to Claude:

> Use the workspace_edit tool on `/home/<you>/millwright-trial/trial.txt` to
> replace `hello` with `edited`.

Expand the tool call. Expected raw result:

```json
{
  "millwright_version": "0.5.4",
  "applied": true,
  "path": "\\\\wsl.localhost\\<distro>\\home\\<you>\\millwright-trial\\trial.txt",
  "resolved_path": "\\\\wsl.localhost\\<distro>\\home\\<you>\\millwright-trial\\trial.txt",
  "replacements": 1,
  "bytes_before": 6,
  "bytes_after": 7
}
```

**Pass:**
- `"applied": true` and `"replacements": 1`.
- `resolved_path` points at your trial file (Millwright translated the Linux path
  you gave to the Windows path it actually edited — that's expected, and it's
  echoed back so you can audit it).

**Verify on disk (optional but convincing).** Back in Action 1's style, send:

> Use the workbench_shell tool to run: `cat /home/<you>/millwright-trial/trial.txt`

`stdout` should now be `"edited\n"`.

**Fail — `"applied": false` with a permission error (EPERM):** this is the old
bug — the sandbox created a file the host editor couldn't touch. Report it.
**Fail — `"applied": false, "reason": "file not found…"`:** the path didn't
resolve. Retry giving the **Windows path** instead:
`\\wsl.localhost\<distro>\home\<you>\millwright-trial\trial.txt`.
**Fail — refused as outside the workspace:** the message will name the workspace
the running server actually has. If that's not the folder you set, an old process
is live — fully quit Claude Desktop and reopen.

### Action 3 — One ROS call (`ros_nodes`)

This checks the ROS lane. **There are two valid passes** depending on whether you
installed ROS.

Send to Claude:

> Use the ros_nodes tool to list active ROS 2 nodes.

Expand the tool call.

**Pass A — you have ROS 2 installed and set the setup-script path.** Expected:

```json
{
  "millwright_version": "0.5.4",
  "available": true,
  "nodes": ["/some_node", "..."]
}
```

`available` is `true` and `nodes` is a list (it may be empty if nothing is
running — that's still a pass; the point is the ROS lane answered).

**Pass B — you don't use ROS (left the setup script blank).** Expected a clean,
graceful decline — **not** a crash:

```json
{
  "millwright_version": "0.5.4",
  "available": false,
  "message": "ros2 CLI not found. Either start this server from a ROS-sourced shell, or set the ros_setup_script setting ..."
}
```

`available` is `false` with a readable message. This is a designed, correct
outcome — the ROS tools degrade gracefully when ROS is absent.

**Fail:** anything that isn't one of the two above — a raw stack trace, a hang, or
Claude reporting the tool errored out.

---

## Part 5 — What to report back

Copy back the raw result JSON from **Part 3** and each of **Actions 1–3**, plus:

- **Overall:** did every step pass? If not, which one, and what did the raw result
  say?
- **Any point you got stuck** on the *instructions themselves* (a step that was
  unclear, a screen that didn't match, a term you had to look up). This trial is
  as much a test of these docs as of the software — "I couldn't tell where to
  click" is a valuable result, not a failure on your part.
- Roughly how long it took, and whether you had to ask anyone a question. (The
  goal is "install and use it **without** asking questions." Every question you
  had to ask is a gap to close.)

---

## Quick reference — pass in one line each

| Step | Pass looks like |
|---|---|
| 1.2 Docker | `docker ps` in your distro prints a table header |
| 3 Version | first field is `"millwright_version": "0.5.4"` |
| Action 1 | `"sandboxed": true`, `exitCode 0`, file owned by `<you>` not `root` |
| Action 2 | `"applied": true`, `"replacements": 1`, `resolved_path` = your file |
| Action 3 | `available:true` with a `nodes` list **or** `available:false` with a message |
