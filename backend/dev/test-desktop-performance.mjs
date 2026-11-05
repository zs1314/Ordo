import assert from 'node:assert/strict';
import { startBoard, sleep } from './harness.mjs';
import { desktopFixture } from './desktop-fixture.mjs';
const board=await startBoard({data:doc=>{desktopFixture(doc);doc.items=Array.from({length:500},(_,n)=>({id:'load-'+n,title:`压力测试任务 ${n}`,group:doc.groups[n%3].id,status:'todo',priority:0,order:n*10,note:n%2?'相关说明':'',tags:n%5?[]:['测试'],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}))}});
try{
  const page=await board.tab(board.base+'/?desktop=1',{width:1180,height:800,scale:1});
  const {ev,click,type}=page;
  const wait=async expr=>{for(let n=0;n<80;n++){if(await ev(expr))return;await sleep(50)}throw new Error(expr)};
  assert.equal(await ev(`document.querySelectorAll('.d-task').length`),80);
  console.log('PASS 500 tasks render in bounded batches of 80');
  await type(`document.querySelector('[aria-label="搜索所有任务"]')`,'压力测试任务 499');
  await wait(`document.querySelectorAll('.d-task').length===1`);
  assert.equal(await ev(`document.querySelector('.d-task').dataset.id`),'load-499');
  console.log('PASS search includes tasks outside rendered batch');
  await type(`document.querySelector('[aria-label="搜索所有任务"]')`,'');
  await click(`document.querySelector('.d-load-more')`);
  await wait(`document.querySelectorAll('.d-task').length===160`);
  console.log('PASS load more renders next batch');
  const metrics=await ev(`new Promise(resolve=>{
    const samples=[];let previous=performance.now(),n=0;const scroll=document.querySelector('.d-main-scroll');
    function frame(now){samples.push(now-previous);previous=now;scroll.scrollTop=500+Math.sin(n/12)*450;n++;if(n<120)requestAnimationFrame(frame);else{samples.splice(0,5);samples.sort((a,b)=>a-b);resolve({frames:samples.length,p50:samples[Math.floor(samples.length*.5)],p95:samples[Math.floor(samples.length*.95)],over50:samples.filter(x=>x>50).length})}}requestAnimationFrame(frame)
  })`);
  console.log('SCROLL FRAME METRICS '+JSON.stringify(metrics));
  await ev(`document.querySelector('.d-main-scroll').scrollTop=0`);
  await ev(`window.realFetch=window.fetch;window.fetch=async(...args)=>{if(args[1]?.method==='PATCH'){await new Promise(r=>setTimeout(r,100));}return window.realFetch(...args)}`);
  await click(`document.querySelector('.d-task[data-id="load-0"] .d-task-star')`);
  await click(`document.querySelector('.d-task[data-id="load-1"] .d-task-star')`);
  await wait(`!document.querySelector('.d-save-state .saving')`);
  let doc=await board.api('GET','/api/todo');assert.equal(doc.items.find(i=>i.id==='load-0').priority,3);assert.equal(doc.items.find(i=>i.id==='load-1').priority,3);
  console.log('PASS delayed consecutive writes preserve both optimistic updates');
  await ev(`window.fetch=(...args)=>args[1]?.method==='PATCH'?Promise.resolve(new Response(JSON.stringify({error:'模拟保存失败'}),{status:500,headers:{'content-type':'application/json'}})):window.realFetch(...args)`);
  await click(`document.querySelector('.d-task[data-id="load-2"] .d-task-star')`);
  await wait(`!!document.querySelector('.d-error-banner')`);
  assert.equal(await ev(`document.querySelector('.d-task[data-id="load-2"] .d-task-star').classList.contains('starred')`),false);
  assert.equal((await board.api('GET','/api/todo')).items.find(i=>i.id==='load-2').priority,0);
  console.log('PASS failed optimistic write rolls back and reports failure');
  await ev(`window.fetch=window.realFetch`);
  console.log('Desktop stress checks passed');
}finally{board.close()}
