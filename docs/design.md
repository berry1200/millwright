# Millwright — Design System

**Status:** Direction agreed, assets not yet produced.
**Last updated:** 2026-07-18

Millwright's visible surface is small — an extension icon, a README, and
eventually a dashboard. That makes consistency cheap and worth getting right
once.

---

## 1. Brand positioning

**The name carries the design brief.** A millwright is the skilled tradesperson
who installs, aligns, maintains, and repairs industrial machinery. The visual
identity should read as **industrial craft**: precise, tool-like, confident,
unfussy. Not playful, not corporate-SaaS, not sci-fi robotics.

**Tone:** a well-made hand tool. Serious about the work, no ornament.

---

## 2. The mark

**Direction: Concept A — monoline.** A terminal chevron (`>`) that flows into a
branching node graph, drawn as a single continuous stroke weight.

**Why this concept:** it expresses both halves of the product in one shape — the
prompt (chevron) and the ROS computational graph (branching nodes) — without
gluing two separate symbols together.

### Construction rules
- **Uniform stroke weight** throughout. No tapering, no variable width.
- **Round caps and joins.** This is what makes it read as one gesture rather than
  assembled parts.
- **Two-value only.** The mark is one color on one background, always. No
  gradients, no third color, no shadows.
- **Clear space:** minimum one stroke-width on all sides.
- **Minimum size:** 32px. Verified legible at 32, 44, and 64px.

### Prohibited
- ❌ Do not resemble existing marks in adjacent products. Style inspiration is
  fine; a mark that reads as a near-copy is a real trademark problem for a tool
  intended for a public directory.
- ❌ No ROS logo, no Ubuntu logo, no Docker whale, no Claude/Anthropic marks.
- ❌ No literal robot, no gears, no wrenches — every robotics tool uses these.

---

## 3. Color

Duotone. Hard contrast, no midtones.

| Token | Hex | Use |
|---|---|---|
| `--mw-acid` | `#C8F41E` | Primary brand color. Mark on dark, background on light layouts. |
| `--mw-black` | `#0B0B0B` | Primary dark. Mark on acid, background on dark layouts. |

**Only two colorways exist:**
1. Acid mark on black background (primary — matches dark IDE/terminal contexts)
2. Black mark on acid background (secondary — for stickers, headers, high-impact)

### Functional colors (dashboard / status only — not brand)

| Token | Hex | Meaning |
|---|---|---|
| `--mw-ok` | `#3D9A6E` | Build succeeded, job running, node healthy |
| `--mw-warn` | `#B8860B` | Unsandboxed operation, degraded mode, missing config |
| `--mw-error` | `#C1443B` | Build failed, process crashed, tool refused |
| `--mw-muted` | `#6B6B6B` | Inactive, stopped, unknown |

**Note:** `--mw-warn` is specifically required for the `sandboxed: false` state on
Windows builds. That warning must be visually distinct — it is a safety signal,
not decoration.

### Caveat on the palette
Acid green on black is a strong, currently-fashionable choice. It will look sharp
now and may date faster than a quieter palette. That is an acceptable tradeoff
for a developer tool, but it is a conscious one — revisit at v2.

---

## 4. Typography

| Role | Typeface | Weight | Notes |
|---|---|---|---|
| Wordmark | Geometric sans (Inter, General Sans, or similar) | 500 | Tight tracking. Never all-caps — "Millwright" is a word, not an acronym. |
| UI / body | Inter, system-ui fallback | 400 / 500 | Two weights only. |
| Code, paths, tool names, terminal output | JetBrains Mono, ui-monospace fallback | 400 | All tool names (`workbench_shell`, `workspace_edit`) are always monospace in docs and UI. |

**Rules**
- Two weights maximum in any layout. Hierarchy comes from size and space, not
  from adding weights.
- Tool names, file paths, and shell output are **always** monospace — they are
  literal strings a user may need to type.
- Never letterspace the wordmark beyond a slight negative tracking.

---

## 5. Layout principles

- **Dense, not airy.** This is a developer tool; users prefer information density
  over generous whitespace.
- **Left-aligned.** No centered body text.
- **Rounded corners:** 8px for cards, 12–16px for panels, 14px+ for icon tiles.
- **Borders over shadows.** Hairline borders (0.5–1px) rather than drop shadows.
- **Status is color plus text.** Never color alone — accessibility, and terminal
  users often have unusual color profiles.

---

## 6. Required assets

### Immediate (blocking clean packaging)
- [ ] `icon.png` — 128×128 and 256×256, acid on black. Currently a placeholder
      "M" in Claude Desktop's extension list.
- [ ] Full lockup (mark + wordmark), both colorways, SVG
- [ ] Mark-only SVG, both colorways

### Before directory submission
- [ ] README header image
- [ ] 2–3 screenshots showing the develop loop in action
- [ ] Social preview card (1280×640)

### Later
- [ ] Dashboard component styles (Phase 7)

---

## 7. Voice and copy

- **Plain, direct, technically precise.** "Runs a shell command and returns
  stdout, stderr, and exit code" — not "empowers seamless command execution."
- **Never oversell safety.** Say exactly what is and isn't protected. The current
  blocklist is "a stopgap, trivially bypassable" — that phrasing is correct and
  should stay.
- **Errors instruct.** Every failure message names what's missing and what to do.
- **"ROS 2" is styled precisely** — all caps, space before the version, never
  possessive, descriptive use only. This is a trademark requirement, not a style
  preference.
