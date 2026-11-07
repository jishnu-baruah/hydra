// Pure row logic for the all-apps page. ENS values are data: classified here, never run.
import { approval, isAppName } from "../../src/ensview.js";

export const MAX_ROWS = 20;
const NAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const attrs = (e) => Object.fromEntries(Object.entries(e?.$attributes ?? {}).map(([k, v]) => [k, v?.value]));

// hydra.ens entities -> [{app, name}], newest link per app, newest app first, capped.
export function latestPerApp(entities) {
  const best = new Map();
  for (const e of Array.isArray(entities) ? entities : []) {
    const a = attrs(e);
    if (typeof a.app !== "string" || !a.app || typeof a.name !== "string" || !a.name) continue;
    const at = Number(a.created_at ?? 0);
    if (!best.has(a.app) || at > best.get(a.app).at) best.set(a.app, { app: a.app, name: a.name, at });
  }
  return [...best.values()].sort((x, y) => y.at - x.at).slice(0, MAX_ROWS);
}

const APPROVAL = {
  latest: "Newest release approved",
  older: "older release approved",
  unknown: "approved release not in history",
  none: "not approved yet",
  invalid: "release record is not a release id",
};

// records: {status, app, release} from ENS; releaseKeys: the app's trusted releases, newest first.
export function rowModel({ app, link, records, releaseKeys }) {
  const rec = records ?? {};
  const a = approval(releaseKeys ?? [], rec.release);
  const tone = rec.status === "match" || rec.status === "mismatch" ? rec.status : "unknown";
  return {
    app,
    appHref: isAppName(app) ? `../../app/?name=${encodeURIComponent(app)}` : null,
    name: link.name,
    nameHref: NAME.test(link.name) ? `../?name=${encodeURIComponent(link.name)}` : null,
    statusTone: tone,
    statusLabel: tone === "unknown" ? "no status yet" : tone,
    approval: a.state,
    approvalLabel: APPROVAL[a.state],
    release: rec.release ? String(rec.release).slice(0, 66) : "not set",
  };
}
