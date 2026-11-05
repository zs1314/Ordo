import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../core/store.mjs';
import { addSection } from '../core/board.mjs';
import { addItem, updateItem } from '../core/items.mjs';
import { createCodexRunner, codexErrorMessage } from '../codex.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function fixture(title='make artifact',options={}) {
 const dir=mkdtempSync(join(tmpdir(),'ordo-codex-')), binary=join(dir,'fake-codex');
 writeFileSync(binary,`#!${process.execPath}\nimport{writeFileSync}from'node:fs';\nif(process.argv.includes('login')){console.error('Logged in using ChatGPT');process.exit(0)}\nlet p='';for await(const c of process.stdin)p+=c;\nconst emit=e=>console.log(JSON.stringify(e));\nwriteFileSync('args.json',JSON.stringify(process.argv));emit({type:'thread.started',thread_id:'test-thread'});emit({type:'error',message:'Reconnecting...'});\nif(p.includes('SLOW'))await new Promise(r=>setTimeout(r,30000));\nif(p.includes('FAIL')){emit({type:'turn.failed',error:{message:'test failure'}});process.exit(1)}\nwriteFileSync('artifact.txt','done');emit({type:'item.completed',item:{type:'agent_message',text:'已完成测试文件'}});emit({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}});\n`,{mode:0o700});
 const store=openStore(dir);store.mutate(d=>addSection(d,{title:'tasks'}));store.mutate(d=>addItem(d,{group:d.groups[0].id,title}));
 const id=store.load().items[0].id,runner=createCodexRunner({store,root:dir,binary,...options});
 return{dir,binary,store,id,runner,close(){runner.shutdown();store.close();rmSync(dir,{recursive:true,force:true})}};
}
async function finish(f,id){for(let n=0;n<100;n++){const j=f.runner.get(id);if(!['running','stopping'].includes(j.status))return j;await sleep(30)}throw Error('timeout')}
test('Codex invokes fixed argv, persists results and requires task review',async()=>{const f=fixture('literal $(touch unexpected)');try{
 const j=await f.runner.start({itemId:f.id});const end=await finish(f,j.id);assert.equal(end.status,'succeeded');assert.equal(end.error,undefined);assert.equal(end.result,'已完成测试文件');assert.equal(f.store.load().items[0].status,'waiting');
 const args=JSON.parse(readFileSync(join(j.cwd,'args.json')));assert.equal(args[args.indexOf('--sandbox')+1],'workspace-write');assert.ok(args.includes('-'));assert.equal(args[args.indexOf('--enable')+1],'respect_system_proxy');assert.ok(!args.some(s=>s.includes('touch unexpected')));assert.equal(readFileSync(join(j.cwd,'artifact.txt'),'utf8'),'done');
 assert.equal(f.store.getMeta('ordoCodexJobs')[0].status,'succeeded');
}finally{f.close()}});
test('Codex rejects duplicate starts and stops active process',async()=>{const f=fixture('SLOW');try{const j=await f.runner.start({itemId:f.id});await assert.rejects(f.runner.start({itemId:f.id}),/已有任务/);f.runner.cancel(j.id);assert.equal((await finish(f,j.id)).status,'cancelled');assert.equal(f.store.load().items[0].status,'todo')}finally{f.close()}});
test('Codex failure is visible and never marks a task done',async()=>{const f=fixture('FAIL');try{const j=await f.runner.start({itemId:f.id});const end=await finish(f,j.id);assert.equal(end.status,'failed');assert.match(end.error,/test failure/);assert.equal(f.store.load().items[0].status,'todo')}finally{f.close()}});
test('Codex rejects missing tasks and invalid workspaces before execution',async()=>{const f=fixture();try{await assert.rejects(f.runner.start({itemId:'missing'}),/不存在/);await assert.rejects(f.runner.start({itemId:f.id,cwd:'relative'}),/绝对路径/);assert.equal((await f.runner.status()).jobs.length,0)}finally{f.close()}});
test('Codex shutdown persists interruption and does not override manually changed status',async()=>{const f=fixture('SLOW');try{const j=await f.runner.start({itemId:f.id});f.store.mutate(d=>updateItem(d,f.id,{status:'done'}));f.runner.shutdown();assert.equal(f.store.getMeta('ordoCodexJobs')[0].status,'interrupted');assert.equal(f.store.load().items[0].status,'done')}finally{f.close()}});
test('Codex restart recovers stale running records without rerunning',()=>{const f=fixture();try{f.runner.shutdown();f.store.setMeta('ordoCodexJobs',[{id:'old',itemId:f.id,status:'running',events:[]}]);const other=createCodexRunner({store:f.store,root:f.dir,binary:f.binary});assert.equal(other.get('old').status,'interrupted');other.shutdown()}finally{f.close()}});

test('transient network retry is separate from a terminal failure and ends on timeout',async()=>{const f=fixture('SLOW',{reconnectTimeoutMs:250});try{
 const j=await f.runner.start({itemId:f.id});let during;
 for(let n=0;n<40;n++){during=f.runner.get(j.id);if(during.phase==='reconnecting')break;await sleep(15)}
 assert.equal(during.phase,'reconnecting');assert.match(during.connectionIssue,/连接中断/);assert.equal(during.error,undefined);
 const end=await finish(f,j.id);assert.equal(end.status,'failed');assert.match(end.error,/网络/);assert.equal(end.connectionIssue,undefined);assert.equal(f.store.load().items[0].status,'todo');
}finally{f.close()}});
test('service failure messages distinguish network, auth, limits and other failures',()=>{
 assert.match(codexErrorMessage('stream disconnected: Connection reset by peer (os error 54)'),/网络/);
 assert.match(codexErrorMessage('401 Unauthorized'),/登录/);
 assert.match(codexErrorMessage('429 rate_limit'),/额度/);
 assert.equal(codexErrorMessage('Invalid project format'),'Invalid project format');
});
