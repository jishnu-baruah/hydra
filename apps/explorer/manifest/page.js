// One release manifest, read from Swarm and shown as text. ?ref=<swarm reference>.
// The read host sends Content-Disposition: attachment, so a plain link downloads the file (T-B13).
// Swarm data is shown with textContent only.
import { swarmUrl } from "../app/releases.js";

const $ = (id) => document.getElementById(id);
const status = (text, error = false) => {
  $("status").textContent = text;
  $("status").className = error ? "error" : "";
};

const ref = (new URLSearchParams(location.search).get("ref") ?? "").trim().toLowerCase();
const url = swarmUrl(ref);

if (!url) {
  status("No valid Swarm reference in the address. Open this page from an app's Manifest link, or add ?ref=<64 hex characters>.", true);
} else {
  $("raw").href = url;
  $("raw").hidden = false;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000), credentials: "omit" });
    if (!res.ok) throw new Error(`the gateway answered HTTP ${res.status}`);
    const manifest = await res.json();
    if (manifest?.app) {
      $("name").textContent = `${manifest.app} ${manifest.version ?? ""}`.trim();
      document.title = `${$("name").textContent} manifest, Hydra explorer`;
    }
    $("json").textContent = JSON.stringify(manifest, null, 2);
    $("json").hidden = false;
    status(`Read from Swarm reference ${ref.slice(0, 12)}... in ${Math.round(performance.now())} ms.`);
  } catch (err) {
    status(`Could not read the manifest from Swarm: ${err.message}. Reload to retry; if it persists, open the raw file link or check that download.gateway.ethswarm.org is reachable from this network.`, true);
  }
}
