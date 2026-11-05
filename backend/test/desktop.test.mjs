import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

test('desktop session, ephemeral port, CRUD, consistent backup, process lifecycle and persistence', { timeout: 15000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ordo-test-'));
  let child;
  async function start() {
    child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
      env: { ...process.env, TODO_DIR: dir, TODO_PORT: '0', TODO_DESKTOP_TOKEN: 'test-secret' },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let log = '';
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('startup timeout')), 5000);
      child.stdout.on('data', chunk => {
        log += chunk;
        const match = /ToDo board on (http:\/\/127\.0\.0\.1:\d+)/.exec(log);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      child.once('error', reject);
    });
    const api = (path, options = {}) => fetch(url + path, {
      ...options, headers: { Cookie: 'ordo-session=test-secret', 'content-type': 'application/json', ...options.headers }
    });
    return { url, api };
  }
  async function stop() {
    const exited = once(child, 'exit');
    child.stdin.end();
    const [code] = await exited;
    assert.equal(code, 0);
  }
  try {
    let { url, api } = await start();
    assert.notEqual(new URL(url).port, '0');
    assert.equal((await fetch(url + '/api/todo')).status, 401);
    assert.equal((await api('/api/items', { method: 'POST', headers: { Origin: 'https://untrusted.example' }, body: '{}' })).status, 403);
    let doc = await (await api('/api/todo')).json();
    assert.deepEqual(doc.sections.map(s => s.title), ['收件箱', '工作', '生活']);
    doc = await (await api('/api/items', { method: 'POST', body: JSON.stringify({ title: 'desktop persistence', group: doc.groups[0].id }) })).json();
    const id = doc.items[0].id;
    await api('/api/items/' + id, { method: 'PATCH', body: JSON.stringify({ status: 'done', note: 'backup includes latest WAL changes' }) });
    const backup = await api('/api/desktop/backup');
    assert.equal(backup.status, 200);
    const backupPath = join(dir, 'backup.sqlite');
    await writeFile(backupPath, Buffer.from(await backup.arrayBuffer()));
    const db = new DatabaseSync(backupPath);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(db.prepare('SELECT status FROM items WHERE id = ?').get(id).status, 'done');
    assert.ok(db.prepare('SELECT count(*) AS n FROM log').get().n >= 3);
    db.close();
    await stop();
    ({ api } = await start());
    doc = await (await api('/api/todo')).json();
    assert.equal(doc.items.find(i => i.id === id).status, 'done');
    assert.equal(doc.sections.length, 3);
    await stop();
  } finally {
    if (child && child.exitCode === null) child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});
