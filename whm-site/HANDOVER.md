# WHM — Handover & decision record

For whoever picks this up next (including a future you who's forgotten the
details). `README.md` is the original product spec; this file is the source of
truth for **where the build stands** and **why it's built this way** — and it now
reflects the switch from Firebase to Supabase.

---

## Where the build stands (read this first)

**Stages 1–4 are deployed** (Stage 4, the daily question, on 26 Oct 2026). Two people can sign up (each picks
"her" or "her partner"), each gets a 6-character pairing code, and entering
the partner's code links the two accounts in real time. Once paired, the app
screen becomes a small daily dashboard: HER's cycle tracker (current phase +
day, log period starts, tunable cycle/period length) and HER's to-do list
(fully partner-readable), a phase-aware wise-words note, and (Stage 4) one
optional question a day for her whose answers fill an "about her" card he can
read. Plus a working peer-to-peer hangout (video + audio
+ chat + screen share with tab audio + per-viewer volume + mute pill) that
started as a stretch feature and now works end-to-end.

- **Backend:** Supabase project **`mygaahtcnpfixdrwfptw`** (region
  ap-southeast-1). The database schema is applied (see `supabase/schema.sql`,
  four migrations: `whm_stage1_auth_pairing`, `whm_stage1_harden_functions`,
  `whm_stage2_cycle_todos`, `whm_stage4_profile_questions`), `config.js` has
  the project URL + anon key. All
  security-advisor findings are intentional (the guarded `claim_partner` RPC)
  or optional (leaked-password protection).
- **Hosting:** [whm-couple.netlify.app](https://whm-couple.netlify.app) —
  Netlify site id `bc6a3cca-6842-4ce3-9465-9aedf9fad8af`, team
  `definitelynotdd`, **connected to GitHub: every push to `main` deploys**.
  Its `config.js` is generated at build time from Netlify env vars
  (`scripts/write-config.mjs`, see `DEPLOY.md`). The previous manual-upload
  project is `whm-couple-old.netlify.app` (`67ba4904-…`), frozen on 8 Aug.
- **Frontend:** `index.html` + `css/` + `js/` — one folder, `whm-site/`. Modules:
  `supabase-init.js`, `auth.js`, `pairing.js`, `main.js` (Stage 1 core);
  `cycle.js` + `todos.js` + `tracker.js` (Stage 2); `rtc.js` + `hangout.js`
  (the P2P hangout); `realtime.js` (every Realtime channel goes through it).

**Why not Firebase?** Stage 1 was first built on Firebase, but creating the
Firestore database hit a "billing must be enabled" wall, and Firebase has no
MCP to automate setup. Supabase has a connected MCP, a free tier with no card,
and let the whole backend be stood up programmatically. The old Firebase files
(`firestore.rules`, `js/firebase-init.js`) have been removed — nothing depends
on them.

**Repo layout note (Aug 2026):** the build lived briefly in two parallel
folders — `whm-stage1/` (docs + Firebase-era stubs) and `whm-site/` (working
copy that grew the hangout). They were consolidated: `whm-site/` is now
canonical, `whm-stage1/` is gone. If old README/HANDOVER copies mention
`whm-stage1/` anywhere, treat that as history.

**Next actions:**

1. **Stage 5** — a recommendation card for him that draws on her Stage 4
   answers and today's phase. Keep any LLM key server-side (a Supabase Edge
   Function secret), never in `config.js`: the site and repo are public.
2. If the in-call readout says "via relay" and voice is choppy: get a
   dedicated TURN account (Metered free tier, or Twilio / Cloudflare) and put
   its credentials URL in `config.webrtc.iceServersUrl`. No code change needed.

---

## Origin

WHM began as **BroCode** — a single-page "cozy field manual for boyfriends"
(hero, five cycle phases, a 30-day tracker, "the bro code"). That page still
lives at the repo root, later rebranded *"What's Her Mood,"* with PWA wiring.
WHM turns that one-way manual into a **private two-person app** with real
accounts: her side becomes a daily tool (cycle tracker + to-dos), his side a
thoughtfulness aid (read-only cycle, a daily "wise words" note, her to-dos, and
later mood-aware suggestions from a gently-built profile).

