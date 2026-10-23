import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..'),folder=resolve(root,'qa/evidence');mkdirSync(folder,{recursive:true});
const stamp=new Date().toISOString().replaceAll(':','-').replaceAll('.','-'),database=resolve(folder,`http-${stamp}.sqlite`);
const sourceFiles=['server/index.mjs','server/engine.mjs','server/provider.mjs','server/store.mjs','server/integrations/export.mjs','server/integrations/index.mjs','shared/API_CONTRACT.md','shared/INTEGRATIONS_CONTRACT.md','shared/scene.json','qa/http-server.mjs','qa/http-checks.mjs'];
const snapshot=()=>Object.fromEntries(sourceFiles.map(f=>[f,createHash('sha256').update(readFileSync(resolve(root,f))).digest('hex')]));
const before=snapshot(),results=[],processes=[];let server,baseUrl;
async function start(){
 const child=spawn(process.execPath,['qa/http-server.mjs',database],{cwd:root,stdio:['ignore','ignore','pipe','ipc'],windowsHide:true});
 let diagnostics='';child.stderr.on('data',chunk=>{diagnostics+=chunk.toString();});
 const ready=await new Promise((ok,no)=>{const timer=setTimeout(()=>no(new Error('QA child did not start in 10s')),10000);child.once('message',m=>{clearTimeout(timer);ok(m);});child.once('exit',code=>{clearTimeout(timer);no(new Error(`QA child exited${code}: ${diagnostics.slice(-400)}`));});});
 assert.equal(ready.mode,'fixture');processes.push({pid:ready.pid,port:ready.port,startedAt:new Date().toISOString()});server=child;baseUrl=`http://127.0.0.1:${ready.port}`;
}
async function stop(){if(!server||server.exitCode!==null)return;const old=server;await new Promise((ok,no)=>{const timer=setTimeout(()=>no(new Error('QA child close timed out')),10000);old.once('exit',code=>{clearTimeout(timer);code===0?ok():no(new Error(`QA child exit ${code}`));});old.send({type:'close'});});}
function client(){return {cookie:'',async request(path,method='GET',body,headers={}){const r=await fetch(baseUrl+path,{method,headers:{...(body!==undefined?{'content-type':'application/json'}:{}),...(this.cookie?{cookie:this.cookie}:{}),...headers},...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});const cookie=r.headers.get('set-cookie');if(cookie)this.cookie=cookie.split(';')[0];let data;try{data=await r.json();}catch{data=null;}return {status:r.status,data,headers:r.headers};}};}
const a=client(),b=client();let scenarioId,mainSession,persisted;
async function check(id,name,fn){try{await fn();results.push({id,name,status:'pass'});}catch(err){results.push({id,name,status:'fail',error:err.message});}}
function expect(r,status){assert.equal(r.status,status,`expectedHTTP${status},got${r.status},code=${r.data?.error?.code}`);return r.data;}
async function newSession(c=a){return expect(await c.request('/api/sessions','POST',{scenarioId}),200).session;}
async function cmd(c,s,action,extra={},commandId=randomUUID()){return c.request(`/api/sessions/${s.id}/${action}`,'POST',{commandId,expectedRevision:s.revision,...extra});}

