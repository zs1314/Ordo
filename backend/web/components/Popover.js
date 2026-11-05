import { html, useState, useLayoutEffect, useEffect, useRef } from "../vendor/preact-htm.js";
import { useBoard } from "./ctx.js";
import { onEnter, isPhone } from "./ui.js";
import { CalIcon, RepeatIcon, EditIcon, StatusIcon } from "./icons.js";
import { LABEL, ORDER, OPEN } from "../lib/model.js";
import { repeatState } from "../lib/repeat.js";
import { leaveCard, cheer } from "../lib/fx/index.js";
import { reducedMotion } from "../lib/motion.js";
import { PlaceChips } from "./Places.js";
import { DatePicker } from "./DatePicker.js";
import { RepeatEditor } from "./Repeat.js";

// The popover, by pop.kind: status is the status menu; ask is the follow-up question for agent, waiting and dropped;
// picker is the date picker (DatePicker.js); repeat is the repeat editor (RepeatEditor in Repeat.js).
// On desktop it hangs below the element that was clicked; on phones it rises from the bottom of the screen (sheet) over a mask.
// Motion: it opens from the element (the menu's rows follow one after another), changing to another view (the follow-up
// question, the date picker, the repeat editor) morphs the box from the old size to the new one, and leaving (closed, still
// shown for a moment) fades it out or slides the sheet down
export function Popover({ leaving = false }) {
  const { doc, pop, setPop } = useBoard();
  const ref = useRef(null), was = useRef(null);
  const sheet = isPhone();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!sheet) {
      const left = Math.min(pop.x, scrollX + document.documentElement.clientWidth - el.offsetWidth - 12);
      el.style.left = `${left}px`;
      el.style.setProperty("--ox", `${Math.round(pop.x + (pop.w ?? 0) / 2 - left)}px`); // it grows out of the element's middle
      if (pop.kind === "ask" && !leaving) el.querySelector("input")?.focus(); // not on phones: no keyboard yet, so the places can be tapped first
    }
    const now = { kind: pop.kind, left: el.offsetLeft, top: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
    const prev = was.current;
    if (!prev) el.querySelectorAll(":scope > .opt").forEach((o, k) => o.style.setProperty("--i", k)); // the rows come in one by one
    was.current = now;
    if (prev && prev.kind !== now.kind) morph(el, prev, now, sheet);
  }, [pop.kind, pop.s, pop.x, pop.y]);
  useAboveKeyboard(ref, sheet);
  const item = pop.id ? doc.items.find((i) => i.id === pop.id) : null;
  if (pop.id && !item) return null;
  const close = () => setPop(null);
  const body = pop.kind === "status" ? html`<${StatusMenu} item=${item} />`
    : pop.kind === "ask" ? html`<${Ask} item=${item} s=${pop.s} close=${close} />`
    : pop.kind === "picker" ? html`<${DuePicker} item=${item} close=${close} />`
    : pop.kind === "repeat" ? html`<${RepeatEditor} key=${item.id} item=${item} close=${close} />`
    : null;
  const cls = leaving ? "leaving" : "";
  if (sheet) return html`<div class=${`pop-mask ${cls}`}></div><div class=${`pop sheet ${cls}`} ref=${ref}>${body}</div>`;
  return html`<div class=${`pop ${cls}`} ref=${ref} style=${{ left: `${pop.x}px`, top: `${pop.y}px` }}>${body}</div>`;
}

// From one view to the next: the box goes from the old size and place to the new ones (on phones only the height changes,
// the sheet stays at the bottom); the new view fades in meanwhile (styles.css)
function morph(el, a, b, sheet) {
  if (reducedMotion() || typeof el.animate !== "function") return;
  const box = (r) => (sheet ? { height: `${r.h}px` } : { left: `${r.left}px`, top: `${r.top}px`, width: `${r.w}px`, height: `${r.h}px` });
  el.classList.add("morphing");
  el.animate([box(a), box(b)], { duration: 280, easing: "cubic-bezier(.2, .8, .2, 1)" })
    .finished.then(() => el.classList.remove("morphing"), () => el.classList.remove("morphing"));
}

