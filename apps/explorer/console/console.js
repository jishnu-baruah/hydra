// The Console page: sign in with a wallet, see your apps, rotate keys, manage alert channels.
// Nothing but the sign-in shows until a wallet signs in. The session lives in sessionStorage (this tab only).
// Everything from the API is set with textContent.
import { api } from "../src/api.js";
import { channelLine, targetError } from "./form.js";
import { apiErrorText, appCard, consoleRequest, normalizeApps, rotateCommand, sessionLive, shortAddress, toHex, walletErrorText } from "./view.js";

const $ = (id) => document.getElementById(id);
const SKEY = "hydra.console.session";
const KKEY = "hydra.console.key";
let mode = ""; // "wallet", "key" or "" when signed out
let token = "";
let busy = false;
let bot = null; // Telegram bot username, or null when the server has none

const store = {
  get(k) {
    try {
      return sessionStorage.getItem(k) ?? "";
    } catch {
      return "";
    }
  },
  set(k, v) {
    try {
      if (v) sessionStorage.setItem(k, v);
      else sessionStorage.removeItem(k);
    } catch {
      // Storage blocked: the sign-in lives in memory for this visit only.
    }
  },
};

const HOWTO = {
  webhook: { label: "Webhook URL", hint: "We sign each call with Standard Webhooks: webhook-id, webhook-timestamp and webhook-signature headers.", ph: "https://example.com/hydra" },
  slack: { label: "Slack webhook URL", hint: "Create an Incoming Webhook in your Slack app and paste its URL.", ph: "https://hooks.slack.com/services/..." },
  discord: { label: "Discord webhook URL", hint: "Channel settings, Integrations, Webhooks, then copy the URL.", ph: "https://discord.com/api/webhooks/..." },
  telegram: { label: "Telegram chat id", hint: "", ph: "-1001234567890" },
};

function telegramHint(app) {
  const who = bot ? `@${bot}` : "the Hydra bot (its name is not set on the server yet)";
  return `Add ${who} to your group, then send "/hydra ${app}" in the group. The bot replies with the chat id: paste it here within 15 minutes, or press Find my chat.`;
}

function say(text) {
  $("status").textContent = text ?? "";
}
function fail(text) {
  $("error").textContent = text ?? "";
  $("error").hidden = !text;
}

function setBusy(on) {
  busy = on;
  for (const b of document.querySelectorAll("#apps button, #apps select, #apps input")) b.disabled = on;
  for (const id of ["wallet-btn", "signout"]) $(id).disabled = on;
}

// One request: buttons off, status on, errors in words. Returns the body or null. 401 signs out.
async function run(label, path, init) {
  if (busy) return null;
  setBusy(true);
  fail("");
  say(label);
  try {
    return await api(path, init);
  } catch (e) {
    if (e.status === 401) signOut();
    say("");
    fail(apiErrorText(e));
    return null;
  } finally {
    setBusy(false);
  }
}

function signOut() {
  mode = "";
  token = "";
  store.set(SKEY, "");
  store.set(KKEY, "");
  $("apps").replaceChildren();
  $("empty").replaceChildren("Sign in to see your apps.");
  $("empty").hidden = false;
  $("p1").dataset.state = "current";
  $("p2").dataset.state = "locked";
  $("p2").hidden = true;
  for (const a of document.querySelectorAll(".nav-console")) a.hidden = true;
  $("who").hidden = true;
  $("signout").hidden = true;
}

function signedIn(label) {
  $("who").textContent = label;
  $("who").hidden = false;
  $("signout").hidden = false;
  $("p1").dataset.state = "done";
  $("p2").dataset.state = "current";
  $("p2").hidden = false;
  for (const a of document.querySelectorAll(".nav-console")) a.hidden = false;
}

// ---- rendering ----

const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
};
const btn = (text, onclick, cls = "ghost-btn") => el("button", { type: "button", className: cls, textContent: text, onclick });

function renderApps(apps) {
  const box = $("apps");
  box.replaceChildren();
  $("empty").hidden = apps.length > 0;
  if (!apps.length) {
    $("empty").replaceChildren("This wallet owns no apps yet. ", el("a", { href: "../publish/", textContent: "Publish one first" }), ".");
  }
  for (const a of apps) box.append(renderApp(a));
}

