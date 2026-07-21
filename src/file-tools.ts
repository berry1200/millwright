import { readFile, writeFile } from "node:fs/promises";
import { sandboxEnabled, isInsideWorkspace, resolveCandidatePath } from "./sandbox.js";

/**
 * Diff-style file editing: find an exact `search` block and replace it with
 * `replace`, writing the result back to disk. This exists so the model can edit
 * large files by naming just the block that changes, instead of regenerating
 * the whole file (a big token-cost win, and less chance of unrelated drift).
 *
 * Safety model: exact string replacement, not fuzzy or line-based. By default
 * the search block must match exactly once - a zero-match or an ambiguous
 * multi-match is refused rather than guessed, so a too-broad block can't
 * silently clobber the wrong place. Set replaceAll to intentionally replace
 * every occurrence. Nothing is written unless the match constraints are met, so
 * a rejected patch leaves the file byte-for-byte unchanged.
 *
 * The replacement text is treated literally - unlike String.prototype.replace,
 * sequences like `$&` or `$1` in `replace` are inserted verbatim, never
 * interpreted as substitution patterns.
 */
export async function patchFile(
  path: string,
  search: string,
  replace: string,
  opts: { replaceAll?: boolean } = {}
) {
  if (search === "") {
    return { applied: false, reason: "search block is empty; provide the exact text to find." };
  }

  // Normalize the model's path (POSIX->WSL UNC on Windows, relatives against
  // the workspace root) BEFORE gating - never gate the pre-translation string
  // (see resolveCandidatePath's security note). `resolved_path` is echoed back
  // on every outcome so the translation is auditable, not silent.
  const target = resolveCandidatePath(path);

  // Sandbox allowlist: when sandboxing is on, edits are confined to the
  // configured workspace - checked on the TRANSLATED path, BEFORE the file is
  // read, so nothing outside the workspace is even opened.
  if (sandboxEnabled()) {
    const gate = await isInsideWorkspace(target);
    if (!gate.ok) return { applied: false, reason: gate.reason, resolved_path: target };
  }

  let content: string;
  try {
    content = await readFile(target, "utf8");
  } catch (err: any) {
    if (err.code === "ENOENT") return { applied: false, reason: `file not found: ${target}`, resolved_path: target };
    return { applied: false, reason: `could not read ${target}: ${err.message}`, resolved_path: target };
  }

  // Count non-overlapping occurrences via split (literal, no regex semantics).
  const occurrences = content.split(search).length - 1;
  if (occurrences === 0) {
    return {
      applied: false,
      resolved_path: target,
      reason:
        "search block not found. It must match verbatim, including indentation, " +
        "whitespace and newlines.",
    };
  }
  if (occurrences > 1 && !opts.replaceAll) {
    return {
      applied: false,
      resolved_path: target,
      reason:
        `search block matches ${occurrences} times; refusing to guess which one. ` +
        `Add surrounding context to make it unique, or set replace_all to replace all ${occurrences}.`,
    };
  }

  // Literal replacement (split/join and slice both avoid the `$` special-pattern
  // pitfall that String.prototype.replace has with a string argument).
  let updated: string;
  if (opts.replaceAll) {
    updated = content.split(search).join(replace);
  } else {
    const idx = content.indexOf(search);
    updated = content.slice(0, idx) + replace + content.slice(idx + search.length);
  }

  try {
    await writeFile(target, updated, "utf8");
  } catch (err: any) {
    return { applied: false, reason: `could not write ${target}: ${err.message}`, resolved_path: target };
  }

  return {
    applied: true,
    path: target,
    resolved_path: target,
    replacements: opts.replaceAll ? occurrences : 1,
    bytes_before: Buffer.byteLength(content, "utf8"),
    bytes_after: Buffer.byteLength(updated, "utf8"),
  };
}
