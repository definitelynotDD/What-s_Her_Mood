// ─────────────────────────────────────────────────────────────
// tracker.js — Stage 2 UI: cycle card + todos card.
//
// Rendered inside the paired-box on #screen-app. Two views:
//   - HER: editable — log a period start, tweak cycle/period length, manage todos.
//   - PARTNER: read-only — see today's phase/day and her todo list.
// Everything data-driven from cycle.js + todos.js; realtime keeps both sides live.
// ─────────────────────────────────────────────────────────────
import {
  watchCycle, upsertSettings, logPeriodStart, deletePeriodStart,
  currentPhase, todayISO, DEFAULTS,
} from "./cycle.js";
import {
  watchTodos, addTodo, toggleTodo, editTodo, deleteTodo,
} from "./todos.js";
import { mountMascot } from "./mascot.js";
import { spawnConfetti } from "./effects.js";

const $ = (sel, root) => (root || document).querySelector(sel);
const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};

let unsubCycle = null;
let unsubTodos = null;

export function mountTracker({ myUid, myRole, herUid, herName }) {
  unmountTracker();
  const host = $("#tracker");
  if (!host) return;
  host.hidden = false;
  host.innerHTML = "";

  const iAmHer = myRole === "her";
  const heading = iAmHer ? "your day" : `${herName || "her"}'s day`;
  const headWrap = el("div", "tr-head");
  const mascotSlot = el("div", "mascot-slot tr-head-mascot");
  const headText = el("div", "tr-head-text");
  const title = el("p", "tr-title serif", heading);
  const sub = el("p", "tr-title-sub hand", iAmHer ? "one gentle day at a time" : "check in gently");
  headText.appendChild(title);
  headText.appendChild(sub);
  headWrap.appendChild(mascotSlot);
  headWrap.appendChild(headText);
  host.appendChild(headWrap);
  mountMascot(mascotSlot, { scale: 0.5 });

  const cycleCard = renderCycleCard({ iAmHer, herName });
  const todosCard = renderTodosCard({ iAmHer, herName });
  host.appendChild(cycleCard.node);
  host.appendChild(todosCard.node);

  unsubCycle = watchCycle(herUid, ({ settings, starts }) => {
    cycleCard.update({ settings, starts });
  });
  unsubTodos = watchTodos(herUid, (list) => {
    todosCard.update(list);
  });

  cycleCard.bind({ herUid, iAmHer });
  todosCard.bind({ herUid, iAmHer });
}

export function unmountTracker() {
  if (unsubCycle) { unsubCycle(); unsubCycle = null; }
  if (unsubTodos) { unsubTodos(); unsubTodos = null; }
  const host = $("#tracker");
  if (host) { host.hidden = true; host.innerHTML = ""; }
}

