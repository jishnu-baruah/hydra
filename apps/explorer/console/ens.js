// The Console "ENS name" card: link an ENSv2 Sepolia name to an app, let Hydra write hydra.status on it,
// and approve a release with hydra.release. Wallet mode only. Everything read is set with textContent.
import { encodeFunctionData, zeroHash } from "https://cdn.jsdelivr.net/npm/viem@2.21.0/+esm";
import { ABI, ALL_ROLES, client, dnsName, ENS, HYDRA_WRITER, hydraRecords, KEYS, NAME_RE, resolverOf, send, text, tx, wallet, zeroAddress } from "../src/ens.js";
import { nextStep, approvedView } from "./ens-plan.js";
import { api } from "../src/api.js";

// name -> release key we just approved, kept for this page visit (public RPC nodes lag behind a write).
const optimistic = new Map();

const REJECTED = "You rejected the request in your wallet; press the button again when ready.";

function errText(e, what) {
  const code = e?.code ?? e?.cause?.code;
  if (code === 4001 || code === "ACTION_REJECTED") return REJECTED;
  const msg = e?.shortMessage ?? e?.message ?? "unknown error";
  return `${what} failed: ${String(msg).slice(0, 240)}. Check that your wallet has Sepolia ETH for gas, then press the button again.`;
}

