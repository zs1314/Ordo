import { h, html, useRef, useLayoutEffect, useState, useEffect } from "../vendor/preact-htm.js";
import { useBoard } from "./ctx.js";
import { md } from "../lib/md.js";

// Small parts used everywhere: Block (a block of the page), Md (inline Markdown), forms (useForm, AutoText, FormActions),
// AddInline (a "+ Add" button that turns into an input), MoveTools (↑ ↓), usePresence (animated show / hide), onEnter,
// anchorAt, isPhone

// Renders inline Markdown (md() escapes the input first)
export function Md({ text, tag = "span", ...rest }) {
  return h(tag, { ...rest, dangerouslySetInnerHTML: { __html: md(text) } });
}

// A block of the page: a bold heading on the left, a stack of cards on the right.
// id and toc (the name shown in the table of contents, title by default) are for the table of contents on the left
export function Block({ title, side, cls = "", id, toc, children }) {
  return html`<section class=${`block ${cls}`} id=${id} data-toc=${toc ?? title}>
    <div class="side">${side ?? html`<h2>${title}</h2>`}</div>
    <div class="stack">${children}</div>
  </section>`;
}

export const isPhone = () => matchMedia("(max-width: 640px)").matches;

export const onEnter = (fn) => (e) => {
  if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); fn(); }
};

// ---- Forms ----

/** The fields of a form: bind(k) for an input (value, onInput), set(k, v) to change one directly */
export function useForm(initial) {
  const [f, setF] = useState(initial);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const bind = (k) => ({ value: f[k], onInput: (e) => set(k, e.target.value) });
  return { f, set, bind };
}

/** Puts the cursor in the first input when opened */
export function useAutoFocus() {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return ref;
}

// A textarea that grows with its content, so a long note can be read at once without scrolling in a small box
export function AutoText({ minRows = 2, value, ...rest }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [value]);
  return html`<textarea class="input" ref=${ref} rows=${minRows} value=${value} ...${rest}></textarea>`;
}

/** The button row at the bottom of an editor: Delete on the left, Cancel and Save on the right. Cancel just closes the editor */
export function FormActions({ onSave, onDelete, deleteLabel = "删除" }) {
  const { setUi } = useBoard();
  return html`<div class="row">
    ${onDelete ? html`<button class="btn danger" onClick=${onDelete}>${deleteLabel}</button><span class="grow"></span>` : null}
    <button class="btn" onClick=${() => setUi({ editing: null })}>取消</button>
    <button class="btn dark" onClick=${onSave}>保存</button>
  </div>`;
}

/** A "+ Add" button: a click turns it into an input, Enter submits, and clicking elsewhere with nothing typed closes it.
 *  id: which one ui.adding refers to; keep: the input stays after adding so more can be added (items at the bottom of a card);
 *  look="link" is a line of faint text (bottom of a card), "card" a dashed box (adding cards and sections). onSubmit returns
 *  true if it was added */
export function AddInline({ id, label, placeholder, onSubmit, keep = false, look = "link", wide = false }) {
  const { ui, setUi } = useBoard();
  const [v, setV] = useState(""), ref = useRef(null), active = ui.adding === id;
  useEffect(() => { if (active) ref.current?.focus(); }, [active]);
  if (!active) {
    const open = () => setUi({ adding: id, editing: null });
    return look === "link" ? html`<div class="add"><button class="addlink" onClick=${open}>${label}</button></div>`
      : html`<button class="addcard" style=${wide ? "width:100%" : ""} onClick=${open}>${label}</button>`;
  }
  const submit = async () => {
    if (!v.trim() || !(await onSubmit(v.trim()))) return;
    setV("");
    if (keep) requestAnimationFrame(() => ref.current?.focus());
    else setUi({ adding: null });
  };
  // After adding, focus leaves briefly and comes back: wait a moment and close only if focus is no longer here
  const blur = () => { if (!v.trim()) setTimeout(() => setUi((u) => (u.adding === id && document.activeElement !== ref.current ? { adding: null } : {})), 150); };
  const input = html`<input class="input" ref=${ref} value=${v} onInput=${(e) => setV(e.target.value)} onKeyDown=${onEnter(submit)} onBlur=${blur} placeholder=${placeholder} />`;
  return look === "link" ? html`<div class="add">${input}</div>` : html`<div class="card">${input}</div>`;
}

/** The two small move up / move down buttons */
export const MoveTools = ({ onMove }) => html`<button class="tool" title="上移" onClick=${() => onMove("up")}>↑</button><button class="tool" title="下移" onClick=${() => onMove("down")}>↓</button>`;

// ---- Popovers, show / hide ----

// Shows and hides something with an animation (e.g. the settings drawer): on open it mounts first and adds "on" on the next
// frame so it slides in; on close it removes "on" first and unmounts once the animation is over (ms). Returns
// [whether to render, whether it is open]
export function usePresence(open, ms = 300) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      let r2 = 0;
      const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setShown(true)); });
      return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(t);
  }, [open]);
  return [mounted, shown];
}

// Where a popover (.pop) goes: x, y is the bottom-left corner of the anchor (page coordinates). The anchor needs
// data-pop-anchor so that clicking it does not count as a click outside
/** Keeps the last non-null value for ms after value becomes null, so it can animate out: returns [shown, leaving] */
export function useLingering(value, ms) {
  const last = useRef(null), [gone, setGone] = useState(true);
  if (value) last.current = value;
  useEffect(() => {
    if (value) { setGone(false); return; }
    const t = setTimeout(() => setGone(true), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  const shown = value ?? (gone ? null : last.current);
  return [shown, !value && !!shown];
}

export const anchorAt = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.bottom + scrollY + 6, w: r.width }; };
