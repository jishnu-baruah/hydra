// Where an app runs: the domains its newest release binds (proven at publish, T-A19) and what the
// indexer last saw on each. Pure, so it runs in the page and under `node --test`.

const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

// `releases` is the API's /v1/apps/<app>/releases list, newest first.
export function boundDomains(releases) {
  if (!Array.isArray(releases) || !releases.length) return [];
  const newest = [...releases].sort((a, b) => Number(b.published_at ?? 0) - Number(a.published_at ?? 0))[0];
  const list = newest?.payload?.manifest?.domains;
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const d of list) {
    const h = typeof d === "string" ? d.trim().toLowerCase() : "";
    if (HOST.test(h) && !out.includes(h)) out.push(h);
  }
  return out.slice(0, 5);
}

// `rows` are observation entities, newest first. With `app`, an observation recorded for a different
// app is ignored: the domain was re-bound, and its verdict belongs to the other app's page.
export function latestVerdict(rows, app) {
  const e = rows?.[0];
  if (!e) return null;
  const forApp = e.$attributes?.app?.value;
  if (app && forApp && forApp !== app) return null;
  const status = e.$attributes?.status?.value;
  return { status: ["match", "mismatch"].includes(status) ? status : "unknown", observedAt: Number(e.$attributes?.observed_at?.value ?? 0) };
}

// A match says the site serves what the team published. It does not say the build is safe.
export function verdictText(status) {
  if (status === "match") return "Matches the team's release. That says the scripts are the published ones, not that the build is safe.";
  if (status === "mismatch") return "Differs from the release: a script changed or is in no release. Do not sign or approve anything there until the team confirms.";
  return "No release to compare with yet.";
}
