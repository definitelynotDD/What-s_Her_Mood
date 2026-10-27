// The phase's mood on the today tab: an emoji by the phase name and the
// mascot's face to match, on both phones, changing live with her log.
import { startServer } from "./lib/server.mjs";
import { launch, checker } from "./lib/browser.mjs";

const { server, origin } = startServer();
const b = await launch();
const { check, done } = checker();
const errs = [];
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((x) => String(x).padStart(2, "0")).join("-"); };

async function open(user, starts) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push(user + " PAGEERROR " + e.message));
  await p.addInitScript(([user, starts]) => {
    window.__user = { id: user };
    window.__db = {
      users: [{ id: "me", display_name: "dev", role: "partner", paired_with: "her", pairing_code: "ABC234" },
              { id: "her", display_name: "ana", role: "her", paired_with: "me", pairing_code: "XYZ789" }],
      todos: [], cycle_settings: [{ user_id: "her", cycle_length: 26, period_length: 5 }],
      period_starts: starts.map((d, i) => ({ id: "p" + i, user_id: "her", start_date: d })),
      profile_entries: [], question_history: [],
    };
  }, [user, starts]);
  await p.goto(`${origin}/index.html`);
  await p.waitForFunction(() => /phase|no data/.test(document.querySelector(".cycle-phase-name")?.textContent || ""), null, { timeout: 10000 });
  return { p, ctx };
}
const read = (p) => p.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const m = q(".tr-head-mascot .mascot");
  return {
    emoji: q(".cycle-mood").hidden ? "" : q(".cycle-mood").textContent,
    day: q(".cycle-day-line").textContent,
    phase: q(".cycle-phase-name").textContent, mood: m && m.dataset.mood,
    brows: !!m && getComputedStyle(m.querySelector(".mascot-brow")).display !== "none",
    scrollW: document.documentElement.scrollWidth,
  };
});

// 1) every phase has a face (cycle.js imports Supabase, so this runs in the page)
{
  const { p, ctx } = await open("her", []);
  const t = await p.evaluate(async () => {
    const { PHASES, phaseOf } = await import("/js/cycle.js");
    const faces = Object.values(PHASES).filter((x) => x.key !== "unknown");
    const d25 = phaseOf(25, 26, 5), none = phaseOf(null, 26, 5);
    return { faces: faces.map((x) => [x.key, x.emoji, x.mood]), d25: [d25.emoji, d25.mood], none: [none.emoji, none.mood] };
  });
  const moods = new Set(["sleepy", "happy", "glowing", "calm", "tender"]);
  check("every phase has an emoji and a mascot mood", t.faces.every(([, e, m]) => e && moods.has(m)), t.faces);
  check("no two phases share an emoji", new Set(t.faces.map(([, e]) => e)).size === t.faces.length, t.faces);
  check("day 25 of 26 is pms: 🥺, tender", t.d25[0] === "🥺" && t.d25[1] === "tender", t.d25);
  check("no data: no emoji, everyday face", t.none[0] === "" && t.none[1] === "happy", t.none);
  await ctx.close();
}

// 2) day 25 of a 26-day cycle, both phones
for (const who of ["her", "me"]) {
  const { p, ctx } = await open(who, [daysAgo(24)]);
  const v = await read(p);
  check(`${who}: 🥺 by "pms phase", day 25 of 26`, v.emoji === "🥺" && v.day === "day 25 of 26" && v.phase === "pms phase", v);
  check(`${who}: the mascot looks tender (worried brows)`, v.mood === "tender" && v.brows, v);
  check(`${who}: nothing spills sideways`, v.scrollW <= 390, v);
  await ctx.close();
}

// 3) she logs today's period start on her phone: his face changes live.
// (The mock ignores order(), so the new row goes first, as Supabase sorts it.)
{
  const { p, ctx } = await open("me", [daysAgo(24)]);
  await p.evaluate((today) => {
    const row = { id: "new", user_id: "her", start_date: today };
    window.__db.period_starts.unshift(row);
    window.__mock.emitChange("period_starts", row);
  }, daysAgo(0));
  await p.waitForFunction(() => document.querySelector(".cycle-day-line").textContent === "day 1 of 26", null, { timeout: 5000 }).catch(() => {});
  const v = await read(p);
  check("her new period start: 😴 and a sleepy mascot on his phone", v.emoji === "😴" && v.mood === "sleepy" && !v.brows && v.day === "day 1 of 26", v);
  await ctx.close();
}

// 4) nothing logged yet
{
  const { p, ctx } = await open("me", []);
  const v = await read(p);
  check("no data: no emoji, no day, everyday mascot", v.emoji === "" && v.day === "" && v.mood === "happy" && !v.brows, v);
  await ctx.close();
}

check("no page errors", errs.length === 0, errs);
await b.close();
server.close();
done();
