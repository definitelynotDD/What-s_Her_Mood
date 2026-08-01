// ─────────────────────────────────────────────────────────────
// main.js
// DOM wiring + screen routing. Imports the auth + pairing modules and keeps
// the UI in sync with Supabase auth state and the live user-row subscription.
// This is the only module index.html loads; it pulls in the rest.
// ─────────────────────────────────────────────────────────────
import {
  signUp, signIn, signOutUser, watchAuth, getUserRow, friendlyAuthError,
} from "./auth.js";
import { watchMyUserRow, claimPartnerCode } from "./pairing.js";
import { openHangout, closeHangout } from "./hangout.js";

// ---- tiny DOM helpers ----
const $ = (sel) => document.querySelector(sel);
const show = (el) => { if (el) el.hidden = false; };
const hide = (el) => { if (el) el.hidden = true; };

const SCREENS = ["loading", "welcome", "signup", "signin", "app", "hangout"];
function showScreen(name) {
  SCREENS.forEach((s) => {
    const el = document.getElementById("screen-" + s);
    if (el) el.hidden = (s !== name);
  });
}
function setMsg(el, msg, kind) {
  if (!el) return;
  el.textContent = msg || "";
  el.hidden = !msg;
  el.dataset.kind = kind || "error";
}
function setBusy(btn, busy, busyLabel) {
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.textContent;
    btn.textContent = busyLabel || "…";
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.label || btn.textContent;
    btn.disabled = false;
  }
}

// ---- live user-row subscription bookkeeping ----
let unsubUserRow = null;
let currentPairing = null; // { me, partner, myName, partnerName } when paired
function stopUserRowWatch() {
  if (unsubUserRow) { unsubUserRow(); unsubUserRow = null; }
}

// Render the paired / unpaired state of the "app" screen.
async function renderUserRow(row) {
  if (!row) return;

  $("#hello-name").textContent = row.display_name || "you";
  $("#role-pill").textContent = row.role === "her" ? "her" : "her partner";
  $("#my-code").textContent = row.pairing_code || "——————";

  hide($("#pair-form"));
  hide($("#paired-box"));

  if (row.paired_with) {
    let partnerName = "your partner";
    try {
      const partner = await getUserRow(row.paired_with);
      if (partner && partner.display_name) partnerName = partner.display_name;
    } catch (_) { /* name is cosmetic */ }
    $("#partner-name").textContent = partnerName;
    currentPairing = { me: row.id, partner: row.paired_with, myName: row.display_name, partnerName };
    show($("#paired-box"));
  } else {
    currentPairing = null;
    show($("#pair-form"));
  }
}

// ---- auth state drives everything ----
watchAuth((user) => {
  stopUserRowWatch();
  if (!user) {
    closeHangout();
    currentPairing = null;
    showScreen("welcome");
    return;
  }
  showScreen("app");
  // Live listener: flips BOTH partners to "paired" with no refresh.
  unsubUserRow = watchMyUserRow(user.id, (row) => renderUserRow(row));
});

// ─────────────────────────────────────────────────────────────
// Wiring (deferred module → DOM is ready)
// ─────────────────────────────────────────────────────────────

$("#go-signup").addEventListener("click", () => { setMsg($("#signup-error"), ""); showScreen("signup"); });
$("#go-signin").addEventListener("click", () => { setMsg($("#signin-error"), ""); showScreen("signin"); });
document.querySelectorAll("[data-go='welcome']").forEach((b) =>
  b.addEventListener("click", () => showScreen("welcome"))
);

// sign up
$("#signup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  setMsg($("#signup-error"), "");
  const btn = $("#signup-submit");
  const roleEl = document.querySelector("input[name='role']:checked");
  const payload = {
    name: $("#signup-name").value,
    email: $("#signup-email").value,
    password: $("#signup-password").value,
    role: roleEl ? roleEl.value : "",
  };
  if (!payload.role) { setMsg($("#signup-error"), "Pick whether you're 'her' or 'her partner'."); return; }
  setBusy(btn, true, "creating…");
  try {
    const res = await signUp(payload);
    if (!res.session) {
      // email confirmation is on — no session yet
      setMsg($("#signin-error"), "Account created! Check your email to confirm, then sign in.", "info");
      showScreen("signin");
    }
    // else: onAuthStateChange takes over → app screen
  } catch (err) {
    setMsg($("#signup-error"), friendlyAuthError(err));
  } finally {
    setBusy(btn, false);
  }
});

// sign in
$("#signin-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  setMsg($("#signin-error"), "");
  const btn = $("#signin-submit");
  setBusy(btn, true, "signing in…");
  try {
    await signIn({ email: $("#signin-email").value, password: $("#signin-password").value });
  } catch (err) {
    setMsg($("#signin-error"), friendlyAuthError(err));
  } finally {
    setBusy(btn, false);
  }
});

// link accounts (claim a partner code)
$("#pair-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  setMsg($("#pair-error"), "");
  const btn = $("#link-btn");
  const codeInput = $("#partner-code");
  setBusy(btn, true, "linking…");
  try {
    await claimPartnerCode(codeInput.value);
    codeInput.value = "";
    // realtime flips us to paired automatically
  } catch (err) {
    setMsg($("#pair-error"), friendlyAuthError(err));
  } finally {
    setBusy(btn, false);
  }
});

// uppercase the code as they type
$("#partner-code").addEventListener("input", (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
});

// sign out
$("#signout-btn").addEventListener("click", async () => {
  try { await signOutUser(); } catch (_) {}
});

// open the hangout room
$("#start-hangout").addEventListener("click", () => {
  if (!currentPairing) return;
  showScreen("hangout");
  openHangout({ ...currentPairing, onExit: () => showScreen("app") });
});
