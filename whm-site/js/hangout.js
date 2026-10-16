// ─────────────────────────────────────────────────────────────
// hangout.js
// A private 2-person "hangout room": video call + screen share + ephemeral
// text chat, for the paired couple. WebRTC media is peer-to-peer; Supabase
// Realtime is only the matchmaker (signaling + presence + chat relay).
//
// The room channel is derived from the two user IDs, so only the pair share it.
// Negotiation waits until BOTH are present (Realtime broadcast isn't retained,
// so an offer sent before the partner joins would be lost).
//
// Long calls: the media keeps flowing P2P even if signaling dies, but anything
// that needs a renegotiation (screen share) or the channel (chat, hearts)
// silently stops. Signaling died after ~1h because supabase-js only refreshes
// the auth token while the tab is visible — switch to the tab you're sharing
// and the token expires, Realtime closes the channel, and nothing re-opened it.
// So the room now (1) keeps the token fresh itself, (2) rebuilds the channel
// whenever it drops, and (3) rtc.js re-sends offers that went unanswered.
// ─────────────────────────────────────────────────────────────
import { supabase } from "./supabase-init.js";
import { createPeer, tuneVoiceSender, setVoicePriority } from "./rtc.js";
import { spawnHearts, spawnHeartsAt } from "./effects.js";

const $ = (id) => document.getElementById(id);

const AUTH_CHECK_MS = 60 * 1000;          // how often to look at the token during a call
const AUTH_REFRESH_MARGIN_S = 5 * 60;     // refresh when it has less than this left
const QUALITY_SAMPLE_MS = 4000;

let room = null;     // active room state, or null
let opening = 0;     // id of an openHangout() still waiting on the camera, 0 = none
let openSeq = 0;
let heartsWired = false;

function coupleKey(a, b) { return [a, b].sort().join("__"); }

function iceServers() {
  const cfg = window.WHM_CONFIG && window.WHM_CONFIG.webrtc;
  if (cfg && Array.isArray(cfg.iceServers) && cfg.iceServers.length) return cfg.iceServers;
  return [{ urls: "stun:stun.l.google.com:19302" }];
}

function status(msg) { const el = $("hg-status"); if (el) el.textContent = msg; }
function partnerLabel() { return (room && room.partnerName) || "your partner"; }

function addChat(text, who, name) {
  const log = $("hg-chat-log");
  if (!log) return;
  const row = document.createElement("div");
  row.className = "hg-msg " + (who === "me" ? "me" : "them");
  const b = document.createElement("span"); b.className = "hg-msg-who"; b.textContent = who === "me" ? "you" : (name || "them");
  const t = document.createElement("span"); t.className = "hg-msg-text"; t.textContent = text;
  row.appendChild(b); row.appendChild(t);
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
}

function playInto(el, stream) {
  if (!el || el.srcObject === stream) return;
  el.srcObject = stream;
  if (!stream) return;
  const p = el.play && el.play();
  if (p && typeof p.catch === "function") p.catch(() => {});
}

// supabase-js pauses its own token refresh while the tab is hidden, and the
// Realtime server closes channels whose token has expired. During a call the
// tab is often hidden (you switched to what you're sharing), so refresh here.
// supabase-js forwards the new token to Realtime on TOKEN_REFRESHED.
async function keepAuthFresh() {
  try {
    const { data } = await supabase.auth.getSession();
    const s = data && data.session;
    if (!s || !s.expires_at) return;
    if (s.expires_at - Date.now() / 1000 > AUTH_REFRESH_MARGIN_S) return;
    const { error } = await supabase.auth.refreshSession();
    if (error) console.warn("[hangout] token refresh failed", error.message || error);
  } catch (err) {
    console.warn("[hangout] token refresh failed", err);
  }
}

