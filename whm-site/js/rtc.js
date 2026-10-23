// ─────────────────────────────────────────────────────────────
// rtc.js
// A tiny RTCPeerConnection wrapper implementing the "perfect negotiation"
// pattern (MDN) so either side can (re)negotiate without glare. Transport-
// agnostic: you pass a sendSignal() that ferries blobs to the other peer
// (we use Supabase Realtime broadcast) and feed incoming blobs to handleSignal().
//
// Perfect negotiation assumes signaling never drops a message. Realtime
// broadcast is fire-and-forget, so a lost offer/answer used to wedge the
// connection in "have-local-offer" for the rest of the call — the call kept
// working (media is P2P) but nothing that needs renegotiation, like starting a
// screen share, ever got through again. The offer watchdog below re-sends an
// unanswered offer until the other side answers. It re-sends the SAME offer
// rather than rolling back and making a new one: if it was our offer that got
// lost the partner applies it now, and if it was their answer that got lost
// they've already applied it and simply answer it again — a rolled-back,
// rebuilt offer would no longer match what they applied and be rejected.
// A second watchdog covers the opposite wedge: negotiation done, but ICE never
// starts (no usable candidates) — it asks the caller for a fresh connection.
// ─────────────────────────────────────────────────────────────

const OFFER_RETRY_MS = [4000, 8000, 15000];   // then every 15s until answered
const CONNECT_STUCK_MS = 6000;                 // negotiated, but ICE still hasn't started

export function createPeer({ iceServers, polite, sendSignal, onRemoteStream, onState, onStuck }) {
  const pc = new RTCPeerConnection({ iceServers });

  let makingOffer = false;
  let ignoreOffer = false;
  let closed = false;
  const pendingCandidates = [];

  let offerTimer = null;
  let offerAttempt = 0;
  let offerSentAt = 0;

  let connectTimer = null;

  // Surface the remote media to the caller.
  pc.ontrack = (e) => {
    const stream = (e.streams && e.streams[0]) ? e.streams[0] : null;
    if (stream && onRemoteStream) onRemoteStream(stream, e.track);
  };

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) {
      // diagnostic: which candidate types are gathered (host / srflx / relay)
      // — if we never see "relay", TURN isn't being reached.
      console.log("[rtc] local candidate", candidate.type, candidate.protocol, candidate.address || candidate.candidate);
      sendSignal({ candidate });
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log("[rtc] iceConnectionState", pc.iceConnectionState);
    // A network change mid-call (wifi ↔ mobile, laptop sleep) kills the
    // current candidate pair. ICE restart gathers fresh candidates instead of
    // leaving the call dead until someone hangs up.
    if (pc.iceConnectionState === "failed" && typeof pc.restartIce === "function") {
      console.warn("[rtc] ICE failed — restarting ICE");
      pc.restartIce();
    }
    if (iceUp()) connectResolved();
  };

  pc.onsignalingstatechange = () => {
    if (pc.signalingState === "stable") {
      offerResolved();
      if (pc.remoteDescription && !iceUp() && !connectTimer) armConnectWatchdog();
    }
  };

  pc.onnegotiationneeded = () => { negotiate(); };

  if (onState) {
    pc.onconnectionstatechange = () => onState(pc.connectionState);
  }

  async function negotiate() {
    if (closed || makingOffer || pc.signalingState !== "stable") return;
    try {
      makingOffer = true;
      await pc.setLocalDescription();              // implicit offer
      sendSignal({ description: pc.localDescription });
      armOfferWatchdog();
    } catch (err) {
      console.error("[rtc] negotiation error", err);
    } finally {
      makingOffer = false;
    }
  }

  // The other side answered, or sent its own offer (which supersedes ours).
  function offerResolved() {
    clearTimeout(offerTimer);
    offerTimer = null;
    offerAttempt = 0;
    offerSentAt = 0;
  }

  function armOfferWatchdog() {
    clearTimeout(offerTimer);
    if (!offerAttempt) offerSentAt = Date.now();
    const wait = OFFER_RETRY_MS[Math.min(offerAttempt, OFFER_RETRY_MS.length - 1)];
    offerTimer = setTimeout(retryOffer, wait);
  }

  // Our offer went unanswered (lost in signaling, or the partner's channel was
  // down) — send it again. localDescription also carries every ICE candidate
  // gathered so far, so lost candidates are covered too.
  function retryOffer() {
    offerTimer = null;
    if (closed || pc.signalingState !== "have-local-offer") return;
    offerAttempt++;
    console.warn("[rtc] offer unanswered — sending it again (attempt " + offerAttempt + ")");
    sendSignal({ description: pc.localDescription });
    armOfferWatchdog();
  }

  // Called when signaling has just come back (channel rejoined, partner said
  // hello): if an offer is still hanging, don't wait for the next watchdog
  // tick — re-send it now. A duplicate is harmless (answered twice, the extra
  // answer is dropped below).
  function kick(minAgeMs = 1000) {
    if (closed || pc.signalingState !== "have-local-offer" || makingOffer) return;
    if (offerSentAt && Date.now() - offerSentAt < minAgeMs) return;
    clearTimeout(offerTimer);
    retryOffer();
  }

  // Negotiation finished but ICE never even starts checking: every candidate
  // was lost in signaling, or — when both open the room at the same moment —
  // Chrome's candidate gathering on the polite side dies after it rolls back
  // its own offer. ICE then sits at "new" forever (it never reports "failed"),
  // and an ICE restart doesn't revive that dead gatherer, so tell the caller to
  // start a fresh connection. Only the impolite side does this, so the two
  // sides can't both start over at once. "checking" is left alone: ICE is
  // making progress there and will connect or fail on its own.
  const iceUp = () => pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed";

  function armConnectWatchdog() {
    clearTimeout(connectTimer);
    connectTimer = polite || !onStuck ? null : setTimeout(checkConnected, CONNECT_STUCK_MS);
  }

  function checkConnected() {
    connectTimer = null;
    if (closed || iceUp()) return;
    if (pc.signalingState === "stable" && pc.iceConnectionState === "new") {
      console.warn("[rtc] negotiated but ICE never started — asking for a fresh connection");
      onStuck();
      return;
    }
    armConnectWatchdog();     // still negotiating, or ICE is working on it
  }

  function connectResolved() {
    clearTimeout(connectTimer);
    connectTimer = null;
  }

  async function flushCandidates() {
    while (pendingCandidates.length) {
      const c = pendingCandidates.shift();
      try { await pc.addIceCandidate(c); } catch (err) { console.warn("[rtc] ice flush", err); }
    }
  }

  async function handleSignal(data) {
    if (closed) return;
    try {
      if (data.description) {
        const desc = data.description;
        const offerCollision =
          desc.type === "offer" &&
          (makingOffer || pc.signalingState !== "stable");

        ignoreOffer = !polite && offerCollision;
        if (ignoreOffer) return;

        // A duplicate answer (to an offer we re-sent) is harmless — drop it
        // instead of logging a scary state error.
        if (desc.type === "answer" && pc.signalingState !== "have-local-offer") return;

        await pc.setRemoteDescription(desc);       // implicit rollback if polite
        offerResolved();
        await flushCandidates();

        if (desc.type === "offer") {
          await pc.setLocalDescription();          // implicit answer
          sendSignal({ description: pc.localDescription });
        }
      } else if (data.candidate) {
        if (pc.remoteDescription && pc.remoteDescription.type) {
          try { await pc.addIceCandidate(data.candidate); }
          catch (err) { if (!ignoreOffer) throw err; }
        } else {
          // candidate arrived before the description — buffer it
          pendingCandidates.push(data.candidate);
        }
      }
    } catch (err) {
      console.error("[rtc] handleSignal error", err);
    }
  }

  // The caller owns the local tracks (camera, mic, screen) and stops them
  // itself — closing a peer to rebuild it must not kill the camera.
  function close() {
    closed = true;
    offerResolved();
    connectResolved();
    try {
      pc.ontrack = pc.onicecandidate = pc.onnegotiationneeded = pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = pc.onsignalingstatechange = null;
      pc.close();
    } catch (_) {}
  }

  return { pc, handleSignal, kick, close };
}

