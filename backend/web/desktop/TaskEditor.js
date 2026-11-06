import { html, useState, useRef, useLayoutEffect } from '../vendor/preact-htm.js';
import { Dialog, Button, IconButton } from './widgets.js';
import { Icon } from './icons.js';
import { groupName, dayOf, todayKey, tomorrowKey } from './model.js';

function initial(item, group, due, title, status) {
  return { title: item?.title ?? title ?? '', note: item?.note ?? '', group: item?.group ?? group,
    due: item?.due ?? due ?? '', status: status ?? item?.status ?? 'todo', priority: item?.priority ?? 0,
    tags: (item?.tags ?? []).join(', '), subtasks: item?.subtasks ?? [],
    days: item?.repeat?.days ?? [], time: item?.repeat?.time ?? '',
    where: item?.agent?.where ?? '', agentNote: item?.agent?.note ?? '', waitingOn: item?.waitingOn ?? '', reason: item?.reason ?? '' };
}
export function TaskEditor({ item, title, status, doc, group, due, onSave, onTrash, onClose }) {
  const baseline = useRef(initial(item, group, due, title));
  const [form, setForm] = useState(() => initial(item, group, due, title, status)), [sub, setSub] = useState(''), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [steps, setSteps] = useState(!!item?.subtasks?.length);
  useLayoutEffect(() => { window.ordoEditorDirty = JSON.stringify(form) !== JSON.stringify(baseline.current) || !!sub.trim(); return () => { window.ordoEditorDirty = false; }; }, [form, sub]);
  const change = (key, value) => setForm(old => ({ ...old, [key]: value }));
  const close = () => { if (saving) return; if ((JSON.stringify(form) !== JSON.stringify(baseline.current) || sub.trim()) && !confirm('还有未保存的修改，确定放弃吗？')) return; onClose(); };
  const save = async e => {
    e?.preventDefault();
    if (saving || !form.title.trim()) return;
    setSaving(true); setError('');
    const payload = { title: form.title.trim(), note: form.note, group: form.group, due: form.due.trim(), status: form.status,
      priority: form.priority, tags: form.tags.split(/[,，]/).map(s => s.trim()).filter(Boolean), subtasks: [...form.subtasks, ...(sub.trim() ? [{ id: crypto.randomUUID(), title: sub.trim(), done: false }] : [])],
      repeat: form.days.length ? { days: form.days, time: form.time } : null,
      waitingOn: form.waitingOn, reason: form.reason, ...(form.status === 'agent' ? {agent:{where:form.where,note:form.agentNote}} : {}) };
    try { await onSave(payload); onClose(); } catch (e) { setError(e.message); setSaving(false); }
  };
  const addSub = () => { if (!sub.trim()) return; change('subtasks', [...form.subtasks, { id: crypto.randomUUID(), title: sub.trim(), done: false }]); setSub(''); };
  const repeat = form.days.length === 7 ? 'daily' : JSON.stringify([...form.days].sort()) === '[1,2,3,4,5]' ? 'weekdays' : JSON.stringify([...form.days].sort()) === '[0,6]' ? 'weekends' : form.days.length ? 'custom' : 'none';
  const important = form.priority >= 2;
  const customDate = form.due && !/^\d{4}-\d{2}-\d{2}$/.test(form.due);
  return html`<${Dialog} title=${item ? '任务详情' : '新建任务'} onClose=${close} class=${item ? 'd-inspector' : 'd-composer'}>
    <form onSubmit=${save} onKeyDown=${e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') save(e); }}>
      <div class="d-dialog-head"><span class="d-eyebrow">${item ? '任务详情' : '新建任务'}</span><${IconButton} icon="close" label="关闭" onClick=${close} /></div>
      <div class="d-editor-scroll">
        <textarea data-autofocus class="d-title-input" rows="2" aria-label="任务标题" placeholder="要做什么？" value=${form.title} onInput=${e => change('title', e.target.value)} />
        <label class="d-status-field"><span>当前状态</span><select aria-label="任务状态" value=${form.status} onChange=${e=>change('status',e.target.value)}><option value="todo">还没做</option><option value="doing">我在做</option><option value="agent">Agent 在做</option><option value="waiting">等别人</option><option value="done">已完成</option>${form.status==='dropped' && html`<option value="dropped">已搁置</option>`}</select></label>
        ${form.status === 'agent' && html`<div class="d-manual-assignment"><p>手动记录交接，不会启动 Agent。</p><label class="d-text-field">交给谁 / 在哪里<input aria-label="Agent 运行位置" placeholder="例如：Claude Code · 本机项目" value=${form.where} onInput=${e=>change('where',e.target.value)} /></label><label class="d-text-field">交接说明<input aria-label="交接说明" placeholder="希望交付什么，下一步看什么" value=${form.agentNote} onInput=${e=>change('agentNote',e.target.value)} /></label></div>`}
        ${form.status === 'waiting' && html`<label class="d-text-field">在等什么<input aria-label="等待事项" placeholder="例如：等同事确认方案" value=${form.waitingOn} onInput=${e=>change('waitingOn',e.target.value)} /></label>`}
        <div class="d-task-basics"><label class="d-editor-list"><${Icon} name="folder" size=${16} /><select aria-label="所属清单" value=${form.group} onChange=${e => change('group', e.target.value)}>${doc.groups.map(g => html`<option value=${g.id}>${groupName(doc, g.id)}</option>`)}</select></label><button type="button" class=${`d-important-toggle ${important ? 'on' : ''}`} aria-pressed=${important} onClick=${() => change('priority',important ? 0 : 3)}><${Icon} name="star" size=${16} />${important ? '已标星' : '标星'}</button></div>
        <div class="d-simple-date"><label for="task-date"><${Icon} name="calendar" size=${16} />日期</label><input id="task-date" aria-label="选择日期" type="date" value=${dayOf({ due: form.due })} onChange=${e => change('due', e.target.value)} /><div class="d-date-presets">${[['今天',todayKey()],['明天',tomorrowKey()]].map(([label,value]) => html`<button type="button" aria-pressed=${form.due === value} onClick=${() => change('due',value)}>${label}</button>`)}${form.due && html`<button type="button" aria-label="清除日期" onClick=${() => change('due','')}>清除</button>`}</div></div>
        ${customDate && html`<label class="d-text-field">日期与时间<input aria-label="截止日期" value=${form.due} onInput=${e => change('due',e.target.value)} /></label>`}
        <textarea class="d-notes-input" rows="2" aria-label="备注" placeholder="添加备注或链接…" value=${form.note} onInput=${e => change('note', e.target.value)} />
        ${steps ? html`<div class="d-subtasks"><div class="d-section-caption"><span>步骤</span><span>${form.subtasks.filter(s => s.done).length} / ${form.subtasks.length}</span></div>
          ${form.subtasks.map(s => html`<div class="d-subtask" key=${s.id}><input type="checkbox" aria-label=${`完成子任务 ${s.title}`} checked=${s.done} onChange=${e => change('subtasks', form.subtasks.map(x => x.id === s.id ? { ...x, done: e.target.checked } : x))} /><input aria-label="子任务标题" value=${s.title} onInput=${e => change('subtasks', form.subtasks.map(x => x.id === s.id ? { ...x, title: e.target.value } : x))} /><${IconButton} icon="close" label="移除子任务" onClick=${() => change('subtasks', form.subtasks.filter(x => x.id !== s.id))} /></div>`)}
          <div class="d-subtask-add"><${Icon} name="plus" size=${16} /><input aria-label="添加子任务" placeholder="添加步骤，回车确认" value=${sub} onInput=${e => setSub(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addSub(); } }} /><button type="button" onClick=${addSub} disabled=${!sub.trim()}>添加</button></div>
        </div>` : html`<button type="button" class="d-add-steps" onClick=${() => setSteps(true)}><${Icon} name="list" size=${16} />添加步骤</button>`}
        <details class="d-advanced"><summary>更多选项${(form.days.length > 0 || form.tags.trim()) && html`<span>${[form.days.length ? '重复' : '',form.tags.trim() ? '标签' : ''].filter(Boolean).join(' · ')}</span>`}</summary><div>
          <label class="d-text-field">重复<select aria-label="重复规则" value=${repeat} onChange=${e => change('days', ({ daily: [0,1,2,3,4,5,6], weekdays: [1,2,3,4,5], weekends: [0,6], custom: [new Date().getDay()], none: [] })[e.target.value])}><option value="none">不重复</option><option value="daily">每天</option><option value="weekdays">工作日</option><option value="weekends">周末</option><option value="custom">自定义星期</option></select></label>
          ${form.days.length ? html`<div class="d-repeat-options"><div class="d-weekdays">${[1,2,3,4,5,6,0].map((day, i) => html`<button type="button" aria-label=${`周${'一二三四五六日'[i]}`} aria-pressed=${form.days.includes(day)} class=${form.days.includes(day) ? 'on' : ''} onClick=${() => change('days', form.days.includes(day) ? form.days.filter(d => d !== day) : [...form.days, day])}>${'一二三四五六日'[i]}</button>`)}</div><label class="d-time">每日重置时间<input aria-label="每日重置时间" type="time" value=${form.time} onChange=${e => change('time', e.target.value)} /></label></div>` : null}
          <label class="d-text-field">标签<input aria-label="标签" placeholder="用逗号分隔" value=${form.tags} onInput=${e => change('tags', e.target.value)} /></label>

        </div></details>
        ${error ? html`<p class="d-form-error" role="alert">${error}</p>` : null}
      </div>
      <div class="d-dialog-foot">${item ? html`<${IconButton} icon="trash" label="移入回收站" onClick=${async () => { if (saving) return; setSaving(true); try { await onTrash(item); onClose(); } catch(e) { setError(e.message); setSaving(false); } }} />` : html`<span class="d-hint">⌘ ↵ 保存</span>`}<span class="d-spacer"></span><${Button} onClick=${close} disabled=${saving}>取消<//><${Button} type="submit" class="primary" disabled=${saving || !form.title.trim() || !form.group}>${saving ? '保存中…' : item ? '保存修改' : '添加待办'}<//></div>
    </form>
  <//>`;
}
