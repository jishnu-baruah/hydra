// One entry per site the indexer watches, from events.js timeline() output (newest first). Pure,
// so it runs in the page and under `node --test`.

const RANK = { mismatch: 0, unknown: 1, match: 2 };

export function sites(events) {
  const by = new Map();
  for (const e of events) {
    if (e.kind !== "observation") continue;
    const s = by.get(e.domain) ?? { domain: e.domain, label: e.label, latest: e, status: e.status, lastSeen: e.at, runs: 0, changes: 0, published: false };
    s.runs++;
    if (e.changed) s.changes++;
    // A match or a mismatch means the indexer had a release to compare with.
    if (e.status !== "unknown") s.published = true;
    by.set(e.domain, s);
  }
  return [...by.values()].sort((a, b) => (RANK[a.status] ?? 1) - (RANK[b.status] ?? 1) || a.domain.localeCompare(b.domain));
}
