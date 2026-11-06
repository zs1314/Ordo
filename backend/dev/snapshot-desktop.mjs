// Render product screenshots from synthetic tasks; no personal data is loaded.
import path from 'node:path';
import fs from 'node:fs';
import { startBoard, sleep } from './harness.mjs';
import { desktopFixture } from './desktop-fixture.mjs';
const output=path.resolve(process.argv[2] || 'docs/images');
fs.mkdirSync(output,{recursive:true});
const board=await startBoard({data:doc=>{desktopFixture(doc);const base=doc.items.find(i=>i.id==='design');doc.items.push({...base,id:'agent-draft',title:'整理新项目的调研笔记',status:'agent',priority:0,due:'',subtasks:[],note:'',order:90,agent:{where:'Claude Code · 本机',note:'汇总三个方案的差异，保留一份简短结论。',since:new Date(Date.now()-7200000).toISOString(),lastSeen:new Date(Date.now()-3600000).toISOString()}},{...base,id:'agent-review',title:'检查网站的移动端布局',status:'agent',priority:0,due:'',subtasks:[],note:'',order:100,agent:{where:'Codex · 网站项目',note:'重点看看导航、表单和小屏幕上的间距。',since:new Date(Date.now()-14400000).toISOString(),lastSeen:new Date(Date.now()-14400000).toISOString()}});}});
try {
  const page=await board.tab(board.base+'/?desktop=1',{width:1180,height:800,scale:2});
  await page.screenshot(path.join(output,'overview-light.png'));
  await page.click(`document.querySelector('.d-task[data-id="design"] .d-task-body')`);
  await sleep(300);
  await page.screenshot(path.join(output,'task-details.png'));
  await page.click(`document.querySelector('[aria-label="关闭"]')`);
  await sleep(250);
  await page.ev(`window.dispatchEvent(new CustomEvent('ordo-command',{detail:'settings'}))`);
  await sleep(100);
  await page.click(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='深色')`);
  await page.click(`document.querySelector('[aria-label="关闭设置"]')`);
  await sleep(300);
  await page.ev(`document.querySelector('.d-main-scroll').scrollTop=0`);
  await sleep(100);
  await page.screenshot(path.join(output,'overview-dark.png'));
  if(page.errors.length)throw new Error(page.errors.join('\n'));
  console.log('Saved three Ordo screenshots to '+output);
} finally {board.close()}
