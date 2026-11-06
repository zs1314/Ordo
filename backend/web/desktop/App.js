import { html, useState, useRef, useEffect, useLayoutEffect, useMemo } from '../vendor/preact-htm.js';
import { Icon } from './icons.js';
import { Button, IconButton, Empty } from './widgets.js';
import { useStore } from './useStore.js';
import { TaskEditor } from './TaskEditor.js';
import { Preferences, ListEditor } from './Preferences.js';
import { OPEN, inView, matches, sortTasks, groupName, dayOf, dateLabel, smartTitle, todayKey, tomorrowKey } from './model.js';
import { repeatState } from '../lib/repeat.js';
import { ymd } from '../lib/due.js';
import { stripMd } from '../lib/md.js';
import { ago, dur, hoursSince } from '../lib/time.js';

const NAV = [['today', 'sun', '今天'], ['upcoming', 'upcoming', '接下来'], ['all', 'all', '全部待办']];
const STATES = [['doing','play','我在做'],['agent','settings','Agent 在做'],['waiting','clock','等别人'],['todo','circle','还没做']];
const COLORS = ['#6e8bc7','#a582c4','#c78d66','#70a393','#bd7c93'];
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.desktopMotion === 'reduced';
const updateItem = (id, patch) => doc => ({ ...doc, items: doc.items.map(i => i.id === id ? { ...i, ...patch } : i) });
const encoded = id => encodeURIComponent(id);
const previousStatus = item => ({ status: item.status, ...(item.status === 'agent' ? { agent: item.agent } : {}) });

