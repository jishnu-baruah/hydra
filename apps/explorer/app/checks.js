// "Last checks" bar for an app's site: pure model from the API's /v1/observations history.
// History is newest first from the API; the bar shows oldest left, newest right.

const WORD = { match: "Matches the release", mismatch: "Differs from the release" };
const word = (s) => WORD[s] ?? "Not reachable";
const tone = (s) => (s === "match" || s === "mismatch" ? s : "unknown");
const when = (ms) => new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";

export function siteHistory(payload, domain) {
  const site = Array.isArray(payload?.sites) ? payload.sites.find((s) => s.domain === domain) : null;
  return Array.isArray(site?.history) ? site.history : [];
}

export function barModel(history, max = 12) {
  if (!Array.isArray(history)) return [];
  return history
    .map((r) => ({ at: Number(r?.observed_at ?? 0), status: String(r?.status ?? "") }))
    .sort((a, b) => b.at - a.at)
    .slice(0, max)
    .reverse()
    .map((r) => ({ at: r.at, tone: tone(r.status), title: `${when(r.at)}: ${word(r.status)}` }));
}

export function headline(history, now) {
  const newest = (Array.isArray(history) ? history : []).reduce((m, r) => (!m || r.observed_at > m.observed_at ? r : m), null);
  if (!newest) return "Not checked yet";
  const s = Math.max(0, Math.round((now - Number(newest.observed_at)) / 1000));
  return `${word(newest.status)}, checked ${s < 60 ? `${s} s` : `${Math.round(s / 60)} min`} ago`;
}
