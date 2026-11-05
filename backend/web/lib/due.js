// Due dates: can be written as 2026-10-21, 2026-10-21 23:59, 10-21 or a Chinese month-day date, optionally followed by AoE.
// Anything else (e.g. a "to be confirmed" note) is shown as is and stays off the calendar. When only month and day are given,
// the server fills in the year on save (fixDueYear in core/items.mjs).
export const WEEK = "日一二三四五六";
export const pad2 = (n) => String(n).padStart(2, "0");
export const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

export function parseDue(s) {
  const t = String(s ?? "").trim();
  if (!t) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?\s*(aoe)?$/i.exec(t), y, mo, d, hh, mm, aoe;
  if (m) [, y, mo, d, hh, mm, aoe] = m;
  else {
    m = /^(\d{1,2})[-/.](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?\s*(aoe)?$/i.exec(t) || /^(\d{1,2})月(\d{1,2})日?(?:\s*(\d{1,2}):(\d{2}))?\s*(aoe)?$/i.exec(t);
    if (!m) return null;
    [, mo, d, hh, mm, aoe] = m;
    y = new Date().getFullYear();
  }
  const r = { y: +y, mo: +mo, d: +d, hh: hh == null ? null : +hh, mm: mm == null ? null : +mm, aoe: !!aoe };
  // The date must actually exist (February 31 and the like do not), and the time must be within 00:00–23:59
  const day = new Date(r.y, r.mo - 1, r.d);
  if (day.getFullYear() !== r.y || day.getMonth() !== r.mo - 1 || day.getDate() !== r.d) return null;
  if (r.hh != null && (r.hh > 23 || r.mm > 59)) return null;
  return r;
}
export const dueKey = (p) => `${p.y}-${pad2(p.mo)}-${pad2(p.d)}`;
// AoE = UTC-12: 23:59 AoE on a given day is 11:59 UTC on the next day
const dueAt = (p) => (p.aoe ? new Date(Date.UTC(p.y, p.mo - 1, p.d, (p.hh ?? 23) + 12, p.mm ?? 59, 59)) : new Date(p.y, p.mo - 1, p.d, p.hh ?? 23, p.mm ?? 59, 59));

export function dueInfo(s) {
  const p = parseDue(s);
  if (!p) return null;
  const at = dueAt(p), now = new Date(), h = (at - now) / 3600000;
  const day = new Date(p.y, p.mo - 1, p.d), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const atDay = new Date(at.getFullYear(), at.getMonth(), at.getDate()), dd = Math.round((atDay - today) / 86400000); // counted by the local day on which it is actually due
  const rel = h < 0 ? (dd < 0 ? `过了 ${-dd} 天` : "已经过了") : h < 48 ? `还剩 ${Math.max(1, Math.floor(h))} 小时` : `还有 ${dd} 天`;
  const date = `${p.mo}月${p.d}日 周${WEEK[day.getDay()]}${p.hh != null ? ` ${pad2(p.hh)}:${pad2(p.mm)}` : ""}${p.aoe ? " AoE" : ""}`;
  const local = p.aoe ? `本地时间 ${at.getMonth() + 1}月${at.getDate()}日 ${pad2(at.getHours())}:${pad2(at.getMinutes())}` : "";
  return { p, at, h, dd, rel, date, local, key: dueKey(p), soon: h < 24, over: h < 0 };
}

// Starts on a Monday and covers the whole month in full weeks
export function monthCells(first) {
  const off = (first.getDay() + 6) % 7, last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return Array.from({ length: Math.ceil((off + last) / 7) * 7 }, (_, k) => new Date(first.getFullYear(), first.getMonth(), 1 - off + k));
}
export const firstOfMonth = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1);
export const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
