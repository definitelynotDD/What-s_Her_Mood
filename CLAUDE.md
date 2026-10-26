# What's Her Mood

The app is `whm-site/` (plain HTML + ES modules, Supabase, WebRTC). Every push
to `main` deploys it to whm-couple.netlify.app. Read `whm-site/HANDOVER.md`
first; `HANDOVER-2026-10-20.md` has the owner-facing status.

- **Run the tests before pushing to `main`:** `cd tests && npm install && npm test`
  (~4 min, no Supabase needed; see `tests/README.md`). There is no CI, so this is
  the only check before a change reaches both phones. Add a test with any fix.
- Never commit `whm-site/config.js` (git-ignored; the build writes it from
  Netlify env vars). Never put a Supabase `service_role` key in the app or Netlify.
- The repo is public: keep secrets and private details out of code, docs and tests.
