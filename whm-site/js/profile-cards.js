// ─────────────────────────────────────────────────────────────
// profile-cards.js — Stage 4 UI, mounted by tracker.js in the today view.
//
//   - question card (HER only): one gentle question a day. Answer it, skip it
//     (it comes back in two weeks), or ask for another.
//   - about card (both): her answers grouped by kind. HER can edit, remove or
//     add her own; her partner reads them, with the ones tagged for today's
//     phase pulled up top ("on days like today").
// ─────────────────────────────────────────────────────────────
import {
  CATEGORIES, PHASE_LABELS, nextQuestion, doneToday, fillNames, questionById,
} from "./questions.js";
import {
  fetchHistory, answerQuestion, skipQuestion, addEntry, editEntry, deleteEntry,
} from "./profile.js";
import { todayISO } from "./cycle.js";

const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};
const link = (txt, cls) => { const b = el("button", "btn-link " + (cls || ""), txt); b.type = "button"; return b; };

// ──────────────── question card ────────────────
export function renderQuestionCard({ herUid, partnerName }) {
  const card = el("div", "tr-card q-card");
  card.hidden = true;                  // until her history and the phase are both known

  let history = null;                  // null = not loaded yet
  let phase;                           // undefined = cycle not loaded yet
  let question = null;
  let wantAnother = false;             // she tapped "ask me another"
  let restNote = "that's today's question ♡";
  let busy = false;

  fetchHistory(herUid)
    .then((rows) => { history = rows; render(); })
    // No history (e.g. the tables aren't there yet): keep the card out of the way.
    .catch((e) => console.warn("[profile] question history", e));

  function render() {
    if (history == null || phase === undefined) return;
    card.hidden = false;
    card.innerHTML = "";
    const today = todayISO();
    card.appendChild(el("p", "q-kicker hand", "a little question for you"));

    if (!wantAnother && doneToday(history, today)) return renderRest();
    question = nextQuestion(history, { today, phase });
    if (!question) {
      card.appendChild(el("p", "q-prompt serif", "you've answered every question ♡"));
      card.appendChild(el("p", "muted small", "add more about you below, any time."));
      return;
    }
    renderAsk();
  }

  function renderAsk() {
    card.appendChild(el("p", "q-prompt serif", fillNames(question.ask, { partner: partnerName })));
    const form = el("form", "q-form");
    const input = el("input");
    input.type = "text"; input.maxLength = 200;
    input.placeholder = question.hint || "your answer…";
    input.setAttribute("aria-label", "your answer");
    const save = el("button", "btn-primary q-save", "save");
    save.type = "submit";
    form.appendChild(input);
    form.appendChild(save);
    card.appendChild(form);

    const row = el("div", "q-row");
    row.appendChild(el("p", "muted small", `${partnerName || "your partner"} sees your answers. skip anything.`));
    const skip = link("skip", "q-skip");
    row.appendChild(skip);
    card.appendChild(row);

    const err = el("p", "form-error");
    err.hidden = true;
    card.appendChild(err);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!input.value.trim()) { input.focus(); return; }
      await act(save, err, () => answerQuestion(herUid, question, input.value, todayISO()), "saved ♡");
    });
    skip.addEventListener("click", () =>
      act(skip, err, () => skipQuestion(herUid, question, todayISO()), "skipped — it'll come back another time"));
  }

  async function act(btn, err, fn, note) {
    if (busy) return;
    busy = true; btn.disabled = true; err.hidden = true;
    try {
      await fn();
      history = await fetchHistory(herUid);
      wantAnother = false;
      restNote = note;
      render();
    } catch (e) {
      err.textContent = (e && e.message) ? e.message : "Something went wrong.";
      err.hidden = false;
      btn.disabled = false;
    } finally { busy = false; }
  }

  function renderRest() {
    card.appendChild(el("p", "q-prompt serif", restNote));
    const row = el("div", "q-row");
    row.appendChild(el("p", "muted small", "a new one tomorrow."));
    const more = link("ask me another", "q-more");
    more.addEventListener("click", () => { wantAnother = true; render(); });
    row.appendChild(more);
    card.appendChild(row);
  }

  return {
    node: card,
    // Phase changes (or first arrives): re-pick, unless she's mid-answer.
    setPhase(key) {
      const first = phase === undefined;
      phase = key;
      const input = card.querySelector(".q-form input");
      if (first || !input || !input.value) render();
    },
  };
}