const randHex = (bytes) => "0x" + [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

// ctx: { getToken, run, say, fail, el, btn }
export function ensBlock(app, ctx) {
  const { el, btn, say, fail } = ctx;
  const box = el("section", { className: "ens" });
  let working = false;

  const lock = (on) => {
    working = on;
    for (const b of box.querySelectorAll("button, input")) b.disabled = on;
  };
  // Runs one async action with the card's buttons off; errors become words.
  async function guard(what, fn) {
    if (working) return;
    lock(true);
    fail("");
    try {
      await fn();
    } catch (e) {
      say("");
      fail(errText(e, what));
    } finally {
      lock(false);
    }
  }
  const show = (...kids) => box.replaceChildren(el("h4", { textContent: "ENS name" }), ...kids);
  const stepLink = (hash) => el("a", { href: tx(hash), target: "_blank", rel: "noopener noreferrer", textContent: `${hash.slice(0, 10)}...` });

  async function render() {
    show(el("p", { className: "help", textContent: "Reading the ENS link..." }));
    let link = null;
    try {
      const arkiv = await import("../src/arkiv.js");
      link = await arkiv.ensLink(app);
    } catch (e) {
      show(el("p", { className: "warn", textContent: `Could not read the ENS link from Arkiv: ${e?.message ?? e}. Reload the page to try again.` }));
      return;
    }
    if (link) await renderLinked(link);
    else renderCheck();
  }

  async function releasesOf() {
    const arkiv = await import("../src/arkiv.js");
    const { trustedReleases } = await import("../app/releases.js");
    const [apps, rows] = await Promise.all([arkiv.find("hydra.app", "app", app), arkiv.find("hydra.release", "app", app)]);
    return trustedReleases(apps, rows);
  }

  async function renderLinked(link) {
    const live = el("div", { className: "ens-live" });
    const approveRow = el("div", { className: "row" });
    show(
      el("p", { className: "meta" }, "Linked: ", el("a", { href: `../status/?name=${encodeURIComponent(link.name)}`, textContent: link.name })),
      live,
      approveRow,
      btn("Link another name", () => renderCheck()),
    );
    live.textContent = "Reading the live records...";
    let rec, rels;
    try {
      [rec, rels] = await Promise.all([hydraRecords(link.name), releasesOf()]);
    } catch (e) {
      live.textContent = `Could not read ${link.name} on Sepolia: ${e?.shortMessage ?? e?.message ?? e}. Reload the page to try again.`;
      return;
    }
    draw(link, live, approveRow, rec, rels);
  }

  // Shows the records and the approve button. Also used right after an approval, without a new read.
  function draw(link, live, approveRow, rec, rels) {
    const view = approvedView(rels.map((r) => r.key), rec.release, optimistic.get(link.name));
    const rel = view.key ? rels.find((r) => r.key.toLowerCase() === view.key.toLowerCase()) : null;
    const latest = rels[0];
    const short = (k) => `${k.slice(0, 10)}...`;
    const shown = view.state === "none" ? "none approved yet"
      : view.state === "invalid" ? "not a release id (fix the hydra.release record on your name)"
      : rel ? `${rel.version || "release"} (${short(view.key)})`
      : `${short(view.key)} (not one of this app's releases)`;
    live.replaceChildren(
      el("p", { className: "label", textContent: "hydra.status" }),
      el("p", { textContent: rec.status || "not set yet (Hydra writes it at the next change of your site)" }),
      el("p", { className: "label", textContent: "hydra.release (approved)" }),
      el("p", { textContent: shown }),
    );
    approveRow.replaceChildren();
    if (!latest) {
      approveRow.append(el("p", { className: "help", textContent: "No releases yet. Publish one, then approve it here." }));
      return;
    }
    if (view.state === "latest") {
      approveRow.append(el("p", { className: "help", textContent: `The latest release ${latest.version} is approved.` }));
      return;
    }
    approveRow.append(btn("Approve latest release", () => guard("Approving the release", async () => {
      const w = await wallet();
      const resolver = /^0x[0-9a-fA-F]{40}$/.test(link.resolver) ? link.resolver : await resolverOf(link.name);
      if (!resolver) throw new Error(`${link.name} has no resolver on ENSv2 Sepolia`);
      say("Confirm the approval in your wallet...");
      const hash = await send(w, { address: resolver, abi: ABI.resolver, functionName: "setText", args: [dnsName(link.name), KEYS.release, latest.key] });
      optimistic.set(link.name, latest.key);
      say(`Approved ${latest.version}. ${tx(hash)}`);
      draw(link, live, approveRow, { ...rec, release: latest.key }, rels);
    }), "btn"));
  }

  // One click: the API registers and links the name, paid by Hydra. We only poll its progress.
  const setupPath = () => `/v1/console/apps/${encodeURIComponent(app)}/ens/setup`;
  const setupHeaders = () => ({ authorization: `Bearer ${ctx.getToken()}`, "content-type": "application/json" });
  const EXPIRED = "Your console session expired. Sign in again, then press the button.";
  const isLimit = (m) => /daily|per wallet|per-wallet|limit/i.test(String(m ?? ""));

  async function setup(out) {
    const progress = el("p", { className: "help" });
    const hashes = el("ul", { className: "ens-steps" });
    out.replaceChildren(progress, hashes);
    try {
      progress.textContent = "Starting the setup...";
      await api(setupPath(), { method: "POST", headers: setupHeaders(), body: "{}" });
    } catch (e) {
      if ([404, 405, 503].includes(e.status)) {
        progress.textContent = "This Hydra server does not sponsor ENS setup. Use the manual path below with a name you own.";
        const manual = box.querySelector("details.ens-manual");
        if (manual) manual.open = true;
        return;
      }
      if (e.status === 401) {
        progress.textContent = EXPIRED;
        return;
      }
      if (e.status === 409) {
        // A setup may already exist for this app: look before telling the user anything.
        let st = null;
        try {
          st = await api(setupPath(), { method: "GET", headers: setupHeaders() });
        } catch {
          // fall through to the server's own message
        }
        if (st?.state === "running") return poll(progress, hashes);
        if (st?.state === "done") return finish(st);
        progress.textContent = isLimit(e.message) ? `Hydra did not start the setup: ${e.message}` : `Hydra did not start the setup: ${e.message}. Reload the page to see the latest state.`;
        return;
      }
      progress.textContent = `Hydra could not start the setup: ${e.message}. Press the button again in a minute.`;
      return;
    }
    return poll(progress, hashes);
  }

  // Done: the Arkiv index may lag, so draw the linked view directly instead of re-reading the link.
  async function finish(st) {
    say(`${st.name ?? "Your name"} is registered and linked.`);
    if (typeof st.name === "string" && st.name) await renderLinked({ name: st.name, resolver: "" });
    else await render();
  }

  // On page load: pick up a setup that is already running or finished.
  async function resume(out) {
    let st;
    try {
      st = await api(setupPath(), { method: "GET", headers: setupHeaders() });
    } catch {
      return; // no sponsor, signed out or offline: the button explains itself when pressed
    }
    if (st?.state === "done") return finish(st);
    if (st?.state !== "running") return;
    const progress = el("p", { className: "help" });
    const hashes = el("ul", { className: "ens-steps" });
    out.replaceChildren(progress, hashes);
    return poll(progress, hashes);
  }

  async function poll(progress, hashes) {
    const shown = new Set();
    const deadline = Date.now() + 4 * 60 * 1000;
    while (Date.now() < deadline) {
      let st;
      try {
        st = await api(setupPath(), { method: "GET", headers: setupHeaders() });
      } catch (e) {
        progress.textContent = e.status === 401 ? EXPIRED : `Could not read the setup progress: ${e.message}. Reload the page; the setup keeps running on the server.`;
        return;
      }
      for (const h of Array.isArray(st.txs) ? st.txs : []) {
        if (typeof h !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(h) || shown.has(h)) continue;
        shown.add(h);
        hashes.append(el("li", {}, stepLink(h)));
      }
      if (st.state === "done") return finish(st);
      if (st.state === "failed") {
        progress.textContent = `The setup failed: ${String(st.error ?? "unknown error").slice(0, 240)}. Press the button to try again, or use a name you own below.`;
        return;
      }
      if (st.state === "none") {
        progress.textContent = "The server restarted and lost this setup. Check the Etherscan links shown above, then press the button again.";
        return;
      }
      progress.textContent = typeof st.step === "string" && st.step ? `Setting up: ${st.step.slice(0, 120)}` : "Setting up...";
      await new Promise((r) => setTimeout(r, 3000));
    }
    progress.textContent = "The setup is taking longer than 4 minutes. Reload the page to see whether it finished; if not, press the button again.";
  }

  function renderCheck() {
    const input = el("input", { placeholder: `${app}.eth`, spellcheck: false, autocomplete: "off", id: `ens-${app}` });
    const out = el("div", {});
    const auto = el("div", {});
    const manual = el("details", { className: "ens-manual" },
      el("summary", { textContent: "Use a name I already own" }),
      el("div", { className: "field" }, el("label", { htmlFor: input.id, textContent: "ENS name" }), input),
      btn("Check name", () => guard("Checking the name", () => check(input.value, out)), "btn"),
      out,
    );
    show(
      el("p", { className: "help", textContent: "Link an ENSv2 Sepolia name so Hydra writes the live verdict on it and you can approve releases there." }),
      btn("Set up ENS for me (free, Hydra pays, no wallet prompts)", () => guard("Setting up ENS", () => setup(auto)), "btn"),
      auto,
      manual,
    );
    guard("Resuming the ENS setup", () => resume(auto));
  }

  async function simulates(req) {
    try {
      await client.simulateContract({ abi: ABI.resolver, ...req });
      return true;
    } catch {
      return false;
    }
  }

  const allowCalls = (name) => [
    encodeFunctionData({ abi: ABI.resolver, functionName: "grantSetterRoles", args: [encodeFunctionData({ abi: ABI.resolver, functionName: "setText", args: ["0x", KEYS.status, ""] }), HYDRA_WRITER] }),
    encodeFunctionData({ abi: ABI.resolver, functionName: "setText", args: [dnsName(name), KEYS.app, app] }),
  ];

  async function check(raw, out) {
    const name = raw.trim().toLowerCase();
    out.replaceChildren();
    if (!NAME_RE.test(name)) throw new Error(`"${raw.trim()}" is not a valid name. Use letters, digits and hyphens, such as ${app}.eth`);
    say("Reading the name on Sepolia...");
    const resolver = await resolverOf(name);
    let appTag = "";
    let hydraCanWrite = false;
    let walletCanAllow = false;
    let registrable = false;
    if (resolver) {
      appTag = (await text(name, KEYS.app)).trim();
      hydraCanWrite = await simulates({ account: HYDRA_WRITER, address: resolver, functionName: "setText", args: [dnsName(name), KEYS.status, "match"] });
      // Read only: the connected account, without a connect or chain-switch prompt when there is one.
      const [acct] = (await window.ethereum?.request({ method: "eth_accounts" }).catch(() => [])) ?? [];
      const me = acct ?? (await wallet()).account.address;
      walletCanAllow = await simulates({ account: me, address: resolver, functionName: "multicall", args: [allowCalls(name)] });
    } else {
      const m = /^([a-z0-9-]+)\.eth$/.exec(name);
      registrable = !!m && (await client.readContract({ address: ENS.registrar, abi: ABI.registrar, functionName: "isAvailable", args: [m[1]] }));
    }
    say("");
    proceed(nextStep({ name, resolver, appTag, app, hydraCanWrite, walletCanAllow, registrable }), name, resolver, out);
  }

  // Draws the card for one planned step and its button.
  function proceed(plan, name, resolver, out) {
    const bad = plan.step === "not-yours" || plan.step === "taken";
    const note = el("p", { className: bad ? "warn" : "help", textContent: plan.text });
    const steps = el("ul", { className: "ens-steps" });
    if (plan.step === "register") {
      out.replaceChildren(note, btn(`Register ${name} (5 wallet steps)`, () => guard("Registering the name", () => register(name, steps, out)), "btn"), steps);
    } else if (plan.step === "allow") {
      out.replaceChildren(note, btn("Allow Hydra and link", () => guard("Allowing Hydra", () => allow(name, resolver, out)), "btn"));
    } else if (plan.step === "link") {
      out.replaceChildren(note, btn(`Link ${name}`, () => guard("Linking the name", () => link(name)), "btn"));
    } else {
      out.replaceChildren(note);
    }
  }

  async function register(name, steps, out) {
    const label = name.slice(0, -4);
    const w = await wallet();
    const me = w.account.address;
    const done = (n, what, hash) => steps.append(el("li", {}, `Step ${n} of 5, ${what}: `, stepLink(hash)));
    const reg = (functionName, args) => ({ address: ENS.registrar, abi: ABI.registrar, functionName, args });

    const salt = BigInt(randHex(32));
    const data = encodeFunctionData({ abi: ABI.resolver, functionName: "initialize", args: [[{ account: me, roleBitmap: ALL_ROLES }], []] });
    const resolverAddr = await client.readContract({ address: ENS.factory, abi: ABI.factory, functionName: "predictProxyAddress", args: [me, salt] });
    say("Step 1 of 5: confirm creating your resolver in your wallet...");
    done(1, "resolver created", await send(w, { address: ENS.factory, abi: ABI.factory, functionName: "deployProxy", args: [ENS.resolverImpl, salt, data] }));

    const duration = await client.readContract(reg("MIN_REGISTER_DURATION", []));
    const [base, premium] = await client.readContract(reg("getRegisterPrice", [label, duration, ENS.usdc]));
    const fee = (base + premium) * 2n;
    say("Step 2 of 5: confirm the test USDC mint, then the approval, in your wallet...");
    done(2, "test USDC minted", await send(w, { address: ENS.usdc, abi: ABI.usdc, functionName: "mint", args: [me, fee] }));
    done(2, "test USDC approved", await send(w, { address: ENS.usdc, abi: ABI.usdc, functionName: "approve", args: [ENS.registrar, fee] }));

    const secret = randHex(32);
    const rargs = [label, me, secret, zeroAddress, resolverAddr, duration, zeroHash];
    const commitment = await client.readContract(reg("makeCommitment", rargs));
    say("Step 3 of 5: confirm the commitment in your wallet...");
    done(3, "name committed", await send(w, reg("commit", [commitment])));

    const wait = Number(await client.readContract(reg("MIN_COMMITMENT_AGE", []))) + 5;
    for (let s = wait; s > 0; s--) {
      say(`Step 4 of 5: waiting ${s} s so the commitment can age...`);
      await new Promise((r) => setTimeout(r, 1000));
    }
    steps.append(el("li", {}, `Step 4 of 5, waited ${wait} s`));

    say("Step 5 of 5: confirm the registration in your wallet...");
    done(5, `${name} registered`, await send(w, reg("register", [label, me, secret, zeroAddress, resolverAddr, duration, ENS.usdc, zeroHash])));
    say(`${name} is registered. One more step: allow Hydra.`);
    proceed(nextStep({ name, resolver: resolverAddr, appTag: "", app, hydraCanWrite: false, walletCanAllow: true, registrable: false }), name, resolverAddr, out);
  }

  async function allow(name, resolver, out) {
    const w = await wallet();
    say("Confirm the permission in your wallet...");
    const hash = await send(w, { address: resolver, abi: ABI.resolver, functionName: "multicall", args: [allowCalls(name)] });
    say(`Hydra is allowed on ${name}. ${tx(hash)}`);
    // Link right away; if that fails, the card offers the Link button again.
    if (!(await link(name))) proceed(nextStep({ name, resolver, appTag: app, app, hydraCanWrite: true, walletCanAllow: true, registrable: false }), name, resolver, out);
  }

  // The API checks the name on chain, then stores the link. A refusal (409) carries its reason.
  async function link(name) {
    say("Linking the name...");
    let r;
    try {
      r = await api(`/v1/console/apps/${encodeURIComponent(app)}/ens`, {
        method: "POST",
        headers: { authorization: `Bearer ${ctx.getToken()}`, "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
    } catch (e) {
      say("");
      fail(e.status === 401 ? "Your console session expired. Sign in again, then press Link." : `Hydra did not link ${name}: ${e.message}. Press Link to try again.`);
      return false;
    }
    say(`Linked. Hydra writes hydra.status on ${name} at the next change of your site.`);
    await renderLinked({ name: r.name, resolver: r.resolver }); // Arkiv's index can lag the write
    return true;
  }

  render();
  return box;
}
