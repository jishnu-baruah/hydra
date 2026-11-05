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

export function timeline(releaseRows, observationRows) {
  const releases = releaseRows.map((e) => ({
    kind: "release",
    key: e.$key,
    at: Number(val(e, "published_at") ?? 0),
    app: String(val(e, "app") ?? ""),
    version: String(val(e, "version") ?? ""),
    commit: String(val(e, "commit") ?? ""),
    files: Number(val(e, "file_count") ?? 0),
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

  return [...releases, ...observations].sort((a, b) => b.at - a.at);
}

export function only(events, mode) {
  if (mode === "releases") return events.filter((e) => e.kind === "release");
  if (mode === "observed") return events.filter((e) => e.kind === "observation");
  if (mode === "changes") return events.filter((e) => e.kind === "observation" && (e.changed || e.status === "mismatch"));
  return events;
}
