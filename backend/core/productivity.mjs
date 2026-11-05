import { getItem, getGroup, nextOrder, nowIso } from './doc.mjs';
import { invalid, fail } from './errors.mjs';
import { updateItem, rememberDismissed } from './items.mjs';

export function trashItem(doc, id) {
  const item = getItem(doc, id);
  doc.extras.trash ??= [];
  doc.extras.trash.push({ ...structuredClone(item), trashedAt: nowIso() });
  doc.items = doc.items.filter(i => i.id !== id);
  rememberDismissed(doc, [item]);
  return { op: 'trash', id, title: item.title };
}

export function restoreItem(doc, id, { group } = {}) {
  const archived = (doc.extras.trash ?? []).find(i => i.id === id);
  if (!archived) throw fail(404, '回收站中没有这个任务');
  if (doc.items.some(i => i.id === id)) throw fail(409, '这个任务已经恢复');
  const target = group ? getGroup(doc, group) : doc.groups.find(g => g.id === archived.group) ?? doc.groups[0];
  if (!target) throw invalid('请先新建一个清单，再恢复任务');
  const { trashedAt, ...item } = structuredClone(archived);
  item.group = target.id; item.order = nextOrder(doc.items.filter(i => i.group === target.id)); item.updatedAt = nowIso();
  doc.items.push(item);
  doc.extras.trash = doc.extras.trash.filter(i => i.id !== id);
  return { op: 'restore', id, title: item.title };
}

export function batchItems(doc, { ids, action, group } = {}) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 500 || new Set(ids).size !== ids.length) throw invalid('请选择 1 到 500 个不同的任务');
  ids.forEach(id => getItem(doc, id));
  if (!['done', 'todo', 'trash', 'move'].includes(action)) throw invalid('未知批量操作');
  if (action === 'move') getGroup(doc, group);
  return ids.map(id => action === 'trash' ? trashItem(doc, id) : updateItem(doc, id, action === 'move' ? { group } : { status: action })).filter(Boolean);
}
