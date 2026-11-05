import { html, useState, useEffect, useLayoutEffect, useRef } from "../vendor/preact-htm.js";
import { useBoard } from "./ctx.js";
import { Md, AutoText, AddInline, FormActions, MoveTools, useForm, useAutoFocus, onEnter } from "./ui.js";
import { ItemRow } from "./Item.js";
import { OPEN, itemsOf, sectionOf, sections } from "../lib/model.js";
import { StatusIcon } from "./icons.js";
import { closedModeOf, splitClosed, visibleClosed } from "../lib/done.js";
import { motionOf, reducedMotion, STRIKE_MS, ERASE_MS, MOVE_MS, WINDOW_MS } from "../lib/motion.js";
import { useFold } from "./useFold.js";

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

// The text part of a row (title, note, the small meta line). Heights are held on this element, so an extra meta line stays
// hidden as a whole line instead of half showing
const bodyOf = (n) => n.querySelector(":scope > .body");
// Eases a held height to the height the element should have now, then clears the inline styles
function settleHeight(n) {
  const from = n.offsetHeight;
  n.style.height = "";
  const to = n.offsetHeight;
  if (from === to) { n.style.overflow = ""; return; }
  n.style.height = `${from}px`;
  void n.offsetHeight;
  n.style.transition = "height .25s ease";
  n.style.height = `${to}px`;
  const done = (e) => {
    if (e.target !== n || e.propertyName !== "height") return;
    n.style.height = n.style.overflow = n.style.transition = "";
    n.removeEventListener("transitionend", done);
  };
  n.addEventListener("transitionend", done);
}

