// ─────────────────────────────────────────────────────────────
// supabase-init.js
// Creates the Supabase client from window.WHM_CONFIG. supabase-js v2 is
// imported as an ES module from a CDN (no npm, no bundler). Everything else
// imports { supabase } from here.
// ─────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cfg = window.WHM_CONFIG && window.WHM_CONFIG.supabase;

// main.js runs the friendly "Setup not complete" check before importing this,
// so reaching here means config is present. Hard guard anyway.
if (!cfg || !cfg.url || !cfg.anonKey || String(cfg.url).startsWith("PASTE_")) {
  throw new Error("WHM_CONFIG.supabase is missing or still has placeholder values — create config.js from config.example.js.");
}

export const supabase = createClient(cfg.url, cfg.anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
