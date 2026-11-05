import { html, useState, useRef, useEffect } from '../vendor/preact-htm.js';
import { Dialog, Button, IconButton } from './widgets.js';
import { Icon } from './icons.js';
import { STATUS, PRIORITY, groupName, dayOf, todayKey, tomorrowKey } from './model.js';

function initial(item, group, due) {
  return { title: item?.title ?? '', note: item?.note ?? '', group: item?.group ?? group,
    due: item?.due ?? due ?? '', status: item?.status ?? 'todo', priority: item?.priority ?? 0,
    tags: (item?.tags ?? []).join(', '), subtasks: item?.subtasks ?? [],
    days: item?.repeat?.days ?? [], time: item?.repeat?.time ?? '',
    where: item?.agent?.where ?? '', agentNote: item?.agent?.note ?? '', waitingOn: item?.waitingOn ?? '', reason: item?.reason ?? '' };
}
export function TaskEditor({ item, doc, group, due, onSave, onTrash, onClose, onAgent }) {
  const baseline = useRef(initial(item, group, due));
  const [form, setForm] = useState(baseline.current), [sub, setSub] = useState(''), [saving, setSaving] = useState(false), [error, setError] = useState('');
  useEffect(() => { window.ordoEditorDirty = JSON.stringify(form) !== JSON.stringify(baseline.current) || !!sub.trim(); return () => { window.ordoEditorDirty = false; }; }, [form, sub]);
  const change = (key, value) => setForm(old => ({ ...old, [key]: value }));
  const close = () => { if (saving) return; if ((JSON.stringify(form) !== JSON.stringify(baseline.current) || sub.trim()) && !confirm('还有未保存的修改，确定放弃吗？')) return; onClose(); };
  const save = async (e, handoff = false) => {
    e?.preventDefault();
    if (saving || !form.title.trim()) return;
    setSaving(true); setError('');
    const payload = { title: form.title.trim(), note: form.note, group: form.group, due: form.due.trim(), status: form.status,
      priority: +form.priority, tags: form.tags.split(/[,，]/).map(s => s.trim()).filter(Boolean), subtasks: [...form.subtasks, ...(sub.trim() ? [{ id: crypto.randomUUID(), title: sub.trim(), done: false }] : [])],
      repeat: form.days.length ? { days: form.days, time: form.time } : null,
      waitingOn: form.waitingOn, reason: form.reason,
      ...(form.status === 'agent' ? { agent: { where: form.where, note: form.agentNote } } : {}) };
    try { await onSave(payload); if(handoff) onAgent(); else onClose(); } catch (e) { setError(e.message); setSaving(false); }
  };
  const addSub = () => { if (!sub.trim()) return; change('subtasks', [...form.subtasks, { id: crypto.randomUUID(), title: sub.trim(), done: false }]); setSub(''); };
  const repeat = form.days.length === 7 ? 'daily' : JSON.stringify([...form.days].sort()) === '[1,2,3,4,5]' ? 'weekdays' : JSON.stringify([...form.days].sort()) === '[0,6]' ? 'weekends' : form.days.length ? 'custom' : 'none';
  return html`<${Dialog} title=${item ? '任务详情' : '新建待办'} onClose=${close} class=${item ? 'd-inspector' : 'd-composer'}>
    <form onSubmit=${save} onKeyDown=${e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') save(e); }}>
      <div class="d-dialog-head"><span class="d-eyebrow">${item ? '任务详情' : '记下一件事'}</span><${IconButton} icon="close" label="关闭" onClick=${close} /></div>
      <div class="d-editor-scroll">
        <textarea data-autofocus class="d-title-input" rows="2" aria-label="任务标题" placeholder="要做的事" value=${form.title} onInput=${e => change('title', e.target.value)} />
        <textarea class="d-notes-input" rows="3" aria-label="备注" placeholder="补充一点细节，或粘贴相关链接…" value=${form.note} onInput=${e => change('note', e.target.value)} />
        <div class="d-field-grid">
          <label><span><${Icon} name="folder" size=${16} />清单</span><select aria-label="所属清单" value=${form.group} onChange=${e => change('group', e.target.value)}>${doc.groups.map(g => html`<option value=${g.id}>${groupName(doc, g.id)}</option>`)}</select></label>
          <label><span><${Icon} name="flag" size=${16} />优先级</span><select aria-label="优先级" value=${form.priority} onChange=${e => change('priority', +e.target.value)}>${PRIORITY.map((s, i) => html`<option value=${i}>${s}</option>`)}</select></label>
          <label><span><${Icon} name="circle" size=${16} />状态</span><select aria-label="任务状态" value=${form.status} onChange=${e => change('status', e.target.value)}>${Object.entries(STATUS).map(([v, t]) => html`<option value=${v}>${t}</option>`)}</select></label>
          <label><span><${Icon} name="repeat" size=${16} />重复</span><select aria-label="重复规则" value=${repeat} onChange=${e => change('days', ({ daily: [0,1,2,3,4,5,6], weekdays: [1,2,3,4,5], weekends: [0,6], custom: [new Date().getDay()], none: [] })[e.target.value])}><option value="none">不重复</option><option value="daily">每天</option><option value="weekdays">工作日</option><option value="weekends">周末</option><option value="custom">自定义星期</option></select></label>
        </div>
        ${form.days.length ? html`<div class="d-repeat-options"><div class="d-weekdays">${[1,2,3,4,5,6,0].map((day, i) => html`<button type="button" aria-label=${`周${'一二三四五六日'[i]}`} aria-pressed=${form.days.includes(day)} class=${form.days.includes(day) ? 'on' : ''} onClick=${() => change('days', form.days.includes(day) ? form.days.filter(d => d !== day) : [...form.days, day])}>${'一二三四五六日'[i]}</button>`)}</div><label class="d-time">每日重置时间<input aria-label="每日重置时间" type="time" value=${form.time} onChange=${e => change('time', e.target.value)} /></label></div>` : null}
        <div class="d-date-field"><label><${Icon} name="calendar" size=${16} />截止日期</label><div class="d-date-controls"><input aria-label="截止日期" placeholder="YYYY-MM-DD，可附时间或 AoE" value=${form.due} onInput=${e => change('due', e.target.value)} /><input class="d-date-picker" aria-label="选择日期" type="date" value=${dayOf({ due: form.due })} onChange=${e => change('due', e.target.value)} /></div><div class="d-date-presets"><button type="button" onClick=${() => change('due', todayKey())}>今天</button><button type="button" onClick=${() => change('due', tomorrowKey())}>明天</button><button type="button" onClick=${() => change('due', '')}>无日期</button></div></div>
        ${form.status === 'agent' ? html`<label class="d-text-field">Agent 运行位置<input aria-label="Agent 运行位置" placeholder="例如：本机 / 服务器" value=${form.where} onInput=${e => change('where', e.target.value)} /></label><label class="d-text-field">交接说明<input aria-label="交接说明" value=${form.agentNote} onInput=${e => change('agentNote', e.target.value)} /></label>` : null}
        ${form.status === 'waiting' ? html`<label class="d-text-field">正在等什么<input value=${form.waitingOn} onInput=${e => change('waitingOn', e.target.value)} /></label>` : null}
        ${form.status === 'dropped' ? html`<label class="d-text-field">搁置原因<input value=${form.reason} onInput=${e => change('reason', e.target.value)} /></label>` : null}
        <label class="d-text-field"><span><${Icon} name="tag" size=${16} />标签</span><input aria-label="标签" placeholder="用逗号分隔，如：设计, 个人" value=${form.tags} onInput=${e => change('tags', e.target.value)} /></label>
        <div class="d-subtasks"><div class="d-section-caption"><span>子任务</span><span>${form.subtasks.filter(s => s.done).length} / ${form.subtasks.length}</span></div>
          ${form.subtasks.map(s => html`<div class="d-subtask" key=${s.id}><input type="checkbox" aria-label=${`完成子任务 ${s.title}`} checked=${s.done} onChange=${e => change('subtasks', form.subtasks.map(x => x.id === s.id ? { ...x, done: e.target.checked } : x))} /><input aria-label="子任务标题" value=${s.title} onInput=${e => change('subtasks', form.subtasks.map(x => x.id === s.id ? { ...x, title: e.target.value } : x))} /><${IconButton} icon="close" label="移除子任务" onClick=${() => change('subtasks', form.subtasks.filter(x => x.id !== s.id))} /></div>`)}
          <div class="d-subtask-add"><${Icon} name="plus" size=${16} /><input aria-label="添加子任务" placeholder="添加一个步骤，回车确认" value=${sub} onInput=${e => setSub(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addSub(); } }} /><button type="button" onClick=${addSub} disabled=${!sub.trim()}>添加</button></div>
        </div>
        ${error ? html`<p class="d-form-error" role="alert">${error}</p>` : null}
      </div>
      <div class="d-dialog-foot">${item ? html`<${IconButton} icon="trash" label="移入回收站" onClick=${async () => { if (saving) return; setSaving(true); try { await onTrash(item); onClose(); } catch(e) { setError(e.message); setSaving(false); } }} />` : html`<span class="d-hint">⌘ ↵ 保存</span>`}${item && html`<${Button} icon="agent" disabled=${saving} onClick=${e => save(e,true)}>交给 Codex<//>`}<span class="d-spacer"></span><${Button} onClick=${close} disabled=${saving}>取消<//><${Button} type="submit" class="primary" disabled=${saving || !form.title.trim() || !form.group}>${saving ? '保存中…' : item ? '保存修改' : '添加待办'}<//></div>
    </form>
  <//>`;
}