export async function openHangout({ me, partner, myName, partnerName, onExit }) {
  if (room || opening) return; // already open / opening
  const seq = opening = ++openSeq;

  $("hg-partner").textContent = partnerName || "your partner";
  $("hg-chat-log").innerHTML = "";
  status("getting your camera ready…");

  // Hide screen-share on browsers that can't do it (e.g. iOS Safari web).
  const canShare = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
  if ($("hg-screen")) $("hg-screen").hidden = !canShare;

  let localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      // Browsers default these on; spelled out so nobody "simplifies" them off.
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    if (opening === seq) opening = 0;
    status("couldn't get camera/mic — check the browser permission and that you're on https.");
    return;
  }
  if (opening !== seq) { localStream.getTracks().forEach((t) => t.stop()); return; } // left while we waited
  opening = 0;

  const localVid = $("hg-local");
  localVid.srcObject = localStream;
  localVid.muted = true;
  localVid.play && localVid.play().catch(() => {});

  room = {
    me, partner, myName, partnerName, localStream,
    polite: String(me) < String(partner),
    // When this session started. The partner compares it to the last one they
    // saw to tell "you left and came back" (rebuild the connection) from a
    // late message from your previous session (ignore it).
    since: Date.now(),
    partnerSince: null,
    partnerCam: null,        // partner's camera MediaStream id, from their messages
    partnerHere: false,
    peer: null, peerHasTracks: false, micSender: null,
    remote: { cameraId: null, share: null },
    screenStream: null, screenSenders: [],
    channel: null, channelJoined: false, repairTimer: null, repairAttempt: 0,
    authTimer: null, qualityTimer: null, lastQ: null,
    _onExit: onExit,
  };

  buildPeer();
  openChannel();
  keepAuthFresh();
  room.authTimer = setInterval(keepAuthFresh, AUTH_CHECK_MS);
  room.qualityTimer = setInterval(sampleQuality, QUALITY_SAMPLE_MS);

  // ---- controls ----
  wireControls();
}

// ---- peer connection ----

function buildPeer() {
  if (room.peer) room.peer.close();
  const peer = createPeer({
    iceServers: iceServers(),
    polite: room.polite,
    sendSignal: (sig) => send("signal", { sig }),
    onRemoteStream: (stream) => { if (room && room.peer === peer) routeIncomingStream(stream); },
    onState: (st) => {
      if (!room || room.peer !== peer) return;
      if (st === "connecting") status("connecting…");
      else if (st === "connected") {
        status("connected ♡");
        if (room.micSender) setVoicePriority(room.micSender);
        sampleQuality();
      }
      else if (st === "disconnected") status("connection dropped — trying to recover…");
      else if (st === "failed") status("connection lost — reconnecting… (if it sticks, both leave and rejoin)");
    },
  });
  room.peer = peer;
  room.peerHasTracks = false;
  room.micSender = null;
  room.screenSenders = [];
  room.remote = { cameraId: null, share: null };
  room.lastQ = null;
}

// Partner left (or reloaded): their old connection is gone for good, so start
// a fresh one and wait for them. Our camera/screen tracks are re-added to it.
function resetPeer() {
  room.partnerHere = false;
  room.partnerCam = null;
  buildPeer();
  const rv = $("hg-remote");
  if (rv) rv.srcObject = null;
  applyRemoteMute(false);
  refreshStage();
}

function attachLocalTracks() {
  if (!room || room.peerHasTracks) return;
  room.peerHasTracks = true;
  const pc = room.peer.pc, ls = room.localStream;
  ls.getTracks().forEach((t) => {
    const sender = pc.addTrack(t, ls);
    if (t.kind === "audio") { room.micSender = sender; tuneVoiceSender(pc, sender); }
  });
  addScreenTracks();
}

function addScreenTracks() {
  if (!room || !room.screenStream || !room.peerHasTracks) return;
  // New senders (not replaceTrack) so the camera stays live next to the share.
  room.screenSenders = room.screenStream.getTracks().map((t) => room.peer.pc.addTrack(t, room.screenStream));
}

// Route incoming media by the MediaStream id the sender grouped it under:
// getUserMedia is one stream (camera + mic); getDisplayMedia is a second,
// separate stream. The partner tells us their camera's stream id; before we
// know it, first stream seen = camera, a later different one = screen.
function routeIncomingStream(stream) {
  if (!stream) return;
  const r = room.remote;
  const isCamera = room.partnerCam
    ? stream.id === room.partnerCam
    : (!r.cameraId || stream.id === r.cameraId);
  if (isCamera) {
    r.cameraId = stream.id;
    playInto($("hg-remote"), stream);
  } else {
    setRemoteShare(stream);
  }
  status("connected ♡");
}

