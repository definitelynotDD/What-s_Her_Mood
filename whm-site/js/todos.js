// ─────────────────────────────────────────────────────────────
// todos.js — her's to-do list, partner-readable.
//
// One flat list per her-user. No categories, no per-item privacy toggle
// (explicit product decision in HANDOVER). HER writes; partner reads via
// the same RLS pattern used by cycle_settings. Realtime keeps both in sync.
// ─────────────────────────────────────────────────────────────
import { supabase } from "./supabase-init.js";

export async function fetchTodos(userId) {
  const { data, error } = await supabase
    .from("todos").select("*")
    .eq("user_id", userId)
    .order("done", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addTodo(userId, title) {
  const trimmed = String(title || "").trim();
  if (!trimmed) throw new Error("Add a title first.");
  const { error } = await supabase.from("todos").insert({ user_id: userId, title: trimmed });
  if (error) throw error;
}

export async function toggleTodo(id, done) {
  const patch = { done, done_at: done ? new Date().toISOString() : null };
  const { error } = await supabase.from("todos").update(patch).eq("id", id);
  if (error) throw error;
}

export async function editTodo(id, title) {
  const trimmed = String(title || "").trim();
  if (!trimmed) throw new Error("Title can't be empty.");
  const { error } = await supabase.from("todos").update({ title: trimmed }).eq("id", id);
  if (error) throw error;
}

export async function deleteTodo(id) {
  const { error } = await supabase.from("todos").delete().eq("id", id);
  if (error) throw error;
}

// Live list. cb(list) fires immediately with the current rows, then on every change.
export function watchTodos(userId, cb) {
  let list = [];
  const push = () => cb(list.slice());

  fetchTodos(userId).then((rows) => { list = rows; push(); }).catch(() => push());

  const channel = supabase.channel("todos:" + userId)
    .on("postgres_changes",
        { event: "*", schema: "public", table: "todos", filter: "user_id=eq." + userId },
        async () => { list = await fetchTodos(userId); push(); })
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}
