import { html } from "../vendor/preact-htm.js";
import { useBoard } from "./ctx.js";
import { Block } from "./ui.js";
import { LABEL } from "../lib/model.js";
import { StatusIcon } from "./icons.js";
import { agentActive } from "../lib/repeat.js";

// Overview: how many items are in doing, agent, waiting and to do
export function Overview() {
  const { doc } = useBoard();
  // Agent counts only items actually running today: a recurring item done for today does not count
  const count = (s) => doc.items.filter((i) => (s === "agent" ? agentActive(i) : i.status === s)).length;
  return html`<${Block} id="b-overview" title="概览">
    <div class="stats">${["doing", "agent", "waiting", "todo"].map((s) => html`<div class="card stat" key=${s}>
      <div class="ic"><${StatusIcon} s=${s} /></div><div class="n">${count(s)}</div><div class="l">${LABEL[s]}</div>
    </div>`)}</div>
  <//>`;
}
