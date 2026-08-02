// ─────────────────────────────────────────────────────────────
// cycle.js — cycle-tracker data + phase math
//
// Two tables back this: `cycle_settings` (one row per her-user, tunable
// cycle/period lengths) and `period_starts` (log of period-start dates).
// Reads and writes go through Supabase with RLS. HER writes; both partners
// read once linked. Realtime keeps the partner's view in sync.
//
// Phase math is intentionally simple — a Naegele-style luteal-phase model
// (ovulation ≈ cycleLength − 14). Precise enough for a daily read; not a
// medical device.
// ─────────────────────────────────────────────────────────────
import { supabase } from "./supabase-init.js";

export const DEFAULTS = { cycleLength: 28, periodLength: 5 };

export const PHASES = {
  menstrual:  { key: "menstrual",  label: "menstrual",  hue: "rust",   note: "rest + comfort" },
  follicular: { key: "follicular", label: "follicular", hue: "teal",   note: "energy climbs" },
  ovulation:  { key: "ovulation",  label: "ovulating",  hue: "honey",  note: "peak energy" },
  luteal:     { key: "luteal",     label: "luteal",     hue: "pri",    note: "winding down" },
  pms:        { key: "pms",        label: "pms",        hue: "plum",   note: "extra kindness helps" },
  unknown:    { key: "unknown",    label: "no data yet", hue: "muted", note: "log a period start to begin" },
};

// ---- date helpers (local-time, no libraries) ----
export function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function parseISO(s) {
  const [y, m, d] = String(s).split("-").map(Number);
  return new Date(y, m - 1, d);
}
function daysBetween(aISO, bISO) {
  const ms = parseISO(bISO) - parseISO(aISO);
  return Math.round(ms / 86400000);
}

// day-of-cycle 1..N (capped at cycleLength; sentinel `overdue` when past it)
export function phaseOf(day, cycleLength, periodLength) {
  if (day == null || day < 1) return { ...PHASES.unknown, day: null };
  const C = cycleLength || DEFAULTS.cycleLength;
  const P = periodLength || DEFAULTS.periodLength;
  const ovDay = Math.max(P + 2, C - 14);
  const pmsStart = Math.max(P + 1, C - 4);
  let key;
  if (day > C) key = "pms"; // overdue → hold on PMS
  else if (day <= P) key = "menstrual";
  else if (day >= pmsStart) key = "pms";
  else if (day >= ovDay - 1 && day <= ovDay + 1) key = "ovulation";
  else if (day < ovDay) key = "follicular";
  else key = "luteal";
  return { ...PHASES[key], day };
}

// Given settings + sorted period_starts (newest first), compute today's phase.
export function currentPhase(settings, starts, when = todayISO()) {
  const C = (settings && settings.cycle_length)  || DEFAULTS.cycleLength;
  const P = (settings && settings.period_length) || DEFAULTS.periodLength;
  const last = starts && starts[0];
  if (!last) return { ...phaseOf(null, C, P), cycleLength: C, periodLength: P, lastStart: null };
  const diff = daysBetween(last.start_date, when);
  if (diff < 0) return { ...phaseOf(null, C, P), cycleLength: C, periodLength: P, lastStart: last.start_date };
  const day = diff + 1;
  const p = phaseOf(day, C, P);
  return { ...p, cycleLength: C, periodLength: P, lastStart: last.start_date, overdue: day > C };
}

// ---- fetch helpers ----
export async function fetchSettings(userId) {
  const { data, error } = await supabase
    .from("cycle_settings").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data;
}
export async function fetchStarts(userId, limit = 12) {
  const { data, error } = await supabase
    .from("period_starts").select("*")
    .eq("user_id", userId).order("start_date", { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

// ---- writes (her-only, RLS-enforced) ----
export async function upsertSettings(userId, { cycle_length, period_length }) {
  const row = { user_id: userId, cycle_length, period_length, updated_at: new Date().toISOString() };
  const { error } = await supabase.from("cycle_settings").upsert(row);
  if (error) throw error;
}
export async function logPeriodStart(userId, dateISO, notes = null) {
  const { error } = await supabase.from("period_starts")
    .upsert({ user_id: userId, start_date: dateISO, notes }, { onConflict: "user_id,start_date" });
  if (error) throw error;
}
export async function deletePeriodStart(id) {
  const { error } = await supabase.from("period_starts").delete().eq("id", id);
  if (error) throw error;
}

// ---- realtime subscription: settings + starts for a given user ----
// cb receives { settings, starts } on every push; both partners can subscribe.
export function watchCycle(userId, cb) {
  let settings = null;
  let starts = [];
  const push = () => cb({ settings, starts });

  Promise.all([fetchSettings(userId), fetchStarts(userId)])
    .then(([s, list]) => { settings = s; starts = list; push(); })
    .catch(() => push());

  const channel = supabase.channel("cycle:" + userId)
    .on("postgres_changes",
        { event: "*", schema: "public", table: "cycle_settings", filter: "user_id=eq." + userId },
        async () => { settings = await fetchSettings(userId); push(); })
    .on("postgres_changes",
        { event: "*", schema: "public", table: "period_starts", filter: "user_id=eq." + userId },
        async () => { starts = await fetchStarts(userId); push(); })
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}