export function DesktopApp() {
  const { doc, pending, error, reload, mutate } = useStore();
  const [statusFilter, setStatusFilter] = useState('all');
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
  const go = next => { setStatusFilter('all'); setView(next); setQuery(''); setSelected(new Set()); setSelecting(false); setLimit(80); scroller.current?.scrollTo({ top: 0 }); };
  const newTask = (draftTitle = '') => {
    if (modal) return;
    if (!doc?.groups.length) { setModal({ kind: 'list' }); return; }
    const group = view.startsWith('group:') ? view.slice(6) : view.startsWith('section:') ? doc.groups.find(g => g.section === view.slice(8))?.id : doc.groups[0]?.id;
    setModal({ kind: 'task', group: group ?? doc.groups[0].id, due: view === 'today' ? todayKey() : view === 'upcoming' ? tomorrowKey() : '', status: statusFilter === 'all' ? 'todo' : statusFilter, title: draftTitle, draftView: draftTitle ? view : null });
  };
  useEffect(() => {
    if (!doc) return;
    if (!initialized.current) { const saved = doc.theme.desktopStartView; setView(['today','upcoming','all'].includes(saved) ? saved : 'all'); initialized.current = true; }
    const root = document.documentElement, t = doc.theme;
    root.dataset.mode = t.mode || 'auto'; root.dataset.density = t.density || 'comfortable'; root.dataset.desktopMotion = t.desktopMotion || 'full';
    root.style.setProperty('--d-accent', t.accent || '#52785e');
    root.style.setProperty('--d-font-size', `${Math.max(13, Math.min(18, t.fontSize || 15))}px`);
    document.title = 'Ordo';
  }, [doc?.theme]);
  useEffect(() => { const interval = setInterval(() => setClock(Date.now()), 60000); return () => { clearInterval(interval); clearTimeout(timer.current); }; }, []);
  useLayoutEffect(() => {
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
  }, [doc, view, modal, statusFilter]);
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
        showToast(done ? '已重新打开任务' : '又完成了一件事', { label: '撤销', run: () => run('PATCH', `/api/items/${encoded(item.id)}`, previousStatus(item)) });
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
  const matchingRows = useMemo(() => {
    if (!doc) return [];
    const source = view === 'trash' ? (doc.extras.trash ?? []) : doc.items;
    const filtered = source.filter(i => query.trim() ? matches(i, query, doc) : view === 'trash' || inView(i, view, doc));
    if (view === 'trash') return filtered.sort((a,b) => (b.trashedAt ?? '').localeCompare(a.trashedAt ?? ''));
    if (view === 'completed') return filtered.sort((a,b) => (b.doneAt ?? b.updatedAt ?? '').localeCompare(a.doneAt ?? a.updatedAt ?? ''));
    return sortTasks(filtered, sort);
  }, [doc, view, query, sort, clock]);
  const rows = statusFilter === 'all' ? matchingRows : matchingRows.filter(i => i.status === statusFilter);
  if (!doc) return html`<div class="d-loading"><div class="d-app-mark"><${Icon} name="check" size=${30} /></div><h1>Ordo</h1><p>${error || '正在整理你的待办…'}</p>${error && html`<${Button} onClick=${reload}>重试<//>`}</div>`;
  const visible = rows.slice(0, limit), today = todayKey(), isTrash = view === 'trash';
  const completedToday = doc.items.filter(i => i.status === 'done' && i.doneAt && ymd(new Date(i.doneAt)) === today).length + doc.items.filter(i => repeatState(i)?.done).length;
  const sections = doc.sections.filter(s => !s.hidden), title = query.trim() ? '搜索结果' : smartTitle(view, doc);
  const currentSection = view.startsWith('section:') ? doc.sections.find(s => s.id === view.slice(8)) : null;
  const navCount = key => doc.items.filter(i => inView(i, key, doc)).filter(i => !repeatState(i)?.done).length;
  const toggleSelected = id => setSelected(old => { const next = new Set(old); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const statusChange = async (item, status) => {
    if (busy.current.has(item.id)) return;
    busy.current.add(item.id);
    try { await run('PATCH', `/api/items/${encoded(item.id)}`, {status}, updateItem(item.id,{status})); showToast('状态已更新', {label:'撤销',run:() => run('PATCH', `/api/items/${encoded(item.id)}`, previousStatus(item))}); }
    finally { busy.current.delete(item.id); }
  };
  const markSeen = async item => { await run('PATCH',`/api/items/${encoded(item.id)}`,{seen:true});showToast('已记录本次查看'); };
  const buckets = isTrash || view === 'completed' ? [['',visible,'']] : ['agent','doing','waiting','todo','done','dropped'].map(status => [STATES.find(s => s[0] === status)?.[2] || (status === 'done' ? '已完成' : '已搁置'),visible.filter(i=>i.status===status),'']);
  const rowProps = { doc, onOpen: (item, status) => setModal({ kind: 'task', item, status }), onComplete: i => fire(complete(i)), onStatus: (i,s) => fire(statusChange(i,s)), onSeen:i=>fire(markSeen(i)), onStar: i => fire(star(i)), onRestore: i => fire(restore(i)), selecting, selected, toggleSelected, finishing, isTrash };
  const addQuick = async title => {
    if (!doc.groups.length) { setModal({kind:'list'}); throw new Error('请先新建一个清单'); }
    const group = view.startsWith('group:') ? view.slice(6) : view.startsWith('section:') ? doc.groups.find(g => g.section === view.slice(8))?.id : doc.groups[0].id;
    await run('POST','/api/items',{title,group,status:statusFilter === 'all' ? 'todo' : statusFilter,due:view === 'today' ? today : view === 'upcoming' ? tomorrowKey() : undefined});
  };
  return html`<div class="d-root"><div class="d-workspace">
    <aside class="d-sidebar">
      <div class="d-sidebar-brand"><div class="d-app-mark"><${Icon} name="check" size=${21} /></div><strong>Ordo</strong></div>
      <nav aria-label="智能清单" class="d-nav">${NAV.map(([key, icon, label]) => html`<${NavItem} key=${key} active=${view === key && !query} icon=${icon} label=${label} count=${navCount(key)} onClick=${() => go(key)} />`)}</nav>
      <div class="d-sidebar-section"><span>我的清单</span></div>
      <nav class="d-lists" aria-label="我的清单">${sections.map((s, index) => html`<div key=${s.id}><${NavItem} active=${view === `section:${s.id}` && !query} icon=${s.id === 'inbox' ? 'inbox' : 'folder'} label=${s.title} count=${navCount(`section:${s.id}`)} tint=${COLORS[index % COLORS.length]} onClick=${() => go(`section:${s.id}`)} onDoubleClick=${() => setModal({ kind: 'list', section: s })} onDrop=${id => { const g = doc.groups.find(g => g.section === s.id); if(g) fire(move(id, g.id)); }} />${doc.groups.filter(g => g.section === s.id).length > 1 && doc.groups.filter(g => g.section === s.id).map(g => html`<${NavItem} active=${view === `group:${g.id}`} icon="list" label=${g.title} class="d-subnav" count=${navCount(`group:${g.id}`)} onClick=${() => go(`group:${g.id}`)} onDrop=${id => fire(move(id, g.id))} />`)}</div>`)}</nav>
      <button class="d-add-list" onClick=${() => setModal({ kind: 'list' })}><${Icon} name="plus" size=${15} />新建清单</button>
      <div class="d-sidebar-bottom"><nav class="d-nav secondary"><${NavItem} active=${view === 'completed'} icon="check" label="已完成" onClick=${() => go('completed')} /><${NavItem} active=${view === 'trash'} icon="trash" label="回收站" onClick=${() => go('trash')} /></nav>
        <div class="d-sidebar-footer"><span class=${`d-save-state ${error ? 'error' : ''}`}><i class=${pending ? 'saving' : ''}></i>${error ? '保存遇到问题' : pending ? '正在保存…' : '已保存在本机'}</span><${IconButton} icon="settings" label="设置 ⌘," onClick=${() => setModal({ kind: 'settings' })} /></div>
      </div>
    </aside>
    <div class="d-main">
      <div class="d-toolbar"><span class="d-toolbar-date">${new Date(clock).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</span><label class="d-search"><${Icon} name="search" size=${16} /><input ref=${search} aria-label="搜索所有任务" placeholder="搜索任务" value=${query} onInput=${e => setQuery(e.target.value)} /><kbd>⌘ K</kbd>${query && html`<button aria-label="清除搜索" onClick=${() => setQuery('')}><${Icon} name="close" size=${14} /></button>`}</label></div>
      <main class="d-main-scroll" ref=${scroller}><div class="d-page" key=${view}>
        <div class="d-page-heading"><div><h1>${title}</h1><p>${query.trim() ? `${rows.length} 个搜索结果` : isTrash ? '删除的任务可以在这里恢复' : view === 'completed' ? `${rows.length} 件已完成或搁置的事` : `${rows.filter(i => !repeatState(i)?.done).length} 件待办${view === 'today' && completedToday ? ` · 今天已完成 ${completedToday} 件` : ''}`}</p></div>
          <${ListOptions} sort=${sort} onSort=${setSort} canSelect=${!isTrash && !!rows.length} onSelect=${() => { setSelecting(!selecting); setSelected(new Set()); }} selecting=${selecting} onEdit=${currentSection ? () => setModal({ kind: 'list', section: currentSection }) : null} isTrash=${isTrash} />
        </div>
        ${!isTrash && view !== 'completed' && html`<div class="d-status-overview" aria-label="按任务状态筛选">${STATES.map(([status,icon,label]) => html`<button class=${statusFilter===status ? 'active' : ''} aria-pressed=${statusFilter===status} aria-label=${`筛选${label}`} onClick=${() => {setStatusFilter(statusFilter===status ? 'all' : status);setLimit(80);setSelecting(false);setSelected(new Set());}}><${Icon} name=${icon} size=${18} /><strong>${matchingRows.filter(i=>i.status===status && !repeatState(i)?.done).length}</strong><span>${label}</span></button>`)}</div>${statusFilter!=='all' && html`<div class="d-active-filter"><span>只看${STATES.find(s=>s[0]===statusFilter)?.[2]}</span><button onClick=${()=>{setStatusFilter('all');setLimit(80);}}>显示全部</button></div>`}`}
        ${!isTrash && view !== 'completed' && !query.trim() && html`<${QuickEntry} key=${view} draft=${quickDrafts.current.get(view) || ''} onDraft=${value => quickDrafts.current.set(view,value)} onAdd=${addQuick} onDetails=${newTask} />`}
        ${selecting && html`<div class="d-bulk"><label><input type="checkbox" aria-label="选择所有结果" checked=${rows.length > 0 && rows.every(i => selected.has(i.id))} onChange=${e => setSelected(e.target.checked ? new Set(rows.slice(0,500).map(i => i.id)) : new Set())} />全选</label><${Button} icon="check" disabled=${!selected.size} onClick=${() => fire(batch('done'))}>完成<//><select aria-label="批量移动到清单" disabled=${!selected.size} value="" onChange=${e => { if (e.target.value) fire(batch('move', e.target.value)); }}><option value="">移到清单…</option>${doc.groups.map(g => html`<option value=${g.id}>${groupName(doc,g.id)}</option>`)}</select><${IconButton} icon="trash" label="将所选任务移入回收站" disabled=${!selected.size} onClick=${() => fire(batch('trash'))} /><${Button} class="quiet" onClick=${() => {setSelecting(false);setSelected(new Set());}}>取消<//></div>`}
        ${buckets.map(([label, items, cls]) => items.length > 0 && html`<${TaskList} key=${label} label=${label} items=${items} class=${cls} rowProps=${rowProps} />`)}
        ${!rows.length && html`<${Empty} icon=${query ? 'search' : view === 'completed' ? 'check' : isTrash ? 'trash' : view === 'today' ? 'sun' : 'inbox'} title=${statusFilter !== 'all' ? '这个状态下还没有任务' : query ? '没有找到任务' : isTrash ? '回收站是空的' : view === 'completed' ? '还没有完成的任务' : view === 'today' ? '今天还没有安排' : view === 'upcoming' ? '接下来还没有安排' : '记下第一件事'} detail=${statusFilter !== 'all' ? '点击其他状态，或在上方添加任务。' : query ? '试试其他关键词。' : isTrash ? '删除的任务会保留在这里。' : view === 'completed' ? '勾选完成后，任务会移到这里。' : view === 'today' ? '在上方输入，直接加入今天。' : view === 'upcoming' ? '在上方输入，默认安排到明天。' : '在上方输入任务，按回车保存。'} />`}
        ${rows.length > limit && html`<${Button} class="d-load-more" onClick=${() => setLimit(limit + 80)}>再显示 ${Math.min(80, rows.length - limit)} 项<//>`}
      </div></main>
    </div>
  </div>
  ${error && html`<div class="d-error-banner" role="alert">${error}<button onClick=${reload}>重试连接</button></div>`}
  ${modal?.kind === 'task' && html`<${TaskEditor} key=${modal.item?.id ?? 'new'} item=${modal.item} title=${modal.title} status=${modal.status} doc=${doc} group=${modal.group} due=${modal.due} onClose=${dismissModal} onTrash=${trash} onSave=${async payload => { await run(modal.item ? 'PATCH' : 'POST', modal.item ? `/api/items/${encoded(modal.item.id)}` : '/api/items', payload); if (modal.draftView) quickDrafts.current.set(modal.draftView,''); showToast(modal.item ? '修改已保存' : '已添加到清单'); }} />`}
  ${modal?.kind === 'settings' && html`<${Preferences} doc=${doc} onChange=${patch => run('PATCH','/api/theme',patch, d => ({...d,theme:{...d.theme,...patch}}))} onClose=${dismissModal} />`}
  ${modal?.kind === 'list' && html`<${ListEditor} section=${modal.section} doc=${doc} onClose=${dismissModal} onSave=${async payload => { const next = await run(modal.section ? 'PATCH' : 'POST', modal.section ? `/api/sections/${encoded(modal.section.id)}` : '/api/sections', payload); const section = modal.section || next.sections.find(s => !doc.sections.some(old => old.id === s.id)); if(section) go(`section:${section.id}`); }} onDelete=${async () => { await run('DELETE', `/api/sections/${encoded(modal.section.id)}`, {}); go('all'); }} />`}
  ${toast && html`<div class="d-toast" role="status"><${Icon} name="check" size=${16} /><span>${toast.message}</span>${toast.action && html`<button onClick=${() => { const a = toast.action; setToast(null); fire(a.run()); }}>${toast.action.label}</button>`}<${IconButton} icon="close" label="关闭提示" onClick=${() => setToast(null)} /></div>`}
  </div>`;
}

function ListOptions({ sort, onSort, canSelect, selecting, onSelect, onEdit, isTrash }) {
  const ref = useRef(null);
  useEffect(() => { const outside = e => { if (!ref.current?.contains(e.target)) ref.current?.removeAttribute('open'); }; const escape = e => { if(e.key==='Escape' && ref.current?.open) {e.preventDefault();e.stopImmediatePropagation();ref.current.removeAttribute('open');ref.current.querySelector('summary').focus();} }; document.addEventListener('pointerdown',outside); document.addEventListener('keydown',escape,true); return () => {document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape,true);}; }, []);
  const close = () => { ref.current?.removeAttribute('open'); ref.current?.querySelector('summary').focus(); };
  return html`<details class="d-view-options" ref=${ref} onKeyDown=${e => { if(e.key === 'Escape') {e.stopPropagation();close();} }}><summary aria-label="清单选项" title="清单选项"><${Icon} name="more" /></summary><div class="d-options-popover">
    ${!isTrash && html`<label>排序<select aria-label="排序方式" value=${sort} onChange=${e => {onSort(e.target.value);close();}}><option value="manual">清单顺序</option><option value="due">日期优先</option><option value="priority">标星优先</option><option value="created">最新添加</option><option value="title">按名称</option></select></label>`}
    ${canSelect && html`<button onClick=${() => {onSelect();close();}}><${Icon} name="check" size=${15} />${selecting ? '取消多选' : '选择多个任务'}</button>`}
    ${onEdit && html`<button onClick=${() => {onEdit();close();}}><${Icon} name="folder" size=${15} />编辑清单</button>`}
    ${isTrash && html`<p>点击「恢复」将任务放回原清单。</p>`}
  </div></details>`;
}

function NavItem({ active, icon, label, count, onClick, color = '', tint, class: cls = '', onDoubleClick, onDrop }) {
  const [over, setOver] = useState(false);
  return html`<button class=${`d-nav-item ${active ? 'active' : ''} ${over ? 'drag-over' : ''} ${cls}`} aria-current=${active ? 'page' : undefined} onClick=${onClick} onDblClick=${onDoubleClick} onDragOver=${e => { if(onDrop && e.dataTransfer.types.includes('application/x-ordo-task')) { e.preventDefault(); setOver(true); e.dataTransfer.dropEffect='move'; } }} onDragLeave=${() => setOver(false)} onDrop=${e => { e.preventDefault(); setOver(false); const id=e.dataTransfer.getData('application/x-ordo-task'); if(id && onDrop) onDrop(id); }}><span class=${`d-nav-icon ${color}`} style=${tint ? {color:tint} : undefined}><${Icon} name=${icon} size=${18} /></span><span class="d-nav-label">${label}</span>${count > 0 && html`<span class="d-nav-count">${count}</span>`}</button>`;
}

function TaskList({ label, items, rowProps, class: cls = '' }) {
  const ref = useRef(null), positions = useRef(new Map());
  useLayoutEffect(() => {
    const rows = [...(ref.current?.querySelectorAll('.d-task') ?? [])];
    const next = new Map(rows.map(el => [el.dataset.id, {x:el.offsetLeft,y:el.offsetTop}]));
    if (!reduced()) rows.forEach(el => {
      const old = positions.current.get(el.dataset.id), current = next.get(el.dataset.id);
      if (old != null && (old.x !== current.x || old.y !== current.y)) el.animate([{ transform: `translate(${old.x-current.x}px,${old.y-current.y}px)` }, {transform:'translate(0,0)'}], {duration:240,easing:'cubic-bezier(.2,.8,.2,1)'});
    });
    positions.current = next;
  }, [items.map(i => i.id).join('|')]);
  return html`<section class=${`d-task-section ${cls}`}>${label && html`<div class="d-task-section-heading"><span>${label}</span></div>`}<div class="d-task-list" ref=${ref}>${items.map(item => html`<${TaskRow} key=${item.id} item=${item} ...${rowProps} />`)}</div></section>`;
}
function TaskRow({ item, doc, onOpen, onComplete, onStatus, onSeen, onStar, onRestore, selecting, selected, toggleSelected, finishing, isTrash }) {
  const repeat = repeatState(item), done = repeat ? repeat.done : !OPEN(item), closing = finishing.has(item.id), starred = (item.priority ?? 0) >= 2;
  const agent = item.status === 'agent', detail = agent ? item.agent?.note || item.note : item.status === 'waiting' ? item.waitingOn || item.note : item.note;
  const stale = agent && item.agent?.lastSeen && hoursSince(item.agent.lastSeen) > (doc.settings?.staleHours ?? 3);
  return html`<article class=${`d-task d-task-card ${done || closing ? 'done' : ''} ${closing ? 'completing' : ''} ${selected.has(item.id) ? 'selected' : ''}`} data-id=${item.id} draggable=${!isTrash && !selecting} onDragStart=${e => {e.dataTransfer.setData('application/x-ordo-task',item.id);e.dataTransfer.effectAllowed='move';}}>
    <div class="d-card-top">${selecting && html`<input class="d-select-task" type="checkbox" aria-label=${`选择 ${stripMd(item.title)}`} checked=${selected.has(item.id)} onChange=${()=>toggleSelected(item.id)} />`}<button class="d-task-body" aria-label=${`编辑 ${stripMd(item.title)}`} onClick=${()=>selecting ? toggleSelected(item.id) : isTrash ? onRestore(item) : onOpen(item)}><span class="d-task-title">${stripMd(item.title)}</span></button>${!isTrash && html`<${IconButton} icon="star" label=${starred ? '取消重要' : '标为重要'} class=${`d-task-star ${starred ? 'starred' : ''}`} aria-pressed=${starred} onClick=${()=>onStar(item)} />`}</div>
    <div class="d-card-location">${agent ? `交给 ${item.agent?.where || 'Agent'}` : groupName(doc,item.group)}${agent && html`<span> · ${groupName(doc,item.group)}</span>`}</div>
    ${agent && html`<div class="d-card-followup"><span>${item.agent?.since ? `已交接 ${dur(item.agent.since)}` : '手动跟进'}</span><span>${item.agent?.lastSeen ? `上次看 ${ago(item.agent.lastSeen)}` : '还未查看'}</span>${stale && html`<span class="d-stale">待跟进</span>`}</div>`}
    ${detail && html`<p class="d-card-note" title=${detail}>${stripMd(detail)}</p>`}
    <div class="d-task-meta">${item.due && html`<span class=${`d-due ${OPEN(item) && dayOf(item) && dayOf(item)<todayKey() ? 'overdue' : dayOf(item)===todayKey() ? 'today' : ''}`}><${Icon} name="calendar" size=${12}/>${dateLabel(item)}</span>`}${repeat && html`<span><${Icon} name="repeat" size=${12}/>${repeat.label}</span>`}${item.subtasks?.length>0 && html`<span><${Icon} name="list" size=${12}/>${item.subtasks.filter(s=>s.done).length}/${item.subtasks.length}</span>`}</div>
    <div class="d-card-actions">
      ${isTrash ? html`<${Button} icon="restore" onClick=${()=>onRestore(item)}>恢复任务<//>` : html`
        ${agent && !done ? html`<${Button} class="card-primary" onClick=${()=>onSeen(item)}>看过了<//>` : !done && item.status==='todo' ? html`<${Button} class="card-primary" onClick=${()=>onStatus(item,'doing')}>开始做<//>` : null}
        <${Button} class=${`d-task-check ${!agent && item.status!=='todo' ? 'card-primary' : ''} ${done || closing ? 'checked' : ''}`} aria-label=${`${done ? '重新打开' : repeat ? '打卡' : '完成'} ${stripMd(item.title)}`} aria-pressed=${done || closing} icon=${done ? 'restore' : 'check'} onClick=${()=>onComplete(item)}>${done ? '重新打开' : repeat ? '今天做完了' : '做完了'}<//>
        ${!done && html`<${Button} onClick=${()=>agent ? onStatus(item,'doing') : item.status==='waiting' ? onStatus(item,'doing') : onOpen(item,item.status==='doing' ? 'waiting' : 'agent')}>${agent ? '收回自己做' : item.status==='waiting' ? '继续做' : item.status==='doing' ? '等别人' : '交给 Agent'}<//>`}
        <${Button} onClick=${()=>onOpen(item)}>编辑<//>
      `}
    </div>
  </article>`;
}

function QuickEntry({ onAdd, onDetails, draft, onDraft }) {
  const [value,setValue]=useState(draft || ''), [saving,setSaving]=useState(false), ref=useRef(null);
  useLayoutEffect(() => setValue(draft || ''), [draft]);
  const submit=async e => { e.preventDefault(); if(!value.trim() || saving) return; setSaving(true); try { await onAdd(value.trim()); setValue(''); onDraft(''); requestAnimationFrame(() => ref.current?.focus()); } catch {} finally { setSaving(false); } };
  return html`<form class="d-quick-entry" onSubmit=${submit}><${Icon} name="plus" size=${19} /><input ref=${ref} aria-label="快速添加待办" placeholder="添加任务，按回车保存" value=${value} onInput=${e => { setValue(e.target.value); onDraft(e.target.value); }} disabled=${saving} onKeyDown=${e => { if(e.isComposing && e.key === 'Enter') e.preventDefault(); }} />${value.trim() && html`<button type="submit" disabled=${saving}>${saving ? '保存…' : '添加'}</button>`}<button type="button" class="d-quick-details" aria-label="展开新建任务详情" title="填写详情 ⌘N" disabled=${saving} onClick=${() => onDetails(value)}><${Icon} name="more" size=${17} /></button></form>`;
}
