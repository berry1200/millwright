// Parses the raw JSON-RPC stdout captured from the stdio MCP server and reports
// the key facts, while echoing the literal raw lines for the tool calls.
import { readFileSync } from "node:fs";

const lines = readFileSync(process.argv[2], "utf8").split("\n").filter((s) => s.trim());
const byId = new Map();
for (const l of lines) {
  let m;
  try { m = JSON.parse(l); } catch { console.log("NON-JSON line:", l.slice(0, 120)); continue; }
  if (m.id !== undefined) byId.set(m.id, { line: l, msg: m });
}
const res = (id) => byId.get(id)?.msg?.result;

// --- tools/list ---
const tl = res(2);
if (tl?.tools) {
  console.log(`### id=2 tools/list -> ${tl.tools.length} tools (raw line length ${byId.get(2).line.length} chars)`);
  console.log("names:", tl.tools.map((t) => t.name).join(", "));

  const srt = tl.tools.find((t) => t.name === "sample_ros_topic");
  const req = srt.inputSchema.required ?? [];
  console.log("\nsample_ros_topic.inputSchema:");
  console.log(JSON.stringify(srt.inputSchema, null, 2));
  console.log("=> required:", JSON.stringify(req));
  console.log(
    "=> message_type present but NOT required?",
    "message_type" in (srt.inputSchema.properties || {}) && !req.includes("message_type")
  );

  const pf = tl.tools.find((t) => t.name === "patch_file");
  console.log("\npatch_file props:", Object.keys(pf.inputSchema.properties || {}).join(", "));
  console.log("patch_file required:", JSON.stringify(pf.inputSchema.required ?? []));
} else {
  console.log("### id=2 tools/list -> NO tools in response:", JSON.stringify(byId.get(2)?.msg));
}

// --- tool calls: echo raw line + the parsed text payload ---
for (const id of [3, 4, 5]) {
  const b = byId.get(id);
  console.log(`\n### id=${id} tools/call -> raw JSON-RPC:`);
  if (!b) { console.log("(no response)"); continue; }
  console.log(b.line);
  const text = b.msg.result?.content?.[0]?.text;
  if (text !== undefined) {
    console.log("--- result.content[0].text ---");
    console.log(text);
  }
  if (b.msg.error) console.log("ERROR:", JSON.stringify(b.msg.error));
}
