import { html, useState, useEffect } from "../vendor/preact-htm.js";
import { useBoard } from "./ctx.js";
import { ago, today } from "../lib/time.js";

// Header bar: stays visible after scrolling down, floating above the page (see header in styles.css)
export function Header() {
  const { doc, ui, setUi, reload, toast } = useBoard();
  const [floating, setFloating] = useState(() => scrollY > 20);
  useEffect(() => {
    let raf = 0;
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; setFloating(scrollY > 20); }); };
    addEventListener("scroll", onScroll, { passive: true });
    return () => { removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, []);
  return html`<header class=${floating ? "not-top" : ""}><div class="container"><div class="bar">
    <div class="brand">${doc.theme?.title || "ToDo"}</div>
    ${window.webkit?.messageHandlers?.desktop ? html`<span class="demo-tag" title="更改自动保存在这台 Mac 上">本机 · 自动保存</span>` : null}
    ${doc.demo ? html`<span class="demo-tag" title="数据是编的，改了只在这个页面里，刷新回到原样">示例</span>` : null}
    ${doc.demo?.repo ? html`<a class="demo-tag" href=${doc.demo.repo} target="_blank" rel="noopener noreferrer">GitHub</a>` : null}
    <div class="grow"></div>
    <span class="hdr-meta">${today()} · ${ago(doc.updatedAt)}更新</span>
    ${window.webkit?.messageHandlers?.desktop ? html`<button class="tbtn on" title="新建待办 ⌘N" onClick=${() => window.dispatchEvent(new CustomEvent('ordo-command', { detail: 'new' }))}>＋ 新建</button>` : null}
    <button class=${`tbtn edit-btn ${ui.editMode ? "on" : ""}`}
      onClick=${() => setUi((u) => ({ editMode: !u.editMode, editing: null, adding: null }))}>${ui.editMode ? "完成编辑" : "编辑布局"}</button>
    <button class="tbtn" onClick=${() => setUi({ settings: true })}>设置</button>
    <button class="tbtn" title="刷新" onClick=${() => reload(true).then(() => toast("已刷新"))}>↻</button>
  </div></div></header>`;
}
