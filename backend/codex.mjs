import { spawn, execFile } from 'node:child_process';
import { accessSync, constants, mkdirSync, statSync, realpathSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { dataDir, openStore } from './core/store.mjs';

const exec = promisify(execFile);
const active = job => ['running', 'stopping'].includes(job.status);
const fail = (message, code = 400) => Object.assign(new Error(message), { code });
const stamp = () => new Date().toISOString();
export function codexErrorMessage(message) {
  if (/connection|connect|stream disconnect|timed? ?out|network|dns|tls|socket|连接|网络/i.test(message)) return '无法连接 Codex 服务。请检查系统代理或网络后重试；待办和已生成的文件仍保留。';
  if (/unauthorized|401|auth.*(expired|invalid)|token.*expired/i.test(message)) return 'Codex 登录已失效，请在 Codex 中重新登录后重试。';
  if (/429|rate.?limit|usage.?limit|quota/i.test(message)) return 'Codex 额度或请求频率受限，请稍后重试或检查账户额度。';
  return message || 'Codex 未正常完成，请重试';
}
export function findCodex() {
  const candidates = [process.env.ORDO_CODEX_BIN,
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
    '/Applications/Codex.app/Contents/Resources/codex',
    ...[process.env.PATH || '', '/opt/homebrew/bin:/usr/local/bin', join(homedir(), '.local/bin')].flatMap(p => p.split(':').filter(Boolean).map(p => join(p, 'codex')))];
  return candidates.find(p => { try { accessSync(p, constants.X_OK); return statSync(p).isFile(); } catch { return false; } }) || '';
}

export function createCodexRunner({ store = openStore(), root = dataDir(), binary = findCodex(), reconnectTimeoutMs = 90000 } = {}) {
  let jobs = store.getMeta('ordoCodexJobs') || [], child = null, running = null, starting = false, closed = false, timer = null, authCache = null;
  const persist = () => { clearTimeout(timer); timer = null; store.setMeta('ordoCodexJobs', jobs); };
  const schedule = () => { if (!timer) timer = setTimeout(persist, 350); };
  const event = (job, text, kind = 'info') => {
    job.events.push({ at: stamp(), kind, text: String(text).slice(0, 6000) });
    job.events = job.events.slice(-150); job.updatedAt = stamp(); schedule();
  };
  const updateTask = (job, state) => store.mutate(doc => {
    const task = doc.items.find(i => i.id === job.itemId);
    if (!task || (state !== 'running' && !(task.status === 'agent' && task.agent?.where === 'Codex'))) return null;
    task.updatedAt = stamp();
    if (state === 'running') { task.status = 'agent'; task.agent = { where: 'Codex', note: '正在执行', since: stamp() }; }
    else if (state === 'succeeded') { task.status = 'waiting'; task.waitingOn = 'Codex 已返回结果，等待验收'; }
    else { task.status = 'todo'; if (task.agent) task.agent.note = state === 'cancelled' ? '已停止' : '执行未完成，可重试'; }
    return { op: 'codex.' + state, id: task.id, runId: job.id };
  }, 'codex');
  for (const job of jobs.filter(active)) {
    job.status = 'interrupted'; job.error = '上次运行随应用退出而中断，可以重新执行。'; job.finishedAt = stamp();
    updateTask(job, 'interrupted');
  }
  persist();
  const connection = async (fresh = false) => {
    if (authCache && !fresh && Date.now() - authCache.at < 30000) return authCache.value;
    if (!binary) return { available: false, connected: false, message: '未找到 Codex。请安装并登录 Codex 后重新打开 Ordo。' };
    let value;
    try {
      const r = await exec(binary, ['login', 'status'], { timeout: 10000, maxBuffer: 32768 });
      const output = r.stdout + r.stderr;
      const loggedIn = /logged in/i.test(output) && !/not logged in/i.test(output);
      value = { available: true, connected: loggedIn, message: loggedIn ? '已登录本机 Codex' : '请先在 Codex 中登录' };
    } catch { value = { available: true, connected: false, message: 'Codex 尚未登录，或登录状态暂时不可用' }; }
    authCache = { at: Date.now(), value }; return value;
  };
  const summarize = j => { const { events, result, instructions, error, ...summary } = j; return summary; };
  const get = id => { const job = jobs.find(j => j.id === id); if (!job) throw fail('找不到这次执行记录', 404); return structuredClone(job); };
  const stopProcess = proc => {
    if (!proc?.pid) return;
    try { process.kill(-proc.pid, 'SIGTERM'); } catch { try { proc.kill('SIGTERM'); } catch {} }
    const force = setTimeout(() => { try { process.kill(-proc.pid, 'SIGKILL'); } catch {} }, 2000);
    force.unref();
  };
  return {
    async status(fresh = false) { return { connection: await connection(fresh), jobs: jobs.map(summarize), running: !!child || starting }; },
    get,
    async start({ itemId, instructions = '', cwd = '' } = {}) {
      if (closed) throw fail('应用正在退出', 409);
      if (child || starting) throw fail('已有任务正在执行，请等待完成或先停止它', 409);
      if (typeof itemId !== 'string' || typeof instructions !== 'string' || instructions.length > 20000 || typeof cwd !== 'string') throw fail('任务参数无效');
      starting = true;
      try {
        if (!(await connection(true)).connected) throw fail('请先在 Codex 中登录，再重试', 409);
        if (closed) throw fail('应用正在退出', 409);
        const task = store.load().items.find(i => i.id === itemId);
        if (!task) throw fail('任务不存在，或已经移入回收站', 404);
        const id = randomUUID(), directory = join(root, 'Agent Tasks', id);
        if (cwd) {
          if (!isAbsolute(cwd)) throw fail('请选择绝对路径的工作文件夹');
          try { cwd = realpathSync(cwd); if (!statSync(cwd).isDirectory()) throw new Error(); } catch { throw fail('工作文件夹不存在'); }
        } else { mkdirSync(directory, { recursive: true, mode: 0o700 }); cwd = directory; }
        // A folder selected by the user is the only writable project root. No shell interpolation.
        const job = { id, itemId, title: task.title, instructions, cwd, status: 'running', phase: 'connecting', startedAt: stamp(), updatedAt: stamp(), events: [], result: '' };
        const prompt = `你正在执行 Ordo 中用户明确交给 Codex 的待办。请实际完成可执行的工作，并用中文说明结果、生成或修改的文件及需要用户处理的事项。遵守工作目录内的项目指令。不要自行对外发送消息、发布或部署；如任务需要这些操作，先准备可审阅的结果并说明。\n\n任务：${task.title}\n备注：${task.note || '无'}\n子任务：${(task.subtasks || []).map(s => `${s.done ? '[x]' : '[ ]'} ${s.title}`).join('\n') || '无'}\n补充要求：${instructions || '无'}\n\n当前工作目录：${cwd}`;
        // Use the user's existing macOS proxy/PAC for Codex's own service requests.
        // This is an invocation-only setting; it does not edit global Codex configuration.
        const args = ['exec', '--json', '--color', 'never', '--sandbox', 'workspace-write', '--enable', 'respect_system_proxy', '-c', 'approval_policy="never"', '--skip-git-repo-check', '-C', cwd, '-'];
        const env = { ...process.env, PATH: [...new Set((process.env.PATH || '').split(':').concat(['/opt/homebrew/bin','/usr/local/bin','/usr/bin','/bin']))].join(':') };
        delete env.TODO_DESKTOP_TOKEN; delete env.TODO_DIR; delete env.TODO_PORT;
        jobs.unshift(job); jobs = jobs.slice(0, 100); updateTask(job, 'running'); persist();
        running = job;
        let buffer = '', errors = '', turnCompleted = false, finished = false, reconnectSince = 0, watchdog = null, forcedFailure = '';
        const progress = () => {
          reconnectSince = 0; job.phase = 'working'; delete job.connectionIssue; delete job.error;
        };
        const finish = (code, error) => {
          clearInterval(watchdog);
          if (finished || closed) return; finished = true;
          child = null; running = null;
          if (job.status === 'stopping') job.status = 'cancelled';
          else job.status = code === 0 && turnCompleted && !forcedFailure ? 'succeeded' : 'failed';
          job.finishedAt = stamp(); job.exitCode = code;
          if (job.status === 'failed') job.error = codexErrorMessage(forcedFailure || error || job.error || errors.trim().slice(-4000));
          else delete job.error;
          delete job.connectionIssue; delete job.phase;
          event(job, job.status === 'succeeded' ? '执行结束，等待你验收结果' : job.status === 'cancelled' ? '已停止执行' : job.error, job.status === 'failed' ? 'error' : 'info');
          updateTask(job, job.status); persist();
        };
        try {
          child = spawn(binary, args, { cwd, env, detached: true, stdio: ['pipe','pipe','pipe'] });
          child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
          child.stdout.on('data', chunk => {
            if (closed || finished) return;
            buffer += chunk;
            if (buffer.length > 2000000) buffer = buffer.slice(-1000000);
            let end;
            while ((end = buffer.indexOf('\n')) >= 0) {
              const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
              let e; try { e = JSON.parse(line); } catch { continue; }
              if (e.type === 'thread.started') { job.threadId = e.thread_id; event(job, '会话已创建，正在连接 Codex 服务'); }
              if (e.type === 'turn.completed') { turnCompleted = true; job.usage = e.usage; progress(); }
              if (e.type === 'turn.failed' || e.type === 'error') {
                const message = e.error?.message || e.message || 'Codex 执行遇到错误';
                if (e.type === 'error' && /reconnecting/i.test(message)) {
                  reconnectSince ||= Date.now(); job.phase = 'reconnecting';
                  const attempt = message.match(/(\d+)\s*\/\s*(\d+)/)?.[0];
                  job.connectionIssue = `连接中断，正在重试${attempt ? `（${attempt}）` : ''}。长时间无法恢复时会结束并保留任务。`;
                  event(job, message, 'retry');
                } else { job.error = message; event(job, message, 'error'); }
              }
              const i = e.item;
              if (i) progress();
              if (i && e.type === 'item.completed') {
                if (i.type === 'agent_message') { job.result = String(i.text || '').slice(-200000); event(job, i.text || '', 'message'); }
                if (i.type === 'command_execution') event(job, `${i.command || '执行命令'}${i.exit_code != null ? ` · 退出码 ${i.exit_code}` : ''}`, 'command');
                if (i.type === 'file_change') event(job, (i.changes || []).map(c => `${c.kind || '更新'} ${c.path}`).join('\n') || '已更新文件', 'file');
                if (i.type === 'web_search') event(job, '正在检索相关信息');
              }
            }
          });
          child.stderr.on('data', text => { errors = (errors + text).slice(-12000); });
          child.on('error', e => finish(null, e.message)); child.on('close', code => finish(code));
          watchdog = setInterval(() => {
            if (closed || finished) { clearInterval(watchdog); return; }
            if (reconnectSince && Date.now() - reconnectSince > reconnectTimeoutMs && job.status !== 'stopping' && !forcedFailure) {
              forcedFailure = '网络连接重试超时'; job.connectionIssue = '连接暂时无法恢复，正在结束本次执行…';
              event(job, '网络重试超时，本次任务将保留为待办；可以稍后重试', 'error');
              stopProcess(child);
            }
          }, Math.min(1000, reconnectTimeoutMs));
          watchdog.unref();
          child.stdin.on('error', () => {}); child.stdin.end(prompt);
          event(job, '任务已提交；工作文件夹内的修改会保留');
        } catch (e) { finish(null, e.message); }
        return get(id);
      } finally { starting = false; }
    },
    cancel(id) {
      const job = jobs.find(j => j.id === id); if (!job) throw fail('找不到这次执行记录', 404);
      if (!active(job) || running?.id !== id) return get(id);
      job.status = 'stopping'; event(job, '正在停止 Codex…'); persist(); stopProcess(child); return get(id);
    },
    shutdown() {
      if (closed) return; closed = true;
      if (running) { running.status = 'interrupted'; running.finishedAt = stamp(); running.error = '应用已退出，本次执行已停止。'; updateTask(running, 'interrupted'); }
      stopProcess(child); child = null; persist();
    }
  };
}
