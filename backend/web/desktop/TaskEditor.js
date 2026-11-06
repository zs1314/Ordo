import { html, useState, useRef, useLayoutEffect } from '../vendor/preact-htm.js';
import { Dialog, Button, IconButton } from './widgets.js';
import { Icon } from './icons.js';
import { groupName } from './model.js';
import { AutoTextarea, DateField, Disclosure, SelectField } from './editor-controls.js';

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
  const formRef = useRef(null);
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
  const statusIcon = {todo:'circle',doing:'play',agent:'agent',waiting:'clock',done:'check',dropped:'inbox'}[form.status];
  return html`<${Dialog} title=${item ? '任务详情' : '新建任务'} onClose=${close} autoFocus=${!item} backdropClass="d-editor-backdrop" class=${`d-task-editor ${item ? 'd-inspector' : 'd-composer'}`}>
    <form ref=${formRef} onSubmit=${save} onKeyDown=${e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !e.isComposing) save(e); }}>
      <div class="d-dialog-head"><span class="d-eyebrow"><${Icon} name="list" size=${14}/>${item ? '任务详情' : '新建任务'}</span><${IconButton} icon="close" label="关闭" onClick=${close} /></div>
      <div class="d-editor-scroll">
        <div class="d-editor-title-row"><${AutoTextarea} data-autofocus=${!item || undefined} class="d-title-input" aria-label="任务标题" placeholder="要做什么？" value=${form.title} onInput=${e => change('title', e.target.value)} /><button type="button" class=${`d-important-toggle ${important ? 'on' : ''}`} aria-label=${important ? '取消重要' : '标为重要'} title=${important ? '取消重要' : '标为重要'} aria-pressed=${important} onClick=${() => change('priority',important ? 0 : 3)}><${Icon} name="star" size=${20}/></button></div>
        <div class="d-editor-properties">
          <div class="d-property-row"><span class="d-property-label"><${Icon} name="circle" size=${16}/>状态</span><${SelectField} label="任务状态" icon=${statusIcon} value=${form.status} onChange=${e=>change('status',e.target.value)}><option value="todo">还没做</option><option value="doing">我在做</option><option value="agent">Agent 在做</option><option value="waiting">等别人</option><option value="done">已完成</option>${form.status==='dropped' && html`<option value="dropped">已搁置</option>`}<//></div>
          <div class="d-property-row"><span class="d-property-label"><${Icon} name="folder" size=${16}/>清单</span><${SelectField} label="所属清单" icon="list" value=${form.group} onChange=${e=>change('group',e.target.value)}>${doc.groups.map(g=>html`<option value=${g.id}>${groupName(doc,g.id)}</option>`)}<//></div>
          <${DateField} due=${form.due} onChange=${value=>change('due',value)}/>
        </div>
        ${customDate && html`<label class="d-text-field d-exact-date">日期与时间<input aria-label="截止日期" value=${form.due} onInput=${e => change('due', e.target.value)} /></label>`}
        ${form.status === 'agent' && html`<div class="d-manual-assignment"><div class="d-assignment-heading"><${Icon} name="agent" size=${16}/><span>交接记录</span><small>手动跟进</small></div><label class="d-text-field">交给谁 / 在哪里<input aria-label="Agent 运行位置" placeholder="例如：Claude Code · 本机项目" value=${form.where} onInput=${e=>change('where',e.target.value)} /></label><label class="d-text-field">交接说明<input aria-label="交接说明" placeholder="希望交付什么，下一步看什么" value=${form.agentNote} onInput=${e=>change('agentNote',e.target.value)} /></label><p>仅记录交接，不会启动 Agent。</p></div>`}
        ${form.status === 'waiting' && html`<label class="d-text-field d-waiting-field">在等什么<input aria-label="等待事项" placeholder="例如：等同事确认方案" value=${form.waitingOn} onInput=${e=>change('waitingOn',e.target.value)} /></label>`}
        <div class="d-editor-note"><label for="task-note"><${Icon} name="note" size=${15}/>备注</label><${AutoTextarea} id="task-note" class="d-notes-input" aria-label="备注" placeholder="写下想法、链接或补充说明…" value=${form.note} onInput=${e => change('note', e.target.value)} /></div>
        ${steps ? html`<div class="d-subtasks"><div class="d-section-caption"><span>步骤</span><span>${form.subtasks.filter(s => s.done).length} / ${form.subtasks.length}</span></div>
          ${form.subtasks.map(s => html`<div class="d-subtask ${s.done ? 'is-done' : ''}" key=${s.id}><input type="checkbox" aria-label=${`完成子任务 ${s.title}`} checked=${s.done} onChange=${e => change('subtasks', form.subtasks.map(x => x.id === s.id ? { ...x, done: e.target.checked } : x))} /><input aria-label="子任务标题" value=${s.title} onInput=${e => change('subtasks', form.subtasks.map(x => x.id === s.id ? { ...x, title: e.target.value } : x))} /><${IconButton} icon="close" label="移除子任务" onClick=${() => change('subtasks', form.subtasks.filter(x => x.id !== s.id))} /></div>`)}
          <div class="d-subtask-add"><${Icon} name="plus" size=${16} /><input aria-label="添加子任务" placeholder="添加下一步…" value=${sub} onInput=${e => setSub(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addSub(); } }} /><button type="button" onClick=${addSub} disabled=${!sub.trim()}>添加</button></div>
        </div>` : html`<button type="button" class="d-add-steps" onClick=${() => {setSteps(true);requestAnimationFrame(()=>formRef.current?.querySelector('[aria-label="添加子任务"]')?.focus({preventScroll:true}));}}><${Icon} name="plus" size=${16} />添加步骤</button>`}
        <${Disclosure} class="d-advanced" summary=${html`<${Icon} name="down" size=${13}/><span>更多选项</span>${(form.days.length > 0 || form.tags.trim()) && html`<small>${[form.days.length ? '重复' : '',form.tags.trim() ? '标签' : ''].filter(Boolean).join(' · ')}</small>`}`}>
          <div class="d-property-row"><span class="d-property-label"><${Icon} name="repeat" size=${15}/>重复</span><${SelectField} label="重复规则" icon="repeat" value=${repeat} onChange=${e=>change('days',({daily:[0,1,2,3,4,5,6],weekdays:[1,2,3,4,5],weekends:[0,6],custom:[new Date().getDay()],none:[]})[e.target.value])}><option value="none">不重复</option><option value="daily">每天</option><option value="weekdays">工作日</option><option value="weekends">周末</option><option value="custom">自定义星期</option><//></div>
          ${form.days.length ? html`<div class="d-repeat-options"><div class="d-weekdays">${[1,2,3,4,5,6,0].map((day, i) => html`<button type="button" aria-label=${`周${'一二三四五六日'[i]}`} aria-pressed=${form.days.includes(day)} class=${form.days.includes(day) ? 'on' : ''} onClick=${() => change('days', form.days.includes(day) ? form.days.filter(d => d !== day) : [...form.days, day])}>${'一二三四五六日'[i]}</button>`)}</div><label class="d-time">每日重置时间<input aria-label="每日重置时间" type="time" value=${form.time} onChange=${e => change('time', e.target.value)} /></label></div>` : null}
          <label class="d-text-field">标签<input aria-label="标签" placeholder="用逗号分隔" value=${form.tags} onInput=${e => change('tags', e.target.value)} /></label>
        <//>
        ${error ? html`<p class="d-form-error" role="alert">${error}</p>` : null}
      </div>
      <div class="d-dialog-foot">${item ? html`<${IconButton} icon="trash" label="移入回收站" onClick=${async () => { if (saving) return; setSaving(true); try { await onTrash(item); onClose(); } catch(e) { setError(e.message); setSaving(false); } }} />` : null}<span class="d-spacer"></span><span class="d-hint">⌘ ↵</span><${Button} class="quiet" onClick=${close} disabled=${saving}>取消<//><${Button} type="submit" class="primary" disabled=${saving || !form.title.trim() || !form.group}>${saving ? '保存中…' : item ? '保存修改' : '添加待办'}<//></div>
    </form>
  <//>`;
}
