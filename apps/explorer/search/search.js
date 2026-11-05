// Turns what a user typed into Arkiv lookups, and lookups into apps. No DOM, no network: `find`
// is passed in, so this runs the same in the page and under `node --test`.

const HEX64 = /^[0-9a-f]{64}$/;

// Swarm references are 64 hex, or 128 when encrypted. A file hash is "sha256-" plus 64 hex.
export function lookups(input) {
  const q = input.trim();
  if (!q) return [];
  const lower = q.toLowerCase().replace(/^0x/, "");
  const file = (hex) => ({ schema: "hydra.file", field: "sha256", value: `sha256-${hex}`, via: "file sha256" });
  const swarm = (ref) => ({ schema: "hydra.release", field: "swarm_ref", value: ref, via: "Swarm reference" });

  if (lower.startsWith("sha256-") && HEX64.test(lower.slice(7))) return [file(lower.slice(7))];
  if (HEX64.test(lower)) return [file(lower), swarm(lower)];
  if (/^[0-9a-f]{128}$/.test(lower)) return [swarm(lower)];
  // Typed case and lower case, since app ids are usually lower case.
  const names = [...new Set([q, q.toLowerCase()])].map((value) => ({ schema: "hydra.app", field: "app", value, via: "app name" }));
  // A URL is matched by its hostname only. A bare dotted word may be a domain or an app name.
  if (/^\S+\.\S+$/.test(q)) {
    const isUrl = /^[a-z]+:\/\//i.test(q) || q.includes("/");
    try {
      const host = new URL(/^[a-z]+:\/\//i.test(q) ? q : `https://${q}`).hostname;
      const domain = { schema: "hydra.app", field: "domain", value: host, via: "domain" };
      return isUrl ? [domain] : [domain, ...names];
    } catch {
      // Not a URL after all; fall through to an app name.
    }
  }
  return names;
}

// Every lookup runs at once. Each hit names its app, and each app is listed once, with how it
// was found and the entity that matched.
export async function search(input, find) {
  const found = await Promise.all(
    lookups(input).map(async (l) => (await find(l.schema, l.field, l.value)).map((e) => ({ e, l }))),
  );
  const byApp = new Map();
  for (const { e, l } of found.flat()) {
    const app = e.$attributes?.app?.value;
    if (app && !byApp.has(app)) byApp.set(app, { app: String(app), via: l.via, key: e.$key, schema: l.schema });
  }
  return [...byApp.values()];
}
