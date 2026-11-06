// Restores the real demo site (deploys demo/ itself) and checks the verdict goes back to match.
// Usage: node demo/restore.mjs [--no-check]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEMO_DIR, REPO, deploy, liveHash, releaseHash, sha256, timer, verdictStep, waitFor, yn } from "./lib.mjs";

const noCheck = process.argv.includes("--no-check");
const tm = timer();
try {
  const rel = await releaseHash();
  let dirty = "";
  try {
    dirty = execFileSync("git", ["status", "--porcelain", "--", "demo/app.js"], { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    // git unavailable: the hash check below still guards
  }
  const local = sha256(readFileSync(join(DEMO_DIR, "app.js")));
  if (dirty || local !== rel) {
    throw new Error(`demo/app.js is ${dirty ? "modified in git" : "different from the published release"} (local ${local.slice(0, 12)}, release ${rel.slice(0, 12)}). Run: git checkout -- demo/app.js`);
  }
  tm.log("deploying demo/ to production");
  await deploy(DEMO_DIR);
  tm.log("deploy finished, waiting for the live app.js to equal the release");
  await waitFor(async () => (await liveHash()) === rel, { timeoutMs: 90000, everyMs: 2000, label: "the live /app.js to match the release" });
  const tLive = tm.elapsed();
  tm.log("live site is restored");
  const step = noCheck ? null : await verdictStep("match", tm);
  console.log("");
  console.log(`Summary: live restored after ${tLive.toFixed(1)} s`
    + (step ? `, match ${step.recorded ? `recorded after ${step.seconds.toFixed(1)} s (via ${step.via})` : "NOT recorded"}, alert sent: ${yn(step.alert)}` : ", check skipped (--no-check)"));
} catch (e) {
  console.error(`restore failed: ${e.message}`);
  process.exitCode = 1;
}
