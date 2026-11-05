import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../core/store.mjs';
import { addSection } from '../core/board.mjs';
import { addItem, updateItem } from '../core/items.mjs';
import { trashItem, restoreItem, batchItems } from '../core/productivity.mjs';
import { matches, inView, sortTasks } from '../web/desktop/model.js';

function fixture() {
  const dir=mkdtempSync(join(tmpdir(),'ordo-productivity-'));let store=openStore(dir);
  store.mutate(d=>addSection(d,{title:'收件箱'}));
  const group=store.load().groups[0].id;
  store.mutate(d=>addItem(d,{group,title:'设计审阅',priority:3,tags:['设计','设计','工作'],subtasks:[{id:'step',title:'原型',done:true}]}));
  return {dir,group,id:store.load().items[0].id,get store(){return store},reopen(){store.close();store=openStore(dir)},close(){store.close();rmSync(dir,{recursive:true,force:true})}};
}
test('priority, unique tags and subtasks persist across close and reopen',()=>{
  const f=fixture();try{f.reopen();const item=f.store.load().items[0];assert.equal(item.priority,3);assert.deepEqual(item.tags,['设计','工作']);assert.equal(item.subtasks[0].done,true)}finally{f.close()}
});
test('invalid metadata rolls back the whole mutation',()=>{
  const f=fixture();try{const before=f.store.load();assert.throws(()=>f.store.mutate(d=>updateItem(d,f.id,{title:'wrong',priority:7})));assert.throws(()=>f.store.mutate(d=>updateItem(d,f.id,{subtasks:[{id:'a',title:''}]})));assert.deepEqual(f.store.load(),before)}finally{f.close()}
});
test('trash restores original id, priority, subtasks and recurrence to a surviving group',()=>{
  const f=fixture();try{
    f.store.mutate(d=>updateItem(d,f.id,{repeat:'daily',status:'done'}));
    const original=f.store.load().items[0];
    f.store.mutate(d=>trashItem(d,f.id));f.reopen();assert.equal(f.store.load().items.length,0);assert.equal(f.store.load().extras.trash.length,1);
    f.store.mutate(d=>restoreItem(d,f.id));const restored=f.store.load().items[0];
    for(const key of ['id','title','priority','tags','subtasks','repeat','doneDates'])assert.deepEqual(restored[key],original[key]);
    assert.equal(f.store.load().extras.trash.length,0);
    assert.throws(()=>f.store.mutate(d=>restoreItem(d,f.id)));
  }finally{f.close()}
});
test('batch operations are all-or-nothing and preserve unrelated tasks',()=>{
  const f=fixture();try{
    f.store.mutate(d=>addItem(d,{group:f.group,title:'另一个任务'}));const before=f.store.load();
    assert.throws(()=>f.store.mutate(d=>batchItems(d,{ids:[f.id,'missing'],action:'done'})));assert.deepEqual(f.store.load(),before);
    f.store.mutate(d=>batchItems(d,{ids:before.items.map(i=>i.id),action:'done'}));assert.ok(f.store.load().items.every(i=>i.status==='done'));
    f.store.mutate(d=>batchItems(d,{ids:[f.id],action:'trash'}));assert.equal(f.store.load().items.length,1);assert.equal(f.store.load().items[0].title,'另一个任务');
  }finally{f.close()}
});
test('smart lists, token search and ordering handle closed tasks and metadata',()=>{
  const f=fixture();try{
    const doc=f.store.load(),item=doc.items[0];assert.ok(matches(item,'设计 原型',doc));assert.ok(matches(item,'收件箱',doc));assert.equal(matches(item,'不存在',doc),false);
    assert.equal(inView(item,'important',doc),true);assert.equal(inView({...item,status:'done'},'important',doc),false);assert.equal(inView({...item,status:'done'},'completed',doc),true);
    assert.equal(sortTasks([{...item,id:'low',priority:1},{...item,id:'high',priority:3}],'priority')[0].id,'high');
  }finally{f.close()}
});
