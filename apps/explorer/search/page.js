// The query lives in ?q=, so a search is a link. Results are Arkiv data: textContent only.
import { search } from "./search.js";

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
    const hits = await search(q, arkiv.find);
    if (hits.length === 0) {
      status(`No app on record matches "${q.trim()}". Check the spelling, or try its domain, a file sha256 or a Swarm reference.`);
    } else {
      status(`${hits.length} app(s) found in ${Math.round(performance.now())} ms.`);
      for (const h of hits) {
        const li = document.createElement("li");
        // T-B02 adds the app page; until then the match opens as an entity.
        const a = Object.assign(document.createElement("a"), { href: `../?key=${encodeURIComponent(h.key)}` });
        a.textContent = h.app;
        li.append(a, ` (matched by ${h.via})`);
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
document.body.dataset.done = "1";
