// ─────────────────────────────────────────────────────────────
// celebrate.js
// Fireworks + a heart shower on your special days (anniversary, birthdays),
// plus a banner under the title for the whole day — tap it to replay.
//
// The days come from config.celebrations. On the GitHub-built site that's the
// WHM_CELEBRATIONS env var in Netlify (scripts/write-config.mjs), so the dates
// stay out of the public repo. A settings screen can later write the same
// shape.
//
//   celebrations: [
//     { date: "2023-02-14", title: "happy {years}-year anniversary ♡" }, // every Feb 14
//     { date: "06-01",      title: "happy birthday ♡" }                  // every Jun 1
//   ]
//
// "YYYY-MM-DD" repeats every year on that month/day; the year is only used for
// {years}. Matching uses the viewer's local date. Feb 29 days are celebrated
// on Feb 28 in other years.
//
// Preview any day: add ?celebrate to the URL (or ?celebrate=02-14 for a
// specific entry). Only runs for a signed-in, paired couple.
// ─────────────────────────────────────────────────────────────
import { spawnHeartsAt } from "./effects.js";

// On-palette (shared.css tokens) — saturated enough to read on the cream page.
const COLORS = ["#4F6E4A", "#C2882F", "#B96B49", "#7C5680", "#3F7A77", "#E08A7A"];
// The default heart colours include white/blush for the dark video stage;
// on the cream page those vanish, so the shower uses the stronger warm ones.
const HEART_COLORS = ["#E08A7A", "#B96B49", "#C2882F", "#7C5680"];
const SHOW_MS = 7000;

let shownThisLoad = false;
let running = false;

function parseDay(s) {
  const m = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const month = +m[2], day = +m[3];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year: m[1] ? +m[1] : null, month, day };
}

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

function describe(entry, p, year) {
  const years = p.year ? year - p.year : null;
  const title = String((entry && entry.title) || "happy day ♡")
    .replace(/\{years\}/g, years && years > 0 ? String(years) : "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return { title, years };
}

// The celebration for this date, or null.
export function celebrationFor(list, now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate();
  for (const entry of Array.isArray(list) ? list : []) {
    const p = parseDay(entry && entry.date);
    if (!p) continue;
    const day = (p.month === 2 && p.day === 29 && !isLeap(y)) ? 28 : p.day;
    if (p.month === m && day === d) return describe(entry, p, y);
  }
  return null;
}

function previewFor(list) {
  const q = new URLSearchParams(location.search);
  if (!q.has("celebrate")) return null;
  const want = parseDay(q.get("celebrate"));
  const year = new Date().getFullYear();
  for (const entry of Array.isArray(list) ? list : []) {
    const p = parseDay(entry && entry.date);
    if (p && (!want || (p.month === want.month && p.day === want.day))) return describe(entry, p, year);
  }
  return { title: "happy day ♡ (preview)", years: null };
}

// Call once the couple is signed in and paired; runs at most once per load.
export function celebrateIfToday() {
  if (shownThisLoad) return;
  const list = (window.WHM_CONFIG && window.WHM_CONFIG.celebrations) || [];
  const c = previewFor(list) || celebrationFor(list);
  if (!c) return;
  shownThisLoad = true;
  const banner = document.getElementById("cel-banner");
  if (banner) {
    banner.querySelector(".cel-banner-text").textContent = c.title;
    banner.hidden = false;
    banner.onclick = runShow;
  }
  runShow();
}

// Signed out: take the banner down; the next sign-in may celebrate again.
export function resetCelebration() {
  shownThisLoad = false;
  const banner = document.getElementById("cel-banner");
  if (banner) banner.hidden = true;
}

function runShow() {
  // Reduced-motion viewers get the banner only (shared.css flattens animations anyway).
  if (running || (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
  running = true;
  const layer = document.createElement("div");
  layer.className = "cel-layer";
  layer.setAttribute("aria-hidden", "true");
  document.body.appendChild(layer);

  const t0 = performance.now();
  const hearts = setInterval(() => {
    if (performance.now() - t0 > SHOW_MS) { clearInterval(hearts); return; }
    spawnHeartsAt(layer, 5 + Math.random() * 90, 60 + Math.random() * 35, 4, HEART_COLORS);
  }, 320);

  fireworks(layer, SHOW_MS, () => {
    clearInterval(hearts);
    setTimeout(() => { layer.remove(); running = false; }, 2600); // let the last hearts finish
  });
}

// Rockets rise to a random height, burst into sparks that fall and fade.
// Plain canvas, no library; stops itself when the last spark is gone.
function fireworks(host, durationMs, onDone) {
  const canvas = document.createElement("canvas");
  canvas.className = "cel-canvas";
  host.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0;
  const fit = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  fit();
  window.addEventListener("resize", fit);

  const G = 380;                 // gravity, px/s²
  const rockets = [], sparks = [];
  const start = performance.now();
  let last = start, nextLaunch = start;

  const pick = () => COLORS[(Math.random() * COLORS.length) | 0];
  const dot = (x, y, r, color, alpha) => {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };

  function launch(now) {
    const apex = H * (0.12 + Math.random() * 0.3);
    rockets.push({
      x: W * (0.15 + Math.random() * 0.7), y: H,
      vx: (Math.random() - 0.5) * 80,
      vy: -Math.sqrt(2 * G * (H - apex)),   // just enough to reach the apex
      color: pick(),
    });
    nextLaunch = now + 320 + Math.random() * 480;
  }

  function burst(r) {
    const n = 48 + ((Math.random() * 32) | 0);
    const speed = 110 + Math.random() * 130;
    const second = pick();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.25;
      const s = speed * (0.55 + Math.random() * 0.5);
      sparks.push({
        x: r.x, y: r.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 1, decay: 0.55 + Math.random() * 0.35,
        color: Math.random() < 0.25 ? second : r.color,
      });
    }
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (now - start < durationMs && now >= nextLaunch) launch(now);

    // Fade what's already drawn instead of clearing — gives the trails, and
    // keeps the canvas transparent over the page.
    ctx.globalCompositeOperation = "destination-out";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";

    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      r.vy += G * dt; r.x += r.vx * dt; r.y += r.vy * dt;
      dot(r.x, r.y, 2.4, r.color, 1);
      if (r.vy >= 0) { burst(r); rockets.splice(i, 1); }
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.vx *= 0.985;
      s.vy = s.vy * 0.985 + G * 0.35 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      s.life -= s.decay * dt;
      if (s.life <= 0) { sparks.splice(i, 1); continue; }
      dot(s.x, s.y, 2, s.color, s.life);
    }
    ctx.globalAlpha = 1;

    if (now - start < durationMs || rockets.length || sparks.length) {
      requestAnimationFrame(frame);
    } else {
      window.removeEventListener("resize", fit);
      canvas.remove();
      if (onDone) onDone();
    }
  }
  requestAnimationFrame(frame);
}
