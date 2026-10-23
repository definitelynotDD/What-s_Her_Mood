// celebrationFor() on its own — plain Node, no browser. Which days celebrate,
// for how long, and with what title.
import { celebrationFor } from "../whm-site/js/celebrate.js";
import { checker } from "./lib/browser.mjs";

const { check, done } = checker();
const CELEB = [
  { date: "2025-11-21", every: "month", timeZone: "Asia/Kolkata", title: "happy {since} ♡" },
  { date: "2025-12-10", every: "month", timeZone: "Asia/Kolkata", title: "happy {since} ♡" },
];
const at = (iso, list = CELEB) => { const c = celebrationFor(list, new Date(iso)); return c ? c.title : null; };
const istDay = (t) => new Date(t + 5.5 * 3600e3).toISOString().slice(0, 10);

// Every half hour for 14 months: only the 10th and 21st (IST), and all of each day.
{
  const days = new Map();
  for (let t = Date.parse("2026-10-20T18:30:00Z"); t < Date.parse("2027-12-31T18:30:00Z"); t += 30 * 60e3) {
    if (!celebrationFor(CELEB, new Date(t))) continue;
    days.set(istDay(t), (days.get(istDay(t)) || 0) + 1);
  }
  const wrongDay = [...days.keys()].filter((d) => !d.endsWith("-10") && !d.endsWith("-21"));
  const partDay = [...days].filter(([, n]) => n !== 48);
  check("only the 10th and 21st celebrate", wrongDay.length === 0, wrongDay);
  check("each lasts the whole IST day", partDay.length === 0, partDay);
  check("29 days from 21 Oct 2026 to 21 Dec 2027", days.size === 29, { n: days.size });
}

check("start dates themselves don't celebrate", !at("2025-11-21T06:00:00Z") && !at("2025-12-10T06:00:00Z"));
check("first month counts", at("2025-12-21T06:00:00Z") === "happy 1 month ♡");
check("23:59 IST on the 20th: nothing", at("2026-10-20T18:29:59Z") === null);
check("00:00 IST on the 21st: celebrates", at("2026-10-20T18:30:00Z") === "happy 11 months ♡");
check("23:59 IST on the 21st: still on", at("2026-10-21T18:29:59Z") === "happy 11 months ♡");
check("00:00 IST on the 22nd: over", at("2026-10-21T18:30:00Z") === null);
check("one year", at("2026-11-21T06:00:00Z") === "happy 1 year ♡");
check("years + months", at("2027-12-21T06:00:00Z") === "happy 2 years 1 month ♡");

const day31 = [{ date: "2025-01-31", every: "month", timeZone: "UTC", title: "{months}" }];
check("the 31st lands on Feb 28", at("2026-02-28T12:00:00Z", day31) === "13" && at("2026-03-31T12:00:00Z", day31) === "14");
const leap = [{ date: "2024-02-29", timeZone: "UTC", title: "{years}" }];
check("Feb 29 yearly → Feb 28 in other years", at("2025-02-28T12:00:00Z", leap) === "1" && at("2028-02-29T12:00:00Z", leap) === "4");
check("no year in the date: still celebrates", at("2026-07-04T12:00:00Z", [{ date: "07-04", timeZone: "UTC", title: "yay" }]) === "yay");
check("bad entries are skipped", at("2026-07-04T12:00:00Z", [{ date: "nope" }, null, { date: "07-04", timeZone: "UTC", title: "ok" }]) === "ok");

done();
