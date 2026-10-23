// Loaded by /hangout.html (see lib/server.mjs). Exposes the real modules so
// tests can open/close the room and poke the Realtime watchers directly.
import { openHangout, closeHangout } from "/js/hangout.js";
import { keepSubscribed } from "/js/realtime.js";
import { watchTodos } from "/js/todos.js";
import { watchMyUserRow } from "/js/pairing.js";

const q = new URLSearchParams(location.search);
window.__rt = { keepSubscribed, watchTodos, watchMyUserRow };
window.__open = () => openHangout({
  me: q.get("me"), partner: q.get("partner"), myName: q.get("me"), partnerName: q.get("partner"),
  onExit: () => { window.__exited = (window.__exited || 0) + 1; },
});
window.__close = closeHangout;
document.getElementById("hg-hangup").onclick = () => closeHangout();
window.__ready = true;