try{
 await start();
 await check('QA-H01','Health mode is explicit fixture; guest cookie HttpOnly/SameSite and library exist',async()=>{
  const health=await a.request('/api/health');expect(health,200);assert.equal(health.data.providerMode,'fixture');assert.match(health.headers.get('set-cookie')||'',/HttpOnly/i);assert.match(health.headers.get('set-cookie')||'',/SameSite=Lax/i);const lib=expect(await a.request('/api/library'),200);assert.ok(lib.scenarios.length);scenarioId=lib.scenarios[0].id;
 });
 await check('QA-H02','Session ACL rejects unrelated guest and injected ownerId',async()=>{
  mainSession=await newSession();assert.equal(mainSession.messages.length,1);assert.ok(!('_state' in mainSession));expect(await b.request(`/api/sessions/${mainSession.id}`),404);expect(await b.request(`/api/sessions/${mainSession.id}/pause`,'POST',{ownerId:'*',expectedRevision:0,commandId:randomUUID()}),404);
 });
 await check('QA-H03','Replayed document command has one effect; changed payload and stale revision are rejected',async()=>{
  const id=randomUUID(),body={commandId:id,expectedRevision:mainSession.revision,objectId:'OBJ-POLITICA'};const first=expect(await a.request(`/api/sessions/${mainSession.id}/documents`,'POST',body),200).session;const again=expect(await a.request(`/api/sessions/${mainSession.id}/documents`,'POST',body),200).session;assert.deepEqual(again,first);expect(await a.request(`/api/sessions/${mainSession.id}/documents`,'POST',{...body,objectId:'OBJ-ORDEM'}),409);expect(await cmd(a,mainSession,'pause'),409);assert.equal(first.attributes.preparo,1);assert.equal(first.messages.length,1);mainSession=first;
 });
 await check('QA-H04','Unknown document is rejected without state change',async()=>{
  expect(await cmd(a,mainSession,'documents',{objectId:'OBJ-NOT-IN-SCENARIO'}),422);const s=expect(await a.request(`/api/sessions/${mainSession.id}`),200).session;assert.equal(s.revision,mainSession.revision);assert.equal(s.attributes.preparo,1);
 });
 await check('QA-H05','Two concurrent commands on the same revision yield one success and one conflict',async()=>{
  const rs=await Promise.all([cmd(a,mainSession,'pause'),cmd(a,mainSession,'pause')]);assert.deepEqual(rs.map(r=>r.status).sort(),[200,409]);mainSession=rs.find(r=>r.status===200).data.session;expect(await cmd(a,mainSession,'messages',{text:'Não pode enviar enquanto pausada.'}),409);mainSession=expect(await cmd(a,mainSession,'resume'),200).session;
 });
 await check('QA-H06','Raw context is preserved; availability changes executable endings; published version stays frozen',async()=>{
  const text='Contexto sintético QA: Roberto precisa falar com a filha na terça. A peça está sem prazo. Não há provisório.';const policyText='Sem aparelho provisório; não garantir reparo.';
  let d=expect(await a.request('/api/drafts','POST',{text,policyText}),200).draft;assert.equal(d.rawContext,text);d=expect(await a.request(`/api/drafts/${d.id}`,'PATCH',{rules:{loanAvailable:false,loanDays:3}}),200).draft;assert.ok(!d.graph.availableEndingIds.includes('END-01'));const p=expect(await a.request(`/api/drafts/${d.id}/publish`,'POST',{}),200).scenario;const s=expect(await a.request('/api/sessions','POST',{scenarioId:p.id,scenarioVersion:p.version}),200).session;expect(await a.request(`/api/drafts/${d.id}`,'PATCH',{rules:{loanAvailable:true,loanDays:7}}),200);const saved=expect(await a.request(`/api/sessions/${s.id}`),200).session;assert.equal(saved.scenario.rules.loanAvailable,false);assert.equal(saved.scenarioVersion,p.version);
 });
 await check('QA-H07','JSON errors, invalid fields and oversized bodies produce explicit client errors',async()=>{
  expect(await a.request('/api/drafts','POST',{text:''}),422);expect(await a.request('/api/drafts','POST','{invalid'),400);expect(await a.request('/api/drafts','POST','hello',{'content-type':'text/plain'}),415);expect(await a.request('/api/drafts','POST',{text:'x'.repeat(70000)}),413);expect(await a.request('/api/sessions','POST',{scenarioId,scenarioVersion:{bad:true}}),422);
 });
 await check('QA-H08','Foreign origin is rejected and internal state stays hidden',async()=>{
  expect(await a.request('/api/library','GET',undefined,{origin:'https://unrelated.invalid'}),403);const lib=expect(await a.request('/api/library'),200);assert.ok(lib.sessions.every(s=>!('_state'in s)));
 });
 await check('QA-H09','Complete API journey saves eight messages, literal citations and narrative result',async()=>{
  let s=await newSession();s=expect(await cmd(a,s,'documents',{objectId:'OBJ-ORDEM'}),200).session;s=expect(await cmd(a,s,'documents',{objectId:'OBJ-POLITICA'}),200).session;
  for(const text of ['Entendo sua urgência. O reparo não tem prazo confirmado. Um aparelho provisório ajudaria?','Você tem documento e consegue devolver em até sete dias?','Combinado: empréstimo provisório, devolução em27out. O reparo continua sem confirmação.'])s=expect(await cmd(a,s,'messages',{text}),200).session;
  assert.equal(s.status,'completed');assert.equal(s.ending?.id,'END-01');assert.equal(s.messages.length,8);assert.equal(s.evaluation.criteria.length,3);for(const c of s.evaluation.criteria){if(!c.quote)continue;assert.ok(s.messages.some(m=>m.id===c.messageId&&m.role==='user'&&m.text.includes(c.quote)));}expect(await cmd(a,s,'messages',{text:'Quarta resposta.'}),409);persisted=s;
 });
 await check('QA-H10','Branch preserves original; comparison is same-context and guest-isolated',async()=>{
  assert.ok(persisted);const before=structuredClone(persisted);const firstUser=persisted.messages.find(m=>m.role==='user');const branch=expect(await cmd(a,persisted,'branches',{beforeMessageId:firstUser.id}),200).session;assert.equal(branch.parentSessionId,persisted.id);assert.equal(branch.messages.length,1);assert.deepEqual(expect(await a.request(`/api/sessions/${persisted.id}`),200).session,before);const compared=expect(await a.request(`/api/compare?left=${persisted.id}&right=${branch.id}`),200);assert.equal(compared.sameContext,true);expect(await b.request(`/api/compare?left=${persisted.id}&right=${branch.id}`),404);
 });
 await check('QA-H11','Actual child-process restart preserves session and guest identity',async()=>{
  assert.ok(persisted);const oldPid=processes.at(-1).pid;await stop();await start();assert.notEqual(processes.at(-1).pid,oldPid);const read=expect(await a.request(`/api/sessions/${persisted.id}`),200).session;assert.deepEqual(read,persisted);expect(await b.request(`/api/sessions/${persisted.id}`),404);
 });
 await check('QA-H12','Cancel prevents further writes and is not a narrative ending',async()=>{
  let s=await newSession();s=expect(await cmd(a,s,'cancel'),200).session;assert.equal(s.status,'cancelled');assert.equal(s.ending,null);expect(await cmd(a,s,'resume'),409);expect(await cmd(a,s,'messages',{text:'Depois de cancelar.'}),409);
 });
 await check('QA-H13','Integration status never advertises guest WhatsApp or external anchoring as connected',async()=>{
  const state=expect(await a.request('/api/integrations/status'),200);assert.equal(state.contractVersion,'frontline.integrations/1');assert.equal(state.whatsapp.available,false);assert.equal(state.whatsapp.status,'unlinked');assert.equal(state.devnet.available,false);assert.equal(state.devnet.status,'not_requested');assert.equal(state.export.available,true);
 });
 await check('QA-H14','Exports require a reviewed owned session and retain explicit simulated origin',async()=>{
  const active=await newSession();expect(await a.request(`/api/sessions/${active.id}/export`),409);expect(await b.request(`/api/sessions/${persisted.id}/export`),404);
  const out=expect(await a.request(`/api/sessions/${persisted.id}/export`),200);assert.match(out.filename,/\.json$/);assert.equal(out.document.payload.session.mode,'fixture');assert.equal(out.document.payload.session.messages.length,8);const raw=JSON.stringify(out.document);for(const field of ['ownerId','rawContext','rawPolicy','providerTrace','_state'])assert.ok(!raw.includes(`"${field}"`));
 });
 await check('QA-H15','Verification distinguishes corruption, self-consistency and a changed but rehashed reference',async()=>{
  const {document}=expect(await a.request(`/api/sessions/${persisted.id}/export`),200);
  const clean=expect(await a.request('/api/exports/verify','POST',{document}),200);assert.equal(clean.valid,true);assert.equal(clean.matchesTrustedExport,null);assert.equal(clean.anchored,false);
  const trusted=expect(await a.request('/api/exports/verify','POST',{document,sessionId:persisted.id}),200);assert.equal(trusted.matchesTrustedExport,true);
  expect(await b.request('/api/exports/verify','POST',{document,sessionId:persisted.id}),404);
  const tampered=structuredClone(document);tampered.payload.session.messages[0].text+=' Alteração sintética.';
  const corrupt=expect(await a.request('/api/exports/verify','POST',{document:tampered}),200);assert.equal(corrupt.valid,false);assert.equal(corrupt.reason,'HASH_MISMATCH');
  const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value!==null&&typeof value==='object'?`{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`:JSON.stringify(value);
  tampered.integrity.sha256=createHash('sha256').update(canonical({schemaVersion:tampered.schemaVersion,payload:tampered.payload})).digest('hex');
  const forged=expect(await a.request('/api/exports/verify','POST',{document:tampered,sessionId:persisted.id}),200);assert.equal(forged.valid,true);assert.equal(forged.matchesTrustedExport,false);assert.equal(forged.anchored,false);
 });
}catch(err){results.push({id:'QA-H-SETUP',name:'Setup or runner',status:'fail',error:err.message});}
finally{try{await stop();}catch(err){results.push({id:'QA-H-CLEANUP',name:'Graceful stop',status:'fail',error:err.message});}}
const after=snapshot();const report={runId:'FRONTLINE-CHATS-V3-20261023',ownershipEpoch:5,startedAt:stamp,completedAt:new Date().toISOString(),mode:'fixture_explicit_offline_provider',processes,processesStopped:server?.exitCode!==null,node:process.version,readSetBefore:before,readSetAfter:after,snapshotStable:JSON.stringify(before)===JSON.stringify(after),results,passed:results.filter(x=>x.status==='pass').length,failed:results.filter(x=>x.status==='fail').length,limits:['Loopback HTTP only, ephemeral ports and synthetic database; production services untouched.','No live OpenAI, WhatsApp or blockchain calls.','No browser/render acceptance.']};
const artifact=resolve(folder,`http-${stamp}.json`);writeFileSync(artifact,JSON.stringify(report,null,2));console.log(JSON.stringify({artifact,passed:report.passed,failed:report.failed,snapshotStable:report.snapshotStable,processesStopped:report.processesStopped,failures:results.filter(x=>x.status==='fail')},null,2));process.exitCode=report.failed||!report.snapshotStable?1:0;
