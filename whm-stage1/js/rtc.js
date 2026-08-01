// ─────────────────────────────────────────────────────────────
// rtc.js
// A tiny RTCPeerConnection wrapper implementing the "perfect negotiation"
// pattern (MDN) so either side can (re)negotiate without glare. Transport-
// agnostic: you pass a sendSignal() that ferries blobs to the other peer
// (we use Supabase Realtime broadcast) and feed incoming blobs to handleSignal().
// ─────────────────────────────────────────────────────────────

export function createPeer({ iceServers, polite, sendSignal, onRemoteStream, onState }) {
  const pc = new RTCPeerConnection({ iceServers });

  let makingOffer = false;
  let ignoreOffer = false;
  const pendingCandidates = [];

  // Surface the remote media to the caller.
  pc.ontrack = (e) => {
    const stream = (e.streams && e.streams[0]) ? e.streams[0] : null;
    if (stream && onRemoteStream) onRemoteStream(stream);
  };

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) sendSignal({ candidate });
  };

  pc.onnegotiationneeded = async () => {
    try {
      makingOffer = true;
      await pc.setLocalDescription();              // implicit offer
      sendSignal({ description: pc.localDescription });
    } catch (err) {
      console.error("[rtc] negotiation error", err);
    } finally {
      makingOffer = false;
    }
  };

  if (onState) {
    pc.onconnectionstatechange = () => onState(pc.connectionState);
  }

  async function flushCandidates() {
    while (pendingCandidates.length) {
      const c = pendingCandidates.shift();
      try { await pc.addIceCandidate(c); } catch (err) { console.warn("[rtc] ice flush", err); }
    }
  }

  async function handleSignal(data) {
    try {
      if (data.description) {
        const desc = data.description;
        const offerCollision =
          desc.type === "offer" &&
          (makingOffer || pc.signalingState !== "stable");

        ignoreOffer = !polite && offerCollision;
        if (ignoreOffer) return;

        await pc.setRemoteDescription(desc);       // implicit rollback if polite
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

  function close() {
    try {
      pc.getSenders().forEach((s) => { try { s.track && s.track.stop(); } catch (_) {} });
      pc.ontrack = pc.onicecandidate = pc.onnegotiationneeded = pc.onconnectionstatechange = null;
      pc.close();
    } catch (_) {}
  }

  return { pc, handleSignal, close };
}