// The share layout follows the actual screen track — arriving flips it on,
// the track going away flips it off. (It used to follow the screen-on/off
// broadcasts only, so one lost message left the partner staring at nothing.)
function setRemoteShare(stream) {
  room.remote.share = stream;
  stream.onremovetrack = () => {
    if (room && room.remote.share === stream && !stream.getVideoTracks().length) {
      room.remote.share = null;
      refreshStage();
    }
  };
  refreshStage();
}

// One screencast slot: the partner's share if there is one, else our own
// preview. Our own capture is always muted (playing it back would feed the
// shared audio into our mic); theirs must not be — it used to stay muted for
// the rest of the call once you had shared yourself.
function refreshStage() {
  if (!room) return;
  const scv = $("hg-screencast"), stage = $("hg-stage");
  const theirs = room.remote.share, mine = room.screenStream;
  const showing = theirs || mine || null;
  if (scv) {
    scv.muted = !theirs;
    playInto(scv, showing);
  }
  if (stage) stage.classList.toggle("sharing", !!showing);
}

function applyRemoteMute(muted) {
  if (typeof muted !== "boolean") return;
  const el = $("hg-remote-mute");
  if (el) el.dataset.on = muted ? "1" : "0";
}

function micMuted() {
  const tr = room && room.localStream.getAudioTracks()[0];
  return !!(tr && !tr.enabled);
}

// ---- signaling channel ----

function send(event, extra) {
  if (!room || !room.channel) return;
  room.channel.send({
    type: "broadcast", event,
    payload: { from: room.me, since: room.since, cam: room.localStream.id, ...extra },
  });
}

function sayHello() { send("hello", { muted: micMuted() }); }

// Every message from the partner goes through here. Returns false for our own
// echoes and for stale messages from a session they've since left.
function acceptFromPartner(payload) {
  if (!room || !payload || payload.from === room.me) return false;
  const since = Number(payload.since) || 0;   // 0 = sent by an older build without it
  if (since && room.partnerSince) {
    if (since < room.partnerSince) return false;
    if (since > room.partnerSince) {
      console.log("[hangout] partner rejoined — starting a fresh connection");
      resetPeer();
    }
  }
  if (since) room.partnerSince = since;
  if (payload.cam) room.partnerCam = payload.cam;
  markPartnerHere();
  return true;
}

// Rendezvous via a broadcast "hello" handshake instead of Realtime presence
// — presence hasn't been delivering reliably here, but broadcast (same feature
// chat rides on) is proven to work. Anything we hear from the partner counts
// as "they're here" and unlocks addTrack, so negotiation can start.
function markPartnerHere() {
  if (!room.partnerHere) {
    room.partnerHere = true;
    // Reply so partner also learns we're here — covers the case where their
    // initial hello was broadcast before we subscribed and was lost.
    sayHello();
  }
  if (!room.peerHasTracks) {
    status("connecting…");
    attachLocalTracks();
  }
}

function openChannel() {
  const ch = supabase.channel("hangout:" + coupleKey(room.me, room.partner), {
    config: { broadcast: { self: false }, presence: { key: String(room.me) } },
  });
  room.channel = ch;
  room.channelJoined = false;

  ch
    .on("broadcast", { event: "signal" }, ({ payload }) => {
      if (acceptFromPartner(payload)) room.peer.handleSignal(payload.sig);
    })
    .on("broadcast", { event: "hello" }, ({ payload }) => {
      if (!acceptFromPartner(payload)) return;
      applyRemoteMute(payload.muted);
      // They just (re)joined the channel and may have missed our last offer.
      room.peer.kick();
    })
    .on("broadcast", { event: "chat" }, ({ payload }) => {
      if (acceptFromPartner(payload)) addChat(payload.text, "them", room.partnerName);
    })
    .on("broadcast", { event: "mute" }, ({ payload }) => {
      if (acceptFromPartner(payload)) applyRemoteMute(payload.muted);
    })
    .on("broadcast", { event: "screen-off" }, ({ payload }) => {
      // Fast path; the track going away does the same thing a moment later.
      if (!acceptFromPartner(payload)) return;
      room.remote.share = null;
      refreshStage();
    })
    .on("broadcast", { event: "heart" }, ({ payload }) => {
      if (acceptFromPartner(payload) && payload.x != null && payload.y != null) {
        const stage = $("hg-stage");
        if (stage) spawnHeartsAt(stage, payload.x, payload.y);
      }
    })
    .on("broadcast", { event: "bye" }, ({ payload }) => {
      if (!room || !payload || payload.from === room.me) return;
      if (room.partnerSince && Number(payload.since) < room.partnerSince) return;
      status(partnerLabel() + " left the room — waiting for them to come back…");
      resetPeer();
      room.partnerSince = null; // whatever session they come back with is new
    })
    .on("presence", { event: "leave" }, () => {
      if (!room || room.channel !== ch) return;
      // Media still flowing = they're here; presence blips when their channel reconnects.
      if (room.peer.pc.connectionState === "connected") return;
      const present = Object.keys(ch.presenceState() || {}).length;
      if (present < 2) status(partnerLabel() + " left the room.");
    });

  ch.subscribe((st) => {
    if (!room || room.channel !== ch) return; // superseded by a rebuilt channel, or we left
    if (st === "SUBSCRIBED") onChannelJoined(ch);
    else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT" || st === "CLOSED") onChannelTrouble(st);
  });
}

