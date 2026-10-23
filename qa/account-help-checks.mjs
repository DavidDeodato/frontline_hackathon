import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {createApp} from '../server/index.mjs';

// Synthetic identities, ephemeral loopback and injected help; no real model.
const root=resolve(import.meta.dirname,'..'),folder=resolve(root,'qa/evidence');mkdirSync(folder,{recursive:true});
const stamp=new Date().toISOString().replaceAll(':','-').replaceAll('.','-');
const files=['server/index.mjs','server/store.mjs','server/accounts/index.mjs','server/help/index.mjs','qa/account-help-checks.mjs'];
const snapshot=()=>Object.fromEntries(files.map(f=>[f,createHash('sha256').update(readFileSync(resolve(root,f))).digest('hex')]));
const before=snapshot(),results=[];let calls=0,hold=null;
const provider={mode:'openai',async draft(){throw Error('Outside QA scope');},async turn(){throw Error('Outside QA scope');},async assess(){throw Error('Outside QA scope');},async help(){calls++;if(hold){hold.enter();await hold.wait;}return{text:'Abra Registros para exportar a revisão.',actionIds:['open_records']};}};
const app=createApp({databasePath:resolve(folder,`account-help-${stamp}.sqlite`),provider});await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));const port=app.server.address().port;
function client(initial=[]){const jar=new Map(initial);return{fork:()=>client(jar),async req(path,body){const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:body===undefined?'GET':'POST',headers:{cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});for(const line of response.headers.getSetCookie()){const pair=line.split(';')[0],idx=pair.indexOf('='),name=pair.slice(0,idx);if(/Max-Age=0(?:;|$)/.test(line))jar.delete(name);else jar.set(name,pair.slice(idx+1));}return{status:response.status,body:await response.json()};}};}
const expect=(r,n)=>{assert.equal(r.status,n,`HTTP${r.status}, expected${n}: ${r.body?.error?.code}`);return r.body;};
const command=(c,s,op,extra={})=>c.req(`/api/sessions/${s.id}/${op}`,{commandId:randomUUID(),expectedRevision:s.revision,...extra});
const password='Synthetic-QA-Only-123';
const register=(c,email)=>c.req('/api/account/register',{name:'Participante sintético QA',email,password});
const helpBody=()=>({commandId:randomUUID(),text:'Como exportar uma revisão?',view:'library'});
let scenarioId,session,oldGuest,staleAccount;const a=client(),b=client();
const start=async c=>expect(await c.req('/api/sessions',{scenarioId}),200).session;
async function check(id,name,fn){try{await fn();results.push({id,name,status:'pass'});}catch(e){results.push({id,name,status:'fail',error:e.message});}finally{if(hold){hold.release();hold=null;}}}
try{
 scenarioId=expect(await a.req('/api/library'),200).scenarios[0].id;
 await check('QA-AH01','Registration claims guest exercise/help; old guest and another account cannot read them',async()=>{
  const h=expect(await a.req('/api/help/messages',helpBody()),200);assert.equal(h.conversation.messages.length,2);session=await start(a);oldGuest=a.fork();
  const account=expect(await register(a,'qa-first@example.invalid'),200);assert.equal(account.authenticated,true);assert.deepEqual(Object.keys(account).sort(),['authenticated','user']);assert.equal(expect(await a.req(`/api/sessions/${session.id}`),200).session.id,session.id);assert.equal(expect(await a.req('/api/help/conversation'),200).conversation.messages.length,2);
  expect(await oldGuest.req(`/api/sessions/${session.id}`),404);expect(await register(b,'qa-second@example.invalid'),200);expect(await b.req(`/api/sessions/${session.id}`),404);assert.equal(expect(await b.req('/api/help/conversation'),200).conversation.messages.length,0);
 });
 await check('QA-AH02','Logout revokes stale account; a new guest cannot recover claimed history; login restores correct owner',async()=>{
  staleAccount=a.fork();expect(await a.req('/api/account/logout',{}),200);expect(await a.req(`/api/sessions/${session.id}`),404);expect(await staleAccount.req(`/api/sessions/${session.id}`),401);
  expect(await a.req('/api/account/login',{email:'qa-first@example.invalid',password}),200);assert.equal(expect(await a.req(`/api/sessions/${session.id}`),200).session.id,session.id);
 });
 await check('QA-AH03','Active or paused training blocks help from library before provider; confirmed history remains readable',async()=>{
  const prior=calls;for(const paused of [false,true]){if(paused)session=expect(await command(a,session,'pause'),200).session;const denied=expect(await a.req('/api/help/messages',helpBody()),409);assert.equal(denied.error.code,'HELP_DURING_TRAINING');expect(await a.req('/api/help/conversation'),200);assert.equal(calls,prior);}session=expect(await command(a,session,'cancel'),200).session;
 });
 await check('QA-AH04','Concurrent help replay invokes provider once; a training session opened while help waits prevents commit',async()=>{
  const body=helpBody(),prior=calls;const responses=await Promise.all([a.req('/api/help/messages',body),a.req('/api/help/messages',body)]);const saved=expect(responses[0],200);assert.deepEqual(expect(responses[1],200),saved);assert.equal(calls,prior+1);expect(await a.req('/api/help/messages',{...body,text:'Changed payload'}),409);
  let enter,release;const ready=new Promise(r=>enter=r),wait=new Promise(r=>release=r);hold={enter,release,wait};const pending=a.req('/api/help/messages',helpBody());await ready;const active=await start(a);release();const denied=expect(await pending,409);assert.equal(denied.error.code,'HELP_DURING_TRAINING');assert.deepEqual(expect(await a.req('/api/help/conversation'),200).conversation.messages,saved.conversation.messages);hold=null;expect(await command(a,active,'cancel'),200);
 });
}finally{await app.close();}
const after=snapshot(),report={at:new Date().toISOString(),mode:'synthetic_accounts_offline_injected_help',serverClosed:true,readSetBefore:before,readSetAfter:after,snapshotStable:JSON.stringify(before)===JSON.stringify(after),results,passed:results.filter(r=>r.status==='pass').length,failed:results.filter(r=>r.status==='fail').length,limits:['No real credentials, OpenAI call, browser login or deployed service.','Focused integration cases, not exhaustive account security review.']};
const artifact=resolve(folder,`account-help-${stamp}.json`);writeFileSync(artifact,JSON.stringify(report,null,2));console.log(JSON.stringify({artifact,passed:report.passed,failed:report.failed,snapshotStable:report.snapshotStable,failures:results.filter(r=>r.status==='fail')},null,2));process.exitCode=report.failed||!report.snapshotStable?1:0;
