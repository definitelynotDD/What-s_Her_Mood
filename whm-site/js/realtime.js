// ─────────────────────────────────────────────────────────────
// realtime.js
// Supabase Realtime channels that stay subscribed through long sessions.
//
// Why this exists: supabase-js only refreshes the auth token while the tab is
// visible (auth-js "refresh token ticker runs only on focused tabs"). Leave the
// app in a background tab for an hour — or switch to the tab you're
// screen-sharing — and the token expires, the Realtime server closes every
// channel, and supabase-js never re-opens a channel the server closed. The
// app kept "working" but stopped updating live: no pairing flip, no partner
// seeing a logged period or ticked to-do, no hangout signaling.
//
// keepSubscribed() fixes that for any channel: it keeps the token fresh while
// a channel is open, rebuilds the channel when it drops, and tells the caller
// on every (re)join so it can re-fetch what it missed (Realtime doesn't replay
// changes made while you were disconnected).
// ─────────────────────────────────────────────────────────────
import { supabase } from "./supabase-init.js";

const AUTH_CHECK_MS = 60 * 1000;          // how often to look at the token
const AUTH_REFRESH_MARGIN_S = 5 * 60;     // refresh when it has less than this left

let openCount = 0;
let keepAliveTimer = null;

// Refresh the session if it's close to expiring. supabase-js forwards the new
// token to Realtime on TOKEN_REFRESHED, and auth-js broadcasts it to the
// app's other tabs, so one refresh covers everything.
export async function keepAuthFresh() {
  try {
    const { data } = await supabase.auth.getSession();
    const s = data && data.session;
    if (!s || !s.expires_at) return;
    if (s.expires_at - Date.now() / 1000 > AUTH_REFRESH_MARGIN_S) return;
    const { error } = await supabase.auth.refreshSession();
    if (error) console.warn("[realtime] token refresh failed", error.message || error);
  } catch (err) {
    console.warn("[realtime] token refresh failed", err);
  }
}

// Subscribe to a channel and keep it subscribed.
//   params  — passed to supabase.channel(name, params), e.g. { config: {...} }
//   setup   — (ch) => register .on(...) handlers on a fresh channel object;
//             runs again for every rebuilt channel
//   onJoin  — (ch) => runs on every SUBSCRIBED, the first one included.
//             Re-fetch here every time: a channel can drop before its first
//             join completes, so "only on rejoin" would miss whatever changed
//             since the initial fetch. Wrap the callback in onlyWhenChanged()
//             so the repeat fetch doesn't re-render identical data.
// Returns a handle: send(msg), channel(), close().
export function keepSubscribed(name, { params, setup, onJoin } = {}) {
  let ch = null;
  let joined = false;
  let closed = false;
  let repairTimer = null;
  let attempt = 0;

  function open() {
    const c = supabase.channel(name, params || { config: {} });
    ch = c;
    joined = false;
    if (setup) setup(c);
    c.subscribe((st) => {
      if (closed || ch !== c) return; // superseded by a rebuilt channel, or closed
      if (st === "SUBSCRIBED") {
        joined = true;
        attempt = 0;
        clearTimeout(repairTimer);
        repairTimer = null;
        if (onJoin) onJoin(c);
      } else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT" || st === "CLOSED") {
        trouble(st);
      }
    });
  }

  // CHANNEL_ERROR / TIMED_OUT: supabase-js retries the join on its own, but
  // with an expired token it never succeeds. CLOSED: the server dropped the
  // channel (token expiry does exactly this) and nothing retries. Either way:
  // refresh the token, give the built-in retry a moment, then rebuild.
  function trouble(st) {
    joined = false;
    console.warn("[realtime] " + name + ": " + st);
    keepAuthFresh();
    if (repairTimer) return;
    const wait = st === "CLOSED" ? 1000 : Math.min(5000 * 2 ** attempt, 30000);
    repairTimer = setTimeout(repair, wait);
  }

  async function repair() {
    repairTimer = null;
    if (closed || joined) return;
    attempt++;
    await keepAuthFresh();
    if (closed || joined) return;
    console.warn("[realtime] " + name + ": rebuilding channel (attempt " + attempt + ")");
    const old = ch;
    ch = null; // the old channel's callbacks now see themselves as superseded
    try { await supabase.removeChannel(old); } catch (_) {}
    if (closed || ch) return;
    open();
  }

  openCount++;
  if (!keepAliveTimer) keepAliveTimer = setInterval(keepAuthFresh, AUTH_CHECK_MS);
  keepAuthFresh();
  open();

  return {
    // Sends on whichever channel is current. While it's rejoining, supabase-js
    // falls back to its REST broadcast endpoint, so this still usually lands.
    send(msg) { return ch ? ch.send(msg) : Promise.resolve("error"); },
    channel() { return ch; },
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(repairTimer);
      if (--openCount === 0) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
      const c = ch;
      ch = null;
      if (c) { try { supabase.removeChannel(c); } catch (_) {} }
    },
  };
}

// Wrap a data callback so it only fires when the value actually changed
// (compared as key-sorted JSON). Re-fetching after every (re)join is then free.
export function onlyWhenChanged(cb) {
  let last;
  return (value) => {
    const key = stableJson(value);
    if (key === last) return;
    last = key;
    cb(value);
  };
}

function stableJson(v) {
  if (Array.isArray(v)) return "[" + v.map(stableJson).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stableJson(v[k])).join(",") + "}";
  }
  return JSON.stringify(v === undefined ? null : v);
}
