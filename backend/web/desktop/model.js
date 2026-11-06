import { dueInfo, ymd } from '../lib/due.js';
import { repeatState } from '../lib/repeat.js';

export const STATUS = { todo: '待办', doing: '进行中', waiting: '等待中', agent: '已交给 Agent', done: '已完成', dropped: '已搁置' };
export const PRIORITY = ['无优先级', '低优先级', '中优先级', '高优先级'];
export const OPEN = i => !['done', 'dropped'].includes(i.status);
export const dayOf = i => i.due ? dueInfo(i.due)?.key ?? '' : '';
export const todayKey = () => ymd(new Date());
export function tomorrowKey() { const d = new Date(); d.setDate(d.getDate() + 1); return ymd(d); }
export function groupName(doc, id) {
  const g = doc.groups.find(g => g.id === id), s = doc.sections.find(s => s.id === g?.section);
  return !g ? '未分组' : !s || s.title === g.title ? g.title : `${s.title} / ${g.title}`;
}
export function matches(i, query, doc) {
  const haystack = [i.title, i.note, ...(i.tags ?? []), ...(i.subtasks ?? []).map(s => s.title), groupName(doc, i.group)].join(' ').toLocaleLowerCase();
  return query.trim().toLocaleLowerCase().split(/\s+/).every(word => haystack.includes(word));
}
export function inView(i, view, doc, today = todayKey()) {
  if (view === 'completed') return !OPEN(i);
  if (!OPEN(i)) return false;
  if (view === 'today') { const r = repeatState(i); return r ? r.scheduled : !!dayOf(i) && dayOf(i) <= today; }
  if (view === 'upcoming') return !!dayOf(i) && dayOf(i) > today;
  if (view === 'important') return (i.priority ?? 0) >= 2;
  if (view === 'habits') return !!i.repeat?.days?.length;
  if (view === 'agent') return i.status === 'agent' || i.status === 'waiting';
  if (view.startsWith('group:')) return i.group === view.slice(6);
  if (view.startsWith('section:')) return doc.groups.some(g => g.id === i.group && g.section === view.slice(8));
  return true;
}
export function sortTasks(items, sort) {
  return [...items].sort((a, b) => {
    if (sort === 'due') return (dayOf(a) || '9999').localeCompare(dayOf(b) || '9999') || (b.priority ?? 0) - (a.priority ?? 0);
    if (sort === 'priority') return (b.priority ?? 0) - (a.priority ?? 0) || (a.order ?? 0) - (b.order ?? 0);
    if (sort === 'created') return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
    if (sort === 'title') return a.title.localeCompare(b.title, 'zh-CN');
    return (a.order ?? 0) - (b.order ?? 0);
  });
}
export function dateLabel(i) {
  const day = dayOf(i);
  if (!day) return i.due || '';
  if (day === todayKey()) return '今天';
  if (day === tomorrowKey()) return '明天';
  const [y, m, d] = day.split('-');
  return `${Number(y) === new Date().getFullYear() ? '' : y + '/'}${Number(m)}月${Number(d)}日`;
}
export function smartTitle(view, doc) {
  return ({ today: '今天', upcoming: '接下来', all: '全部待办', important: '重要', habits: '习惯打卡', completed: '已完成', trash: '回收站', agent: 'Codex 协作', calendar: '日历' })[view]
    ?? (view.startsWith('section:') ? doc.sections.find(s => s.id === view.slice(8))?.title : doc.groups.find(g => g.id === view.slice(6))?.title) ?? '全部待办';
}
