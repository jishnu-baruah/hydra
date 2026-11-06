// What the popup and the in-page banner show for one stored result (see background.js). One
// function for both, so they can never disagree. Returns plain strings: callers render them with
// textContent, because script URLs come from the page and are data.

const KIND = {
  changed: "Changed since the release",
  extra: "Not in the release",
  unreadable: "Could not be read back",
};
const LIMIT = 10;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Same origin shows the path; another origin shows host and path. The query string is dropped.
function shown(url, origin) {
  const u = new URL(url);
  return u.origin === origin ? u.pathname : `${u.host}${u.pathname}`;
}

export function present(result, { explorer, origin }) {
  const base = explorer.replace(/\/+$/, "");
  const link = result?.app ? { href: `${base}/app/?name=${encodeURIComponent(result.app)}`, text: `Open ${result.app} on Hydra` } : null;
  // "listed" is a hostname on a public phishing list: shown as red, but as its own kind of warning.
  const listed = result?.verdict === "listed";
  const view = { state: listed ? "red" : (result?.verdict ?? "checking"), kind: listed ? "listed" : "", label: "", message: "", items: [], more: 0, link, note: "" };

  switch (listed ? "listed" : view.state) {
    case "listed":
      view.label = "On a phishing list";
      view.message =
        `${result.host} is on MetaMask's public phishing list (${result.entry}). Do not connect a wallet or sign anything unless you are sure this is the site you meant. Lists can be wrong, and a site that is not on a list is not thereby safe.`;
      break;
    case "red": {
      const n = result.mismatches.length;
      view.label = "Changed";
      view.message = `${plural(n, "script is", "scripts are")} not in ${result.app} ${result.version}. Do not sign or approve anything here until the team confirms.`;
      view.items = result.mismatches.slice(0, LIMIT).map((m) => ({ path: shown(m.url, origin), kind: m.kind, text: KIND[m.kind] ?? m.kind }));
      view.more = Math.max(0, n - LIMIT);
      break;
    }
    case "green":
      view.label = "Match";
      view.message =
        result.matched === 1
          ? `The 1 script matches ${result.app} ${result.version}.`
          : `All ${result.matched} scripts match ${result.app} ${result.version}.`;
      break;
    case "grey":
      view.label = "No release on record";
      view.message = result.reason ?? "No release on record for this site, so its scripts cannot be checked. Treat it as unverified.";
      break;
    case "none":
      view.label = "Not a website";
      view.message = "Nothing to check on this page.";
      break;
    default:
      view.state = "checking";
      view.label = "Checking";
      view.message = "Checking this page's scripts against its release.";
  }
  if (result?.ignored) view.note = `${plural(result.ignored, "script injected by the host was", "scripts injected by the host were")} not judged.`;
  return view;
}
