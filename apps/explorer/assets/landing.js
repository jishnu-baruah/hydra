// Landing page: Lenis smooth scroll (settings from the interface template), scroll reveals and
// the example badge. Under prefers-reduced-motion there is no smooth scroll and no reveal.
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

if (!still) {
  document.documentElement.classList.add("js-reveal");
  const seen = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("in");
        seen.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -10% 0px" },
  );
  document.querySelectorAll(".reveal").forEach((el) => seen.observe(el));

  // If the CDN is unreachable the page still scrolls natively.
  import("https://cdn.jsdelivr.net/npm/lenis@1.3.15/dist/lenis.mjs")
    .then(({ default: Lenis }) => {
      const lenis = new Lenis({
        duration: 1.2,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        smoothWheel: true,
        anchors: { offset: -56 },
      });
      const raf = (time) => {
        lenis.raf(time);
        requestAnimationFrame(raf);
      };
      requestAnimationFrame(raf);
    })
    .catch(() => {});
}

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
