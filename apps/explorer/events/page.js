// The events feed, read live from Arkiv and refreshed every minute while the tab is visible.
// Arkiv data is shown with textContent only.
import { timeline, only } from "./events.js";

const REFRESH_MS = 60_000;
const $ = (id) => document.getElementById(id);
const status = (text, error = false) => {
  $("status").textContent = text;
  $("status").className = error ? "error" : "";
};
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const link = (text, href) => Object.assign(el("a", "", text), { href });

const pad = (n) => String(n).padStart(2, "0");
const clock = (ms) => {
  const d = new Date(ms);
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return new Date().toISOString().slice(0, 10) === d.toISOString().slice(0, 10) ? time : `${d.toISOString().slice(5, 10)} ${time}`;
};
function ago(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

function item(e, fresh) {
  const li = el("li", `ev ev-${e.kind}${fresh ? " new" : ""}`);
  const when = el("div", "when");
  when.append(el("b", "", `${clock(e.at)} UTC`), el("small", "", ago(e.at)));
  const what = el("div", "what");
  const detail = el("p", "detail");

  if (e.kind === "claim") {
    what.append(el("span", "kind", "Name claimed"), link(e.app, `../app/?name=${encodeURIComponent(e.app)}`));
    detail.textContent = `reserved by ${e.publisher.slice(0, 6)}...${e.publisher.slice(-4)} when it got its API key`;
  } else if (e.kind === "release") {
    what.append(el("span", "kind", "Release"), link(e.app, `../app/?name=${encodeURIComponent(e.app)}`), el("span", "chip", e.version));
    detail.textContent = `commit ${e.commit.slice(0, 12)}, ${e.files} file${e.files === 1 ? "" : "s"}`;
    if (e.ci) detail.append(", ", Object.assign(link("CI run", e.ci), { target: "_blank", rel: "noopener noreferrer" }));
  } else {
    what.append(el("span", "kind", "Observed"), link(e.domain, `../observed/?domain=${encodeURIComponent(e.domain)}`), el("span", `chip ${e.status}`, e.status));
    // A site with no release churns its scripts on its own (spike F3), so a change there is news,
    // not an alarm. On a published site it is the alarm.
    if (e.changed) what.append(el("span", e.status === "unknown" ? "chip churn" : "chip changed", e.status === "unknown" ? "Script set changed" : "Scripts changed"));
    const parts = [];
    const unreachable = e.problems.some((x) => x.startsWith("UNREACHABLE"));
    if (e.empty) parts.push(el("span", "warn", unreachable ? "the indexer could not reach the site" : "0 scripts seen: the indexer may have got a bot check or an empty shell"));
    else if (e.scripts !== null) parts.push(`${e.scripts} script${e.scripts === 1 ? "" : "s"}`);
    if (e.problems.length) parts.push(`${e.problems[0]}${e.problems.length > 1 ? ` and ${e.problems.length - 1} more` : ""}`);
    if (e.status === "unknown" && !e.empty) parts.push("no Hydra release for this site yet");
    parts.forEach((p, i) => detail.append(i ? ", " : "", p));
  }
  li.append(when, what, detail);
  return li;
}

let events = [];
let mode = "all";
let updated = 0;
let loading = false;

// fresh: keys that arrived with the latest load, highlighted once. A filter click passes none.
function render(fresh = new Set()) {
  for (const b of document.querySelectorAll("[data-mode]")) {
    b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
    b.querySelector("span").textContent = String(only(events, b.dataset.mode).length);
  }
  const shown = only(events, mode);
  $("feed").replaceChildren(...shown.map((e) => item(e, fresh.has(e.key))));
  if (!events.length) status("Nothing on Arkiv yet. Releases appear when a team publishes; observations once the indexer runs, about every 30 minutes. It writes a new observation when something changes, plus one a day.");
  else if (!shown.length) status(mode === "changes" ? "No changes that matter: no mismatch, and no published site changed its scripts. Sites without a release that churn are under Observed." : "Nothing of this kind yet.");
  else status(`${shown.length} event(s). Updated ${clock(updated)} UTC; refreshes every minute.`);
}

document.querySelector(".filters").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-mode]");
  if (!b) return;
  mode = b.dataset.mode;
  render();
});

let arkiv;
async function load() {
  if (loading) return; // a slow load is still running; do not start a second
  loading = true;
  try {
    arkiv ??= await import("../src/arkiv.js");
    const [releases, observations, apps] = await Promise.all([arkiv.latestReleases(100), arkiv.latestObservations(100), arkiv.latestApps(100)]);
    const next = timeline(releases, observations, apps);
    const before = new Set(events.map((e) => e.key));
    const fresh = events.length ? new Set(next.filter((e) => !before.has(e.key)).map((e) => e.key)) : new Set();
    events = next;
    updated = Date.now();
    render(fresh);
  } catch (err) {
    status(
      arkiv
        ? `Could not read Arkiv: ${arkiv.rootCause(err)}. It retries in a minute; reload to try now.`
        : `Could not load the Arkiv SDK from cdn.jsdelivr.net (${err.message}). Check that the CDN is reachable from this network, then reload.`,
      true,
    );
  }
  loading = false;
  document.body.dataset.done = "1";
}

await load();
setInterval(() => {
  if (!document.hidden) load();
}, REFRESH_MS);
