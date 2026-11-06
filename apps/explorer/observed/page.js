// /observed/: every site the indexer watches. /observed/?domain=<site>: one site's history.
// Arkiv data is shown with textContent only.
import { timeline, decode } from "../events/events.js";
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

function scriptsLine(e) {
  if (e.empty) return e.problems.some((p) => p.startsWith("UNREACHABLE")) ? "unreachable" : "0 seen";
  return e.scripts === null ? "" : String(e.scripts);
}

async function index(arkiv) {
  const all = sites(timeline([], await arkiv.latestObservations(100)));
  if (!all.length) return status("The indexer has not written any observations yet. It runs about every 30 minutes. It writes a new observation when something changes, plus one a day.");
  $("view").append(
    table(
      ["Site", "Latest", "Last seen", "Runs", "Changes", "On Hydra"],
      all.map((s) => {
        const a = Object.assign(el("a", "", s.domain), { href: `?domain=${encodeURIComponent(s.domain)}` });
        return [a, chip(s.status), when(s.lastSeen), String(s.runs), String(s.changes), s.published ? "published" : "observed, not published by the team"];
      }),
    ),
  );
  status(`${all.length} site(s) watched, from the last ${all.reduce((n, s) => n + s.runs, 0)} observations.`);
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
        chip(e.status),
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
