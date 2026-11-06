// Read-only snapshot of the demo: live vs release hash, latest verdict, watcher, what screens show.
// Usage: node demo/status.mjs
import { DOMAIN, latestVerdict, liveHash, releaseHash, watchState } from "./lib.mjs";

const toMs = (t) => (typeof t === "number" ? (t < 1e12 ? t * 1000 : t) : Date.parse(t));
const ago = (t) => {
  const s = Math.max(0, Math.round((Date.now() - toMs(t)) / 1000));
  return s < 90 ? `${s} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${(s / 3600).toFixed(1)} h ago`;
};

try {
  const [live, rel, obs, w] = await Promise.all([liveHash(), releaseHash(), latestVerdict(), watchState()]);
  const match = live === rel;
  console.log(`Live app.js  ${match ? "MATCH" : "DIFFERS"}  live ${live.slice(0, 12)}  release ${rel.slice(0, 12)}`);
  console.log(obs
    ? `Observation  ${obs.status}  ${ago(obs.observed_at)}${obs.problems?.length ? `  (${obs.problems[0]})` : ""}`
    : "Observation  none yet");
  console.log(`History      (newest first) ${obs?.history?.length ? obs.history.slice(0, 5).map((h) => h.status ?? h).join(", ") : "none"}`);
  let wl = "not deployed";
  if (w) {
    wl = w.on ? `on for ${w.domain}${w.domain !== DOMAIN ? ` (not ${DOMAIN})` : ""}` : `off${w.stoppedBecause ? ` (${w.stoppedBecause})` : ""}`;
    if (w.last) wl += `, last check ${w.last.verdict} ${ago(w.last.at)}`;
  }
  console.log(`Watcher      ${wl}`);
  const liveWord = match ? "match" : "mismatch";
  const rec = obs?.status ?? "none";
  let screens;
  if (rec === liveWord) {
    screens = match
      ? "all green: explorer app page and Live page show match, extension badge OK, no Telegram alert"
      : "all red: explorer app page and Live page show mismatch, extension badge warns, Telegram alert already sent";
  } else if (w?.on && w.domain === DOMAIN) {
    screens = `site is ${liveWord} but the record says ${rec}: the watcher should flip it within about 12 s`;
  } else {
    screens = `site is ${liveWord} but the record says ${rec}: explorer, Live page and Telegram lag until a check runs (hack and restore run one); the extension reacts to the live site at once`;
  }
  console.log(`What screens will show: ${screens}`);
} catch (e) {
  console.error(`status failed: ${e.message}`);
  process.exitCode = 1;
}