// ──────────────── about card ────────────────
export function renderProfileCard({ iAmHer, herUid, herName, partnerName }) {
  const card = el("div", "tr-card about-card");
  const header = el("div", "about-head");
  header.appendChild(el("h3", "tr-h3", iAmHer ? "about you" : `about ${herName || "her"}`));
  const count = el("span", "todos-count-pill", "0");
  header.appendChild(count);
  card.appendChild(header);
  card.appendChild(el("p", "about-sub hand", iAmHer ? `what ${partnerName || "your partner"} sees` : "in her own words"));

  const todayBox = el("div", "about-today");
  todayBox.hidden = true;
  card.appendChild(todayBox);

  const groups = el("div", "about-groups");
  card.appendChild(groups);

  const empty = el("p", "muted small about-empty", iAmHer
    ? "nothing yet. answer a little question, or add something yourself."
    : `nothing yet. the app asks ${herName || "her"} a little question now and then. her answers show up here.`);
  card.appendChild(empty);

  const err = el("p", "form-error");
  err.hidden = true;

  let entries = [];
  let phase = null;

  if (iAmHer) card.appendChild(renderAddForm());
  card.appendChild(err);

  function render() {
    count.textContent = String(entries.length);
    empty.hidden = entries.length > 0;

    // Him: what she said about days like today, up top.
    const forToday = !iAmHer && phase && PHASE_LABELS[phase.key]
      ? entries.filter((e) => (e.phase_tags || []).includes(phase.key)) : [];
    todayBox.hidden = forToday.length === 0;
    todayBox.innerHTML = "";
    if (forToday.length) {
      todayBox.appendChild(el("p", "about-today-title hand", `on days like today (${PHASE_LABELS[phase.key]})`));
      const ul = el("ul", "about-list");
      forToday.forEach((e) => ul.appendChild(renderRow(e, { chip: false })));
      todayBox.appendChild(ul);
    }

    groups.innerHTML = "";
    Object.entries(CATEGORIES).forEach(([key, label]) => {
      const mine = entries.filter((e) => e.category === key);
      if (!mine.length) return;
      const g = el("section", "about-group");
      g.dataset.cat = key;
      g.appendChild(el("h4", "about-group-title", label));
      const ul = el("ul", "about-list");
      mine.forEach((e) => ul.appendChild(renderRow(e, { chip: true })));
      g.appendChild(ul);
      groups.appendChild(g);
    });
  }

  function renderRow(entry, { chip }) {
    const li = el("li", "about-row");
    const text = el("div", "about-text");
    const q = entry.question_id ? questionById(entry.question_id) : null;
    if (q) text.appendChild(el("span", "about-label", q.label + ":"));
    text.appendChild(el("span", "about-thing", entry.thing));
    const tag = (entry.phase_tags || []).find((t) => PHASE_LABELS[t]);
    if (chip && tag) text.appendChild(el("span", "about-chip", PHASE_LABELS[tag]));
    li.appendChild(text);

    if (iAmHer) {
      const actions = el("div", "todo-actions");
      const edit = link("edit", "todo-edit");
      edit.addEventListener("click", async () => {
        const next = prompt("edit", entry.thing);
        if (next == null) return;
        try { await editEntry(entry.id, next); } catch (e) { showErr(e); }
      });
      const rm = link("remove", "todo-rm");
      rm.addEventListener("click", async () => {
        rm.disabled = true;
        try { await deleteEntry(entry.id); } catch (e) { showErr(e); rm.disabled = false; }
      });
      actions.appendChild(edit);
      actions.appendChild(rm);
      li.appendChild(actions);
    }
    return li;
  }

  function renderAddForm() {
    const box = el("details", "about-add");
    box.appendChild(el("summary", "btn-link", "add something yourself"));
    const form = el("form", "about-add-form");
    const pick = el("select");
    pick.setAttribute("aria-label", "kind");
    Object.entries(CATEGORIES).forEach(([key, label]) => {
      const o = el("option", null, label);
      o.value = key;
      pick.appendChild(o);
    });
    const input = el("input");
    input.type = "text"; input.maxLength = 200; input.placeholder = "e.g. sunflowers";
    input.setAttribute("aria-label", "what");
    const add = el("button", "btn-primary todos-add", "add");
    add.type = "submit";
    form.appendChild(pick);
    form.appendChild(input);
    form.appendChild(add);
    box.appendChild(form);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      err.hidden = true;
      add.disabled = true;
      try {
        await addEntry(herUid, { thing: input.value, category: pick.value });
        input.value = "";
      } catch (e2) { showErr(e2); }
      finally { add.disabled = false; input.focus(); }
    });
    return box;
  }

  function showErr(e) {
    err.textContent = (e && e.message) ? e.message : "Something went wrong.";
    err.hidden = false;
  }

  render();
  return {
    node: card,
    update(list) { entries = list; render(); },
    setPhase(p) { phase = p; render(); },
  };
}
