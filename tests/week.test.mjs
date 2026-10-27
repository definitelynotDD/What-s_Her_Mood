// The week calendar on today: seven days coloured by phase, today marked,
// the next period predicted, ‹ › to other weeks, both phones, live.
import { startServer } from "./lib/server.mjs";
import { launch, checker } from "./lib/browser.mjs";

const { server, origin } = startServer();
const b = await launch();
const { check, done } = checker();
const errs = [];
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((x) => String(x).padStart(2, "0")).join("-"); };

async function open(user, starts, { locale = "en-IN", width = 390 } = {}) {
  const ctx = await b.newContext({ viewport: { width, height: 844 }, locale });
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
  await p.waitForFunction(() => document.querySelectorAll(".cw-day").length === 7, null, { timeout: 10000 });
  return { p, ctx };
}
const week = (p) => p.evaluate(() => ({
  label: document.querySelector(".cycle-week-label").textContent,
  labelOff: document.querySelector(".cycle-week-label").disabled,
  days: [...document.querySelectorAll(".cw-day")].map((d) => ({
    iso: d.dataset.iso, phase: d.dataset.phase, hue: d.dataset.hue, wd: d.querySelector(".cw-wd").textContent,
    date: d.querySelector(".cw-date").textContent, today: d.classList.contains("is-today"), logged: d.classList.contains("is-logged"),
    bg: getComputedStyle(d.querySelector(".cw-cell")).backgroundColor,
  })),
  legend: [...document.querySelectorAll(".cycle-legend-item")].map((x) => x.textContent),
}));

// 1) the date maths (a fixed Tuesday, 27 Oct 2026; cycle.js imports Supabase,
//    so this runs in the page)
{
  const { p, ctx } = await open("her", []);
  const t = await p.evaluate(async () => {
    const { weekOf, phaseOn } = await import("/js/cycle.js");
    const S = { cycle_length: 26, period_length: 5 };
    const starts = [{ start_date: "2026-10-03" }, { start_date: "2026-09-07" }];   // newest first
    const T = "2026-10-27";
    const keys = (w) => w.map((d) => d.iso.slice(5) + ":" + d.phase.key + (d.isToday ? "*" : "") + (d.logged ? "+" : ""));
    return {
      mon: keys(weekOf(S, starts, 0, 1, T)),
      sun: weekOf(S, starts, 0, 0, T).map((d) => d.iso.slice(5)),
      next: keys(weekOf(S, starts, 1, 1, T)),
      back: keys(weekOf(S, starts, -4, 1, T)),
      before: phaseOn(S, starts, "2026-09-01", T).key,
      late: [phaseOn(S, [{ start_date: "2026-09-20" }], T, T).key, phaseOn(S, [{ start_date: "2026-09-20" }], "2026-10-28", T)],
    };
  });
  check("this week from Monday: pms to the 28th, then the period predicted",
    t.mon.join() === "10-26:pms,10-27:pms*,10-28:pms,10-29:menstrual,10-30:menstrual,10-31:menstrual,11-01:menstrual", t.mon);
  check("a Sunday-first week starts the day before", t.sun[0] === "10-25" && t.sun[6] === "10-31", t.sun);
  check("next week: end of the period, follicular, then ovulating",
    t.next.join() === "11-02:menstrual,11-03:follicular,11-04:follicular,11-05:follicular,11-06:follicular,11-07:follicular,11-08:ovulation", t.next);
  check("four weeks back: the cycle before, and the logged start marked",
    t.back.join() === "09-28:pms,09-29:pms,09-30:pms,10-01:pms,10-02:pms,10-03:menstrual+,10-04:menstrual", t.back);
  check("before her first logged start: unknown", t.before === "unknown", t.before);
  check("already late: today pms, the days ahead unknown", t.late[0] === "pms" && t.late[1].key === "unknown" && t.late[1].late === true, t.late);
  await ctx.close();
}

