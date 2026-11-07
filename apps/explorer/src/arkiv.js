// Read-only Arkiv client for the browser. No key, no wallet: the explorer never signs.
// Every module comes from one CDN at one pinned version. Mixing esm.sh and jsdelivr copies of the
// SDK broke queries with "Cannot read properties of undefined (reading 'slice')".
const SDK = "https://cdn.jsdelivr.net/npm/@arkiv-network/sdk@1.0.1";

const [{ createPublicClient }, { rabdi }, { and, eq, desc }, { http }] = await Promise.all([
  import(`${SDK}/+esm`),
  import(`${SDK}/chains/+esm`),
  import(`${SDK}/query/+esm`),
  import("https://cdn.jsdelivr.net/npm/viem@2.21.0/+esm"),
]);

export const EXPLORER = "https://rabdi.explorer.arkiv.network";

// Arkiv is Hydra's public record. Every release, file hash, app-name claim and indexer check is an
// Arkiv entity on Rabdi: the Hydra API writes them, and this client reads them straight from the
// visitor's browser, with no Hydra server in between. Each release also carries the Swarm reference
// of its build manifest, so anyone can rebuild the check from Arkiv and Swarm alone.
const client = createPublicClient({ chain: rabdi({ accessKey: "" }), transport: http() });

// Anyone can write an entity tagged hydra.*, so every read keeps only what the Hydra API wrote:
// entities created by its publisher wallet (GET /health on the API reports it). Same trust rule
// as apps/api/src/reads.ts.
export const PUBLISHER = "0xdD0d4167959291A2eb930Fe82Fed58070134348b";

// Observations come from the indexer's own wallet (packages/indexer), and only from it.
export const INDEXER = "0xc4e52D70880a83331E1cCd0AD745059D12565ea9";

// Newest Hydra releases. Queried by the schema tag rather than through packages/core, so the
// explorer has no build step; the tag name is ReleaseSchema's in packages/core/src/records.ts.
export async function latestReleases(limit = 20) {
  const page = await client
    .select({ $key: true, $owner: true, $attributes: true })
    .where(eq("arkiv.schema", "hydra.release"))
    .createdBy(PUBLISHER)
    .orderBy(desc("published_at", "u64"))
    .limit(limit)
    .fetch();
  return page.entities;
}

export const entity = (key) => client.getEntity(key);

// App name claims: the hydra.app records the publisher wallet wrote when it issued a key.
export async function latestApps(limit = 100) {
  const page = await client
    .select({ $key: true, $attributes: true })
    .where(eq("arkiv.schema", "hydra.app"))
    .createdBy(PUBLISHER)
    .orderBy(desc("created_at", "u64"))
    .limit(limit)
    .fetch();
  return page.entities;
}

// One site's indexer observations, newest first.
export async function observationsFor(domain, limit = 100) {
  const page = await client
    .select({ $key: true, $attributes: true })
    .where(and(eq("arkiv.schema", "hydra.observation"), eq("domain", domain)))
    .createdBy(INDEXER)
    .orderBy(desc("observed_at", "u64"))
    .limit(limit)
    .fetch();
  return page.entities;
}

// Newest indexer observations. Each lives 3 days, so this is the recent record of every site.
export async function latestObservations(limit = 100) {
  const page = await client
    .select({ $key: true, $attributes: true })
    .where(eq("arkiv.schema", "hydra.observation"))
    .createdBy(INDEXER)
    .orderBy(desc("observed_at", "u64"))
    .limit(limit)
    .fetch();
  return page.entities;
}

// Checks of integrated sites only (compared with a release: match or mismatch). The latest 100 of all
// checks are mostly coverage sites, so a bound site checked less often would fall out of that window.
export async function boundObservations(limit = 100) {
  const one = (s) =>
    client
      .select({ $key: true, $attributes: true })
      .where(and(eq("arkiv.schema", "hydra.observation"), eq("status", s)))
      .createdBy(INDEXER)
      .orderBy(desc("observed_at", "u64"))
      .limit(limit)
      .fetch()
      .then((p) => p.entities);
  return (await Promise.all([one("match"), one("mismatch")])).flat();
}

// Hydra entities of one schema whose indexed `field` equals `value`, written by the publisher.
export async function find(schema, field, value, limit = 100) {
  const page = await client
    .select({ $key: true, $attributes: true })
    .where(and(eq("arkiv.schema", schema), eq(field, value)))
    .createdBy(PUBLISHER)
    .limit(limit)
    .fetch();
  return page.entities;
}

// viem nests the useful message several causes deep.
export function rootCause(err) {
  let e = err;
  while (e?.cause) e = e.cause;
  return e?.message ?? String(err);
}

// The app's ENS link (T-A36): the newest hydra.ens row the API wrote after checking the name on chain,
// or null. { name, resolver }.
export async function ensLink(app) {
  const rows = await find("hydra.ens", "app", app);
  const latest = rows
    .map((e) => Object.fromEntries(Object.entries(e.$attributes ?? {}).map(([k, v]) => [k, v?.value])))
    .filter((a) => a.app === app && typeof a.name === "string")
    .sort((x, y) => Number(y.created_at ?? 0) - Number(x.created_at ?? 0))[0];
  return latest ? { name: latest.name, resolver: String(latest.resolver ?? "") } : null;
}

// Every hydra.ens link the publisher wrote, newest first (raw entities; status/apps/model.js picks one per app).
export async function ensLinks(limit = 100) {
  const page = await client
    .select({ $key: true, $attributes: true })
    .where(eq("arkiv.schema", "hydra.ens"))
    .createdBy(PUBLISHER)
    .orderBy(desc("created_at", "u64"))
    .limit(limit)
    .fetch();
  return page.entities;
}
