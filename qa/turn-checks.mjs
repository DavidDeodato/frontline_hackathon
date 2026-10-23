import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {createApp} from '../server/index.mjs';
import {AppError,intentKeys,fixtureAssessment} from '../server/engine.mjs';

// Independent turn.v0.4 HTTP invariants. Injected provider, real server tool,
// loopback and QA-only SQLite. No OpenAI request or semantic accuracy claim.
const root=resolve(import.meta.dirname,'..'),folder=resolve(root,'qa/evidence');mkdirSync(folder,{recursive:true});
const stamp=new Date().toISOString().replaceAll(':','-').replaceAll('.','-');
const paths=['server/index.mjs','server/turns.mjs','server/engine.mjs','server/store.mjs','shared/TURN_CONTRACT.md','qa/turn-checks.mjs'];
const snapshot=()=>Object.fromEntries(paths.map(f=>[f,createHash('sha256').update(readFileSync(resolve(root,f))).digest('hex')]));
const before=snapshot(),results=[],contexts=[];let mode='ok',invocations=0,observedProjection=false;
let request,activeText='',selected={};
const provider={mode:'openai',async draft(){throw Error('Outside turn QA');},async assess(s){return fixtureAssessment(s);},async turn(s,text,{executeTurn}={}){
 invocations++;assert.equal(text,activeText);assert.equal(typeof executeTurn,'function');
 const intent=Object.fromEntries(intentKeys.map(k=>[k,!!selected[k]]));
 const evidence=Object.fromEntries(intentKeys.map(k=>[k,intent[k]?text:'']));
 const args={intent,evidence};const projected=await executeTurn('apply_training_turn',args);contexts.push(structuredClone(projected.responseContext));
 assert.equal(projected.validation.valid,true);assert.equal(projected.candidate.messages.length,s.messages.length+1);assert.equal(projected.candidate.messages.at(-1).role,'user');
 const persisted=expect(await request(`/api/sessions/${s.id}`),200).session;
 assert.equal(persisted.revision,s.revision);assert.equal(persisted.messages.length,s.messages.length);observedProjection=true;
 if(mode==='failure')throw new AppError(503,'QA_REPLY_FAILURE','Synthetic failure after tool.');
 if(mode==='repeat')await executeTurn('apply_training_turn',args);
 if(mode==='echo')args.intent.ambiguous=!args.intent.ambiguous;
 // Mutation of the returned copy cannot change the private server candidate.
 projected.candidate.scenario.title='Untrusted mutation of tool return';
 const reply=projected.responseContext.allowedFacts.acceptLoan?'Combinado, vou devolver o aparelho no dia 27.':projected.responseContext.allowedFacts.confirmIdentity?'Tenho meu documento e consigo devolver no dia 27.':'Entendi a alternativa. Quais são as condições?';
 return {...args,reply,turnTool:{name:'apply_training_turn',status:'validated'}};
}};
const app=createApp({databasePath:resolve(folder,`turn-${stamp}.sqlite`),provider});
await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));const port=app.server.address().port;let cookie='';
request=async(path,body)=>{const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];return{status:response.status,body:await response.json()};};
function expect(r,status){assert.equal(r.status,status,`HTTP${r.status}, expected${status}: ${r.body?.error?.code}`);return r.body;}
async function check(id,name,fn){try{await fn();results.push({id,name,status:'pass'});}catch(e){results.push({id,name,status:'fail',error:e.message});}finally{mode='ok';}}
const cmd=(s,operation,extra={},commandId=randomUUID())=>request(`/api/sessions/${s.id}/${operation}`,{commandId,expectedRevision:s.revision,...extra});
let scenarioId;
const fresh=async()=>expect(await request('/api/sessions',{scenarioId}),200).session;
try{
 await request('/api/health');scenarioId=expect(await request('/api/library'),200).scenarios[0].id;
 await check('QA-T01','Tool projects in memory; failed narration leaves no message or receipt and same command can retry',async()=>{
  const s=await fresh(),key=randomUUID();activeText='Um aparelho provisório ajudaria na viagem?';selected={offerLoan:true};mode='failure';
  expect(await cmd(s,'messages',{text:activeText},key),503);assert.deepEqual(expect(await request(`/api/sessions/${s.id}`),200).session,s);
  mode='ok';const after=expect(await cmd(s,'messages',{text:activeText},key),200).session;assert.equal(after.revision,s.revision+1);assert.equal(after.messages.length,3);assert.equal(after.messages.at(-1).text,'Entendi a alternativa. Quais são as condições?');assert.notEqual(after.scenario.title,'Untrusted mutation of tool return');assert.equal(observedProjection,true);
 });
 await check('QA-T02','Changed returned intent or repeated tool cannot commit a partial transition',async()=>{
  const s=await fresh();activeText='A peça está sem prazo confirmado.';selected={explainsUnknownEta:true};
  for(const failure of ['echo','repeat']){mode=failure;expect(await cmd(s,'messages',{text:activeText}),503);assert.deepEqual(expect(await request(`/api/sessions/${s.id}`),200).session,s);}
 });
 await check('QA-T03','Missing prerequisites are denied before narration even when participant confirms a loan',async()=>{
  const s=await fresh();activeText='Confirmo o empréstimo do aparelho provisório.';selected={offerLoan:true,confirmLoan:true};
  const after=expect(await cmd(s,'messages',{text:activeText}),200).session;const context=contexts.at(-1);assert.equal(context.allowedFacts.acceptLoan,false);assert.ok(context.deniedTransitions.some(x=>x.action==='loan_agreement'));assert.ok(context.loanRejectionReasons.includes('policy_not_read'));assert.notEqual(after.commitment.status,'valid');
 });
 await check('QA-T04','Three turns persist once each; duplicated concurrent command invokes provider once and yields coherent END-01',async()=>{
  let s=await fresh();s=expect(await cmd(s,'documents',{objectId:'OBJ-POLITICA'}),200).session;
  const turns=[['Um aparelho provisório ajudaria na viagem?',{offerLoan:true}],['Você tem documento e consegue devolver no dia 27?',{askIdentity:true,askReturn:true}],['Confirmo o empréstimo provisório com as condições combinadas.',{confirmLoan:true}]];
  for(const [text,intent] of turns){activeText=text;selected=intent;const key=randomUUID(),count=invocations;const responses=await Promise.all([cmd(s,'messages',{text},key),cmd(s,'messages',{text},key)]);const updated=expect(responses[0],200).session;assert.deepEqual(expect(responses[1],200).session,updated);assert.equal(invocations,count+1);assert.equal(updated.revision,s.revision+1);s=updated;}
  assert.equal(s.messages.length,8);assert.equal(s.messages.filter(m=>m.role==='user').length,3);assert.equal(s.messages.filter(m=>m.role==='npc').length,4);assert.equal(s.ending.id,'END-01');assert.equal(contexts.at(-1).allowedFacts.acceptLoan,true);assert.equal(s.commitment.status,'valid');for(const c of s.evaluation.criteria)if(c.quote)assert.ok(s.messages.some(m=>m.id===c.messageId&&m.role==='user'&&m.text.includes(c.quote)));
 });
}finally{await app.close();}
const after=snapshot(),report={at:new Date().toISOString(),mode:'offline_injected_provider_real_server_turn_tool',serverClosed:true,readSetBefore:before,readSetAfter:after,snapshotStable:JSON.stringify(before)===JSON.stringify(after),results,passed:results.filter(r=>r.status==='pass').length,failed:results.filter(r=>r.status==='fail').length,limits:['No real model inference or semantic accuracy claim.','Assessment uses explicit fixture inside an offline test double.','No UI or external integration acceptance.']};
const artifact=resolve(folder,`turn-${stamp}.json`);writeFileSync(artifact,JSON.stringify(report,null,2));console.log(JSON.stringify({artifact,passed:report.passed,failed:report.failed,snapshotStable:report.snapshotStable,failures:results.filter(r=>r.status==='fail')},null,2));process.exitCode=report.failed||!report.snapshotStable?1:0;
