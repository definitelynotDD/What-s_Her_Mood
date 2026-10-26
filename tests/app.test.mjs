// Opening the app: which tab it lands on, and that Chrome sees it as an
// installable app (manifest + icons).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, SITE } from "./lib/server.mjs";
import { launch, launchProfile, checker } from "./lib/browser.mjs";

const { server, origin } = startServer();
const b = await launch();
const { check, done } = checker();
const errs = [];

const SETUP = ({ paired }) => {
  window.__user = { id: "me" };
  window.__db = {
    users: [{ id: "me", display_name: "dev", role: "partner", paired_with: paired ? "her" : null, pairing_code: "ABC234" },
            { id: "her", display_name: "ana", role: "her", paired_with: paired ? "me" : null, pairing_code: "XYZ789" }],
    todos: [], cycle_settings: [], period_starts: [], profile_entries: [], question_history: [],
  };
};
async function open(paired) {
  const ctx = await b.newContext({ viewport: { width: 420, height: 860 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));
  await p.addInitScript(SETUP, { paired });
  await p.goto(`${origin}/index.html`);
  await p.waitForFunction(() => !document.getElementById("screen-app").hidden, null, { timeout: 10000 });
  return { p, ctx };
}
const view = (p) => p.evaluate(() => ({
  pair: !document.getElementById("subview-pair").hidden,
  today: !document.getElementById("subview-today").hidden,
  tabs: !document.getElementById("app-tabs").hidden,
  on: (document.querySelector(".app-tab.is-on") || {}).dataset?.tab,
  pairedLine: document.getElementById("paired-box").hidden ? null : document.querySelector(".paired-line").textContent.trim(),
}));

// 1) already paired: straight to today
{
  const { p, ctx } = await open(true);
  await p.waitForFunction(() => !document.getElementById("subview-today").hidden, null, { timeout: 5000 }).catch(() => {});
  const v = await view(p);
  check("already paired: opens on today", v.today && !v.pair && v.tabs && v.on === "today", v);
  await p.click('.app-tab[data-tab="pair"]');
  check("the pair-up tab still works", (await view(p)).pair, await view(p));
  await ctx.close();
}

// 2) pairing live: pair-up gets its moment
{
  const { p, ctx } = await open(false);
  await p.waitForTimeout(400);
  const before = await view(p);
  check("not paired: pair-up, no tabs", before.pair && !before.today && !before.tabs, before);
  await p.evaluate(() => {
    window.__db.users[0].paired_with = "her";
    window.__db.users[1].paired_with = "me";
    window.__mock.emitChange("users", { ...window.__db.users[0] });
  });
  await p.waitForFunction(() => !document.getElementById("paired-box").hidden, null, { timeout: 5000 }).catch(() => {});
  const after = await view(p);
  check("just paired: stays on pair-up to say so", after.pair && !after.today && after.tabs && after.on === "pair"
    && after.pairedLine === "you're paired with ana ♡", after);
  await ctx.close();
}

// 3) installable
{
  const manifest = JSON.parse(fs.readFileSync(path.join(SITE, "manifest.webmanifest"), "utf8"));
  const size = (f) => { const d = fs.readFileSync(path.join(SITE, f)); return d.readUInt32BE(16) + "x" + d.readUInt32BE(20); };
  const bad = manifest.icons.filter((i) => size(i.src) !== i.sizes);
  check("every manifest icon exists at its stated size", bad.length === 0, bad);
  check("a 512px maskable icon for Android", manifest.icons.some((i) => i.purpose === "maskable" && i.sizes === "512x512"));
  check("opens full-screen, in the app's colors", manifest.display === "standalone" && manifest.start_url === "/" && manifest.theme_color === "#4F6E4A");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whm-profile-"));
  const ctx = await launchProfile(dir, { viewport: { width: 420, height: 860 } });
  const p = ctx.pages()[0] || await ctx.newPage();
  await p.addInitScript(SETUP, { paired: true });
  await p.goto(`${origin}/index.html`);
  await p.waitForFunction(() => !document.getElementById("screen-app").hidden, null, { timeout: 10000 });
  const cdp = await ctx.newCDPSession(p);
  const m = await cdp.send("Page.getAppManifest");
  check("Chrome reads the manifest without errors", m.url.endsWith("/manifest.webmanifest") && m.errors.length === 0, m.errors);
  const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
  check("Chrome says it's installable", installabilityErrors.length === 0, installabilityErrors);
  await ctx.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

check("no page errors", errs.length === 0, errs);
await b.close();
server.close();
done();
