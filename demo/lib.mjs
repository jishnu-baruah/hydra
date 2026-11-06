// Shared helpers for the demo kit (hack.mjs, restore.mjs, status.mjs). Node built-ins only.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const API = "https://hydra-api-5xmn.onrender.com";
export const SITE = "https://hydra-demo-dapp.vercel.app";
export const DOMAIN = "hydra-demo-dapp.vercel.app";
export const APP = "demo-dapp";
export const DEMO_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(DEMO_DIR, "..");

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Prints "[+12.3s] message" relative to creation.
export function timer() {
  const t0 = Date.now();
  const elapsed = () => (Date.now() - t0) / 1000;
  const log = (msg) => console.log(`[+${elapsed().toFixed(1)}s] ${msg}`);
  return { t0, elapsed, log };
}

async function get(url) {
  try {
    // The API sleeps on Render's free plan and its first answer can take about 50 s.
    return await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(url.startsWith(API) ? 70000 : 20000) });
  } catch (e) {
    throw new Error(`cannot reach ${url} (${e.cause?.code ?? e.message}). Check your network; if the Hydra API is waking up on Render, retry in 30 s.`);
  }
}

// sha256 hex the newest release manifest holds for /app.js.
export async function releaseHash() {
  const res = await get(`${API}/v1/apps/${APP}/releases`);
  if (!res.ok) throw new Error(`releases request failed with HTTP ${res.status}. Retry in a moment; if it persists check the API on Render.`);
  const h = (await res.json())?.releases?.[0]?.payload?.manifest?.files?.["/app.js"];
  if (typeof h !== "string") throw new Error(`no /app.js hash in the latest ${APP} release. Publish the demo app first (see demo/README.md).`);
  return h.replace(/^sha256-/, "").toLowerCase();
}

// sha256 hex of the live /app.js bytes, bypassing caches.
export async function liveHash() {
  const res = await get(`${SITE}/app.js?cb=${Date.now()}${Math.random().toString(36).slice(2, 6)}`);
  if (!res.ok) throw new Error(`live /app.js returned HTTP ${res.status}. Check ${SITE} is deployed (vercel --prod --yes in demo/).`);
  return sha256(Buffer.from(await res.arrayBuffer()));
}

// Latest indexer view of our domain: { status, observed_at, problems, history } or null. Read straight
// from Arkiv for this one domain: the API's /v1/observations reads every site and can take over a minute
// uncached, while this is 1 small query.
const INDEXER = "0xc4e52D70880a83331E1cCd0AD745059D12565ea9";
export async function latestVerdict() {
  const core = await import("../packages/core/src/index.ts");
  const { publicClient } = core.arkivClients({ accessKey: process.env.ARKIV_ACCESS_KEY });
  let page;
  try {
    page = await publicClient
      .select({ status: true, observed_at: true, body: true })
      .from(core.ObservationSchema)
      .where(core.eq("domain", DOMAIN))
      .createdBy(INDEXER)
      .orderBy(core.desc("observed_at"))
      .limit(5)
      .fetch();
  } catch (e) {
    throw new Error(`cannot read observations from Arkiv (${core.rootCause(e)}). Retry in a moment; the public Rabdi RPC rate limits.`);
  }
  const v = (x) => (x && typeof x === "object" && "value" in x ? x.value : x);
  const rows = page.entities.map((e) => {
    let problems = [];
    try {
      problems = JSON.parse(Buffer.from(String(v(e.body)).slice(2), "hex").toString("utf8")).problems ?? [];
    } catch {
      // an unreadable body still has a status
    }
    return { status: String(v(e.status)), observed_at: Number(v(e.observed_at)), problems };
  });
  if (!rows.length) return null;
  return { ...rows[0], history: rows };
}

// Public watcher state, or null when /v1/watch is not deployed (404).
export async function watchState() {
  const res = await get(`${API}/v1/watch`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`watch request failed with HTTP ${res.status}. Retry in a moment.`);
  return res.json();
}

export const watcherOn = (w) => !!(w && w.on && w.domain === DOMAIN);

// Child env without anything that looks like a secret (Vercel's own login lives in its config dir).
const SECRETISH = /(KEY|SECRET|TOKEN|PASSWORD|PRIVATE|MNEMONIC)/i;
function cleanEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^VERCEL_/i.test(k) || !SECRETISH.test(k)) env[k] = v;
  }
  return env;
}

