# Tests

Browser tests for `whm-site/`. They live outside `whm-site/`, so none of
this is published or touched by the Netlify build.

```sh
cd tests
npm install
npx playwright install chromium   # once per machine; skip if Chromium is already there
npm test                          # everything, ~4 minutes
```

Needs Node 22+. No Supabase account, keys or network: `lib/server.mjs` serves
the real `whm-site/` files but swaps `js/supabase-init.js` for
`fixtures/mock-supabase.js`, which fakes Realtime over `BroadcastChannel` and
keeps tables in `window.__db` (reads and writes; a write is echoed to the
tab's `postgres_changes` listeners the way Realtime would).

| File | What it covers | Time |
|---|---|---|
| `hangout.test.mjs` | Two real Chromium tabs on one real WebRTC call (fake camera, mic and screen): connecting, voice tuning, screen share, lost signaling messages, dropped channels, rejoining, a call that negotiates but never connects, mic switching, hearts, camera-off, slap | ~3 min |
| `app.test.mjs` | Opening the app: lands on today when already paired, on pair-up when pairing happens live; Chrome confirms it's installable | ~10 s |
| `call-bubble.test.mjs` | Two phones on one call in the whole app: the tabs stay up mid-call, "today"/"pair up" shrink the call to a bubble that keeps playing (unread messages on it), tapping it comes back, leave ends it. Plus the welcome and sign-in pages fitting a small phone | ~20 s |
| `profile.test.mjs` | Stage 4 in the real app: her daily question (save, skip, one a day, ask another, phase questions first), editing what he sees, his read-only view with "on days like today", live updates, missing tables | ~15 s |
| `questions.test.mjs` | Which question comes next, and that the question bank is well formed. Plain Node | <1 s |
| `celebrate-dates.test.mjs` | Which days celebrate and for how long. Plain Node, no browser | <1 s |
| `celebrate.test.mjs` | Special-day banner and fireworks in the real app | ~15 s |
| `celebrate-clock.test.mjs` | Same, on a fake clock: midnight IST mid-call, the banner leaving at day's end, phones in other time zones | ~30 s |

Run part of it:

```sh
node hangout.test.mjs share_and_stop,slap_spam_is_throttled   # named tests only
VERBOSE=1 node hangout.test.mjs                                # every console line
npm run test:celebrate
```

`CHROMIUM_PATH=/path/to/chrome` uses a specific browser binary instead of
Playwright's own.

**Knobs on `window.__mock`** (in the browser) are how the hangout tests break
things on purpose:

- `dropOut`: drop everything this tab sends.
- `dropOutEvents`: drop only some events.
- `dropOutDescriptions`: drop the next N offers or answers.
- `dropOutCandidates`: drop ICE candidates.
- `killChannels()`: what Realtime does when a token expires.
- `errorChannels(ms)`: a channel error.
- `emitChange(table, row)`: a database change.
- `failTables`: tables that answer with an error (set `window.__failTables`
  in an init script), e.g. to test a deploy that beat its migration.
