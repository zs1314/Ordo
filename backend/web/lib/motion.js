// Items whose status just changed (done, dropped, reopened), for the board to animate:
//   done → a line is drawn across the title from left to right (STRIKE_MS); then the row slides down into the done items below
//          (MOVE_MS) and the other rows move up to fill in;
//   reopened → the line retracts from right to left, then the row slides back up;
//   the card does not keep it once closed (the "none" mode, or a dropped item in the "recent" mode) → once the line is drawn, the
//          row collapses and fades out.
// Whenever the data changes (a local click, or polling that picks up a change made elsewhere), App first compares the old and new
// documents and records what changed; components ask motionOf(id) while rendering.
// A record lasts only WINDOW_MS; after that the change no longer counts as just made. When the system has prefers-reduced-motion
// set, none of these animations play.
import { OPEN } from "./model.js";

export const STRIKE_MS = 420, ERASE_MS = 300, MOVE_MS = 520, WINDOW_MS = 1500;
const marks = new Map(); // id → { kind: "close" | "open", at }
const handoffs = new Map(); // id → when it was handed to an agent

/** Compares the old and new documents and records the items just done or dropped (close), just reopened (open) and just
 *  handed to an agent */
export function noteChanges(oldDoc, newDoc) {
  if (!oldDoc?.items || !newDoc?.items) return;
  const before = new Map(oldDoc.items.map((i) => [i.id, i.status]));
  const now = performance.now();
  for (const i of newDoc.items) {
    const s = before.get(i.id);
    if (s === undefined || s === i.status) continue;
    const was = OPEN.includes(s), is = OPEN.includes(i.status);
    if (was && !is) marks.set(i.id, { kind: "close", at: now });
    else if (!was && is) marks.set(i.id, { kind: "open", at: now });
    if (i.status === "agent") handoffs.set(i.id, now);
  }
}

/** Whether this item was handed to an agent within the last HANDOFF_MS (its pill and its agent card play an entrance) */
export const HANDOFF_MS = 1200;
export function handedOff(id) {
  const at = handoffs.get(id);
  if (at === undefined) return false;
  if (performance.now() - at > HANDOFF_MS) { handoffs.delete(id); return false; }
  return true;
}

/** What just happened to this item: "close" / "open" / null */
export function motionOf(id) {
  const m = marks.get(id);
  if (!m) return null;
  if (performance.now() - m.at > WINDOW_MS) { marks.delete(id); return null; }
  return m.kind;
}

export const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---- Expand and collapse ----
// A row (or a block) grows from zero height (in) or shrinks to zero height (out): height, vertical padding and vertical margins
// change together while it fades in or out, and whatever is below moves along smoothly. Played with Web Animations rather than
// classes, so a re-render cannot interrupt it; a collapsed element stays collapsed (fill: forwards) until it is removed
export const FOLD_IN = 320, FOLD_OUT = 240, FOLD_STAGGER = 34;

export function fold(el, dir, { delay = 0, duration = dir === "in" ? FOLD_IN : FOLD_OUT, easing } = {}) {
  if (!el || reducedMotion() || typeof el.animate !== "function") return null;
  const cs = getComputedStyle(el);
  const full = {
    height: `${el.offsetHeight}px`, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom,
    marginTop: cs.marginTop, marginBottom: cs.marginBottom, opacity: 1, borderBottomColor: cs.borderBottomColor,
  };
  const flat = { height: "0px", paddingTop: "0px", paddingBottom: "0px", marginTop: "0px", marginBottom: "0px", opacity: 0, borderBottomColor: "transparent" };
  el.style.overflow = "hidden";
  const anim = el.animate(dir === "in" ? [flat, { ...full, opacity: 0.4, offset: 0.55 }, full] : [full, flat], {
    duration, delay,
    easing: easing ?? (dir === "in" ? "cubic-bezier(.22, 1, .36, 1)" : "cubic-bezier(.4, 0, .9, .6)"),
    fill: dir === "in" ? "backwards" : "forwards",
  });
  if (dir === "in") anim.finished.then(() => { el.style.overflow = ""; }, () => {});
  return anim;
}
