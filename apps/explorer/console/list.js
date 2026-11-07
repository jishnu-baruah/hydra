// Pure logic for the Console app list. No DOM here.
export function rowSummary(app) {
  const n = Array.isArray(app?.channels) ? app.channels.length : 0;
  const parts = [];
  if (app?.key_version != null) parts.push(`key v${app.key_version}`);
  parts.push(`${n} ${n === 1 ? "channel" : "channels"}`);
  return { name: app.app, meta: parts.join(" / ") };
}

export function filterApps(apps, query) {
  const q = String(query ?? "").trim().toLowerCase();
  return q ? apps.filter((a) => a.app.toLowerCase().includes(q)) : apps;
}

// The one open app after a click: clicking the open one closes it.
export const nextOpen = (current, clicked) => (current === clicked ? null : clicked);
