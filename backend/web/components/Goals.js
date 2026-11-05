import { html } from "../vendor/preact-htm.js";
import { useBoard } from "./ctx.js";
import { Block, Md, AutoText, FormActions, useForm } from "./ui.js";

// Yearly goals, one per line; editable during layout editing (the title is the big heading on the left)
export function Goals() {
  const { doc, ui, setUi } = useBoard();
  const goals = doc.extras?.yearGoals ?? [];
  if (!goals.length && !ui.editMode) return null;
  const title = doc.extras?.yearGoalsTitle?.trim() || "年度目标";
  if (ui.editing === "goals") return html`<${Block} id="b-goals" title=${title}><${GoalsForm} /><//>`;
  return html`<${Block} id="b-goals" title=${title}>
    <div class="card">
      ${goals.length ? html`<ul class="goals">${goals.map((x, i) => html`<li key=${i}><${Md} text=${x} /></li>`)}</ul>` : html`<div class="none" style="padding:0">还没有写。</div>`}
      ${ui.editMode ? html`<div class="add"><button class="addlink" onClick=${() => setUi({ editing: "goals" })}>✎ 改年度目标</button></div>` : null}
    </div>
  <//>`;
}

function GoalsForm() {
  const { doc, act } = useBoard();
  const { f, bind } = useForm({ title: doc.extras?.yearGoalsTitle ?? "", text: (doc.extras?.yearGoals ?? []).join("\n") });
  const save = () => act.extras({ yearGoalsTitle: f.title.trim(), yearGoals: f.text.split("\n") }, { close: true });
  return html`<div class="card form">
    <input class="input" ...${bind("title")} placeholder="标题" />
    <${AutoText} minRows=${6} ...${bind("text")} placeholder="目标" />
    <${FormActions} onSave=${save} />
  </div>`;
}