// Make the microphone survive a bad network:
//  • RED (redundant Opus) puts a copy of the previous audio frame in every
//    packet, so a single lost packet is rebuilt instead of heard as a
//    crackle/robot glitch. It roughly doubles audio bitrate (~32→64 kbps),
//    which is nothing next to video. Only used if both browsers support it.
//  • priority "high" tells the browser to keep the voice's bitrate and drop
//    video quality first when bandwidth gets tight (e.g. camera + screen
//    share over a relay).
// Codec preferences must be set before the offer/answer is created, so call
// this right after addTrack. Every step is best-effort.
export function tuneVoiceSender(pc, sender) {
  try {
    const tr = pc.getTransceivers().find((t) => t.sender === sender);
    const caps = window.RTCRtpReceiver && RTCRtpReceiver.getCapabilities
      ? RTCRtpReceiver.getCapabilities("audio") : null;
    if (tr && typeof tr.setCodecPreferences === "function" && caps && caps.codecs) {
      const isRed = (c) => String(c.mimeType).toLowerCase() === "audio/red";
      const red = caps.codecs.filter(isRed);
      if (red.length) tr.setCodecPreferences([...red, ...caps.codecs.filter((c) => !isRed(c))]);
    }
  } catch (err) { console.warn("[rtc] codec preferences", err); }
  setVoicePriority(sender);
}

// Separate from tuneVoiceSender because some browsers only expose encodings
// once the transceiver has been negotiated — call again after connecting.
export function setVoicePriority(sender) {
  try {
    const params = sender.getParameters();
    if (!params.encodings || !params.encodings.length) return;
    params.encodings.forEach((e) => { e.priority = "high"; e.networkPriority = "high"; });
    const p = sender.setParameters(params);
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (_) {}
}
