import { readFile, writeFile } from "node:fs/promises";

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

  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (err: any) {
    if (err.code === "ENOENT") return { applied: false, reason: `file not found: ${path}` };
    return { applied: false, reason: `could not read ${path}: ${err.message}` };
  }

  // Count non-overlapping occurrences via split (literal, no regex semantics).
  const occurrences = content.split(search).length - 1;
  if (occurrences === 0) {
    return {
      applied: false,
      reason:
        "search block not found. It must match verbatim, including indentation, " +
        "whitespace and newlines.",
    };
  }
  if (occurrences > 1 && !opts.replaceAll) {
    return {
      applied: false,
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
    await writeFile(path, updated, "utf8");
  } catch (err: any) {
    return { applied: false, reason: `could not write ${path}: ${err.message}` };
  }

  return {
    applied: true,
    path,
    replacements: opts.replaceAll ? occurrences : 1,
    bytes_before: Buffer.byteLength(content, "utf8"),
    bytes_after: Buffer.byteLength(updated, "utf8"),
  };
}
