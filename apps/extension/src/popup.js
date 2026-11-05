import { STATES, verdictFor } from "./verdict.js";

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const url = tab?.url ?? "";
const state = STATES[verdictFor(url)];
const el = document.getElementById("state");
el.textContent = state.label;
el.style.color = state.color;
// textContent, never innerHTML: the URL comes from the page and is data.
document.getElementById("host").textContent = url ? new URL(url).hostname || url : "No active tab. Switch to a website tab and open Hydra again.";
