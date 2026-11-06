// ENS status page (T-A35): reads hydra.status on an ENS name from ENSv2 on Sepolia, in the browser,
// through the Universal Resolver. Hydra's server is not asked. The value is data: shown, never run.
import { createPublicClient, http } from "https://cdn.jsdelivr.net/npm/viem@2.21.0/+esm";
import { sepolia } from "https://cdn.jsdelivr.net/npm/viem@2.21.0/chains/+esm";
import { normalize } from "https://cdn.jsdelivr.net/npm/viem@2.21.0/ens/+esm";

const UNIVERSAL = "0x24e1d8e068620b647ca097f961a61055f4f42d72"; // ENSv2 UniversalResolver, Sepolia
const $ = (id) => document.getElementById(id);
const client = createPublicClient({ chain: sepolia, transport: http("https://ethereum-sepolia-rpc.publicnode.com") });
const TEXT = {
  match: ["Matches its release", "The live site serves the files the team published."],
  mismatch: ["Differs from its release", "The live site serves files that are in no release. Do not sign anything there until the team says it is fixed."],
};

let name = new URLSearchParams(location.search).get("name") || "status.demodapp.eth";
let timer;

async function read() {
  try {
    const v = await client.getEnsText({ name: normalize(name), key: "hydra.status", universalResolverAddress: UNIVERSAL });
    const [word, what] = TEXT[v] ?? ["No status yet", "This name has no hydra.status record. The team grants Hydra's monitor the record, then the first check sets it."];
    $("verdict").dataset.v = TEXT[v] ? v : "unknown";
    $("word").textContent = word;
    $("what").textContent = what;
    $("checked").textContent = `Read from ENS at ${new Date().toLocaleTimeString()}.`;
    $("error").hidden = true;
  } catch (e) {
    $("error").textContent = `Could not read ${name} from ENS (${e.shortMessage ?? e.message}). Check the name; the public Sepolia RPC may also be busy, it retries in 5 s.`;
    $("error").hidden = false;
  }
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
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(n)) return ($("error").textContent = "Enter an ENS name such as status.yourapp.eth."), ($("error").hidden = false);
  history.replaceState(null, "", `?name=${encodeURIComponent(n)}`);
  show(n);
});
show(name);
