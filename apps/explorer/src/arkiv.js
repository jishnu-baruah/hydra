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

const client = createPublicClient({ chain: rabdi({ accessKey: "" }), transport: http() });

// Newest Hydra releases. Queried by the schema tag rather than through packages/core, so the
// explorer has no build step; the tag name is ReleaseSchema's in packages/core/src/records.ts.
export async function latestReleases(limit = 20) {
  const page = await client
    .select({ $key: true, $owner: true, $attributes: true })
    .where(eq("arkiv.schema", "hydra.release"))
    .orderBy(desc("published_at", "u64"))
    .limit(limit)
    .fetch();
  return page.entities;
}

export const entity = (key) => client.getEntity(key);

// Hydra entities of one schema whose indexed `field` equals `value`. Used by search.
// Not yet filtered by owner: anyone can write a hydra.* tag. Add .ownedBy(<API wallet>) once
// OP-1 gives the wallet an address, before real data is shown as on record.
export async function find(schema, field, value, limit = 100) {
  const page = await client
    .select({ $key: true, $attributes: true })
    .where(and(eq("arkiv.schema", schema), eq(field, value)))
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
