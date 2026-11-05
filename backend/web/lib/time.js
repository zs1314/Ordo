// Relative time: "3 minutes ago", "2 hours ago", "5 days ago" (in Chinese). The server's briefing (core/report.mjs) uses it too
import { WEEK } from "./due.js";

export const ago = (iso, now = Date.now()) => {
  if (!iso) return "—";
  const m = Math.round((now - Date.parse(iso)) / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} 小时前`;
  return `${Math.round(h / 24)} 天前`;
};
/** How long it has been (as in "handed off for 3 hours") */
export const dur = (iso) => ago(iso).replace(/前$/, "");
export const hoursSince = (iso) => (iso ? (Date.now() - Date.parse(iso)) / 3600000 : Infinity);
/** Today's date for the header bar: month, day and weekday, as in "Nov 3, Tue" (in Chinese) */
export const today = () => { const d = new Date(); return `${d.getMonth() + 1}月${d.getDate()}日 周${WEEK[d.getDay()]}`; };
