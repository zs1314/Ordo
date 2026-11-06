import { html, useState } from '../vendor/preact-htm.js';
import { Dialog, Button, IconButton } from './widgets.js';
import { Icon } from './icons.js';

export function Preferences({ doc, onChange, onClose }) {
  const [error, setError] = useState('');
  const t = doc.theme;
  const change = async patch => { try { await onChange(patch); setError(''); } catch(e) { setError(e.message); } };
  const native = action => window.webkit?.messageHandlers?.desktop?.postMessage({ action });
  const seg = (key, options) => html`<div class="d-segment">${options.map(([value, label]) => html`<button type="button" aria-pressed=${t[key] === value} class=${t[key] === value ? 'selected' : ''} onClick=${() => change({ [key]: value })}>${label}</button>`)}</div>`;
  return html`<${Dialog} title="设置" onClose=${onClose} class="d-preferences">
    <div class="d-dialog-head"><h2>设置</h2><${IconButton} icon="close" label="关闭设置" onClick=${onClose} /></div>
    <div class="d-editor-scroll"><div class="d-pref-intro"><div class="d-app-mark"><${Icon} name="check" size=${26} /></div><div><strong>Ordo</strong><p>把心思，留给重要的事。</p></div><span>2.2.1</span></div>
      <h3 class="d-pref-heading">外观</h3><div class="d-pref-group">
        <div class="d-pref-row"><label>显示模式</label>${seg('mode', [['auto','跟随系统'],['light','浅色'],['dark','深色']])}</div>
        <div class="d-pref-row"><label>启动时打开</label><select aria-label="启动视图" value=${['all','today','upcoming'].includes(t.desktopStartView) ? t.desktopStartView : 'all'} onChange=${e => change({ desktopStartView: e.target.value })}><option value="all">全部待办</option><option value="today">今天</option><option value="upcoming">接下来</option></select></div>
      </div><details class="d-advanced"><summary>更多外观选项</summary><div>
        <div class="d-pref-row"><label>强调色</label><div class="d-colors">${['#52785e','#3478f6','#8c67d8','#d78042','#d4617b'].map(color => html`<button title=${color} aria-label=${`强调色 ${color}`} class=${t.accent === color ? 'selected' : ''} style=${{ '--swatch': color }} onClick=${() => change({ accent: color })}>${t.accent === color && html`<${Icon} name="check" size=${12} />`}</button>`)}</div></div>
        <div class="d-pref-row"><label>列表密度</label>${seg('density', [['comfortable','舒适'],['compact','紧凑']])}</div>
        <div class="d-pref-row"><label>界面动效</label>${seg('desktopMotion', [['full','流畅'],['reduced','减少动态']])}</div>
      </div></details>
      <h3 class="d-pref-heading">数据与备份</h3><div class="d-pref-group"><div class="d-pref-description"><${Icon} name="laptop" /><div><strong>只在这台 Mac 上</strong><p>每次修改自动保存，不需要账号。</p></div></div>
        <div class="d-backup-buttons"><${Button} icon="restore" onClick=${() => native('backup')}>完整备份<//><${Button} icon="note" onClick=${() => native('export')}>导出 JSON<//><${Button} icon="folder" onClick=${() => native('showData')}>数据文件夹<//></div>
      </div>
      <details class="d-advanced"><summary>键盘快捷键</summary><div class="d-shortcuts"><span>新建待办 <kbd>⌘ N</kbd></span><span>全局搜索 <kbd>⌘ F</kbd></span><span>快速查找 <kbd>⌘ K</kbd></span><span>保存详情 <kbd>⌘ ↵</kbd></span><span>设置 <kbd>⌘ ,</kbd></span><span>关闭面板 <kbd>esc</kbd></span></div></details>
      ${error && html`<p role="alert" class="d-form-error">${error}</p>`}
    </div>
  <//>`;
}

export function ListEditor({ section, doc, onSave, onDelete, onClose }) {
  const [title, setTitle] = useState(section?.title ?? ''), [sub, setSub] = useState(section?.sub ?? ''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const hasItems = section && doc.items.some(i => doc.groups.some(g => g.id === i.group && g.section === section.id));
  const submit = async e => { e.preventDefault(); if (!title.trim() || busy) return; setBusy(true); try { await onSave({ title: title.trim(), sub }); onClose(); } catch(e) { setError(e.message); setBusy(false); } };
  return html`<${Dialog} title=${section ? '编辑清单' : '新建清单'} onClose=${onClose} class="d-list-dialog"><form onSubmit=${submit}><div class="d-dialog-head"><h2>${section ? '编辑清单' : '新建清单'}</h2><${IconButton} icon="close" label="关闭" onClick=${onClose} /></div><div class="d-editor-scroll"><label class="d-text-field">名称<input data-autofocus aria-label="清单名称" placeholder="例如：个人项目" value=${title} onInput=${e => setTitle(e.target.value)} /></label><label class="d-text-field">描述<input aria-label="清单描述" placeholder="给这个清单一句简短说明" value=${sub} onInput=${e => setSub(e.target.value)} /></label>${error && html`<p class="d-form-error" role="alert">${error}</p>`}</div><div class="d-dialog-foot">${section && !hasItems && html`<${Button} class="danger" onClick=${async () => { setBusy(true); try { await onDelete(); onClose(); } catch(e) { setError(e.message); setBusy(false); } }}>删除空清单<//>`}<span class="d-spacer"></span><${Button} type="submit" class="primary" disabled=${busy || !title.trim()}>${busy ? '保存中…' : '保存清单'}<//></div></form><//>`;
}
