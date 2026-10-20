// ─────────────────────────────────────────────────────────────
// celebrate.js
// Fireworks + a heart shower on your special days, plus a banner (under the
// title, and in the cozy room) for the whole day — tap it to replay.
//
// The days come from config.celebrations. On the GitHub-built site that's the
// WHM_CELEBRATIONS env var in Netlify (scripts/write-config.mjs), so the dates
// stay out of the public repo. A settings screen can later write the same
// shape.
//
//   celebrations: [
//     // every month on the 21st, counting from 21 Nov 2025, at India midnight
//     { date: "2025-11-21", every: "month", timeZone: "Asia/Kolkata", title: "happy {since} ♡" },
//     // every year on Feb 14, viewer's local date
//     { date: "2023-02-14", title: "happy {years}-year anniversary ♡" },
//   ]
//
//   every     "year" (default) or "month"
//   timeZone  IANA zone whose midnight starts the day; default = the viewer's
//   title     {since} → "11 months" / "1 year" / "1 year 2 months",
//             {months} / {years} → plain numbers. Needs the year in `date`.
//
// Nothing shows before (or on) the start date itself. Days past a month's end
// (e.g. the 31st) land on its last day. While the app is open it watches the
// clock, so the show starts at midnight even in the middle of a call, and the
// banner goes away when the day ends.
//
// Preview any day: add ?celebrate to the URL (or ?celebrate=11-21 for a
// specific entry). Only runs for a signed-in, paired couple.
// ─────────────────────────────────────────────────────────────
import { spawnHeartsAt } from "./effects.js";

// On-palette (shared.css tokens) — saturated enough to read on the cream page.
const COLORS = ["#4F6E4A", "#C2882F", "#B96B49", "#7C5680", "#3F7A77", "#E08A7A"];
// The default heart colours include white/blush for the dark video stage;
// on the cream page those vanish, so the shower uses the stronger warm ones.
const HEART_COLORS = ["#E08A7A", "#B96B49", "#C2882F", "#7C5680"];
const SHOW_MS = 7000;
const FALLBACK_CHECK_MS = 60 * 1000;   // catches sleep/wake and throttled timers

let started = false;
let currentKey = null;      // which celebration the banners show right now
let midnightTimer = null;
let fallbackTimer = null;
let running = false;
let showWaitingForTab = false;

function parseDay(s) {
  const m = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const month = +m[2], day = +m[3];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year: m[1] ? +m[1] : null, month, day };
}

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysInMonth = (y, m) => new Date(y, m, 0).getDate();

// Calendar date + clock in a time zone (or the viewer's own when none/invalid).
function partsIn(timeZone, now) {
  if (timeZone) {
    try {
      const f = new Intl.DateTimeFormat("en-US", {
        timeZone, hourCycle: "h23",
        year: "numeric", month: "numeric", day: "numeric",
        hour: "numeric", minute: "numeric", second: "numeric",
      });
      const p = {};
      for (const { type, value } of f.formatToParts(now)) p[type] = +value;
      return { y: p.year, m: p.month, d: p.day, h: p.hour, min: p.minute, s: p.second };
    } catch (_) { /* unknown zone → fall through to local */ }
  }
  return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate(),
           h: now.getHours(), min: now.getMinutes(), s: now.getSeconds() };
}

function sinceText(months) {
  const y = Math.floor(months / 12), m = months % 12;
  const unit = (n, w) => n + " " + w + (n === 1 ? "" : "s");
  return [y ? unit(y, "year") : "", m ? unit(m, "month") : ""].filter(Boolean).join(" ");
}

function describe(entry, t, months) {
  const fill = (k, v) => (s) => s.replace(new RegExp("\\{" + k + "\\}", "g"), v);
  let title = String((entry && entry.title) || "happy day ♡");
  title = fill("since", months > 0 ? sinceText(months) : "")(title);
  title = fill("months", months > 0 ? String(months) : "")(title);
  title = fill("years", months >= 12 ? String(Math.floor(months / 12)) : "")(title);
  title = title.replace(/\s{2,}/g, " ").trim();
  return { title, key: [t.y, t.m, t.d, title].join("|") };
}

