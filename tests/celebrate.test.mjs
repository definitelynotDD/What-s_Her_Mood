// Special days in the real app (signed in + paired via the mock): banner,
// fireworks + hearts on the day, nothing on other days, ?celebrate preview,
// reduced motion. Dates are relative to today, so this runs on any day.
import { startServer } from "./lib/server.mjs";
import { launch, PAIRED_DB, configWith, checker } from "./lib/browser.mjs";

const { server, origin } = startServer();
const b = await launch();
const { check, done } = checker();
const errs = [];

const today = new Date(), pad = (n) => String(n).padStart(2, "0");
const todayMMDD = pad(today.getMonth() + 1) + "-" + pad(today.getDate());
const other = new Date(today.getTime() + 40 * 864e5);
const otherMMDD = pad(other.getMonth() + 1) + "-" + pad(other.getDate());

async function app({ celebrations, query = "", reducedMotion = "no-preference", viewport = { width: 420, height: 860 } }) {
  const ctx = await b.newContext({ viewport, reducedMotion });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));
  await p.route("**/config.js", configWith(celebrations));
  await p.addInitScript(PAIRED_DB);
  await p.goto(`${origin}/index.html${query}`);
  await p.waitForFunction(() => !document.getElementById("paired-box").hidden, null, { timeout: 10000 });
  return { p, ctx };
}
const state = (p) => p.evaluate(() => ({
  banner: !document.getElementById("cel-banner").hidden ? document.querySelector("#cel-banner .cel-banner-text").textContent : null,
  layer: !!document.querySelector(".cel-layer"), canvas: !!document.querySelector(".cel-layer canvas"),
  hearts: document.querySelectorAll(".cel-layer .wm-heart").length,
}));
const canvasInk = (p) => p.evaluate(() => {   // non-transparent pixels drawn by the fireworks
  const c = document.querySelector(".cel-layer canvas"); if (!c) return -1;
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 20) n++;
  return n;
});

// 1) today is the anniversary
{
  const { p, ctx } = await app({ celebrations: [{ date: "2023-" + todayMMDD, title: "happy {years}-year anniversary ♡" }, { date: otherMMDD, title: "nope" }] });
  await p.waitForTimeout(1800);
  const s = await state(p), ink = await canvasInk(p);
  check("banner + show on the day", s.banner === `happy ${today.getFullYear() - 2023}-year anniversary ♡` && s.layer && s.canvas && s.hearts > 0, s);
  check("fireworks actually draw", ink > 200, { ink });
  const blocks = await p.evaluate(() => getComputedStyle(document.querySelector(".cel-layer")).pointerEvents);
  check("show doesn't block taps", blocks === "none", { blocks });
  await p.waitForFunction(() => !document.querySelector(".cel-layer"), null, { timeout: 15000 });
  check("show cleans itself up, banner stays", (await state(p)).banner !== null, await state(p));
  await p.click("#cel-banner");
  await p.waitForTimeout(600);
  check("tapping the banner replays", (await state(p)).layer, await state(p));
  await ctx.close();
}
// 2) not today
{
  const { p, ctx } = await app({ celebrations: [{ date: otherMMDD, title: "nope" }] });
  await p.waitForTimeout(1200);
  const s = await state(p);
  check("nothing on other days", !s.banner && !s.layer, s);
  await ctx.close();
}
// 3) preview with no days configured
{
  const { p, ctx } = await app({ celebrations: [], query: "?celebrate" });
  await p.waitForTimeout(800);
  const s = await state(p);
  check("?celebrate previews any day", s.banner === "happy day ♡ (preview)" && s.layer, s);
  await ctx.close();
}
// 4) reduced motion → banner only
{
  const { p, ctx } = await app({ celebrations: [{ date: todayMMDD, title: "happy birthday ♡" }], reducedMotion: "reduce" });
  await p.waitForTimeout(1200);
  const s = await state(p);
  check("reduced motion: banner, no fireworks", s.banner === "happy birthday ♡" && !s.layer, s);
  await ctx.close();
}
// 5) desktop width
{
  const { p, ctx } = await app({ celebrations: [{ date: "2023-" + todayMMDD, title: "happy {years}-year anniversary ♡" }], viewport: { width: 1280, height: 800 } });
  await p.waitForTimeout(2200);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check("no horizontal overflow during show", !overflow);
  await ctx.close();
}
check("no page errors", errs.length === 0, errs);
await b.close(); server.close();
done();
