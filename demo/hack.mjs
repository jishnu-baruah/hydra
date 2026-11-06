// Staged hijack: deploys a tampered COPY of the demo to production. demo/app.js is never changed.
// Usage: node demo/hack.mjs [--no-check]
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEMO_DIR, deploy, liveHash, releaseHash, timer, verdictStep, waitFor, yn } from "./lib.mjs";

const noCheck = process.argv.includes("--no-check");
const tm = timer();
const tmp = mkdtempSync(join(tmpdir(), "hydra-hack-"));
try {
  const rel = await releaseHash();
  tm.log(`release hash ${rel.slice(0, 12)}`);
  if (!existsSync(join(DEMO_DIR, ".vercel"))) {
    throw new Error('demo/.vercel is missing, so the folder is not linked to the Vercel project. Run "vercel link" in demo/ and retry.');
  }
  for (const f of ["index.html", "app.js", "vercel.json", ".well-known", ".vercel", ".vercelignore"]) {
    if (existsSync(join(DEMO_DIR, f))) cpSync(join(DEMO_DIR, f), join(tmp, f), { recursive: true });
  }
  const copy = join(tmp, "app.js");
  writeFileSync(copy, readFileSync(copy, "utf8") + '\nconsole.warn("injected by the staged demo hijack");\n');
  tm.log("deploying the tampered copy to production");
  await deploy(tmp);
  tm.log("deploy finished, waiting for the live app.js to differ from the release");
  await waitFor(async () => (await liveHash()) !== rel, { timeoutMs: 90000, everyMs: 2000, label: "the live /app.js to change" });
  const tLive = tm.elapsed();
  tm.log("live site is tampered");
  const step = noCheck ? null : await verdictStep("mismatch", tm);
  console.log("");
  console.log(`Summary: live tamper after ${tLive.toFixed(1)} s`
    + (step ? `, mismatch ${step.recorded ? `recorded after ${step.seconds.toFixed(1)} s (via ${step.via})` : "NOT recorded"}, alert sent: ${yn(step.alert)}` : ", check skipped (--no-check)"));
  console.log("Undo with: node demo/restore.mjs");
} catch (e) {
  console.error(`hack failed: ${e.message}`);
  console.error("If a deploy went out, run: node demo/restore.mjs");
  process.exitCode = 1;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
