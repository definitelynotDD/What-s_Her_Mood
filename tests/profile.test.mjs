// Stage 4 in the real app (signed in + paired via the mock): her daily
// question, what gets saved, skipping, the "about her" card on both sides, and
// the app still working when the tables are missing.
import { startServer } from "./lib/server.mjs";
import { launch, checker } from "./lib/browser.mjs";
import { QUESTIONS } from "../whm-site/js/questions.js";

const { server, origin } = startServer();
const b = await launch();
const { check, done } = checker();
const errs = [];

// A paired couple; `as` picks whose phone this is. phaseDay = her cycle day
// (28-day cycle, 5-day period: 1 = period, 25 = pms). "TODAY" in history
// becomes the browser's local date.
const SETUP = ({ as, phaseDay, entries, history, failTables }) => {
  const iso = (d) => [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, "0")).join("-");
  const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
  window.__user = { id: as };
  window.__failTables = failTables || [];
  window.__db = {
    users: [{ id: "me", display_name: "dev", role: "partner", paired_with: "her", pairing_code: "ABC234" },
            { id: "her", display_name: "ana", role: "her", paired_with: "me", pairing_code: "XYZ789" }],
    todos: [], cycle_settings: [{ user_id: "her", cycle_length: 28, period_length: 5 }],
    period_starts: phaseDay ? [{ id: "p1", user_id: "her", start_date: ago(phaseDay - 1) }] : [],
    profile_entries: (entries || []).map((e, i) => ({ id: "e" + i, user_id: "her", source: "answered-question", question_id: null,
      phase_tags: [], created_at: new Date(2026, 0, 1 + i).toISOString(), ...e })),
    question_history: (history || []).map((h) => ({ user_id: "her", ...h, asked_on: h.asked_on === "TODAY" ? iso(new Date()) : h.asked_on })),
  };
};

async function open(opts, viewport = { width: 420, height: 900 }) {
  const ctx = await b.newContext({ viewport });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));
  await p.addInitScript(SETUP, opts);
  await p.goto(`${origin}/index.html`);
  await p.waitForFunction(() => !document.getElementById("paired-box").hidden, null, { timeout: 10000 });
  await p.click('.app-tab[data-tab="today"]');
  await p.waitForSelector("#tracker .about-card");
  return { p, ctx };
}
const prompt = (p) => p.$eval(".q-card .q-prompt", (n) => n.textContent).catch(() => null);
const waitPrompt = (p, text) => p.waitForFunction((t) => {
  const n = document.querySelector(".q-card .q-prompt"); return n && n.textContent === t;
}, text, { timeout: 5000 }).then(() => true, () => false);
const db = (p, table) => p.evaluate((t) => JSON.parse(JSON.stringify(window.__db[t] || [])), table);
const today = (p) => p.evaluate(() => { const d = new Date(); return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, "0")).join("-"); });
const about = (p) => p.evaluate(() => {
  const c = document.querySelector(".about-card");
  return {
    title: c.querySelector(".tr-h3").textContent,
    count: c.querySelector(".todos-count-pill").textContent,
    groups: [...c.querySelectorAll(".about-group")].map((g) => g.querySelector(".about-group-title").textContent + " | " +
      [...g.querySelectorAll(".about-row .about-text")].map((t) => t.textContent).join(" / ")),
    today: c.querySelector(".about-today").hidden ? null : c.querySelector(".about-today").textContent,
    empty: !c.querySelector(".about-empty").hidden,
    editable: !!c.querySelector(".todo-edit"), addForm: !!c.querySelector(".about-add"),
  };
});

