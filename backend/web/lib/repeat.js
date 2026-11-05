// Recurring items: item.repeat = { days: [1,2,3,4,5], time: "10:00" }, with days as JS weekdays (0 = Sunday);
// item.doneDates = ["2026-10-20", ...] records the days checked in. The server's lib.mjs uses these functions directly; this is
// the only copy.
import { ymd, WEEK } from "./due.js";

export const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first
const monFirst = (a, b) => ((a + 6) % 7) - ((b + 6) % 7);

export function repeatLabel(r) {
  if (!r?.days?.length) return "";
  const days = [...r.days].sort(monFirst), k = days.join(",");
  const base = days.length === 7 ? "每天" : k === "1,2,3,4,5" ? "工作日" : k === "6,0" ? "周末" : `每周${days.map((d) => WEEK[d]).join("")}`;
  return r.time ? `${base} ${r.time}` : base;
}

// When "today" starts for a recurring item: with a time set (say weekdays at 12:00), the new day begins only at that time and
// anything earlier still counts as the day before; without one it starts at midnight. Check-ins are recorded on this "today" too
export function repeatDay(r, now = new Date()) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(r?.time ?? "");
  return m ? new Date(now.getTime() - (Number(m[1]) * 60 + Number(m[2])) * 60000) : now;
}

// Whether it is due today and whether it is done; streak = number of consecutive check-ins (due today but not done yet does not
// break it)
export function repeatState(item, now = new Date()) {
  const r = item.repeat;
  if (!r?.days?.length) return null;
  const day = repeatDay(r, now);
  const days = new Set(r.days), done = new Set(item.doneDates ?? []), key = ymd(day);
  const scheduled = days.has(day.getDay()), doneToday = done.has(key);
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  if (scheduled && !doneToday) d.setDate(d.getDate() - 1);
  let streak = 0;
  for (let k = 0; k < 400; k++) {
    if (days.has(d.getDay())) { if (done.has(ymd(d))) streak++; else break; }
    d.setDate(d.getDate() - 1);
  }
  return { key, scheduled, done: doneToday, streak, label: repeatLabel(r), unit: days.size === 7 ? "天" : "次" };
}

// Handed off to an agent and actually running today. When a recurring item is done for today, or is not due today, its agent is
// idle for now: it stays out of the agent block and out of the overview counts, and comes back the next day it is due
export function agentActive(item, now = new Date()) {
  if (item.status !== "agent") return false;
  const st = repeatState(item, now);
  return !st || (st.scheduled && !st.done);
}

// The seven days of a week, Monday first; offset = 0 is this week, -1 is last week
export function weekOf(offset = 0, now = new Date()) {
  const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7) + 7 * offset);
  return Array.from({ length: 7 }, (_, k) => new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + k));
}
