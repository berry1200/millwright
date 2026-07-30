# Millwright — Cold-Trial Observation Sheet

**Companion to [`cold-trial.md`](cold-trial.md).** That file tells the tester
*what to do*; this file captures *what actually happened*. The goal of the trial
is to convert "very likely ready" into **observed ready**, so vague "it worked
fine" feedback is not enough — we need to know **exactly where a fresh person
gets stuck**, at the step it happens.

## How to use this sheet

- Keep this open **next to** the checklist and fill in each step's box **as you
  finish that step — before moving on.** Do **not** save it all for the end;
  friction you felt at step 2 is forgotten by step 8.
- "Matched the expected pass?" refers to the **"Pass" description in the
  checklist for that exact step.** Answer **Y / N / Partly.**
- The **friction** line is the most valuable field. Write down anything that made
  you pause, re-read, guess, look something up, or ask a person — even if you
  recovered. "I wasn't sure whether X meant Y" is exactly what we need. A step can
  *pass* and still have friction; record both.
- Three steps have a **⚠️ Known trap** box — the things we most expect to bite a
  first-timer. Be honest there; "yes, this got me" is a success for the trial.
- Paste **raw tool-result JSON** where asked; don't paraphrase it.

---

## Tester & machine context

Fill this once, at the start.

- **Tester (name or initials):** ____________________
- **Date:** ____________________
- **Have you used Claude Desktop before? (Y / N):** ____
- **Have you ever seen Millwright, its code, or these docs before? (Y / N):** ____
  *(If Y, this isn't a true cold trial — note it.)*
- **Do you use ROS 2? (Y / N):** ____  *(determines which Action 3 pass applies)*
- **Windows version:** ____________________
- **WSL distro + version** (`wsl -l -v`): ____________________
- **Docker Desktop version:** ____________________
- **Which `.mcpb` did you install** (filename): ____________________
  *(should be `millwright-0.5.5.mcpb`)*

---

## Part 1 — Prerequisites

### Step 1.1 — Docker Desktop is running
- **What you saw:** ____________________
- **Matched the expected pass? (Y / N / Partly):** ____
- **Friction/confusion at this step:** ____________________

### Step 1.2 — Docker WSL integration for your distro (`docker ps`)
- **What `docker ps` printed** (paste, or "table header, no rows"): ____________________
- **Matched the expected pass? (Y / N / Partly):** ____
- **Friction/confusion at this step:** ____________________

> ⚠️ **Known trap #1 — the non-default-distro WSL integration toggle.**
> Docker can work in one terminal yet fail for Millwright because WSL integration
> is enabled *per distro*, and a non-default distro's toggle is silently off.
> - **Did this bite you? (Y / N):** ____
> - **If yes:** how did it show up (error text / where), how long did it cost you,
>   and what finally fixed it? ____________________
> - **Was the checklist's note (Settings → Resources → WSL integration) enough to
>   fix it on your own, or did you need help? (Self / Needed help):** ____

### Step 1.3 — Node.js
- **What you saw** (did the extension complain about `node` at any point?): ____________________
- **Matched the expected pass? (Y / N / Partly):** ____
- **Friction/confusion at this step:** ____________________

### Step 1.4 — Make a workspace folder
- **What you saw** (did you find both the Linux path and the `\\wsl.localhost\…`
  path without trouble?): ____________________
- **Matched the expected pass? (Y / N / Partly):** ____
- **Friction/confusion at this step:** ____________________

---

## Part 2 — Install the extension

### Step 2.a — Getting the extension installed
- **What you saw** (did it install cleanly from Settings → Extensions → Advanced
  → Install Extension?): ____________________
- **Matched the expected pass? (Y / N / Partly):** ____
- **Friction/confusion at this step:** ____________________

> ⚠️ **Known trap #2 — the `.mcpb` is not a double-click install on Windows.**
> The file often has no association, so double-clicking does nothing or opens an
> "open with" picker. It must be installed from inside Claude Desktop.
> - **Did you try double-clicking it first? (Y / N):** ____
> - **If yes:** what happened, and how long before you found the in-app route?
>   ____________________
> - **Was the checklist's warning clear enough to steer you straight? (Y / N):** ____

### Step 2.b — Filling in the settings
- **What you saw** (were the fields — Workspace folder, WSL distro, Sandbox mode,
  ROS setup script — clear about what to enter?): ____________________
- **Which field, if any, were you unsure how to fill:** ____________________
- **Matched the expected pass? (Y / N / Partly):** ____
- **Friction/confusion at this step:** ____________________

> ⚠️ **Known trap #3 — a full quit is required to restart, not a toggle.**
> Toggling the extension Off/On in Settings often leaves the old process running;
> only a full **Quit** of Claude Desktop (system tray → Quit) reliably restarts it.
> *(You may not hit this on a first install — it bites when you later change a
> setting. Record it if it comes up at any point in the trial.)*
> - **Did you hit a stale/unchanged behavior after a settings change? (Y / N / N/A):** ____
> - **If yes:** what looked stale, and did a full quit fix it? ____________________
> - **Was the checklist's restart note clear that toggling isn't enough? (Y / N):** ____

---

## Part 3 — Confirm the build (`millwright_version`)

- **The full raw result of the `echo ready` call** (paste): 
  ```json

  ```
- **Was the first field `"millwright_version": "0.5.5"`? (Y / N):** ____
  *(If it showed a different version, or `sandbox_available: false`, follow the
  checklist's Fail branches and note what happened below.)*
- **Matched the expected pass? (Y / N / Partly):** ____
- **Friction/confusion at this step:** ____________________

---

## Part 4 — Smoke actions

### Action 1 — Create a file and check ownership
- **Raw result** (paste): 
  ```json

  ```
- **`"sandboxed": true`? (Y / N):** ____
- **`"exitCode": 0`? (Y / N):** ____
- **Is the file owned by your username, NOT `root`? (Y / N):** ____
  *(A `root root` ownership is the exact regression this trial guards — flag it loud.)*
- **Matched the expected pass? (Y / N / Partly):** ____
- **Friction/confusion at this step:** ____________________

### Action 2 — Edit that same file (the handoff)
- **Raw result** (paste): 
  ```json

  ```
- **`"applied": true` and `"replacements": 1`? (Y / N):** ____
- **Did you hit an EPERM / permission error? (Y / N):** ____
  *(EPERM here is the old bug — the sandbox made a file the host editor can't touch.)*
- **Did the optional `cat` verify show `edited`? (Y / N / didn't try):** ____
- **Matched the expected pass? (Y / N / Partly):** ____
- **Friction/confusion at this step:** ____________________

### Action 3 — One ROS call (`ros_nodes`)
- **Which pass applies to you** (A = you have ROS; B = you don't): ____
- **Raw result** (paste): 
  ```json

  ```
- **Did it return one of the two valid passes** (A: `available:true` + `nodes`
  list; B: `available:false` + a readable message), and **NOT** a crash or stack
  trace? (Y / N): ____
- **Matched the expected pass? (Y / N / Partly):** ____
- **Friction/confusion at this step:** ____________________

---

## Part 5 — Overall (fill last)

- **Did every step ultimately pass? (Y / N):** ____  If N, **which step(s):** ______
- **Total time, start to finish:** ____________________
- **Did you have to ask another person anything at all? (Y / N):** ____
  If Y, **what** — each question is a gap to close: ____________________
- **The single worst friction point of the whole trial** (the one thing to fix
  first): ____________________
- **Anything in the checklist itself that was unclear, out of date, or didn't
  match your screen** (this sheet is also testing the docs): ____________________
- **Would you have been able to finish with only the checklist and no other help?
  (Y / N):** ____

> **Reminder:** the trial's exit criterion is *"a stranger can install and use it
> without asking questions."* Every question you had to ask, and every friction
> note above, is a finding — not a failure on your part. Blank friction boxes with
> a clean run is the best possible result; friction boxes with detail is the
> second best. A clean run with *undocumented* friction is the one outcome that
> wastes the trial.