// vercel --prod --yes in dir. Resolves on exit 0, throws with the last stderr lines otherwise.
export function deploy(dir) {
  return new Promise((resolveP, reject) => {
    // One fixed command string (no user input in it): Windows needs a shell to find vercel.cmd.
    const p = spawn("vercel --prod --yes", {
      cwd: dir,
      env: cleanEnv(),
      shell: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let err = "";
    p.stderr.on("data", (d) => { err = (err + d).slice(-4000); });
    p.on("error", (e) => reject(new Error(`could not start the Vercel CLI (${e.message}). Install it with "npm i -g vercel" and run "vercel login".`)));
    p.on("close", (code) => {
      if (code === 0) return resolveP();
      const tail = err.trim().split(/\r?\n/).slice(-6).join("\n");
      reject(new Error(`vercel exited with code ${code}. Last output:\n${tail}\nFix the cause above (run "vercel login" if it says not logged in) and retry.`));
    });
  });
}

// The one-site real check (T-A23). Streams output prefixed "  check: ". Returns { status, alert, summary }.
export function runCheck() {
  const envFile = resolve(process.env.HYDRA_ENV_FILE || resolve(REPO, ".env"));
  if (!existsSync(envFile)) {
    return Promise.reject(new Error(`env file not found: ${envFile}. Create ${resolve(REPO, ".env")} or set HYDRA_ENV_FILE to the .env path of a Hydra checkout (or rerun with --no-check).`));
  }
  const cwd = resolve(REPO, "packages", "indexer");
  if (!existsSync(resolve(cwd, "node_modules")) && !existsSync(resolve(REPO, "node_modules"))) {
    return Promise.reject(new Error(`dependencies are not installed in ${REPO}. Run "pnpm install" at the repo root, then retry.`));
  }
  return new Promise((resolveP, reject) => {
    const p = spawn(process.execPath, [`--env-file=${envFile}`, "src/main.ts", "--once"], {
      cwd,
      env: { ...process.env, INDEXER_ONLY: DOMAIN },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let status = null, alert = false, summary = "", buf = "";
    const onLine = (line) => {
      if (!line.trim()) return;
      console.log(`  check: ${line}`);
      const m = line.match(/^(match|mismatch|unreachable)\s+(\S+)/i);
      if (m && m[2] === DOMAIN) status = m[1].toLowerCase();
      if (/^ALERT\b/.test(line)) alert = true;
      if (/\d+ sites?,/.test(line)) summary = line;
    };
    const feed = (d) => {
      buf += d;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      lines.forEach(onLine);
    };
    p.stdout.on("data", feed);
    p.stderr.on("data", feed);
    p.on("error", (e) => reject(new Error(`could not start the indexer check (${e.message}). Check Node 24 is on PATH.`)));
    p.on("close", (code) => {
      if (buf) onLine(buf);
      if (code !== 0) return reject(new Error(`the indexer check exited with code ${code}. Read the "check:" lines above (a missing key in ${envFile} is the usual cause) and retry, or use --no-check.`));
      resolveP({ status, alert, summary });
    });
  });
}

// Polls fn until it returns something truthy; throws a labelled timeout otherwise.
export async function waitFor(fn, { timeoutMs = 90000, everyMs = 2000, label = "the condition" } = {}) {
  const end = Date.now() + timeoutMs;
  let lastErr = null;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      lastErr = e;
    }
    if (Date.now() >= end) {
      throw new Error(`timed out after ${Math.round(timeoutMs / 1000)} s waiting for ${label}${lastErr ? ` (last error: ${lastErr.message})` : ""}. Check the site and API are up, then retry.`);
    }
    await sleep(everyMs);
  }
}

// Watcher-or-check step shared by hack and restore. expect is "mismatch" or "match".
// Returns { via, seconds, recorded, alert }; alert is true, false or null (unknown).
export async function verdictStep(expect, tm) {
  const startedAt = Date.now();
  const w = await watchState();
  if (watcherOn(w)) {
    tm.log(`watcher is on for ${DOMAIN}; waiting for it to record a flip to ${expect} (up to 60 s)`);
    try {
      const flip = await waitFor(async () => {
        const s = await watchState();
        return s?.flips?.find((f) => f.at >= startedAt - 1000 && f.to === expect && f.alert !== "pending") ?? null;
      }, { timeoutMs: 60000, everyMs: 1000, label: `a watcher flip to ${expect}` });
      tm.log(`watcher recorded the flip to ${expect}, alert ${flip.alert}`);
      return { via: "watcher", seconds: tm.elapsed(), recorded: true, alert: flip.alert === "done" };
    } catch (e) {
      tm.log(e.message);
      return { via: "watcher", seconds: null, recorded: false, alert: null };
    }
  }
  tm.log(w ? "watcher is off, running the one-site check" : "watcher not deployed, running the one-site check");
  const r = await runCheck();
  const ok = r.status === expect;
  tm.log(`check verdict: ${r.status ?? "unknown"}${ok ? "" : ` (expected ${expect})`}`);
  return { via: "check", seconds: tm.elapsed(), recorded: ok, alert: r.alert };
}

export const yn = (v) => (v === null ? "unknown" : v ? "yes" : "no");
