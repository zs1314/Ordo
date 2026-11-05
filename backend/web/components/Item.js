import { html, useEffect, useRef } from "../vendor/preact-htm.js";
import { useBoard } from "./ctx.js";
import { Md, AutoText, FormActions, useForm, onEnter } from "./ui.js";
import { CalIcon, RepeatIcon, StatusIcon, AgentFrame } from "./icons.js";
import { RepeatBadge, RepeatPill } from "./Repeat.js";
import { PlaceChips } from "./Places.js";
import { repeatLabel, repeatState, agentActive } from "../lib/repeat.js";
import { SHORT, OPEN, allCards, cardPath } from "../lib/model.js";
import { dueInfo } from "../lib/due.js";
import { stripMd } from "../lib/md.js";
import { ago } from "../lib/time.js";
import { motionOf, handedOff, reducedMotion, STRIKE_MS, MOVE_MS } from "../lib/motion.js";
import { useFoldAnim, staggerOf } from "./useFold.js";

// One item: the status pill on the left, the title, note, a small meta line (due date, Canvas link, repeat, where the agent
// runs, who it is waiting on, ...), and ↑ ↓ ✎ on the right. The editor (ItemForm) is here too: ✎ in a card opens it in
// that row, Edit on an agent card opens it in the Agent block

// Status pill: opens the status menu; recurring items use another kind (RepeatPill, one click checks in).
// With an agent: the gear turns and the dashes of the frame travel around it (styles.css, .run); right after the hand-off
// (handoff) the gear spins up and the frame whirls in
export function Pill({ item }) {
  const { openPop } = useBoard();
  if (item.repeat?.days?.length) return html`<${RepeatPill} item=${item} />`;
  const agent = item.status === "agent", handoff = agent && handedOff(item.id);
  return html`<button class=${`pill ${item.status} ${agent ? "run" : ""} ${handoff ? "handoff" : ""}`} data-id=${item.id} data-pop-anchor aria-label=${SHORT[item.status]}
    onClick=${(e) => openPop("status", item.id, e.currentTarget)}>${agent ? html`<span class="gear"><${StatusIcon} s="agent" /></span>` : html`<${StatusIcon} s=${item.status} />`}<span class="lbl">${SHORT[item.status]}</span>${
    agent ? html`<${AgentFrame} handoff=${handoff} />` : null}</button>`;
}

// The due date in an item's meta line: a click opens the date picker
function Due({ item: i }) {
  const { openPop } = useBoard();
  const open = (e) => openPop("picker", i.id, e.currentTarget);
  const d = dueInfo(i.due);
  if (!d) return html`<span class="due" data-pop-anchor onClick=${open}>${i.due === "待确认" ? "截止待定" : `截止 ${i.due}`}</span>`;
  const rel = !OPEN.includes(i.status) ? null : d.soon ? html`<span class="soon">${d.rel}</span>` : `　${d.rel}`;
  return html`<span class="due" data-pop-anchor title=${d.local || null} onClick=${open}>截止 ${d.date}${rel}</span>`;
}

