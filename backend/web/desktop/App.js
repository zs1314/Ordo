import { html, useState, useRef, useEffect, useLayoutEffect, useMemo } from '../vendor/preact-htm.js';
import { Icon } from './icons.js';
import { Button, IconButton, Empty } from './widgets.js';
import { useStore } from './useStore.js';
import { TaskEditor } from './TaskEditor.js';
import { useCodex, AgentHub, AgentPanel } from './AgentPanel.js';
import { Preferences, ListEditor } from './Preferences.js';
import { STATUS, OPEN, inView, matches, sortTasks, groupName, dayOf, dateLabel, smartTitle, todayKey } from './model.js';
import { repeatState } from '../lib/repeat.js';
import { ymd, monthCells, firstOfMonth, addMonths } from '../lib/due.js';
import { stripMd } from '../lib/md.js';

const NAV = [
  ['today', 'sun', '今天', 'amber'], ['upcoming', 'upcoming', '即将到来', 'purple'],
  ['all', 'all', '全部待办', 'blue'], ['important', 'star', '重要', 'rose'],
  ['habits', 'repeat', '习惯打卡', 'green'], ['calendar', 'calendar', '日历', 'teal'],
];
const COLORS = ['#6e8bc7','#a582c4','#c78d66','#70a393','#bd7c93'];
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.desktopMotion === 'reduced';
const updateItem = (id, patch) => doc => ({ ...doc, items: doc.items.map(i => i.id === id ? { ...i, ...patch } : i) });
const encoded = id => encodeURIComponent(id);

