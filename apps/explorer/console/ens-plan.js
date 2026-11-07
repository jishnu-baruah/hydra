import { approval } from "../src/ensview.js";
// Pure decision for the Console ENS card: what is the next step for this name and wallet?
// Returns { step, text } where step is "register" | "allow" | "link" | "not-yours" | "taken".
export function nextStep({ name, resolver, appTag, app, hydraCanWrite, walletCanAllow, registrable }) {
  if (!resolver) {
    if (registrable) return { step: "register", text: `${name} is free on ENSv2 Sepolia. Register it from your wallet in 5 steps; it costs only test tokens.` };
    return { step: "taken", text: `${name} cannot be registered from here: it is taken or is not a plain name ending in .eth. Pick another name, such as ${app}.eth.` };
  }
  if (hydraCanWrite && appTag === app) return { step: "link", text: `${name} is ready: Hydra may write hydra.status and the name is tagged with ${app}. Link it to finish.` };
  if (walletCanAllow) return { step: "allow", text: `Allow Hydra on ${name} in one transaction. It lets Hydra's monitor set hydra.status only, and tags the name with ${app}.` };
  return { step: "not-yours", text: `The connected wallet cannot change the records of ${name}. Switch to the wallet that owns it, or pick another name.` };
}

// What the card shows for hydra.release. Public RPC nodes lag after a write, so an empty read
// falls back to the key we just wrote on this page visit; a non-empty read always wins.
// releaseKeys: newest first. Returns { state: none|invalid|latest|older|unknown, key? }.
export function approvedView(releaseKeys, onchainValue, optimisticValue) {
  const read = String(onchainValue ?? "").trim();
  return approval(releaseKeys, read || optimisticValue);
}