function onChannelJoined(ch) {
  room.channelJoined = true;
  room.repairAttempt = 0;
  clearTimeout(room.repairTimer);
  room.repairTimer = null;
  // Presence is kept only for the nice "left the room" signal; the rendezvous
  // itself is the broadcast handshake.
  try { const p = ch.track({ at: Date.now() }); if (p && p.catch) p.catch(() => {}); } catch (_) {}
  if (room.peer.pc.connectionState !== "connected") {
    status(room.partnerHere ? "connecting…" : "waiting for " + partnerLabel() + " to join…");
  }
  sayHello();
  // Anything we sent while the channel was down may be lost — re-offer now.
  room.peer.kick();
}

// CHANNEL_ERROR / TIMED_OUT: supabase-js retries the join on its own, but with
// an expired token it never succeeds. CLOSED: the server dropped the channel
// (token expiry does exactly this) and nothing retries. Either way: refresh the
// token, give the built-in retry a moment, then rebuild the channel.
function onChannelTrouble(st) {
  room.channelJoined = false;
  console.warn("[hangout] signaling channel " + st);
  keepAuthFresh();
  if (room.repairTimer) return;
  const wait = st === "CLOSED" ? 1000 : Math.min(5000 * 2 ** room.repairAttempt, 30000);
  room.repairTimer = setTimeout(repairChannel, wait);
}

async function repairChannel() {
  if (!room) return;
  room.repairTimer = null;
  if (room.channelJoined) return;
  room.repairAttempt++;
  await keepAuthFresh();
  if (!room || room.channelJoined) return;
  console.warn("[hangout] rebuilding signaling channel (attempt " + room.repairAttempt + ")");
  const old = room.channel;
  room.channel = null; // the old channel's callbacks now see themselves as superseded
  try { await supabase.removeChannel(old); } catch (_) {}
  if (!room || room.channel) return;
  openChannel();
}

// ---- call quality ----
// A small readout next to the status: direct vs relayed connection, how much
// of the partner's voice is being lost/patched over, and round-trip time.
// "Voice isn't clear" is either the network (this shows it) or the device —
// e.g. Bluetooth earbuds drop to low-quality call mode when their mic is used.

