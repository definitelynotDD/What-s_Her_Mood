// Two real Chromium tabs on one real WebRTC call, with fake camera/mic/screen
// and Supabase faked over BroadcastChannel (fixtures/mock-supabase.js). Each
// test gets a fresh browser context.
//
//   node hangout.test.mjs                      all tests
//   node hangout.test.mjs share_and_stop,...   just these
//   VERBOSE=1 node hangout.test.mjs            with every console line
import { startServer } from "./lib/server.mjs";
import { launch, MEDIA_ARGS } from "./lib/browser.mjs";

const ONLY = process.argv[2] ? process.argv[2].split(",") : null;
const { server, origin } = startServer();

const browser = await launch([
  ...MEDIA_ARGS,
  "--autoplay-policy=no-user-gesture-required",
  "--disable-features=WebRtcHideLocalIpsWithMdns",
  "--auto-select-desktop-capture-source=Entire screen",
]);

const INIT = () => {
  const Orig = window.RTCPeerConnection;
  window.__pcs = [];
  window.RTCPeerConnection = class extends Orig { constructor(...a) { super(...a); window.__pcs.push(this); } };
  const AC = window.AudioContext;
  window.__actx = []; window.__bufSrc = 0;
  window.AudioContext = class extends AC { constructor(...a) { super(...a); window.__actx.push(this); } };
  const cbs = AC.prototype.createBufferSource;
  AC.prototype.createBufferSource = function (...a) { window.__bufSrc++; return cbs.apply(this, a); };
  window.__state = () => {
    const g = (id) => document.getElementById(id);
    const tr = (el) => el && el.srcObject ? el.srcObject.getTracks().map((t) => t.kind + ":" + t.readyState) : null;
    const pc = window.__pcs.filter((p) => p.connectionState !== "closed").pop();
    return {
      status: g("hg-status").textContent, net: g("hg-net") ? g("hg-net").textContent : null,
      sharing: g("hg-stage").classList.contains("sharing"),
      remote: tr(g("hg-remote")), remoteW: g("hg-remote").videoWidth,
      scv: tr(g("hg-screencast")), scvW: g("hg-screencast").videoWidth, scvMuted: g("hg-screencast").muted,
      pc: pc ? pc.connectionState + "/" + pc.signalingState : null,
      pcs: window.__pcs.length,
      sent: window.__mock ? window.__mock.sent.slice(-12) : null,
    };
  };
};

async function tab(ctx, me, partner) {
  const page = await ctx.newPage();
  page.on("console", (m) => { if (process.env.VERBOSE || /warn|error/.test(m.type())) console.log(`  [${me} ${m.type()}] ${m.text()}`); });
  page.on("pageerror", (e) => console.log(`  [${me} PAGEERROR] ${e.message}`));
  await page.addInitScript(INIT);
  await page.goto(`${origin}/hangout.html?me=${me}&partner=${partner}`);
  await page.waitForFunction(() => window.__ready);
  return page;
}
const wait = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout, polling: 200 });
const st = (p) => p.evaluate(() => window.__state());

async function connectedPair(ctx) {
  const A = await tab(ctx, "aaa", "bbb");   // "aaa" < "bbb" → A is polite
  const B = await tab(ctx, "bbb", "aaa");
  await A.evaluate(() => window.__open());
  await B.evaluate(() => window.__open());
  for (const p of [A, B]) await wait(p, () => { const s = window.__state(); return s.pc === "connected/stable" && s.remoteW > 0; });
  return { A, B };
}
async function shareFrom(P) { await P.click("#hg-screen"); }
async function seesShare(P, timeout) {
  await wait(P, () => { const s = window.__state(); return s.sharing && s.scvW > 0 && !s.scvMuted; }, null, timeout);
}


// mean position of the hearts currently on P's stage, in px relative to the viewport
async function heartCentroid(P) {
  return P.evaluate(() => {
    const st = document.getElementById("hg-stage").getBoundingClientRect();
    const hs = [...document.querySelectorAll("#hg-stage .wm-heart")];
    if (!hs.length) return null;
    const xs = hs.map((h) => st.left + parseFloat(h.style.left) / 100 * st.width);
    const ys = hs.map((h) => st.top + parseFloat(h.style.top) / 100 * st.height);
    return { x: xs.reduce((a, b) => a + b) / xs.length, y: ys.reduce((a, b) => a + b) / ys.length, stageW: st.width, stageH: st.height };
  });
}
const rectOf = (P, id) => P.evaluate((id) => { const r = document.getElementById(id).getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; }, id);