---

## Architecture, and why

| Layer | Choice | Why |
|---|---|---|
| Frontend | Plain HTML + ES modules | No build step — edit a file, redeploy |
| Styling | Hand-written CSS tokens | Locks the sage/cream "candle" look |
| Auth | Supabase Auth (email/password) | Free, no auth server to run |
| Database | Supabase Postgres + RLS | Relational, real-time, fine-grained security |
| Realtime | Supabase Realtime | Pushes row changes → live pairing |
| Hosting | Netlify drag-and-drop | HTTPS, free, no pipeline |
| Plan | Supabase Free | Enough for two users; no card |

`@supabase/supabase-js@2` is imported as an ES module straight from a CDN
(`esm.sh`) — no npm, no bundler. The "backend" is Postgres + RLS policies + two
SQL functions. The only thing hosted is this folder of static files.

Free-tier note: the Stage-5 Gemini key will be used from the browser (no server).
Gemini's free tier is rate-limited per project — a quota cap, not a billing risk.

---

## Key design decisions (the ones easy to get wrong)

**Pairing is mutual `paired_with`, not a join table.** Two rows in
`public.users`, each pointing at the other. Linking is done by the
`claim_partner(p_code)` Postgres function — `SECURITY DEFINER`, so it can write
both rows, with both guarded updates in **one transaction**: if the partner got
taken a moment earlier, the whole call rolls back (including my side). This is
the Supabase equivalent of the old Firestore "controlled cross-document write,"
and it's cleaner because the atomicity and the checks live server-side.

**The client never writes the table directly.** Sign-up creates the profile row
via an `auth.users` **trigger** (`handle_new_user`) that reads `display_name` and
`role` from the signup metadata and generates a unique pairing code. Pairing is
the RPC above. So there's no INSERT/UPDATE policy to get wrong — only reads.

**RLS: read your own row; read your partner's once linked.** The partner-read
policy calls `private.my_partner()` (a `SECURITY DEFINER` helper) to fetch my
`paired_with` without the policy recursing on its own table.

**Helpers live in a `private` schema.** `gen_pairing_code` and `my_partner` are
not in `public`, so they aren't exposed over the REST API. The signup trigger
function has its REST `EXECUTE` revoked. The security advisor is clean except for
one intentional note: `claim_partner` is callable by signed-in users — that's the
point; it's guarded internally.

**The Supabase URL + anon key are not secrets.** They're meant to be in the
browser; security is RLS, not hiding them. `config.js` is git-ignored only to
keep it per-deployment and to keep the (real) **Gemini** key out later.

**`friendlyAuthError()` is the only thing the UI shows** — it maps both Supabase
auth errors and the pairing-RPC exceptions (`NO_SUCH_CODE`, `OWN_CODE`,
`PARTNER_TAKEN`, …) to warm sentences.

**Pre-boot config check.** `index.html` loads `config.js`, then an inline IIFE
verifies `WHM_CONFIG.supabase` is present and not a placeholder; otherwise it
shows "Setup not complete" and never imports `main.js`. Only inline JS in the HTML.

**Email confirmation is handled both ways.** If Supabase's confirm-email is on,
sign-up has no session yet, so the app says "check your email, then sign in." Turn
it off for the frictionless two-person flow (see `DEPLOY.md`).

**Fonts are local** (`css/shared.css` → `assets/*.woff2`: Fraunces / Nunito /
Caveat), same files the field-manual page uses.

---

## Hangout (WebRTC over Supabase Realtime)

Off-roadmap but shipped. A private 2-person room the paired couple can open
from the app screen — video, audio, ephemeral text chat, screen share with
tab-audio, per-viewer volume slider, muted-pill overlay on either party.