// 1) her first question, no cycle data yet: answer it
{
  const { p, ctx } = await open({ as: "her" });
  await p.waitForSelector(".q-card:not([hidden]) .q-form");
  check("her first question is the first everyday one", await prompt(p) === "what's your forever comfort food?", await prompt(p));
  const foot = await p.$eval(".q-card .q-row .muted", (n) => n.textContent);
  check("she's told who sees her answers", foot.startsWith("dev sees your answers"), foot);
  await p.click(".q-save");
  await p.waitForTimeout(300);
  check("an empty answer saves nothing", (await db(p, "profile_entries")).length === 0 && await prompt(p) === "what's your forever comfort food?");
  await p.fill(".q-form input", "  maggi at midnight ");
  await p.click(".q-save");
  check("saving thanks her", await waitPrompt(p, "saved ♡"), await prompt(p));
  const [e] = await db(p, "profile_entries"), [h] = await db(p, "question_history"), t = await today(p);
  check("the answer becomes a profile entry", e && e.user_id === "her" && e.thing === "maggi at midnight" && e.category === "food"
    && e.source === "answered-question" && e.question_id === "comfort-food" && e.phase_tags.length === 0, e);
  check("the question is marked answered today", h && h.question_id === "comfort-food" && h.status === "answered" && h.asked_on === t && h.skipped_until === null, h);
  await p.waitForFunction(() => document.querySelector(".about-card .todos-count-pill").textContent === "1", null, { timeout: 3000 }).catch(() => {});
  const a = await about(p);
  check("it shows in her 'about you' card", a.title === "about you" && a.count === "1" && a.groups[0] === "food & drinks | comfort food:maggi at midnight", a);

  await p.click(".q-more");
  check("'ask me another' asks the next one", await waitPrompt(p, "when you're upset, do you want to talk it out right away, or have some space first?"), await prompt(p));
  await p.click(".q-skip");
  check("skipping is gentle", await waitPrompt(p, "skipped — it'll come back another time"), await prompt(p));
  const s = (await db(p, "question_history")).find((r) => r.question_id === "upset-space");
  const back = await p.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 14); return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, "0")).join("-"); });
  check("a skip rests for two weeks", s && s.status === "skipped" && s.skipped_until === back && (await db(p, "profile_entries")).length === 1, s);
  await ctx.close();
}

// 2) already answered one today: the card rests until she asks for more
{
  const { p, ctx } = await open({ as: "her", history: [{ question_id: "comfort-food", status: "answered", asked_on: "TODAY" }] });
  await p.waitForSelector(".q-card:not([hidden]) .q-more");
  check("one question a day", await prompt(p) === "that's today's question ♡", await prompt(p));
  await p.click(".q-more");
  check("…unless she asks for another", await waitPrompt(p, "when you're upset, do you want to talk it out right away, or have some space first?"), await prompt(p));
  await ctx.close();
}

// 3) on a period day the period question comes first, and keeps its phase
{
  const { p, ctx } = await open({ as: "her", phaseDay: 1 });
  check("period day: period question first", await waitPrompt(p, "on period days, what helps you most?"), await prompt(p));
  await p.fill(".q-form input", "hot water bottle");
  await p.click(".q-save");
  await waitPrompt(p, "saved ♡");
  const [e] = await db(p, "profile_entries");
  check("its answer is tagged with the phase", e && e.phase_tags.join() === "menstrual" && e.category === "care", e);
  await p.waitForFunction(() => document.querySelectorAll(".about-card .about-row").length === 1, null, { timeout: 3000 }).catch(() => {});
  check("…and shows a 'period days' tag", (await about(p)).groups[0] === "how to help | on period days:hot water bottleperiod days", await about(p));
  await ctx.close();
}

// 4) everything answered
{
  const { p, ctx } = await open({ as: "her", history: QUESTIONS.map((q) => ({ question_id: q.id, status: "answered", asked_on: "2026-01-01" })) });
  check("all answered: says so", await waitPrompt(p, "you've answered every question ♡"), await prompt(p));
  await ctx.close();
}

// 5) she edits, removes and adds her own
{
  const { p, ctx } = await open({ as: "her", entries: [{ thing: "tulips", category: "little", question_id: "flower" }] });
  await p.waitForSelector(".about-card .todo-edit");
  p.once("dialog", (d) => d.accept("sunflowers"));
  await p.click(".about-card .todo-edit");
  await p.waitForFunction(() => document.querySelector(".about-card .about-thing").textContent === "sunflowers", null, { timeout: 3000 }).catch(() => {});
  check("edit changes it everywhere", (await db(p, "profile_entries"))[0].thing === "sunflowers" && (await about(p)).groups[0] === "little joys | favourite flower:sunflowers", await about(p));
  await p.click(".about-card .todo-rm");
  await p.waitForFunction(() => !document.querySelector(".about-card .about-row"), null, { timeout: 3000 }).catch(() => {});
  check("remove deletes it", (await db(p, "profile_entries")).length === 0 && (await about(p)).empty, await about(p));
  await p.click(".about-add summary");
  await p.selectOption(".about-add-form select", "avoid");
  await p.fill(".about-add-form input", "loud alarms");
  await p.click(".about-add-form button");
  await p.waitForFunction(() => document.querySelectorAll(".about-card .about-row").length === 1, null, { timeout: 3000 }).catch(() => {});
  const [e] = await db(p, "profile_entries");
  check("she can add her own", e && e.thing === "loud alarms" && e.category === "avoid" && e.source === "added-manually" && e.question_id === null, e);
  check("…shown under 'please don't'", (await about(p)).groups[0] === "please don't | loud alarms", await about(p));
  await ctx.close();
}

