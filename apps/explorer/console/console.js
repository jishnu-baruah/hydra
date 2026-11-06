// The Console page: manage the alert channels of one app, using its API key.
// The key is held in sessionStorage (this tab only). Everything from the API is set with textContent.
import { api } from "../src/api.js";
import { addRequest, authHeaders, channelLine, errorText, keyError, targetError } from "./form.js";

const $ = (id) => document.getElementById(id);
const KEY = "hydra.console.key";
let key = "";
let busy = false;

const store = {
  get() {
    try {
      return sessionStorage.getItem(KEY) ?? "";
    } catch {
      return "";
    }
  },
  set(v) {
    try {
      if (v) sessionStorage.setItem(KEY, v);
      else sessionStorage.removeItem(KEY);
    } catch {
      // Storage blocked: the key lives in memory for this visit only.
    }
  },
};

const HOWTO = {
  webhook: { label: "Webhook URL", hint: "We sign each call with Standard Webhooks: webhook-id, webhook-timestamp and webhook-signature headers.", ph: "https://example.com/hydra" },
  slack: { label: "Slack webhook URL", hint: "Create an Incoming Webhook in your Slack app and paste its URL.", ph: "https://hooks.slack.com/services/..." },
  discord: { label: "Discord webhook URL", hint: "Channel settings, Integrations, Webhooks, then copy the URL.", ph: "https://discord.com/api/webhooks/..." },
  telegram: { label: "Telegram chat id", hint: "", ph: "-1001234567890" },
};
let bot = null; // Telegram bot username, or null when the server has none

let appName = ""; // the connected app, for the Telegram command

function telegramHint() {
  const who = bot ? `@${bot}` : "the Hydra bot (its name is not set on the server yet)";
  return `Add ${who} to your group, then send "/hydra ${appName || "<your app>"}" in the group. That proves the group is yours. Then press Find my chat (it looks back 15 minutes), or paste the chat id.`;
}

// Chats where "/hydra <app>" was sent recently; one fills the box, several become buttons.
async function findChat() {
  const box = $("chats");
  box.replaceChildren();
  const r = await run("Looking for your chat...", "/v1/alerts/telegram-chats", { headers: authHeaders(key) });
  setBusy(false);
  if (!r) return;
  const chats = r.chats ?? [];
  if (!chats.length) return say(`No chat found. Send "/hydra ${appName}" in your group first, then try again.`);
  say(chats.length === 1 ? `Found ${chats[0].title}.` : "Pick your chat:");
  if (chats.length === 1) return void ($("target").value = chats[0].id);
  for (const c of chats) {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "ghost-btn", textContent: `${c.title} (${c.id})` });
    b.onclick = () => { $("target").value = c.id; box.replaceChildren(); say(`Picked ${c.title}.`); };
    box.append(b);
  }
}

function renderKind() {
  const k = $("kind").value;
  $("howto").textContent = k === "telegram" ? telegramHint() : HOWTO[k].hint;
  $("find-chat").hidden = k !== "telegram";
  $("target-label").textContent = HOWTO[k].label;
  $("target").placeholder = HOWTO[k].ph;
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
  const connected = $("p2").dataset.state !== "locked";
  $("connect-btn").disabled = on;
  $("kind").disabled = on || !connected;
  $("target").disabled = on || !connected;
  $("add-btn").disabled = on || !connected;
  for (const b of $("channels").querySelectorAll("button")) b.disabled = on;
}

// Run one request: buttons off, status on, errors shown in words. Returns the body or null.
async function run(label, path, init, adding = false) {
  if (busy) return null;
  setBusy(true);
  fail("");
  say(label);
  try {
    return await api(path, init);
  } catch (e) {
    if (e.status === 401) lock();
    say("");
    fail(errorText(e, adding));
    return null;
  } finally {
    setBusy(false);
  }
}

function lock() {
  for (const n of [2, 3]) $("p" + n).dataset.state = "locked";
  $("p1").dataset.state = "current";
  $("channels").replaceChildren();
  $("app-name").hidden = true;
  $("forget").hidden = true;
  $("empty").textContent = "Connect with your key to see your channels.";
  $("empty").hidden = false;
  $("secretbox").hidden = true;
  key = "";
  store.set("");
}

function renderChannels(list) {
  const ul = $("channels");
  ul.replaceChildren();
  $("empty").textContent = "No channels yet. Add one below.";
  $("empty").hidden = list.length > 0;
  for (const c of list) {
    const li = document.createElement("li");
    const line = document.createElement("span");
    line.className = "line";
    line.textContent = channelLine(c);
    const test = document.createElement("button");
    test.className = "ghost-btn";
    test.type = "button";
    test.textContent = "Test";
    test.addEventListener("click", () => testChannel(c.id));
    const del = document.createElement("button");
    del.className = "ghost-btn";
    del.type = "button";
    del.textContent = "Delete";
    del.addEventListener("click", () => deleteChannel(c.id));
    li.append(line, test, del);
    ul.append(li);
  }
}

async function load(label = "Loading your channels...") {
  const r = await run(label, "/v1/alerts", { headers: authHeaders(key) });
  if (!r) return false;
  appName = r.app;
  renderKind();
  $("app-name").textContent = `Connected to ${r.app}`;
  $("app-name").hidden = false;
  $("forget").hidden = false;
  $("p1").dataset.state = "done";
  $("p2").dataset.state = "current";
  $("p3").dataset.state = "current";
  renderChannels(r.channels ?? []);
  setBusy(false);
  say("");
  return true;
}

async function testChannel(id) {
  const r = await run("Sending a test message...", `/v1/alerts/${encodeURIComponent(id)}/test`, { method: "POST", headers: authHeaders(key) });
  if (r) say("Test message sent. Check the channel.");
}

async function deleteChannel(id) {
  const r = await run("Deleting...", `/v1/alerts/${encodeURIComponent(id)}`, { method: "DELETE", headers: authHeaders(key) });
  if (!r) return;
  await load("Reloading your channels...");
  say("Channel deleted.");
}

$("connect").addEventListener("submit", async (e) => {
  e.preventDefault();
  const bad = keyError($("key").value);
  if (bad) return fail(bad);
  key = $("key").value.trim();
  if (await load()) {
    store.set(key);
    $("key").value = "";
  }
});

$("forget").addEventListener("click", () => {
  lock();
  $("key").value = "";
  fail("");
  say("Key forgotten. Paste it again to reconnect.");
});

$("kind").addEventListener("change", () => {
  renderKind();
  fail("");
});

$("add").addEventListener("submit", async (e) => {
  e.preventDefault();
  const kind = $("kind").value;
  const bad = targetError(kind, $("target").value);
  if (bad) return fail(bad);
  $("secretbox").hidden = true;
  const { path, init } = addRequest(key, kind, $("target").value);
  const r = await run("Adding and sending a test message...", path, init, true);
  if (!r) return;
  $("target").value = "";
  if (r.secret) {
    $("secret").textContent = r.secret;
    $("secretbox").hidden = false;
  }
  await load("Reloading your channels...");
  say(`Added ${r.kind}, ${r.label}. A test message was sent.${r.secret ? " Copy the secret below now." : ""}`);
});

$("copy-secret").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("secret").textContent);
    say("Secret copied.");
  } catch {
    say("Could not copy. Select the secret and copy it by hand.");
  }
});

renderKind();
api("/v1/alerts/telegram-bot")
  .then((r) => {
    bot = r.username ?? null;
    renderKind();
  })
  .catch(() => {});
const saved = store.get();
if (saved) {
  key = saved;
  load("Reconnecting...");
}

$("find-chat").addEventListener("click", findChat);