**Signaling & rendezvous** — one Supabase Realtime channel per couple, keyed
by the sorted pair of uids (`couple = [a,b].sort().join("__")`). The channel
carries broadcast events: `hello` (rendezvous), `signal` (SDP + ICE),
`chat`, `heart` (lands on the tapped face: camera-image coords + whose
face), `mute`, `camera` (camera-off cover), `slap` (js/slap.js — hand +
"SLAP!" + shake + Web Audio slap sound, 1.2 s cooldown; sound is unlocked
by the tap that opens the room and by any tap inside it), `bye` (left the
room), plus screen-lifecycle
(`screen-on`, `screen-off`). Every payload carries `from`, `since` (session
start) and `cam` (the sender's camera MediaStream id, used to route streams).

We originally used Supabase Realtime **presence** to know when both partners
were in the room and it was safe to `addTrack` — but presence never fired
reliably here even though broadcast worked fine. Fix: a `hello` handshake on
subscribe; anything you hear from the partner (`hello`, `signal`, or `chat`)
counts as "they're here" and triggers `addTrack`, which starts negotiation
via the perfect-negotiation dance in `rtc.js`. Presence is kept on the
channel only for the nice "your partner left" status.

**Media** — one `getUserMedia({video,audio})` MediaStream (camera + mic) plus,
when sharing, a separate `getDisplayMedia({video:true,audio:true})` stream
added as **new senders** (not `replaceTrack`) so the camera track stays live
and the partner keeps seeing the sharer's face. Receiver routes streams by
`MediaStream.id`: first stream = camera, later distinct stream = screencast.

**NAT traversal** — STUN alone can't punch symmetric NATs (typical of mobile
carrier CGNAT). Config includes Metered's Open Relay TURN on ports 80, 443,
and 443/tcp as a fallback. It's a shared free relay — swap in your own
Twilio / Cloudflare Calls / Metered account for real production use.

**Screen audio** is best-effort — Chrome/Edge deliver it when the user picks
a tab (with "Also share tab audio" ticked) or whole screen on Windows.
Firefox / Safari / mobile silently return no audio track; the share still
goes through, just video-only. The capture asks for `restrictOwnAudio` so a
whole-screen share doesn't pick up the call's own sound (the partner hearing
their own voice echoed back), and turns voice processing off for it (it's
music/video, not speech).

