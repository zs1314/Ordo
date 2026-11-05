import { html, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { api } from '../lib/api.js';
import { Dialog, Button, IconButton } from './widgets.js';
import { Icon } from './icons.js';

export const RUN_STATE = { running: '正在执行', stopping: '正在停止', succeeded: '已返回结果', failed: '执行失败', cancelled: '已停止', interrupted: '已中断' };
const runLabel = j => j.status === 'running' ? ({connecting:'正在连接',reconnecting:'正在重连',working:'正在执行'}[j.phase] || '正在执行') : RUN_STATE[j.status];
const executing = j => j && ['running','stopping'].includes(j.status);
const native = body => window.webkit?.messageHandlers?.desktop?.postMessage(body);
export function useCodex(onSync) {
  const [data, setData] = useState(null), live = useRef(true), inflight = useRef(false), signature = useRef(''), sync = useRef(onSync);
  sync.current = onSync;
  const refresh = async () => {
    if (inflight.current) return; inflight.current = true;
    try {
      const next = await api('GET', '/api/desktop/codex');
      if (!live.current) return;
      setData(next); window.ordoActiveRuns = next.running;
      const key = next.jobs.map(j => j.id + j.status).join();
      if (key !== signature.current) { signature.current = key; sync.current?.(); }
    } catch (e) { if (live.current) setData({ connection: { connected: false, message: e.message }, jobs: [] }); }
    finally { inflight.current = false; }
  };
  useEffect(() => {
    live.current = true;
    if (!window.webkit?.messageHandlers?.desktop) return;
    refresh(); const id = setInterval(() => { if (!document.hidden) refresh(); }, 2500);
    return () => { live.current = false; clearInterval(id); };
  }, []);
  return { data, refresh };
}
export function AgentHub({ data, onOpen }) {
  return html`<section class="d-agent-hub"><div class="d-agent-intro"><span class="d-agent-emblem"><${Icon} name="agent" size=${23}/></span><div><strong>Codex，与想法一起行动</strong><p>${data?.connection?.message || '在任务详情中，把一件事交给 Codex。'}</p></div><span class=${`d-connection ${data?.connection?.connected ? 'connected' : ''}`}><i></i>${data?.connection?.connected ? '已登录' : '待登录'}</span></div>
    ${data?.jobs?.length ? html`<div class="d-run-list">${data.jobs.slice(0,8).map(j => html`<button key=${j.id} onClick=${() => onOpen(j)}><span><strong>${j.title}</strong><small>${new Date(j.startedAt).toLocaleString('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</small></span><span class=${`d-run-state ${j.status}`}>${runLabel(j)}</span><${Icon} name="chevron" size=${14}/></button>`)}</div>` : html`<p class="d-agent-guide">打开任意任务 → 交给 Codex → 查看结果 → 确认完成</p>`}
  </section>`;
}
export function AgentPanel({ item, initialJobId, data, refresh, onSync, onComplete, onClose }) {
  const [job, setJob] = useState(null), [jobId, setJobId] = useState(initialJobId || data?.jobs?.find(j => j.itemId === item?.id)?.id || ''), [instructions, setInstructions] = useState(''), [cwd, setCwd] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [connection, setConnection] = useState(data?.connection);
  const drafts = useRef({ instructions: '', cwd: '' }), baseline = useRef({ instructions: '', cwd: '' }), live = useRef(true);
  const dirty = () => JSON.stringify(drafts.current) !== JSON.stringify(baseline.current);
  const change = (key, value) => { drafts.current = {...drafts.current,[key]:value}; window.ordoEditorDirty = dirty(); key === 'cwd' ? setCwd(value) : setInstructions(value); };
  const close = () => { if (busy) return; if (dirty() && !confirm('补充要求尚未提交，确定关闭吗？')) return; onClose(); };
  useEffect(() => { live.current = true; api('GET','/api/desktop/codex?refresh=1').then(d => { if(live.current) setConnection(d.connection); }).catch(e => { if(live.current) setError(e.message); }); return () => { live.current = false; window.ordoEditorDirty = false; }; }, []);
  useEffect(() => {
    if (!jobId) return;
    let disposed = false, pulling = false;
    const fetchJob = async () => {
      if (pulling) return; pulling = true;
      try { const next = await api('GET',`/api/desktop/codex/jobs/${jobId}`); if(!disposed) setJob(next); }
      catch(e) { if(!disposed) setError(e.message); } finally { pulling = false; }
    };
    fetchJob(); const id = setInterval(fetchJob,1200); return () => { disposed = true; clearInterval(id); };
  }, [jobId]);
  useEffect(() => {
    const selected = e => { if (e.detail?.id === 'agent-workspace' && e.detail.path) change('cwd',e.detail.path); };
    addEventListener('ordo-folder',selected); return () => removeEventListener('ordo-folder',selected);
  }, []);
  const start = async () => {
    if (busy) return; setBusy(true); setError('');
    try { const next = await api('POST','/api/desktop/codex/run',{itemId:item.id,instructions,cwd}); baseline.current = {...drafts.current}; window.ordoEditorDirty = false; setJob(next); setJobId(next.id); await refresh(); await onSync(); }
    catch(e) { setError(e.message); } finally { if(live.current) setBusy(false); }
  };
  const stop = async () => { setBusy(true); try { setJob(await api('POST',`/api/desktop/codex/jobs/${jobId}/stop`,{})); await refresh(); } catch(e) { setError(e.message); } finally { if(live.current) setBusy(false); } };
  return html`<${Dialog} title="交给 Codex" onClose=${close} class="d-agent-panel">
    <div class="d-dialog-head"><span class="d-eyebrow">CODEX · 从想法到完成</span><${IconButton} icon="close" label="关闭 Codex 面板" onClick=${close}/></div>
    <div class="d-editor-scroll"><h2 class="d-agent-task-title">${item?.title || job?.title || '执行记录'}</h2>
      <div class=${`d-connection ${connection?.connected ? 'connected' : ''}`}><i></i>${connection?.message || '正在检查 Codex 登录…'}</div>
      ${!executing(job) && item && html`<div class="d-agent-config"><label class="d-text-field">补充要求<textarea data-autofocus rows="3" aria-label="给 Codex 的补充要求" placeholder="期望的结果、限制和交付形式；任务标题、备注和子任务会一并提交。" value=${instructions} onInput=${e => change('instructions',e.target.value)}/></label>
        <label class="d-text-field">工作文件夹<div class="d-workspace-picker"><input aria-label="Codex 工作文件夹" placeholder="留空：为这次任务创建专属文件夹" value=${cwd} onInput=${e => change('cwd',e.target.value)}/><${Button} icon="folder" onClick=${() => native({action:'chooseFolder',id:'agent-workspace'})}>选择<//></div></label><p class="d-pref-note">沿用本机 Codex 登录。点击执行后会提交任务内容，Codex 可以在此文件夹内创建、修改文件，并使用你的 Codex 额度。</p></div>`}
      ${job && html`<div class="d-agent-run"><div class="d-agent-run-heading"><span class=${`d-run-state ${job.status}`}>${executing(job) && html`<i class="d-run-pulse"></i>`}${runLabel(job)}</span><span>${new Date(job.startedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})} 开始</span></div>
        <p class="d-agent-path" title=${job.cwd}>工作文件夹 · ${job.cwd.endsWith(job.id) ? '此任务的专属文件夹' : job.cwd.split('/').filter(Boolean).at(-1)}</p>
        ${job.result && html`<section class="d-agent-result"><h3>执行结果</h3><pre>${job.result}</pre></section>`}
        ${job.connectionIssue && html`<p class="d-network-notice" role="status">${job.connectionIssue}</p>`}
        ${job.error && html`<p class="d-form-error" role="alert">${job.error}</p>`}
        <details class="d-agent-events" open=${executing(job)}><summary>执行记录 · ${job.events.length}</summary><div>${job.events.slice(-35).map((e,n) => html`<div key=${n}><time>${new Date(e.at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</time><span>${e.text}</span></div>`)}</div></details>
      </div>`}
      ${error && html`<p class="d-form-error" role="alert">${error}</p>`}
    </div><div class="d-dialog-foot">${job && html`<${Button} icon="folder" onClick=${() => native({action:'openFolder',path:job.cwd})}>查看文件<//>`}<span class="d-spacer"></span>
      ${executing(job) ? html`<${Button} disabled=${busy || job.status==='stopping'} onClick=${stop}>${job.status==='stopping' ? '正在停止…' : '停止执行'}<//>` : html`${job?.status==='succeeded' && item && item.status!=='done' && html`<${Button} icon="check" disabled=${busy} onClick=${async () => { setBusy(true); try { await onComplete(item); onClose(); } catch(e) { setError(e.message); setBusy(false); } }}>验收并完成<//>`}${item && html`<${Button} class="primary" icon="agent" disabled=${busy || !connection?.connected || data?.running} onClick=${start}>${busy ? '正在提交…' : job ? '重新执行' : '开始执行'}<//>`}`}
    </div>
  <//>`;
}
