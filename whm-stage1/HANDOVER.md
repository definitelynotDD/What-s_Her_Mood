# WHM — Handover & decision record

For whoever picks this up next (including a future you who's forgotten the
details). `README.md` is the original product spec; this file is the source of
truth for **where the build stands** and **why it's built this way** — and it now
reflects the switch from Firebase to Supabase.

---

## Where the build stands (read this first)

**Stage 1 (Auth + Pairing) is built on Supabase.** Two people can sign up (each
picks "her" or "her partner"), each gets a 6-character pairing code, and entering
the partner's code links the two accounts in real time.

- **Backend:** Supabase project **`mygaahtcnpfixdrwfptw`** (org "dev", region
  Singapore). The database schema is **already applied** (see
  `supabase/schema.sql`) and `config.js` already has the project URL + anon key.
- **Frontend:** `index.html` + `css/` + `js/` (`supabase-init.js`, `auth.js`,
  `pairing.js`, `main.js`). UI unchanged from the original design.

**Why not Firebase?** Stage 1 was first built on Firebase, but creating the
Firestore database hit a "billing must be enabled" wall, and Firebase has no MCP
to automate setup. Supabase has a connected MCP, a free tier with no card, and
let the whole backend be stood up programmatically. The old Firebase files
(`js/firebase-init.js`, `firestore.rules`) are now **deprecated stubs** kept only
as breadcrumbs.

**Not done yet / next actions:**

1. **Deploy + smoke-test** (`DEPLOY.md`). Decide the email-confirmation setting,
   drag the folder to Netlify, create two accounts, verify pairing flips both
   sides live. This has **not** been run yet.
2. Decide whether the older single-page "field manual" at the repo root
   (`../index.html`, stale `../README.md` titled "BroCode") is replaced by WHM or
   kept beside it.

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

## Data model (Stage 1)

```
auth.users                       -- Supabase-managed accounts
public.users
  id uuid PK -> auth.users.id
  email, display_name,
  role 'her'|'partner',
  paired_with uuid -> users.id (nullable),
  pairing_code text unique,      -- queried directly; no separate codes table
  created_at
```

No separate pairing-codes table is needed (unlike Firestore) — Postgres can query
`where pairing_code = …` directly, and `claim_partner` does the lookup safely.

Later stages become their own tables with their own RLS, e.g. `cycles` (Stage 2),
`todos` (Stage 2, partner-readable), `profile_entries` + `question_history`
(Stage 4), `recommendations` (Stage 5), `couples` (Stage 7+).

---

## Roadmap

| Stage | Scope | Status |
|---|---|---|
| 1 | Auth + pairing | ✅ built (Supabase), ⏳ needs deploy + smoke-test |
| 2 | Cycle tracker (her) + to-dos (her, partner-readable) | not started |
| 3 | Wise-words bank + his-side dashboard | not started |
| 4 | Question engine → profile entries | not started |
| 5 | Gemini recommendation card (folds in date-night ideas) | not started |
| 6 | Polish — settings, profile editing, password reset, PWA wiring | not started |
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
9. To-dos (Stage 2) are fully partner-visible — no per-item privacy toggle. An
   explicit product decision; don't re-add it without asking.
10. Any new table needs RLS enabled + policies, then re-run the security advisor.
11. Keep internal/helper SQL functions in the `private` schema so they aren't
    exposed over the REST API.
