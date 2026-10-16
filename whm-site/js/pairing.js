// ─────────────────────────────────────────────────────────────
// pairing.js
// Live subscription to my own user row (Supabase Realtime) and the pairing
// claim. Pairing = both rows' `paired_with` set to each other, done atomically
// by the claim_partner() database function (SECURITY DEFINER), so the client
// never writes the link directly.
// ─────────────────────────────────────────────────────────────
import { supabase } from "./supabase-init.js";
import { keepSubscribed, onlyWhenChanged } from "./realtime.js";

// Live-subscribe to my own row. cb(row) fires with the current row immediately,
// then on every change — this is what flips both partners to "paired" live.
// Identical rows are skipped: a re-fetch after a reconnect would otherwise
// re-render the whole paired screen (and remount the tracker) for nothing.
export function watchMyUserRow(uid, cb) {
  const changed = onlyWhenChanged(cb);
  const deliver = (row) => { if (row) changed(row); };
  const load = () => supabase
    .from("users")
    .select("*")
    .eq("id", uid)
    .maybeSingle()
    .then(({ data }) => deliver(data));

  load();
  const sub = keepSubscribed("me:" + uid, {
    setup: (ch) => ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "users", filter: "id=eq." + uid },
      (payload) => deliver(payload.new)
    ),
    // Changes made before/while the channel was down are never replayed — re-read.
    onJoin: load,
  });

  return () => sub.close();
}

// Claim a partner's code. Server-side claim_partner() figures out who I am from
// the session, so we only pass the code. Returns the partner's uid.
export async function claimPartnerCode(rawCode) {
  const code = String(rawCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== 6) {
    throw new Error("Codes are 6 characters — letters and numbers, no O/0/I/1/L.");
  }
  const { data, error } = await supabase.rpc("claim_partner", { p_code: code });
  if (error) throw error;
  return data;
}