// Status menu: the six statuses (recurring items have no done; "done today" is at the top instead), then due date, repeat
// and edit
function StatusMenu({ item }) {
  const { doc, act, pop, setPop, setUi } = useBoard();
  const it = act.item(item.id);
  // Opened from the ⋯ on an agent card: done and done today work like the buttons on the card, which leaves with the
  // completion effect
  const card = pop.from === "agent" ? document.querySelector(`[data-agent-card="${CSS.escape(item.id)}"]`) : null;
  const pick = (s) => {
    if (s === item.status) return setPop(null);
    if (["agent", "waiting", "dropped"].includes(s)) return setPop({ ...pop, kind: "ask", s });
    if (s === "done" && card) { setPop(null); return leaveCard(card, card, doc.theme, () => it.patch({ status: "done" })); }
    it.patch({ status: s });
  };
  const rep = !!item.repeat?.days?.length, st = rep ? repeatState(item) : null;
  const tick = () => {
    const save = () => it.check(st.key, !st.done, st.done ? "取消了今天的打卡" : "打卡了");
    if (st.done) return save();
    if (card) { setPop(null); return leaveCard(card, card, doc.theme, save); }
    cheer(doc.theme, document.querySelector(`.pill[data-id="${CSS.escape(item.id)}"]`));
    return save();
  };
  const edit = () => { setPop(null); setUi({ editing: pop.from === "agent" ? `i:${item.id}@agent` : `i:${item.id}`, adding: null }); };
  return html`${rep && st.scheduled && OPEN.includes(item.status) ? html`<${Opt} icon=${html`<${StatusIcon} s="done" />`} label=${st.done ? "取消今天的打卡" : "今天做完了"} onClick=${tick} /><div class="sep"></div>` : null}
    ${ORDER.filter((s) => !(rep && s === "done")).map((s) => html`<${Opt} key=${s} s=${s} icon=${html`<${StatusIcon} s=${s} />`} label=${LABEL[s]} cur=${item.status === s} onClick=${() => pick(s)} />`)}
    <div class="sep"></div>
    ${rep ? null : html`<${Opt} icon=${html`<${CalIcon} />`} label=${item.due ? "改截止日期" : "设截止日期"} onClick=${() => setPop({ ...pop, kind: "picker" })} />`}
    <${Opt} icon=${html`<${RepeatIcon} />`} label=${rep ? "改重复" : "设为重复"} onClick=${() => setPop({ ...pop, kind: "repeat" })} />
    <${Opt} icon=${html`<${EditIcon} />`} label="编辑" onClick=${edit} />`;
}
const Opt = ({ icon, label, cur, onClick, s = "" }) => html`<button class=${`opt ${s ? `s-${s}` : ""}`} onClick=${onClick}><span class="i">${icon}</span>${label}${cur ? html`<span class="cur">当前</span>` : null}</button>`;

// Agent, waiting, dropped: ask one follow-up question, then change the status
const QUESTIONS = { agent: "挂在哪？", waiting: "在等谁、等什么？", dropped: "为什么不做了？" };
function Ask({ item, s, close }) {
  const { doc, act } = useBoard();
  const [v, setV] = useState((s === "agent" ? item.agent?.where : s === "waiting" ? item.waitingOn : item.reason) ?? "");
  const [note, setNote] = useState(item.agent?.note ?? "");
  const patch = (p) => act.item(item.id).patch(p);
  const ok = () => (s === "agent" ? patch({ status: "agent", agent: { where: v.trim(), note: note.trim() } })
    : s === "waiting" ? patch({ status: "waiting", waitingOn: v.trim() }) : patch({ status: "dropped", reason: v.trim() }));
  // Agent: one click on a recently used place hands the item off (the note is kept); any other place is typed in
  const pickPlace = (where) => patch({ status: "agent", agent: { where, note: note.trim() } });
  return html`<div class="ask">
    <div class="q">${QUESTIONS[s]}</div>
    ${s === "agent" ? html`<${PlaceChips} value=${v} onPick=${pickPlace} />` : null}
    <input class="input" placeholder=${s === "agent" && doc.places?.length ? "其他地方" : ""} value=${v} onInput=${(e) => setV(e.target.value)} onKeyDown=${onEnter(ok)} />
    ${s === "agent" ? html`<input class="input" placeholder="它在做什么、回来要看什么" value=${note} onInput=${(e) => setNote(e.target.value)} onKeyDown=${onEnter(ok)} />` : null}
    <div class="row"><button class="btn" onClick=${close}>取消</button><button class="btn dark" onClick=${ok}>确定</button></div>
  </div>`;
}

// Date picking: for an item, every change is saved and the picker stays open; for the editor (pop.onPick), the value goes
// back into the input and is saved only on Save
function DuePicker({ item, close }) {
  const { act, pop } = useBoard();
  const save = pop.onPick
    ? async (v, done) => { pop.onPick(v); if (done) close(); return true; }
    : (v, done) => act.item(item.id).patch({ due: v }, null, done ? {} : { quiet: true });
  return html`<${DatePicker} key=${pop.id ?? "form"} initial=${pop.onPick ? pop.value : item.due} save=${save} close=${close} />`;
}

// On phones, when an input in the sheet is focused and the keyboard comes up, the sheet moves above the keyboard
// (visualViewport is the visible area above the keyboard)
function useAboveKeyboard(ref, on) {
  useEffect(() => {
    const vv = window.visualViewport, el = ref.current;
    if (!on || !vv || !el) return;
    const fit = () => {
      const a = document.activeElement;
      const typing = el.contains(a) && a.matches("input, textarea, select");
      const kb = typing ? Math.round(innerHeight - vv.height - vv.offsetTop) : 0;
      el.style.bottom = kb > 60 ? `${kb}px` : "";
      el.style.maxHeight = kb > 60 ? `${Math.round(vv.height - 12)}px` : "";
    };
    const later = () => setTimeout(fit, 60);
    vv.addEventListener("resize", fit); vv.addEventListener("scroll", fit);
    el.addEventListener("focusin", later); el.addEventListener("focusout", later);
    return () => {
      vv.removeEventListener("resize", fit); vv.removeEventListener("scroll", fit);
      el.removeEventListener("focusin", later); el.removeEventListener("focusout", later);
    };
  }, [on]);
}
