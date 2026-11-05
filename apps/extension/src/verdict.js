// The 3 badge states. green = every script is in the release, red = something is not,
// grey = no release on record for this site. See docs/ARCHITECTURE.md, "How the extension decides".
export const STATES = {
  green: { text: "OK", color: "#15803d", label: "Every script matches the latest release." },
  red: {
    text: "!",
    color: "#b91c1c",
    label: "This site serves scripts that are in no release. Do not sign anything here until the team confirms.",
  },
  grey: {
    text: "?",
    color: "#6b7280",
    label: "No release on record for this site, so its scripts cannot be checked. Treat it as unverified.",
  },
  none: { text: "", color: "#6b7280", label: "Not a website, so there is nothing to check." },
};

// Hard-coded until T-C02 replaces it with the real compare against Arkiv and Swarm.
const HARD_CODED = {
  "example.com": "green",
  "example.org": "red",
};

export function verdictFor(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return "none";
  }
  if (!/^https?:$/.test(parsed.protocol)) return "none";
  return HARD_CODED[parsed.hostname] ?? "grey";
}
