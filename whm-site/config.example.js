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
    ]
  },
  gemini: { apiKey: "" }   // leave empty until Stage 5
};
