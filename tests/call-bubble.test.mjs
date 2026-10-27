// The whole app, two phones on one call: the tabs stay up mid-call, and
// opening "today" or "pair up" shrinks the call to a bubble instead of ending
// it. Plus the welcome page fitting on a small phone.
import { startServer } from "./lib/server.mjs";
import { launch, MEDIA_ARGS, checker } from "./lib/browser.mjs";

const { server, origin } = startServer();
const b = await launch([...MEDIA_ARGS, "--autoplay-policy=no-user-gesture-required"]);
const { check, done } = checker();
const errs = [];

const SETUP = (user) => {
  window.__user = user ? { id: user } : null;
  window.__db = {
    users: [{ id: "me", display_name: "dev", role: "partner", paired_with: "her", pairing_code: "ABC234" },
            { id: "her", display_name: "ana", role: "her", paired_with: "me", pairing_code: "XYZ789" }],
    todos: [], cycle_settings: [{ user_id: "her", cycle_length: 28, period_length: 5 }],
    period_starts: [{ user_id: "her", start_date: "2026-10-10" }], profile_entries: [], question_history: [],
  };
};
async function phone(ctx, user) {
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push(user + " PAGEERROR " + e.message));
  await p.addInitScript(SETUP, user);
  await p.goto(`${origin}/index.html`);
  await p.waitForFunction(() => !document.getElementById("subview-today").hidden, null, { timeout: 10000 });
  return p;
}
const connected = (p) => p.waitForFunction(() => /connected/.test(document.getElementById("hg-status").textContent)
  && document.getElementById("hg-remote").videoWidth > 0, null, { timeout: 20000 });
const view = (p) => p.evaluate(() => {
  const g = (id) => document.getElementById(id);
  const room = g("screen-hangout"), r = room.getBoundingClientRect();
  const live = (el) => !!el.srcObject && el.srcObject.getTracks().every((t) => t.readyState === "live");
  return {
    room: !room.hidden, mini: room.classList.contains("is-mini"), w: Math.round(r.width), bottom: Math.round(r.bottom),
    app: !g("screen-app").hidden, today: !g("subview-today").hidden, pair: !g("subview-pair").hidden,
    tabs: !g("app-tabs").hidden, on: (document.querySelector(".app-tab.is-on") || {}).dataset?.tab,
    title: getComputedStyle(document.querySelector(".app-title")).display !== "none" && !g("app-header").hidden,
    camLive: live(g("hg-local")), remotePlaying: !g("hg-remote").paused && live(g("hg-remote")),
    status: g("hg-status").textContent, start: g("start-hangout").textContent,
    unread: g("hg-mini-unread").hidden ? 0 : Number(g("hg-mini-unread").textContent),
    hearts: window.__mock.sent.filter((e) => e === "heart").length,
  };
});
const advancing = (p) => p.evaluate(async () => {
  const v = document.getElementById("hg-remote"), t0 = v.currentTime;
  await new Promise((r) => setTimeout(r, 800));
  return v.currentTime > t0;
});

// 1) Mid-call, the other tabs work and the call carries on
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, permissions: ["camera", "microphone"] });
  const dev = await phone(ctx, "me"), ana = await phone(ctx, "her");
  await dev.click('.app-tab[data-tab="hangout"]');
  await ana.click('.app-tab[data-tab="hangout"]');
  await connected(dev); await connected(ana);

  const inCall = await view(ana);
  check("in the call: tabs still there, on 'cozy room'", inCall.room && !inCall.mini && inCall.tabs && inCall.on === "hangout", inCall);
  check("in the call: the header is just the tabs", !inCall.title, inCall);

  await ana.click('.app-tab[data-tab="today"]');
  const onToday = await view(ana);
  check("'today' mid-call: today shows", onToday.app && onToday.today && onToday.on === "today", onToday);
  check("…with the call as a small bubble", onToday.room && onToday.mini && onToday.w < 140 && onToday.bottom <= 844, onToday);
  check("…still connected, camera still on", /connected/.test(onToday.status) && onToday.camLive, onToday);
  check("…and his video + voice still playing", onToday.remotePlaying && await advancing(ana), onToday);
  check("…while he still sees her", /connected/.test((await view(dev)).status) && await advancing(dev));
  check("the today button says 'back to the call'", onToday.start === "back to the call →", onToday.start);

  await dev.fill("#hg-chat-input", "look at the tracker");
  await dev.click(".hg-send");
  await ana.waitForFunction(() => !document.getElementById("hg-mini-unread").hidden, null, { timeout: 5000 }).catch(() => {});
  check("his message shows on the bubble", (await view(ana)).unread === 1, await view(ana));

  await ana.click("#hg-mini");
  const back = await view(ana);
  check("tapping the bubble: back in the full call", back.room && !back.mini && !back.app && back.on === "hangout", back);
  check("…the message is read, no hearts sent by the tap", back.unread === 0 && back.hearts === 0, back);
  check("…same call, still connected", /connected/.test(back.status) && back.camLive && back.remotePlaying, back);

  await ana.click('.app-tab[data-tab="pair"]');
  const onPair = await view(ana);
  check("'pair up' mid-call: also a bubble", onPair.pair && onPair.mini && onPair.on === "pair" && onPair.camLive, onPair);
  await ana.click('.app-tab[data-tab="hangout"]');
  const viaTab = await view(ana);
  check("'cozy room' tab: back to the same call", !viaTab.mini && viaTab.room && /connected/.test(viaTab.status) && viaTab.camLive, viaTab);

  await ana.click('.app-tab[data-tab="today"]');
  await ana.click("#start-hangout");
  check("'back to the call' button works", !(await view(ana)).mini && !(await view(ana)).app);

  await ana.click("#hg-hangup");
  const left = await view(ana);
  check("leave: call over, no bubble", left.app && !left.room && !left.mini && left.start === "start a hangout →", left);
  check("…and the tabs land where she was", left.today && left.on === "today", left);
  await ctx.close();
}

// 2) The welcome page fits a small phone, title once
{
  const ctx = await b.newContext({ viewport: { width: 360, height: 640 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push("welcome PAGEERROR " + e.message));
  await p.addInitScript(SETUP, null);
  await p.goto(`${origin}/index.html`);
  await p.waitForFunction(() => !document.getElementById("screen-welcome").hidden, null, { timeout: 10000 });
  await p.waitForTimeout(600);   // card pop-in animation
  const w = await p.evaluate(() => ({
    header: !document.getElementById("app-header").hidden,
    signinBottom: Math.round(document.getElementById("go-signin").getBoundingClientRect().bottom),
    scrollH: document.documentElement.scrollHeight, scrollW: document.documentElement.scrollWidth,
  }));
  check("welcome: no second title above the card", !w.header, w);
  check("welcome: both buttons on screen, nothing to scroll", w.signinBottom <= 640 && w.scrollH <= 640 && w.scrollW <= 360, w);
  await p.click("#go-signin");
  await p.waitForTimeout(600);
  // The header used to sit on top of a full screen of its own, so every page
  // was a header taller than the phone, the card pushed half a screen down.
  const s = await p.evaluate(() => ({
    header: !document.getElementById("app-header").hidden,
    submitBottom: Math.round(document.getElementById("signin-submit").getBoundingClientRect().bottom),
    scrollH: document.documentElement.scrollHeight,
  }));
  check("sign-in: title + card fit one screen, no gap pushing it down", s.header && s.scrollH <= 640 && s.submitBottom <= 640, s);
  await ctx.close();
}

check("no page errors", errs.length === 0, errs);
await b.close();
server.close();
done();