// ──────────────── cycle card ────────────────
function renderCycleCard({ iAmHer, herName }) {
  const card = el("div", "tr-card cycle-card");
  const phasePill = el("span", "cycle-phase-pill", "…");
  const noteLine  = el("p", "cycle-note muted", "");
  const overdueLine = el("p", "cycle-overdue hand", "");
  overdueLine.hidden = true;

  const header = el("div", "cycle-head");
  const title  = el("h3", "tr-h3", "cycle");
  header.appendChild(title);
  header.appendChild(phasePill);

  // ring + copy sit side-by-side
  const body = el("div", "cycle-body");
  const ringWrap = el("div", "cycle-ring");
  ringWrap.innerHTML = `
    <svg viewBox="0 0 100 100" class="cycle-ring-svg" aria-hidden="true">
      <circle cx="50" cy="50" r="42" fill="none" stroke="var(--cream-2)" stroke-width="8"></circle>
      <circle class="cycle-ring-fill" cx="50" cy="50" r="42" fill="none"
              stroke="var(--pri)" stroke-width="8" stroke-linecap="round"
              stroke-dasharray="264" stroke-dashoffset="264"></circle>
    </svg>
    <div class="cycle-ring-center">
      <p class="cycle-day-num serif">—</p>
      <p class="cycle-day-of muted">of —</p>
    </div>`;
  const ringFill = ringWrap.querySelector(".cycle-ring-fill");
  const ringDayNum = ringWrap.querySelector(".cycle-day-num");
  const ringDayOf  = ringWrap.querySelector(".cycle-day-of");

  const bodyText = el("div", "cycle-body-text");
  const phaseName = el("p", "cycle-phase-name serif", "—");
  bodyText.appendChild(phaseName);
  bodyText.appendChild(noteLine);
  bodyText.appendChild(overdueLine);
  body.appendChild(ringWrap);
  body.appendChild(bodyText);

  card.appendChild(header);
  card.appendChild(body);

  let logForm, logInput, logBtn, tuneWrap, cycleInput, periodInput, saveBtn,
      historyWrap, historyList, historyToggle, historyOpen = false;

  if (iAmHer) {
    logForm = el("form", "cycle-log");
    const label = el("label", "field");
    const span = el("span", null, "log a period start");
    logInput = el("input");
    logInput.type = "date";
    logInput.max = todayISO();
    logInput.value = todayISO();
    label.appendChild(span);
    label.appendChild(logInput);
    logBtn = el("button", "btn-primary cycle-log-btn", "log this date");
    logBtn.type = "submit";
    logForm.appendChild(label);
    logForm.appendChild(logBtn);
    card.appendChild(logForm);

    tuneWrap = el("details", "cycle-tune");
    const sum = el("summary", "cycle-tune-sum", "cycle length settings");
    tuneWrap.appendChild(sum);
    const grid = el("div", "cycle-tune-grid");
    const l1 = el("label", "field"); l1.appendChild(el("span", null, "cycle length (days)"));
    cycleInput = el("input"); cycleInput.type = "number"; cycleInput.min = "20"; cycleInput.max = "45";
    cycleInput.value = DEFAULTS.cycleLength; l1.appendChild(cycleInput);
    const l2 = el("label", "field"); l2.appendChild(el("span", null, "period length (days)"));
    periodInput = el("input"); periodInput.type = "number"; periodInput.min = "2"; periodInput.max = "10";
    periodInput.value = DEFAULTS.periodLength; l2.appendChild(periodInput);
    grid.appendChild(l1); grid.appendChild(l2);
    saveBtn = el("button", "btn-ghost cycle-tune-save", "save");
    saveBtn.type = "button";
    tuneWrap.appendChild(grid);
    tuneWrap.appendChild(saveBtn);
    card.appendChild(tuneWrap);

    historyWrap = el("details", "cycle-history");
    historyToggle = el("summary", "cycle-tune-sum", "recent period starts");
    historyWrap.appendChild(historyToggle);
    historyList = el("ul", "cycle-history-list");
    historyWrap.appendChild(historyList);
    historyWrap.addEventListener("toggle", () => { historyOpen = historyWrap.open; });
    card.appendChild(historyWrap);
  } else {
    // partner view — a warm hint under the phase
    const hint = el("p", "cycle-hint hand", `stay tuned in with ${herName || "her"} today ♡`);
    card.appendChild(hint);
  }

  const err = el("p", "form-error");
  err.hidden = true;
  card.appendChild(err);

  return {
    node: card,
    update({ settings, starts }) {
      const p = currentPhase(settings, starts);
      phasePill.textContent = p.label;
      phasePill.dataset.hue = p.hue;
      // ring + centered day — set the SVG dashoffset from day/cycleLength.
      // stroke-dasharray is 264 (2π·42, matching the design), so offset =
      // 264 * (1 - fraction).
      const CIRC = 264;
      ringFill.setAttribute("stroke", ringStroke(p.hue));
      if (p.day == null) {
        ringDayNum.textContent = "—";
        ringDayOf.textContent  = "log a start";
        ringFill.style.strokeDashoffset = String(CIRC);
        phaseName.textContent = "no data yet";
        noteLine.textContent = iAmHer ? "log your last period start below." : "waiting on her to log a start.";
        overdueLine.hidden = true;
      } else {
        const frac = Math.max(0, Math.min(1, p.day / p.cycleLength));
        const target = Math.round(CIRC * (1 - frac));
        // stamp a fresh drawIn animation each render so the ring re-fills
        ringFill.style.setProperty("--dash-target", target);
        ringFill.style.animation = "none";
        // eslint-disable-next-line no-unused-expressions
        void ringFill.offsetWidth;
        ringFill.style.animation = "drawIn 1.8s cubic-bezier(.4,0,.2,1) forwards";
        ringFill.style.strokeDashoffset = String(target);
        ringDayNum.textContent = String(p.day);
        ringDayOf.textContent  = `of ${p.cycleLength}`;
        phaseName.textContent = p.label + " phase";
        noteLine.textContent = p.note;
        if (p.overdue) {
          overdueLine.textContent = "cycle looks overdue — log the next start when it arrives.";
          overdueLine.hidden = false;
        } else {
          overdueLine.hidden = true;
        }
      }
      if (iAmHer) {
        cycleInput.value  = (settings && settings.cycle_length)  || DEFAULTS.cycleLength;
        periodInput.value = (settings && settings.period_length) || DEFAULTS.periodLength;
        historyList.innerHTML = "";
        (starts || []).slice(0, 6).forEach((row) => {
          const li = el("li", "cycle-hist-row");
          const dateSpan = el("span", null, row.start_date);
          const rmBtn = el("button", "btn-link cycle-hist-rm", "remove");
          rmBtn.type = "button";
          rmBtn.addEventListener("click", async () => {
            rmBtn.disabled = true;
            try { await deletePeriodStart(row.id); }
            catch (e) { showErr(err, e); rmBtn.disabled = false; }
          });
          li.appendChild(dateSpan);
          li.appendChild(rmBtn);
          historyList.appendChild(li);
        });
        if (!starts || !starts.length) {
          const li = el("li", "cycle-hist-empty muted small", "nothing logged yet.");
          historyList.appendChild(li);
        }
      }
    },
    bind({ herUid, iAmHer }) {
      if (!iAmHer) return;
      logForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        err.hidden = true;
        logBtn.disabled = true;
        try { await logPeriodStart(herUid, logInput.value || todayISO()); }
        catch (e2) { showErr(err, e2); }
        finally { logBtn.disabled = false; }
      });
      saveBtn.addEventListener("click", async () => {
        err.hidden = true;
        saveBtn.disabled = true;
        try {
          await upsertSettings(herUid, {
            cycle_length: Number(cycleInput.value) || DEFAULTS.cycleLength,
            period_length: Number(periodInput.value) || DEFAULTS.periodLength,
          });
        } catch (e2) { showErr(err, e2); }
        finally { saveBtn.disabled = false; }
      });
    },
  };
}

