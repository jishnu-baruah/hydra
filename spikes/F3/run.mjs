// T-F03: load the spike extension, open each dApp page, and let the background worker list and
// hash every script the page loaded. Also try the same fetches from the page itself, which is
// what a content script would be limited to, to count CORS failures. Writes result.json.
//
//   cd spikes/F3 && npm ci && npx playwright install chromium && node run.mjs
import { chromium } from "playwright";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PAGES = [
  "https://app.uniswap.org/",
  "https://app.aave.com/",
  "https://stake.lido.fi/",
  "https://app.1inch.io/",
  "https://pancakeswap.finance/",
];
const SETTLE_MS = 8000; // let lazy chunks load after the load event

const ext = resolve(import.meta.dirname, "extension");
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "hydra-f3-")), {
  headless: false,
  args: ["--headless=new", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));

const pages = [];
for (const target of PAGES) {
  const page = await ctx.newPage();
  const row = { target };
  try {
    await page.goto(target, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(SETTLE_MS);
    row.final_url = page.url();
    row.inline_scripts = await page.evaluate(() => document.querySelectorAll("script:not([src])").length);
    const scripts = await sw.evaluate((u) => globalThis.hydraReport(u), row.final_url);
    // Same URLs from the page origin: what we would get without the extension's host permission.
    const pageFetch = await page.evaluate(async (urls) => {
      const out = {};
      for (const u of urls) {
        try {
          const r = await fetch(u, { cache: "no-store", credentials: "omit" });
          out[u] = r.ok ? "ok" : `HTTP ${r.status}`;
        } catch (e) {
          // fetch() gives the same TypeError for CORS and for network errors, so this is an upper bound.
          out[u] = new URL(u).origin === location.origin ? `network: ${e.message}` : "cors_or_network";
        }
      }
      return out;
    }, scripts.map((s) => s.url));
    for (const s of scripts) s.page_fetch = pageFetch[s.url];
    const origin = new URL(row.final_url).origin;
    row.scripts_seen = scripts.length;
    row.same_origin = scripts.filter((s) => new URL(s.url).origin === origin).length;
    row.hashed = scripts.filter((s) => s.sha256).length;
    row.worker_failures = scripts.filter((s) => s.error).length;
    row.unstable = scripts.filter((s) => s.stable === false).length;
    row.page_cors_failures = scripts.filter((s) => s.page_fetch === "cors_or_network").length;
    row.from_iframes = scripts.filter((s) => s.frame_id !== 0).length;
    row.ok = row.scripts_seen > 0 && row.hashed === row.scripts_seen;
    row.scripts = scripts;
  } catch (e) {
    row.ok = false;
    row.error = String(e.message ?? e).split("\n")[0];
  }
  console.log(
    `${row.ok ? "OK  " : "FAIL"} ${target} seen=${row.scripts_seen} hashed=${row.hashed} ` +
      `worker_fail=${row.worker_failures} page_cors=${row.page_cors_failures} unstable=${row.unstable}` +
      (row.error ? ` error=${row.error}` : ""),
  );
  pages.push(row);
  await page.close();
}
await ctx.close();

const sum = (k) => pages.reduce((n, p) => n + (p[k] ?? 0), 0);
const result = {
  task: "T-F03",
  ran_at: new Date().toISOString(),
  browser: `Playwright ${(await import("playwright/package.json", { with: { type: "json" } })).default.version} Chromium, --headless=new`,
  pages_ok: pages.filter((p) => p.ok).length,
  pages_total: pages.length,
  scripts_seen: sum("scripts_seen"),
  scripts_hashed: sum("hashed"),
  worker_failures: sum("worker_failures"),
  page_cors_failures: sum("page_cors_failures"),
  unstable_scripts: sum("unstable"),
  pages,
};
writeFileSync(resolve(import.meta.dirname, "result.json"), JSON.stringify(result, null, 2) + "\n");
console.log(`${result.pages_ok} of ${result.pages_total} pages ok; ${result.scripts_hashed} of ${result.scripts_seen} scripts hashed`);
