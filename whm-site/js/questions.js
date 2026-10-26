// ─────────────────────────────────────────────────────────────
// questions.js — Stage 4: the question bank and which question comes next.
//
// HER gets one optional, skippable question a day. Each answer becomes a
// profile entry her partner can read (see profile.js), so the profile fills in
// over weeks without ever feeling like a form. Questions tied to a phase are
// asked first while she's in that phase — "what helps on period days?" lands
// better on a period day — and their answers carry that phase so his side can
// show "on days like today".
//
// Pure: no Supabase import, so the picking rules can be tested in plain Node.
// Add or reword questions freely; keep each `id` stable once shipped (her
// history and entries point at it). `{partner}` becomes her partner's name.
// ─────────────────────────────────────────────────────────────

export const SKIP_DAYS = 14;   // a skipped question comes back after this long

// Display order on the profile card.
export const CATEGORIES = {
  care:     "how to help",
  comfort:  "comfort",
  food:     "food & drinks",
  little:   "little joys",
  activity: "things to do",
  media:    "watch & listen",
  wishlist: "wishlist",
  avoid:    "please don't",
};

export const PHASE_LABELS = {
  menstrual:  "period days",
  follicular: "energy-up days",
  ovulation:  "peak days",
  luteal:     "slower days",
  pms:        "pms week",
};

// label: a short tag shown next to the answer on both sides ("when upset: space first").
export const QUESTIONS = [
  { id: "comfort-food",     cat: "food",     label: "comfort food",
    ask: "what's your forever comfort food?", hint: "e.g. maggi at midnight" },
  { id: "upset-space",      cat: "care",     label: "when upset",
    ask: "when you're upset, do you want to talk it out right away, or have some space first?", hint: "e.g. space first, then a hug" },
  { id: "tiny-joy",         cat: "little",   label: "always makes the day",
    ask: "what tiny thing always makes your day?", hint: "a voice note, flowers, a silly meme…" },
  { id: "rewatch",          cat: "media",    label: "could rewatch forever",
    ask: "a movie or show you could rewatch forever?", hint: "" },
  { id: "bad-day-drink",    cat: "food",     label: "bad-day drink",
    ask: "what drink fixes a bad day?", hint: "chai? cold coffee? hot chocolate?" },
  { id: "stress-never",     cat: "avoid",    label: "never helps when stressed",
    ask: "when you're stressed, what never helps?", hint: "e.g. being told to calm down" },
  { id: "lazy-day",         cat: "activity", label: "perfect lazy day",
    ask: "what does your perfect lazy day look like?", hint: "" },
  { id: "comforted-sad",    cat: "care",     label: "when sad",
    ask: "when you're sad, how do you like to be comforted?", hint: "a hug, kind words, food, a distraction…" },
  { id: "stash-snack",      cat: "food",     label: "keep-around snack",
    ask: "a snack {partner} should always keep around for you?", hint: "" },
  { id: "mood-song",        cat: "media",    label: "mood-lifting song",
    ask: "a song that always lifts your mood?", hint: "" },
  { id: "long-day",         cat: "care",     label: "after a long day",
    ask: "after a long, tiring day, what cheers you up most?", hint: "" },
  { id: "small-outing",     cat: "activity", label: "happy outing",
    ask: "a small outing that always makes you happy?", hint: "a walk, a café, a bookstore…" },
  { id: "flower",           cat: "little",   label: "favourite flower",
    ask: "your favourite flower?", hint: "" },
  { id: "comfort-scent",    cat: "comfort",  label: "comforting smell",
    ask: "a smell you find really comforting?", hint: "a candle, a perfume, rain…" },
  { id: "been-wanting",     cat: "wishlist", label: "been wanting",
    ask: "something you've wanted lately but keep not buying?", hint: "" },
  { id: "dream-date",       cat: "activity", label: "dream date",
    ask: "a date you've always wanted to go on?", hint: "" },
  { id: "eat-out",          cat: "food",     label: "favourite place to eat",
    ask: "your favourite place to eat out?", hint: "" },
  { id: "into-now",         cat: "media",    label: "into right now",
    ask: "a podcast, book or creator you're into right now?", hint: "" },

  { id: "period-helps",     cat: "care",     label: "on period days", phase: "menstrual",
    ask: "on period days, what helps you most?", hint: "hot water bottle, quiet, someone fetching snacks…" },
  { id: "period-craving",   cat: "food",     label: "period cravings", phase: "menstrual",
    ask: "what do you crave on period days?", hint: "" },
  { id: "period-dont",      cat: "avoid",    label: "not on period days", phase: "menstrual",
    ask: "on period days, what should nobody do?", hint: "" },
  { id: "pms-need",         cat: "care",     label: "in pms week", phase: "pms",
    ask: "in pms week, what do you need more of?", hint: "patience, space, chocolate, reassurance…" },
  { id: "pms-nerves",       cat: "avoid",    label: "pms-week pet peeve", phase: "pms",
    ask: "what gets on your nerves most in pms week?", hint: "" },
  { id: "pms-snack",        cat: "food",     label: "pms-week snack", phase: "pms",
    ask: "your pms-week snack of choice?", hint: "" },
  { id: "energy-back",      cat: "activity", label: "when energy's back", phase: "follicular",
    ask: "when your energy comes back after your period, what do you love doing?", hint: "" },
  { id: "peak-plan",        cat: "activity", label: "best-feeling days", phase: "ovulation",
    ask: "on your best-feeling days, what kind of plan sounds fun?", hint: "" },
  { id: "cozy-evening",     cat: "comfort",  label: "cozy evening", phase: "luteal",
    ask: "on slower days, what's your idea of a cozy evening?", hint: "" },
  { id: "slow-day-show",    cat: "media",    label: "slow-day show", phase: "luteal",
    ask: "a comfort show for slow days?", hint: "" },
];

const BY_ID = new Map(QUESTIONS.map((q) => [q.id, q]));
export const questionById = (id) => BY_ID.get(id) || null;

export function fillNames(text, { partner } = {}) {
  return String(text || "").replace(/\{partner\}/g, partner || "your partner");
}

// Has she already answered or skipped a question today? Then the card rests
// until tomorrow (unless she asks for another).
export function doneToday(history, today) {
  return (history || []).some((h) => h.asked_on === today);
}

// The next question to ask: not answered, and not skipped recently. Questions
// for today's phase come first, then everyday ones, then other phases'.
export function nextQuestion(history, { today, phase } = {}, pool = QUESTIONS) {
  const seen = new Map((history || []).map((h) => [h.question_id, h]));
  const open = pool.filter((q) => {
    const h = seen.get(q.id);
    if (!h) return true;
    return h.status === "skipped" && (!h.skipped_until || h.skipped_until <= today);
  });
  return open.find((q) => phase && q.phase === phase)
      || open.find((q) => !q.phase)
      || open[0]
      || null;
}

// "YYYY-MM-DD" + n days, in plain calendar arithmetic (no time zone drift).
export function addDays(iso, n) {
  const [y, m, d] = String(iso).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