// ──────────────── todos card ────────────────
function renderTodosCard({ iAmHer, herName }) {
  const card = el("div", "tr-card todos-card");
  const header = el("div", "todos-head");
  const title = el("h3", "tr-h3", iAmHer ? "your to-dos" : `${herName || "her"}'s to-dos`);
  const countPill = el("span", "todos-count-pill", "0");
  header.appendChild(title);
  header.appendChild(countPill);
  card.appendChild(header);

  let form, input, submit;
  if (iAmHer) {
    form = el("form", "todos-form");
    input = el("input");
    input.type = "text"; input.maxLength = 240; input.placeholder = "add something…";
    submit = el("button", "btn-primary todos-add", "add");
    submit.type = "submit";
    form.appendChild(input);
    form.appendChild(submit);
    card.appendChild(form);
  }

  const list = el("ul", "todos-list");
  card.appendChild(list);

  const empty = el("p", "todos-empty muted small",
    iAmHer ? "nothing yet. jot something down." : "no to-dos on her list right now.");
  empty.hidden = true;
  card.appendChild(empty);

  const err = el("p", "form-error");
  err.hidden = true;
  card.appendChild(err);

  return {
    node: card,
    update(rows) {
      list.innerHTML = "";
      const open = rows.filter((r) => !r.done).length;
      countPill.textContent = String(open);
      empty.hidden = rows.length > 0;
      rows.forEach((r) => list.appendChild(renderTodoRow(r, iAmHer, err)));
    },
    bind({ herUid, iAmHer: her }) {
      if (!her) return;
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        err.hidden = true;
        const val = input.value;
        submit.disabled = true;
        try {
          await addTodo(herUid, val);
          input.value = "";
        } catch (e2) { showErr(err, e2); }
        finally { submit.disabled = false; input.focus(); }
      });
    },
  };
}

function renderTodoRow(row, iAmHer, err) {
  const li = el("li", "todo-row");
  if (row.done) li.classList.add("is-done");

  const check = el("button", "todo-check");
  check.type = "button";
  check.setAttribute("aria-pressed", row.done ? "true" : "false");
  check.setAttribute("aria-label", row.done ? "mark not done" : "mark done");
  check.disabled = !iAmHer;
  if (row.done) check.classList.add("is-on");
  if (iAmHer) {
    check.addEventListener("click", async () => {
      check.disabled = true;
      const wasDone = row.done;
      try {
        await toggleTodo(row.id, !row.done);
        // Confetti only on undone → done. Spawn inside the tracker host so
        // pieces can fly across both cards without a clip.
        if (!wasDone) {
          const host = document.getElementById("tracker");
          if (host) spawnConfetti(host, check);
        }
      }
      catch (e) { showErr(err, e); check.disabled = false; }
    });
  }
  li.appendChild(check);

  const text = el("span", "todo-text", row.title);
  li.appendChild(text);

  if (iAmHer) {
    const actions = el("div", "todo-actions");
    const editBtn = el("button", "btn-link todo-edit", "edit");
    editBtn.type = "button";
    editBtn.addEventListener("click", async () => {
      const next = prompt("edit to-do", row.title);
      if (next == null) return;
      try { await editTodo(row.id, next); }
      catch (e) { showErr(err, e); }
    });
    const rmBtn = el("button", "btn-link todo-rm", "remove");
    rmBtn.type = "button";
    rmBtn.addEventListener("click", async () => {
      rmBtn.disabled = true;
      try { await deleteTodo(row.id); }
      catch (e) { showErr(err, e); rmBtn.disabled = false; }
    });
    actions.appendChild(editBtn);
    actions.appendChild(rmBtn);
    li.appendChild(actions);
  }
  return li;
}

function showErr(node, e) {
  node.textContent = (e && e.message) ? e.message : "Something went wrong.";
  node.hidden = false;
}

// Ring stroke color per phase — same "hue" tokens the pill uses.
function ringStroke(hue) {
  switch (hue) {
    case "rust":  return "var(--rust)";
    case "teal":  return "var(--teal)";
    case "honey": return "var(--honey)";
    case "plum":  return "var(--plum)";
    case "muted": return "var(--ink-soft)";
    default:      return "var(--pri)";
  }
}
