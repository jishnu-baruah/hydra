// The Live page: polls the Hydra API's watch state every second and shows it, and sends the switch.
// Everything from the API is shown with textContent only. The demo token is kept for this tab only.
import { API, api } from "../src/api.js";
import { describe } from "./view.js";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

$("api").textContent = API;
try {
  $("token").value = sessionStorage.getItem("hydra-demo-token") ?? "";
} catch {
  // storage can be blocked; the field just starts empty
}

let state = null;
let failing = false;

function paint() {
  if (!state) return;
  const v = describe(state, Date.now());
  $("card").className = `card ${v.tone}`;
  $("headline").textContent = v.headline;
  $("detail").textContent = v.detail;
  $("checked").textContent = v.checked;
  $("remaining").textContent = v.remaining;
  $("problems").replaceChildren(...v.problems.map((p) => el("li", "", p)));
  $("strip").replaceChildren(...v.strip.map((t) => Object.assign(el("i", `tick ${t}`), { title: t })));
  $("events").replaceChildren(...v.events.map((e) => el("li", "", e)));
  $("none").hidden = v.events.length > 0;
  $("toggle").textContent = state.on ? "Switch off" : "Switch on";
  if (state.on && state.domain) $("domain").value = state.domain;
}

async function poll() {
  try {
    state = await api("/v1/watch");
    failing = false;
    if (!$("message").dataset.sticky) $("message").textContent = "";
    paint();
  } catch (err) {
    failing = true;
    $("message").className = "error";
    $("message").textContent = `Could not read the live state: ${err.message}. This page retries every second.`;
    $("detail").textContent = "No answer from the Hydra API yet.";
  }
}

$("controls").addEventListener("submit", async (e) => {
  e.preventDefault();
  const token = $("token").value.trim();
  const turnOn = !(state?.on);
  const msg = $("message");
  delete msg.dataset.sticky;
  if (!token) {
    msg.className = "error";
    msg.textContent = "Enter the demo token to switch it on or off.";
    return;
  }
  try {
    sessionStorage.setItem("hydra-demo-token", token);
  } catch {
    // fine: the token just is not remembered
  }
  $("toggle").disabled = true;
  try {
    state = await api("/v1/watch", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ domain: $("domain").value.trim(), on: turnOn }),
    });
    msg.className = "";
    msg.textContent = turnOn ? "Watching. The first check is done." : "Switched off.";
    msg.dataset.sticky = "1";
    setTimeout(() => delete msg.dataset.sticky, 4000);
    paint();
  } catch (err) {
    msg.className = "error";
    msg.textContent = err.status === 401 ? "That demo token is wrong." : err.message;
  } finally {
    $("toggle").disabled = false;
  }
});

await poll();
setInterval(() => {
  if (!document.hidden) poll();
}, 1000);
setInterval(paint, 500); // keep "checked 3 s ago" and the countdown moving between polls
document.body.dataset.done = "1";
void failing;
