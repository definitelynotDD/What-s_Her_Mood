// ─────────────────────────────────────────────────────────────
// wise-words.js — a small bank of gentle, phase-aware notes.
//
// Both partners see the SAME note on the SAME day. The pick is deterministic
// on {phase, date} so it's stable across a refresh and matches on both sides
// without a round-trip; it rotates day-to-day so it doesn't get stale.
//
// A note aims at a shared read of the day — not medical, not prescriptive:
// a soft observation and one small suggestion. Add or edit the bank freely.
// ─────────────────────────────────────────────────────────────
import { todayISO } from "./cycle.js";

const BANK = {
  menstrual: [
    { title: "tender day",   body: "warm drinks and soft pacing today. it's okay to do less." },
    { title: "cozy hours",   body: "blankets over big plans. energy will climb again in a couple of days." },
    { title: "extra care",   body: "hot water bottle beats a to-do list right now." },
    { title: "soft light",   body: "dim lamps, easy music. long exhales help more than pep talks today." },
  ],
  follicular: [
    { title: "rising energy", body: "a good day for fresh starts and small adventures." },
    { title: "fresh air",     body: "even a short walk lifts the mood — light does a lot of the work." },
    { title: "creative pull", body: "ideas land easier now. jot them down before they scatter." },
    { title: "make a plan",   body: "the coming week is friendlier — pencil something in you'll look forward to." },
  ],
  ovulation: [
    { title: "peak days",  body: "warm, open, quick to laugh. lean into what you love today." },
    { title: "come alive", body: "favorite people, favorite food. keep it simple, keep it warm." },
    { title: "say yes",    body: "confidence runs high — the slightly bigger plan is probably worth it." },
  ],
  luteal: [
    { title: "winding down",     body: "quieter pacing suits today. good for finishing, less for starting." },
    { title: "gentle work",      body: "small tasks and steady meals. reserve energy for what actually matters." },
    { title: "hold plans loose", body: "if a plan feels heavy, it's okay to soften it or say next week." },
    { title: "protect sleep",    body: "an earlier bed tonight pays back double tomorrow." },
  ],
  pms: [
    { title: "extra patience",   body: "feelings run louder this week. slow answers and deep breaths help." },
    { title: "little rituals",   body: "tea, showers, a walk. small comforts carry a lot right now." },
    { title: "protect the mood", body: "less scrolling, more soft light. bed a little earlier tonight." },
    { title: "kind words first", body: "if something's bothering you, name it gently before it grows." },
  ],
  unknown: [
    { title: "log to unlock", body: "once she logs a period start below, the notes tune themselves to the phase." },
  ],
};

// Deterministic pick per phase per calendar date. Same input → same output
// on both partners' devices without needing to sync a chosen index.
export function pickWiseWord(phaseKey, dateISO = todayISO()) {
  const bucket = BANK[phaseKey] || BANK.unknown;
  const daysSinceEpoch = Math.floor(Date.parse(dateISO) / 86400000);
  const seed = (daysSinceEpoch + phaseSalt(phaseKey)) % bucket.length;
  return bucket[Math.abs(seed)];
}

// Salt so consecutive phases don't collide on the same index on day 0.
function phaseSalt(k) {
  const order = ["menstrual", "follicular", "ovulation", "luteal", "pms", "unknown"];
  const i = order.indexOf(k);
  return i < 0 ? 0 : (i * 7 + 3);
}
