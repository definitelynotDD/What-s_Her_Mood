// ─────────────────────────────────────────────────────────────
// mascot.js — the round sage-sprout mascot.
//
// Only circles + a leaf oval. No external image. Wrapper 120×120 with a
// swaying animation; each sub-element has its own tiny loop (leafWiggle,
// blink). Reduced-motion viewers get the still pose via the media query
// in shared.css.
//
// Usage:
//   mountMascot(document.querySelector("#some-host"), { scale: 0.55 });
// Idempotent — clears the host and re-stamps the DOM tree each call.
// ─────────────────────────────────────────────────────────────

const HTML = `
<div class="mascot" style="--mascot-scale:1">
  <div class="mascot-leaf"></div>
  <div class="mascot-body"></div>
  <div class="mascot-cheek mascot-cheek-l"></div>
  <div class="mascot-cheek mascot-cheek-r"></div>
  <div class="mascot-eye mascot-eye-l"></div>
  <div class="mascot-eye mascot-eye-r"></div>
  <div class="mascot-mouth"></div>
</div>`;

export function mountMascot(host, opts = {}) {
  if (!host) return null;
  host.innerHTML = HTML;
  const el = host.firstElementChild;
  const scale = opts.scale != null ? opts.scale : 1;
  el.style.setProperty("--mascot-scale", String(scale));
  return el;
}
