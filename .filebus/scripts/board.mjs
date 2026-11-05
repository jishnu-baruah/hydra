#!/usr/bin/env node
// Enforces + reports the TASKS.md board. Node builtins only.
//   node scripts/board.mjs lint      the board is well formed
//   node scripts/board.mjs summary   live counts, joined with bus/ state
import fs from "node:fs";
import path from "node:path";

const REQUIRED = ["Status", "Tier", "Depends-on", "Touches", "Acceptance", "Evidence"];
const PLACEHOLDER = /^(<.*>|tbd|todo|n\/a|none|-|\?+)?$/i;
const BUS = "./bus";

function parse(text) {
  const rows = [];
  let cur = null, field = null;
  text.split(/\r?\n/).forEach((line, i) => {
    const head = /^### \**\s*((?:T-[A-Z]?\d+[a-z]?)|OP-\d+),\s*(.+)$/.exec(line);
    if (head) { cur = { id: head[1], title: head[2], line: i + 1, fields: {} }; rows.push(cur); field = null; return; }
    if (line.startsWith("### ")) cur = null;
    if (!cur) return;
    const f = /^- ([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (f) { field = f[1]; cur.fields[field] = f[2].trim(); return; }
    if (field && /^\s+\S/.test(line)) { cur.fields[field] = `${cur.fields[field]} ${line.trim()}`.trim(); return; }
    field = null;
  });
  return rows;
}

// Does `text` name `id` as a whole token? Boundary chars are [A-Za-z0-9-], so "OP-1" does not
// match inside "OP-10". Done without a regex template to avoid the \b-in-template-literal trap.
function names(text, id) {
  const isWord = (c) => c !== undefined && /[\w-]/.test(c);
  for (let i = text.indexOf(id); i !== -1; i = text.indexOf(id, i + 1)) {
    if (!isWord(text[i - 1]) && !isWord(text[i + id.length])) return true;
  }
  return false;
}

function conflictMarkers(errors) {
  for (const file of ["TASKS.md", "DECISIONS.md", "OPERATOR_TODO.md"]) {
    if (!fs.existsSync(file)) continue;
    fs.readFileSync(file, "utf8").split(/\r?\n/).forEach((l, i) => {
      if (/^(<{7}|={7}|>{7})(\s|$)/.test(l)) errors.push(`${file}:${i + 1}: unresolved merge conflict marker.`);
    });
  }
}

function lint() {
  const errors = [];
  if (!fs.existsSync("TASKS.md")) { console.error("FAIL: TASKS.md missing. It is the board."); process.exit(1); }
  conflictMarkers(errors);
  const full = fs.readFileSync("TASKS.md", "utf8");
  const body = full.split(/\r?\n## 3\./).slice(1).join("## 3.") || full;
  const rows = parse(body).filter((r) => r.id.startsWith("T-") && r.id !== "T-000");
  if (rows.length === 0) errors.push("No task rows found below section 3.");
  const seen = new Set();
  for (const t of rows) {
    const at = `TASKS.md:${t.line} ${t.id}`;
    if (seen.has(t.id)) errors.push(`${at}: duplicate task id.`);
    seen.add(t.id);
    for (const f of REQUIRED) if (t.fields[f] === undefined) errors.push(`${at}: missing "- ${f}:" line.`);
    if (!["1", "2", "3"].includes(t.fields.Tier)) errors.push(`${at}: Tier must be 1, 2 or 3.`);
    if (/^done\b/.test(t.fields.Status ?? "") && PLACEHOLDER.test(t.fields.Evidence ?? ""))
      errors.push(`${at}: Status done but Evidence is empty. Name a real artifact or number.`);
  }
  // A decided OP must appear in DECISIONS.md (the link is a lint, not a generator).
  if (fs.existsSync("OPERATOR_TODO.md") && fs.existsSync("DECISIONS.md")) {
    const log = fs.readFileSync("DECISIONS.md", "utf8");
    for (const op of parse(fs.readFileSync("OPERATOR_TODO.md", "utf8")).filter((r) => r.id.startsWith("OP-"))) {
      if (/^decided\b/.test(op.fields.Status ?? "") && !names(log, op.id))
        errors.push(`OPERATOR_TODO.md ${op.id}: decided but no DECISIONS.md row names it.`);
    }
  }
  if (errors.length) { errors.forEach((e) => console.error("FAIL: " + e)); process.exit(1); }
  console.log(`lint ok: ${rows.length} tasks, board well formed.`);
}

function busState(id) {
  const any = (dir, pred) => fs.existsSync(path.join(BUS, dir)) && fs.readdirSync(path.join(BUS, dir)).some(pred);
  if (any("findings", (n) => n.startsWith(id + "."))) return "done";
  if (any("escalations", (n) => n === id + ".json")) return "escalated";
  if (any("claims", (n) => n === id + ".OWNED")) return "claimed";
  return "open";
}

function summary() {
  const body = fs.readFileSync("TASKS.md", "utf8").split(/\r?\n## 3\./).slice(1).join("## 3.");
  const rows = parse(body).filter((r) => r.id.startsWith("T-") && r.id !== "T-000");
  const counts = { open: 0, claimed: 0, done: 0, escalated: 0 };
  console.log("\n  task     tier  state       title");
  console.log("  " + "-".repeat(60));
  for (const t of rows) {
    const s = busState(t.id); counts[s]++;
    console.log(`  ${t.id.padEnd(8)} T${t.fields.Tier}    ${s.padEnd(11)} ${t.title}`);
  }
  console.log("  " + "-".repeat(60));
  console.log(`  ${rows.length} tasks: ${counts.open} open, ${counts.claimed} claimed, ${counts.done} done, ${counts.escalated} escalated\n`);
}

// Recent research-quality records written by research.mjs (newest last).
function recentResearch(n = 6) {
  const dir = path.join(BUS, "research");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().slice(-n)
    .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return null; } })
    .filter(Boolean);
}

// Live monitor: board state + recent result quality, refreshed on a timer. Works in any folder.
function watch() {
  const tick = () => {
    console.clear();
    console.log(`filebus monitor — ${new Date().toLocaleTimeString()}   (Ctrl+C to stop)`);
    try { summary(); } catch { console.log("  (no TASKS.md board here)"); }
    const r = recentResearch();
    if (r.length) {
      console.log("  recent research — computed quality:");
      for (const x of r) {
        const mark = x.abstain ? "✗ ABSTAIN" : "✓ PASS   ";
        console.log(`  ${mark} faith ${x.faithfulness} (${x.supported}/${x.checkable})  ${x.mode}/${x.tier}  ${x.seconds}s  ${(x.question || "").slice(0, 46)}`);
      }
    }
  };
  tick();
  setInterval(tick, 2000);
}

const cmd = process.argv[2] || "lint";
if (cmd === "lint") lint();
else if (cmd === "summary") summary();
else if (cmd === "watch") watch();
else { console.error("usage: board.mjs lint|summary|watch"); process.exit(2); }
