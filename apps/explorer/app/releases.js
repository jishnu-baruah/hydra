// Which releases of an app to trust, and in what order. Same rule as apps/api/src/reads.ts: an app
// belongs to the publisher of its earliest hydra.app record, and releases by anyone else are
// dropped. Pure, so it runs in the page and under `node --test`.

export const GATEWAY = "https://api.gateway.ethswarm.org";

const val = (e, k) => e.$attributes?.[k]?.value;

export function ownerOf(appRows) {
  const sorted = [...appRows].sort((a, b) => Number(val(a, "created_at") ?? 0) - Number(val(b, "created_at") ?? 0));
  return sorted.length ? String(val(sorted[0], "publisher")).toLowerCase() : null;
}

// The manifest sits next to the build in one Swarm collection. The gateway serves JSON but not
// HTML, so the link opens the manifest. A ref that is not 64 or 128 hex ("pending") gets no link.
export function swarmUrl(ref) {
  return /^([0-9a-f]{64}|[0-9a-f]{128})$/.test(String(ref)) ? `${GATEWAY}/bzz/${ref}/hydra-manifest.json` : null;
}

export function trustedReleases(appRows, releaseRows) {
  const owner = ownerOf(appRows);
  if (!owner) return [];
  return releaseRows
    .filter((e) => String(val(e, "publisher")).toLowerCase() === owner)
    .map((e) => ({
      key: e.$key,
      version: String(val(e, "version") ?? ""),
      commit: String(val(e, "commit") ?? ""),
      publishedAt: Number(val(e, "published_at") ?? 0),
      fileCount: Number(val(e, "file_count") ?? 0),
      swarmRef: String(val(e, "swarm_ref") ?? ""),
      swarmUrl: swarmUrl(val(e, "swarm_ref")),
    }))
    .sort((a, b) => b.publishedAt - a.publishedAt);
}
