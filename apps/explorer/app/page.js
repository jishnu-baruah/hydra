// One app's release history, read live from Arkiv. ?name=<app>. Arkiv data is shown with
// textContent only.
import { api } from "../src/api.js";
import { ownerOf, trustedReleases } from "./releases.js";
import { boundDomains, latestVerdict, verdictText } from "./sites.js";

const $ = (id) => document.getElementById(id);
const status = (text, error = false) => {
  $("status").textContent = text;
  $("status").className = error ? "error" : "";
};
const el = (tag, text, attrs = {}) => {
  const node = Object.assign(document.createElement(tag), attrs);
  if (text !== undefined) node.textContent = text;
  return node;
};
const when = (ms) => new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";

const name = (new URLSearchParams(location.search).get("name") ?? "").trim();

let arkiv;
try {
  if (!name) {
    status("No app named. Open this page from search, or add ?name=<app> to the address.", true);
  } else {
    $("name").textContent = name;
    document.title = `${name}, Hydra explorer`;
    arkiv = await import("../src/arkiv.js");
    const [apps, rows] = await Promise.all([arkiv.find("hydra.app", "app", name), arkiv.find("hydra.release", "app", name)]);
    const releases = trustedReleases(apps, rows);
    const owner = ownerOf(apps);
    if (owner) $("owner").textContent = `Owned by ${owner}, the first address to publish it`;
    if (releases.length === 0) {
      status(`No releases of "${name}" on record. The team publishes from CI; check the name, or search by domain or file hash.`);
    } else {
      const wrap = el("div", undefined, { className: "table-wrap" });
      const t = wrap.appendChild(el("table"));
      const head = t.createTHead().insertRow();
      for (const h of ["Version", "Commit", "Published", "Files", "Swarm", "Record"]) head.append(el("th", h));
      const body = t.createTBody();
      for (const r of releases) {
        const tr = body.insertRow();
        tr.insertCell().append(r.version);
        tr.insertCell().append(r.commit.slice(0, 12));
        tr.insertCell().append(when(r.publishedAt));
        tr.insertCell().append(String(r.fileCount));
        tr.insertCell().append(
          r.swarmUrl
            ? el("a", "Manifest", { href: r.swarmUrl, rel: "noopener noreferrer", target: "_blank" })
            : el("span", "Not on Swarm yet", { className: "muted" }),
        );
        tr.insertCell().append(el("a", "View", { href: `../releases/?key=${encodeURIComponent(r.key)}` }));
      }
      $("view").append(wrap);
      const capped = rows.length >= 100 ? " Arkiv returned its 100-row page limit, so some releases may be missing." : "";
      status(`${releases.length} release(s) by the app's owner, read live from Arkiv in ${Math.round(performance.now())} ms.${capped}`);
      await showSites(arkiv);
    }
  }
} catch (err) {
  status(
    arkiv
      ? `Could not read Arkiv: ${arkiv.rootCause(err)}. Reload; if it persists, the Rabdi RPC may be rate limiting this address.`
      : `Could not load the Arkiv SDK from cdn.jsdelivr.net (${err.message}). Check that the CDN is reachable from this network, then reload.`,
    true,
  );
}

// Where the app runs: the domains its newest release binds, each with what the indexer last saw.
// The API gives the manifests; a failure here leaves the release table as it is.
async function showSites(arkivModule) {
  const box = $("sites");
  if (!box) return;
  let domains = [];
  try {
    domains = boundDomains((await api(`/v1/apps/${encodeURIComponent(name)}/releases`)).releases);
  } catch {
    box.append(el("p", "Could not ask the Hydra API which domains this app binds. Reload to retry; its free host may be waking up.", { className: "muted" }));
    return;
  }
  if (!domains.length) {
    box.append(el("p", "No domain is bound to this app yet, so its site cannot show a match. To bind one: serve /.well-known/hydra.txt on the domain with the line hydra-app=" + name + ", set HYDRA_DOMAINS to the domain in the publish workflow, deploy, then publish again.", { className: "muted" }));
    return;
  }
  for (const d of domains) {
    const row = el("p", undefined, { className: "site-row" });
    const link = el("a", d, { href: `../observed/?domain=${encodeURIComponent(d)}` });
    let verdict = null;
    try {
      verdict = latestVerdict(await arkivModule.observationsFor(d, 1), name);
    } catch {
      // no verdict: shown as not checked yet
    }
    const chip = el("span", verdict ? verdict.status : "not checked yet", { className: `chip ${verdict ? verdict.status : "unknown"}` });
    row.append(link, " ", chip, " ", el("span", verdict ? verdictText(verdict.status) : "The indexer has not seen this domain yet.", { className: "muted" }));
    box.append(row);
  }
}

document.body.dataset.done = "1";
