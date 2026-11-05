import { html, useState } from "../vendor/preact-htm.js";
import { useBoard } from "./ctx.js";
import { Chev } from "./icons.js";
import { OPEN } from "../lib/model.js";
import { parseDue, dueInfo, dueKey, monthCells, ymd, pad2, firstOfMonth } from "../lib/due.js";

// Date picker: clicking a day selects and saves it; the time and AoE can then be changed, each change is saved right away,
// and the Done button closes it
export function DatePicker({ initial, save, close }) {
  const { doc } = useBoard();
  const p = parseDue(initial), now = new Date();
  const [month, setMonth] = useState(p ? new Date(p.y, p.mo - 1, 1) : firstOfMonth(now));
  const [sel, setSel] = useState(p ? dueKey(p) : null);
  const [time, setTime] = useState(p && p.hh != null ? `${pad2(p.hh)}:${pad2(p.mm)}` : "");
  const [aoe, setAoe] = useState(!!p?.aoe);
  const todayKey = ymd(now);
  const has = new Set(doc.items.filter((i) => OPEN.includes(i.status)).map((i) => dueInfo(i.due)?.key).filter(Boolean));
  const value = (k, t, a) => `${k}${/^\d{1,2}:\d{2}$/.test(t) ? ` ${t.padStart(5, "0")}` : ""}${a ? " AoE" : ""}`;
  const apply = (k, t, a) => { if (k) save(value(k, t, a), false); };
  const pickDay = (k) => { setSel(k); const [y, mo] = k.split("-").map(Number); setMonth(new Date(y, mo - 1, 1)); apply(k, time, aoe); };
  const quick = (q) => {
    if (q === "tbd") return save("待确认", true);
    if (q === "clear") return save("", true);
    const t = new Date(), add = q === "tomorrow" ? 1 : q === "mon" ? (8 - t.getDay()) % 7 || 7 : 0;
    pickDay(ymd(new Date(t.getFullYear(), t.getMonth(), t.getDate() + add)));
  };
  const onTime = (e) => { const t = e.target.value; setTime(t); if (!t || /^\d{1,2}:\d{2}$/.test(t)) apply(sel, t, aoe); };
  const toggleAoe = () => { const a = !aoe; setAoe(a); apply(sel, time, a); };
  const info = sel ? dueInfo(value(sel, time, aoe)) : null;
  const status = info ? `${info.date}${info.local ? `（${info.local}）` : ""}` : "没选日期";
  return html`<div class="pk">
    <div class="pk-head"><span class="ttl">${month.getFullYear()} 年 ${month.getMonth() + 1} 月</span>
      <button class="pk-nav" title="上个月" onClick=${() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><${Chev} d="M10 3.5 5.5 8l4.5 4.5" /></button>
      <button class="pk-nav" title="下个月" onClick=${() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><${Chev} d="M6 3.5 10.5 8 6 12.5" /></button></div>
    <div class="pk-grid">
      ${[..."一二三四五六日"].map((w) => html`<div class="pk-dow" key=${w}>${w}</div>`)}
      ${monthCells(month).map((d) => {
        const k = ymd(d), cls = `pk-day ${d.getMonth() !== month.getMonth() ? "out" : ""} ${k === todayKey ? "today" : ""} ${k === sel ? "sel" : ""} ${has.has(k) ? "has" : ""}`;
        return html`<button class=${cls} key=${k} onClick=${() => pickDay(k)}>${d.getDate()}</button>`;
      })}
    </div>
    <div class="pk-foot">
      <button class="qbtn" onClick=${() => quick("today")}>今天</button><button class="qbtn" onClick=${() => quick("tomorrow")}>明天</button><button class="qbtn" onClick=${() => quick("mon")}>下周一</button>
      <span class="grow"></span><button class="qbtn dim" onClick=${() => quick("tbd")}>待定</button><button class="qbtn dim" onClick=${() => quick("clear")}>清除</button>
    </div>
    <div class="pk-extra"><span class="lbl">时间</span><input type="time" class="pk-time mono" value=${time} onInput=${onTime} /><span class="grow"></span>
      <button class=${`pk-toggle ${aoe ? "on" : ""}`} onClick=${toggleAoe}>AoE</button></div>
    <div class="pk-status"><span class="txt">${status}</span><button class="qbtn strong" onClick=${close}>完成</button></div>
  </div>`;
}
