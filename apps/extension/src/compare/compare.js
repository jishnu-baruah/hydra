// The extension's verdict for one page: compare the scripts the browser loaded with the release
// manifest. Pure, so it runs in the service worker and under `node --test`.
//
// Same origin: matched by path (the query string is dropped), against manifest.files.
// Other origins: matched by exact URL, against manifest.scripts (vendor scripts hashed at publish).
// Hashes are "sha256-<hex>" in the manifest and bare hex from the worker.

// Cloudflare injects a bot check with a fresh body on every request (spike F3: every unstable
// script on 5 live dApps was one of these). The host adds it, not the build, so it is not judged.
const HOST_INJECTED = /^\/cdn-cgi\/challenge-platform\//;

export function compare(manifest, origin, scripts) {
  const out = { verdict: "grey", mismatches: [], matched: 0, ignored: 0 };
  if (!manifest) return out;
  for (const s of scripts) {
    const u = new URL(s.url);
    const same = u.origin === origin;
    if (same && HOST_INJECTED.test(u.pathname)) {
      out.ignored++;
      continue;
    }
    // A script we could not read back cannot be vouched for.
    if (s.error) {
      out.mismatches.push({ url: s.url, kind: "unreadable" });
      continue;
    }
    const want = same ? manifest.files?.[u.pathname] : manifest.scripts?.[s.url];
    if (!want) out.mismatches.push({ url: s.url, kind: "extra" });
    else if (want !== `sha256-${s.sha256}`) out.mismatches.push({ url: s.url, kind: "changed" });
    else out.matched++;
  }
  out.verdict = out.mismatches.length ? "red" : "green";
  return out;
}
