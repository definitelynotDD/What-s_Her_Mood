// Special days against a fake clock, using the couple's real setup (the 21st
// and the 10th, India midnight): the show starts at 00:00 IST even mid-call,
// the banner goes away when the day ends, and the phone's own time zone
// doesn't matter.
import { startServer } from "./lib/server.mjs";
import { launch, MEDIA_ARGS, PAIRED_DB, configWith, checker } from "./lib/browser.mjs";

const { server, origin } = startServer();
const b = await launch(MEDIA_ARGS);
const { check, done } = checker();
const errs = [];
const CELEB = [
  { date: "2025-11-21", every: "month", timeZone: "Asia/Kolkata", title: "happy {since} ♡" },
  { date: "2025-12-10", every: "month", timeZone: "Asia/Kolkata", title: "happy {since} ♡" },
];

async function app(clockAt, { viewport = { width: 420, height: 860 }, timezoneId = "UTC" } = {}) {
  const ctx = await b.newContext({ viewport, timezoneId, permissions: ["camera", "microphone"] });
  await ctx.clock.install({ time: new Date(clockAt) });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));
  await p.route("**/config.js", configWith(CELEB));
  await p.addInitScript(PAIRED_DB);
  await p.goto(`${origin}/index.html`);
  await p.waitForFunction(() => !document.getElementById("paired-box").hidden, null, { timeout: 10000 });
  return { p, ctx };
}
const st = (p) => p.evaluate(() => ({
  header: document.getElementById("cel-banner").hidden ? null : document.querySelector("#cel-banner .cel-banner-text").textContent,
  room: document.getElementById("cel-banner-hg").hidden ? null : document.querySelector("#cel-banner-hg .cel-banner-text").textContent,
  show: !!document.querySelector(".cel-layer"),
  inRoom: !document.getElementById("screen-hangout").hidden,
}));

// A) In the cozy room when IST midnight arrives (device clock deliberately UTC)
{
  const { p, ctx } = await app("2026-10-20T18:29:56Z");       // Oct 20, 23:59:56 IST
  await p.click('.app-tab[data-tab="hangout"]');
  await p.waitForFunction(() => !document.getElementById("screen-hangout").hidden);
  const before = await st(p);
  check("23:59 IST in the cozy room: nothing yet", before.inRoom && !before.room && !before.show, before);
  await p.waitForFunction(() => !!document.querySelector(".cel-layer") && !document.getElementById("cel-banner-hg").hidden, null, { timeout: 15000 });
  const after = await st(p);
  check("00:00 IST in the cozy room: show + banner", after.inRoom && after.show && after.room === "happy 11 months ♡", after);
  const hgTime = await p.evaluate(() => new Date().toISOString());
  check("it fired within seconds of midnight", hgTime < "2026-10-20T18:30:15Z", { now: hgTime });
  await ctx.close();
}
// B) Opening the app on the 10th (IST morning)
{
  const { p, ctx } = await app("2026-11-10T03:00:00Z");        // Nov 10, 08:30 IST
  await p.waitForTimeout(800);
  const s = await st(p);
  check("open on the 10th: banner + show", s.header === "happy 11 months ♡" && s.show, s);
  await ctx.close();
}
// C) Banner goes away when the day ends
{
  const { p, ctx } = await app("2026-10-21T18:29:57Z");        // Oct 21, 23:59:57 IST
  await p.waitForTimeout(500);
  const s1 = await st(p);
  await p.waitForFunction(() => document.getElementById("cel-banner").hidden, null, { timeout: 15000 });
  check("banner on the 21st, gone at midnight", s1.header === "happy 11 months ♡", s1);
  await ctx.close();
}
// D) IST rules even if the phone is set to another zone (e.g. travelling, device on London time)
{
  const { p, ctx } = await app("2026-10-20T18:30:30Z", { timezoneId: "Europe/London" });  // 19:30 London = 00:00 IST
  await p.waitForTimeout(800);
  const s = await st(p);
  check("device on London time still celebrates at IST midnight", s.header === "happy 11 months ♡", s);
  await ctx.close();
}
// E) An ordinary day
{
  const { p, ctx } = await app("2026-10-25T06:00:00Z");
  await p.waitForTimeout(800);
  const s = await st(p);
  check("ordinary day: nothing", !s.header && !s.show, s);
  await ctx.close();
}
check("no page errors", errs.length === 0, errs);
await b.close(); server.close();
done();
