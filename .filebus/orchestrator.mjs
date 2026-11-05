// orchestrator.mjs — the planner. Turns a goal into tiered task rows appended to TASKS.md.
// Runs on your frontier model (ROUTES.planner = Claude Max via `claude -p`). Single writer: you
// run it; it is the only thing that appends to the board, so there is no write race here.
//
//   node orchestrator.mjs "build a URL shortener with tests"
import fs from "node:fs/promises";
import { ROUTES, SETTINGS } from "./config.mjs";
import { callLLM } from "./lib/llm.mjs";

const goal = process.argv.slice(2).join(" ");
if (!goal) { console.error('usage: node orchestrator.mjs "<goal>"'); process.exit(2); }

const system =
  "You are a planner. Decompose the goal into small, independent tasks. Output ONLY a JSON array. " +
  "Each item: {title, tier, touches, acceptance, dependsOn}. tier: 1=mechanical, 2=checkable, " +
  "3=judgment. touches: the one file/glob the task may edit. acceptance: done-condition with a " +
  "number where possible. dependsOn: array of task indexes (0-based) that must finish first. " +
  "Prefer tier 1. No prose, no code fences.";

const raw = await callLLM({ system, prompt: `Goal: ${goal}`, route: ROUTES.planner });
let items;
try { items = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, "")); }
catch { console.error("planner did not return JSON:\n" + raw); process.exit(1); }

const existing = await fs.readFile("TASKS.md", "utf8");
const used = [...existing.matchAll(/^### (T-\d+)/gm)].map((m) => Number(m[1].slice(2)));
let n = used.length ? Math.max(...used) : 0;
const ids = items.map(() => `T-${String(++n).padStart(3, "0")}`);

const rows = items.map((it, i) => {
  const deps = (it.dependsOn || []).map((d) => ids[d]).filter(Boolean).join(", ") || "-";
  return `### ${ids[i]}, ${it.title}\n- Status: open\n- Tier: ${it.tier || 1}\n` +
    `- Depends-on: ${deps}\n- Touches: ${it.touches || "-"}\n- Acceptance: ${it.acceptance || "-"}\n- Evidence: -\n`;
}).join("\n");

await fs.appendFile("TASKS.md", "\n" + rows);
console.log(`planned ${items.length} tasks: ${ids.join(", ")}`);
console.log("run:  npm run swarm   (then: npm run board)");
