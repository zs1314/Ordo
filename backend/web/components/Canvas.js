import { html, useEffect, useState } from "../vendor/preact-htm.js";
import { useBoard } from "./ctx.js";
import { api } from "../lib/api.js";
import { ago } from "../lib/time.js";
import { allCards, cardPath } from "../lib/model.js";
import { SyncIcon, WarnIcon } from "./icons.js";

// Canvas sync for assignments. The button only asks the board server to run canvas-sync.mjs once; reading Canvas and
// changing the board both happen on the server. One button sits under the section heading and one in the settings drawer;
// they share this state (store), so both spin while syncing and both update when it finishes

const store = { st: null, busy: false, subs: new Set() };
const emit = () => store.subs.forEach((f) => f({ st: store.st, busy: store.busy }));
async function refresh() {
  try { store.st = await api("GET", "/api/canvas"); } catch {}
  emit();
}
addEventListener("focus", () => { if (store.subs.size && !store.busy) refresh(); });

function resultText(r) {
  const parts = [];
  if (r.added?.length) parts.push(`新增 ${r.added.length} 条`);
  if (r.updated?.length) parts.push(`更新 ${r.updated.length} 条`);
  if (r.done?.length) parts.push(`${r.done.length} 条已提交`);
  if (r.conflicts?.length) parts.push(`${r.conflicts.length} 处你改过，没覆盖`);
  if (r.failedCourses?.length) parts.push(`${r.failedCourses.length} 门课没拉到`);
  return `Canvas：${parts.length ? parts.join("，") : "没有变化"}`;
}

function useCanvasSync() {
  const { reload, toast } = useBoard();
  const [s, setS] = useState({ st: store.st, busy: store.busy });
  useEffect(() => {
    store.subs.add(setS);
    if (!store.st) refresh();
    return () => store.subs.delete(setS);
  }, []);
  const run = async () => {
    if (store.busy) return;
    store.busy = true;
    emit();
    try { toast(resultText(await api("POST", "/api/canvas/sync"))); } catch (e) { toast(`Canvas 没同步上：${e.message}`); }
    store.busy = false;
    await refresh();
    await reload(true);
  };
  return { ...s, run };
}

// When the last sync happened and what did not match; the details are in hover tooltips
function Status({ st }) {
  if (!st) return null;
  const lines = [], r = st.ok === false ? null : st.result;
  if (st.lastSuccess) lines.push(html`<div>${ago(st.lastSuccess)}同步</div>`);
  else if (!st.lastAttempt) lines.push(html`<div>还没同步过</div>`);
  if (st.ok === false) lines.push(html`<div class="warn"><${WarnIcon} />没同步上：${st.error}</div>`);
  if (r?.failedCourses?.length) {
    const names = r.failedCourses.map((c) => c.name);
    lines.push(html`<div class="warn" title=${r.failedCourses.map((c) => `${c.name}：${c.error}`).join("\n")}><${WarnIcon} />${names.length > 2 ? `${names.length} 门课` : names.join("、")}没拉到</div>`);
  }
  if (r?.conflicts?.length) lines.push(html`<div title=${r.conflicts.map((c) => `${c.title}：${c.field}，Canvas 上是 ${c.canvas}`).join("\n")}>${r.conflicts.length} 处你改过，没覆盖</div>`);
  if (r?.gone?.length) lines.push(html`<div title=${r.gone.map((x) => x.title).join("\n")}>${r.gone.length} 条 Canvas 上找不到了</div>`);
  return html`<div class="csync-st">${lines}</div>`;
}

// The sync control in the section that holds the assignments, under its heading on the left
export function CanvasSide() {
  const { st, busy, run } = useCanvasSync();
  return html`<div class="csync">
    <button class=${`csync-btn ${busy ? "busy" : ""}`} disabled=${busy} onClick=${run}><${SyncIcon} />${busy ? "同步中" : "同步 Canvas"}</button>
    <${Status} st=${st} />
  </div>`;
}

// In settings: which card the assignments go to, and the same sync button (for when that card does not exist yet)
export function CanvasSettings() {
  const { doc, act } = useBoard();
  const { st, busy, run } = useCanvasSync();
  const cards = allCards(doc), cur = doc.settings?.canvasGroup ?? "";
  return html`<h4>Canvas</h4>
    <div class="field"><span>作业放在</span>
      <select class="input" value=${cards.some((g) => g.id === cur) ? cur : ""} onChange=${(e) => act.settings({ canvasGroup: e.target.value })}>
        <option value="">自动（课程）</option>
        ${cards.map((g) => html`<option key=${g.id} value=${g.id}>${cardPath(doc, g)}</option>`)}
      </select></div>
    <div class="field csync-field"><span>同步</span><div>
      <button class=${`btn ${busy ? "busy" : ""}`} disabled=${busy} onClick=${run}><${SyncIcon} />${busy ? "同步中" : "现在同步"}</button>
      <${Status} st=${st} />
    </div></div>`;
}
