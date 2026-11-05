import { html, useState, useRef } from "../vendor/preact-htm.js";
import { useBoard } from "./ctx.js";
import { MoveTools } from "./ui.js";
import { Field, Seg, Toggle, Text, Range } from "./controls.js";
import { PlacesEditor } from "./Places.js";
import { CanvasSettings } from "./Canvas.js";
import { CHARTS, chartById } from "./done/index.js";
import { HEROES, heroById } from "../lib/heroes/index.js";
import { closedModeOf, recentDaysOf } from "../lib/done.js";
import { agentColsOf } from "../lib/theme.js";
import { fxOptions, fxOf, preview } from "../lib/fx/index.js";
import { sections } from "../lib/model.js";

// The settings drawer that slides in from the right: appearance, effects, reminders, Canvas, places, section order,
// custom CSS.
// Changes are saved right away (a Range once it stops moving)
export function Settings({ shown }) {
  const { doc, setUi, act } = useBoard();
  const t = doc.theme || {};
  const close = () => setUi({ settings: false });
  return html`<div class=${`drawer-mask ${shown ? "on" : ""}`} onClick=${close}></div>
  <aside class=${`drawer ${shown ? "on" : ""}`}>
    <div class="drawer-head"><h2>设置</h2><span class="grow"></span><button class="tbtn" onClick=${close}>关闭</button></div>
    <h4>外观</h4>
    <${Field} label="标题"><${Text} k="title" value=${t.title} /><//>
    <${Field} label="明暗"><${Seg} k="mode" cur=${t.mode} opts=${[["auto", "跟随系统"], ["light", "亮"], ["dark", "暗"]]} /><//>
    <${Field} label="字体"><${Seg} k="font" cur=${["default", "system"].includes(t.font) ? t.font : ""} opts=${[["default", "默认"], ["system", "系统"]]} /><//>
    <${Field} label=""><${Text} k="font" value=${["default", "system"].includes(t.font) ? "" : t.font} placeholder="其他字体" /><//>
    <${Field} label="字号"><${Range} k="fontSize" min=${13} max=${18} step=${0.5} value=${t.fontSize ?? 15} unit="px" cssVar="--fs" /><//>
    <${Field} label="页面宽度"><${Range} k="width" min=${760} max=${1600} step=${20} value=${t.width ?? 1040} unit="" cssVar="--width" /><//>
    <${Field} label="圆角"><${Range} k="radius" min=${0} max=${24} step=${1} value=${t.radius ?? 12} unit="px" cssVar="--radius" /><//>
    <${Field} label="密度"><${Seg} k="density" cur=${t.density} opts=${[["comfortable", "宽松"], ["compact", "紧凑"]]} /><//>
    <${Field} label="排版"><${Seg} k="layout" cur=${t.layout} opts=${[["sidebar", "左标题右卡片"], ["stacked", "标题在上"]]} /><//>
    <${Field} label="Agent 排列"><${Seg} k="agentCols" cur=${agentColsOf(t)} opts=${[[1, "一列"], [2, "两列"], [3, "三列"]]} /><//>
    <${Field} label="头图"><${Toggle} k="hero" value=${t.hero} /><//>
    <${Field} label="头图样式"><select class="input" value=${heroById(t.heroStyle).id} onChange=${(e) => act.theme({ heroStyle: e.target.value })}>
      ${HEROES.map((x) => html`<option key=${x.id} value=${x.id}>${x.name}</option>`)}
    </select><//>
    <${Field} label="头图高度"><${Range} k="heroHeight" min=${140} max=${360} step=${10} value=${t.heroHeight ?? 220} unit="px" cssVar="--hero-h" /><//>
    <${Field} label="概览数字"><${Toggle} k="showStats" value=${t.showStats} /><//>
    <${Field} label="打卡"><${Toggle} k="showRepeat" value=${t.showRepeat} /><//>
    <${Field} label="日历"><${Toggle} k="showCalendar" value=${t.showCalendar} /><//>
    <${Field} label="目录"><${Toggle} k="showToc" value=${t.showToc} /><//>
    <${Field} label="最近做完"><${Toggle} k="showDone" value=${t.showDone} /><//>
    ${t.showDone !== false ? html`<${Field} label="最近做完的图"><${Seg} k="doneChart" cur=${chartById(t.doneChart).id} opts=${CHARTS.map((c) => [c.id, c.name])} /><//>` : null}
    <${Field} label="做完的"><${Seg} k="closedMode" cur=${closedModeOf(t)} opts=${[["none", "不显示"], ["recent", "最近"], ["all", "全部"]]} /><//>
    ${closedModeOf(t) === "recent" ? html`<${Field} label="留几天"><${Seg} k="recentDays" cur=${recentDaysOf(t)} opts=${[[1, "1 天"], [3, "3 天"], [7, "7 天"]]} /><//>` : null}
    <${Field} label="强调色" cls="accent-field"><${AccentPicker} value=${t.accent} /><//>
    <h4>效果</h4>
    <${Field} label="Agent 做完时" cls="chips-field"><${FxChips} kind="agent" k="agentFx" cur=${fxOf(t, "agent")} /><//>
    <${Field} label="打卡时" cls="chips-field"><${FxChips} kind="check" k="checkFx" cur=${fxOf(t, "check")} /><//>
    <h4>提醒</h4>
    <${Field} label="多久没看算久"><${Range} k="staleHours" min=${1} max=${24} step=${1} value=${doc.settings?.staleHours ?? 3} unit="h" to="settings" /><//>
    <${CanvasSettings} />
    <h4>Agent 挂在哪</h4>
    <${PlacesEditor} />
    <h4>分区</h4>
    <${SectionList} />
    <div class="row" style="margin-top:10px"><button class="btn" onClick=${() => setUi({ settings: false, editMode: true })}>编辑布局</button></div>
    <h4>自定义 CSS</h4>
    <${CustomCss} value=${t.customCss} />
  </aside>`;
}

// Completion effect: clicking one selects it and plays it right here
function FxChips({ kind, k, cur }) {
  const { act } = useBoard();
  const row = useRef(null);
  const choose = (id, e) => { if (id !== cur) act.theme({ [k]: id }); preview(kind, id, row.current, e.currentTarget); };
  return html`<span class="chips" ref=${row}>${fxOptions(kind).map(([id, name]) => html`<button key=${id} class=${`chip ${cur === id ? "on" : ""}`} onClick=${(e) => choose(id, e)}>${name}</button>`)}</span>`;
}

// Accent color: a few presets, or type any color
const ACCENTS = ["", "hsl(200 29% 45%)", "hsl(262 32% 52%)", "hsl(150 25% 38%)", "hsl(14 70% 50%)"];
function AccentPicker({ value = "" }) {
  const { act } = useBoard();
  return html`<span class="accents">
    ${ACCENTS.map((c) => html`<button key=${c} class=${`swatch ${value === c ? "on" : ""}`} title=${c || "黑白"} style=${{ background: c || "hsl(var(--foreground))" }} onClick=${() => act.theme({ accent: c })}></button>`)}
    <${Text} k="accent" value=${value} placeholder="其他颜色" />
  </span>`;
}

// Section order, and show / hide
function SectionList() {
  const { doc, act } = useBoard();
  return sections(doc).map((s) => html`<div key=${s.id} class=${`secrow ${s.hidden ? "hid" : ""}`}><span class="nm">${s.title}</span>
    <${MoveTools} onMove=${act.section(s.id).move} />
    <button class="tool" onClick=${() => act.section(s.id).patch({ hidden: !s.hidden })}>${s.hidden ? "显示" : "隐藏"}</button></div>`);
}

// Custom CSS: saved only on Save; "reset appearance" resets only the appearance and leaves the content alone
function CustomCss({ value = "" }) {
  const { act } = useBoard();
  const [css, setCss] = useState(value);
  return html`<textarea class="input mono css-edit" rows="7" placeholder=".card { border-width: 2px }" value=${css} onInput=${(e) => setCss(e.target.value)}></textarea>
    <div class="row">
      <button class="btn dark" onClick=${() => act.theme({ customCss: css }, "CSS 已保存")}>保存 CSS</button><span class="grow"></span>
      <button class="btn danger" onClick=${() => confirm("外观恢复默认？") && act.theme({ reset: true }, "恢复默认了")}>外观恢复默认</button>
    </div>`;
}