// 2) day 25 of 26 in the app, both phones
for (const [who, locale, first] of [["me", "en-US", "S"], ["her", "en-GB", "M"]]) {
  const { p, ctx } = await open(who, [daysAgo(24)], { locale });
  const w = await week(p);
  const today = w.days.find((d) => d.today);
  check(`${who}: seven days, today is pms and filled in`, w.days.length === 7 && today && today.iso === daysAgo(0)
    && today.phase === "pms" && today.hue === "plum" && w.days.filter((d) => d.today).length === 1, w.days);
  check(`${who} (${locale}): the week starts on ${first === "M" ? "Monday" : "Sunday"}`, w.days[0].wd === first, w.days.map((d) => d.wd));
  check(`${who}: phases have their own colours`, new Set(w.days.filter((d) => d.phase !== today.phase).map((d) => d.bg)).size >= 1
    && w.days.filter((d) => d.phase === "menstrual").every((d) => d.bg !== today.bg), w.days);
  check(`${who}: a legend for all five`, w.legend.join() === "period,follicular,ovulating,luteal,pms", w.legend);

  // tomorrow and the day after, wherever they fall (this week or next)
  const seen = Object.fromEntries(w.days.map((d) => [d.iso, d.phase]));
  check(`${who}: "this week", nothing to go back to`, w.label === "this week" && w.labelOff, w);
  await p.click('.cycle-week-btn[aria-label="next week"]');
  const n = await week(p);
  n.days.forEach((d) => { seen[d.iso] = d.phase; });
  check(`${who}: › shows next week`, n.label === "next week" && !n.labelOff && n.days[0].iso > w.days[6].iso && !n.days.some((d) => d.today), n);
  check(`${who}: tomorrow still pms, then her period predicted`, seen[daysAgo(-1)] === "pms" && seen[daysAgo(-2)] === "menstrual", seen);
  await p.click('.cycle-week-btn[aria-label="previous week"]');
  await p.click('.cycle-week-btn[aria-label="previous week"]');
  check(`${who}: ‹ ‹ is last week`, (await week(p)).label === "last week");
  await p.click(".cycle-week-label");
  const back = await week(p);
  check(`${who}: tapping the label comes back to this week`, back.label === "this week" && back.days.some((d) => d.today), back.label);
  await ctx.close();
}

// 3) she logs today's period start on her phone: his calendar follows live
{
  const { p, ctx } = await open("me", [daysAgo(24)]);
  await p.click('.cycle-week-btn[aria-label="next week"]');   // he's looking at next week
  await p.evaluate((today) => {
    const row = { id: "new", user_id: "her", start_date: today };
    window.__db.period_starts.unshift(row);   // the mock ignores order(); newest first, as Supabase sorts it
    window.__mock.emitChange("period_starts", row);
  }, daysAgo(0));
  await p.waitForFunction(() => /^day 1 of/.test(document.querySelector(".cycle-day-line").textContent), null, { timeout: 5000 }).catch(() => {});
  await p.click(".cycle-week-label");
  const w = await week(p);
  const today = w.days.find((d) => d.today);
  check("her new start: today turns period, with the logged dot", today && today.phase === "menstrual" && today.logged, today);
  await ctx.close();
}

// 4) nothing logged, and a narrow phone
{
  const { p, ctx } = await open("me", [], { width: 340 });
  const w = await week(p);
  check("no data: every day blank (unknown)", w.days.every((d) => d.phase === "unknown"), w.days.map((d) => d.phase));
  const fit = await p.evaluate(async () => {
    // measure after the cards' pop-in (a scale animation), not during it
    await Promise.all(document.getAnimations().filter((x) => x.effect.getComputedTiming().iterations !== Infinity).map((x) => x.finished));
    const card = document.querySelector(".cycle-card").getBoundingClientRect();
    return { scroll: document.documentElement.scrollWidth, inside: [...document.querySelectorAll(".cw-cell")].every((c) => {
      const r = c.getBoundingClientRect(); return r.left >= card.left && r.right <= card.right && r.width >= 24; }) };
  });
  check("340px phone: the week fits inside the card, dates still readable", fit.scroll <= 340 && fit.inside, fit);
  await ctx.close();
}

check("no page errors", errs.length === 0, errs);
await b.close();
server.close();
done();