// A card: one workstream, or one group of items within a section. no: the number assigned by position (only when a section
// has two or more cards), which follows reordering. Open items stay on top in their original order, done items follow, newest first; in the "recent" mode
// only items done in the last few days stay, and older ones collapse into one line, "N more done earlier", that expands on
// click (see web/lib/done.js)
export function GroupCard({ group: g, single, no = 0 }) {
  const { doc, ui, setUi, act } = useBoard();
  const [expanded, setExpanded] = useState(false);
  const [, bump] = useState(0);
  const listRef = useRef(null), lastPos = useRef(null), lastH = useRef(null), lingerPrev = useRef(new Set());
  const all = itemsOf(doc, g.id), open = all.filter((i) => OPEN.includes(i.status));
  const closed = visibleClosed(all, doc.theme, { expanded });
  // The item being edited, or one located from the calendar or "recently done", is shown even if collapsed (so the editor
  // can open and the highlight can be seen)
  const want = [/^i:([^@]+)$/.exec(ui.editing ?? "")?.[1], ui.locate?.id].filter(Boolean);
  const hidden = all.filter((i) => want.includes(i.id) && !open.includes(i) && !closed.includes(i));
  // Items just closed that the card does not keep (closedMode "none", or dropped items in "recent") stay in place a little
  // longer and leave after the strike-through and fold animations
  const lingering = all.filter((i) => !OPEN.includes(i.status) && !hidden.includes(i) && !closed.includes(i) && motionOf(i.id) === "close");
  const shown = [...(lingering.length ? [...open, ...lingering].sort(byOrder) : open), ...closed, ...hidden];
  const lingerKey = lingering.map((i) => i.id).join("|");
  // Closed items coming and going (expanding "done earlier", collapsing it, a located item revealed and hidden again) unfold
  // and fold one after another. Items whose status just changed (strike-through, slide) and items just hidden (closedMode
  // "none") are not handled here
  const rows = useFold(shown, (i) => i.id, {
    exists: (id) => all.some((i) => i.id === id),
    ok: (i) => !OPEN.includes(i.status) && !motionOf(i.id) && !lingering.includes(i) && !lingerPrev.current.has(i.id),
  });
  lingerPrev.current = new Set(lingering.map((i) => i.id));
  useEffect(() => {
    if (!lingerKey) return;
    const t = setTimeout(() => bump((x) => x + 1), WINDOW_MS + 60);
    return () => clearTimeout(t);
  }, [lingerKey]);
  // When the order changes (done, reopened, moved up or down, added, deleted), every row slides from its old position to the
  // new one (FLIP). If an item was just done or reopened, the slide waits for its line to finish (STRIKE_MS), and the sliding
  // row is drawn above the others (.lifted). A row whose status changed often gets taller or shorter (a "done just now" note
  // appears, or the meta line goes away): its height is held at the old value and eases to the new one after the slide,
  // otherwise it would overlap the row below while the line is drawn, or leave a gap below
  useLayoutEffect(() => {
    const rows = listRef.current ? [...listRef.current.children].filter((n) => n.dataset?.id) : [];
    const tops = () => new Map(rows.map((n) => [n.dataset.id, n.offsetTop]));
    let pos = tops();
    const hts = new Map(rows.map((n) => [n.dataset.id, bodyOf(n)?.offsetHeight ?? 0]));
    const prev = lastPos.current, prevH = lastH.current;
    lastPos.current = pos; lastH.current = hts;
    if (!prev || reducedMotion() || [...prev.keys()].join("|") === [...pos.keys()].join("|")) return;
    const moved = rows.filter((n) => motionOf(n.dataset.id));
    const delay = moved.some((n) => motionOf(n.dataset.id) === "close") ? STRIKE_MS : moved.length ? ERASE_MS : 0;
    const held = new Set(), sliding = new Set();
    for (const n of moved) {
      const h0 = prevH?.get(n.dataset.id), b = bodyOf(n);
      if (b && h0 && h0 !== hts.get(n.dataset.id)) { b.style.height = `${h0}px`; b.style.overflow = "hidden"; held.add(n); }
    }
    if (held.size) pos = tops(); // holding the heights moved the rows below, so measure again
    for (const n of rows) {
      const from = prev.get(n.dataset.id), dy = from == null ? 0 : from - pos.get(n.dataset.id);
      if (!dy) continue;
      n.style.transition = "none";
      n.style.transform = `translateY(${dy}px)`;
      void n.offsetHeight; // start from the old position
      n.style.transition = `transform ${MOVE_MS}ms cubic-bezier(.22, 1, .36, 1) ${delay}ms`;
      n.style.transform = "";
      sliding.add(n);
      const lift = moved.includes(n) ? setTimeout(() => n.classList.add("lifted"), delay) : 0;
      const end = (e) => {
        if (e.target !== n || e.propertyName !== "transform") return;
        clearTimeout(lift);
        n.style.transition = "";
        n.classList.remove("lifted");
        n.removeEventListener("transitionend", end);
        if (held.has(n)) settleHeight(bodyOf(n));
      };
      n.addEventListener("transitionend", end);
    }
    for (const n of held) if (!sliding.has(n)) setTimeout(() => settleHeight(bodyOf(n)), delay); // rows that did not move: settle the height once the line is drawn
  });
  if (ui.editing === `g:${g.id}`) return html`<${GroupForm} group=${g} />`;
  const older = closedModeOf(doc.theme) === "recent" ? splitClosed(all, doc.theme).older.length : 0;
  const showTitle = !(single && g.plain) && !(single && g.title === sectionOf(doc, g.section)?.title);
  const tools = html`<span class="tools">
    <${MoveTools} onMove=${act.group(g.id).move} />
    <button class="tool" title="改这张卡" onClick=${() => setUi({ editing: `g:${g.id}`, adding: null })}>✎</button>
  </span>`;
  const count = html`<span class="count mono">${open.length || ""}</span>`;
  return html`<div class="card">
    ${showTitle ? html`<h3>${no ? html`<span class="no mono">${String(no).padStart(2, "0")}</span>` : null}<${Md} text=${g.title} />${count}${tools}</h3>`
      : ui.editMode ? html`<h3>${count}${tools}</h3>` : null}
    ${g.note ? html`<p class="desc"><${Md} text=${g.note} /></p>` : null}
    ${shown.length ? html`<div class=${`items ${showTitle || g.note ? "" : "flush"}`} ref=${listRef}>${rows.map(({ x: i, enter, leave }) => html`<${ItemRow} key=${i.id} item=${i} exiting=${lingering.includes(i)} enter=${enter} leave=${leave} />`)}</div>`
      : html`<div class="none">${all.length ? "都做完了。" : "还没有事。"}</div>`}
    ${older ? html`<button class="closed-more" onClick=${() => setExpanded(!expanded)}>${expanded ? "收起" : html`<${StatusIcon} s="done" />之前还做完了 ${older} 条`}</button>` : null}
    <${AddInline} id=${`i:${g.id}`} keep label="＋ 添加" placeholder="要做的事" onSubmit=${(title) => act.addItem({ group: g.id, title })} />
  </div>`;
}

function GroupForm({ group: g }) {
  const { doc, act } = useBoard();
  const { f, bind, set } = useForm({ title: g.title, note: g.note ?? "", section: g.section });
  const first = useAutoFocus(), card = act.group(g.id);
  const save = () => f.title.trim() && card.patch({ title: f.title.trim(), note: f.note.trim(), section: f.section }, null, { close: true });
  const del = () => {
    const n = doc.items.filter((i) => i.group === g.id).length;
    if (confirm(n ? `这张卡里有 ${n} 条，会一起删掉。确定？` : "删掉这张卡？")) card.remove({ force: true, close: true });
  };
  return html`<div class="card"><div class="form">
    <input class="input" ref=${first} ...${bind("title")} onKeyDown=${onEnter(save)} placeholder="卡片标题" />
    <${AutoText} ...${bind("note")} placeholder="说明" />
    <label>放在哪一块</label>
    <select class="input" value=${f.section} onChange=${(e) => set("section", e.target.value)}>
      ${sections(doc).map((s) => html`<option key=${s.id} value=${s.id}>${s.title}</option>`)}
    </select>
    <${FormActions} onSave=${save} onDelete=${del} deleteLabel="删除这张卡" />
  </div></div>`;
}
