// lib/bus.mjs — the file-based message bus. Atomic writes + claims so parallel
// workers never clobber each other (the #1 failure of naive shared-file setups).
//
// Layout under SETTINGS.bus:
//   tasks/<id>.json         queued work (written by planner)
//   claims/<id>.<worker>    lock: a worker owns this task (atomic create)
//   findings/<id>.<worker>.json  a worker's result + trace
//   escalations/<id>.json   reconciler kicked it back to the planner
//   done.md                 append-only ledger (id, decision, model, traceHash)

import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export function dirs(bus) {
  return {
    bus,
    tasks: path.join(bus, "tasks"),
    claims: path.join(bus, "claims"),
    findings: path.join(bus, "findings"),
    escalations: path.join(bus, "escalations"),
    done: path.join(bus, "done.md"),
  };
}

export async function initBus(bus) {
  const d = dirs(bus);
  for (const p of [d.tasks, d.claims, d.findings, d.escalations])
    await fsp.mkdir(p, { recursive: true });
  if (!fs.existsSync(d.done))
    await fsp.writeFile(d.done, "# done ledger\n\n| time | task | decision | model | traceHash |\n|---|---|---|---|---|\n");
  return d;
}

// Atomic write: write a temp file then rename (rename is atomic on NTFS + POSIX).
export async function atomicWrite(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
}

export async function writeJSON(file, obj) {
  await atomicWrite(file, JSON.stringify(obj, null, 2));
}

export async function readJSON(file) {
  return JSON.parse(await fsp.readFile(file, "utf8"));
}

// Claim a task: exclusive create of the lock file. Returns false if someone beat us.
export async function claim(d, taskId, workerId) {
  const lock = path.join(d.claims, `${taskId}.${workerId}`);
  const owned = path.join(d.claims, `${taskId}.OWNED`);
  if (fs.existsSync(owned)) return false;
  try {
    // "wx" = fail if exists -> atomic ownership
    const fh = await fsp.open(owned, "wx");
    await fh.writeFile(`${workerId} ${new Date().toISOString()}`);
    await fh.close();
    await fsp.writeFile(lock, workerId);
    return true;
  } catch (e) {
    if (e.code === "EEXIST") return false;
    throw e;
  }
}

// Canonical JSON so the trace hash is stable regardless of key order — Bombe's
// reasoningHash idea, in sha256 instead of keccak.
export function traceHash(obj) {
  const canon = JSON.stringify(sortKeys(obj));
  return createHash("sha256").update(canon).digest("hex").slice(0, 16);
}
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object")
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

export async function listJSON(dir) {
  if (!fs.existsSync(dir)) return [];
  const names = (await fsp.readdir(dir)).filter((n) => n.endsWith(".json"));
  return Promise.all(names.map(async (n) => ({ name: n, ...(await readJSON(path.join(dir, n))) })));
}

export async function appendDone(d, row) {
  const line = `| ${new Date().toISOString()} | ${row.taskId} | ${row.decision} | ${row.model} | ${row.traceHash} |\n`;
  await fsp.appendFile(d.done, line); // append is safe for single-line rows
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const uid = (p = "w") => `${p}${Math.random().toString(36).slice(2, 7)}`;
