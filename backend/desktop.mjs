// macOS-only integration. The standalone upstream server keeps its original behavior.
import { timingSafeEqual } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore, dataDir } from './core/store.mjs';

export const desktopToken = process.env.TODO_DESKTOP_TOKEN || '';
export function desktopAuthorized(req) {
  if (!desktopToken) return true;
  const value = (req.headers.cookie || '').split(';').map(s => s.trim())
    .find(s => s.startsWith('ordo-session='))?.slice('ordo-session='.length) || '';
  const a = Buffer.from(value), b = Buffer.from(desktopToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function prepareDesktop(onShutdown = () => {}) {
  if (!desktopToken) return;
  const original = join(dataDir(), 'todo.db');
  if (existsSync(original)) {
    const before = new DatabaseSync(original);
    try {
      if (before.prepare('PRAGMA user_version').get().user_version < 2) {
        const folder = join(dataDir(), 'backups'); mkdirSync(folder, { recursive: true, mode: 0o700 });
        before.prepare('VACUUM INTO ?').run(join(folder, `before-v2-${Date.now()}.sqlite`));
      }
    } finally { before.close(); }
  }
  const store = openStore();
  // Never reseed an existing board, even after the user deletes every section.
  if (store.load().rev === 0 && !store.getMeta('desktopInitialized')) {
    store.mutate(doc => {
      doc.sections = [
        { id: 'inbox', title: '收件箱', sub: '先记下来，再慢慢安排', order: 10 },
        { id: 'work', title: '工作', sub: '让重要的事向前一步', order: 20 },
        { id: 'life', title: '生活', sub: '也为自己留一点时间', order: 30 },
      ];
      doc.groups = doc.sections.map(s => ({ id: s.id + '-list', section: s.id, title: s.title, plain: true, order: 10 }));
      Object.assign(doc.theme, { title: 'Ordo', font: 'system', accent: '#52785e',
        hero: false, width: 1080, showCalendar: false, showStats: true, showDone: true });
      return { op: 'desktop.init' };
    }, 'desktop');
  }
  store.setMeta('desktopInitialized', true);
  process.stdin.resume();
  let stopped = false;
  const stop = () => { if (stopped) return; stopped = true; onShutdown(); store.close(); setTimeout(() => process.exit(0), 2200); };
  process.stdin.on('end', stop);
  process.on('SIGTERM', stop);
}

export function desktopBackup() {
  const dir = mkdtempSync(join(tmpdir(), 'ordo-backup-'));
  let db;
  try {
    db = new DatabaseSync(join(dataDir(), 'todo.db'));
    db.exec('PRAGMA busy_timeout = 5000');
    const file = join(dir, 'todo.sqlite');
    db.prepare('VACUUM INTO ?').run(file);
    return readFileSync(file);
  } finally { db?.close(); rmSync(dir, { recursive: true, force: true }); }
}
