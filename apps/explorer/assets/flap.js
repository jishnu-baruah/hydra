// Split-flap reveal for [data-flap] headings, after the interface template: each letter cycles
// through a few characters and settles, left to right. Off under prefers-reduced-motion.
// Screen readers get the final text at once through aria-label.
const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
  for (const el of document.querySelectorAll("[data-flap]")) {
    const final = el.textContent;
    el.setAttribute("aria-label", final);
    const start = performance.now();
    const step = (now) => {
      const t = now - start;
      let done = true;
      el.textContent = [...final]
        .map((ch, i) => {
          if (ch === " " || t > 120 + i * 45) return ch;
          done = false;
          return CHARS[Math.floor(Math.random() * CHARS.length)];
        })
        .join("");
      if (!done) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}
