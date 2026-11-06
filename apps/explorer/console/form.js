// Pure logic for the Console page: validation, request building, labels. No DOM here.
export const KINDS = ["webhook", "slack", "discord", "telegram"];

export function keyError(key) {
  const k = String(key ?? "").trim();
  if (!k) return "Paste your API key first. You get one on the Publish page.";
  if (!k.startsWith("hyd_")) return "That does not look like a Hydra key. Keys start with hyd_. Get one on the Publish page.";
  return null;
}

const httpsUrl = (t) => {
  try {
    const u = new URL(t);
    return u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
};

export function targetError(kind, target) {
  if (!KINDS.includes(kind)) return "Pick a channel kind from the list.";
  const t = String(target ?? "").trim();
  if (!t) return "Enter where the alerts should go.";
  if (kind === "telegram") {
    return /^-?\d{1,20}$/.test(t) ? null : "A Telegram chat id is a whole number, negative for groups, for example -1001234567890.";
  }
  const u = httpsUrl(t);
  if (!u) return "Enter a full https:// URL.";
  if (kind === "slack" && !t.startsWith("https://hooks.slack.com/services/")) {
    return "A Slack URL must start with https://hooks.slack.com/services/. Create an Incoming Webhook in your Slack app.";
  }
  if (kind === "discord" && !(t.startsWith("https://discord.com/api/webhooks/") || t.startsWith("https://discordapp.com/api/webhooks/"))) {
    return "A Discord URL must start with https://discord.com/api/webhooks/. Copy it from Channel settings, Integrations, Webhooks.";
  }
  return null;
}

export const authHeaders = (key) => ({ authorization: `Bearer ${String(key).trim()}` });

export function addRequest(key, kind, target) {
  return {
    path: "/v1/alerts",
    init: {
      method: "POST",
      headers: { ...authHeaders(key), "content-type": "application/json" },
      body: JSON.stringify({ kind, target: String(target).trim() }),
    },
  };
}

export function channelLine(c) {
  const day = typeof c.created_at === "string" && c.created_at.length >= 10 ? c.created_at.slice(0, 10) : "";
  return [c.kind, c.label].join(", ") + (day ? `, added ${day}` : "");
}

export function errorText(e, adding = false) {
  const msg = e?.message ?? "Something went wrong.";
  switch (e?.status) {
    case 401:
      return "The API key is wrong or has expired. Get a new one on the Publish page, then connect again.";
    case 503:
      return "Alerts are not set up on the Hydra server yet. Try again later; nothing you did is wrong.";
    case 409:
      return `${msg}. A key can have 5 channels. Delete one below, then add this one.`;
    case 502:
      return `The test message failed: ${msg}. Check the target and try again.${adding ? " Nothing was saved." : ""}`;
    case 404:
      return "That channel is already gone. Reload the list.";
    default:
      return `${msg}. Check the details and try again.`;
  }
}
