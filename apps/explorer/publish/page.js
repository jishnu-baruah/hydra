// The publish flow from apps/site (T-A09), in the explorer: connect a wallet, sign 1 message, get
// a key, hand the repo setup to an agent or do it by hand, and watch for the first release.
// The wallet signs the sign-in message only; the page holds no key of its own. The API key lives
// in this variable for the visit and is never stored. API and chain data are set with textContent.
import { API, DOCS, SKILL, api } from "../src/api.js";
import { appError, dirError, workflow, handoff } from "./flow.js";

const $ = (id) => document.getElementById(id);
const state = { address: null, app: null, key: null, watching: null, checking: false };
const POLL_MS = 15_000;
const WATCH_FOR_MS = 30 * 60_000;

const show = (id, text) => {
  $(id).textContent = text ?? "";
  $(id).hidden = !text;
};
const short = (a) => `${a.slice(0, 6)}...${a.slice(-4)}`;

// Step states drive both the progress bar and the panels: locked, current, done.
function step(n, s) {
  document.querySelector(`.stepper [data-step="${n}"]`).dataset.state = s;
  $(`p${n}`).dataset.state = s;
}
function unlock(n) {
  step(n, "current");
  for (const el of $(`p${n}`).querySelectorAll("input, button")) el.disabled = false;
}

// RainbowKit (wallet.js) draws the connect button and its modal. When the account changes, the
// steps follow: connected unlocks step 2; disconnected before a key goes back to step 1.
let wallet;
function onAccount(address) {
  // The key on screen belongs to the account that signed for it. Say so if the wallet switches.
  if (state.key && address && address !== state.address) {
    return show("e2", `Your wallet switched to ${short(address)}, but this key is for ${short(state.address)}. Reload the page to get a key for the new account.`);
  }
  $("wallet-help").hidden = Boolean(address);
  if (address && address !== state.address) {
    state.address = address;
    show("address", `Connected ${short(address)}`);
    show("e1");
    step(1, "done");
    if (!state.key) {
      unlock(2);
      $("app").focus();
    }
  } else if (!address && state.address && !state.key) {
    state.address = null;
    show("address");
    step(1, "current");
    step(2, "locked");
    for (const el of $("p2").querySelectorAll("input, button")) el.disabled = true;
  }
}
try {
  wallet = await import("./wallet.js");
  $("wallet-root").replaceChildren();
  wallet.mount($("wallet-root"), onAccount);
} catch (e) {
  show("e1", `Could not load the wallet library from esm.sh (${e.message ?? e}). Check that the CDN is reachable from this network, then reload.`);
}

// The name is checked as you type, and again on submit.
$("app").oninput = () => {
  const err = appError($("app").value.trim());
  $("app-help").textContent = err ?? "Available to claim if nobody has published under it yet.";
  $("app-help").classList.toggle("bad", Boolean(err));
};

$("sign").onclick = async () => {
  show("e2");
  const app = $("app").value.trim();
  const err = appError(app);
  if (err) {
    $("app-help").textContent = err;
    $("app-help").classList.add("bad");
    return $("app").focus();
  }
  $("sign").disabled = true;
  $("sign").textContent = "Waiting for your signature...";
  try {
    const q = new URLSearchParams({ address: state.address, app });
    const { message, issuedAt } = await api(`/v1/auth/message?${q}`);
    const signature = await wallet.sign(message);
    const { apiKey } = await api("/v1/auth/key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: state.address, app, issuedAt, signature }),
    });
    state.app = app;
    state.key = apiKey;
    $("keybox").hidden = false;
    $("sign").hidden = true;
    $("app").disabled = true;
    step(2, "done");
    unlock(3);
    renderRepo();
    step(4, "current");
    for (const el of $("p4").querySelectorAll("button")) el.disabled = false;
    $("s4").textContent = "Watching for your first release.";
    watch();
  } catch (e) {
    show("e2", `Could not get a key: ${e.message ?? e}. ${e.status === 403 ? "That name belongs to another wallet: pick another." : "Check the name and try again."}`);
    $("sign").disabled = false;
    $("sign").textContent = "Sign and get key";
  }
};

$("reveal").onclick = () => {
  const hidden = $("key").dataset.secret === "";
  $("key").textContent = hidden ? state.key : "••••••••••••••••••••";
  $("key").dataset.secret = hidden ? "shown" : "";
  $("reveal").textContent = hidden ? "Hide" : "Reveal";
};

