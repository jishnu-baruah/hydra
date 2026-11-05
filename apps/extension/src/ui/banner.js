// The red warning shown inside the page. background.js runs showBanner in the page's isolated
// world with chrome.scripting.executeScript, which serializes the function, so it must use
// nothing from outside its own body. `view` is present()'s output, or null to remove the banner.
//
// The page is the party we distrust, so: a closed shadow root (page scripts cannot read or rewrite
// the text), inline !important positioning (page CSS cannot hide the host), re-attached if the
// page removes it, and every string set with textContent. A hostile page can still fight the
// banner; the toolbar badge and the popup are the surfaces it cannot touch.
export function showBanner(view) {
  const KEY = "__hydraBanner";
  const old = globalThis[KEY];
  if (old) {
    old.observer.disconnect();
    old.host.remove();
    delete globalThis[KEY];
  }
  if (!view) return;

  const CSS = `
    .box { box-sizing: border-box; max-height: 50vh; overflow: auto; margin: 0; padding: 16px 20px 18px;
      background: #0a0a0a; color: #ededed; border-bottom: 1px solid #2a2a2a; border-left: 4px solid #ff5a4e;
      font: 400 14px/1.55 ui-monospace, "IBM Plex Mono", Consolas, monospace; box-shadow: 0 8px 24px rgb(0 0 0 / 0.45); }
    .top { display: flex; align-items: center; gap: 14px; }
    .mark { display: inline-flex; align-items: center; gap: 8px; font: 700 13px/1 system-ui, sans-serif; letter-spacing: 0.14em; text-transform: uppercase; }
    .mark::before { content: ""; width: 9px; height: 9px; background: #7aa2ff; }
    .state { font: 700 13px/1 system-ui, sans-serif; letter-spacing: 0.14em; text-transform: uppercase; color: #ff5a4e; }
    .close { margin-left: auto; min-width: 44px; min-height: 36px; padding: 0 12px; font: 500 12px ui-monospace, Consolas, monospace;
      letter-spacing: 0.12em; text-transform: uppercase; color: #ededed; background: transparent; border: 1px solid #2a2a2a; cursor: pointer; }
    .close:hover { border-color: #ededed; }
    .close:focus-visible, a:focus-visible { outline: 2px solid #7aa2ff; outline-offset: 2px; }
    .msg { margin: 10px 0 0; font: 600 16px/1.4 system-ui, sans-serif; }
    ul { list-style: none; margin: 10px 0 0; padding: 0; }
    li { display: flex; flex-wrap: wrap; gap: 4px 16px; padding: 5px 0; border-top: 1px solid #1f1f1f; }
    .path { color: #ededed; word-break: break-all; }
    .kind { color: #ff8a80; }
    .more { margin: 6px 0 0; color: #8a8a8a; }
    a { display: inline-block; margin-top: 12px; color: #7aa2ff; text-decoration: none; }
    a:hover { text-decoration: underline; text-underline-offset: 3px; }`;

  const host = document.createElement("hydra-warning");
  for (const [k, v] of Object.entries({ all: "initial", display: "block", position: "fixed", top: "0", left: "0", right: "0", "z-index": "2147483647" })) {
    host.style.setProperty(k, v, "important");
  }
  const root = host.attachShadow({ mode: "closed" });
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  const box = el("div", "box");
  box.setAttribute("role", "alert");
  const top = el("div", "top");
  const close = el("button", "close", "Dismiss");
  close.type = "button";
  close.setAttribute("aria-label", "Dismiss the Hydra warning");
  top.append(el("span", "mark", "Hydra"), el("span", "state", "This site changed"), close);
  box.append(top, el("p", "msg", view.message));
  if (view.items.length) {
    const ul = el("ul");
    for (const item of view.items) {
      const li = el("li");
      li.append(el("span", "path", item.path), el("span", "kind", item.text));
      ul.append(li);
    }
    box.append(ul);
  }
  if (view.more) box.append(el("p", "more", `and ${view.more} more`));
  if (view.link) {
    const a = el("a", "", `${view.link.text} →`);
    a.href = view.link.href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    box.append(a);
  }
  const style = el("style");
  style.textContent = CSS;
  root.append(style, box);
  document.documentElement.append(host);

  // A page can remove the banner. Put it back, a few times, unless the user dismissed it.
  let dismissed = false;
  let puts = 0;
  const observer = new MutationObserver(() => {
    if (!dismissed && !host.isConnected && puts++ < 10) document.documentElement.append(host);
  });
  observer.observe(document.documentElement, { childList: true });
  close.addEventListener("click", () => {
    dismissed = true;
    observer.disconnect();
    host.remove();
  });
  globalThis[KEY] = { host, root, observer };
}