async function sampleQuality() {
  const el = $("hg-net");
  if (!room || !el) return;
  const pc = room.peer.pc;
  if (pc.connectionState !== "connected") {
    el.textContent = ""; el.dataset.level = ""; room.lastQ = null;
    return;
  }
  let stats;
  try { stats = await pc.getStats(); } catch (_) { return; }
  if (!room || room.peer.pc !== pc) return;

  const byId = new Map();
  stats.forEach((s) => byId.set(s.id, s));
  let pair = null;
  stats.forEach((s) => { if (s.type === "transport" && s.selectedCandidatePairId) pair = byId.get(s.selectedCandidatePairId) || pair; });
  if (!pair) stats.forEach((s) => { if (s.type === "candidate-pair" && (s.selected || (s.nominated && s.state === "succeeded"))) pair = pair || s; });
  const relayed = !!pair && [pair.localCandidateId, pair.remoteCandidateId]
    .some((id) => { const c = byId.get(id); return c && c.candidateType === "relay"; });
  const rtt = pair && pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null;

  // The partner's voice = inbound audio on their camera stream (not screen audio).
  const rv = $("hg-remote");
  const voiceTrack = rv && rv.srcObject && rv.srcObject.getAudioTracks()[0];
  let audio = null;
  stats.forEach((s) => {
    if (s.type !== "inbound-rtp" || s.kind !== "audio") return;
    if (voiceTrack && s.trackIdentifier && s.trackIdentifier !== voiceTrack.id) return;
    audio = audio || s;
  });

  let glitchPct = null;
  if (audio) {
    const cur = {
      id: audio.id,
      recv: audio.packetsReceived || 0,
      lost: Math.max(0, audio.packetsLost || 0),
      concealed: (audio.concealedSamples || 0) - (audio.silentConcealedSamples || 0),
      total: audio.totalSamplesReceived || 0,
    };
    const prev = room.lastQ;
    if (prev && prev.id === cur.id) {
      const dLost = Math.max(0, cur.lost - prev.lost), dRecv = Math.max(0, cur.recv - prev.recv);
      const lossPct = dLost + dRecv > 0 ? (100 * dLost) / (dLost + dRecv) : 0;
      const dTotal = cur.total - prev.total;
      const concealPct = dTotal > 0 ? (100 * Math.max(0, cur.concealed - prev.concealed)) / dTotal : 0;
      glitchPct = Math.max(lossPct, concealPct);
    }
    room.lastQ = cur;
  }

  const parts = [relayed ? "via relay" : "direct"];
  let level = "good";
  if (glitchPct != null) {
    if (glitchPct >= 8) level = "bad";
    else if (glitchPct >= 2) level = "meh";
    parts.push(level === "good" ? "voice clear" : `voice ${level === "bad" ? "choppy" : "a bit choppy"} · ${Math.round(glitchPct)}% lost`);
  }
  if (rtt != null) parts.push(rtt + " ms");
  el.textContent = parts.join(" · ");
  el.dataset.level = level;
  console.debug("[hangout] quality", { relayed, rtt, glitchPct, audio });
}

// ---- controls ----

function setLabel(btn, text) {
  if (!btn) return;
  const lbl = btn.querySelector(".hg-ctl-label");
  if (lbl) lbl.textContent = text; else btn.textContent = text;
}

function setScreenButton(on) {
  const btn = $("hg-screen");
  if (!btn) return;
  setLabel(btn, on ? "sharing screen" : "share screen");
  btn.dataset.on = on ? "1" : "0";
}

function wireControls() {
  const mic = $("hg-mic"), cam = $("hg-cam"), scr = $("hg-screen");
  const form = $("hg-chat-form"), input = $("hg-chat-input");

  mic.onclick = () => {
    if (!room) return;
    const tr = room.localStream.getAudioTracks()[0]; if (!tr) return;
    tr.enabled = !tr.enabled;
    const muted = !tr.enabled;
    mic.dataset.off = muted ? "1" : "0";
    setLabel(mic, muted ? "mic off" : "mic on");
    // pill on our own PIP so we can see we're muted
    $("hg-local-mute").dataset.on = muted ? "1" : "0";
    // and let partner know so their view of us shows the pill too
    send("mute", { muted });
  };
  cam.onclick = () => {
    if (!room) return;
    const tr = room.localStream.getVideoTracks()[0]; if (!tr) return;
    tr.enabled = !tr.enabled;
    cam.dataset.off = tr.enabled ? "0" : "1";
    setLabel(cam, tr.enabled ? "camera on" : "camera off");
  };
  scr.onclick = () => { if (room) (room.screenStream ? stopScreen() : startScreen()); };
  // NOTE: leave button (#hg-hangup) is wired in main.js at module load so it
  // works even if getUserMedia fails and this wireControls() never runs.

  const vol = $("hg-vol-input");
  if (vol) {
    const apply = () => { const sc = $("hg-screencast"); if (sc) sc.volume = Number(vol.value); };
    vol.value = "1";
    apply();
    vol.oninput = apply;
  }

  form.onsubmit = (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || !room) return;
    send("chat", { text });
    addChat(text, "me");
    input.value = "";
  };

  // Floating hearts: tap the stage → hearts float up from the tap point, and
  // the partner sees the same hearts at the same coords (broadcast the %-based
  // position over the room channel). Wired once — it used to stack another
  // listener on every rejoin, sending N hearts per tap. pointerdown also stops
  // phones firing touchstart + mousedown for a single tap.
  const stage = $("hg-stage");
  if (stage && !heartsWired) {
    heartsWired = true;
    stage.addEventListener("pointerdown", (e) => {
      if (!room) return;
      const pos = spawnHearts(stage, e);
      if (pos) send("heart", { x: pos.xPct, y: pos.yPct });
    });
  }
}

