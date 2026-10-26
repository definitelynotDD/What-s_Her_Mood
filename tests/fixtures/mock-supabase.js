// TEST MOCK of js/supabase-init.js — served in its place by lib/server.mjs.
// Realtime broadcast is faked over BroadcastChannel, so two tabs in one browser
// run the real hangout.js + rtc.js against each other; the knobs on
// window.__mock drop messages or kill channels on command. Tables live in
// window.__db (set it in an init script).
const ctl = window.__mock = {
  dropOut: false,            // drop everything this tab sends
  dropOutEvents: new Set(),  // drop only these outgoing events (e.g. "signal")
  dropOutDescriptions: 0,    // drop the next N outgoing SDP descriptions
  dropOutCandidates: false,  // drop every outgoing ICE candidate while true
  sent: [], recv: [],
  refreshCalls: 0,
  expiresIn: 3600,
  channelsCreated: 0,
  live: new Set(),
};
let tokenIssued = Date.now() / 1000;
class MockChannel {
  constructor(topic, opts) {
    this.topic = topic; this.opts = opts; this.handlers = []; this.state = "closed";
    this.subCb = null; this.dead = false;
    ctl.channelsCreated++;
  }
  on(type, filter, cb) { this.handlers.push({ type, filter, cb }); return this; }
  subscribe(cb) {
    this.subCb = cb;
    this.bc = new BroadcastChannel(this.topic);
    this.bc.onmessage = (e) => {
      if (this.dead || this.state !== "joined") return;
      const { event, payload } = e.data;
      ctl.recv.push(event);
      this.handlers.forEach((h) => { if (h.type === "broadcast" && h.filter.event === event) h.cb({ payload }); });
    };
    ctl.live.add(this);
    setTimeout(() => { if (!this.dead) { this.state = "joined"; cb && cb("SUBSCRIBED"); } }, 50);
    return this;
  }
  async send({ event, payload }) {
    if (this.dead || this.state !== "joined") return "error";
    if (ctl.dropOut || ctl.dropOutEvents.has(event)) return "ok";
    if (event === "signal" && payload.sig && payload.sig.description && ctl.dropOutDescriptions > 0) {
      ctl.dropOutDescriptions--; ctl.sent.push("DROPPED:" + payload.sig.description.type); return "ok";
    }
    if (event === "signal" && payload.sig && payload.sig.candidate && ctl.dropOutCandidates) {
      ctl.sent.push("DROPPED:ice"); return "ok";
    }
    ctl.sent.push(event === "signal" ? (payload.sig.description ? "sdp:" + payload.sig.description.type : "ice") : event);
    this.bc.postMessage(JSON.parse(JSON.stringify({ event, payload })));  // Realtime is JSON on the wire
    return "ok";
  }
  // simulate the server closing the channel (what Realtime does on token expiry)
  serverClose() { this.dead = true; this.state = "closed"; this.bc && this.bc.close(); ctl.live.delete(this); this.subCb && this.subCb("CLOSED"); }
  serverError(recoverMs) {
    this.state = "errored"; this.subCb && this.subCb("CHANNEL_ERROR");
    if (recoverMs != null) setTimeout(() => { if (!this.dead) { this.state = "joined"; this.subCb && this.subCb("SUBSCRIBED"); } }, recoverMs);
  }
  async track() { return "ok"; }
  async untrack() { return "ok"; }
  presenceState() { return {}; }
  async unsubscribe() { this.dead = true; this.state = "closed"; this.bc && this.bc.close(); ctl.live.delete(this); return "ok"; }
}
ctl.killChannels = () => [...ctl.live].forEach((c) => c.serverClose());
ctl.errorChannels = (recoverMs) => [...ctl.live].forEach((c) => c.serverError(recoverMs));
ctl.emitChange = (table, row) => [...ctl.live].forEach((c) => {
  if (c.state !== "joined") return;
  c.handlers.forEach((h) => { if (h.type === "postgres_changes" && h.filter.table === table) h.cb({ new: row }); });
});
window.__db = window.__db || {};
// Tables that answer every query with an error (e.g. not created yet). Set
// window.__failTables in an init script, or change it live.
ctl.failTables = new Set(window.__failTables || []);
// Table stub: filters with eq(), and applies insert/upsert/update/delete to
// window.__db. A write is echoed to this tab's postgres_changes listeners, the
// way Realtime echoes it back to the writer.
function query(table) {
  const filters = [];
  let single = false, op = "select", payload = null, conflict = ["id"];
  const rows = () => (window.__db[table] = window.__db[table] || []);
  const match = (r) => filters.every(([c, v]) => r[c] === v);
  const b = {
    select() { return b; },
    insert(r) { op = "insert"; payload = [].concat(r); return b; },
    upsert(r, o) { op = "upsert"; payload = [].concat(r); if (o && o.onConflict) conflict = o.onConflict.split(","); return b; },
    update(patch) { op = "update"; payload = patch; return b; },
    delete() { op = "delete"; return b; },
    eq(col, val) { filters.push([col, val]); return b; },
    order() { return b; },
    limit() { return b; },
    maybeSingle() { single = true; return b; },
    then(res, rej) {
      if (ctl.failTables.has(table)) {
        return Promise.resolve({ data: null, error: { message: `relation "public.${table}" does not exist` } }).then(res, rej);
      }
      if (op === "select") {
        const found = rows().filter(match).map((r) => ({ ...r }));
        return Promise.resolve({ data: single ? (found[0] || null) : found, error: null }).then(res, rej);
      }
      const changed = [];
      if (op === "insert" || op === "upsert") {
        for (const r of payload) {
          const i = op === "upsert" ? rows().findIndex((x) => conflict.every((c) => x[c] === r[c])) : -1;
          if (i >= 0) { Object.assign(rows()[i], r); changed.push(rows()[i]); }
          else { const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...r }; rows().push(row); changed.push(row); }
        }
      } else if (op === "update") {
        rows().filter(match).forEach((r) => { Object.assign(r, payload); changed.push(r); });
      } else if (op === "delete") {
        changed.push(...rows().filter(match));
        window.__db[table] = rows().filter((r) => !match(r));
      }
      setTimeout(() => changed.forEach((r) => ctl.emitChange(table, { ...r })), 0);
      return Promise.resolve({ data: null, error: null }).then(res, rej);
    },
  };
  return b;
}
export const supabase = {
  from: (t) => query(t),
  rpc: async () => ({ data: null, error: null }),
  channel: (t, o) => new MockChannel(t, o),
  removeChannel: async (c) => { await c.unsubscribe(); return "ok"; },
  auth: {
    getSession: async () => ({ data: { session: { access_token: "x", expires_at: tokenIssued + ctl.expiresIn, user: window.__user || null } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    refreshSession: async () => { ctl.refreshCalls++; tokenIssued = Date.now() / 1000; ctl.expiresIn = 3600; return { data: {}, error: null }; },
  },
};
