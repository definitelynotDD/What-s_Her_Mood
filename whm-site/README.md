# WHM — What's her Mood

> **⚠️ Backend updated: this README describes the original Firebase design, but
> Stage 1 now runs on Supabase** (Postgres + Auth + Realtime). The concepts are
> the same; only the backend mechanics differ. For the current, accurate setup
> see **`DEPLOY.md`**, **`HANDOVER.md`**, and **`supabase/schema.sql`**. Mentions
> of Firestore / `firestore.rules` / Firebase config below are historical.

A private, two-person app for a couple. **She** tracks her cycle and to-dos.
**He** sees her cycle (read-only), gets a small daily "wise words" note, and —
once later stages are built — mood-aware suggestions drawn from a profile she
fills in over time through optional, skippable questions.

It's built to be **simple to run and simple to maintain**: plain HTML, ES
modules, and Firebase. No build step, no server to babysit, no npm. You deploy
by dragging a folder onto Netlify.

This README is self-contained — it covers what the app is, how it's built, how
to set it up from zero, how to use it, and how to extend it. If you only want
the deploy steps, jump to [Setup procedure](#setup-procedure).

---

## Table of contents

1. [What WHM is](#what-whm-is)
2. [Current status](#current-status)
3. [Architecture & stack](#architecture--stack)
4. [Project structure](#project-structure)
5. [The data model](#the-data-model)
6. [Setup procedure](#setup-procedure) ← the full walk-through
7. [Using the app](#using-the-app)
8. [How to extend it](#how-to-extend-it)
9. [The roadmap](#the-roadmap)
10. [Conventions](#conventions)
11. [Troubleshooting](#troubleshooting)
12. [Security notes](#security-notes)

---

## What WHM is

WHM ("What's her Mood") grew out of a cozy single-page "field manual for
boyfriends" into a real two-account app. The premise:

- **Her side** is a genuinely useful daily tool on its own: a menstrual-cycle
  tracker plus a to-do list. She'd open it even if he didn't exist.
- **His side** is a thoughtfulness aid: it shows where she is in her cycle,
  gives a short reflective "wise words" note, surfaces her to-do list (so he
  can read her bandwidth), and — in later stages — suggests small ways to show
  up based on a profile of things she likes.
- The profile is built **gently**: the app occasionally asks her one optional,
  skippable question. Over weeks it fills in without ever feeling like a form.

The two accounts are **paired** so each recognizes the other as their partner.
Her data is hers; he gets read access once paired.

The visual style is a warm "cozy field manual" look: a **sage** primary color,
**cream** paper background with a subtle grain texture, **Fraunces** serif for
display type, **Nunito** for body, and **Caveat** for handwritten accents.

---

## Current status

**Stage 1 (Auth + Pairing) is built and packaged.** It is the only stage
shipped so far. It needs to be deployed and verified against your real Firebase
project before more is built on top.

What Stage 1 does: two people can sign up (each picks a role — "her" or "her
partner"), each gets a 6-character pairing code, and entering your partner's
code links the two accounts in real time.

What Stage 1 does NOT yet include: the tracker, to-dos, wise words, questions,
recommendations, or PWA install. Those come in later stages (see
[the roadmap](#the-roadmap)).

---

## Architecture & stack

| Layer        | Choice                          | Why |
|--------------|---------------------------------|-----|
| Frontend     | Plain HTML + ES modules         | No build step; edit a file, redeploy |
| Styling      | Hand-written CSS (design tokens)| Locked to the WHM "candle"/sage look |
| Auth         | Firebase Authentication (email/password) | Free, no custom auth server |
| Database     | Cloud Firestore                 | Real-time sync between the two devices |
| Hosting      | Netlify (drag-and-drop deploy)  | HTTPS, free, no pipeline |
| LLM (Stage 5)| Google Gemini 2.5 Flash         | Generous free tier, good at warm short text |
| Firebase plan| Spark (free, no card)           | Enough for two users; Gemini called from client |

**No npm, no bundler, no server you run.** Firebase's SDK is imported directly
from Google's CDN as ES modules. The "backend" is Firestore + its security
rules. The only thing you host is a folder of static files on Netlify.

The trade-off of the Spark (free) plan: Cloud Functions aren't available, so in
Stage 5 the Gemini API key is used from the browser. That's acceptable because
Gemini's free tier is rate-limited per project (not a billing risk), and abuse
just depletes the free quota.

---

## Project structure

```
whm-site/
├── index.html              All screens: welcome / signup / signin / paired / hangout
├── config.example.js       Template — copy to config.js and fill in
├── config.js               YOU CREATE THIS (your real Supabase values)
├── README.md               This file
├── DEPLOY.md               Condensed deploy steps
├── HANDOVER.md             Project history + design decisions + roadmap
├── supabase/
│   └── schema.sql          Canonical Postgres schema (already applied)
├── css/
│   ├── shared.css          Fonts + WHM design tokens (sage palette, grain, etc.)
│   ├── auth.css            Auth-screen-specific layout
│   └── hangout.css         Video call / screen share / chat layout
├── js/
│   ├── supabase-init.js    Creates the Supabase client from config
│   ├── auth.js             signUp / signIn / signOut / friendlyAuthError
│   ├── pairing.js          Live user-row subscription + claim_partner RPC
│   ├── rtc.js              Perfect-negotiation WebRTC wrapper
│   ├── hangout.js          Room lifecycle: media, signaling, chat, screen share
│   └── main.js             DOM event wiring + screen routing
├── assets/                 Fraunces / Nunito / Caveat font files (.woff2)
└── icons/                  PWA icons (present, not wired up until a later stage)
```

The README below still describes the original Firebase design in places — see
HANDOVER.md for the current, accurate story (Supabase + hangout + Netlify).

---

## The data model

Firestore collections. Some are owner-only-write/partner-read; the shared ones
(later stages) are written by both partners.

```
users/{uid}
  ├─ email             string
  ├─ displayName       string
  ├─ role              "her" | "partner"
  ├─ pairedWith        uid | null
  ├─ pairingCode       6-char string  [ABCDEFGHJKMNPQRSTUVWXYZ23456789]
  └─ createdAt         timestamp

pairingCodes/{code}    lookup table (any signed-in user can read)
  ├─ uid               string
  └─ createdAt         timestamp

# ── Stage 2 ──
cycles/{uid}
  ├─ startDate         "YYYY-MM-DD"
  ├─ cycleLen          number (default 28)
  └─ periodLen         number (default 5)

todos/{uid}/items/{itemId}
  ├─ text              string
  ├─ done              boolean
  ├─ createdAt         timestamp
  └─ completedAt       timestamp | null

# ── Stage 4 ──
profile/{uid}/entries/{entryId}
  ├─ thing             string
  ├─ category          "comfort-object" | "activity" | "media" | ...
  ├─ source            "answered-question" | "added-manually"
  ├─ moodTags          string[]
  ├─ phaseTags         string[]
  ├─ notes             string
  └─ addedAt           timestamp

questionHistory/{uid}/asked/{questionId}
  ├─ status            "answered" | "skipped"
  ├─ skippedUntil      timestamp | null
  ├─ answerEntryId     ref | null
  └─ askedAt           timestamp

# ── Stage 5 ──
recommendations/{uid}/daily/{YYYY-MM-DD}
  ├─ phase             string
  ├─ text              Gemini-generated paragraph
  ├─ entriesUsed       string[]
  └─ generatedAt       timestamp

# ── Stage 7+ (shared between the couple) ──
couples/{coupleId}
  ├─ members           [uidA, uidB]
  ├─ anniversaryDate   "YYYY-MM-DD" | null
  └─ createdAt         timestamp

milestones/{coupleId}/events/{eventId}     # Stage 9
watchlist/{coupleId}/items/{itemId}        # Stage 10
```

**Ownership rules in plain English:**
- You can read and write your own data.
- Once paired, you can READ but not WRITE your partner's cycle/todos/profile.
- Shared `couples/*` data (later stages) is writable by either partner.
- `questionHistory` and `recommendations` are private to their owner.

---

## Setup procedure

This is the full walk-through from nothing to a working, paired app on two
phones. Budget ~25 minutes the first time.

### Part 1 — Create the Firebase project

1. Go to <https://console.firebase.google.com> and sign in.
2. **Add project** → name it (e.g. `whm-app`) → **turn OFF Google Analytics**
   → Continue. Wait for it to provision.

### Part 2 — Enable Authentication

1. Left sidebar → **Build → Authentication → Get started**.
2. Click **Email/Password**, toggle it **ON**, leave passwordless OFF, **Save**.

### Part 3 — Enable Firestore

1. Left sidebar → **Build → Firestore Database → Create database**.
2. Choose region **`asia-south1` (Mumbai)** — *this is permanent, double-check.*
3. Choose **Start in production mode** (NOT test mode). **Create**.

### Part 4 — Publish the security rules

1. In Firestore, click the **Rules** tab.
2. Delete everything in the editor.
3. Open `firestore.rules` from this project, select all, copy.
4. Paste into the Firebase rules editor → **Publish**.

These rules are required for pairing to work — they include the controlled
cross-document write that lets one partner link to the other's account.

### Part 5 — Register the web app & get config

1. ⚙️ **Project settings** → scroll to **Your apps** → click the **`</>`** (web)
   icon.
2. Nickname it (e.g. `WHM web`). **Do NOT** tick "set up Firebase Hosting".
   **Register app.**
3. Copy the `firebaseConfig` object shown. Keep it handy. Click **Continue to
   console** (skip the npm commands).

### Part 6 — Create `config.js`

1. Unzip the project.
2. Copy `config.example.js` to a new file named `config.js`.
   - macOS/Linux: `cp config.example.js config.js`
   - Windows: copy + rename.
3. Open `config.js` and paste your real Firebase values in:
   ```js
   window.WHM_CONFIG = {
     firebase: {
       apiKey:            "AIza…",
       authDomain:        "whm-app-xxxx.firebaseapp.com",
       projectId:         "whm-app-xxxx",
       storageBucket:     "whm-app-xxxx.appspot.com",
       messagingSenderId: "1234567890",
       appId:             "1:1234567890:web:abc…"
     },
     gemini: { apiKey: "" }   // leave empty until Stage 5
   };
   ```
4. Save. If you skip this step, the app shows a friendly "Setup not complete"
   message instead of breaking.

### Part 7 — Deploy to Netlify

- **First time:** go to <https://app.netlify.com/drop>, drag the unzipped
  **folder** onto the drop zone. You get a URL like
  `https://some-name-12345.netlify.app`.
- **Updating later:** open your site on Netlify → **Deploys** → drag the new
  folder onto the deploy area. Same URL.

### Part 8 — Authorize your Netlify domain in Firebase

Firebase blocks auth from origins it doesn't know.

1. Firebase Console → **Build → Authentication → Settings → Authorized domains**.
2. **Add domain** → paste your Netlify URL **without** `https://`
   (e.g. `some-name-12345.netlify.app`) → **Add**.

### Part 9 — Get the Gemini API key (only needed for Stage 5)

You can skip this until Stage 5.

1. <https://aistudio.google.com/apikey> → **Create API key** → pick your
   Firebase project.
2. Copy it. Save it privately. You'll paste it into `config.js` under
   `gemini.apiKey` when Stage 5 lands.

> **Never** commit `config.js` (with real values) or the Gemini key to a public
> repo, and don't paste keys into chats. Netlify env vars or a private repo are
> fine; a public GitHub repo is not.

---

## Using the app

### First run (both people)

1. Open the Netlify URL in a browser (Chrome on Android works best for install).
2. Tap **create an account**.
3. Pick your role: **her** or **her partner**.
4. Enter a name, email, and password (6+ characters). Tap **create account**.
5. You land on the paired screen showing your own 6-character pairing code.

### Pairing

1. One of you reads out (or texts) their 6-character code.
2. The other enters it in the "enter the code they shared with you" box and taps
   **link accounts**.
3. Both screens flip to "you're paired with …" in real time — no refresh needed.

### After Stage 2+ (not built yet)

- Her view becomes the tracker + to-do list.
- His view becomes the read-only cycle widget + wise-words note + her to-dos.

### Installing on a phone (after PWA wiring returns in a later stage)

In Chrome on Android: open the URL, tap the **⋮** menu, choose **Install app**
or **Add to home screen**. It then runs fullscreen with its own icon. Works
offline once the service worker is back in a later stage.

---

## How to extend it

The app is deliberately low-tech so it's easy to edit.

- **Add a screen or section:** add markup to `index.html`, give it a CSS class,
  toggle visibility from `js/main.js`.
- **Add a Firestore-backed feature:** create a new `js/<feature>.js` module that
  imports `db` from `firebase-init.js`, reads/writes its own collection, and uses
  `onSnapshot` for live updates. Mirror the pattern in `pairing.js`
  (`watchMyUserDoc`).
- **Keep the look consistent:** use the CSS variables and component classes in
  `css/shared.css` (sage `--pri`, cream `--cream`, the `.btn-primary` /
  `.logo-big` / `.logo-sub` patterns). Don't introduce off-palette colors.
- **Update security rules:** any new collection needs matching rules in
  `firestore.rules`, then re-publish in the Firebase console.

There is **no build step** — just edit and redeploy by dragging the folder to
Netlify.

---

## The roadmap

WHM's own core comes first; features ported from a second project ("Ember") are
folded in afterward, one at a time.

### WHM core

| Stage | Scope | Status |
|-------|-------|--------|
| 1 | Auth + pairing | ✅ built, ⏳ user verifying |
| 2 | Cycle tracker (her) + to-do list (her, partner-readable) | not started |
| 3 | Wise-words curated bank + his-side dashboard | not started |
| 4 | Question engine — pool, prompting, profile entries | not started |
| 5 | Gemini-powered recommendation card (+ folds in date-night ideas) | not started |
| 6 | Polish — settings, cadence, profile editing, password reset, PWA wiring | not started |

### Ember-derived (after the core works)

| Stage | Scope | Status |
|-------|-------|--------|
| 7 | `couples/{coupleId}` shared-doc model (both-writable data) | not started |
| 8 | Anniversary countdown (one shared date, live ticking) | not started |
| 9 | Milestone timeline ("our story so far") | not started |
| 10 | Shared watchlist (movies/shows, ratings, reviews) | not started |
| 11 | Date-night ideas — folded into Stage 5, not standalone | — |
| 12 | Couple quiz (optional, may be cut) | not started |

Each stage is a working, deployable build. See `HANDOVER.md` for the full
reasoning behind the design decisions and the Ember merge.

---

## Conventions

1. Separate `css/`, `js/`, `assets/`, `icons/` folders. No inline JS/CSS in
   `index.html` except the pre-boot config check.
2. No build tooling — plain HTML + ES modules + Firebase CDN imports.
3. Visual style locked to the WHM tokens in `shared.css` (sage `#4F6E4A`, cream
   `#F5EEDD`, paper grain, Fraunces/Nunito/Caveat).
4. All config in one file: `config.js` (shipped as `config.example.js`).
5. Firebase SDK v10.13.2, modular imports from the gstatic CDN.
6. User-facing auth errors go through `friendlyAuthError()` — raw Firebase codes
   never reach the UI.
7. Pairing = both users' `pairedWith` set to each other. No separate "pairings"
   collection.
8. `onSnapshot` is the standard pattern for real-time sync between partners.
9. To-dos are fully visible to the partner — no per-item privacy toggle (an
   explicit product decision; don't re-add it without asking).
10. 0-indexed months when working with JS `Date`.

---

## Troubleshooting

**"Setup not complete" red box on load**
`config.js` is missing or still has `PASTE_YOUR_*` placeholders. Redo Part 6.

**Sign-up fails: "Missing or insufficient permissions"**
Either the security rules weren't published (Part 4) or your Netlify domain
isn't authorized (Part 8).

**Sign-up fails: "auth/operation-not-allowed"**
Email/Password sign-in isn't enabled (Part 2).

**Pairing code says "No one's using that code"**
Check spelling. Codes are uppercase and never contain `0`, `O`, `1`, `I`, `L`.
Verify the `pairingCodes` collection in Firestore has a doc with that ID.

**One side pairs but the other doesn't update**
The real-time listener needs the other side's page still open. Close and reopen
it; it picks up the paired state on load.

**"Network error" on submit**
Check `authDomain` in `config.js` ends in `.firebaseapp.com` (common typo:
`.firebase.com`).

**Chrome shows only "Add to home screen", not "Install app"**
That's fine on modern Chrome with a valid manifest — it still installs a real
standalone app. (PWA manifest returns in a later stage.) Make sure you're in
regular Chrome, not Incognito, and you've interacted with the page for ~30s.

---

## Security notes

- `config.js` and the Gemini key are not for public repos. Keep them private.
- Firebase's web config (`apiKey`, etc.) is *designed* to be visible in the
  browser — it's not a secret. Your data is protected by the **security rules**,
  not by hiding the config. That's why publishing correct rules (Part 4) matters.
- The `pairingCodes` lookup is readable by any signed-in user, but a code only
  reveals a uid — useless without going through the pairing flow, which only
  works against an unpaired account.
- On the Spark plan the Gemini key ships to the browser in Stage 5. Free-tier
  abuse only depletes a per-project quota; it can't run up a bill. Revisit if
  WHM ever grows beyond two users.

---

_For the full project history, the rationale behind every design decision, the
Ember merge details, and notes for resuming the build cold, see `HANDOVER.md`._
