// main.js — DOM wiring + screen routing (Supabase auth + pairing + hangout)
import {
  signUp, signIn, signOutUser, watchAuth, getUserRow, friendlyAuthError,
} from "./auth.js";
import { watchMyUserRow, claimPartnerCode } from "./pairing.js";
import { openHangout, closeHangout } from "./hangout.js";
import { mountTracker, unmountTracker } from "./tracker.js";
import { mountMascot } from "./mascot.js";

const $ = (sel) => document.querySelector(sel);
const show = (el) => { if (el) el.hidden = false; };
const hide = (el) => { if (el) el.hidden = true; };

const SCREENS = ["loading", "welcome", "signup", "signin", "app", "hangout"];
let currentScreen = "loading";
let activeSubview = "pair";                    // 'pair' | 'today'  (only meaningful inside #screen-app)
function showScreen(name) {
  currentScreen = name;
  SCREENS.forEach((s) => {
    const el = document.getElementById("screen-" + s);
    if (el) el.hidden = (s !== name);
  });
  // The global banner + tabs live outside .wrap. Banner hides on hangout
  // (the video stage is its own headline); tabs are gated to signed-in + paired
  // and only make sense while the app screen is showing.
  const header = document.getElementById("app-header");
  const tabs = document.getElementById("app-tabs");
  if (header) header.hidden = (name === "hangout" || name === "loading");
  if (tabs) tabs.hidden = !(name === "app" && !!currentPairing);
}
function setSubview(name) {
  activeSubview = name;
  const pair = document.getElementById("subview-pair");
  const today = document.getElementById("subview-today");
  if (pair) pair.hidden = (name !== "pair");
  if (today) today.hidden = (name !== "today");
  document.querySelectorAll(".app-tab").forEach((b) => {
    b.classList.toggle("is-on", b.dataset.tab === name);
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
  const wasPaired = !!currentPairing;
  $("#hello-name").textContent = row.display_name || "you";
  $("#role-pill").textContent = row.role === "her" ? "her" : "her partner";
  $("#my-code").textContent = row.pairing_code || "——————";
  // Code card stays visible always (paired partners can still re-share). Pair-form
  // and paired-header flip based on paired-ness.
  show($("#code-card"));
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
    mountMascot($("#paired-mascot"), { scale: 0.55 });
    // Stage 2: mount her's daily dashboard (cycle + todos). Both partners see it;
    // the tracker figures out edit vs. read-only from role. herUid = whichever
    // one of the two is 'her'.
    const herUid = row.role === "her" ? row.id : row.paired_with;
    const herName = row.role === "her" ? row.display_name : partnerName;
    mountTracker({ myUid: row.id, myRole: row.role, herUid, herName });
  } else {
    currentPairing = null;
    unmountTracker();
    show($("#pair-form"));
  }
  // On the moment we FIRST become paired, land on the pair-up sub-view so the
  // "you're paired with dev ♡" line gets its beat. On unpair, snap back to pair.
  if (!wasPaired && currentPairing) setSubview("pair");
  if (wasPaired && !currentPairing)  setSubview("pair");
  // Tabs are gated on paired-ness; re-evaluate the chrome now that state changed.
  showScreen(currentScreen);
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

// stamp the mascot onto every slot that exists (welcome + paired-box header)
mountMascot($("#welcome-mascot"), { scale: 1 });

// Tab bar (shown only when signed-in AND paired — see showScreen). "pair" and
// "today" flip in-place sub-views; "hangout" jumps to the full-screen video.
document.querySelectorAll(".app-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    if (tab === "hangout") {
      if (!currentPairing) return;
      showScreen("hangout");
      openHangout({ ...currentPairing, onExit: () => { showScreen("app"); setSubview(activeSubview); } });
      return;
    }
    setSubview(tab);
  });
});

$("#go-signup").addEventListener("click", () => { setMsg($("#signup-error"), ""); showScreen("signup"); });
$("#go-signin").addEventListener("click", () => { setMsg($("#signin-error"), ""); showScreen("signin"); });

// copy the pairing code to the clipboard; label flips to "copied ✓" for 1.4s
$("#copy-code").addEventListener("click", async () => {
  const btn = $("#copy-code");
  const code = ($("#my-code").textContent || "").trim();
  if (!code || code.startsWith("——")) return;
  try {
    await navigator.clipboard.writeText(code);
  } catch (_) {
    // fallback: transient input for browsers without clipboard permission
    const ta = document.createElement("textarea");
    ta.value = code; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (_) {}
    ta.remove();
  }
  btn.textContent = "copied ✓";
  btn.dataset.copied = "1";
  clearTimeout(btn._t);
  btn._t = setTimeout(() => { btn.textContent = "copy code"; delete btn.dataset.copied; }, 1400);
});
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

// Leave: wired here (not inside openHangout) so it always works — a failed
// getUserMedia in openHangout used to return before the button was hooked up,
// stranding the user on the hangout screen with a dead "leave" button.
$("#hg-hangup").addEventListener("click", () => {
  closeHangout();       // safe no-op if no active room
  showScreen("app");    // idempotent — closeHangout's onExit also lands here
});
