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

  const peer = createPeer({
    iceServers: iceServers(),
    polite,
    sendSignal: (sig) => channel.send({ type: "broadcast", event: "signal", payload: { from: me, sig } }),
    onRemoteStream: (stream) => { $("hg-remote").srcObject = stream; status("connected ♡"); },
    onState: (st) => {
      if (st === "connecting") status("connecting…");
      else if (st === "connected") status("connected ♡");
      else if (st === "disconnected") status("connection dropped — trying to recover…");
      else if (st === "failed") status("connection failed — try hanging up and rejoining.");
    },
  });

  let tracksAdded = false;
  function maybeStart() {
    if (tracksAdded) return;
    const present = Object.keys(channel.presenceState() || {}).length;
    if (present >= 2) {
      tracksAdded = true;
      status("connecting…");
      localStream.getTracks().forEach((t) => peer.pc.addTrack(t, localStream));
    } else {
      status("waiting for " + (partnerName || "your partner") + " to join…");
    }
  }

  channel
    .on("broadcast", { event: "signal" }, ({ payload }) => {
      if (payload && payload.from !== me) peer.handleSignal(payload.sig);
    })
    .on("broadcast", { event: "chat" }, ({ payload }) => {
      if (payload && payload.from !== me) addChat(payload.text, "them", partnerName);
    })
    .on("presence", { event: "sync" }, maybeStart)
    .on("presence", { event: "join" }, maybeStart)
    .on("presence", { event: "leave" }, () => {
      const present = Object.keys(channel.presenceState() || {}).length;
      if (present < 2) status((partnerName || "your partner") + " left the room.");
    });

  await channel.subscribe(async (st) => {
    if (st === "SUBSCRIBED") { await channel.track({ at: Date.now() }); maybeStart(); }
  });

  room = { me, partner, partnerName, channel, peer, localStream, screenStream: null, _onExit: onExit };

  // ---- controls ----
  wireControls();
}

function wireControls() {
  const mic = $("hg-mic"), cam = $("hg-cam"), scr = $("hg-screen"), bye = $("hg-hangup");
  const form = $("hg-chat-form"), input = $("hg-chat-input");

  mic.onclick = () => {
    const tr = room.localStream.getAudioTracks()[0]; if (!tr) return;
    tr.enabled = !tr.enabled;
    mic.dataset.off = tr.enabled ? "0" : "1";
    mic.textContent = tr.enabled ? "mic on" : "mic off";
  };
  cam.onclick = () => {
    const tr = room.localStream.getVideoTracks()[0]; if (!tr) return;
    tr.enabled = !tr.enabled;
    cam.dataset.off = tr.enabled ? "0" : "1";
    cam.textContent = tr.enabled ? "camera on" : "camera off";
  };
  scr.onclick = () => (room.screenStream ? stopScreen() : startScreen());
  bye.onclick = () => closeHangout();

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
  if (!room) return;
  let screen;
  try { screen = await navigator.mediaDevices.getDisplayMedia({ video: true }); }
  catch (_) { return; } // user cancelled the picker
  const screenTrack = screen.getVideoTracks()[0];
  const sender = room.peer.pc.getSenders().find((s) => s.track && s.track.kind === "video");
  if (sender) await sender.replaceTrack(screenTrack);
  $("hg-local").srcObject = screen;
  room.screenStream = screen;
  $("hg-screen").textContent = "stop sharing";
  $("hg-screen").dataset.on = "1";
  // when the user clicks the browser's native "Stop sharing"
  screenTrack.onended = () => stopScreen();
}

async function stopScreen() {
  if (!room) return;
  const camTrack = room.localStream.getVideoTracks()[0];
  const sender = room.peer.pc.getSenders().find((s) => s.track && s.track.kind === "video");
  if (sender && camTrack) await sender.replaceTrack(camTrack);
  $("hg-local").srcObject = room.localStream;
  if (room.screenStream) { room.screenStream.getTracks().forEach((t) => t.stop()); room.screenStream = null; }
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
  const remote = $("hg-remote"), local = $("hg-local");
  if (remote) remote.srcObject = null;
  if (local) local.srcObject = null;
  room = null;
  if (typeof exit === "function") exit();
}
