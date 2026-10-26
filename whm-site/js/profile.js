// ─────────────────────────────────────────────────────────────
// profile.js — Stage 4 data: her profile entries + her question history.
//
// profile_entries: things she likes, what helps, what doesn't. HER writes;
// her partner reads (same RLS pattern as todos). Realtime keeps his view live.
// question_history: which questions she answered or skipped, and when. Private
// to her — RLS gives the partner no access at all.
// ─────────────────────────────────────────────────────────────
import { supabase } from "./supabase-init.js";
import { keepSubscribed, onlyWhenChanged } from "./realtime.js";
import { SKIP_DAYS, addDays } from "./questions.js";

export async function fetchEntries(userId) {
  const { data, error } = await supabase
    .from("profile_entries").select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function addEntry(userId, { thing, category, source = "added-manually", questionId = null, phase = null }) {
  const trimmed = String(thing || "").trim();
  if (!trimmed) throw new Error("Write something first.");
  const { error } = await supabase.from("profile_entries").insert({
    user_id: userId, thing: trimmed, category, source,
    question_id: questionId, phase_tags: phase ? [phase] : [],
  });
  if (error) throw error;
}

export async function editEntry(id, thing) {
  const trimmed = String(thing || "").trim();
  if (!trimmed) throw new Error("It can't be empty.");
  const { error } = await supabase.from("profile_entries").update({ thing: trimmed }).eq("id", id);
  if (error) throw error;
}

export async function deleteEntry(id) {
  const { error } = await supabase.from("profile_entries").delete().eq("id", id);
  if (error) throw error;
}

// Live list. cb(list) fires with the current rows, then on every change.
export function watchEntries(userId, cb) {
  let list = [];
  const changed = onlyWhenChanged(cb);
  const push = () => changed(list.slice());

  const load = () => fetchEntries(userId).then((rows) => { list = rows; push(); }).catch(() => push());

  load();
  const sub = keepSubscribed("profile:" + userId, {
    setup: (ch) => ch.on("postgres_changes",
        { event: "*", schema: "public", table: "profile_entries", filter: "user_id=eq." + userId },
        async () => { list = await fetchEntries(userId); push(); }),
    // Changes made before/while the channel was down are never replayed — re-read.
    onJoin: load,
  });

  return () => sub.close();
}

// ---- question history (her only) ----
export async function fetchHistory(userId) {
  const { data, error } = await supabase
    .from("question_history").select("*")
    .eq("user_id", userId);
  if (error) throw error;
  return data || [];
}

// Answer: save the entry, then mark the question answered. Two writes, not one
// transaction — if the second fails she's simply asked again later.
export async function answerQuestion(userId, question, thing, today) {
  await addEntry(userId, {
    thing, category: question.cat, source: "answered-question",
    questionId: question.id, phase: question.phase || null,
  });
  await recordHistory(userId, question.id, { status: "answered", skipped_until: null, asked_on: today });
}

export async function skipQuestion(userId, question, today) {
  await recordHistory(userId, question.id, {
    status: "skipped", skipped_until: addDays(today, SKIP_DAYS), asked_on: today,
  });
}

async function recordHistory(userId, questionId, fields) {
  const { error } = await supabase.from("question_history")
    .upsert({ user_id: userId, question_id: questionId, ...fields }, { onConflict: "user_id,question_id" });
  if (error) throw error;
}
