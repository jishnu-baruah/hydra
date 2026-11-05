// worker.mjs — one worker. Claims an open, ready task (atomic lock), runs it on its tier's model,
// writes a finding, or escalates. T3 and ABSTAIN never produce a result; they go to the human queue.
// Every concurrent write lands in a DISTINCT file (agon-dev's lesson), so no locks beyond the claim.
import fs from "node:fs";
import path from "node:path";
import { ROUTES, SETTINGS } from "./config.mjs";
import { callLLM, parseConfidence } from "./lib/llm.mjs";
import { initBus, claim, writeJSON, traceHash, sleep, uid } from "./lib/bus.mjs";

const WORKER = process.env.WORKER_ID || uid("w");
const BUS = SETTINGS.bus;

function parseTasks() {
  const body = fs.readFileSync("TASKS.md", "utf8").split(/\r?\n## 3\./).slice(1).join("## 3.");
  const rows = []; let cur = null, field = null;
  body.split(/\r?\n/).forEach((line) => {
    const h = /^### (T-\d+),\s*(.+)$/.exec(line);
    if (h) { cur = { id: h[1], title: h[2], f: {} }; rows.push(cur); field = null; return; }
    if (line.startsWith("### ")) cur = null;
    if (!cur) return;
    const m = /^- ([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (m) { field = m[1]; cur.f[field] = m[2].trim(); return; }
    if (field && /^\s+\S/.test(line)) cur.f[field] = `${cur.f[field]} ${line.trim()}`.trim();
    else field = null;
  });
  return rows.filter((r) => r.id !== "T-000");
}
const isDone = (id) => fs.existsSync(path.join(BUS, "findings")) &&
  fs.readdirSync(path.join(BUS, "findings")).some((n) => n.startsWith(id + "."));
const isTaken = (id) => fs.existsSync(path.join(BUS, "claims", `${id}.OWNED`)) ||
  fs.existsSync(path.join(BUS, "escalations", `${id}.json`)) || isDone(id);
const depsReady = (t) => (t.f["Depends-on"] || "-").split(/[,\s]+/).filter((d) => /^T-\d+$/.test(d)).every(isDone);

async function escalate(d, t, reason) {
  await writeJSON(path.join(BUS, "escalations", `${t.id}.json`),
    { taskId: t.id, title: t.title, tier: t.f.Tier, reason, worker: WORKER, ts: new Date().toISOString() });
  console.log(`${WORKER} escalated ${t.id} (${reason})`);
}

async function run(d, t) {
  const tier = Number(t.f.Tier) || 1;
  if (tier === 3) return escalate(d, t, "tier 3 judgment, for the planner/human");
  const route = ROUTES[tier] || ROUTES[1];
  const prompt = `Task ${t.id}: ${t.title}\nMay edit only: ${t.f.Touches}\nAcceptance: ${t.f.Acceptance}\n` +
    `Do the task. End with a line "CONFIDENCE: NN" (0-100).`;
  let out;
  try { out = await callLLM({ system: SETTINGS.workerSystem, prompt, route, maxTokens: SETTINGS.maxTokens }); }
  catch (e) { return escalate(d, t, "model error: " + e.message.slice(0, 120)); }
  if (out.trim() === "ABSTAIN") return escalate(d, t, "worker abstained");
  const confidence = parseConfidence(out);

  let verified = tier === 1 || confidence >= SETTINGS.highConfidence;
  if (tier === 2 && !verified) {
    // Checkable work the worker was unsure about: a frontier pass gates it (verdict != generation).
    const v = await callLLM({ system: "Reply with exactly PASS or FAIL.", route: ROUTES.planner,
      prompt: `Acceptance: ${t.f.Acceptance}\n\nResult:\n${out}\n\nDoes the result meet the acceptance?` });
    verified = /PASS/i.test(v);
    if (!verified) return escalate(d, t, "failed verification");
  }
  const finding = { taskId: t.id, worker: WORKER, tier, decision: "DONE", confidence, verified,
    model: route.model, output: out, ts: new Date().toISOString() };
  finding.traceHash = traceHash({ taskId: t.id, output: out });
  await writeJSON(path.join(BUS, "findings", `${t.id}.${WORKER}.json`), finding);
  console.log(`${WORKER} done ${t.id} [conf ${confidence} ${verified ? "verified" : "accepted"} ${finding.traceHash}]`);
}

const d = await initBus(BUS);
let idle = 0;
while (idle < 3) {
  const t = parseTasks().find((t) => t.f.Status?.startsWith("open") && !isTaken(t.id) && depsReady(t));
  if (!t) { idle++; await sleep(SETTINGS.pollMs); continue; }
  idle = 0;
  if (!(await claim(d, t.id, WORKER))) continue; // lost the race
  await run(d, t);
}
console.log(`${WORKER} idle, exiting.`);
