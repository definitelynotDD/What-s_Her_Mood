// ─────────────────────────────────────────────────────────────
// hangout.js
// A private 2-person "hangout room": video call + screen share + ephemeral
// text chat, for the paired couple. WebRTC media is peer-to-peer; Supabase
// Realtime is only the matchmaker (signaling + presence + chat relay).
//
// The room channel is derived from the two user IDs, so only the pair share it.
// Negotiation waits until BOTH are present (Realtime broadcast isn't retained,
// so an offer sent before the partner joins would be lost).
// ─────────────────────────────────────────────────────────────
import { supabase } from "./supabase-init.js";
import { createPeer } from "./rtc.js";

const $ = (id) => document.getElementById(id);

let room = null; // active room state, or null

function coupleKey(a, b) { return [a, b].sort().join("__"); }

function iceServers() {
  const cfg = window.WHM_CONFIG && window.WHM_CONFIG.webrtc;
  if (cfg && Array.isArray(cfg.iceServers) && cfg.iceServers.length) return cfg.iceServers;
  return [{ urls: "stun:stun.l.google.com:19302" }];
}

function status(msg) { const el = $("hg-status"); if (el) el.textContent = msg; }

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

export async function openHangout({ me, partner, myName, partnerName, onExit }) {
  if (room) return; // already open

  $("hg-partner").textContent = partnerName || "your partner";
  $("hg-chat-log").innerHTML = "";
  status("getting your camera ready…");

  // Hide screen-share on browsers that can't do it (e.g. iOS Safari web).
  const canShare = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
  if ($("hg-screen")) $("hg-screen").hidden = !canShare;

  const polite = String(me) < String(partner);
  let localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (err) {
    status("couldn't get camera/mic — check the browser permission and that you're on https.");
    return;
  }
  const localVid = $("hg-local");
  localVid.srcObject = localStream;
  localVid.muted = true;
  localVid.play && localVid.play().catch(() => {});

  const channel = supabase.channel("hangout:" + coupleKey(me, partner), {
    config: { broadcast: { self: false }, presence: { key: String(me) } },
  });

  // Route incoming media by the MediaStream id the sender grouped it under:
  // getUserMedia is one stream (camera + mic); getDisplayMedia is a second,
  // separate stream. First stream we see = partner's camera; a later, different
  // stream = their screen. Toggling to the .sharing layout is driven by the
  // paired screen-on/off broadcasts below so the UI flips at the right moment.
  const remote = { cameraId: null, screenId: null };
  function playInto(el, stream) {
    el.srcObject = stream;
    const p = el.play && el.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  }
  function routeIncomingStream(stream) {
    if (!stream) return;
    if (!remote.cameraId || stream.id === remote.cameraId) {
      remote.cameraId = stream.id;
      playInto($("hg-remote"), stream);
    } else {
      remote.screenId = stream.id;
      playInto($("hg-screencast"), stream);
    }
    status("connected ♡");
  }

  const peer = createPeer({
    iceServers: iceServers(),
    polite,
    sendSignal: (sig) => channel.send({ type: "broadcast", event: "signal", payload: { from: me, sig } }),
    onRemoteStream: routeIncomingStream,
    onState: (st) => {
      if (st === "connecting") status("connecting…");
      else if (st === "connected") status("connected ♡");
      else if (st === "disconnected") status("connection dropped — trying to recover…");
      else if (st === "failed") status("connection failed — try hanging up and rejoining.");
    },
  });

  let tracksAdded = false;
  let partnerHere = false;

  // Rendezvous via a broadcast "hello" handshake instead of Realtime presence
  // — presence hasn't been delivering reliably here, but broadcast (same feature
  // chat rides on) is proven to work. Anything we hear from the partner counts
  // as "they're here" and unlocks addTrack, so negotiation can start.
  function sayHello() {
    channel.send({ type: "broadcast", event: "hello", payload: { from: me } });
  }
  function markPartnerHere() {
    if (!partnerHere) {
      partnerHere = true;
      // Reply so partner also learns we're here — covers the case where their
      // initial hello was broadcast before we subscribed and was lost.
      sayHello();
    }
    if (tracksAdded) return;
    tracksAdded = true;
    status("connecting…");
    localStream.getTracks().forEach((t) => peer.pc.addTrack(t, localStream));
  }

  channel
    .on("broadcast", { event: "signal" }, ({ payload }) => {
      if (payload && payload.from !== me) { markPartnerHere(); peer.handleSignal(payload.sig); }
    })
    .on("broadcast", { event: "hello" }, ({ payload }) => {
      if (payload && payload.from !== me) markPartnerHere();
    })
    .on("broadcast", { event: "chat" }, ({ payload }) => {
      if (payload && payload.from !== me) { markPartnerHere(); addChat(payload.text, "them", partnerName); }
    })
    .on("broadcast", { event: "mute" }, ({ payload }) => {
      if (payload && payload.from !== me) {
        $("hg-remote-mute").dataset.on = payload.muted ? "1" : "0";
      }
    })
    .on("broadcast", { event: "screen-on" }, ({ payload }) => {
      if (payload && payload.from !== me) $("hg-stage").classList.add("sharing");
    })
    .on("broadcast", { event: "screen-off" }, ({ payload }) => {
      if (payload && payload.from !== me) {
        $("hg-stage").classList.remove("sharing");
        const scv = $("hg-screencast");
        if (scv) scv.srcObject = null;
        remote.screenId = null;
      }
    })
    .on("presence", { event: "leave" }, () => {
      const present = Object.keys(channel.presenceState() || {}).length;
      if (present < 2) status((partnerName || "your partner") + " left the room.");
    });

  await channel.subscribe(async (st) => {
    if (st === "SUBSCRIBED") {
      // Presence is kept only for the nice "left the room" signal; the rendezvous
      // itself is the broadcast handshake below.
      try { await channel.track({ at: Date.now() }); } catch (_) {}
      status("waiting for " + (partnerName || "your partner") + " to join…");
      sayHello();
    }
  });

  room = {
    me, partner, partnerName, channel, peer, localStream,
    screenStream: null, screenSender: null, screenAudioSender: null,
    _onExit: onExit,
  };

  // ---- controls ----
  wireControls();
}