export function DesktopApp() {
  const { doc, pending, error, reload, mutate } = useStore();
  const codex = useCodex(reload);
  const [view, setView] = useState('all'), [query, setQuery] = useState(''), [sort, setSort] = useState('manual');
  const [modal, setModal] = useState(null), [toast, setToast] = useState(null), [selecting, setSelecting] = useState(false), [selected, setSelected] = useState(new Set());
  const [finishing, setFinishing] = useState(new Set()), [limit, setLimit] = useState(80), [clock, setClock] = useState(Date.now());
  const initialized = useRef(false), search = useRef(null), scroller = useRef(null), timer = useRef(null), busy = useRef(new Set());
  const quickDrafts = useRef(new Map()), closeTimer = useRef(null);
  const dismissModal = () => {
    if (closeTimer.current) return;
    if (reduced()) { setModal(null); return; }
    document.querySelector('.d-modal-backdrop')?.classList.add('leaving');
    closeTimer.current = setTimeout(() => { setModal(null); closeTimer.current = null; }, 160);
  };
  const showToast = (message, action) => { clearTimeout(timer.current); setToast({ message, action }); timer.current = setTimeout(() => setToast(null), action ? 7000 : 3200); };
  const run = async (...args) => { try { return await mutate(...args); } catch(e) { showToast(e.message); throw e; } };
  const fire = promise => promise.catch(() => {});
  const go = next => { setView(next); setQuery(''); setSelected(new Set()); setSelecting(false); setLimit(80); scroller.current?.scrollTo({ top: 0 }); };
  const newTask = () => {
    if (modal) return;
    if (!doc?.groups.length) { setModal({ kind: 'list' }); return; }
    const group = view.startsWith('group:') ? view.slice(6) : view.startsWith('section:') ? doc.groups.find(g => g.section === view.slice(8))?.id : doc.groups[0]?.id;
    setModal({ kind: 'task', group: group ?? doc.groups[0].id, due: view === 'today' ? todayKey() : '' });
  };
  useEffect(() => {
    if (!doc) return;
    if (!initialized.current) { setView(doc.theme.desktopStartView || 'all'); initialized.current = true; }
    const root = document.documentElement, t = doc.theme;
    root.dataset.mode = t.mode || 'auto'; root.dataset.density = t.density || 'comfortable'; root.dataset.desktopMotion = t.desktopMotion || 'full';
    root.style.setProperty('--d-accent', t.accent || '#52785e');
    root.style.setProperty('--d-font-size', `${Math.max(13, Math.min(18, t.fontSize || 15))}px`);
    document.title = 'Ordo';
  }, [doc?.theme]);
  useEffect(() => { const interval = setInterval(() => setClock(Date.now()), 60000); return () => { clearInterval(interval); clearTimeout(timer.current); }; }, []);
  useEffect(() => {
    window.ordoHasUnsavedChanges = () => !!pending || !!window.ordoEditorDirty || [...quickDrafts.current.values()].some(v => v.trim());
    return () => { delete window.ordoHasUnsavedChanges; };
  }, [pending]);
  useEffect(() => {
    const command = e => {
      if (e.detail === 'settings' && !modal) setModal({ kind: 'settings' });
      if (e.detail === 'new') newTask();
      if (e.detail === 'search' && !modal) { search.current?.focus(); search.current?.select(); }
    };
    const key = e => {
      if (modal || e.isComposing) return;
      if ((e.metaKey || e.ctrlKey) && ['f','k','n'].includes(e.key.toLowerCase())) {
        e.preventDefault(); if (e.key.toLowerCase() === 'n') newTask(); else { search.current?.focus(); search.current?.select(); }
      }
      if (e.key === 'Escape') { setQuery(''); setSelecting(false); setSelected(new Set()); search.current?.blur(); }
    };
    window.addEventListener('ordo-command', command); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('ordo-command', command); window.removeEventListener('keydown', key); };
  }, [doc, view, modal]);
  useEffect(() => { setLimit(80); }, [query, sort]);

  const restore = async item => {
    await run('POST', `/api/trash/${encoded(item.id)}/restore`, {}); showToast('任务已恢复');
  };
  const trash = async item => {
    await run('POST', `/api/items/${encoded(item.id)}/trash`, {}, d => ({ ...d, items: d.items.filter(i => i.id !== item.id), extras: { ...d.extras, trash: [...(d.extras.trash ?? []), item] } }));
    showToast('已移入回收站', { label: '撤销', run: () => restore(item) });
  };
  const complete = async item => {
    if (busy.current.has(item.id)) return;
    busy.current.add(item.id);
    const repeat = repeatState(item), done = repeat ? repeat.done : !OPEN(item);
    if (!done) { setFinishing(old => new Set([...old, item.id])); if (!reduced()) await new Promise(r => setTimeout(r, 180)); }
    try {
      if (repeat) {
        await run('POST', `/api/items/${encoded(item.id)}/check`, { date: repeat.key, done: !done }, updateItem(item.id, { doneDates: done ? (item.doneDates ?? []).filter(k => k !== repeat.key) : [...(item.doneDates ?? []), repeat.key] }));
        showToast(done ? '已撤销今天的打卡' : '今天又向前了一步', { label: '撤销', run: () => run('POST', `/api/items/${encoded(item.id)}/check`, { date: repeat.key, done }) });
      } else {
        const status = done ? 'todo' : 'done';
        await run('PATCH', `/api/items/${encoded(item.id)}`, { status }, updateItem(item.id, { status, doneAt: status === 'done' ? new Date().toISOString() : undefined }));
        showToast(done ? '已重新打开任务' : '又完成了一件事', { label: '撤销', run: () => run('PATCH', `/api/items/${encoded(item.id)}`, { status: item.status }) });
      }
    } finally { busy.current.delete(item.id); setFinishing(old => { const next = new Set(old); next.delete(item.id); return next; }); }
  };
  const star = item => run('PATCH', `/api/items/${encoded(item.id)}`, { priority: (item.priority ?? 0) >= 2 ? 0 : 3 }, updateItem(item.id, { priority: (item.priority ?? 0) >= 2 ? 0 : 3 }));
  const move = async (id, group) => { await run('PATCH', `/api/items/${encoded(id)}`, { group }, updateItem(id, { group })); showToast('已移动到清单'); };
  const batch = async (action, group) => {
    const ids = [...selected].filter(id => doc.items.some(i => i.id === id));
    if (!ids.length) return;
    await run('POST', '/api/items/batch', { ids, action, group });
    setSelected(new Set()); setSelecting(false); showToast(action === 'trash' ? `${ids.length} 个任务已移入回收站` : `已更新 ${ids.length} 个任务`);
  };
  const rows = useMemo(() => {
    if (!doc) return [];
    const source = view === 'trash' ? (doc.extras.trash ?? []) : doc.items;
    const filtered = source.filter(i => query.trim() ? matches(i, query, doc) : view === 'trash' || inView(i, view, doc)
      || (doc.theme.desktopShowDone && i.status === 'done' && (view === 'all' || (view.startsWith('section:') && doc.groups.some(g => g.id === i.group && g.section === view.slice(8))) || (view.startsWith('group:') && i.group === view.slice(6)))));
    if (view === 'trash') return filtered.sort((a,b) => (b.trashedAt ?? '').localeCompare(a.trashedAt ?? ''));
    if (view === 'completed') return filtered.sort((a,b) => (b.doneAt ?? b.updatedAt ?? '').localeCompare(a.doneAt ?? a.updatedAt ?? ''));
    return sortTasks(filtered, sort);
  }, [doc, view, query, sort, clock]);
  if (!doc) return html`<div class="d-loading"><div class="d-app-mark"><${Icon} name="check" size=${30} /></div><h1>Ordo</h1><p>${error || '正在整理你的待办…'}</p>${error && html`<${Button} onClick=${reload}>重试<//>`}</div>`;
  const visible = rows.slice(0, limit), today = todayKey(), isTrash = view === 'trash';
  const completedToday = doc.items.filter(i => i.status === 'done' && i.doneAt && ymd(new Date(i.doneAt)) === today).length + doc.items.filter(i => repeatState(i)?.done).length;
  const sections = doc.sections.filter(s => !s.hidden), title = query.trim() ? '搜索结果' : smartTitle(view, doc);
  const currentSection = view.startsWith('section:') ? doc.sections.find(s => s.id === view.slice(8)) : null;
  const subtitle = query.trim() ? `找到 ${rows.length} 个与「${query.trim()}」相关的任务` : view === 'today' ? '把心思，留给今天最重要的事。' : view === 'all' ? '心中有序，行事从容。' : view === 'upcoming' ? '给未来的自己，留一份从容。' : view === 'important' ? '值得你认真投入的事。' : view === 'habits' ? '微小的坚持，也会慢慢发光。' : view === 'trash' ? '不小心删掉的任务，都可以在这里找回。' : currentSection?.sub || (view === 'completed' ? '每一件完成的小事，都算数。' : '一件一件，慢慢完成。');
  const navCount = key => key === 'calendar' ? null : doc.items.filter(i => inView(i, key, doc)).filter(i => !repeatState(i)?.done).length;
  const toggleSelected = id => setSelected(old => { const next = new Set(old); next.has(id) ? next.delete(id) : next.add(id); return next; });
  let buckets;
  if (!query && view === 'today') buckets = [['已逾期', visible.filter(i => !i.repeat && dayOf(i) < today), 'overdue'], ['今天', visible.filter(i => i.repeat || dayOf(i) >= today), '']];
  else if (!query && view === 'upcoming') { const days = [...new Set(visible.map(dayOf))].sort(); buckets = days.map(day => [dateLabel({ due: day }), visible.filter(i => dayOf(i) === day), '']); }
  else buckets = [[query ? '匹配的任务' : view === 'completed' ? '完成与搁置' : isTrash ? '最近删除' : '待办事项', visible, '']];
  const rowProps = { doc, onOpen: item => setModal({ kind: 'task', item }), onComplete: i => fire(complete(i)), onStar: i => fire(star(i)), onRestore: i => fire(restore(i)), selecting, selected, toggleSelected, finishing, isTrash };
  return html`<div class="d-root"><div class="d-workspace">
    <aside class="d-sidebar"><div class="d-sidebar-brand"><div class="d-app-mark"><${Icon} name="check" size=${21} /></div><div><strong>Ordo</strong><small>${doc.theme.title && doc.theme.title !== 'Ordo' ? doc.theme.title : '给生活，一点秩序'}</small></div></div>
      <nav aria-label="智能清单" class="d-nav">${NAV.map(([key, icon, label, color]) => html`<${NavItem} key=${key} active=${view === key && !query} icon=${icon} color=${color} label=${label} count=${navCount(key)} onClick=${() => go(key)} />`)}</nav>
      <div class="d-sidebar-section"><span>我的清单</span><${IconButton} icon="plus" label="新建清单" onClick=${() => setModal({ kind: 'list' })} /></div>
      <nav class="d-lists" aria-label="我的清单">${sections.map((s, index) => html`<div key=${s.id}><${NavItem} active=${view === `section:${s.id}` && !query} icon=${s.id === 'inbox' ? 'inbox' : 'folder'} label=${s.title} count=${navCount(`section:${s.id}`)} tint=${COLORS[index % COLORS.length]} onClick=${() => go(`section:${s.id}`)} onDoubleClick=${() => setModal({ kind: 'list', section: s })} onDrop=${id => { const g = doc.groups.find(g => g.section === s.id); if(g) fire(move(id, g.id)); }} />${doc.groups.filter(g => g.section === s.id).length > 1 && doc.groups.filter(g => g.section === s.id).map(g => html`<${NavItem} active=${view === `group:${g.id}`} icon="list" label=${g.title} class="d-subnav" count=${navCount(`group:${g.id}`)} onClick=${() => go(`group:${g.id}`)} onDrop=${id => fire(move(id, g.id))} />`)}</div>`)}</nav>
      <button class="d-add-list" onClick=${() => setModal({ kind: 'list' })}><${Icon} name="plus" size=${15} />新建清单</button>
      <div class="d-sidebar-bottom"><nav class="d-nav secondary"><${NavItem} active=${view === 'agent'} icon="agent" label="Codex 协作" count=${navCount('agent')} onClick=${() => go('agent')} /><${NavItem} active=${view === 'completed'} icon="check" label="已完成" onClick=${() => go('completed')} /><${NavItem} active=${view === 'trash'} icon="trash" label="回收站" count=${doc.extras.trash?.length || null} onClick=${() => go('trash')} /></nav>
        <div class="d-sidebar-footer"><span class=${`d-save-state ${error ? 'error' : ''}`}><i class=${pending ? 'saving' : ''}></i>${error ? '保存遇到问题' : pending ? '正在保存…' : '已保存在本机'}</span><${IconButton} icon="settings" label="设置 ⌘," onClick=${() => setModal({ kind: 'settings' })} /></div>
      </div>
    </aside>
    <div class="d-main"><div class="d-toolbar"><div class="d-breadcrumb">我的工作区 <span>/</span> ${smartTitle(view, doc)}</div><div class="d-toolbar-actions"><label class="d-search"><${Icon} name="search" size=${16} /><input ref=${search} aria-label="搜索所有任务" placeholder="搜索任务、标签…" value=${query} onInput=${e => setQuery(e.target.value)} /><kbd>⌘ K</kbd>${query && html`<button aria-label="清除搜索" onClick=${() => setQuery('')}><${Icon} name="close" size=${14} /></button>`}</label><${IconButton} icon="plus" label="新建待办 ⌘N" class="d-toolbar-add" onClick=${newTask} /></div></div>
      <main class="d-main-scroll" ref=${scroller}><div class="d-page" key=${view}>
        <div class="d-page-heading"><div><div class="d-eyebrow">${new Date(clock).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</div><h1>${title}<span class="d-heading-count">${rows.length}</span></h1><p>${subtitle}</p></div><div class="d-heading-icon"><${Icon} name=${NAV.find(n => n[0] === view)?.[1] || (view === 'completed' ? 'check' : view === 'trash' ? 'trash' : 'folder')} size=${40} /></div></div>
        ${!query && ['today','all'].includes(view) && html`<div class="d-daily-card"><div class="d-progress-ring" style=${{ '--progress': `${Math.round(100 * completedToday / Math.max(1, completedToday + doc.items.filter(i => inView(i, 'today', doc) && !repeatState(i)?.done).length))}%` }}><${Icon} name="check" size=${15} /></div><div><strong>${completedToday ? `今天已完成 ${completedToday} 件事` : '新的一天，从一件小事开始'}</strong><span>${completedToday ? '做得不错，按自己的节奏继续。' : '不必一次做完所有，先迈出一小步。'}</span></div><div class="d-week-bars" title="最近 7 天的完成记录">${Array.from({ length: 7 }, (_, n) => { const date = new Date(); date.setDate(date.getDate() - 6 + n); const key = ymd(date), count = doc.items.filter(i => i.doneAt && ymd(new Date(i.doneAt)) === key).length + doc.items.filter(i => i.doneDates?.includes(key)).length; return html`<span class=${n === 6 ? 'today' : ''} style=${{ height: `${Math.min(29, 5 + count * 5)}px` }} title=${`${key}：${count} 件`}></span>`; })}</div></div>`}
        ${view === 'agent' && !query && html`<${AgentHub} data=${codex.data} onOpen=${job => setModal({kind:'agent',itemId:job.itemId,jobId:job.id})} />`}
        ${view === 'calendar' && !query ? html`<${CalendarView} doc=${doc} rowProps=${rowProps} onAdd=${day => setModal({ kind: 'task', group: doc.groups[0]?.id, due: day })} />` : html`
          <div class="d-list-toolbar"><div class="d-section-caption">${isTrash ? '可随时恢复' : selecting ? `已选 ${selected.size} 项` : `${rows.filter(OPEN).length} 项待办${view === 'habits' ? ` · ${rows.filter(i => repeatState(i)?.done).length} 项今天已打卡` : ''}`}</div><div class="d-list-tools">${currentSection && html`<${IconButton} icon="more" label="编辑清单" onClick=${() => setModal({ kind: 'list', section: currentSection })} />`}${!isTrash && rows.length > 0 && html`<${Button} class="quiet" onClick=${() => { setSelecting(!selecting); setSelected(new Set()); }}>${selecting ? '取消多选' : '多选'}<//>`}${!isTrash && html`<label class="d-sort"><${Icon} name="sort" size=${15} /><select aria-label="排序方式" value=${sort} onChange=${e => setSort(e.target.value)}><option value="manual">清单顺序</option><option value="due">截止日期</option><option value="priority">优先级</option><option value="created">最新添加</option><option value="title">标题</option></select></label>`}</div></div>
          ${selecting && html`<div class="d-bulk"><label><input type="checkbox" aria-label="选择所有结果" checked=${rows.length > 0 && rows.every(i => selected.has(i.id))} onChange=${e => setSelected(e.target.checked ? new Set(rows.slice(0,500).map(i => i.id)) : new Set())} />全选</label><${Button} icon="check" disabled=${!selected.size} onClick=${() => fire(batch('done'))}>完成<//><select aria-label="批量移动到清单" disabled=${!selected.size} value="" onChange=${e => { if (e.target.value) fire(batch('move', e.target.value)); }}><option value="">移到清单…</option>${doc.groups.map(g => html`<option value=${g.id}>${groupName(doc,g.id)}</option>`)}</select><${IconButton} icon="trash" label="将所选任务移入回收站" disabled=${!selected.size} onClick=${() => fire(batch('trash'))} /></div>`}
          ${buckets.map(([label, items, cls]) => items.length > 0 && html`<${TaskList} key=${label} label=${label} items=${items} class=${cls} rowProps=${rowProps} />`)}
          ${!rows.length && html`<${Empty} icon=${query ? 'search' : view === 'completed' ? 'check' : isTrash ? 'trash' : view === 'today' ? 'sun' : 'inbox'} title=${query ? '没有找到匹配的任务' : isTrash ? '回收站很干净' : view === 'completed' ? '完成的事，会留在这里' : view === 'today' ? '今天，留一点空间给自己' : '这里，等待你的下一件事'} detail=${query ? '试试任务标题、备注、标签或清单名称。' : isTrash ? '删除的任务会保留在这里，随时可以恢复。' : view === 'today' ? '给任务设置今天的截止日期，或安排一个日常习惯。' : view === 'completed' ? '勾选一个任务，记录一点小小的进展。' : '先记下来，之后再慢慢安排。'} action=${!query && !isTrash && view !== 'completed' && html`<${Button} class="primary" icon="plus" onClick=${newTask}>添加第一件事<//>`} />`}
          ${rows.length > limit && html`<${Button} class="d-load-more" onClick=${() => setLimit(limit + 80)}>再显示 ${Math.min(80, rows.length - limit)} 项<//>`}
          ${!isTrash && view !== 'completed' && html`<${QuickEntry} key=${view} draft=${quickDrafts.current.get(view) || ''} onDraft=${value => quickDrafts.current.set(view,value)} onAdd=${async title => { if (!doc.groups.length) { setModal({kind:'list'}); throw new Error('请先新建一个清单'); } const group = view.startsWith('group:') ? view.slice(6) : view.startsWith('section:') ? doc.groups.find(g => g.section === view.slice(8))?.id : doc.groups[0].id; await run('POST','/api/items',{title,group,due:view === 'today' ? today : undefined}); }} onDetails=${newTask} />`}
        `}
        <div class="d-page-footer"><span>一件一件，慢慢完成。</span><span>⌘ N 快速添加</span></div>
      </div></main>
    </div>
  </div>
  ${error && html`<div class="d-error-banner" role="alert">${error}<button onClick=${reload}>重试连接</button></div>`}
  ${modal?.kind === 'task' && html`<${TaskEditor} key=${modal.item?.id ?? 'new'} item=${modal.item} doc=${doc} group=${modal.group} due=${modal.due} onClose=${dismissModal} onTrash=${trash} onAgent=${() => setModal({kind:'agent',itemId:modal.item.id})} onSave=${async payload => { await run(modal.item ? 'PATCH' : 'POST', modal.item ? `/api/items/${encoded(modal.item.id)}` : '/api/items', payload); showToast(modal.item ? '修改已保存' : '已添加到清单'); }} />`}
  ${modal?.kind === 'agent' && html`<${AgentPanel} key=${modal.jobId || modal.itemId} item=${doc.items.find(i => i.id === modal.itemId)} initialJobId=${modal.jobId} data=${codex.data} refresh=${codex.refresh} onSync=${reload} onComplete=${complete} onClose=${dismissModal} />`}
  ${modal?.kind === 'settings' && html`<${Preferences} doc=${doc} onChange=${patch => run('PATCH','/api/theme',patch, d => ({...d,theme:{...d.theme,...patch}}))} onClose=${dismissModal} />`}
  ${modal?.kind === 'list' && html`<${ListEditor} section=${modal.section} doc=${doc} onClose=${dismissModal} onSave=${async payload => { const next = await run(modal.section ? 'PATCH' : 'POST', modal.section ? `/api/sections/${encoded(modal.section.id)}` : '/api/sections', payload); const section = modal.section || next.sections.find(s => !doc.sections.some(old => old.id === s.id)); if(section) go(`section:${section.id}`); }} onDelete=${async () => { await run('DELETE', `/api/sections/${encoded(modal.section.id)}`, {}); go('all'); }} />`}
  ${toast && html`<div class="d-toast" role="status"><${Icon} name="check" size=${16} /><span>${toast.message}</span>${toast.action && html`<button onClick=${() => { const a = toast.action; setToast(null); fire(a.run()); }}>${toast.action.label}</button>`}<${IconButton} icon="close" label="关闭提示" onClick=${() => setToast(null)} /></div>`}
  </div>`;
}

