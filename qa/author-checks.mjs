import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {createApp} from '../server/index.mjs';
import {AppError} from '../server/engine.mjs';

// Independent API invariants with an injected offline author. No provider/network
// inference is claimed: the double calls the real server tool, then can fail.
const root=resolve(import.meta.dirname,'..'),folder=resolve(root,'qa/evidence');mkdirSync(folder,{recursive:true});
const stamp=new Date().toISOString().replaceAll(':','-').replaceAll('.','-');
const sourceFiles=['server/index.mjs','server/drafts.mjs','server/store.mjs','server/engine.mjs','shared/AUTHOR_CONTRACT.md','qa/author-checks.mjs'];
const snapshot=()=>Object.fromEntries(sourceFiles.map(f=>[f,createHash('sha256').update(readFileSync(resolve(root,f))).digest('hex')]));
const before=snapshot(),results=[],calls=[];let toolCalls=0,failure=null,available=true;
const provider={mode:'openai',async draft(text,policyText='',options={}){
 calls.push({context:text,policy:policyText,revision:options.revisionText||'',priorVersion:options.currentDraft?.version||null});
 assert.equal(typeof options.executeTool,'function','server must provide the validated author tool');
 const quote=options.revisionText||policyText||text;
 const proposal={title:options.currentDraft?'Revisão da alternativa':'Contato com a família',summary:'Exercício sintético adaptado para assistência técnica.',need:'Usar um aparelho para falar com a família durante a viagem.',opening:'Preciso manter contato durante a viagem. Há uma alternativa?',unknowns:['A chegada da peça não tem prazo confirmado.'],contextualFacts:[{id:'QA-ORIGIN',text:'O relato original permanece disponível para revisão.',status:'provided',sourceQuote:text}],rules:{loanAvailable:available,loanDays:7},ruleEvidence:{loanAvailable:failure==='source'?'Citação inventada que não existe.':quote,loanDays:policyText||text}};
 proposal.compatibility={supported:failure!=='unsupported',reason:failure==='unsupported'?'O contexto clínico não é executável no catálogo de assistência.':'O relato trata de um aparelho no domínio de assistência.',sourceQuote:quote};
 proposal.clientBrief={objective:'Manter contato com a família durante a viagem.',traits:failure==='brief'?['A','B','C','D']:['Pede uma resposta concreta.'],initialState:'Está preocupado com a ausência do aparelho.'};
 const result=await options.executeTool('compose_exercise',{operation:options.currentDraft?'revise':'create',proposal});toolCalls++;
 if(failure==='final')throw new AppError(503,'SYNTHETIC_FINAL_FAILURE','Falha sintética após composição, sem chamada real.');
 const candidate=structuredClone(result.candidate);if(failure==='candidate')candidate.title='Mutação após validar ferramenta';
 return {candidate,authorMessage:'Rascunho sintético para QA de invariantes.',authorTool:{name:'compose_exercise',operation:options.currentDraft?'revise':'create',validation:result.validation}};
},async turn(){throw Error('Author QA does not run dialogue');},async assess(){throw Error('Author QA does not run assessment');}};
const app=createApp({databasePath:resolve(folder,`author-${stamp}.sqlite`),provider});
await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));const port=app.server.address().port;
function client(){let cookie='';return async(path,body,method=body===undefined?'GET':'POST')=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method,headers:{...(cookie?{cookie}:{}),...(body!==undefined?{'content-type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});const set=r.headers.get('set-cookie');if(set)cookie=set.split(';')[0];return {status:r.status,body:await r.json()};};}
const a=client(),b=client();const expect=(r,s)=>{assert.equal(r.status,s,`HTTP ${r.status}, expected ${s}: ${r.body?.error?.code}`);return r.body;};
async function check(id,name,fn){try{await fn();results.push({id,name,status:'pass'});}catch(error){results.push({id,name,status:'fail',error:error.message});}}
const context='  Relato sintético: a cliente depende de um aparelho para falar com a família.\nA viagem será amanhã.  ';
const policy='Há aparelho provisório disponível, mediante documento e devolução em até sete dias.';
let draft,original,version2,published,session;
try{
 await a('/api/health');await b('/api/health');
 await check('QA-A01','Creation passes the entire source through the real tool and commits only one result per command',async()=>{
  const commandId=randomUUID(),body={text:context,policyText:policy,commandId};const count=calls.length;
  const rs=await Promise.all([a('/api/drafts',body),a('/api/drafts',body)]);draft=expect(rs[0],200).draft;assert.deepEqual(expect(rs[1],200).draft,draft);assert.equal(calls.length,count+1);assert.equal(toolCalls,1);assert.equal(draft.rawContext,context);assert.equal(draft.rawPolicyText,policy);assert.equal(calls.at(-1).context,context);assert.equal(draft.authorTool.name,'compose_exercise');assert.equal(draft.version,1);assert.equal(draft.clientBrief.objective,'Manter contato com a família durante a viagem.');assert.equal(draft.compatibility.supported,true);original=structuredClone(draft);
  expect(await a('/api/drafts',{...body,text:context+' changed'}),409);assert.equal(calls.length,count+1);
 });
 await check('QA-A02','Revision updates the same draft, preserves original sources and keeps previous version immutable',async()=>{
  const text='Agora não há aparelho provisório disponível.',commandId=randomUUID(),body={text,commandId,expectedVersion:1};available=false;const count=calls.length;
  draft=expect(await a(`/api/drafts/${draft.id}/revisions`,body),200).draft;version2=structuredClone(draft);assert.equal(draft.version,2);assert.equal(draft.id,original.id);assert.equal(draft.rawContext,context);assert.equal(draft.rawPolicyText,policy);assert.equal(draft.rules.loanAvailable,false);assert.ok(!draft.graph.availableEndingIds.includes('END-01'));assert.equal(calls.at(-1).revision,text);assert.deepEqual(expect(await a(`/api/drafts/${draft.id}/revisions`,body),200).draft,draft);assert.equal(calls.length,count+1);
  const versions=expect(await a(`/api/drafts/${draft.id}/versions`),200).versions;assert.equal(versions.length,2);assert.deepEqual(versions.find(v=>v.version===1).draft,original);assert.equal(versions.find(v=>v.version===2).requestText,text);
 });
 await check('QA-A03','Stale versions, changed payload replays and other guests fail before invoking the author',async()=>{
  const count=calls.length;expect(await a(`/api/drafts/${draft.id}/revisions`,{text:'Nova alteração',commandId:randomUUID(),expectedVersion:1}),409);expect(await b(`/api/drafts/${draft.id}/revisions`,{text:'Intrusão',commandId:randomUUID(),expectedVersion:2}),404);expect(await b(`/api/drafts/${draft.id}/versions`),404);assert.equal(calls.length,count);
 });
 await check('QA-A04','Failure after successful tool composition leaves the prior draft and history intact',async()=>{
  const versions=expect(await a(`/api/drafts/${draft.id}/versions`),200);failure='final';expect(await a(`/api/drafts/${draft.id}/revisions`,{text:'Alteração que deve falhar após a ferramenta.',commandId:randomUUID(),expectedVersion:2}),503);failure=null;assert.deepEqual(expect(await a(`/api/drafts/${draft.id}/versions`),200),versions);
 });
 await check('QA-A05','Post-validation candidate changes and invented source quotes cannot commit',async()=>{
  const versions=expect(await a(`/api/drafts/${draft.id}/versions`),200);
  for(const kind of ['candidate','source']){failure=kind;expect(await a(`/api/drafts/${draft.id}/revisions`,{text:'Alteração sintética rejeitada.',commandId:randomUUID(),expectedVersion:2}),503);failure=null;assert.deepEqual(expect(await a(`/api/drafts/${draft.id}/versions`),200),versions);}
 });
 await check('QA-A06','Publish checks exact version and session snapshots cannot be changed by later draft revisions',async()=>{
  expect(await a(`/api/drafts/${draft.id}/publish`,{expectedVersion:1,commandId:randomUUID()}),409);published=expect(await a(`/api/drafts/${draft.id}/publish`,{expectedVersion:2,commandId:randomUUID()}),200).scenario;assert.equal(published.version,2);session=expect(await a('/api/sessions',{scenarioId:published.id,scenarioVersion:published.version}),200).session;assert.equal(session.scenario.rules.loanAvailable,false);
  available=true;draft=expect(await a(`/api/drafts/${draft.id}/revisions`,{text:'Agora há aparelho provisório disponível.',commandId:randomUUID(),expectedVersion:2}),200).draft;assert.equal(draft.version,3);assert.equal(draft.rules.loanAvailable,true);assert.deepEqual(expect(await a(`/api/sessions/${session.id}`),200).session,session);
 });
 await check('QA-A07','Concurrent revisions against one version yield one committed result and one conflict',async()=>{
  const count=calls.length,rs=await Promise.all(['Ajuste sintético A.','Ajuste sintético B.'].map(text=>a(`/api/drafts/${draft.id}/revisions`,{text,commandId:randomUUID(),expectedVersion:3})));assert.deepEqual(rs.map(r=>r.status).sort(),[200,409]);assert.equal(calls.length,count+1);assert.equal(expect(await a(`/api/drafts/${draft.id}/versions`),200).versions.length,4);
 });
 await check('QA-A08','A declared unsupported domain is rejected with 422 without changing the prior draft',async()=>{
  const beforeVersions=expect(await a(`/api/drafts/${draft.id}/versions`),200);failure='unsupported';const denied=expect(await a(`/api/drafts/${draft.id}/revisions`,{text:'Quero uma consulta clínica entre médico e paciente.',commandId:randomUUID(),expectedVersion:4}),422);failure=null;assert.equal(denied.error.code,'UNSUPPORTED_CONTEXT');assert.deepEqual(expect(await a(`/api/drafts/${draft.id}/versions`),200),beforeVersions);
 });
 await check('QA-A09','Invalid client characterization cannot create an extra version',async()=>{
  const beforeVersions=expect(await a(`/api/drafts/${draft.id}/versions`),200);failure='brief';expect(await a(`/api/drafts/${draft.id}/revisions`,{text:'Quatro características excedem o limite contratado.',commandId:randomUUID(),expectedVersion:4}),503);failure=null;assert.deepEqual(expect(await a(`/api/drafts/${draft.id}/versions`),200),beforeVersions);
 });
}finally{await app.close();}
const after=snapshot(),report={at:new Date().toISOString(),runId:'FRONTLINE-CHATS-V3-20261023',mode:'offline_injected_provider_real_server_tool',network:'loopback_only',port,serverClosed:true,readSetBefore:before,readSetAfter:after,snapshotStable:JSON.stringify(before)===JSON.stringify(after),providerInvocations:calls.length,toolExecutions:toolCalls,results,passed:results.filter(r=>r.status==='pass').length,failed:results.filter(r=>r.status==='fail').length,limits:['No real model inference or paid request.','Does not prove semantic domain compatibility or browser input preservation.']};
const artifact=resolve(folder,`author-${stamp}.json`);writeFileSync(artifact,JSON.stringify(report,null,2));console.log(JSON.stringify({artifact,passed:report.passed,failed:report.failed,snapshotStable:report.snapshotStable,failures:results.filter(r=>r.status==='fail')},null,2));process.exitCode=report.failed||!report.snapshotStable?1:0;