async function startScreen() {
  if (!room || room.screenStream) return;
  let screen;
  try {
    // Audio is best-effort — Chrome/Edge deliver it when the user picks a tab
    // (via "Also share tab audio") or whole screen on Windows/ChromeOS;
    // Firefox / Safari / mobile silently return no audio track.
    screen = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: {
        // Keep this call's own sound — your partner's voice — out of a
        // whole-screen/system-audio share, or they hear themselves echo back.
        restrictOwnAudio: true,
        // It's music/video, not a voice: voice processing would mangle it.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  } catch (_) { return; } // user cancelled the picker
  if (!room || room.screenStream) { screen.getTracks().forEach((t) => t.stop()); return; }

  room.screenStream = screen;
  // The partner's layout follows the track itself; this broadcast is kept for
  // anyone still on an older build of the page.
  send("screen-on");
  // Camera track stays live, partner keeps seeing our face. If the partner
  // isn't connected yet, attachLocalTracks() adds the screen when they are.
  addScreenTracks();
  refreshStage();
  setScreenButton(true);

  // Native "Stop sharing" bar → treat as our stop.
  screen.getVideoTracks()[0].onended = () => stopScreen();
}

async function stopScreen() {
  if (!room || !room.screenStream) return;

  send("screen-off");
  room.screenSenders.forEach((s) => { try { room.peer.pc.removeTrack(s); } catch (_) {} });
  room.screenSenders = [];
  try { room.screenStream.getTracks().forEach((t) => t.stop()); } catch (_) {}
  room.screenStream = null;

  refreshStage();
  setScreenButton(false);
}

export function closeHangout() {
  opening = 0; // a pending openHangout() will see this and bail
  if (!room) return;
  const r = room;
  room = null; // first, so late channel/peer callbacks bail
  const exit = r._onExit;
  clearInterval(r.authTimer);
  clearInterval(r.qualityTimer);
  clearTimeout(r.repairTimer);
  // Let the partner reset right away instead of waiting for ICE to time out.
  try { r.channel && r.channel.send({ type: "broadcast", event: "bye", payload: { from: r.me, since: r.since } }); } catch (_) {}
  try { if (r.screenStream) r.screenStream.getTracks().forEach((t) => t.stop()); } catch (_) {}
  try { r.localStream.getTracks().forEach((t) => t.stop()); } catch (_) {}
  try { r.peer.close(); } catch (_) {}
  if (r.channel) {
    try { r.channel.untrack(); } catch (_) {}
    try { supabase.removeChannel(r.channel); } catch (_) {}
  }
  const remoteEl = $("hg-remote"), localEl = $("hg-local"), scv = $("hg-screencast"), stage = $("hg-stage");
  if (remoteEl) remoteEl.srcObject = null;
  if (localEl) localEl.srcObject = null;
  if (scv) { scv.srcObject = null; scv.muted = false; }
  if (stage) stage.classList.remove("sharing");
  const lm = $("hg-local-mute"), rm = $("hg-remote-mute");
  if (lm) lm.dataset.on = "0";
  if (rm) rm.dataset.on = "0";
  // Fresh tracks next time are on, so the buttons must say so.
  const mic = $("hg-mic"), cam = $("hg-cam");
  if (mic) { mic.dataset.off = "0"; setLabel(mic, "mic on"); }
  if (cam) { cam.dataset.off = "0"; setLabel(cam, "camera on"); }
  setScreenButton(false);
  const net = $("hg-net");
  if (net) { net.textContent = ""; net.dataset.level = ""; }
  if (typeof exit === "function") exit();
}