function NavItem({ active, icon, label, count, onClick, color = '', tint, class: cls = '', onDoubleClick, onDrop }) {
  const [over, setOver] = useState(false);
  return html`<button class=${`d-nav-item ${active ? 'active' : ''} ${over ? 'drag-over' : ''} ${cls}`} aria-current=${active ? 'page' : undefined} onClick=${onClick} onDblClick=${onDoubleClick} onDragOver=${e => { if(onDrop && e.dataTransfer.types.includes('application/x-ordo-task')) { e.preventDefault(); setOver(true); e.dataTransfer.dropEffect='move'; } }} onDragLeave=${() => setOver(false)} onDrop=${e => { e.preventDefault(); setOver(false); const id=e.dataTransfer.getData('application/x-ordo-task'); if(id && onDrop) onDrop(id); }}><span class=${`d-nav-icon ${color}`} style=${tint ? {color:tint} : undefined}><${Icon} name=${icon} size=${18} /></span><span class="d-nav-label">${label}</span>${count > 0 && html`<span class="d-nav-count">${count}</span>`}</button>`;
}

function TaskList({ label, items, rowProps, class: cls = '' }) {
  const ref = useRef(null), positions = useRef(new Map());
  useLayoutEffect(() => {
    const rows = [...(ref.current?.querySelectorAll('.d-task') ?? [])];
    const next = new Map(rows.map(el => [el.dataset.id, el.offsetTop]));
    if (!reduced()) rows.forEach(el => {
      const old = positions.current.get(el.dataset.id), current = next.get(el.dataset.id);
      if (old != null && old !== current) el.animate([{ transform: `translateY(${old-current}px)` }, {transform:'translateY(0)'}], {duration:240,easing:'cubic-bezier(.2,.8,.2,1)'});
    });
    positions.current = next;
  }, [items.map(i => i.id).join('|')]);
  return html`<section class=${`d-task-section ${cls}`}><div class="d-task-section-heading"><span>${label}</span><small>${items.length}</small></div><div class="d-task-list" ref=${ref}>${items.map(item => html`<${TaskRow} key=${item.id} item=${item} ...${rowProps} />`)}</div></section>`;
}
function TaskRow({ item, doc, onOpen, onComplete, onStar, onRestore, selecting, selected, toggleSelected, finishing, isTrash }) {
  const repeat = repeatState(item), done = repeat ? repeat.done : !OPEN(item), closing = finishing.has(item.id), starred = (item.priority ?? 0) >= 2;
  const meta = !!(item.due || item.note || item.tags?.length || item.subtasks?.length || repeat || ['doing','waiting','agent'].includes(item.status));
  return html`<article class=${`d-task ${done || closing ? 'done' : ''} ${closing ? 'completing' : ''} ${selected.has(item.id) ? 'selected' : ''}`} data-id=${item.id} draggable=${!isTrash && !selecting} onDragStart=${e => { e.dataTransfer.setData('application/x-ordo-task',item.id); e.dataTransfer.effectAllowed='move'; }}>
    ${selecting ? html`<input class="d-select-task" type="checkbox" aria-label=${`选择 ${stripMd(item.title)}`} checked=${selected.has(item.id)} onChange=${() => toggleSelected(item.id)} />` : isTrash ? html`<span class="d-trash-row-icon"><${Icon} name="trash" size=${17} /></span>` : html`<button class=${`d-task-check ${done || closing ? 'checked' : ''} priority-${item.priority ?? 0}`} aria-label=${`${done ? '重新打开' : repeat ? '打卡' : '完成'} ${stripMd(item.title)}`} aria-pressed=${done || closing} onClick=${() => onComplete(item)}>${(done || closing) && html`<${Icon} name="check" size=${12} />`}</button>`}
    <button class="d-task-body" onClick=${() => selecting ? toggleSelected(item.id) : isTrash ? onRestore(item) : onOpen(item)}><span class="d-task-title">${stripMd(item.title)}</span>${meta && html`<span class="d-task-meta">${item.status === 'doing' && html`<span class="d-status doing"><i></i>进行中</span>`}${['waiting','agent','dropped'].includes(item.status) && html`<span class="d-status">${STATUS[item.status]}</span>`}${item.due && html`<span class=${`d-due ${OPEN(item) && dayOf(item) && dayOf(item) < todayKey() ? 'overdue' : dayOf(item) === todayKey() ? 'today' : ''}`}><${Icon} name="calendar" size=${12} />${dateLabel(item)}</span>`}${repeat && html`<span class="d-repeat-meta"><${Icon} name="repeat" size=${12} />${repeat.label}${repeat.streak ? ` · 连续 ${repeat.streak}${repeat.unit}` : ''}</span>`}${item.subtasks?.length > 0 && html`<span><${Icon} name="list" size=${12} />${item.subtasks.filter(s => s.done).length}/${item.subtasks.length}</span>`}${item.note && html`<span title="有备注"><${Icon} name="note" size=${12} /></span>`}${item.tags?.slice(0,2).map(t => html`<span class="d-tag">${t}</span>`)}</span>`}</button>
    <span class="d-task-group">${groupName(doc,item.group)}</span>
    ${isTrash ? html`<${Button} class="quiet" icon="restore" onClick=${() => onRestore(item)}>恢复<//>` : html`<${IconButton} icon="star" label=${starred ? '取消重要' : '标为重要'} class=${`d-task-star ${starred ? 'starred' : ''}`} aria-pressed=${starred} onClick=${() => onStar(item)} />`}
  </article>`;
}

function QuickEntry({ onAdd, onDetails, draft, onDraft }) {
  const [value,setValue]=useState(draft || ''), [saving,setSaving]=useState(false), ref=useRef(null);
  const submit=async e => { e.preventDefault(); if(!value.trim() || saving) return; setSaving(true); try { await onAdd(value.trim()); setValue(''); onDraft(''); requestAnimationFrame(() => ref.current?.focus()); } catch {} finally { setSaving(false); } };
  return html`<form class="d-quick-entry" onSubmit=${submit}><${Icon} name="plus" size=${19} /><input ref=${ref} aria-label="快速添加待办" placeholder="添加待办，按回车保存…" value=${value} onInput=${e => { setValue(e.target.value); onDraft(e.target.value); }} disabled=${saving} onKeyDown=${e => { if(e.isComposing && e.key === 'Enter') e.preventDefault(); }} />${value ? html`<button type="submit" disabled=${saving}>${saving ? '保存…' : '添加'}<${Icon} name="arrow" size=${14} /></button>` : html`<button type="button" onClick=${onDetails}><kbd>⌘ N</kbd></button>`}</form>`;
}

function CalendarView({ doc, rowProps, onAdd }) {
  const [month,setMonth]=useState(firstOfMonth()), [selected,setSelected]=useState(todayKey());
  const items=doc.items.filter(i => dayOf(i) === selected), dates=monthCells(month);
  return html`<div class="d-calendar"><div class="d-calendar-toolbar"><h2>${month.getFullYear()} 年 ${month.getMonth()+1} 月</h2><span class="d-spacer"></span><${IconButton} icon="chevron" class="back" label="上个月" onClick=${() => setMonth(addMonths(month,-1))} /><${Button} class="quiet" onClick=${() => {setMonth(firstOfMonth());setSelected(todayKey());}}>今天<//><${IconButton} icon="chevron" label="下个月" onClick=${() => setMonth(addMonths(month,1))} /></div><div class="d-calendar-grid">${[...'一二三四五六日'].map(d => html`<div class="d-calendar-weekday">${d}</div>`)}${dates.map(date => { const key=ymd(date), tasks=doc.items.filter(i => dayOf(i) === key && OPEN(i)); return html`<button class=${`d-calendar-cell ${key === selected ? 'selected' : ''} ${key === todayKey() ? 'today' : ''} ${date.getMonth() !== month.getMonth() ? 'outside' : ''}`} aria-label=${`${key}，${tasks.length} 项待办`} onClick=${() => setSelected(key)}><span class="d-calendar-day">${date.getDate()}</span>${tasks.slice(0,2).map(i => html`<span class="d-calendar-task">${stripMd(i.title)}</span>`)}${tasks.length>2 && html`<small>还有 ${tasks.length-2} 项</small>`}</button>`; })}</div><div class="d-calendar-agenda"><div class="d-calendar-toolbar"><h3>${dateLabel({due:selected})}的安排</h3><span class="d-spacer"></span><${Button} class="quiet" icon="plus" onClick=${() => onAdd(selected)}>添加<//></div>${items.length ? html`<${TaskList} label="当天任务" items=${items} rowProps=${rowProps} />` : html`<p class="d-calendar-empty">这一天还没有安排。</p>`}</div></div>`;
}
