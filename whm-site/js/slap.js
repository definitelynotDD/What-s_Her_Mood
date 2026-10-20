// ─────────────────────────────────────────────────────────────
// slap.js — the cozy-room slap: a cartoon hand swings onto a face, flash +
// "SLAP!", the stage shakes, and a slap sound plays.
//
// The sound is synthesised with Web Audio (a filtered noise crack + a low
// thump), so there's no audio file to host or license. Browsers only let a
// page make sound after the user has interacted with it — prepareSlapAudio()
// must first run inside a click (opening the cozy room, or pressing slap) so a
// slap that *arrives* later can still be heard.
// ─────────────────────────────────────────────────────────────

const HIT_AT_S = 0.24;      // when the hand lands, matching the CSS keyframes (22% of 1.1s)

let audio = null;

export function prepareSlapAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audio) audio = new Ctx();
    if (audio.state === "suspended") audio.resume().catch(() => {});
  } catch (_) {}
}

function slapSound(delayS) {
  if (!audio || audio.state !== "running") return;
  const t = audio.currentTime + delayS;
  const out = audio.createGain();
  out.gain.value = 0.7;
  out.connect(audio.destination);

  // the crack: a very short burst of noise, band-passed around skin-slap pitch
  const len = Math.floor(audio.sampleRate * 0.2);
  const buf = audio.createBuffer(1, len, audio.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const noise = audio.createBufferSource();
  noise.buffer = buf;
  const hp = audio.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 400;
  const bp = audio.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1800; bp.Q.value = 0.8;
  const ng = audio.createGain();
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.exponentialRampToValueAtTime(1, t + 0.004);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  noise.connect(hp).connect(bp).connect(ng).connect(out);

  // the thump: a quick falling sine — the weight of the hand
  const osc = audio.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(180, t);
  osc.frequency.exponentialRampToValueAtTime(60, t + 0.09);
  const og = audio.createGain();
  og.gain.setValueAtTime(0.0001, t);
  og.gain.exponentialRampToValueAtTime(0.6, t + 0.005);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  osc.connect(og).connect(out);

  noise.start(t); noise.stop(t + 0.2);
  osc.start(t); osc.stop(t + 0.15);
}

// target: the video wrap showing the face that gets slapped.
// received: true on the slapped person's screen — bigger shake + buzz.
export function playSlap({ stage, target, received }) {
  if (!stage || !target) return;
  const still = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const sr = stage.getBoundingClientRect(), tr = target.getBoundingClientRect();
  const x = tr.left - sr.left + tr.width * 0.5;
  const y = tr.top - sr.top + tr.height * 0.45;          // faces sit a bit above centre
  const size = Math.round(Math.max(64, Math.min(200, tr.height * 0.7)));

  const fx = document.createElement("div");
  fx.className = "slap-fx" + (still ? " slap-still" : "");
  fx.setAttribute("aria-hidden", "true");
  fx.style.left = x + "px";
  fx.style.top = y + "px";
  fx.style.setProperty("--slap-size", size + "px");
  // swing in from the roomier side, so the hand isn't hidden past the edge
  fx.style.setProperty("--slap-dir", x > sr.width / 2 ? "1" : "-1");
  fx.innerHTML = '<span class="slap-flash"></span><span class="slap-hand">✋</span><span class="slap-pow">SLAP!</span>';
  stage.appendChild(fx);

  const restart = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
  restart(target, "slap-hit");
  if (!still) restart(stage, received ? "slap-shake-big" : "slap-shake");
  slapSound(still ? 0 : HIT_AT_S);
  if (received && navigator.vibrate) { try { navigator.vibrate([30, 40, 70]); } catch (_) {} }

  setTimeout(() => {
    fx.remove();
    target.classList.remove("slap-hit");
    stage.classList.remove("slap-shake", "slap-shake-big");
  }, 1300);
}
