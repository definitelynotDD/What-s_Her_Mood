# Deploying WHM Stage 1 (Supabase)

The backend is **Supabase** (Postgres + Auth + Realtime). The database schema is
**already applied** to project `mygaahtcnpfixdrwfptw` (org "dev"), and `config.js`
already holds that project's URL + anon key. So deploying is mostly: check one
auth setting, drag the folder to Netlify, smoke-test.

## 1. One Supabase setting to decide: email confirmation

By default Supabase emails a confirmation link before a new account can sign in.
For a private two-person app that's extra friction.

- **Frictionless (recommended for two people):** Supabase dashboard →
  **Authentication → Sign-in / Providers → Email** → turn **"Confirm email" OFF**
  → Save. Now sign-up drops you straight into the app.
- **Keep confirmation on:** leave it. The app handles this — after sign-up it
  shows "check your email to confirm, then sign in." If you keep it on, also do
  step 3 (Site URL) so the confirmation link points at your live site.

## 2. Deploy the folder (Netlify)

The live site is [`whm-couple.netlify.app`](https://whm-couple.netlify.app)
(site id `67ba4904-c92b-4016-92c6-c4b019042b9a`, team `definitelynotdd`).
`netlify.toml` at the repo root pins `publish = whm-site` so the correct folder
ships.

Three ways to redeploy, pick whichever fits:

- **Netlify MCP (from Claude):** ask Claude to "redeploy whm-site" — it calls
  the deploy-site MCP tool which returns a shell command, then runs it. Uploads
  the whm-site folder and waits for the deploy to finish. No browser needed.
- **Netlify CLI:** `npx -y netlify-cli deploy --site 67ba4904-c92b-4016-92c6-c4b019042b9a --dir whm-site --prod`
- **Drag-and-drop:** <https://app.netlify.com/drop> → drag the **`whm-site`**
  folder. First time it creates a new site; after that use the Deploys tab of
  the existing site to update in place.

> `config.js` is git-ignored but **must** be in the folder that ships — that's
> how the deployed app gets its Supabase URL + key. Netlify preserves it because
> the deploy just uploads the folder contents verbatim.

## 3. (Only if email confirmation is ON) Set the Site URL

Supabase dashboard → **Authentication → URL Configuration** → set **Site URL** to
your Netlify URL, and add it under **Redirect URLs** → Save. This makes the
confirmation link return to your live app. (Email/password with confirmation
OFF doesn't need this — Supabase doesn't restrict sign-in by origin.)

## 4. Smoke test (2 phones or 2 browser profiles)

1. Open the URL → you should see the **welcome** screen (not the red
   "Setup not complete" box — if you see that, `config.js` is missing/placeholder).
2. Create two accounts — one **her**, one **her partner**. Each lands on a screen
   with its own 6-character pairing code.
3. On one, type the other's code → **link accounts**.
4. **Both** screens should flip to "you're paired with …" with no refresh
   (that's Supabase Realtime).
5. **Hangout smoke test:** on the paired screen, tap **start a hangout →** on
   both sides. You should see each other's camera, hear each other, and see the
   text chat work. Try **share screen** with "Also share tab audio" ticked in
   the picker — layout flips to 3/4 screen + 1/4 stacked cameras and shared
   audio comes through with a volume slider on the viewer side.

## If something fails

| Symptom | Fix |
|---|---|
| Red "Setup not complete" | `config.js` missing or still has `PASTE_…` values |
| "check your email to confirm" but you wanted instant | turn off Confirm email (step 1) |
| Sign-in says "Confirm your email first" | click the link in the email, or disable confirmation |
| Pairing: "No one's using that code" | check spelling — codes never contain `O 0 I 1 L` |
| One side doesn't flip to paired | that side's tab must be open; reopen it. Confirm Realtime is on for `public.users` (it is, in `supabase/schema.sql`) |
| "Network error" | check the `url` in `config.js` matches your project |

## Re-applying the schema (only if you ever start a fresh project)

The schema is already applied. If you spin up a *new* Supabase project, run
`supabase/schema.sql` in the dashboard's **SQL Editor**, then update `config.js`
with the new project's URL + anon key (Project Settings → API).
