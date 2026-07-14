// Validation harness for patch_file: applies patches through the real tool and
// checks the RESULT ON DISK, not just the return value.
import { writeFile, readFile, rm } from "node:fs/promises";
import { patchFile } from "./dist/file-tools.js";

const FILE = new URL("./patch-sandbox.txt", import.meta.url).pathname;
const hr = (t) => console.log("\n========== " + t + " ==========");
const show = (label, v) => console.log(label + " => " + JSON.stringify(v, null, 2));
const dump = async () => console.log("--- file on disk ---\n" + (await readFile(FILE, "utf8")) + "--- end ---");

const ORIGINAL = `line one
const color = "red";
function greet() {
  return "hello";
}
const color = "red";
total = PRICE;
`;

await writeFile(FILE, ORIGINAL, "utf8");
console.log("seeded sandbox file (" + Buffer.byteLength(ORIGINAL) + " bytes)");

hr("Case 1: unique match -> applies");
show("result", await patchFile(
  FILE,
  'function greet() {\n  return "hello";\n}',
  'function greet() {\n  return "hi there";\n}'
));
await dump();

hr("Case 2: search not found -> refused, file unchanged");
{
  const before = await readFile(FILE, "utf8");
  show("result", await patchFile(FILE, "this text does not exist", "X"));
  console.log("file byte-identical after refusal? " + (before === (await readFile(FILE, "utf8"))));
}

hr("Case 3: ambiguous (2 matches), no replace_all -> refused, file unchanged");
{
  const before = await readFile(FILE, "utf8");
  show("result", await patchFile(FILE, 'const color = "red";', 'const color = "blue";'));
  console.log("file byte-identical after refusal? " + (before === (await readFile(FILE, "utf8"))));
}

hr("Case 4: same block WITH replace_all -> replaces both");
show("result", await patchFile(FILE, 'const color = "red";', 'const color = "blue";', { replaceAll: true }));
await dump();

hr("Case 5: file not found -> refused");
show("result", await patchFile("/no/such/dir/nope.txt", "a", "b"));

hr("Case 6: replace text with $ patterns -> inserted literally (no regex $-expansion)");
show("result", await patchFile(FILE, "total = PRICE;", "total = $5 & $10 [$& $1 stay literal];"));
await dump();

await rm(FILE, { force: true });
console.log("\nDONE (sandbox cleaned up).");
