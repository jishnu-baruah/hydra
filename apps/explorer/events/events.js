// The events timeline: Hydra releases and indexer observations in one list, newest first. Pure, so
// it runs in the page and under `node --test`. Rows are schemaless Arkiv selects:
// { $key, $attributes: { name: { value } } }.

// sha256 of nothing: the indexer saw no scripts on the page.
export const EMPTY = "sha256-e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const val = (e, k) => e.$attributes?.[k]?.value;

// An observation body is JSON in a bytes column, returned as 0x hex. Data only: parsed, never run.
export function decode(body) {
  if (typeof body !== "string" || !/^0x([0-9a-f]{2})*$/i.test(body)) return null;
  try {
    const bytes = new Uint8Array(body.slice(2).match(/../g)?.map((h) => parseInt(h, 16)) ?? []);
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

// Only a GitHub Actions run becomes a link; anything else in the field stays text.
const CI = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+(\/[\w/]*)?$/;
const ciLink = (url) => (typeof url === "string" && CI.test(url) ? url : null);

export function timeline(releaseRows, observationRows, appRows = []) {
  const claims = appRows.map((e) => ({
    kind: "claim",
    key: e.$key,
    at: Number(val(e, "created_at") ?? 0),
    app: String(val(e, "app") ?? ""),
    publisher: String(val(e, "publisher") ?? ""),
  }));
  const releases = releaseRows.map((e) => ({
    kind: "release",
    key: e.$key,
    at: Number(val(e, "published_at") ?? 0),
    app: String(val(e, "app") ?? ""),
    version: String(val(e, "version") ?? ""),
    commit: String(val(e, "commit") ?? ""),
    files: Number(val(e, "file_count") ?? 0),
    ci: ciLink(decode(val(e, "body"))?.ci_run_url),
  }));

  // A change is a site's script set differing from its previous observation. Worked out here, not
  // taken from the indexer's own flag, which starts over whenever the indexer restarts.
  const previous = new Map();
  const observations = observationRows
    .map((e) => ({ e, at: Number(val(e, "observed_at") ?? 0) }))
    .sort((a, b) => a.at - b.at)
    .map(({ e, at }) => {
      const domain = String(val(e, "domain") ?? "");
      const hash = String(val(e, "scripts_hash") ?? "");
      const body = decode(val(e, "body"));
      const changed = previous.has(domain) && previous.get(domain) !== hash;
      previous.set(domain, hash);
      return {
        kind: "observation",
        key: e.$key,
        at,
        domain,
        label: String(val(e, "app") ?? ""),
        status: String(val(e, "status") ?? "unknown"),
        scripts: Array.isArray(body?.scripts) ? body.scripts.length : null,
        problems: Array.isArray(body?.problems) ? body.problems.map(String) : [],
        changed,
        empty: hash === EMPTY,
      };
    });

  return [...claims, ...releases, ...observations].sort((a, b) => b.at - a.at);
}

export function only(events, mode) {
  if (mode === "releases") return events.filter((e) => e.kind === "release" || e.kind === "claim");
  if (mode === "observed") return events.filter((e) => e.kind === "observation");
  // Changes that matter: a mismatch, or a change on a site that has a release. A site with no
  // release changes its script set on its own (spike F3: 1inch loads a different set every time).
  if (mode === "changes") return events.filter((e) => e.kind === "observation" && (e.status === "mismatch" || (e.changed && e.status !== "unknown")));
  return events;
}

// Severity of one event, in one place. green = match, release published, restored. yellow = a change
// that is not proven compromise (unreachable, skipped, third-party runtime origin, unknown). red =
// only a mismatch caused by a served script that is in no release or differs from it.
export function verdict(e) {
  if (e.kind === "claim") return { level: "neutral", label: "Claimed" };
  if (e.kind === "release") return { level: "green", label: "Release" };
  if (e.status === "match") return { level: "green", label: "Match" };
  const p = e.problems ?? [];
  if (e.status === "mismatch") {
    const script = p.length === 0 || p.some((x) => /^(EXTRA|CHANGED|UNREADABLE) /.test(x));
    if (script) return { level: "red", label: "Not in release" };
    return { level: "yellow", label: p.some((x) => /RUNTIME_ORIGIN/.test(x)) ? "Origin changed" : "Check issue" };
  }
  if (p.some((x) => x.startsWith("UNREACHABLE"))) return { level: "yellow", label: "Unreachable" };
  return { level: "yellow", label: e.empty ? "Skipped" : "Unknown" };
}

// Activity under the Monitor shows integrated sites only: releases, claims, and checks of a site the
// indexer has compared with a release (match or mismatch at least once). Coverage-only sites drop out.
export function integratedOnly(events) {
  const bound = new Set(events.filter((e) => e.kind === "observation" && (e.status === "match" || e.status === "mismatch")).map((e) => e.domain));
  return events.filter((e) => e.kind !== "observation" || bound.has(e.domain));
}