const tests = {
  async basic_connect_and_voice_tuning(ctx) {
    const { A, B } = await connectedPair(ctx);
    const info = await A.evaluate(async () => {
      const pc = window.__pcs.at(-1);
      const s = await pc.getStats(); let codec = null, pr = null;
      // Chrome's stats name the inner codec (opus) even when wrapped in RED, so read the SDP.
      const m = pc.currentRemoteDescription.sdp.split("\r\n").find((l) => l.startsWith("m=audio")).split(" ")[3];
      const rtpmap = pc.currentRemoteDescription.sdp.split("\r\n").find((l) => l.startsWith("a=rtpmap:" + m + " "));
      codec = "audio/" + rtpmap.split(" ")[1].split("/")[0];
      const snd = pc.getSenders().find((x) => x.track && x.track.kind === "audio");
      pr = snd.getParameters().encodings.map((e) => e.priority + "/" + e.networkPriority);
      const caps = RTCRtpReceiver.getCapabilities("audio").codecs.map((c) => c.mimeType);
      return { codec, pr, capsHasRed: caps.includes("audio/red") };
    });
    console.log("  audio:", JSON.stringify(info));
    await wait(A, () => /voice clear/.test(window.__state().net || ""), null, 15000);
    console.log("  readout:", (await st(A)).net);
    if (info.capsHasRed && info.codec !== "audio/red") throw new Error("RED available but not negotiated: " + info.codec);
    if (!info.pr.every((x) => x.startsWith("high"))) throw new Error("audio priority not high: " + info.pr);
  },

  async share_and_stop(ctx) {
    const { A, B } = await connectedPair(ctx);
    await shareFrom(A);
    await seesShare(B);
    const a = await st(A);
    if (!a.sharing || !a.scvMuted) throw new Error("sharer's own preview should show and be muted: " + JSON.stringify(a));
    await A.click("#hg-screen"); // stop
    await wait(B, () => !window.__state().sharing);
  },

  async share_after_partner_shared_is_audible(ctx) {
    const { A, B } = await connectedPair(ctx);
    await shareFrom(A); await seesShare(B);
    await A.click("#hg-screen"); await wait(B, () => !window.__state().sharing);
    await shareFrom(B); await seesShare(A);   // seesShare requires !muted
  },

  async share_after_signaling_channel_closed(ctx) {
    // What a >1h call with a hidden tab does: Realtime closes the channel.
    const { A, B } = await connectedPair(ctx);
    await A.evaluate(() => window.__mock.killChannels());
    await B.evaluate(() => window.__mock.killChannels());
    await new Promise((r) => setTimeout(r, 2500));
    const media = await st(B);
    console.log("  after channel death, call still:", media.pc);
    await shareFrom(A);
    await seesShare(B, 20000);
    // chat must work again too
    await A.fill("#hg-chat-input", "still here?"); await A.press("#hg-chat-input", "Enter");
    await wait(B, () => /still here\?/.test(document.getElementById("hg-chat-log").textContent));
  },

  async share_survives_lost_offer(ctx) {
    const { A, B } = await connectedPair(ctx);
    await A.evaluate(() => { window.__mock.dropOutDescriptions = 1; });
    await shareFrom(A);
    await seesShare(B, 20000);
    console.log("  A sent:", (await st(A)).sent.join(" "));
  },

  async share_survives_lost_offer_and_lost_answer(ctx) {
    const { A, B } = await connectedPair(ctx);
    await A.evaluate(() => { window.__mock.dropOutDescriptions = 1; });
    await B.evaluate(() => { window.__mock.dropOutDescriptions = 1; });
    await shareFrom(B);       // impolite side shares
    await seesShare(A, 30000);
  },

  async share_survives_lost_answer(ctx) {
    const { A, B } = await connectedPair(ctx);
    await A.evaluate(() => { window.__mock.dropOutDescriptions = 1; });  // A's answer to B's offer
    await shareFrom(B);
    await seesShare(A, 20000);
  },

  async repeated_share_cycles_with_channel_drops(ctx) {
    const { A, B } = await connectedPair(ctx);
    for (let i = 0; i < 4; i++) {
      const [S, V] = i % 2 ? [B, A] : [A, B];
      if (i === 2) { await A.evaluate(() => window.__mock.killChannels()); await new Promise((r) => setTimeout(r, 200)); }
      await shareFrom(S); await seesShare(V, 20000);
      await S.click("#hg-screen"); await wait(V, () => !window.__state().sharing);
    }
  },

  async share_survives_lost_screen_on(ctx) {
    const { A, B } = await connectedPair(ctx);
    await A.evaluate(() => { window.__mock.dropOutEvents.add("screen-on"); window.__mock.dropOutEvents.add("screen-off"); });
    await shareFrom(A);
    await seesShare(B);
    await A.click("#hg-screen");
    await wait(B, () => !window.__state().sharing);   // via track removal
  },

  async connects_after_every_candidate_was_lost(ctx) {
    // Signaling finishes but no ICE candidate ever arrives (lost messages, or
    // Chrome's gathering stalling after the polite side rolls back its own
    // offer when both open the room at once). ICE then sits at "new" forever
    // and never reaches "failed", so only a watchdog restart can recover it.
    const A = await tab(ctx, "aaa", "bbb"), B = await tab(ctx, "bbb", "aaa");
    for (const P of [A, B]) await P.evaluate(() => { window.__mock.dropOutCandidates = true; });
    await A.evaluate(() => window.__open()); await B.evaluate(() => window.__open());
    for (const P of [A, B]) await wait(P, () => /\/stable$/.test(window.__state().pc || "") && window.__pcs.at(-1).remoteDescription);
    await new Promise((r) => setTimeout(r, 1500));
    const stuck = await st(A);
    if (stuck.pc.startsWith("connected")) throw new Error("connected without candidates — test isn't exercising the stall");
    for (const P of [A, B]) await P.evaluate(() => { window.__mock.dropOutCandidates = false; });
    // ~6s to notice, then a fresh connection — which can itself hit the same
    // race now and then, hence room for a second try
    for (const P of [A, B]) await wait(P, () => { const s = window.__state(); return s.pc === "connected/stable" && s.remoteW > 0; }, null, 30000);
  },

  async partner_rejoins_while_other_stays(ctx) {
    const { A, B } = await connectedPair(ctx);
    await shareFrom(A); await seesShare(B);
    await B.evaluate(() => window.__close());
    await wait(A, () => /left the room/.test(window.__state().status));
    await new Promise((r) => setTimeout(r, 500));
    await B.evaluate(() => window.__open());
    for (const p of [A, B]) await wait(p, () => { const s = window.__state(); return s.pc === "connected/stable" && s.remoteW > 0; }, null, 20000);
    await seesShare(B, 20000);   // A's ongoing share carried onto the fresh connection
  },

  async partner_reload_without_bye(ctx) {
    const { A, B } = await connectedPair(ctx);
    await B.evaluate(() => { window.__mock.dropOut = true; window.__close(); });   // bye lost
    await B.reload(); await B.waitForFunction(() => window.__ready);
    await B.evaluate(() => window.__open());
    for (const p of [A, B]) await wait(p, () => { const s = window.__state(); return s.pc === "connected/stable" && s.remoteW > 0; }, null, 20000);
  },

  async token_refreshed_when_near_expiry(ctx) {
    const A = await tab(ctx, "aaa", "bbb");
    await A.evaluate(() => { window.__mock.expiresIn = 120; });
    await A.evaluate(() => window.__open());
    await wait(A, () => window.__mock.refreshCalls >= 1, null, 5000);
  },

  // ---- app-wide Realtime (pairing / tracker) ----
  async todos_catch_up_after_channel_closed(ctx) {
    const P = await tab(ctx, "aaa", "bbb");
    await P.evaluate(() => {
      window.__db.todos = [{ id: "1", user_id: "her", title: "milk", done: false }];
      window.__lists = [];
      window.__unsub = window.__rt.watchTodos("her", (l) => window.__lists.push(l.map((t) => t.title).join(",")));
    });
    await wait(P, () => window.__lists.at(-1) === "milk");
    await P.evaluate(() => {
      window.__mock.killChannels();
      // she adds a to-do while this tab's channel is dead — no change event arrives
      window.__db.todos.push({ id: "2", user_id: "her", title: "flowers", done: false });
    });
    try { await wait(P, () => window.__lists.at(-1) === "milk,flowers", null, 8000); } catch (e) { console.log("  lists:", JSON.stringify(await P.evaluate(() => [window.__lists, window.__mock.channelsCreated, [...window.__mock.live].map((c) => c.topic + ":" + c.state)]))); throw e; }
    // and live updates flow again on the rebuilt channel
    await P.evaluate(() => { window.__db.todos.push({ id: "3", user_id: "her", title: "tea", done: false }); window.__mock.emitChange("todos", {}); });
    await wait(P, () => window.__lists.at(-1) === "milk,flowers,tea");
    const created = await P.evaluate(() => { window.__unsub(); return { created: window.__mock.channelsCreated, live: window.__mock.live.size }; });
    if (created.created !== 2 || created.live !== 0) throw new Error("expected 1 rebuild and clean close: " + JSON.stringify(created));
  },

  async quick_error_recovery_does_not_rebuild(ctx) {
    const P = await tab(ctx, "aaa", "bbb");
    const r = await P.evaluate(async () => {
      const joins = [];
      const h = window.__rt.keepSubscribed("x", { setup: () => {}, onJoin: () => joins.push("join") });
      await new Promise((r) => setTimeout(r, 200));
      window.__mock.errorChannels(500);              // supabase-js's own rejoin wins
      await new Promise((r) => setTimeout(r, 6500));  // past the 5s repair deadline
      const out = { joins, created: window.__mock.channelsCreated };
      h.close();
      return out;
    });
    if (r.created !== 1 || r.joins.length !== 2) throw new Error(JSON.stringify(r));
  },

  async stuck_error_rebuilds(ctx) {
    const P = await tab(ctx, "aaa", "bbb");
    const r = await P.evaluate(async () => {
      const joins = [];
      const h = window.__rt.keepSubscribed("x", { setup: () => {}, onJoin: () => joins.push("join") });
      await new Promise((r) => setTimeout(r, 200));
      window.__mock.errorChannels(null);             // never recovers on its own
      await new Promise((r) => setTimeout(r, 6000));
      const out = { joins, created: window.__mock.channelsCreated };
      h.close();
      return out;
    });
    if (r.created !== 2 || r.joins.length !== 2) throw new Error(JSON.stringify(r));
  },

  async pairing_row_not_rerendered_when_unchanged(ctx) {
    const P = await tab(ctx, "aaa", "bbb");
    await P.evaluate(() => {
      window.__db.users = [{ id: "me", paired_with: null, display_name: "dev" }];
      window.__rows = [];
      window.__rt.watchMyUserRow("me", (r) => window.__rows.push(r.paired_with));
    });
    await wait(P, () => window.__rows.length === 1);
    await P.evaluate(() => window.__mock.killChannels());
    await new Promise((r) => setTimeout(r, 2000));
    if ((await P.evaluate(() => window.__rows.length)) !== 1) throw new Error("re-rendered an identical row after rejoin");
    await P.evaluate(() => { window.__db.users[0].paired_with = "her"; window.__mock.killChannels(); });
    await wait(P, () => window.__rows.at(-1) === "her", null, 8000);   // pairing that happened while down is caught
  },

  // ---- microphone ----
  async mic_switch_keeps_call_and_mute(ctx) {
    const { A, B } = await connectedPair(ctx);
    await wait(A, () => !document.getElementById("hg-mic-pick-wrap").hidden);
    await A.click("#hg-mic");                                // mute first
    const target = await A.evaluate(() => [...document.querySelectorAll("#hg-mic-pick option")].find((o) => o.textContent === "Fake Audio Input 2").value);
    const sdpBefore = (await st(A)).sent.filter((x) => x.startsWith("sdp")).length;
    await A.selectOption("#hg-mic-pick", target);
    await wait(A, (id) => {
      const snd = window.__pcs.at(-1).getSenders().find((x) => x.track && x.track.kind === "audio");
      return snd.track.getSettings().deviceId === id && document.getElementById("hg-mic-pick").value === id;
    }, target);
    const r = await A.evaluate(() => {
      const snd = window.__pcs.at(-1).getSenders().find((x) => x.track && x.track.kind === "audio");
      return { enabled: snd.track.enabled, pref: localStorage.getItem("whm.hangout.mic") };
    });
    if (r.enabled !== false) throw new Error("mute was lost on mic switch");
    if (r.pref !== target) throw new Error("mic choice not remembered");
    const sdpAfter = (await st(A)).sent.filter((x) => x.startsWith("sdp")).length;
    if (sdpAfter !== sdpBefore) throw new Error("mic switch triggered a renegotiation");
    // partner still receives audio packets from the new mic
    const pk = async () => B.evaluate(async () => { let n = 0; (await window.__pcs.at(-1).getStats()).forEach((x) => { if (x.type === "inbound-rtp" && x.kind === "audio") n += x.packetsReceived; }); return n; });
    const n1 = await pk(); await new Promise((r) => setTimeout(r, 1500)); const n2 = await pk();
    if (!(n2 > n1)) throw new Error("partner stopped receiving audio after mic switch");
  },

  async bluetooth_hint_switches_to_built_in_mic(ctx) {
    const A = await tab(ctx, "aaa", "bbb");
    await A.evaluate(() => {
      const orig = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
      const names = { "Fake Default Audio Input": "Default - AirPods Pro", "Fake Audio Input 1": "AirPods Pro", "Fake Audio Input 2": "MacBook Pro Microphone (Built-in)" };
      navigator.mediaDevices.enumerateDevices = async () => (await orig()).map((d) => ({ kind: d.kind, deviceId: d.deviceId, groupId: d.groupId, label: names[d.label] || d.label }));
      window.__open();
    });
    await wait(A, () => !document.getElementById("hg-bt-hint").hidden);
    const text = await A.textContent("#hg-bt-hint-text");
    if (!/MacBook Pro Microphone/.test(text)) throw new Error("hint suggests the wrong mic: " + text);
    await A.click("#hg-bt-switch");
    await wait(A, () => document.getElementById("hg-bt-hint").hidden && /MacBook/.test(document.getElementById("hg-mic-pick").selectedOptions[0].textContent));
  },

  async mic_unplugged_falls_back(ctx) {
    const { A, B } = await connectedPair(ctx);
    const r = await A.evaluate(async () => {
      const snd = window.__pcs.at(-1).getSenders().find((x) => x.track && x.track.kind === "audio");
      const before = snd.track;
      before.dispatchEvent(new Event("ended"));        // what a disconnected device does
      await new Promise((r) => setTimeout(r, 1000));
      return { swapped: snd.track !== before, live: snd.track.readyState, oldStopped: before.readyState };
    });
    if (!r.swapped || r.live !== "live") throw new Error("mic not replaced after it ended: " + JSON.stringify(r));
  },

  async turn_credentials_url_used_and_falls_back(ctx) {
    const A = await tab(ctx, "aaa", "bbb");
    const ok = await A.evaluate(async () => {
      window.WHM_CONFIG = { webrtc: { iceServersUrl: "/__fixtures__/ice.json" } };
      await window.__open();
      return window.__pcs.at(-1).getConfiguration().iceServers.map((s) => [].concat(s.urls).join());
    });
    if (ok.join() !== "stun:stun.example.test:3478") throw new Error("fetched servers not used: " + ok);
    const fb = await A.evaluate(async () => {
      window.__close();
      window.WHM_CONFIG = { webrtc: { iceServersUrl: "/nope.json", iceServers: [{ urls: "stun:fallback.test:3478" }] } };
      await window.__open();
      return window.__pcs.at(-1).getConfiguration().iceServers.map((s) => [].concat(s.urls).join());
    });
    if (fb.join() !== "stun:fallback.test:3478") throw new Error("no fallback: " + fb);
  },

  // ---- hearts land on the tapped person's face ----
  async hearts_on_partner_face_land_on_their_self_view(ctx) {
    const { A, B } = await connectedPair(ctx);
    const r = await rectOf(A, "hg-remote");                     // B's face on A's screen (16:10, crops top/bottom)
    await A.mouse.click(r.left + 0.25 * r.width, r.top + 0.5 * r.height);
    await wait(B, () => document.querySelectorAll("#hg-stage .wm-heart").length > 0);
    const c = await heartCentroid(B), pip = await rectOf(B, "hg-local");
    // B's own preview is 4:3 (no crop for a 4:3 camera) and mirrored: camera x 0.25 shows at 0.75 across
    const ex = pip.left + 0.75 * pip.width, ey = pip.top + 0.5 * pip.height;
    if (Math.abs(c.x - ex) > 0.04 * c.stageW || Math.abs(c.y - ey) > 0.04 * c.stageH)
      throw new Error(`hearts at ${c.x.toFixed(0)},${c.y.toFixed(0)} — expected ~${ex.toFixed(0)},${ey.toFixed(0)} on B's own preview`);
  },

  async hearts_on_own_face_land_on_you_for_partner(ctx) {
    const { A, B } = await connectedPair(ctx);
    const pip = await rectOf(A, "hg-local");                    // A's own (mirrored) preview
    await A.mouse.click(pip.left + 0.25 * pip.width, pip.top + 0.5 * pip.height);
    await wait(B, () => document.querySelectorAll("#hg-stage .wm-heart").length > 0);
    const c = await heartCentroid(B), big = await rectOf(B, "hg-remote");
    // display 0.25 on a mirrored preview = camera x 0.75; B's big video isn't mirrored; v 0.5 = vertical centre
    const ex = big.left + 0.75 * big.width, ey = big.top + 0.5 * big.height;
    if (Math.abs(c.x - ex) > 0.04 * c.stageW || Math.abs(c.y - ey) > 0.04 * c.stageH)
      throw new Error(`hearts at ${c.x.toFixed(0)},${c.y.toFixed(0)} — expected ~${ex.toFixed(0)},${ey.toFixed(0)} on A's face`);
  },

  async hearts_from_older_build_still_show(ctx) {
    const { A, B } = await connectedPair(ctx);
    await A.evaluate(() => [...window.__mock.live][0].send({ type: "broadcast", event: "heart", payload: { from: "aaa", x: 10, y: 20 } }));
    await wait(B, () => document.querySelectorAll("#hg-stage .wm-heart").length > 0);
    const c = await heartCentroid(B), st = await rectOf(B, "hg-stage");
    const ex = st.left + 0.10 * st.width, ey = st.top + 0.20 * st.height;
    if (Math.abs(c.x - ex) > 0.04 * c.stageW || Math.abs(c.y - ey) > 0.04 * c.stageH)
      throw new Error("old-style x/y heart misplaced");
  },

  // ---- camera-off notice ----
  async camera_off_shows_on_both_sides(ctx) {
    const { A, B } = await connectedPair(ctx);
    const vis = (id) => { const el = document.getElementById(id); return el.dataset.on === "1" && getComputedStyle(el).display !== "none"; };
    await A.click("#hg-cam");
    await wait(A, vis, "hg-local-camoff");
    await wait(B, vis, "hg-remote-camoff");
    if (await B.evaluate(vis, "hg-local-camoff")) throw new Error("partner's own preview wrongly covered");
    await A.click("#hg-cam");
    await wait(A, (id) => !document.getElementById(id).dataset.on || document.getElementById(id).dataset.on === "0", "hg-local-camoff");
    await wait(B, (id) => document.getElementById(id).dataset.on === "0", "hg-remote-camoff");
  },

  async camera_off_state_survives_partner_rejoin(ctx) {
    const { A, B } = await connectedPair(ctx);
    await A.click("#hg-cam");
    await wait(B, () => document.getElementById("hg-remote-camoff").dataset.on === "1");
    await B.evaluate(() => window.__close());
    if ((await B.evaluate(() => document.getElementById("hg-remote-camoff").dataset.on)) !== "0") throw new Error("cover not reset on leave");
    await B.evaluate(() => window.__open());
    await wait(B, () => document.getElementById("hg-remote-camoff").dataset.on === "1", null, 15000);
    // and leaving resets A's own button + cover
    await A.evaluate(() => window.__close());
    const a = await A.evaluate(() => ({ cover: document.getElementById("hg-local-camoff").dataset.on, label: document.querySelector("#hg-cam .hg-ctl-label").textContent }));
    if (a.cover !== "0" || a.label !== "camera on") throw new Error("not reset on leave: " + JSON.stringify(a));
  },

  // ---- slap ----
  async slap_lands_on_partner_with_sound(ctx) {
    const { A, B } = await connectedPair(ctx);
    await A.click("#hg-slap");
    const where = (P, wrapSel) => P.evaluate((wrapSel) => {
      const fx = document.querySelector("#hg-stage .slap-fx"); if (!fx) return null;
      const f = fx.getBoundingClientRect(), w = document.querySelector(wrapSel).getBoundingClientRect();
      const cx = f.left + f.width / 2, cy = f.top + f.height / 2;
      const st = document.getElementById("hg-stage");
      return { inside: cx >= w.left && cx <= w.right && cy >= w.top && cy <= w.bottom,
               shake: st.classList.contains("slap-shake-big") ? "big" : st.classList.contains("slap-shake") ? "small" : "none",
               cheek: document.querySelector(wrapSel).classList.contains("slap-hit"),
               sound: window.__bufSrc, audio: window.__actx.map((a) => a.state) };
    }, wrapSel);
    await wait(B, () => !!document.querySelector("#hg-stage .slap-fx"));
    const a = await where(A, ".hg-remote-wrap"), b = await where(B, ".hg-local-wrap");
    if (!a || !a.inside || a.shake !== "small" || !a.cheek) throw new Error("sender view wrong: " + JSON.stringify(a));
    if (!b || !b.inside || b.shake !== "big" || !b.cheek) throw new Error("receiver view wrong: " + JSON.stringify(b));
    await new Promise((r) => setTimeout(r, 400));   // sound is scheduled for the moment of impact
    const sa = await A.evaluate(() => window.__bufSrc), sb = await B.evaluate(() => window.__bufSrc);
    if (!(sa >= 1 && sb >= 1)) throw new Error("no slap sound: " + JSON.stringify({ sa, sb, a: a.audio, b: b.audio }));
    await wait(B, () => !document.querySelector("#hg-stage .slap-fx") && !document.getElementById("hg-stage").className.includes("slap"), null, 3000);
  },

  async slap_spam_is_throttled(ctx) {
    const { A, B } = await connectedPair(ctx);
    for (let i = 0; i < 5; i++) await A.click("#hg-slap");
    await new Promise((r) => setTimeout(r, 500));
    const sent = (await st(A)).sent.filter((x) => x === "slap").length;
    if (sent !== 1) throw new Error("5 quick taps sent " + sent + " slaps");
  },

  async slap_reduced_motion_is_still(ctx) {
    const { A, B } = await connectedPair(ctx);
    await B.emulateMedia({ reducedMotion: "reduce" });
    await A.click("#hg-slap");
    await wait(B, () => !!document.querySelector("#hg-stage .slap-fx"));
    const r = await B.evaluate(() => ({
      still: document.querySelector(".slap-fx").classList.contains("slap-still"),
      pow: getComputedStyle(document.querySelector(".slap-pow")).opacity,
      hand: getComputedStyle(document.querySelector(".slap-hand")).display,
      shake: document.getElementById("hg-stage").className.includes("slap-shake"),
    }));
    if (!r.still || r.pow !== "1" || r.hand !== "none" || r.shake) throw new Error(JSON.stringify(r));
  },

  async leave_while_camera_pending_does_not_leak(ctx) {
    const A = await tab(ctx, "aaa", "bbb");
    const r = await A.evaluate(async () => {
      const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      let stream;
      navigator.mediaDevices.getUserMedia = async (c) => { await new Promise((r) => setTimeout(r, 300)); stream = await orig(c); return stream; };
      window.__open(); window.__close();
      await new Promise((r) => setTimeout(r, 800));
      return { live: stream.getTracks().filter((t) => t.readyState === "live").length, pcs: window.__pcs.length };
    });
    if (r.live || r.pcs) throw new Error("camera left running after leave: " + JSON.stringify(r));
  },
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  if (ONLY && !ONLY.includes(name)) continue;
  const ctx = await browser.newContext({ permissions: ["camera", "microphone"] });
  const t0 = Date.now();
  try { await fn(ctx); console.log(`PASS ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`); }
  catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e.message.split("\n")[0]}`);
    for (const p of ctx.pages()) { try { console.log("   state", p.url().split("?")[1], JSON.stringify(await st(p))); } catch (_) {} }
  }
  await ctx.close();
}
await browser.close(); server.close();
console.log(failed ? `${failed} FAILED` : "ALL PASSED");
process.exit(failed ? 1 : 0);
