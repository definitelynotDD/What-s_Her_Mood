// main.js — DOM wiring + screen routing (Supabase auth + pairing + hangout)
import {
  signUp, signIn, signOutUser, watchAuth, getUserRow, friendlyAuthError,
} from "./auth.js";
import { watchMyUserRow, claimPartnerCode } from "./pairing.js";
import { openHangout, closeHangout } from "./hangout.js";
import { mountTracker, unmountTracker } from "./tracker.js";

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

let unsubUserRow = null;
let currentPairing = null;
function stopUserRowWatch() {
  if (unsubUserRow) { unsubUserRow(); unsubUserRow = null; }
}

async function renderUserRow(row) {
  if (!row) return;
  $("#hello-name").textContent = row.display_name || "you";
  $("#role-pill").textContent = row.role === "her" ? "her" : "her partner";
  $("#my-code").textContent = row.pairing_code || "——————";
  hide($("#code-card"));
  hide($("#pair-form"));
  hide($("#paired-box"));
  if (row.paired_with) {
    let partnerName = "your partner";
    try {
      const partner = await getUserRow(row.paired_with);
      if (partner && partner.display_name) partnerName = partner.display_name;
    } catch (_) {}
    $("#partner-name").textContent = partnerName;
    currentPairing = { me: row.id, partner: row.paired_with, myName: row.display_name, partnerName };
    show($("#paired-box"));
    // Stage 2: mount her's daily dashboard (cycle + todos). Both partners see it;
    // the tracker figures out edit vs. read-only from role. herUid = whichever
    // one of the two is 'her'.
    const herUid = row.role === "her" ? row.id : row.paired_with;
    const herName = row.role === "her" ? row.display_name : partnerName;
    mountTracker({ myUid: row.id, myRole: row.role, herUid, herName });
  } else {
    currentPairing = null;
    unmountTracker();
    show($("#code-card"));
    show($("#pair-form"));
  }
}

watchAuth((user) => {
  stopUserRowWatch();
  if (!user) {
    closeHangout();
    unmountTracker();
    currentPairing = null;
    showScreen("welcome");
    return;
  }
  showScreen("app");
  unsubUserRow = watchMyUserRow(user.id, (row) => renderUserRow(row));
});

$("#go-signup").addEventListener("click", () => { setMsg($("#signup-error"), ""); showScreen("signup"); });
$("#go-signin").addEventListener("click", () => { setMsg($("#signin-error"), ""); showScreen("signin"); });
document.querySelectorAll("[data-go='welcome']").forEach((b) =>
  b.addEventListener("click", () => showScreen("welcome"))
);

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
      setMsg($("#signin-error"), "Account created! Check your email to confirm, then sign in.", "info");
      showScreen("signin");
    }
  } catch (err) {
    setMsg($("#signup-error"), friendlyAuthError(err));
  } finally {
    setBusy(btn, false);
  }
});

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

$("#pair-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  setMsg($("#pair-error"), "");
  const btn = $("#link-btn");
  const codeInput = $("#partner-code");
  setBusy(btn, true, "linking…");
  try {
    await claimPartnerCode(codeInput.value);
    codeInput.value = "";
  } catch (err) {
    setMsg($("#pair-error"), friendlyAuthError(err));
  } finally {
    setBusy(btn, false);
  }
});

$("#partner-code").addEventListener("input", (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
});

$("#signout-btn").addEventListener("click", async () => {
  try { await signOutUser(); } catch (_) {}
});

$("#start-hangout").addEventListener("click", () => {
  if (!currentPairing) return;
  showScreen("hangout");
  openHangout({ ...currentPairing, onExit: () => showScreen("app") });
});
