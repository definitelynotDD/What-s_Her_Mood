# BroCode

A cozy little field manual, now installable as an app on your phone.

## What this is

A locally-runnable, **installable** Progressive Web App version of the
original BroCode site: hero, cycle phases, 30-day tracker, bro tips —
all intact and visually identical to the source. Adds:

- **Persistence** — tracker inputs survive reloads; today's-vibe card
  auto-renders when you come back.
- **PWA install** — Chrome on Android (and iOS Safari, with limits) can
  install it to your home screen. Runs fullscreen, works offline.

## Install on your phone

See **`DEPLOY.md`** for the full step-by-step guide. The short version:
upload this folder to a GitHub repo, turn on GitHub Pages in settings,
open the resulting `https://USERNAME.github.io/brocode/` URL in Chrome
on Android, tap **Install** when prompted. Done.

## Run it locally (without a phone)

Open `index.html` in any modern browser — double-click works for a
quick preview, but **the service worker won't register over `file://`**.
To test the PWA features locally, serve over HTTP:

```bash
# Python (already installed on most machines)
python3 -m http.server 8000

# Or Node
npx serve .
```

Then visit http://localhost:8000.

## What's saved (localStorage)

- **`brocode.v1.tracker`** — `{ startDate, cycleLen, periodLen }`.
  Restored on load; if a start date is present, the today-card + 30-day
  strip auto-render against the current date.
- **`brocode.v1.tweaks`** — `{ palette, stickerScale, tilt, grain }`.
  Used by the hidden developer tweaks panel.

To wipe: DevTools → Application → Local Storage → delete `brocode.v1.*`,
or run `localStorage.clear()` in the console.

## File layout

```
BroCode-PWA/
├── index.html                ← the page (~95 KB, all logic + styling)
├── manifest.webmanifest      ← PWA manifest (icons, theme, display mode)
├── service-worker.js         ← offline precache + cache-first fetch
├── DEPLOY.md                 ← step-by-step deploy + install guide
├── README.md                 ← this file
├── icon-source.svg           ← source for the launcher icon
├── icon-maskable-source.svg  ← source for the Android adaptive icon
├── icons/                    ← rasterized PNG icons in PWA sizes
│   ├── icon-192.png .. icon-512.png
│   ├── icon-maskable-192.png, icon-maskable-512.png
│   ├── apple-touch-icon.png
│   └── favicon-32.png
└── assets/                   ← fonts + libraries (~4.7 MB)
    ├── *.woff2               ← Fraunces, Nunito, Caveat font subsets
    ├── react.development.js
    ├── react-dom.development.js
    └── babel.min.js
```

## Where the persistence code lives

All the new code is clearly marked `(added)` in comments. Three spots
in `index.html`:

1. **Top of `<body>`** — defines `window.BroCodeStore`, the tiny
   localStorage wrapper.
2. **First `<script type="text/babel">` block** — renames
   `TWEAK_DEFAULTS` → `TWEAK_DEFAULTS_BASE`, merges saved values into
   the new `TWEAK_DEFAULTS`, and listens for the existing
   `tweakchange` custom event to persist.
3. **Bottom `<script>` block** — restores tracker inputs on load,
   wires `change`/`input` events to save, wraps `calculate()` to save
   on click, auto-calls `calculate()` if a start date is present.

The PWA wiring is in `<head>`, also marked `(added)`: manifest link,
theme color, Apple touch icon, service worker registration.

Nothing visual was touched. Original `TWEAK_DEFAULTS` is preserved as
`TWEAK_DEFAULTS_BASE` inside the original `EDITMODE-BEGIN/END` markers
so the file remains compatible with the original editor tooling.
