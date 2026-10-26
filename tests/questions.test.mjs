// questions.js on its own — plain Node, no browser. The question bank is well
// formed, and the right question comes next.
import {
  QUESTIONS, CATEGORIES, PHASE_LABELS, nextQuestion, doneToday, fillNames, addDays, SKIP_DAYS,
} from "../whm-site/js/questions.js";
import { checker } from "./lib/browser.mjs";

const { check, done } = checker();
const today = "2026-10-26";
const ids = QUESTIONS.map((q) => q.id);
const next = (history, phase) => { const q = nextQuestion(history, { today, phase }); return q && q.id; };
const answered = (id, asked_on = "2026-10-01") => ({ question_id: id, status: "answered", asked_on });

check("ids are unique", new Set(ids).size === ids.length);
check("ids fit the database column", ids.every((id) => /^[a-z0-9-]{1,40}$/.test(id)), ids.filter((id) => !/^[a-z0-9-]{1,40}$/.test(id)));
check("every question has a known kind", QUESTIONS.every((q) => CATEGORIES[q.cat]), QUESTIONS.filter((q) => !CATEGORIES[q.cat]).map((q) => q.id));
check("every phase question names a real phase", QUESTIONS.every((q) => !q.phase || PHASE_LABELS[q.phase]));
check("every question has words and a label", QUESTIONS.every((q) => q.ask && q.label));
check("each phase has at least one question", Object.keys(PHASE_LABELS).every((p) => QUESTIONS.some((q) => q.phase === p)));

check("first ever question, no cycle data: the first everyday one", next([], "unknown") === "comfort-food");
check("on a period day: a period question first", next([], "menstrual") === "period-helps");
check("in pms week: a pms question first", next([], "pms") === "pms-need");
check("answered questions don't come back", next([answered("comfort-food")], "unknown") === "upset-space");
check("phase questions run out, then everyday ones",
  next(["period-helps", "period-craving", "period-dont"].map((id) => answered(id)), "menstrual") === "comfort-food");

const skipped = (until) => ({ question_id: "comfort-food", status: "skipped", skipped_until: until, asked_on: "2026-10-20" });
check("a skipped question rests until its date", next([skipped("2026-10-27")], "unknown") === "upset-space");
check("…and comes back on that date", next([skipped(today)], "unknown") === "comfort-food");

const everyday = QUESTIONS.filter((q) => !q.phase).map((q) => answered(q.id));
check("everyday ones done, no cycle data: phase questions still get asked", next(everyday, "unknown") === "period-helps");
check("everything answered: nothing left", next(QUESTIONS.map((q) => answered(q.id)), "pms") === null);

check("done today after answering today", doneToday([answered("x", today)], today));
check("done today after skipping today", doneToday([{ ...skipped("2026-11-09"), asked_on: today }], today));
check("not done today otherwise", !doneToday([answered("x", "2026-10-25")], today) && !doneToday([], today));

check("skip waits two weeks", SKIP_DAYS === 14 && addDays(today, SKIP_DAYS) === "2026-11-09");
check("dates roll over months and years", addDays("2026-12-25", 14) === "2027-01-08" && addDays("2027-02-20", 14) === "2027-03-06");
check("{partner} becomes his name", fillNames("a snack {partner} should keep", { partner: "dev" }) === "a snack dev should keep");
check("…or 'your partner' without one", fillNames("{partner}") === "your partner");

done();
