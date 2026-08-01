// ─────────────────────────────────────────────────────────────
// auth.js
// Sign up / sign in / sign out on Supabase Auth. The profile row in
// public.users is created automatically by a database trigger from the
// signup metadata (display_name, role) — so there's no client-side write
// here. All user-facing errors go through friendlyAuthError().
// ─────────────────────────────────────────────────────────────
import { supabase } from "./supabase-init.js";

export async function signUp({ name, email, password, role }) {
  if (!name || !name.trim()) throw new Error("Add your name so your partner knows it's you.");
  if (role !== "her" && role !== "partner") throw new Error("Pick whether you're 'her' or 'her partner'.");

  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: { data: { display_name: name.trim(), role } },
  });
  if (error) throw error;
  return data; // { user, session } — session is null if email confirmation is on
}

export async function signIn({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw error;
  return data;
}

export async function signOutUser() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// Fire once with the current user, then on every auth change. Returns an
// unsubscribe function.
export function watchAuth(cb) {
  supabase.auth.getSession().then(({ data }) => cb(data.session ? data.session.user : null));
  const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
    cb(session ? session.user : null);
  });
  return () => sub.subscription.unsubscribe();
}

// Read a partner's row (name/role) for display. RLS only allows this once paired.
export async function getUserRow(id) {
  const { data, error } = await supabase
    .from("users")
    .select("id, display_name, role")
    .eq("id", id)
    .maybeSingle();
  if (error) return null;
  return data;
}

// Turn Supabase auth + pairing-RPC errors into warm, human sentences.
export function friendlyAuthError(err) {
  const msg = (err && err.message ? err.message : String(err || "")).toLowerCase();
  const code = (err && err.code ? String(err.code) : "").toLowerCase();
  const status = err && err.status;

  // pairing RPC (claim_partner) raises these
  if (msg.includes("no_such_code")) return "No one's using that code. Double-check the spelling with them.";
  if (msg.includes("own_code")) return "That's your own code — share it with your partner instead.";
  if (msg.includes("partner_taken")) return "That account looks like it's already paired with someone.";
  if (msg.includes("already_paired")) return "Looks like you're already paired.";
  if (msg.includes("not_signed_in")) return "You got signed out — sign back in and try again.";

  // auth
  if (msg.includes("already registered") || msg.includes("already been registered") || code.includes("user_already_exists"))
    return "That email already has an account — try signing in instead.";
  if (msg.includes("invalid login credentials") || code.includes("invalid_credentials"))
    return "That email and password don't match.";
  if (msg.includes("email not confirmed") || code.includes("email_not_confirmed"))
    return "Confirm your email first — check your inbox for the link, then sign in.";
  if (code.includes("weak_password") || (msg.includes("password") && msg.includes("6")))
    return "Password needs to be at least 6 characters.";
  if (msg.includes("validate email") || msg.includes("invalid format") || code.includes("invalid_email"))
    return "That doesn't look like a valid email address.";
  if (status === 429 || msg.includes("rate limit") || code.includes("over_") )
    return "Too many attempts. Give it a minute, then try again.";
  if (msg.includes("failed to fetch") || msg.includes("network"))
    return "Network error. Check your connection and that config.js has the right Supabase URL.";

  return "Something went wrong. " + (err && err.message ? err.message : "Please try again.");
}
