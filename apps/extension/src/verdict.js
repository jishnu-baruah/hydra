// The badge states. green = every script is in the release, red = something is not,
// grey = no release on record for this site. See docs/ARCHITECTURE.md, "How the extension decides".
export const STATES = {
  green: { text: "OK", color: "#15803d", label: "Every script matches the latest release." },
  red: {
    text: "!",
    color: "#b91c1c",
    label: "This site serves scripts that are in no release. Do not sign anything here until the team confirms.",
  },
  listed: {
    text: "BAD",
    color: "#7f1d1d",
    label: "This hostname is on a public phishing list. Do not connect a wallet or sign anything unless you are sure.",
  },
  grey: {
    text: "?",
    color: "#6b7280",
    label: "No release on record for this site, so its scripts cannot be checked. Treat it as unverified.",
  },
  checking: { text: "..", color: "#6b7280", label: "Checking this page's scripts against its release." },
  none: { text: "", color: "#6b7280", label: "Not a website, so there is nothing to check." },
};

export const isWeb = (url) => {
  try {
    return /^https?:$/.test(new URL(url).protocol);
  } catch {
    return false;
  }
};

// Before the worker has a result for a tab, a web page is being checked.
export const verdictFor = (url) => (isWeb(url) ? "checking" : "none");

// The worker's last result for a tab: { verdict, mismatches, matched, ignored, app, version, reason }.
export async function stored(tabId) {
  return (await chrome.storage.session.get(`v:${tabId}`))[`v:${tabId}`] ?? null;
}
