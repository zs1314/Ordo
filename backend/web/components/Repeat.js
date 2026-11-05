import { html, useState } from "../vendor/preact-htm.js";
import { useBoard } from "./ctx.js";
import { Block, Md } from "./ui.js";
import { OPEN, SHORT } from "../lib/model.js";
import { StatusIcon, AgentFrame } from "./icons.js";
import { handedOff } from "../lib/motion.js";
import { ymd, WEEK } from "../lib/due.js";
import { repeatState, repeatLabel, weekOf, DAY_ORDER, agentActive } from "../lib/repeat.js";
import { cheer } from "../lib/fx/index.js";

// Check-ins: recurring items as a weekly table; clicking a cell checks in or undoes the check-in
export function RepeatBlock() {
  const { doc, act } = useBoard();
  const [off, setOff] = useState(0);
  const list = doc.items.filter((i) => i.repeat?.days?.length && OPEN.includes(i.status));
  if (!list.length) return null;
  const now = new Date(), week = weekOf(off, now), todayKey = ymd(now);
  let total = 0, got = 0;
  const rows = list.map((i) => {
    const done = new Set(i.doneDates ?? []), st = repeatState(i, now);
    const cells = week.map((d) => {
      const k = ymd(d), cls = `c ${k === todayKey ? "today" : ""}`;
      if (!i.repeat.days.includes(d.getDay())) return html`<div class=${cls} key=${k}><span class="dot off" title="这天不用做"><${StatusIcon} s="rest" /></span></div>`;
      // Cells of a round that has not started yet cannot be clicked (e.g. with the refresh time set to 12:00, today's cell
      // has not started yet in the morning)
      const isDone = done.has(k), future = k > st.key, miss = !isDone && k < st.key;
      total++; if (isDone) got++;
      const title = `${d.getMonth() + 1}月${d.getDate()}日 周${WEEK[d.getDay()]}：${isDone ? "做完了" : future ? "还没到" : miss ? "没打卡" : "还没打卡"}`;
      return html`<div class=${cls} key=${k}><button class=${`dot ${isDone ? "done" : ""} ${future ? "future" : ""} ${miss ? "miss" : ""}`}
        disabled=${future} title=${title} onClick=${(e) => { if (!isDone) cheer(doc.theme, e.currentTarget); act.item(i.id).check(k, !isDone); }}>${isDone ? html`<${StatusIcon} s="done" />` : null}</button></div>`;
    });
    return [
      html`<div class="nm" key=${`${i.id}:n`}><div class="t"><${Md} text=${i.title} /></div><div class="r">${st.label}</div>${st.streak ? html`<div class="st-inline">连续 ${st.streak} ${st.unit}</div>` : null}</div>`,
      ...cells,
      html`<div class="st" key=${`${i.id}:s`}>${st.streak ? `连续 ${st.streak} ${st.unit}` : ""}</div>`,
    ];
  });
  const a = week[0], b = week[6];
  return html`<${Block} id="b-repeat" title="打卡"><div class="card">
    <div class="cal-head"><span class="ttl">${a.getMonth() + 1}月${a.getDate()}日 – ${b.getMonth() + 1}月${b.getDate()}日</span>
      <button class="tool" title="上一周" onClick=${() => setOff(off - 1)}>‹</button>
      <button class="tool" onClick=${() => setOff(0)}>本周</button>
      <button class="tool" title="下一周" onClick=${() => setOff(off + 1)}>›</button>
      <span class="sum">${off === 0 ? "这周" : "那周"}打了 ${got}/${total}</span>
    </div>
    <div class="hab">
      <div class="hd blank"></div>
      ${week.map((d) => html`<div class=${`hd ${ymd(d) === todayKey ? "today" : ""}`} key=${ymd(d)}>${WEEK[d.getDay()]}<b>${d.getDate()}</b></div>`)}
      <div class="hd blank"></div>
      ${rows}
    </div>
  </div><//>`;
}

