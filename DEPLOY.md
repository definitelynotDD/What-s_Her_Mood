# Deploying BroCode to your Android phone

This guide takes you from "I have a folder" to "BroCode is installed on
my Android home screen and works offline." Estimated time: 10 minutes.

The path: **GitHub repo → GitHub Pages → Chrome on Android → install
prompt → home screen icon**.

---

## Prerequisites

- A GitHub account (free — sign up at https://github.com/signup if needed)
- Chrome on your Android phone (or any Chromium-based browser like Edge/Brave)

You don't need git installed locally — GitHub has a drag-and-drop web
uploader for the whole folder.

---

## Step 1 — Create a new GitHub repo

1. Go to https://github.com/new.
2. **Repository name:** `brocode` (or any name; remember it — it'll be in your URL).
3. Set it to **Public** (Pages on free accounts requires public repos).
4. **Do not** add a README, .gitignore, or license — start it empty.
5. Click **Create repository**.

GitHub now drops you on a page with setup instructions. Ignore them.

---

## Step 2 — Upload the folder

1. On that same page, click **"uploading an existing file"** (it's a small
   link in the gray instruction box) — or go to
   `https://github.com/YOUR_USERNAME/brocode/upload/main`.
2. Open the `BroCode-PWA` folder on your computer.
3. **Drag the contents** (not the folder itself — the files and the
   subfolders inside it) onto the GitHub upload area.

   The structure GitHub should end up with is:
   ```
   index.html
   manifest.webmanifest
   service-worker.js
   README.md
   assets/...   (the woff2/js files)
   icons/...    (the PNGs)
   ```
   If GitHub shows a nested `BroCode-PWA/` folder at the top, that's
   wrong — you uploaded the folder; you wanted the contents. Delete and
   redo, dragging the children of the folder instead.

4. Scroll down. Commit message can be "initial". Click **Commit changes**.

The upload takes a minute or two because of the bundled fonts and React
files (~5 MB total).

---

## Step 3 — Turn on GitHub Pages

1. In your repo, click **Settings** (top tab).
2. In the left sidebar, click **Pages**.
3. Under **Source**, choose **Deploy from a branch**.
4. Under **Branch**, pick `main` and folder `/ (root)`. Click **Save**.

GitHub now builds and publishes the site. The first deploy takes about a
minute. The Pages settings panel will eventually show:

> **Your site is live at** https://YOUR_USERNAME.github.io/brocode/

Copy that URL. **Open it in Chrome on your phone.**

> Note: if you see a 404, wait another minute and refresh. GitHub Pages
> takes a moment to propagate the first time.

---

## Step 4 — Install on Android

1. Open the URL in Chrome on your phone.
2. Within a few seconds of loading, Chrome will show one of:
   - A **banner at the bottom** that says "Install BroCode" or similar.
   - An **"Install app"** option in the three-dot menu (top right).
   - A small ⊕ icon in the address bar.
3. Tap **Install** (or **Add to Home screen**). Confirm.
4. Done. You now have a BroCode icon on your home screen.

When you launch it from the home screen, it opens **fullscreen** with no
browser chrome — just the app, like any other installed Android app.
It'll work even when you're offline.

> If you don't see an install prompt: tap the three-dot menu in Chrome
> → look for "Install app" or "Add to Home screen". If you only see "Add
> to Home screen" (without "Install app"), Chrome thinks something
> doesn't qualify — see the troubleshooting section.

---

## Step 5 — Verify

Once installed:
- Tap the BroCode icon. It opens fullscreen.
- Punch in a date in the tracker, change cycle length, hit *show me
  today's vibe*. The today-card and 30-day strip appear.
- Close the app. Re-open it. **Your inputs are still there** and the
  today-card has refreshed against today's date.
- Turn off Wi-Fi + mobile data. Open BroCode. **Still works.**

That's the install done.

---

## Updating BroCode later

1. Edit any file locally (e.g., change text in `index.html`).
2. **Bump the cache version** in `service-worker.js`:
   ```js
   const CACHE_VERSION = 'brocode-v2';  // change this!
   ```
   This forces phones with the old version to re-download everything.
3. In GitHub, navigate to the file you want to replace, click the pencil
   icon, paste the new contents, and commit. Or use **Add file → Upload
   files** to replace many at once.
4. GitHub Pages auto-rebuilds within a minute.
5. On your phone, open the installed app. The service worker fetches
   the new version on next launch (sometimes takes one extra reload to
   fully activate the new cache — that's normal PWA behavior).

---

## Troubleshooting

**"Install app" doesn't appear in Chrome's menu**
- Make sure you're loading the URL over `https://` (GitHub Pages uses
  HTTPS by default — should be automatic).
- Chrome requires at least one page visit lasting ~30 seconds with some
  interaction before showing the install banner. Just scroll around a
  bit.
- Open Chrome DevTools on desktop (visit the URL there too) → Application
  → Manifest. It'll list any errors holding back installability.

**Icon looks broken / wrong**
- Android sometimes caches the old icon for 24 hours after a manifest
  change. Uninstall and reinstall to force-refresh.

**Offline mode doesn't work**
- Service workers register on first visit, but the precache only
  completes on the SECOND load (this is how SW lifecycle works). Visit
  the URL once, close the tab, open it again — now you're cached.

**Data doesn't persist after reinstall**
- That's expected. Uninstalling a PWA on Android clears its localStorage.
  Reinstalling gives you a fresh slate.

---

## What you actually built

A real **PWA (Progressive Web App)**:
- **Manifest** (`manifest.webmanifest`) — tells Android the app's name,
  icons, and that it should open fullscreen.
- **Service worker** (`service-worker.js`) — precaches everything on
  first visit; subsequent loads (even offline) serve from cache.
- **Icons** (`icons/`) — multiple sizes including a maskable variant
  that adapts to Android's circle/squircle/squareicon shapes without
  cropping the chibi.

This is the same architecture Twitter, Spotify, and Instagram use for
their installable web apps. No app store, no native code, no review
process — you ship by pushing to GitHub.
