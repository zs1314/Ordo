import { html, useRef, useLayoutEffect } from "../vendor/preact-htm.js";
import { useBoard } from "./ctx.js";
import { Block, Md } from "./ui.js";
import { ItemForm } from "./Item.js";
import { groupOf } from "../lib/model.js";
import { ago, dur, hoursSince } from "../lib/time.js";
import { repeatState, agentActive } from "../lib/repeat.js";
import { agentColsOf } from "../lib/theme.js";
import { reducedMotion, handedOff } from "../lib/motion.js";
import { leaveCard } from "../lib/fx/index.js";
import { Seg } from "./controls.js";

// Items handed off to an agent, least recently checked first. Laid out in one, two or three columns (chosen in settings;
// during layout editing it can also be switched next to the heading).
// A recurring item that is done for today (or not scheduled today) is left out until the next day it is due
export function AgentBlock() {
  const { doc, ui } = useBoard();
  const stale = doc.settings?.staleHours ?? 3, cols = agentColsOf(doc.theme);
  const list = doc.items.filter((i) => agentActive(i)).sort((a, b) => (a.agent?.lastSeen ?? "").localeCompare(b.agent?.lastSeen ?? ""));
  const grid = useSlide();
  const side = html`<h2>Agent</h2>${ui.editMode ? html`<${Seg} k="agentCols" cur=${cols} opts=${[[1, "一列"], [2, "两列"], [3, "三列"]]} />` : null}`;
  return html`<${Block} id="b-agent" toc="Agent" side=${side}>
    ${list.length ? html`<div class="agent-wrap"><div class=${`agent-grid cols-${cols}`} ref=${grid}>${list.map((i) => html`<${AgentCard} key=${i.id} item=${i} stale=${stale} />`)}</div></div>`
      : html`<div class="card"><div class="none" style="padding:0">现在没有挂在 Agent 上的事。</div></div>`}
  <//>`;
}

// When a card leaves or arrives (an item is done, a new one is handed off, the editor opens), the remaining cards slide from
// their old positions to the new ones instead of jumping
function useSlide() {
  const ref = useRef(null), last = useRef(null);
  useLayoutEffect(() => {
    const g = ref.current;
    const cards = g ? [...g.children].filter((n) => n.dataset.agentCard) : [];
    const gr = g?.getBoundingClientRect();
    const pos = new Map(cards.map((n) => { const r = n.getBoundingClientRect(); return [n.dataset.agentCard, [r.left - gr.left, r.top - gr.top]]; }));
    const prev = last.current;
    last.current = pos;
    if (!prev || reducedMotion() || [...prev.keys()].join() === [...pos.keys()].join()) return;
    for (const n of cards) {
      const a = prev.get(n.dataset.agentCard), b = pos.get(n.dataset.agentCard);
      if (!a || (a[0] === b[0] && a[1] === b[1])) continue;
      n.animate([{ transform: `translate(${a[0] - b[0]}px, ${a[1] - b[1]}px)` }, { transform: "none" }], { duration: 460, easing: "cubic-bezier(.22, 1, .36, 1)" });
    }
  });
  return ref;
}

function AgentCard({ item: i, stale }) {
  const { doc, ui, setUi, act, openPop } = useBoard();
  const ref = useRef(null); // hooks must come before the early return
  if (ui.editing === `i:${i.id}@agent`) return html`<div class="card wide"><${ItemForm} item=${i} /></div>`;
  const a = i.agent || {}, g = groupOf(doc, i.group), it = act.item(i.id), st = repeatState(i);
  // Done, or today's check-in for a recurring item: play the completion effect chosen in settings and let this card leave the
  // Agent block (in its own card the item is struck through and slides down)
  const done = (e) => leaveCard(ref.current, e.currentTarget, doc.theme, () => (st ? it.check(st.key, true, "打卡了") : it.patch({ status: "done" })));
  // Just handed off: the card rises into its place (the others slide aside, useSlide)
  return html`<div class=${`card agent ${handedOff(i.id) ? "arrive" : ""}`} data-agent-card=${i.id} ref=${ref}>
    <h3><${Md} text=${i.title} /></h3>
    <div class="where">挂在 <${Md} text=${a.where || "没写"} />${g ? ` · ${g.title}` : ""}</div>
    <div class="when">挂了 ${dur(a.since)}　上次看 ${ago(a.lastSeen)}${hoursSince(a.lastSeen) > stale ? html`<span class="stale">${dur(a.lastSeen)}没看了</span>` : null}</div>
    ${a.note ? html`<div class="note"><${Md} text=${a.note} /></div>` : null}
    <div class="row">
      <button class="btn dark" onClick=${() => it.patch({ seen: true }, "记下了")}>看过了</button>
      <button class="btn" onClick=${done}>${st ? "✓ 今天做完了" : "✓ 做完了"}</button>
      <button class="btn b-back" onClick=${() => it.patch({ status: "doing" })}>收回来自己做</button>
      <button class="btn b-edit" onClick=${() => setUi({ editing: `i:${i.id}@agent`, adding: null })}>编辑</button>
      <button class="btn b-more" title="更多" data-pop-anchor onClick=${(e) => openPop("status", i.id, e.currentTarget, { from: "agent" })}>⋯</button>
    </div>
  </div>`;
}
