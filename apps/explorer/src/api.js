// The Hydra API, for the publish page. As in apps/site/config.js, ?api= overrides it only with a
// localhost address, so a crafted link cannot point a visitor's wallet at another server.
export const API_DEFAULT = "https://hydra-api-5xmn.onrender.com";

const override = new URLSearchParams(location.search).get("api");
const local = (u) => {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(u).hostname);
  } catch {
    return false;
  }
};
export const API = (override && local(override) ? override : API_DEFAULT).replace(/\/+$/, "");

// The agent docs and the Claude Code skill stay on the T-A09 site until the explorer replaces it.
export const DOCS = "https://hydra-site-one.vercel.app/llms.txt";
export const SKILL = "https://hydra-site-one.vercel.app/skill/hydra-publish/SKILL.md";

// The API's error text when it has one; the free host sleeps, so say so on a network failure.
export async function api(path, init) {
  let res;
  try {
    res = await fetch(API + path, init);
  } catch {
    throw new Error("the Hydra API did not answer. Its free host may be waking up; wait 30 seconds and try again");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error ?? `HTTP ${res.status}`), { status: res.status });
  return body;
}
