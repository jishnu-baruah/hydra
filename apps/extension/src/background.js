import { STATES, verdictFor } from "./verdict.js";

async function paint(tabId, url) {
  const state = STATES[verdictFor(url)];
  try {
    await chrome.action.setBadgeText({ tabId, text: state.text });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: state.color });
    await chrome.action.setTitle({ tabId, title: `Hydra: ${state.label}` });
  } catch {
    // The tab closed before we painted it. Nothing to show.
  }
}

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.url || change.status === "complete") paint(tabId, tab.url);
});

// Tabs already open when the extension is installed or reloaded get a badge too.
chrome.runtime.onInstalled.addListener(async () => {
  for (const tab of await chrome.tabs.query({})) paint(tab.id, tab.url);
});
