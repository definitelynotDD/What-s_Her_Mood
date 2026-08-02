// ─────────────────────────────────────────────────────────────
// effects.js — client-only delight: confetti + floating hearts.
//
// Both spawners share the pattern: create N absolutely-positioned children
// inside a host, run a CSS animation, remove after the anim finishes.
// The animations themselves live in shared.css (@keyframes confetti, floatUp).
// ─────────────────────────────────────────────────────────────

const CONFETTI_COLORS = ["#4F6E4A", "#C2882F", "#B96B49", "#7C5680", "#3F7A77", "#E08A7A"];
const HEART_COLORS    = ["#E08A7A", "#B96B49", "#F3DDD0", "#ffffff"];

const rand = (a, b) => a + Math.random() * (b - a);

// Spawn a confetti burst inside `host`, centered on `origin` (a DOM element,
// typically the checkbox that just toggled). host must be position:relative;
// pointer-events:none is applied to each piece.
export function spawnConfetti(host, origin, count = 22) {
  if (!host) return;
  const hostRect   = host.getBoundingClientRect();
  const originRect = origin ? origin.getBoundingClientRect() : hostRect;
  const cx = ((originRect.left + originRect.width  / 2) - hostRect.left) / hostRect.width  * 100;
  const cy = ((originRect.top  + originRect.height / 2) - hostRect.top ) / hostRect.height * 100;

  const layer = ensureLayer(host, "wm-confetti-layer");
  const pieces = [];
  for (let i = 0; i < count; i++) {
    const el = document.createElement("span");
    el.className = "wm-confetti";
    const round = Math.random() > 0.5;
    Object.assign(el.style, {
      left: `${cx + rand(-2, 2)}%`,
      top:  `${cy}%`,
      width:  `${rand(6, 11)}px`,
      height: `${rand(6, 14)}px`,
      background: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
      borderRadius: round ? "50%" : "2px",
    });
    el.style.setProperty("--dx",  `${rand(-140, 140)}px`);
    el.style.setProperty("--dy",  `${rand(80, 320)}px`);
    el.style.setProperty("--rot", `${rand(-360, 360)}deg`);
    layer.appendChild(el);
    pieces.push(el);
  }
  setTimeout(() => pieces.forEach((p) => p.remove()), 1300);
}

// Spawn floating hearts inside `host` from the pointer x. Used on hangout stage.
export function spawnHearts(host, event, count = 6) {
  if (!host) return;
  const rect = host.getBoundingClientRect();
  const clientX =
    (event && event.clientX != null) ? event.clientX :
    (event && event.touches && event.touches[0] ? event.touches[0].clientX : rect.left + rect.width / 2);
  const xPct = Math.max(4, Math.min(96, ((clientX - rect.left) / rect.width) * 100));

  const layer = ensureLayer(host, "wm-hearts-layer");
  const spawns = [];
  for (let i = 0; i < count; i++) {
    const el = document.createElement("span");
    el.className = "wm-heart";
    el.textContent = "♡";
    Object.assign(el.style, {
      left: `${Math.max(4, Math.min(96, xPct + rand(-5, 5)))}%`,
      fontSize: `${rand(20, 42)}px`,
      color: HEART_COLORS[(Math.random() * HEART_COLORS.length) | 0],
    });
    el.style.setProperty("--drift", `${rand(-70, 70)}px`);
    el.style.setProperty("--r",     `${rand(-20, 20)}deg`);
    layer.appendChild(el);
    spawns.push(el);
  }
  setTimeout(() => spawns.forEach((h) => h.remove()), 2500);
}

function ensureLayer(host, cls) {
  let layer = host.querySelector(":scope > ." + cls);
  if (!layer) {
    layer = document.createElement("div");
    layer.className = cls;
    host.appendChild(layer);
  }
  return layer;
}