// The celebration for this instant, or null.
export function celebrationFor(list, now = new Date()) {
  for (const entry of Array.isArray(list) ? list : []) {
    const p = parseDay(entry && entry.date);
    if (!p) continue;
    const t = partsIn(entry.timeZone, now);
    if (entry.every === "month") {
      if (t.d !== Math.min(p.day, daysInMonth(t.y, t.m))) continue;
      const months = p.year ? (t.y - p.year) * 12 + (t.m - p.month) : 0;
      if (p.year && months <= 0) continue;               // not before/on the start
      return describe(entry, t, months);
    }
    const day = (p.month === 2 && p.day === 29 && !isLeap(t.y)) ? 28 : p.day;
    if (t.m !== p.month || t.d !== day) continue;
    const years = p.year ? t.y - p.year : 0;
    if (p.year && years <= 0) continue;
    return describe(entry, t, years * 12);
  }
  return null;
}

function previewFor(list) {
  const q = new URLSearchParams(location.search);
  if (!q.has("celebrate")) return null;
  const want = parseDay(q.get("celebrate"));
  for (const entry of Array.isArray(list) ? list : []) {
    const p = parseDay(entry && entry.date);
    if (!p || (want && (p.day !== want.day || (entry.every !== "month" && p.month !== want.month)))) continue;
    // Pretend it's the next real occurrence so {since} reads sensibly.
    const t = partsIn(entry.timeZone, new Date());
    const months = p.year ? Math.max(1, (t.y - p.year) * 12 + (t.m - p.month)) : 0;
    return { ...describe(entry, t, entry.every === "month" ? months : Math.max(12, months - (months % 12))), key: "preview" };
  }
  return { title: "happy day ♡ (preview)", key: "preview" };
}

const list = () => (window.WHM_CONFIG && window.WHM_CONFIG.celebrations) || [];

// Call once the couple is signed in and paired (safe to call repeatedly).
export function startCelebrations() {
  if (started) return;
  started = true;
  check();
  armMidnightTimer();
  fallbackTimer = setInterval(check, FALLBACK_CHECK_MS);
}

// Signed out: banners down, timers off.
export function stopCelebrations() {
  started = false;
  currentKey = null;
  clearTimeout(midnightTimer);
  clearInterval(fallbackTimer);
  setBanners(null);
}

function check() {
  if (!started) return;
  const c = previewFor(list()) || celebrationFor(list());
  const key = c ? c.key : null;
  if (key === currentKey) return;
  currentKey = key;
  setBanners(c);
  if (c) runShow();          // app opened on the day, or the day just began
}

function setBanners(c) {
  document.querySelectorAll("[data-cel-banner]").forEach((b) => {
    b.hidden = !c;
    if (!c) return;
    b.querySelector(".cel-banner-text").textContent = c.title;
    b.onclick = runShow;
  });
}

// Wake up right after the next midnight in any configured zone (and locally).
function armMidnightTimer() {
  clearTimeout(midnightTimer);
  const now = new Date();
  const zones = new Set([""]);
  list().forEach((e) => zones.add((e && e.timeZone) || ""));
  let wait = Infinity;
  zones.forEach((tz) => {
    const t = partsIn(tz, now);
    const sinceMidnight = ((t.h * 60 + t.min) * 60 + t.s) * 1000 + now.getMilliseconds();
    wait = Math.min(wait, 24 * 3600 * 1000 - sinceMidnight);
  });
  midnightTimer = setTimeout(() => { check(); armMidnightTimer(); }, Math.max(250, wait + 250));
}

function runShow() {
  // Reduced-motion viewers get the banner only (shared.css flattens animations anyway).
  if (running || (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
  // Midnight while you're on another tab (e.g. the one you're screen-sharing):
  // animation frames don't run there, so hold the show until you come back.
  if (document.visibilityState === "hidden") {
    if (!showWaitingForTab) {
      showWaitingForTab = true;
      const onVisible = () => {
        if (document.visibilityState !== "visible") return;
        document.removeEventListener("visibilitychange", onVisible);
        showWaitingForTab = false;
        if (currentKey) runShow();
      };
      document.addEventListener("visibilitychange", onVisible);
    }
    return;
  }
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