function renderRepo() {
  $("handoff").textContent = handoff({ app: state.app, key: state.key, api: API, docs: DOCS });
  renderYaml();
}
function renderYaml() {
  const dir = $("dir").value.trim();
  const err = dirError(dir);
  $("dir-help").textContent = err ?? "The folder your build writes, the one with index.html.";
  $("dir-help").classList.toggle("bad", Boolean(err));
  // A bad folder never reaches the workflow text.
  if (!err) $("yaml").textContent = workflow(API, dir);
}
$("dir").oninput = renderYaml;

// Tabs, with arrow keys between them.
const tabs = [$("t-agent"), $("t-hand")];
function pick(t) {
  for (const x of tabs) {
    const on = x === t;
    x.setAttribute("aria-selected", String(on));
    x.tabIndex = on ? 0 : -1;
    $(x.getAttribute("aria-controls")).hidden = !on;
  }
  t.focus();
}
for (const t of tabs) {
  t.onclick = () => pick(t);
  t.onkeydown = (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") pick(tabs[(tabs.indexOf(t) + 1) % 2]);
  };
}

// Watch for the first release while the page is open and visible, for up to 30 minutes. A press of
// Check now shows that it is working (the button reads Checking...), and every check says what it
// found: the release, no release yet with the time, or why it failed and what to do.
async function checkReleases(manual = false) {
  if (state.checking) return false;
  state.checking = true;
  const btn = $("check");
  if (manual) {
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    btn.textContent = "Checking...";
    $("s4").textContent = `Asking Hydra for ${state.app}'s releases...`;
  }
  show("e4");
  try {
    const { releases } = await api(`/v1/apps/${encodeURIComponent(state.app)}/releases`);
    const at = new Date().toLocaleTimeString();
    if (!releases?.length) {
      $("s4").textContent = `No release for ${state.app} yet (checked at ${at}). Push to main, wait for the workflow to finish, then check again.`;
      return false;
    }
    $("s4").textContent = "";
    const r = releases[0];
    const box = $("release");
    box.replaceChildren();
    const title = Object.assign(document.createElement("p"), { className: "ok", textContent: `Release ${r.version} is on Arkiv` });
    const meta = Object.assign(document.createElement("p"), { className: "help", textContent: `commit ${String(r.commit).slice(0, 12)}, ${r.file_count} files, ${new Date(Number(r.published_at)).toUTCString()}` });
    const link = Object.assign(document.createElement("a"), { className: "btn", href: `../app/?name=${encodeURIComponent(state.app)}`, textContent: `Open ${state.app} on Hydra` });
    box.append(title, meta, link);
    box.hidden = false;
    $("watch").textContent = "Every push to main now adds a release here.";
    $("check").hidden = true;
    step(3, "done");
    step(4, "done");
    clearInterval(state.watching);
    return true;
  } catch (e) {
    $("s4").textContent = "";
    show("e4", `Could not check for releases: ${e.message ?? e}. The API's free host may be waking up: wait 30 seconds, then press Check now again.`);
    return false;
  } finally {
    state.checking = false;
    if (manual) {
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
      btn.textContent = "Check now";
    }
  }
}
function watch() {
  const until = Date.now() + WATCH_FOR_MS;
  $("watch").textContent = "Push once. This page checks every 15 seconds and links to the release.";
  state.watching = setInterval(() => {
    if (Date.now() > until) {
      clearInterval(state.watching);
      $("watch").textContent = "Stopped watching after 30 minutes. Press Check now after your push.";
    } else if (!document.hidden) checkReleases();
  }, POLL_MS);
}
$("check").onclick = () => checkReleases(true);

for (const b of document.querySelectorAll("[data-copy]")) {
  b.onclick = async () => {
    const text = b.dataset.copy === "key-value" ? state.key : $(b.dataset.copy).textContent;
    try {
      await navigator.clipboard.writeText(text);
      b.textContent = "Copied";
    } catch {
      b.textContent = "Select and copy";
    }
    setTimeout(() => (b.textContent = "Copy"), 1400);
  };
}

$("skill-cmd").textContent = `mkdir -p .claude/skills/hydra-publish && curl -fsSL ${SKILL} -o .claude/skills/hydra-publish/SKILL.md`;
$("docs").href = DOCS;
$("api").textContent = API;
document.body.dataset.done = "1";
