// ─────────────────────────────────────────────────────────────
// WHM — config template (Supabase)
//
// 1. Copy this file to  config.js   (same folder)
// 2. Paste your Supabase project URL + anon (or publishable) key below.
//    Find them in: Supabase dashboard → Project Settings → API.
// 3. Never commit config.js to a public repo (it's git-ignored).
//
// The URL and anon key are NOT secrets — they're meant to be in the browser.
// Your data is protected by Row-Level Security in the database, not by hiding
// these. The Gemini key (Stage 5) IS a secret — leave it empty for now.
// ─────────────────────────────────────────────────────────────
window.WHM_CONFIG = {
  supabase: {
    url:     "PASTE_YOUR_PROJECT_URL",   // e.g. https://abcd1234.supabase.co
    anonKey: "PASTE_YOUR_ANON_OR_PUBLISHABLE_KEY"
  },
  webrtc: {
    // ICE servers for the hangout (video call / screen share). STUN alone works
    // on the same network; add a free TURN relay for cross-network reliability.
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" }
      // , { urls: "turn:YOUR_TURN_HOST:3478", username: "USER", credential: "PASS" }
    ],
    // Optional: a URL that returns fresh TURN credentials, fetched at the start
    // of every hangout (used instead of iceServers; falls back to it on error).
    // If the in-call readout says "via relay" and voice is choppy, the shared
    // free relay is the bottleneck — sign up for your own (Metered has a free
    // tier) and paste its credentials URL here, e.g.
    //   "https://YOURAPP.metered.live/api/v1/turn/credentials?apiKey=YOUR_KEY"
    iceServersUrl: ""
  },
  // Special days: fireworks + hearts + a banner on these dates (js/celebrate.js).
  // "YYYY-MM-DD" repeats yearly; the year only feeds {years}. Preview any day
  // with ?celebrate in the URL.
  celebrations: [
    // { date: "2023-02-14", title: "happy {years}-year anniversary ♡" },
    // { date: "06-01", title: "happy birthday ♡" }
  ],
  gemini: { apiKey: "" }   // leave empty until Stage 5
};