// 6) his side, in her pms week
{
  const entries = [
    { thing: "patience and chocolate", category: "care", question_id: "pms-need", phase_tags: ["pms"] },
    { thing: "maggi", category: "food", question_id: "comfort-food" },
    { thing: "hot water bottle", category: "care", question_id: "period-helps", phase_tags: ["menstrual"] },
  ];
  const { p, ctx } = await open({ as: "me", phaseDay: 25, entries });
  await p.waitForFunction(() => document.querySelector(".about-card .todos-count-pill").textContent === "3", null, { timeout: 5000 }).catch(() => {});
  const a = await about(p);
  check("no question card on his phone", !(await p.$(".q-card")));
  check("he sees 'about ana', read-only", a.title === "about ana" && a.count === "3" && !a.editable && !a.addForm, a);
  check("today's phase pulled up top", a.today === "on days like today (pms week)in pms week:patience and chocolate", a.today);
  check("everything grouped by kind", a.groups.join(" # ") === "how to help | in pms week:patience and chocolatepms week / on period days:hot water bottleperiod days # food & drinks | comfort food:maggi", a.groups);
  const order = await p.$$eval("#tracker > .tr-card", (n) => n.map((x) => x.classList[1]));
  check("his order: cycle, wise words, about her, to-dos", order.join() === "cycle-card,wise-card,about-card,todos-card", order);
  await p.evaluate(() => {
    const row = { id: "new", user_id: "her", thing: "a long walk", category: "activity", source: "added-manually", question_id: null, phase_tags: [], created_at: new Date().toISOString() };
    window.__db.profile_entries.push(row);
    window.__mock.emitChange("profile_entries", row);
  });
  await p.waitForFunction(() => document.querySelector(".about-card .todos-count-pill").textContent === "4", null, { timeout: 3000 }).catch(() => {});
  check("her new answers appear live", (await about(p)).groups.some((g) => g === "things to do | a long walk"), await about(p));
  await ctx.close();
}

// 7) his side before she's answered anything
{
  const { p, ctx } = await open({ as: "me", phaseDay: 25 });
  await p.waitForTimeout(500);
  const a = await about(p);
  check("empty state explains where answers come from", a.empty && !a.today && a.groups.length === 0, a);
  await ctx.close();
}

// 8) tables missing (deployed before the database change): the rest still works
{
  const { p, ctx } = await open({ as: "her", phaseDay: 10, failTables: ["profile_entries", "question_history"] });
  await p.waitForTimeout(800);
  const s = await p.evaluate(() => ({
    q: document.querySelector(".q-card").hidden, cycle: document.querySelector(".cycle-day-line").textContent,
    todos: !!document.querySelector(".todos-form"),
  }));
  check("no question card, cycle and to-dos fine", s.q && /^day 10 of /.test(s.cycle) && s.todos, s);
  await ctx.close();
}

// 9) phone width: nothing spills sideways, add form open
{
  const { p, ctx } = await open({ as: "her", phaseDay: 1, entries: [{ thing: "a really quite long answer about the exact kind of hot chocolate that fixes everything", category: "food", question_id: "bad-day-drink" }] }, { width: 340, height: 740 });
  await p.waitForSelector(".q-card:not([hidden]) .q-form");
  await p.click(".about-add summary");
  const w = await p.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: innerWidth }));
  check("no sideways scroll at 340px", w.scroll <= w.inner, w);
  await ctx.close();
}

check("no page errors", errs.length === 0, errs);
await b.close();
server.close();
done();