function wireControls() {
  const mic = $("hg-mic"), cam = $("hg-cam"), scr = $("hg-screen"), bye = $("hg-hangup");
  const form = $("hg-chat-form"), input = $("hg-chat-input");

  mic.onclick = () => {
    const tr = room.localStream.getAudioTracks()[0]; if (!tr) return;
    tr.enabled = !tr.enabled;
    const muted = !tr.enabled;
    mic.dataset.off = muted ? "1" : "0";
    mic.textContent = muted ? "mic off" : "mic on";
    // pill on our own PIP so we can see we're muted
    $("hg-local-mute").dataset.on = muted ? "1" : "0";
    // and let partner know so their view of us shows the pill too
    room.channel.send({ type: "broadcast", event: "mute", payload: { from: room.me, muted } });
  };
  cam.onclick = () => {
    const tr = room.localStream.getVideoTracks()[0]; if (!tr) return;
    tr.enabled = !tr.enabled;
    cam.dataset.off = tr.enabled ? "0" : "1";
    cam.textContent = tr.enabled ? "camera on" : "camera off";
  };
  scr.onclick = () => (room.screenStream ? stopScreen() : startScreen());
  bye.onclick = () => closeHangout();

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
    room.channel.send({ type: "broadcast", event: "chat", payload: { from: room.me, text } });
    addChat(text, "me");
    input.value = "";
  };
}

async function startScreen() {
  if (!room || room.screenStream) return;
  let screen;
  try {
    // audio:true is best-effort — Chrome/Edge deliver it when the user picks a
    // tab (via "Also share tab audio") or whole screen on Windows/ChromeOS;
    // Firefox / Safari / mobile silently return no audio track.
    screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  } catch (_) { return; } // user cancelled the picker
  const screenTrack = screen.getVideoTracks()[0];
  const screenAudioTrack = screen.getAudioTracks()[0]; // may be undefined

  // Tell partner FIRST so their layout is ready when the new track arrives.
  room.channel.send({ type: "broadcast", event: "screen-on", payload: { from: room.me } });

  // Add as a new sender — camera track stays live, partner keeps seeing our face.
  room.screenSender = room.peer.pc.addTrack(screenTrack, screen);
  if (screenAudioTrack) {
    // Riding it on the same MediaStream as the video means it lands in
    // #hg-screencast on the receiver side and plays through that element.
    room.screenAudioSender = room.peer.pc.addTrack(screenAudioTrack, screen);
  }
  room.screenStream = screen;

  // Local UI: show the screencast in the main slot; camera preview stays in its corner.
  const scv = $("hg-screencast");
  scv.srcObject = screen;
  scv.muted = true;
  const p = scv.play && scv.play(); if (p && typeof p.catch === "function") p.catch(() => {});
  $("hg-stage").classList.add("sharing");

  $("hg-screen").textContent = "stop sharing";
  $("hg-screen").dataset.on = "1";

  // Native "Stop sharing" bar → treat as our stop.
  screenTrack.onended = () => stopScreen();
}

async function stopScreen() {
  if (!room || !room.screenStream) return;

  room.channel.send({ type: "broadcast", event: "screen-off", payload: { from: room.me } });

  if (room.screenSender) {
    try { room.peer.pc.removeTrack(room.screenSender); } catch (_) {}
    room.screenSender = null;
  }
  if (room.screenAudioSender) {
    try { room.peer.pc.removeTrack(room.screenAudioSender); } catch (_) {}
    room.screenAudioSender = null;
  }
  try { room.screenStream.getTracks().forEach((t) => t.stop()); } catch (_) {}
  room.screenStream = null;

  const scv = $("hg-screencast");
  if (scv) scv.srcObject = null;
  $("hg-stage").classList.remove("sharing");

  $("hg-screen").textContent = "share screen";
  $("hg-screen").dataset.on = "0";
}

export function closeHangout() {
  if (!room) return;
  const exit = room._onExit;
  try { if (room.screenStream) room.screenStream.getTracks().forEach((t) => t.stop()); } catch (_) {}
  try { room.localStream.getTracks().forEach((t) => t.stop()); } catch (_) {}
  try { room.peer.close(); } catch (_) {}
  try { room.channel.untrack(); } catch (_) {}
  try { supabase.removeChannel(room.channel); } catch (_) {}
  const remoteEl = $("hg-remote"), localEl = $("hg-local"), scv = $("hg-screencast"), stage = $("hg-stage");
  if (remoteEl) remoteEl.srcObject = null;
  if (localEl) localEl.srcObject = null;
  if (scv) scv.srcObject = null;
  if (stage) stage.classList.remove("sharing");
  const lm = $("hg-local-mute"), rm = $("hg-remote-mute");
  if (lm) lm.dataset.on = "0";
  if (rm) rm.dataset.on = "0";
  room = null;
  if (typeof exit === "function") exit();
}