// The small meta line
function metaOf(i) {
  const meta = [];
  if (i.due) meta.push(html`<${Due} item=${i} />`);
  // Synced from Canvas: link to the assignment page
  if (/^https:\/\//.test(i.source?.url ?? "")) meta.push(html`<a class="src" href=${i.source.url} target="_blank" rel="noopener noreferrer">Canvas</a>`);
  if (i.repeat?.days?.length) meta.push(html`<${RepeatBadge} item=${i} />`);
  // When a recurring item is done for today its agent is idle: show only where it runs, not how long ago it was checked
  if (i.status === "agent") meta.push(agentActive(i) ? `挂在 ${stripMd(i.agent?.where) || "没写"} · ${ago(i.agent?.lastSeen)}看过` : `挂在 ${stripMd(i.agent?.where) || "没写"}`);
  if (i.status === "waiting" && i.waitingOn) meta.push(`在等 ${i.waitingOn}`);
  if (i.status === "dropped" && i.reason) meta.push(i.reason);
  if (i.status === "done" && i.doneAt) meta.push(`${ago(i.doneAt)}做完`);
  return meta.flatMap((p, k) => (k ? ["　", p] : [p]));
}

// exiting: just closed, but the card does not keep it (GroupCard leaves it in place a little longer). Once the line is drawn
// the row folds and fades out, and the rows below move up.
// enter, leave: when "done earlier" is expanded or collapsed, the row unfolds or folds (the value is its index, for
// staggering; see useFold.js)
export function ItemRow({ item: i, exiting = false, enter = null, leave = null }) {
  const { ui, setUi, act, setPop, openPop } = useBoard();
  const ref = useRef(null);
  const loc = ui.locate?.id === i.id ? ui.locate.n : 0;
  useEffect(() => {
    if (loc) ref.current?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
  }, [loc]);
  useFoldAnim(ref, enter != null ? "in" : exiting || leave != null ? "out" : "",
    exiting ? { delay: STRIKE_MS, duration: MOVE_MS - 100, easing: "cubic-bezier(.4, 0, .2, 1)" } : { delay: staggerOf(enter ?? leave) });
  // The editor row carries data-id too: the card tracks order by data-id, so opening the editor is not an order change and
  // the rows below do not slide
  if (ui.editing === `i:${i.id}`) return html`<div class="item" data-id=${i.id}><div class="body"><${ItemForm} item=${i} /></div></div>`;
  const meta = metaOf(i);
  // Only the ✎ on the right opens the editor (opening it by clicking the title was too easy to do by accident); clicking
  // the title does nothing, so it can be selected and copied, and links in it work as usual
  const edit = () => { setPop(null); setUi({ editing: `i:${i.id}`, adding: null, locate: null }); };
  const isOpen = OPEN.includes(i.status);
  // A recurring item done for today, or not scheduled today, has a dimmed title; it comes back by itself the next day
  const st = isOpen ? repeatState(i) : null;
  const today = st ? (st.done ? "today-done" : !st.scheduled ? "today-rest" : "") : "";
  // Just done: a line is drawn from left to right (the check mark bounces); just reopened: the line retracts (see
  // web/lib/motion.js)
  const m = motionOf(i.id), anim = m === "close" ? "just-closed" : m === "open" ? "just-opened" : "";
  // Two class names in turn, so the highlight animation replays when the same item is located again
  const lit = loc ? (loc % 2 ? "located" : "located2") : "";
  return html`<div class=${`item ${i.status} ${today} ${anim} ${lit} ${exiting ? "exiting" : ""} ${leave != null ? "folding" : ""}`} data-id=${i.id} ref=${ref}>
    <${Pill} item=${i} />
    <div class="body">
      <div class="t"><${Md} text=${i.title} /></div>
      ${i.note ? html`<div class="n"><${Md} text=${i.note} /></div>` : null}
      ${meta.length ? html`<div class="m">${meta}</div>` : null}
    </div>
    <div class="tools">
      ${isOpen ? html`<button class="tool" title="上移" onClick=${() => act.item(i.id).move("up")}>↑</button>
      <button class="tool" title="下移" onClick=${() => act.item(i.id).move("down")}>↓</button>` : null}
      ${i.repeat?.days?.length ? html`<button class="tool" title="菜单" data-pop-anchor onClick=${(e) => openPop("status", i.id, e.currentTarget)}>⋯</button>` : null}
      <button class="tool" title="编辑" onClick=${edit}>✎</button>
    </div>
  </div>`;
}

// Editor: title, note, due date, repeat, (depending on status) where the agent runs / who it is waiting on / why it was
// dropped, and which card it is in. Saved only on Save (except repeat, which is saved as soon as it changes)
export function ItemForm({ item: i }) {
  const { doc, act, setPop, openPop } = useBoard();
  const { f, set, bind } = useForm({ title: i.title, note: i.note ?? "", due: i.due ?? "", where: i.agent?.where ?? "", anote: i.agent?.note ?? "", waitingOn: i.waitingOn ?? "", reason: i.reason ?? "", group: i.group });
  const box = useRef(null), first = useRef(null), dueRef = useRef(null);
  useEffect(() => {
    first.current?.focus({ preventScroll: true });
    box.current?.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  }, []);
  const save = () => {
    const p = { title: f.title.trim(), note: f.note.trim(), due: f.due.trim(), group: f.group };
    if (i.status === "agent") p.agent = { where: f.where.trim(), note: f.anote.trim() };
    if (i.status === "waiting") p.waitingOn = f.waitingOn.trim();
    if (i.status === "dropped") p.reason = f.reason.trim();
    if (p.title) act.item(i.id).patch(p, null, { close: true });
  };
  const del = () => { if (confirm(`删除“${i.title}”？`)) act.item(i.id).remove({ close: true }); };
  // The calendar button next to the due date: the picked date goes back into the input and is saved only on Save
  const pickDue = (e) => openPop("picker", undefined, e.currentTarget.closest(".duewrap"), { value: f.due, onPick: (v) => { set("due", v); dueRef.current?.focus(); } });
  const enter = onEnter(save);
  return html`<div class="form" ref=${box}>
    <input class="input" ref=${first} ...${bind("title")} onKeyDown=${enter} placeholder="要做的事" />
    <${AutoText} ...${bind("note")} placeholder="备注" />
    ${i.repeat?.days?.length && !i.due ? null : html`<div class="duewrap">
      <input class="input" ref=${dueRef} ...${bind("due")} onKeyDown=${enter} placeholder="截止：无" />
      <button class="duebtn" data-pop-anchor title="选日期" onClick=${pickDue}><${CalIcon} /></button>
    </div>`}
    <button class="input fieldbtn" data-pop-anchor onClick=${(e) => openPop("repeat", i.id, e.currentTarget)}>
      ${i.repeat?.days?.length ? html`<span>重复：${repeatLabel(i.repeat)}</span>` : html`<span class="ph">重复：无</span>`}
      <span class="fieldicon"><${RepeatIcon} /></span>
    </button>
    ${i.status === "agent" ? html`<input class="input" ...${bind("where")} onKeyDown=${enter} placeholder="挂在哪" />
      <${PlaceChips} value=${f.where} onPick=${(where) => set("where", where)} />
      <input class="input" ...${bind("anote")} onKeyDown=${enter} placeholder="它在做什么、回来要看什么" />` : null}
    ${i.status === "waiting" ? html`<input class="input" ...${bind("waitingOn")} onKeyDown=${enter} placeholder="在等谁、等什么" />` : null}
    ${i.status === "dropped" ? html`<input class="input" ...${bind("reason")} onKeyDown=${enter} placeholder="为什么不做了" />` : null}
    <label>放在</label>
    <select class="input" value=${f.group} onChange=${(e) => set("group", e.target.value)}>
      ${allCards(doc).map((g) => html`<option key=${g.id} value=${g.id}>${cardPath(doc, g)}</option>`)}
    </select>
    <${FormActions} onSave=${save} onDelete=${del} />
  </div>`;
}