function renderApp(a) {
  const c = appCard(a);
  const card = el("article", { className: "app" });
  card.dataset.app = a.app;
  card.append(el("h3", {}, el("a", { href: c.href, textContent: c.name })));
  card.append(el("p", { className: "meta", textContent: [c.claimed, c.version, c.count].filter(Boolean).join(". ") + "." }));

  if (mode === "wallet") {
    card.append(rotateBlock(a.app));
    card.append(ensSlot(a.app));
  }

  card.append(el("h4", { textContent: "Alert channels" }));
  const ul = el("ul", { className: "channels" });
  if (!a.channels.length) ul.append(el("li", {}, el("span", { className: "line", textContent: "No channels yet. Add one below." })));
  for (const ch of a.channels) {
    ul.append(el("li", {}, el("span", { className: "line", textContent: channelLine(ch) }), btn("Test", () => testChannel(a.app, ch.id)), btn("Delete", () => deleteChannel(a.app, ch.id))));
  }
  card.append(ul, addForm(a.app));
  return card;
}

// The ENS card loads on its own (it pulls viem from a CDN), so a failure there never breaks the page.
function ensSlot(app) {
  const slot = el("div", {});
  import("./ens.js")
    .then((m) => slot.replaceWith(m.ensBlock(app, { getToken: () => token, run, say, fail, el, btn })))
    .catch((e) => slot.replaceChildren(el("p", { className: "warn", textContent: `The ENS card could not load: ${e?.message ?? e}. Check your connection and reload the page.` })));
  return slot;
}

function rotateBlock(app) {
  const wrap = el("div", { className: "rotate" });
  const confirm = el("div", { className: "confirm", hidden: true });
  const out = el("div", { className: "keybox", hidden: true });
  confirm.append(
    el("p", { className: "warn", textContent: "Every older key for this app stops working now. Update the HYDRA_API_KEY secret in CI after." }),
    el("div", { className: "row" }, btn("Rotate now", () => rotate(app, out, confirm), "btn"), btn("Cancel", () => { confirm.hidden = true; })),
  );
  wrap.append(btn("Rotate key", () => { confirm.hidden = false; out.hidden = true; }), confirm, out);
  return wrap;
}

async function rotate(app, out, confirm) {
  const { path, init } = consoleRequest(mode, token, app, "rotate");
  const r = await run("Rotating the key...", path, init);
  if (!r) return;
  confirm.hidden = true;
  let cmd = "";
  try {
    cmd = rotateCommand(r.key);
  } catch (e) {
    fail(e.message);
  }
  out.replaceChildren(
    el("p", { className: "label", textContent: `New key for ${app}, version ${r.version}` }),
    el("div", { className: "keyrow" }, el("code", { textContent: r.key }), btn("Copy key", () => copy(r.key, "Key copied."))),
    ...(cmd ? [el("div", { className: "keyrow" }, el("code", { textContent: cmd }), btn("Copy command", () => copy(cmd, "Command copied.")))] : []),
    el("p", { className: "warn", textContent: "Copy this now. It will not be shown again. Older keys no longer work." }),
  );
  out.hidden = false;
  say(`Key rotated for ${app}.`);
}

async function copy(text, ok) {
  try {
    await navigator.clipboard.writeText(text);
    say(ok);
  } catch {
    say("Could not copy. Select the text and copy it by hand.");
  }
}

function addForm(app) {
  const form = el("form", { autocomplete: "off" });
  // Telegram first and picked by default; each kind is a radio with its logo.
  const kind = el("fieldset", { className: "kinds" }, el("legend", { textContent: "Kind" }),
    ...Object.entries({ telegram: "Telegram", slack: "Slack", discord: "Discord", webhook: "Webhook" }).map(([v, t]) =>
      el("label", { className: "kind" },
        el("input", { type: "radio", name: `k-${app}`, value: v, checked: v === "telegram" }),
        el("img", { src: `../assets/logo-${v}.svg`, alt: "", width: 20, height: 20 }),
        t)));
  Object.defineProperty(kind, "value", { get: () => kind.querySelector("input:checked").value });
  const target = el("input", { id: `t-${app}`, spellcheck: false, autocomplete: "off" });
  const label = el("label", { htmlFor: target.id });
  const help = el("p", { className: "help" });
  const chats = el("div", {});
  const find = btn("Find my chat", () => findChat(app, target, chats));
  const secret = el("div", { className: "keybox", hidden: true });

  const sync = () => {
    const h = HOWTO[kind.value];
    help.textContent = kind.value === "telegram" ? telegramHint(app) : h.hint;
    label.textContent = h.label;
    target.placeholder = h.ph;
    find.hidden = kind.value !== "telegram";
    chats.replaceChildren();
  };
  kind.addEventListener("change", () => { sync(); fail(""); });
  sync();

  form.append(
    el("div", { className: "field" }, kind, help),
    el("div", { className: "field" }, label, target, find, chats),
    el("button", { className: "btn", type: "submit", textContent: "Add channel" }),
    secret,
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const bad = targetError(kind.value, target.value);
    if (bad) return fail(bad);
    const { path, init } = consoleRequest(mode, token, app, "add", { kind: kind.value, target: target.value });
    const r = await run("Adding and sending a test message...", path, init);
    if (!r) return;
    await reload(app, r.secret);
    say(`Added ${r.kind}, ${r.label}. A test message was sent.${r.secret ? " Copy the webhook secret now." : ""}`);
  });
  return form;
}

