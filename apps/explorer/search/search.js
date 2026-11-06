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
  // A URL names a site, not an app: search() resolves it by hostname.
  if (/^[a-z]+:\/\//i.test(q) || q.includes("/")) return [];
  // Typed case and lower case, since app ids are usually lower case.
  return [...new Set([q, q.toLowerCase()])].map((value) => ({ schema: "hydra.app", field: "app", value, via: "app name" }));
}

// The hostname a URL or a bare dotted word names, or null. A site is resolved through the Hydra API's
// domain lookup and the indexer's observations (see search()), not an Arkiv column: since domain
// proof, the release manifests carry the domains, and the app record's domain column is "none".
export function hostOf(input) {
  const q = input.trim();
  if (!/^\S+\.\S+$/.test(q) || /^[0-9a-f]{64}$/i.test(q)) return null;
  try {
    const host = new URL(/^[a-z]+:\/\//i.test(q) ? q : `https://${q}`).hostname;
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) && !/^sha256-/i.test(q) ? host : null;
  } catch {
    return null;
  }
}

// Every lookup runs at once. Each hit names its app, and each app is listed once, with how it was found.
// `extra` adds the site lookups: appForDomain(host) -> app name or null (the Hydra API), and
// observed(host) -> true when the indexer has seen the site. A site nobody published but the indexer
// watches comes back as one { site } hit. A failing lookup counts as no answer, not as an error.
export async function search(input, find, extra = {}) {
  const host = hostOf(input);
  const quiet = async (f, ...a) => {
    try {
      return await f?.(...a);
    } catch {
      return null;
    }
  };
  const [rows, domainApp] = await Promise.all([
    Promise.all(lookups(input).map(async (l) => (await find(l.schema, l.field, l.value)).map((e) => ({ e, l })))),
    host ? quiet(extra.appForDomain, host) : null,
  ]);
  const byApp = new Map();
  if (domainApp) byApp.set(domainApp, { app: String(domainApp), via: "domain" });
  for (const { e, l } of rows.flat()) {
    const app = e.$attributes?.app?.value;
    if (app && !byApp.has(app)) byApp.set(app, { app: String(app), via: l.via, key: e.$key, schema: l.schema });
  }
  const hits = [...byApp.values()];
  if (!hits.length && host && (await quiet(extra.observed, host))) return [{ site: host, via: "domain", observed: true }];
  return hits;
}
