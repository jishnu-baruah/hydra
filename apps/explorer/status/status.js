// ENS status page (T-A35): reads hydra.status on an ENS name from ENSv2 on Sepolia, in the browser,
// through the Universal Resolver. Hydra's server is not asked. The value is data: shown, never run.
import { hydraRecords, NAME_RE } from "../src/ens.js";
import { isAppName, isReleaseKey } from "../src/ensview.js";

const $ = (id) => document.getElementById(id);
const TEXT = {
  match: ["Matches its release", "The live site serves the files the team published."],
  mismatch: ["Differs from its release", "The live site serves files that are in no release. Do not sign anything there until the team says it is fixed."],
};

let name = new URLSearchParams(location.search).get("name") || "status.demodapp.eth";
let timer;

async function read() {
  try {
    const rec = await hydraRecords(name);
    const v = rec.status;
    const [word, what] = TEXT[v] ?? ["No status yet", "This name has no hydra.status record. The team grants Hydra's monitor the record, then the first check sets it."];
    $("verdict").dataset.v = TEXT[v] ? v : "unknown";
    $("word").textContent = word;
    $("what").textContent = what;
    showRecords(rec);
    $("checked").textContent = `Read from ENS at ${new Date().toLocaleTimeString()}.`;
    $("error").hidden = true;
  } catch (e) {
    $("error").textContent = `Could not read ${name} from ENS (${e.shortMessage ?? e.message}). Check the name; the public Sepolia RPC may also be busy, it retries in 5 s.`;
    $("error").hidden = false;
  }
}

// hydra.app and hydra.release are data from ENS: linked only when they pass a strict format check.
function showRecords(rec) {
  const set = (id, value, ok, href, bad) => {
    const box = $(id);
    box.replaceChildren();
    if (!value) return void (box.textContent = "not set");
    if (!ok) return void (box.textContent = bad);
    const a = document.createElement("a");
    a.textContent = value;
    a.href = href;
    box.append(a);
  };
  set("rec-app", rec.app, isAppName(rec.app), `../app/?name=${encodeURIComponent(rec.app)}`, "not an app name");
  set("rec-release", rec.release, isReleaseKey(rec.release), `../releases/?key=${encodeURIComponent(rec.release)}`, "not a release id");
}

function show(n) {
  name = n;
  $("name").textContent = n;
  $("ens").value = n;
  clearInterval(timer);
  read();
  timer = setInterval(read, 5000);
}

$("pick").addEventListener("submit", (e) => {
  e.preventDefault();
  const n = $("ens").value.trim().toLowerCase();
  if (!NAME_RE.test(n)) return ($("error").textContent = "Enter an ENS name such as status.yourapp.eth."), ($("error").hidden = false);
  history.replaceState(null, "", `?name=${encodeURIComponent(n)}`);
  show(n);
});
show(name);
