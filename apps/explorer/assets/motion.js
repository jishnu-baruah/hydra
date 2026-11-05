// Motion for every explorer page: Lenis smooth scroll (the interface template's settings),
// sections that rise into view, rows that cascade in as Arkiv data arrives, and a top bar that
// lifts once the page scrolls. Page-to-page cross-fades are CSS (hydra.css, @view-transition).
// Under prefers-reduced-motion none of this runs, and nothing is ever hidden without JS.
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

if (!still) {
  const root = document.documentElement;
  root.classList.add("js-reveal");

  // Sections rise in as they enter the viewport.
  const RISE = ".reveal, .hero > *, .section-head, .filters, .find, .table-wrap, .unpublished, .stepper, .panel";
  const seen = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("in");
        seen.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px" },
  );
  const watch = (el) => {
    if (el.classList.contains("in")) return;
    el.classList.add("reveal");
    seen.observe(el);
  };
  document.querySelectorAll(RISE).forEach(watch);

  // Rows from Arkiv cascade in, 35 ms apart, the first 14 of each batch. A list cascades on its
  // first fill only; after that (the events feed refreshes every minute) only rows marked new do.
  const ROWS = "tbody tr, .feed > li, .results > li, .rows > li";
  new MutationObserver((records) => {
    let i = 0;
    const filled = new Set();
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (!(n instanceof Element)) continue;
        for (const row of [n, ...n.querySelectorAll(ROWS)].filter((x) => x.matches(ROWS))) {
          const list = row.parentElement;
          if (list?.dataset.cascaded && !row.classList.contains("new")) continue;
          filled.add(list);
          row.style.setProperty("--i", String(Math.min(i++, 14)));
          row.classList.add("cascade");
        }
        if (n.matches(RISE)) watch(n);
        n.querySelectorAll?.(RISE).forEach(watch);
      }
    }
    for (const list of filled) if (list) list.dataset.cascaded = "1";
  }).observe(document.body, { childList: true, subtree: true });

  // The top bar lifts off the page once it scrolls.
  const lift = () => root.classList.toggle("scrolled", scrollY > 8);
  addEventListener("scroll", lift, { passive: true });
  lift();

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
