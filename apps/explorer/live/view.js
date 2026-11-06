// What the Live page shows for a watcher state from GET /v1/watch. Pure: state and a clock in,
// words out, so it runs in the page and under `node --test`. A match is never worded as safe.

const WORD = { match: "matches", mismatch: "differs", unreachable: "can't be reached" };

function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
}

function left(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)} min ${s % 60} s left`;
}

function clock(at) {
  const d = new Date(at);
  return [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()].map((n) => String(n).padStart(2, "0")).join(":") + " UTC";
}

function alertText(f) {
  if (f.alert === "done") return "alert sent";
  if (f.alert === "failed") return `alert failed: ${f.note ?? "unknown error"}`;
  return "alert sending";
}

export function describe(s, now) {
  const strip = (s.ticks ?? []).slice(-30).map((t) => t.verdict);
  const events = [...(s.flips ?? [])].reverse().map((f) => `${clock(f.at)}: ${WORD[f.from]} to ${WORD[f.to]}, ${alertText(f)}`);
  const base = { strip, events, problems: [], checked: "", remaining: "" };

  if (!s.on) {
    const why = s.stoppedBecause ? `It stopped: ${s.stoppedBecause}.` : "Switch it on to check the site every 5 seconds.";
    return { ...base, tone: "off", headline: "Not watching", detail: why };
  }
  const last = s.last;
  const common = { ...base, remaining: s.expiresAt ? left(s.expiresAt - now) : "", checked: last ? `checked ${ago(now - last.at)}` : "first check running" };
  if (!last) return { ...common, tone: "unknown", headline: "Starting", detail: "The first check is running." };
  if (last.verdict === "mismatch") {
    return {
      ...common,
      tone: "mismatch",
      headline: "Differs from the release",
      problems: last.problems,
      detail: "A script changed or is in no release. Do not sign or approve anything on this site until the team confirms.",
    };
  }
  if (last.verdict === "unreachable") {
    return { ...common, tone: "unknown", headline: "Can't reach the site right now", problems: last.problems, detail: "No verdict this round. It keeps trying every 5 seconds." };
  }
  return {
    ...common,
    tone: "match",
    headline: "Matches the team's release",
    detail: "Every script is one the team published. That says the site serves the published build, not that the build is safe.",
  };
}
