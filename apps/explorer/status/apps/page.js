// All apps with an ENS link. Read-only: Arkiv, the Hydra API and ENS are read from the browser.
// Everything shown is data: textContent only, links only after validation in model.js.
import { api } from "../../src/api.js";
import { trustedReleases } from "../../app/releases.js";
import { barModel, headline, siteHistory } from "../../app/checks.js";
import { boundDomains } from "../../app/sites.js";
import { latestPerApp, rowModel } from "./model.js";

const $ = (id) => document.getElementById(id);
const el = (tag, text, attrs = {}) => {
  const node = Object.assign(document.createElement(tag), attrs);
  if (text !== undefined) node.textContent = text;
  return node;
};
const cell = (tr, ...kids) => tr.insertCell().append(...kids);
const link = (text, href) => (href ? el("a", text, { href }) : el("span", text));

let arkiv, ens;

async function checksCell(app, observations) {
  const box = el("div");
  try {
    const rels = (await api(`/v1/apps/${encodeURIComponent(app)}/releases`)).releases;
    const domain = boundDomains(rels)[0];
    if (!domain) return el("span", "no domain bound", { className: "muted" });
    const history = siteHistory(await observations, domain);
    const bar = el("div", undefined, { className: "checks-bar", role: "list" });
    for (const s of barModel(history)) bar.append(el("i", undefined, { className: `check ${s.tone}`, title: s.title, role: "listitem" }));
    box.append(el("span", `${domain}: ${headline(history, Date.now())}`, { className: "muted" }), bar);
  } catch (e) {
    box.append(el("span", `checks unavailable (${e.message}); reload to retry`, { className: "muted" }));
  }
  return box;
}

async function row(l, observations) {
  const tr = document.createElement("tr");
  try {
    const [apps, rels, rec] = await Promise.all([arkiv.find("hydra.app", "app", l.app), arkiv.find("hydra.release", "app", l.app), ens.hydraRecords(l.name)]);
    const m = rowModel({ app: l.app, link: l, records: rec, releaseKeys: trustedReleases(apps, rels).map((r) => r.key) });
    cell(tr, link(m.app, m.appHref));
    cell(tr, link(m.name, m.nameHref));
    cell(tr, el("span", m.statusLabel, { className: `chip ${m.statusTone}` }));
    cell(tr, m.approvalLabel);
    cell(tr, await checksCell(l.app, observations));
  } catch (e) {
    cell(tr, link(l.app, null), l.name);
    const td = tr.insertCell();
    td.colSpan = 3;
    td.append(el("span", `Could not read this row (${e.shortMessage ?? e.message}). Reload to retry; the public Sepolia RPC may be busy.`, { className: "warn" }));
  }
  return tr;
}

async function load() {
  try {
    arkiv ??= await import("../../src/arkiv.js");
    ens ??= await import("../../src/ens.js");
    const links = latestPerApp(await arkiv.ensLinks());
    if (!links.length) {
      $("tbl").hidden = true;
      return void ($("msg").textContent = "No app has linked an ENS name yet. A team links one in the Console.");
    }
    const observations = api("/v1/observations"); // one call for all rows
    observations.catch(() => {}); // a failure shows per row, not as an unhandled rejection
    const trs = new Array(links.length);
    let next = 0;
    await Promise.all(Array.from({ length: 5 }, async () => {
      while (next < links.length) {
        const i = next++;
        trs[i] = await row(links[i], observations);
      }
    }));
    $("rows").replaceChildren(...trs);
    $("tbl").hidden = false;
    $("msg").textContent = `${links.length} app(s), read at ${new Date().toLocaleTimeString()}. Refreshes every 60 s.`;
  } catch (e) {
    $("msg").textContent = `Could not read the apps (${e.shortMessage ?? e.message}). Check that cdn.jsdelivr.net and the Rabdi RPC are reachable; it retries in 60 s.`;
  }
}

load();
setInterval(() => document.visibilityState === "visible" && load(), 60_000);
