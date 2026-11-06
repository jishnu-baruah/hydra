// /observed/: every site the indexer watches. /observed/?domain=<site>: one site's history.
// Arkiv data is shown with textContent only.
import { timeline, decode, verdict } from "../events/events.js";
import { sites } from "./observed.js";

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
const when = (ms) => new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";
const chip = (s) => el("span", `chip ${s}`, s);
const vchip = (e) => {
  const v = verdict(e);
  return el("span", `chip sev-${v.level}`, v.label);
};

function table(head, rows) {
  const wrap = el("div", "table-wrap");
  const t = wrap.appendChild(el("table"));
  const tr = t.createTHead().insertRow();
  for (const h of head) tr.append(el("th", "", h));
  const body = t.createTBody();
  for (const cells of rows) {
    const r = body.insertRow();
    for (const c of cells) {
      const td = r.insertCell();
      if (c && typeof c === "object" && "cls" in c) {
        td.className = c.cls;
        td.append(c.node);
      } else td.append(c);
    }
  }
  return wrap;
}

function legend() {
  const d = el("p", "legend");
  for (const [cls, label, text] of [["green", "Green", "match, release published"], ["yellow", "Yellow", "change not proven harmful: unreachable, skipped, runtime origin, unknown"], ["red", "Red", "a served script in no release"]]) {
    d.append(el("span", `chip sev-${cls}`, label), ` ${text}  `);
  }
  return d;
}

function scriptsLine(e) {
  if (e.empty) return e.problems.some((p) => p.startsWith("UNREACHABLE")) ? "unreachable" : "0 seen";
  return e.scripts === null ? "" : String(e.scripts);
}

async function index(arkiv) {
  // Latest checks of every site plus the compared checks of bound ones, so a bound site checked less
  // often is not lost behind the coverage list. Deduplicated by entity key.
  const rows = [...(await arkiv.latestObservations(100)), ...(await arkiv.boundObservations(100))];
  const seen = sites(timeline([], [...new Map(rows.map((e) => [e.$key, e])).values()]));
  // Integrated = bound to a Hydra release: the indexer compared the site with one (match or
  // mismatch). Coverage-list sites with no release stay unknown and are not listed here.
  const all = seen.filter((s) => s.published);
  if (!all.length) {
    const none = el("p", "", "No integrated sites yet. ");
    none.append(Object.assign(el("a", "", "Publish one on the Publish page."), { href: "../publish/" }));
    $("status").replaceChildren(none);
    $("status").className = "";
    return;
  }
  $("view").append(
    table(
      ["Site", "Latest", "Last seen", "Runs", "Changes"],
      all.map((s) => {
        const a = Object.assign(el("a", "", s.domain), { href: `?domain=${encodeURIComponent(s.domain)}` });
        return [a, vchip(s.latest), when(s.lastSeen), { cls: "num", node: document.createTextNode(String(s.runs)) }, { cls: "num", node: document.createTextNode(String(s.changes)) }];
      }),
    ),
    legend(),
  );
  status(`${all.length} integrated site(s), from the last ${all.reduce((n, s) => n + s.runs, 0)} observations. ${seen.length - all.length} watched site(s) with no Hydra release are not listed.`);
}

async function site(arkiv, domain) {
  $("title").textContent = domain;
  $("crumb").textContent = "/ Observed site";
  document.title = `${domain}, Hydra explorer`;
  $("lede").textContent = "What Hydra's indexer saw on this site. It runs about every 30 minutes. It writes a new observation when something changes, plus one a day. Observations are kept 3 days.";
  if (!/^[a-z0-9.-]{1,253}$/i.test(domain)) return status(`"${domain}" is not a domain. Open a site from the list of observed sites.`, true);

  const rows = await arkiv.observationsFor(domain);
  const history = timeline([], rows);
  if (!history.length) return status(`The indexer has no observation of ${domain} in the last 3 days. Check the domain, or pick one from the list of observed sites.`);
  const [summary] = sites(history);
  $("unpublished").hidden = summary.published;

  const latestRow = rows.find((r) => r.$key === summary.latest.key);
  // Plain text, never links: these URLs come from a third-party site and may be hostile.
  const served = decode(latestRow?.$attributes?.body?.value)?.scripts ?? [];
  if (served.length) {
    $("view").append(
      el("h2", "", `Scripts served at ${when(summary.lastSeen)} (${served.length})`),
      table(
        ["Script", "sha256"],
        served.map((s) => [String(s.url), { cls: "hash", node: document.createTextNode(String(s.sha256).replace(/^sha256-/, "").slice(0, 16)) }]),
      ),
    );
  }
  $("view").append(
    el("h2", "", `History (${history.length})`),
    table(
      ["Observed", "Status", "Scripts", "Change", "Problems"],
      history.map((e) => [
        when(e.at),
        vchip(e),
        scriptsLine(e),
        e.changed ? chip(e.status === "unknown" ? "churn" : "changed") : "",
        e.problems.slice(0, 2).join("; ") + (e.problems.length > 2 ? ` and ${e.problems.length - 2} more` : ""),
      ]),
    ),
  );
  status(`${history.length} observation(s), the latest ${summary.status}${summary.published ? "" : ", observed, not published by the team"}. ${summary.changes} change(s) in the script set.`);
}

let arkiv;
try {
  arkiv = await import("../src/arkiv.js");
  const domain = (new URLSearchParams(location.search).get("domain") ?? "").trim().toLowerCase();
  await (domain ? site(arkiv, domain) : index(arkiv));
} catch (err) {
  status(
    arkiv
      ? `Could not read Arkiv: ${arkiv.rootCause(err)}. Reload; if it persists, the Rabdi RPC may be rate limiting this address.`
      : `Could not load the Arkiv SDK from cdn.jsdelivr.net (${err.message}). Check that the CDN is reachable from this network, then reload.`,
    true,
  );
}
document.body.dataset.done = "1";
