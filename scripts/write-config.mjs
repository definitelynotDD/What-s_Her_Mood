// ─────────────────────────────────────────────────────────────
// Netlify build step: write whm-site/config.js from environment variables.
//
// config.js is git-ignored (it's per-deployment), so a site that deploys
// straight from GitHub never gets one and shows "Setup not complete". This
// fills it in from the site's Netlify env vars:
//   WHM_SUPABASE_URL       required
//   WHM_SUPABASE_ANON_KEY  required (public by design — RLS protects the data)
//   WHM_ICE_SERVERS        optional, JSON array of RTCIceServer objects
//   WHM_ICE_SERVERS_URL    optional, see config.example.js (iceServersUrl)
//   WHM_CELEBRATIONS       optional, JSON array of special days (see js/celebrate.js)
//
// An existing config.js (local dev, or an upload that included one) is left
// alone. Missing vars fail the build on purpose: Netlify then keeps the
// current deploy live instead of publishing a broken app.
// ─────────────────────────────────────────────────────────────
import { existsSync, writeFileSync } from "node:fs";

const out = new URL("../whm-site/config.js", import.meta.url);

if (existsSync(out)) {
  console.log("[write-config] whm-site/config.js already exists — leaving it as is");
  process.exit(0);
}

const env = process.env;
const missing = ["WHM_SUPABASE_URL", "WHM_SUPABASE_ANON_KEY"].filter((k) => !env[k]);
if (missing.length) {
  console.error("[write-config] missing env vars: " + missing.join(", ") +
    " — set them in Netlify (Project configuration → Environment variables).");
  process.exit(1);
}

let iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
if (env.WHM_ICE_SERVERS) {
  try {
    iceServers = JSON.parse(env.WHM_ICE_SERVERS);
    if (!Array.isArray(iceServers)) throw new Error("not an array");
  } catch (err) {
    console.error("[write-config] WHM_ICE_SERVERS isn't a JSON array: " + err.message);
    process.exit(1);
  }
}

let celebrations = [];
if (env.WHM_CELEBRATIONS) {
  try {
    celebrations = JSON.parse(env.WHM_CELEBRATIONS);
    if (!Array.isArray(celebrations)) throw new Error("not an array");
  } catch (err) {
    console.error("[write-config] WHM_CELEBRATIONS isn't a JSON array: " + err.message);
    process.exit(1);
  }
}

const config = {
  supabase: { url: env.WHM_SUPABASE_URL, anonKey: env.WHM_SUPABASE_ANON_KEY },
  webrtc: { iceServers, ...(env.WHM_ICE_SERVERS_URL ? { iceServersUrl: env.WHM_ICE_SERVERS_URL } : {}) },
  celebrations,
  gemini: { apiKey: "" },
};

writeFileSync(out,
  "// Generated at build time by scripts/write-config.mjs from Netlify env vars.\n" +
  "// Change the env vars, not this file.\n" +
  "window.WHM_CONFIG = " + JSON.stringify(config, null, 2) + ";\n");
console.log("[write-config] wrote whm-site/config.js (" + iceServers.length + " ICE servers" +
  (env.WHM_ICE_SERVERS_URL ? ", + iceServersUrl" : "") + ", " + celebrations.length + " celebration days)");
