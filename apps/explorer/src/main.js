// Two views: the newest Hydra releases (home), and one Arkiv entity (?key=0x...).
// Everything read from Arkiv is data: it goes into the page with textContent, never innerHTML.
const $ = (id) => document.getElementById(id);
const status = (text, error = false) => {
  $("status").textContent = text;
  $("status").className = error ? "error" : "";
};

function el(tag, text, attrs = {}) {
  const node = Object.assign(document.createElement(tag), attrs);
  if (text !== undefined) node.textContent = text;
  return node;
}

function table(head, rows) {
  const wrap = el("div", undefined, { className: "table-wrap" });
  const t = wrap.appendChild(el("table"));
  const tr = t.createTHead().insertRow();
  for (const h of head) tr.append(el("th", h));
  const body = t.createTBody();
  for (const cells of rows) {
    const r = body.insertRow();
    for (const c of cells) r.insertCell().append(c);
  }
  return wrap;
}

// An Arkiv attribute is { type, value }. A schemaless read returns bytes as a 0x hex string, so
// they are shown by size, not dumped.
function show(attr) {
  if (!attr) return "";
  const { type, value } = attr;
  if (type === "bytes") return `${typeof value === "string" ? (value.length - 2) / 2 : value.length} bytes`;
  if (!type) return String(value);
  const out = document.createDocumentFragment();
  out.append(String(value), el("span", type, { className: "type" }));
  return out;
}
const when = (attr) => (attr ? new Date(Number(attr.value)).toISOString() : "");
const val = (attr) => (attr ? String(attr.value) : "");
const keyLink = (key) => el("a", key, { href: `?key=${encodeURIComponent(key)}` });

async function home(arkiv) {
  const releases = await arkiv.latestReleases();
  if (releases.length === 0) {
    status(
      "No Hydra releases on Arkiv yet. Once a team publishes through the API they appear here. " +
        "To view any Arkiv record now, open this page with ?key=<entity key>.",
    );
    return;
  }
  const a = (e) => e.$attributes ?? {};
  $("view").append(
    table(
      ["App", "Version", "Commit", "Published", "Files", "Swarm ref", "Entity"],
      releases.map((e) => [
        val(a(e).app),
        val(a(e).version),
        val(a(e).commit),
        when(a(e).published_at),
        val(a(e).file_count),
        val(a(e).swarm_ref),
        keyLink(e.$key),
      ]),
    ),
  );
  status(`${releases.length} release(s), newest first.`);
}

async function one(arkiv, key) {
  document.body.classList.add("is-entity");
  $("title").textContent = "Arkiv entity";
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    status(`"${key}" is not an entity key. A key is 0x followed by 64 hex characters.`, true);
    return;
  }
  const e = await arkiv.entity(key);
  const attrs = Object.entries(e.$attributes ?? {}).sort(([x], [y]) => x.localeCompare(y));
  $("view").append(
    table(["Field", "Value"], [
      ["Key", e.$key ?? key],
      ["Owner", e.$owner ?? ""],
      ["Created at block", String(e.$createdAt ?? "")],
      ["Expires at block", String(e.$expiresAt ?? "")],
    ]),
    el("h2", `Attributes (${attrs.length})`),
    table(["Name", "Value"], attrs.map(([k, v]) => [k, show(v)])),
  );
  status(`Read live from Arkiv Rabdi in ${Math.round(performance.now())} ms, no backend.`);
}

let arkiv;
try {
  arkiv = await import("./arkiv.js");
  const key = new URLSearchParams(location.search).get("key");
  await (key ? one(arkiv, key) : home(arkiv));
  document.body.dataset.renderedMs = Math.round(performance.now());
} catch (err) {
  status(
    arkiv
      ? `Could not read Arkiv: ${arkiv.rootCause(err)}. Reload; if it persists, the Rabdi RPC may be rate limiting this address.`
      : `Could not load the Arkiv SDK from cdn.jsdelivr.net (${err.message}). Check that the CDN is reachable from this network, then reload.`,
    true,
  );
  document.body.dataset.renderedMs = "error";
}