**Long calls (Oct 2026 fix).** Media is P2P, so the call itself survives the
signaling channel dying — but screen share (needs a renegotiation), chat and
hearts silently stopped after roughly an hour. Cause: supabase-js only runs its
token refresh while the tab is *visible* ("refresh token ticker runs only on
focused tabs", auth-js `_onVisibilityChanged`); switch to the tab you're
sharing, the JWT expires, Realtime closes the channel, and nothing re-opened
it. Three layers now:
1. `realtime.js` `keepAuthFresh()` refreshes the session itself while any
   channel is open (checks every 60 s; refreshes with <5 min left).
   supabase-js forwards `TOKEN_REFRESHED` to Realtime and auth-js broadcasts
   it to the app's other tabs.
2. `realtime.js` `keepSubscribed()` watches `CHANNEL_ERROR` / `TIMED_OUT` /
   `CLOSED` and rebuilds the channel if supabase-js's own rejoin doesn't win
   within 5 s (1 s for `CLOSED`, which nothing else retries). **Every** Realtime
   channel in the app goes through it — hangout, `me:` (pairing), `cycle:`,
   `todos:` — and the data watchers re-fetch on every join (first included;
   Realtime never replays what you missed) behind `onlyWhenChanged()`, so a
   catch-up fetch with nothing new doesn't re-render or remount anything.
3. `rtc.js` offer watchdog: an offer with no answer is **re-sent unchanged**
   (4 s, 8 s, then every 15 s). Not rollback + new offer — if the *answer* was
   the lost message, the partner already applied the old offer and rejects a
   rebuilt one ("order of m-lines … doesn't match").
Also: the share layout follows the actual screen track (arrives → on,
`removetrack` → off), so a lost `screen-on`/`screen-off` can't strand it; every
message carries the sender's session start (`since`) so a partner who leaves and
rejoins gets a fresh RTCPeerConnection on the other side (a `bye` does the same
immediately); ICE restarts itself on `failed`.

**Calls that never start (Oct 23 fix).** When both open the room at the same
moment, both send an offer; the polite side rolls its own back, and now and
then (about 1 in 50 in the test rig) Chrome's candidate gathering on that side
dies with it. Signaling looks finished, both screens say "connected ♡", but no
candidate ever goes out, so ICE sits at `new` forever and never reaches
`failed`; an ICE restart doesn't revive it either. The `rtc.js` connect
watchdog (impolite side only) notices ICE still at `new` 6 s after negotiation
and calls `onStuck`; `hangout.js` `startFresh()` then does what a rejoin does —
bumps `since`, rebuilds the connection, says hello — and the partner rebuilds
too. Same cure when every ICE candidate is lost in signaling.

**Voice quality.** The mic sender negotiates **RED** (redundant Opus — each
packet carries the previous frame, so a lost packet is rebuilt instead of heard
as a glitch; ~2× audio bitrate, verified in Chromium) and runs at
`priority: "high"` so video degrades before voice. The status line shows a
readout from `getStats()` — `direct` / `via relay`, `voice clear` / `choppy ·
N% lost`, RTT. If voice is bad but the readout says clear, it's the device, not
the network: Bluetooth earbuds drop into low-quality headset mode when their mic
is in use, and speakers without headphones lean on echo cancellation. The
hangout has a **mic picker** (shown when there's more than one mic; choice
remembered in `localStorage`) and, when the active mic's label looks like
earbuds, a hint offering the built-in mic so the earbuds stay in high-quality
listening mode. Switching uses `replaceTrack` — no renegotiation, mute state
kept — and if the mic disconnects mid-call (earbuds die) it falls back to the
default mic instead of going silent. No speaker picker on purpose: routing
output away from the default device can weaken Chrome's echo cancellation.

**Relay (TURN).** `config.webrtc.iceServersUrl` (optional) is fetched at the
start of each hangout for fresh TURN credentials — Metered's credentials URL
returns the right shape directly; `{ iceServers }` / `{ ice_servers }` bodies
also work. Falls back to `config.webrtc.iceServers` on any error.

**Special days (`js/celebrate.js`).** On dates listed in
`config.celebrations` (Netlify env var `WHM_CELEBRATIONS`; live value: the
21st and 10th of every month at India midnight, counting from 21 Nov 2025 and
10 Dec 2025) a signed-in, paired couple gets a 7 s canvas fireworks + heart
shower and a banner (header + cozy room) for the day, tap to replay. Entries:
`{date:"YYYY-MM-DD", every:"month"|"year", timeZone:"Asia/Kolkata", title}`
with `{since}` ("11 months" / "1 year 2 months"), `{months}`, `{years}`. The
app watches the clock while open, so the show starts at midnight even mid-call
(held until the tab is visible) and the banner leaves when the day ends.
Nothing before/on the start date; days past a month's end land on its last
day; reduced-motion users get the banner only. `?celebrate` previews it. Kept out of code on purpose — the repo is public. A settings
screen can later write the same shape (README plans `anniversaryDate` on a
`couples` doc).

**Tests (`tests/`, outside the published folder).** `cd tests && npm install
&& npm test`. Two Chromium tabs (Playwright, fake camera/mic/screen) run the
real `hangout.js` + `rtc.js` against each other, with `supabase-init.js`
swapped for a BroadcastChannel mock that can drop messages and kill channels on
command. The same mock plus a tiny `from()` query stub covers `realtime.js` and
the pairing / to-do watchers, and the special days run on a fake clock. Run
them before pushing anything that touches the hangout. See `tests/README.md`.

**Watch out for** — the auth listener has to dedupe by uid, otherwise
`onAuthStateChange` fires on `TOKEN_REFRESHED` (every tab foreground) and the
router yanks the user back to the app screen mid-call. See `auth.js`
`watchAuth`.

## Stage 2 (cycle tracker + to-dos)

Both features are **HER-owned, partner-readable**. Three tables — `cycle_settings`
(one row per her-user, tunable cycle & period length), `period_starts` (log of
period-start dates, unique per user + date), and `todos` (flat list, no
categories, no per-item privacy toggle). All three enable RLS with the same
pattern Stage 1 uses: the row-owner reads/writes; the partner reads via the
`private.my_partner()` helper.

**Role gate.** Writes are further gated to `role='her'` by a new
`private.my_role()` helper — even if a `partner` account somehow tried to
insert its own cycle/todo row, the RLS WITH-CHECK on the write policy would
reject it. This is defence-in-depth; the UI only renders write controls when
`role='her'` anyway.

**Phase math.** `cycle.js` uses a simple Naegele-style luteal-phase model:
ovulation lands around `max(P+2, C-14)` where C is the cycle length and P the
period length. Menstrual is days 1..P; PMS is the last five days; ovulation is
a three-day window centred on the estimate; the rest is follicular before and
luteal after. Precise enough for a daily read; not a medical device. Overdue
cycles (day > cycleLength) hold on PMS + surface a "log the next start when it
arrives" hint.

**Realtime.** All three tables are on the `supabase_realtime` publication.
`tracker.js` subscribes to the *her-user's* uid regardless of who's viewing —
so when SHE logs a period start on her phone, HIS phone's phase pill flips
without a refresh, and vice versa for a checked-off to-do.

**Mounting.** The tracker lives inside the paired-box on `#screen-app`. It
mounts when the pair completes and unmounts on sign-out. Views branch on the
signed-in user's role: HER gets editable cards; PARTNER gets read-only cards
(no add-to-do form, no period-log form, no edit/remove buttons).

## Stage 4 (daily question → "about her")

**What she sees.** A "little question for you" card in the today view: one
question a day, optional. **save** turns the answer into a profile entry;
**skip** rests the question for 14 days; **ask me another** gets the next one.
Once she has answered or skipped one today, the card rests until tomorrow.
Below her to-dos, an **about you** card lists her answers by kind (how to help,
comfort, food & drinks, little joys, things to do, watch & listen, wishlist,
please don't). She can edit or remove any of them, or add her own.

**What he sees.** An **about <her>** card right under the wise words,
read-only, live. When she's in a phase she answered a phase question for, those
answers are pulled up top: "on days like today (pms week)".

**Which question comes next** (`js/questions.js`, pure, tested in Node): not
answered, not skipped in the last 14 days; questions for today's phase first,
then everyday ones in bank order, then other phases'. The bank (28 questions)
lives in code, not the database: reword freely, but never change a shipped
`id`, because her history and entries point at it. Add a question by appending
to `QUESTIONS`.

**Tables.** `profile_entries` follows the todos pattern (her writes, partner
reads; `phase_tags` from the question). `question_history` has one row per
question she answered or skipped (`asked_on` is her local date, sent by the
app) and only an owner policy, so her partner can't see what she skipped. Both
tables revoke `anon`. Verified on 26 Oct by acting as each role in one
rolled-back transaction: she reads/writes her own rows; he reads her entries
but not her history and can't insert, edit or delete; a third account and
signed-out requests see nothing; bad kinds and phases are rejected.

**If the tables are missing** (code deployed before the migration), the
question card stays hidden and the rest of the dashboard works. The tests
cover this.

## Installable app + landing tab (26 Oct)

`manifest.webmanifest` (name "What's Her Mood", short name "Her Mood",
standalone, sage/cream colors, the existing `icons/` incl. maskable) plus the
Apple meta tags in `index.html` make it installable: "Install app" in Android
Chrome, full-screen from Add to Home Screen on iPhone. **No service worker, on
purpose:** nothing is cached, so a deploy reaches both phones on the next open
and the two never run different builds (the cozy room needs them to match).
Chrome hasn't required a service worker to install for a while; `app.test.mjs`
asks Chrome itself (`Page.getInstallabilityErrors`) and expects no errors.

**Landing tab.** Opening the app already paired lands on **today** (tracker +
the day's question). Pair-up is shown only at the moment two accounts link,
so "you're paired with … ♡" gets its beat, and on unpair. `main.js`
`renderUserRow` tells the two apart with `rowSeen` (reset on every sign-in).

## Data model (built so far)

```
auth.users                       -- Supabase-managed accounts
public.users                     -- Stage 1
  id uuid PK -> auth.users.id
  email, display_name,
  role 'her'|'partner',
  paired_with uuid -> users.id (nullable),
  pairing_code text unique,      -- queried directly; no separate codes table
  created_at

public.cycle_settings            -- Stage 2 (one row per her-user)
  user_id uuid PK -> users.id,
  cycle_length int   default 28  check 20..45,
  period_length int  default 5   check 2..10,
  updated_at

public.period_starts             -- Stage 2 (log of period-start dates)
  id uuid PK, user_id -> users.id,
  start_date date,
  notes text,
  created_at
  unique (user_id, start_date)

public.todos                     -- Stage 2 (her's list)
  id uuid PK, user_id -> users.id,
  title text (1..240),
  done bool, done_at,
  created_at

public.profile_entries           -- Stage 4 (her answers, partner-readable)
  id uuid PK, user_id -> users.id,
  thing text (1..200),
  category 'care'|'comfort'|'food'|'little'|'activity'|'media'|'wishlist'|'avoid',
  source 'answered-question'|'added-manually',
  question_id text (id in js/questions.js, nullable),
  phase_tags text[] (subset of the five phases),
  created_at

public.question_history          -- Stage 4 (private to her)
  user_id -> users.id, question_id text,  PK (user_id, question_id)
  status 'answered'|'skipped',
  skipped_until date, asked_on date
```

No separate pairing-codes table is needed (unlike Firestore) — Postgres can query
`where pairing_code = …` directly, and `claim_partner` does the lookup safely.

Later stages will add their own tables with their own RLS, e.g.
`recommendations` (Stage 5), `couples` (Stage 7+).

---

## Roadmap

| Stage | Scope | Status |
|---|---|---|
| 1 | Auth + pairing | ✅ built, deployed, smoke-tested |
| — | Hangout (video, chat, screen share w/ audio) | ✅ built, off-roadmap bonus |
| 2 | Cycle tracker (her) + to-dos (her, partner-readable) | ✅ built, deployed |
| 3 | Wise-words bank + his-side dashboard | ✅ built, deployed (wise-words card, both sides) |
| 4 | Question engine → profile entries | ✅ built, deployed (26 Oct) |
| 5 | Gemini recommendation card (folds in date-night ideas) | not started |
| 6 | Polish — settings, profile editing, password reset, PWA wiring | PWA wiring done 26 Oct; rest not started |
| 7–12 | Ember-derived: shared `couples` doc, anniversary countdown, milestone timeline, watchlist, quiz | not started |

Each stage is a working, deployable build. Port Ember features one at a time
*after* the core is verified.

---

## Conventions to keep

1. Separate `css/`, `js/`, `assets/`, `icons/`. No inline JS/CSS in `index.html`
   except the pre-boot config check.
2. No build tooling — plain HTML + ES modules + supabase-js from CDN.
3. Visual style locked to the `shared.css` tokens (sage `#4F6E4A`, cream
   `#F5EEDD`, paper grain, Fraunces/Nunito/Caveat). No off-palette colors.
4. All config in one file: `config.js` (shipped as `config.example.js`).
5. The client never writes `public.users` directly — signup via trigger, pairing
   via `claim_partner` RPC. New write paths go through RLS-checked tables or RPCs.
6. User-facing errors go through `friendlyAuthError()`.
7. Pairing = both rows' `paired_with` set to each other. No join table.
8. Supabase Realtime (`postgres_changes` on `public.users`, filtered to my row)
   is the real-time pattern; `watchMyUserRow` is the reference implementation.
   Open channels with `realtime.js` `keepSubscribed()`, never bare
   `supabase.channel().subscribe()` — a bare channel dies for good the first
   time its token expires in a background tab.
   For any 2-party rendezvous like the hangout, prefer a broadcast handshake
   over presence — presence hasn't been reliable in our tests.
9. To-dos (Stage 2) are fully partner-visible — no per-item privacy toggle. An
   explicit product decision; don't re-add it without asking.
10. Any new table needs RLS enabled + policies, then re-run the security advisor.
11. Keep internal/helper SQL functions in the `private` schema so they aren't
    exposed over the REST API.
