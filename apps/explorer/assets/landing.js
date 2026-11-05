// Landing page: the hero's example check. Smooth scroll and reveals are in motion.js, shared by
// every page. Under prefers-reduced-motion the hero shows its final state.
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

// The hero panel: an example of Hydra checking a page's scripts, then catching one change.
// Example data only; it never claims to be a real site.
const FILES = ["/index.html", "/assets/app.3f9c.js", "/assets/vendor.a12e.js", "/assets/wallet.77d0.js", "/assets/chart.c4b1.js", "cdn.vendor.example/rum.js"];
const HEX = "0123456789abcdef";
const hex = (n) => Array.from({ length: n }, () => HEX[(Math.random() * 16) | 0]).join("");
const short = () => `${hex(6)}..${hex(4)}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// The loop only runs while someone can see it: tab visible and panel on screen.
let onScreen = true;
const visible = async () => {
  while (document.hidden || !onScreen) await wait(400);
};

const scan = document.querySelector(".scan");
if (scan) {
  const rows = scan.querySelector(".rows");
  new IntersectionObserver(([e]) => (onScreen = e.isIntersecting)).observe(scan);
  const set = (state, badge, label, text) => {
    scan.dataset.state = state;
    scan.querySelector(".badge").textContent = badge;
    scan.querySelector(".v-state").textContent = label;
    scan.querySelector(".v-text").textContent = text;
  };
  const row = (path) => {
    const li = document.createElement("li");
    for (const [cls, text] of [["path", path], ["hash", short()], ["ok", ""]]) {
      li.append(Object.assign(document.createElement("span"), { className: cls, textContent: text }));
    }
    rows.append(li);
    return li;
  };
  // Flip a hash through random values before it settles, like the template's split-flap.
  const flip = async (el, ms) => {
    await visible();
    for (let t = 0; t < ms; t += 50) {
      el.textContent = short();
      await wait(50);
    }
  };
  const matched = `${FILES.length} of ${FILES.length} scripts in the release`;

  if (still) {
    for (const p of FILES) row(p).querySelector(".ok").textContent = "OK";
    set("green", "OK", "Match", matched);
  } else {
    (async () => {
      for (;;) {
        await visible();
        rows.replaceChildren();
        set("scan", "..", "Checking", "Hashing what this page loaded");
        for (const p of FILES) {
          const li = row(p);
          requestAnimationFrame(() => li.classList.add("on"));
          await flip(li.querySelector(".hash"), 300);
          li.querySelector(".ok").textContent = "OK";
        }
        set("green", "OK", "Match", matched);
        await wait(2600);
        const bad = rows.children[1];
        await flip(bad.querySelector(".hash"), 500);
        bad.classList.add("bad");
        bad.querySelector(".ok").textContent = "NEW";
        set("red", "!", "Changed", "app.3f9c.js is in no release. Do not sign.");
        await wait(3600);
      }
    })();
  }
}

// How it works: vertical scroll inside the pinned section moves the track sideways, so the page
// never scrolls horizontally. Only on wide screens without reduced motion; CSS stacks it otherwise.
const hs = document.querySelector(".hscroll");
if (hs) {
  const track = hs.querySelector(".hs-track");
  const bar = hs.querySelector(".hs-bar");
  const wide = matchMedia("(min-width: 761px) and (prefers-reduced-motion: no-preference)");
  let ticking = false;
  const update = () => {
    ticking = false;
    if (!wide.matches) return;
    const travel = hs.offsetHeight - innerHeight;
    const p = Math.min(1, Math.max(0, -hs.getBoundingClientRect().top / Math.max(1, travel)));
    const distance = Math.max(0, track.scrollWidth - innerWidth);
    track.style.transform = `translate3d(${-p * distance}px, 0, 0)`;
    bar.style.setProperty("--p", p.toFixed(4));
  };
  const onScroll = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  };
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll);
  wide.addEventListener("change", () => {
    track.style.transform = "";
    onScroll();
  });
  update();
}
