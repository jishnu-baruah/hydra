// Pure helpers for showing a team's ENS records (T-A36). Values come from ENS and are data only.
const KEY_RE = /^0x[0-9a-fA-F]{64}$/;
export const isReleaseKey = (v) => KEY_RE.test(v);
export const isAppName = (v) => /^[a-z0-9-]{1,64}$/.test(v);

// releaseKeys: newest first. approvedValue: the raw hydra.release text record.
export function approval(releaseKeys, approvedValue) {
  const v = String(approvedValue ?? "").trim();
  if (!v) return { state: "none" };
  if (!KEY_RE.test(v)) return { state: "invalid" };
  const lower = releaseKeys.map((k) => String(k).toLowerCase());
  const i = lower.indexOf(v.toLowerCase());
  if (i === 0) return { state: "latest", key: releaseKeys[0] };
  if (i > 0) return { state: "older", key: releaseKeys[i] };
  return { state: "unknown", key: v };
}

const APPROVAL = {
  latest: (n) => `${n} approved the newest release.`,
  older: (n) => `${n} approved an older release, not the newest one. The newest release was not approved by the team's ENS name.`,
  unknown: (n) => `${n} approved a release that is not in this app's history.`,
  none: (n) => `${n} has not approved a release yet.`,
  invalid: (n) => `${n} has a hydra.release record that is not a release id.`,
};
export const approvalText = (state, name) => (APPROVAL[state] ?? APPROVAL.invalid)(name);

const STATUS = {
  match: "Matches its release. The live site serves the files the team published.",
  mismatch: "Differs from its release. The live site serves files that are in no release.",
};
export const statusText = (value) => STATUS[value] ?? "No status yet";
