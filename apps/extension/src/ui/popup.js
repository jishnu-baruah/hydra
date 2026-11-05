// The popup: the stored verdict for the current tab, updated live while the check runs.
// Everything shown comes from present(), as plain strings set with textContent.
import { isWeb, stored } from "../verdict.js";
import { present } from "./present.js";
import { EXPLORER } from "./links.js";

const $ = (id) => document.getElementById(id);

// ?tab=<id> points the popup at a given tab; tests use it, since a popup opened in a tab of its own
// would otherwise be its own active tab. Only this extension can open its pages.
const forced = Number(new URLSearchParams(location.search).get("tab"));
const tab = forced ? await chrome.tabs.get(forced).catch(() => null) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

function render(result) {
  if (!tab) {
    $("host").textContent = "";
    $("label").textContent = "No tab";
    $("message").textContent = "No active tab. Switch to a website tab and open Hydra again.";
    return;
  }
  const web = isWeb(tab.url);
  $("host").textContent = web ? new URL(tab.url).host : "";
  const v = present(web ? result : { verdict: "none" }, { explorer: EXPLORER, origin: web ? new URL(tab.url).origin : "" });

  $("verdict").dataset.state = v.state;
  $("label").textContent = v.label;
  $("message").textContent = v.message;
  $("note").textContent = v.note;

  $("list").hidden = v.items.length === 0;
  $("items").replaceChildren(
    ...v.items.map((item) => {
      const li = document.createElement("li");
      const path = Object.assign(document.createElement("span"), { className: "path", textContent: item.path });
      const kind = Object.assign(document.createElement("span"), { className: "kind", textContent: item.text });
      li.append(path, kind);
      return li;
    }),
  );
  $("more").textContent = v.more ? `and ${v.more} more` : "";

  $("link").hidden = !v.link;
  if (v.link) {
    $("link").href = v.link.href;
    $("link").textContent = v.link.text;
  }
  $("foot").textContent = result?.at ? `Checked at ${new Date(result.at).toLocaleTimeString()}` : "";
  document.body.dataset.state = v.state;
}

render(tab ? await stored(tab.id) : null);

// While the check runs, the popup follows it.
if (tab) {
  chrome.storage.onChanged.addListener((changes, area) => {
    const c = changes[`v:${tab.id}`];
    if (area === "session" && c) render(c.newValue ?? null);
  });
}
