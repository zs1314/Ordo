import { html } from "../vendor/preact-htm.js";
import { useBoard } from "./ctx.js";
import { Block, Md, AutoText, AddInline, FormActions, MoveTools, useForm, useAutoFocus, onEnter } from "./ui.js";
import { GroupCard } from "./Group.js";
import { CanvasSide } from "./Canvas.js";
import { OPEN, sections, groupsOf } from "../lib/model.js";
import { closedModeOf, splitClosed } from "../lib/done.js";

/** Which sections the page shows: hidden ones appear only during layout editing. A section whose items are all closed is
 *  shown as usual in the "all" mode, and in the "recent" mode only if something was done in the last few days; it is also
 *  shown while one of its items is being edited or was just located from the calendar or "recently done" */
export function shownSections(doc, ui) {
  return sections(doc).filter((s) => {
    if (ui.editMode) return true;
    if (s.hidden) return false;
    const gids = new Set(groupsOf(doc, s.id).map((g) => g.id));
    const items = doc.items.filter((i) => gids.has(i.group));
    if (!items.length || items.some((i) => OPEN.includes(i.status))) return true;
    const want = [/^i:([^@]+)$/.exec(ui.editing ?? "")?.[1], ui.locate?.id].filter(Boolean);
    if (items.some((i) => want.includes(i.id))) return true;
    const mode = closedModeOf(doc.theme);
    return mode === "all" || (mode === "recent" && splitClosed(items, doc.theme).recent.length > 0);
  });
}

// A section of the page (work, life, ...): the heading on the left, its cards on the right
export function SectionBlock({ section: s }) {
  const { doc, ui, setUi, act } = useBoard();
  const gs = groupsOf(doc, s.id), sec = act.section(s.id);
  const tools = ui.editMode ? html`<div class="tools" style="visibility:visible">
    <${MoveTools} onMove=${sec.move} />
    <button class="tool" title="改名字" onClick=${() => setUi({ editing: `s:${s.id}`, adding: null })}>✎</button>
    <button class="tool" title=${s.hidden ? "重新显示" : "隐藏这一块"} onClick=${() => sec.patch({ hidden: !s.hidden }, s.hidden ? "又显示出来了" : "隐藏了")}>${s.hidden ? "显示" : "隐藏"}</button>
  </div>` : null;
  // While the section is being edited, the form takes the place of the cards on the right, as wide as the card and item
  // editors
  const editing = ui.editing === `s:${s.id}`;
  // If the Canvas assignments go into this section, the sync button sits under the heading
  const canvas = gs.some((g) => g.id === doc.settings?.canvasGroup);
  const side = html`<h2>${s.title}</h2>${s.sub ? html`<div class="sub"><${Md} text=${s.sub} /></div>` : null}${canvas && !editing ? html`<${CanvasSide} />` : null}${editing ? null : tools}`;
  return html`<${Block} id=${`b-s-${s.id}`} toc=${s.title} side=${side} cls=${s.hidden ? "is-hidden" : ""}>
    ${editing ? html`<${SectionForm} section=${s} />`
      : s.note ? html`<div class="card"><p class="desc" style="margin:0"><${Md} text=${s.note} /></p></div>` : null}
    ${gs.map((g, k) => html`<${GroupCard} key=${g.id} group=${g} single=${gs.length === 1} no=${gs.length > 1 ? k + 1 : 0} />`)}
    ${gs.length ? null : html`<div class="card"><div class="none" style="padding:0">这一块还没有卡片。</div></div>`}
    ${ui.editMode ? html`<${AddInline} id=${`g:${s.id}`} look="card" label="＋ 加一张卡片" placeholder="新卡片的标题"
      onSubmit=${(title) => act.addGroup({ section: s.id, title })} />` : null}
  <//>`;
}

function SectionForm({ section: s }) {
  const { doc, act } = useBoard();
  const { f, bind } = useForm({ title: s.title, sub: s.sub ?? "", note: s.note ?? "" });
  const first = useAutoFocus(), sec = act.section(s.id);
  const save = () => f.title.trim() && sec.patch({ title: f.title.trim(), sub: f.sub.trim(), note: f.note.trim() }, null, { close: true });
  const del = () => {
    const gids = new Set(groupsOf(doc, s.id).map((g) => g.id)), n = doc.items.filter((i) => gids.has(i.group)).length;
    if (confirm(n ? `这一块里有 ${n} 条，会一起删掉。确定？` : "删掉这一块？")) sec.remove({ force: true, close: true });
  };
  return html`<div class="card"><div class="form">
    <input class="input" ref=${first} ...${bind("title")} onKeyDown=${onEnter(save)} placeholder="名字" />
    <label>小字说明</label>
    <${AutoText} ...${bind("sub")} />
    <label>最上面的一段话</label>
    <${AutoText} ...${bind("note")} />
    <${FormActions} onSave=${save} onDelete=${del} deleteLabel="删除这一块" />
  </div></div>`;
}

// During layout editing, the "add a new section" button at the very bottom of the page
export function AddSection() {
  const { act } = useBoard();
  return html`<div class="addblock"><${AddInline} id="s" look="card" wide label="＋ 加一块新的分区" placeholder="新分区的名字"
    onSubmit=${(title) => act.addSection({ title })} /></div>`;
}