async function findChat(app, target, box) {
  box.replaceChildren();
  const { path, init } = consoleRequest(mode, token, app, "chats");
  const r = await run("Looking for your chat...", path, init);
  if (!r) return;
  const chats = r.chats ?? [];
  if (!chats.length) return say(`No chat found. Send "/hydra ${app}" in your group first, then try again.`);
  if (chats.length === 1) {
    target.value = chats[0].id;
    return say(`Found ${chats[0].title}.`);
  }
  say("Pick your chat:");
  for (const c of chats) {
    box.append(btn(`${c.title} (${c.id})`, () => { target.value = c.id; box.replaceChildren(); say(`Picked ${c.title}.`); }));
  }
}

async function testChannel(app, id) {
  const { path, init } = consoleRequest(mode, token, app, "test", id);
  const r = await run("Sending a test message...", path, init);
  if (r) say("Test message sent. Check the channel.");
}

async function deleteChannel(app, id) {
  const { path, init } = consoleRequest(mode, token, app, "delete", id);
  const r = await run("Deleting...", path, init);
  if (!r) return;
  await reload(app);
  say("Channel deleted.");
}

// Re-fetch the apps and redraw. A webhook secret, if any, is shown once under the app it belongs to.
async function reload(app, secret) {
  if (!(await loadApps("Reloading your apps...")) || !secret) return;
  const card = [...document.querySelectorAll(".app")].find((n) => n.dataset.app === app);
  const box = card?.querySelector("form .keybox");
  if (!box) return;
  box.replaceChildren(
    el("p", { className: "label", textContent: "Webhook secret" }),
    el("div", { className: "keyrow" }, el("code", { textContent: secret }), btn("Copy", () => copy(secret, "Secret copied."))),
    el("p", { className: "warn", textContent: "Copy this now. It is shown once and cannot be read again. Your server uses it to verify the webhook-signature header." }),
  );
  box.hidden = false;
}

// Returns true when the apps loaded.
async function loadApps(label) {
  const { path, init } = consoleRequest(mode, token, "", "list");
  const r = await run(label, path, init);
  if (!r) return false;
  // Key mode answers { app, channels }; wallet mode answers { address, apps }.
  const apps = mode === "key" ? normalizeApps({ apps: [{ app: r.app, channels: r.channels }] }) : normalizeApps(r);
  renderApps(apps);
  say("");
  return true;
}

// ---- sign in ----

async function walletSignIn() {
  const eth = window.ethereum;
  if (!eth) return fail(walletErrorText(null));
  if (busy) return;
  fail("");
  setBusy(true);
  let session;
  try {
    say("Asking your wallet for an account...");
    const [address] = await eth.request({ method: "eth_requestAccounts" });
    if (!address) throw new Error("Your wallet gave no account");
    say("Getting the sign-in message...");
    const m = await api(`/v1/console/message?address=${encodeURIComponent(address)}`);
    say("Sign the message in your wallet...");
    const signature = await eth.request({ method: "personal_sign", params: [toHex(m.message), address] });
    say("Signing in...");
    session = await api("/v1/console/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address, issuedAt: m.issuedAt, signature }),
    });
  } catch (e) {
    say("");
    fail(e.status ? apiErrorText(e, "signin") : walletErrorText(e));
    return setBusy(false);
  }
  setBusy(false);
  mode = "wallet";
  token = session.session;
  store.set(SKEY, JSON.stringify(session));
  signedIn(`Signed in as ${shortAddress(session.address)}`);
  await loadApps("Loading your apps...");
}

$("wallet-btn").addEventListener("click", walletSignIn);
$("signout").addEventListener("click", () => {
  signOut();
  fail("");
  say("Signed out.");
});

api("/v1/alerts/telegram-bot")
  .then((r) => {
    bot = r.username ?? null;
    for (const n of document.querySelectorAll("#apps fieldset.kinds")) n.dispatchEvent(new Event("change"));
  })
  .catch(() => {});

// Restore this tab's sign-in.
try {
  const s = JSON.parse(store.get(SKEY) || "null");
  store.set(KKEY, ""); // an API key kept by the old page is dropped
  if (sessionLive(s)) {
    mode = "wallet";
    token = s.session;
    signedIn(`Signed in as ${shortAddress(s.address)}`);
    loadApps("Reconnecting...");
  } else {
    store.set(SKEY, "");
  }
} catch {
  store.set(SKEY, "");
}
