// Pure logic for the wallet Console: session checks, labels, request building. No DOM here.
export const MAX_CHANNELS = 5;

export const shortAddress = (a) => (typeof a === "string" && a.length > 12 ? `${a.slice(0, 6)}...${a.slice(-4)}` : String(a ?? ""));

function expiryMs(e) {
  if (typeof e === "string") return Date.parse(e);
  if (typeof e === "number") return e < 1e12 ? e * 1000 : e;
  return NaN;
}

export function sessionLive(s, now = Date.now()) {
  if (!s || typeof s.session !== "string" || !s.session.startsWith("hys_")) return false;
  const t = expiryMs(s.expires);
  return Number.isFinite(t) && t > now;
}

export function appCard(a) {
  const day = typeof a.created_at === "string" && a.created_at.length >= 10 ? a.created_at.slice(0, 10) : "";
  const n = Array.isArray(a.channels) ? a.channels.length : 0;
  return {
    name: a.app,
    href: `../app/?name=${encodeURIComponent(a.app)}`,
    claimed: day ? `Claimed ${day}` : "",
    version: a.key_version != null ? `Key version ${a.key_version}` : "",
    count: `${n} of ${MAX_CHANNELS} channels`,
  };
}

export function normalizeApps(body) {
  const list = Array.isArray(body?.apps) ? body.apps : [];
  return list.filter((a) => a && typeof a.app === "string").map((a) => ({ ...a, channels: Array.isArray(a.channels) ? a.channels : [] }));
}

const bearer = (t) => ({ authorization: `Bearer ${String(t).trim()}` });
const json = (t) => ({ ...bearer(t), "content-type": "application/json" });

// op: list | rotate | add | test | delete | chats. mode: "wallet" (session) or "key" (one app key).
export function consoleRequest(mode, token, app, op, arg) {
  const e = encodeURIComponent;
  if (mode === "key") {
    switch (op) {
      case "list": return { path: "/v1/alerts", init: { headers: bearer(token) } };
      case "add": return { path: "/v1/alerts", init: { method: "POST", headers: json(token), body: JSON.stringify({ kind: arg.kind, target: String(arg.target).trim() }) } };
      case "test": return { path: `/v1/alerts/${e(arg)}/test`, init: { method: "POST", headers: bearer(token) } };
      case "delete": return { path: `/v1/alerts/${e(arg)}`, init: { method: "DELETE", headers: bearer(token) } };
      case "chats": return { path: "/v1/alerts/telegram-chats", init: { headers: bearer(token) } };
      default: throw new Error("Rotating a key needs a wallet sign-in. Sign in with your wallet first.");
    }
  }
  const base = `/v1/console/apps/${e(app)}`;
  switch (op) {
    case "list": return { path: "/v1/console/apps", init: { headers: bearer(token) } };
    case "rotate": return { path: `${base}/rotate`, init: { method: "POST", headers: bearer(token) } };
    case "add": return { path: `${base}/alerts`, init: { method: "POST", headers: json(token), body: JSON.stringify({ kind: arg.kind, target: String(arg.target).trim() }) } };
    case "test": return { path: `${base}/alerts/${e(arg)}/test`, init: { method: "POST", headers: bearer(token) } };
    case "delete": return { path: `${base}/alerts/${e(arg)}`, init: { method: "DELETE", headers: bearer(token) } };
    case "chats": return { path: `${base}/telegram-chats`, init: { headers: bearer(token) } };
    default: throw new Error(`Unknown console action ${op}.`);
  }
}

export function rotateCommand(key) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(key))) throw new Error("The new key has odd characters, so no command was built. Copy the key by hand.");
  return `gh secret set HYDRA_API_KEY --body "${key}"`;
}

// personal_sign wants the message as 0x hex.
export function toHex(s) {
  return "0x" + Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function walletErrorText(e) {
  if (!e) return "No wallet found in this browser. Install MetaMask or Rabby, then reload, or use an API key instead.";
  if (e.code === 4001) return "The wallet request was rejected. Press Sign in with wallet to try again.";
  if (e.code === -32002) return "Your wallet already has a request open. Open your wallet, finish it, then try again.";
  return `${e.message ?? "The wallet failed"}. Check your wallet is unlocked, then try again.`;
}

export function apiErrorText(e, phase = "") {
  const msg = e?.message ?? "Something went wrong";
  switch (e?.status) {
    case 401:
      return phase === "signin" ? "The wallet signature was not accepted. Sign in with wallet to try again." : "Your sign-in has expired. Sign in again.";
    case 403:
      return "That app is not owned by this wallet. Sign in with the wallet that published it.";
    case 400:
      return phase === "signin" ? `${msg}. The sign-in message was stale. Try again.` : `${msg}. Check the details and try again.`;
    case 409:
      return `${msg}. An app can have ${MAX_CHANNELS} channels. Delete one, then add this one.`;
    case 502:
      return `The test message failed: ${msg}. Check the target and try again. Nothing was saved.`;
    case 503:
      return "Alerts are not set up on the Hydra server yet. Try again later; nothing you did is wrong.";
    case 404:
      return "That item is already gone. Reload the page.";
    default:
      return `${msg}. Check the details and try again.`;
  }
}