// The pill to the left of a recurring item: shows today's state, one click checks in or undoes the check-in; on a day it
// is not scheduled it opens the menu
export function RepeatPill({ item: i }) {
  const { doc, act, openPop } = useBoard();
  const st = repeatState(i), open = OPEN.includes(i.status);
  const onClick = (e) => {
    if (!open || !st.scheduled) return openPop("status", i.id, e.currentTarget);
    if (!st.done) cheer(doc.theme, e.currentTarget);
    act.item(i.id).check(st.key, !st.done, st.done ? "取消了今天的打卡" : "打卡了");
  };
  const [icon, text, cls, title] = !open ? [i.status, SHORT[i.status], i.status, null]
    : !st.scheduled ? ["rest", "今天休息", "rest", "今天不用做"]
    : st.done ? ["done", "今天做完", "on", "取消今天的打卡"]
    : ["todo", "今天要做", "", "打卡"];
  // With an agent: a dashed frame, travelling while the agent is running today (not once today is done, or on a day off)
  const agent = i.status === "agent" && cls !== "on", run = agent && agentActive(i), handoff = run && handedOff(i.id);
  return html`<button class=${`pill routine ${cls} ${agent ? "agentish" : ""} ${run ? "run" : ""} ${handoff ? "handoff" : ""}`} data-id=${i.id} data-pop-anchor title=${title} aria-label=${text} onClick=${onClick}><${StatusIcon} s=${icon} />${agent ? html`<${AgentFrame} handoff=${handoff} />` : null}<span class="lbl">${text}</span></button>`;
}

// The repeat part of an item's meta line, e.g. "↻ weekdays 11:00   3 in a row"
export function RepeatBadge({ item: i }) {
  const { openPop } = useBoard();
  const st = repeatState(i);
  if (!st) return null;
  const label = html`<span class="rep" data-pop-anchor title="改重复" onClick=${(e) => openPop("repeat", i.id, e.currentTarget)}>↻ ${st.label}</span>`;
  if (!OPEN.includes(i.status)) return label;
  return html`${label}${st.streak > 1 ? html`<span class="rep-note">连续 ${st.streak} ${st.unit}</span>` : null}`;
}

// Repeat editor: daily, weekdays, or pick the days of the week; a time of day can be set. Every change is saved right away
export function RepeatEditor({ item, close }) {
  const { act } = useBoard();
  const [days, setDays] = useState(() => new Set(item.repeat?.days ?? []));
  const [time, setTime] = useState(item.repeat?.time ?? "");
  const save = (d, t) => act.item(item.id).patch({ repeat: d.size ? { days: [...d], time: t } : null }, null, { quiet: true });
  const set = (d) => { setDays(d); save(d, time); };
  const toggle = (d) => { const n = new Set(days); if (n.has(d)) n.delete(d); else n.add(d); set(n); };
  const onTime = (e) => { const t = e.target.value; setTime(t); if (days.size && (!t || /^\d{1,2}:\d{2}$/.test(t))) save(days, t); };
  const key = [...days].sort().join(",");
  const label = days.size ? repeatLabel({ days: [...days], time }) : "不重复";
  return html`<div class="rp">
    <div class="rp-title">重复</div>
    <div class="rp-presets">
      <button class=${`pk-toggle ${days.size === 7 ? "on" : ""}`} onClick=${() => set(new Set([0, 1, 2, 3, 4, 5, 6]))}>每天</button>
      <button class=${`pk-toggle ${key === "1,2,3,4,5" ? "on" : ""}`} onClick=${() => set(new Set([1, 2, 3, 4, 5]))}>工作日</button>
      <span class="grow"></span>
      <button class="qbtn dim" onClick=${() => set(new Set())}>不重复</button>
    </div>
    <div class="rp-days">${DAY_ORDER.map((d) => html`<button key=${d} class=${`rp-day ${days.has(d) ? "on" : ""}`} onClick=${() => toggle(d)}>${WEEK[d]}</button>`)}</div>
    <div class="pk-extra"><span class="lbl">几点刷新</span><input type="time" class="pk-time mono" value=${time} onInput=${onTime} /></div>
    <div class="pk-status"><span class="txt">${label}</span><button class="qbtn strong" onClick=${close}>完成</button></div>
  </div>`;
}
