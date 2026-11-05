import { html, useState, useEffect, useRef } from "../vendor/preact-htm.js";
import { Ctx } from "./ctx.js";
import { useDoc } from "./useDoc.js";
import { actions } from "../lib/api.js";
import { applyTheme } from "../lib/theme.js";
import { usePresence, useLingering, anchorAt, isPhone } from "./ui.js";
import { reducedMotion } from "../lib/motion.js";
import { Header } from "./Header.js";
import { Hero } from "./Hero.js";
import { Overview } from "./Overview.js";
import { AgentBlock } from "./AgentBlock.js";
import { RepeatBlock } from "./Repeat.js";
import { CalendarBlock } from "./Calendar.js";
import { SectionBlock, AddSection, shownSections } from "./Section.js";
import { DoneBlock } from "./Done.js";
import { Goals } from "./Goals.js";
import { Toc } from "./Toc.js";
import { Settings } from "./Settings.js";
import { Popover } from "./Popover.js";

// The whole board: the data (useDoc), transient page state (ui, the open popover, the toast at the bottom) and the blocks
// from top to bottom. These reach the components through Ctx (see ctx.js for what each one is)
export function App() {
  const [ui, setUiState] = useState({ editMode: false, editing: null, adding: null, settings: false, locate: null });
  const [pop, setPop] = useState(null);
  // A closed popover stays a moment longer to animate out (the menu fades, the sheet slides down); it cannot be clicked then
  const [shownPop, popLeaving] = useLingering(pop, reducedMotion() ? 0 : 220);
  const [drawerOn, drawerShown] = usePresence(!!ui.settings, 300);
  const busy = !!(ui.editing || ui.adding || pop || ui.settings);
  const { doc, err, reload, save } = useDoc(busy);
  const [toastMsg, toast] = useToast();

  const setUi = (patch) => setUiState((u) => ({ ...u, ...(typeof patch === "function" ? patch(u) : patch) }));
  // Every change goes through here: on success the whole new document is swapped in and the popover closes (except with
  // quiet: the date picker and the repeat editor save while editing). The editor closes only when it saves or deletes itself
  // (close); other changes leave it alone, so clicking a button elsewhere does not lose what is being typed
  const call = async (method, path, body, okMsg, { quiet = false, close = false } = {}) => {
    try {
      await save(method, path, body);
      if (!quiet) setPop(null);
      if (close) setUi({ editing: null });
      if (okMsg) toast(okMsg);
      return true;
    } catch (e) { toast(e.message); return false; }
  };
  // Opens a popover, or closes it if the same one is already open (the status menu's follow-up question counts as the status
  // menu; the date picker for the editor and the one for an item do not count as the same)
  const openPop = (kind, id, el, extra = {}) => {
    const at = anchorAt(el);
    setPop((p) => {
      const same = p && p.id === id && !!p.onPick === !!extra.onPick && (p.kind === kind || (kind === "status" && p.kind === "ask"));
      return same ? null : { kind, id, ...at, ...extra };
    });
  };
  const locate = (id) => { setPop(null); setUi((u) => ({ locate: { id, n: (u.locate?.n ?? 0) + 1 } })); };

  useEffect(() => { if (doc) applyTheme(doc.theme, { demo: doc.demo }); }, [doc?.theme]);
  useEffect(() => {
    const command = e => {
      if (e.detail === 'settings') setUi({ settings: true });
      if (e.detail === 'new') {
        if (ui.editing || ui.adding) { document.querySelector('.form input, .add input')?.focus(); return; }
        const group = doc?.groups.find(g => !doc.sections.find(s => s.id === g.section)?.hidden);
        if (group) { setPop(null); setUi({ adding: `i:${group.id}`, settings: false }); window.scrollTo({ top: 0, behavior: 'smooth' }); }
        else { setUi({ editMode: true }); toast('先添加一个分区，再记录待办'); }
      }
    };
    window.addEventListener('ordo-command', command);
    return () => window.removeEventListener('ordo-command', command);
  }, [doc, ui.editing, ui.adding]);
  usePageState(ui, pop);
  useEscapeAndOutside({ pop, setPop, ui, setUi });

  if (!doc) return html`<main><div class="container"><div class="card" style="margin-top:40px">${err ? `读不到数据：${err}` : "加载中……"}</div></div></main>`;
  const t = doc.theme || {};
  const ctx = { doc, ui, setUi, call, act: actions(call), toast, reload, pop, setPop, openPop, locate };
  return html`<${Ctx.Provider} value=${ctx}>
    <${Header} />
    ${t.hero !== false ? html`<div class="container"><${Hero} theme=${t} /></div>` : null}
    <main><div class="container">
      ${t.showStats !== false ? html`<${Overview} />` : null}
      <${AgentBlock} />
      ${t.showRepeat !== false ? html`<${RepeatBlock} />` : null}
      ${t.showCalendar !== false ? html`<${CalendarBlock} />` : null}
      ${shownSections(doc, ui).map((s) => html`<${SectionBlock} key=${s.id} section=${s} />`)}
      ${ui.editMode ? html`<${AddSection} />` : null}
      ${t.showDone !== false ? html`<${DoneBlock} />` : null}
      <${Goals} />
    </div></main>
    ${t.showToc !== false ? html`<${Toc} />` : null}
    ${drawerOn ? html`<${Settings} shown=${drawerShown} />` : null}
    ${shownPop ? html`<${Ctx.Provider} value=${{ ...ctx, pop: shownPop }}><${Popover} key=${popKey(shownPop)} leaving=${popLeaving} /><//>` : null}
    <div class=${`toast ${toastMsg ? "show" : ""}`}>${toastMsg}</div>
  <//>`;
}

// The status menu and its follow-up question are one popover, so going from one to the other morphs the same box (the
// date picker and the repeat editor opened from the menu too); another item, or another kind opened directly, is a new one
const popKey = (p) => `${p.id ?? "form"}:${p.onPick ? "pick" : ""}`;

// A line at the bottom (toast) that disappears by itself after 1.8 s
function useToast() {
  const [msg, setMsg] = useState(null), timer = useRef(0);
  const toast = (m) => { setMsg(m); clearTimeout(timer.current); timer.current = setTimeout(() => setMsg(null), 1800); };
  return [msg, toast];
}

// Written on <html> for the stylesheet: data-editing="1" during layout editing; on phones, the lock class while the settings
// drawer or a bottom sheet is open, so the page behind does not scroll
function usePageState(ui, pop) {
  useEffect(() => { document.documentElement.dataset.editing = ui.editMode ? "1" : "0"; }, [ui.editMode]);
  useEffect(() => { document.documentElement.classList.toggle("lock", !!(ui.settings || pop) && isPhone()); }, [ui.settings, !!pop]);
}

// Esc backs out one layer at a time (popover → settings drawer → editor → located item); a click outside closes the popover
// and clears the located item
function useEscapeAndOutside({ pop, setPop, ui, setUi }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (pop) return setPop(null);
      if (ui.settings) return setUi({ settings: false });
      if (ui.editing || ui.adding) return setUi({ editing: null, adding: null });
      if (ui.locate) setUi({ locate: null });
    };
    const onDown = (e) => {
      if (pop && !e.target.closest(".pop") && !e.target.closest("[data-pop-anchor]")) setPop(null);
      if (ui.locate && !e.target.closest(`.item[data-id="${CSS.escape(ui.locate.id)}"]`)) setUi({ locate: null });
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); };
  }, [pop, ui.settings, ui.editing, ui.adding, ui.locate]);
}
