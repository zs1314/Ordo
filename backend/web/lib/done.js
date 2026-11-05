// Where closed items go and how many stay. The "done" setting has three modes (theme.closedMode):
//   none   neither cards nor the calendar show done items
//   recent cards keep only items done in the last few days (theme.recentDays: 1 / 3 / 7, by local date; 1 means today only);
//          older ones collapse into a single row that expands on click. The calendar shows every done item (struck through).
//          Dropped items are not shown
//   all    done and dropped items are all shown
// In a card, open items come first (in their own order) and done items follow, most recently done first.
// The "recently done" block lists done items by day (dropped items excluded; check-ins of recurring items do not count, they are
// in the check-in table).
import { OPEN } from "./model.js";
import { ymd } from "./due.js";

export const CLOSED_MODES = ["none", "recent", "all"];
export const RECENT_DAYS = [1, 3, 7];
export const closedModeOf = (t) => (CLOSED_MODES.includes(t?.closedMode) ? t.closedMode : "recent");
export const recentDaysOf = (t) => (RECENT_DAYS.includes(Number(t?.recentDays)) ? Number(t.recentDays) : 3);

/** When the item was done (or dropped), in ms. Older data without doneAt falls back to the time of the last change */
export const closedAt = (i) => Date.parse(i?.doneAt ?? i?.updatedAt ?? "") || 0;
/** Midnight (local time) of the day `back` days ago */
export const dayStart = (now = new Date(), back = 0) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
const newestFirst = (a, b) => closedAt(b) - closedAt(a);

/** Splits closed items into three lists, newest first: recent, done in the last few days; older, done before that; all, every
 *  closed item (dropped ones included) */
export function splitClosed(items, theme, now = new Date()) {
  const cutoff = dayStart(now, recentDaysOf(theme) - 1).getTime();
  const all = items.filter((i) => !OPEN.includes(i.status)).sort(newestFirst);
  const done = all.filter((i) => i.status === "done");
  return { all, recent: done.filter((i) => closedAt(i) >= cutoff), older: done.filter((i) => closedAt(i) < cutoff) };
}

/** Which closed items a card shows; expanded: the "N more done earlier" row has been expanded */
export function visibleClosed(items, theme, { expanded = false, now = new Date() } = {}) {
  const mode = closedModeOf(theme), s = splitClosed(items, theme, now);
  if (mode === "all") return s.all;
  if (mode === "recent") return expanded ? [...s.recent, ...s.older] : s.recent;
  return [];
}

/** Whether the calendar shows this closed item */
export function calendarShowsClosed(item, theme) {
  const mode = closedModeOf(theme);
  return mode === "all" || (mode === "recent" && item.status === "done");
}

/** Done items grouped by local date: { "2026-11-02": [...] }, newest first within each day */
export function doneByDay(items) {
  const out = {};
  for (const i of items) {
    const t = closedAt(i);
    if (i.status === "done" && t) (out[ymd(new Date(t))] ??= []).push(i);
  }
  for (const k in out) out[k].sort(newestFirst);
  return out;
}
