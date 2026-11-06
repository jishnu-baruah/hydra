// The query lives in ?q=, so a search is a link. Results are Arkiv data: textContent only.
import { api } from "../src/api.js";
import { hostOf, search, siteVerdict } from "./search.js";

const $ = (id) => document.getElementById(id);
const status = (text, error = false) => {
  $("status").textContent = text;
  $("status").className = error ? "error" : "";
};

const q = new URLSearchParams(location.search).get("q") ?? "";
$("q").value = q;

if (q.trim()) {
  status("Searching Arkiv...");
  let arkiv;
  try {
    arkiv = await import("../src/arkiv.js");
    // A site is resolved through the Hydra API (which app proved this domain) and the indexer's
    // observations (a site nobody published). Either failing just means no answer from it.
    // Each is asked once: search() uses them to find results, the verdict card to judge the site.
    const once = (f) => { const memo = new Map(); return (host) => (memo.has(host) || memo.set(host, f(host)), memo.get(host)); };
    const appOf = once(async (host) => (await api(`/v1/domains/${encodeURIComponent(host)}`)).app ?? null);
    const seen = once((host) => arkiv.observationsFor(host, 1));
    const extra = { appForDomain: appOf, observed: async (host) => (await seen(host)).length > 0 };
    const host = hostOf(q);
    const [hits, app, rows] = await Promise.all([
      search(q, arkiv.find, extra),
      host ? appOf(host).catch(() => null) : null,
      host ? seen(host).catch(() => []) : [],
    ]);
    if (host) showVerdict(siteVerdict({ host, app, rows, now: Date.now() }), host);
    if (hits.length === 0) {
      status(`Nothing on record matches "${q.trim()}". Hydra knows a site only if a team published it or the indexer watches it. Check the spelling, or try an app name, a file sha256 or a Swarm reference.`);
    } else {
      status(`${hits.length} result(s) found in ${Math.round(performance.now())} ms.`);
      for (const h of hits) {
        const li = document.createElement("li");
        const span = (cls, text) => Object.assign(document.createElement("span"), { className: cls, textContent: text });
        const a = Object.assign(document.createElement("a"), {
          href: h.site ? `../observed/?domain=${encodeURIComponent(h.site)}` : `../app/?name=${encodeURIComponent(h.app)}`,
        });
        if (h.site) a.append(span("app", h.site), span("via label", "Watched by the indexer, not published by the team"), span("go", "→"));
        else a.append(span("app", h.app), span("via label", `Matched by ${h.via}`), span("go", "→"));
        li.append(a);
        $("results").append(li);
      }
    }
  } catch (err) {
    status(
      arkiv
        ? `Could not search Arkiv: ${arkiv.rootCause(err)}. Reload; if it persists, the Rabdi RPC may be rate limiting this address.`
        : `Could not load the Arkiv SDK from cdn.jsdelivr.net (${err.message}). Check that the CDN is reachable from this network, then reload.`,
      true,
    );
  }
}
// The answer first: one card, green only for a match and red only for a mismatch.
function showVerdict(v, host) {
  const box = $("verdict");
  box.dataset.kind = v.kind;
  $("v-mark").textContent = { safe: "OK", danger: "!", pending: "..", unverified: "?" }[v.kind];
  $("v-title").textContent = v.title;
  $("v-text").textContent = v.text;
  $("v-when").textContent = v.when;
  $("v-when").hidden = !v.when;
  $("v-more").href = `../observed/?domain=${encodeURIComponent(host)}`;
  box.hidden = false;
}

document.body.dataset.done = "1";
