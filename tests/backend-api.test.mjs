import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {canonicalJSON} from '../server/integrations/export.mjs';
import {createApp} from '../server/index.mjs';
import {AppError, fixture, fixtureIntent, fixtureAssessment} from '../server/engine.mjs';

// All providers below are explicit offline doubles. No credentials or model calls.
const fixtureProvider = () => ({mode:'fixture', draft:async()=>null, turn:async(s,text)=>({intent:fixtureIntent(s,text)}), assess:async s=>fixtureAssessment(s)});
const testRoot = resolve(import.meta.dirname,'../.local/orchestration/agents/backend/test-data');
mkdirSync(testRoot,{recursive:true});
async function boot(t,{provider=fixtureProvider(),databasePath=':memory:'}={}) {
  const app=createApp({provider,databasePath});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  let closed=false;
  const close=async()=>{if(!closed){closed=true;await app.close();}};
  t.after(close);
  return {app,base:`http://127.0.0.1:${app.server.address().port}`,close};
}
function client(base,cookie='') {
  return {get cookie(){return cookie;}, async req(path,body,method=body===undefined?'GET':'POST',extra={}){
    const response=await fetch(base+path,{method,headers:{...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];
    return {status:response.status,body:await response.json(),headers:response.headers};
  }};
}
async function start(c){const lib=await c.req('/api/library');assert.equal(lib.status,200);const result=await c.req('/api/sessions',{scenarioId:lib.body.scenarios[0].id,scenarioVersion:lib.body.scenarios[0].version});assert.equal(result.status,200);return result.body.session;}
async function command(c,s,op,extra={},id=randomUUID()){return c.req(`/api/sessions/${s.id}/${op}`,{commandId:id,expectedRevision:s.revision,...extra});}
async function finish(c,s,attempt=fixture.attempts[1]) {
  for(const objectId of ['OBJ-ORDEM','OBJ-POLITICA'])s=(await command(c,s,'documents',{objectId})).body.session;
  for(const m of attempt.messages.filter(m=>m.role==='user')) {const r=await command(c,s,'messages',{text:m.text});assert.equal(r.status,200,JSON.stringify(r.body));s=r.body.session;}
  return s;
}

test('HTTP journey preserves eight messages, three cited criteria and original branch',async t=>{
  const server=await boot(t),c=client(server.base);let s=await start(c);s=await finish(c,s);
  assert.equal(s.status,'completed');assert.equal(s.ending.id,'END-01');assert.equal(s.messages.length,8);assert.equal(s.attributes.preparo,2);
  for(const criterion of s.evaluation.criteria){const m=s.messages.find(m=>m.id===criterion.messageId&&m.role==='user');assert.ok(m.text.includes(criterion.quote));}
  const original=JSON.stringify(s),id=randomUUID();const branch=await command(c,s,'branches',{beforeMessageId:s.messages.find(m=>m.role==='user').id},id);
  assert.equal(branch.status,200);assert.equal(branch.body.session.parentSessionId,s.id);assert.equal(branch.body.session.messages.length,1);assert.equal(branch.body.session.branchScope,'from_opening');
  const duplicate=await command(c,s,'branches',{beforeMessageId:s.messages.find(m=>m.role==='user').id},id);assert.deepEqual(duplicate.body,branch.body);
  assert.equal(JSON.stringify((await c.req(`/api/sessions/${s.id}`)).body.session),original);
  const compare=await c.req(`/api/compare?left=${s.id}&right=${branch.body.session.id}`);assert.equal(compare.body.sameContext,true);
  assert.equal((await command(c,s,'messages',{text:'Mais uma fala.'})).status,409);
});

test('same command and reordered JSON are idempotent; differing payload and stale revision conflict',async t=>{
  const server=await boot(t),c=client(server.base),s=await start(c),id=randomUUID();
  const one=await command(c,s,'documents',{objectId:'OBJ-ORDEM'},id);
  const repeat=await c.req(`/api/sessions/${s.id}/documents`,{objectId:'OBJ-ORDEM',expectedRevision:s.revision,commandId:id});assert.deepEqual(repeat.body,one.body);
  const different=await command(c,s,'documents',{objectId:'OBJ-POLITICA'},id);assert.equal(different.status,409);assert.equal(different.body.error.code,'IDEMPOTENCY_CONFLICT');
  assert.equal((await command(c,s,'pause')).body.error.code,'REVISION_CONFLICT');
  assert.equal(server.app.store.db.prepare('SELECT COUNT(*) n FROM commands WHERE session_id=?').get(s.id).n,1);
  assert.equal(server.app.store.db.prepare('SELECT COUNT(*) n FROM events WHERE session_id=?').get(s.id).n,2);
});

test('concurrent distinct commands cannot commit against one revision twice',async t=>{
  const server=await boot(t),c=client(server.base),s=await start(c);
  const results=await Promise.all([command(c,s,'documents',{objectId:'OBJ-ORDEM'}),command(c,s,'documents',{objectId:'OBJ-POLITICA'})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal((await c.req(`/api/sessions/${s.id}`)).body.session.revision,1);
});

test('guest cookie ownership isolates session, comparison, drafts and published scenarios',async t=>{
  const server=await boot(t),a=client(server.base),b=client(server.base);const s=await start(a);await b.req('/api/health');
  assert.equal((await b.req(`/api/sessions/${s.id}`)).status,404);
  assert.equal((await command(b,s,'pause')).status,404);
  assert.equal((await b.req(`/api/compare?left=${s.id}&right=${s.id}`)).status,404);
  const d=(await a.req('/api/drafts',{text:'Contexto sintético de pós-venda.'})).body.draft;
  assert.equal((await b.req(`/api/drafts/${d.id}`,{title:'Intrusão'},'PATCH')).status,404);
  const published=(await a.req(`/api/drafts/${d.id}/publish`,{})).body.scenario;
  assert.equal((await b.req('/api/sessions',{scenarioId:published.id,scenarioVersion:published.version})).status,404);
  assert.equal((await b.req('/api/library')).body.sessions.length,0);
});

test('SQLite close/reopen preserves guest, pause, messages, receipts and immutable context',async t=>{
  const databasePath=resolve(mkdtempSync(resolve(testRoot,'restart-')),'test.sqlite');
  const first=await boot(t,{databasePath}),a=client(first.base);let s=await start(a);s=(await command(a,s,'documents',{objectId:'OBJ-POLITICA'})).body.session;
  const id=randomUUID(),pauseBody={commandId:id,expectedRevision:s.revision};s=(await a.req(`/api/sessions/${s.id}/pause`,pauseBody)).body.session;
  const cookie=a.cookie;await first.close();
  const second=await boot(t,{databasePath}),b=client(second.base,cookie);const loaded=(await b.req(`/api/sessions/${s.id}`)).body.session;assert.deepEqual(loaded,s);
  assert.deepEqual((await b.req(`/api/sessions/${s.id}/pause`,pauseBody)).body.session,s);
  assert.equal((await command(b,s,'messages',{text:'Ainda pausado'})).status,409);
  const resumed=await command(b,s,'resume');assert.equal(resumed.body.session.status,'active');assert.equal(resumed.body.session.messages.length,1);
});

test('context and policy retain all whitespace; executable rules change paths and published versions stay frozen',async t=>{
  const server=await boot(t),c=client(server.base);const raw='  Primeiro parágrafo.\n\nPreciso conversar sobre o aparelho.  ',policy='  Sem estoque\nPrazo: 2 dias  ';
  let d=(await c.req('/api/drafts',{text:raw,policyText:policy})).body.draft;assert.equal(d.rawContext,raw);assert.equal(d.rawPolicyText,policy);assert.match(d.label,/não interpretado/);
  d=(await c.req(`/api/drafts/${d.id}`,{rules:{loanAvailable:false,loanDays:2}},'PATCH')).body.draft;
  assert.deepEqual(d.graph.availableEndingIds,['END-02','END-03']);assert.ok(d.policy.terms.some(x=>x.includes('Não há')));
  const p=(await c.req(`/api/drafts/${d.id}/publish`,{})).body.scenario;
  const s=(await c.req('/api/sessions',{scenarioId:p.id,scenarioVersion:p.version})).body.session;
  const changed=(await c.req(`/api/drafts/${d.id}`,{rules:{loanAvailable:true,loanDays:7}},'PATCH')).body.draft;
  assert.ok(changed.version>p.version);assert.equal((await c.req(`/api/sessions/${s.id}`)).body.session.scenario.rules.loanAvailable,false);
  assert.equal((await c.req(`/api/drafts/${d.id}`,{rules:{loanAvailable:'yes'}},'PATCH')).status,422);
  assert.equal((await c.req(`/api/drafts/${d.id}`,{rules:{clientReturnDays:0}},'PATCH')).status,422);
  for(const value of [null,{criteria:[null,null,null]}])assert.equal((await c.req(`/api/drafts/${d.id}`,{rubric:value},'PATCH')).status,422);
});

test('real-mode draft proposal preserves source quotes and changes actual rules; fabricated source rejected',async t=>{
  const text='Não há aparelho para empréstimo. Só podemos combinar uma atualização.';
  const proposal={title:'Uma atualização honesta',summary:'O cliente precisa saber do reparo, sem provisório.',need:'Receber uma atualização',opening:'Como vou acompanhar o reparo?',unknowns:['Chegada da peça'],contextualFacts:[{id:'CTX-1',text:'Empréstimo indisponível no relato.',status:'provided',sourceQuote:'Não há aparelho para empréstimo.'}],rules:{loanAvailable:false,loanDays:null},ruleEvidence:{loanAvailable:'Não há aparelho para empréstimo.',loanDays:''}};
  const provider={...fixtureProvider(),mode:'openai',draft:async(_text,_policy,{executeTool})=>({...await executeTool('compose_exercise',{operation:'create',proposal:structuredClone(proposal)}),authorMessage:'Revise a disponibilidade antes de começar.'})};const server=await boot(t,{provider}),c=client(server.base);
  const result=await c.req('/api/drafts',{text});assert.equal(result.status,200);assert.equal(result.body.draft.rules.loanAvailable,false);assert.equal(result.body.draft.contextualFacts[0].sourceQuote,proposal.contextualFacts[0].sourceQuote);assert.deepEqual(result.body.draft.graph.availableEndingIds,['END-02','END-03']);
  proposal.ruleEvidence.loanAvailable='Texto inventado';const bad=await c.req('/api/drafts',{text});assert.equal(bad.status,503);assert.equal(bad.body.error.code,'INVALID_RULE_SOURCE');
});

test('provider failure before a turn preserves state and allows same command retry',async t=>{
  let fail=true;const provider=fixtureProvider(),turn=provider.turn;provider.turn=async(s,text)=>{if(fail)throw new AppError(503,'MODEL_TIMEOUT','Tempo excedido.');return turn(s,text);};
  const server=await boot(t,{provider}),c=client(server.base),s=await start(c),id=randomUUID();
  assert.equal((await command(c,s,'messages',{text:'Entendo a urgência.'},id)).status,503);
  assert.deepEqual((await c.req(`/api/sessions/${s.id}`)).body.session,s);
  fail=false;const retry=await command(c,s,'messages',{text:'Entendo a urgência.'},id);assert.equal(retry.status,200);assert.equal(retry.body.session.messages.length,3);
  assert.deepEqual((await command(c,s,'messages',{text:'Entendo a urgência.'},id)).body,retry.body);
});

test('assessment failure saves terminal conversation and retry inserts exactly one summary',async t=>{
  let fail=true;const provider=fixtureProvider();provider.assess=async s=>{if(fail)throw new AppError(503,'INVALID_CITATION','Citação inválida.');return fixtureAssessment(s);};
  const server=await boot(t,{provider}),c=client(server.base);let s=await finish(c,await start(c));
  assert.equal(s.status,'completed');assert.equal(s.messages.length,7);assert.equal(s.evaluation,null);assert.equal(s.assessmentError.code,'INVALID_CITATION');
  fail=false;const id=randomUUID(),before=s;s=(await command(c,s,'assessment/retry',{},id)).body.session;
  assert.equal(s.messages.length,8);assert.equal(s.assessmentError,undefined);assert.deepEqual((await command(c,before,'assessment/retry',{},id)).body.session,s);
  s=(await command(c,s,'assessment/retry')).body.session;assert.equal(s.messages.filter(m=>m.role==='summary').length,1);
});

test('domain commit rolls back state, messages and event if command receipt fails',async t=>{
  const server=await boot(t),c=client(server.base),s=await start(c);
  server.app.store.db.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON commands BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
  assert.equal((await command(c,s,'pause')).status,500);
  assert.deepEqual((await c.req(`/api/sessions/${s.id}`)).body.session,s);
  assert.equal(server.app.store.db.prepare('SELECT COUNT(*) n FROM events WHERE session_id=?').get(s.id).n,1);
});

test('malformed inputs and foreign origin fail without weakening identity or rules',async t=>{
  const server=await boot(t),c=client(server.base),s=await start(c);
  assert.equal((await c.req('/api/library',undefined,'GET',{origin:'https://foreign.invalid'})).status,403);
  assert.equal((await c.req('/api/sessions',{scenarioId:s.scenarioId,scenarioVersion:{}})).status,422);
  assert.equal((await command(c,s,'documents',{objectId:'OBJ-NOT-FOUND'})).status,422);
  assert.equal((await command(c,s,'messages',{text:' '})).status,422);
  assert.equal((await c.req('/api/compare')).status,422);
  assert.equal((await c.req('/api/drafts',{text:'x',policyText:[]})).status,422);
  assert.equal((await command(c,s,'resume')).status,409);
  const cancelled=(await command(c,s,'cancel')).body.session;assert.equal(cancelled.ending,null);assert.equal(cancelled.status,'cancelled');
  assert.equal((await command(c,cancelled,'resume')).status,409);
});

test('HTTP export is owner scoped, requires completed assessment and strips private input',async t=>{
  const server=await boot(t),a=client(server.base),b=client(server.base);let s=await start(a);await b.req('/api/health');
  assert.equal((await a.req(`/api/sessions/${s.id}/export`)).body.error.code,'EXPORT_NOT_READY');
  assert.equal((await b.req(`/api/sessions/${s.id}/export`)).status,404);
  s=await finish(a,s);const exported=await a.req(`/api/sessions/${s.id}/export`);assert.equal(exported.status,200);
  const {document,filename}=exported.body;assert.equal(document.schemaVersion,'frontline.export/1');assert.match(filename,/^frontline-revisao-.*\.json$/);
  assert.equal(document.payload.session.mode,'fixture');assert.equal(document.payload.session.messages.length,8);
  for(const field of ['_state','owner','providerTrace','rawContext','rawPolicyText'])assert.ok(!JSON.stringify(document).includes(`"${field}"`));
  const untrusted=await a.req('/api/exports/verify',{document});assert.equal(untrusted.body.valid,true);assert.equal(untrusted.body.matchesTrustedExport,null);assert.equal(untrusted.body.anchored,false);
  const trusted=await a.req('/api/exports/verify',{document,sessionId:s.id});assert.equal(trusted.body.matchesTrustedExport,true);
  assert.equal((await b.req('/api/exports/verify',{document,sessionId:s.id})).status,404);
});

test('HTTP verify distinguishes damaged copies from rehashed copies and ignores client-provided trust',async t=>{
  const server=await boot(t),c=client(server.base),s=await finish(c,await start(c));const {document}= (await c.req(`/api/sessions/${s.id}/export`)).body;
  const altered=structuredClone(document);altered.payload.notice='Cópia alterada no teste sintético.';
  const bad=await c.req('/api/exports/verify',{document:altered});assert.equal(bad.body.valid,false);assert.equal(bad.body.reason,'HASH_MISMATCH');
  altered.integrity.sha256=createHash('sha256').update(canonicalJSON({schemaVersion:altered.schemaVersion,payload:altered.payload})).digest('hex');
  const different=await c.req('/api/exports/verify',{document:altered,sessionId:s.id});assert.equal(different.body.valid,true);assert.equal(different.body.matchesTrustedExport,false);assert.equal(different.body.reason,'DIFFERENT_REFERENCE');
  const noTrust=await c.req('/api/exports/verify',{document:altered,expectedSha256:altered.integrity.sha256});assert.equal(noTrust.body.matchesTrustedExport,null);
  assert.equal((await c.req('/api/exports/verify',{})).body.valid,false);
});

test('only verification accepts bodies over 64 KB and 1 MiB remains a hard HTTP limit',async t=>{
  const server=await boot(t),c=client(server.base);const medium='x'.repeat(70000);
  assert.equal((await c.req('/api/exports/verify',{document:medium})).status,200);
  assert.equal((await c.req('/api/drafts',{text:medium})).status,413);
  assert.equal((await c.req('/api/exports/verify',{document:'x'.repeat(1024*1024)})).status,413);
});

test('integration capabilities remain honest and forged account input cannot link WhatsApp',async t=>{
  const server=await boot(t),c=client(server.base);const r=await c.req('/api/integrations/status');assert.equal(r.status,200);
  assert.equal(r.body.whatsapp.available,false);assert.equal(r.body.devnet.available,false);assert.equal(r.body.export.available,true);
  for(const path of ['/api/integrations/whatsapp','/api/integrations/whatsapp/link','/api/integrations/whatsapp/confirm']) {
    const denied=await c.req(path,{principal:{id:'forged-account',kind:'account',authenticated:true}},'POST',{'x-account-id':'forged-account'});
    assert.equal(denied.status,401);assert.equal(denied.body.error.code,'ACCOUNT_AUTH_REQUIRED');
  }
});

const authorProposal=(title='Atualização de pós-venda',rules={loanAvailable:null,loanDays:null},ruleEvidence={loanAvailable:'',loanDays:''})=>({title,summary:'Uma conversa simulada sobre o atendimento.',need:'Saber como acompanhar o reparo.',opening:'Como vou acompanhar meu aparelho?',unknowns:['Prazo do reparo'],contextualFacts:[],rules,ruleEvidence,clientBrief:{objective:'Conseguir uma resposta confiável.',traits:['Pede clareza.'],initialState:'Cliente fictício preocupado.'}});
function offlineAuthor(proposals=[authorProposal()]) {
  const p={...fixtureProvider(),mode:'openai',calls:0};
  p.draft=async(_text,_policy,options)=>{const proposal=structuredClone(proposals[Math.min(p.calls++,proposals.length-1)]);const result=await options.executeTool('compose_exercise',{operation:options.currentDraft?'revise':'create',proposal});return {...result,authorMessage:'Confira o contexto e as premissas antes de começar.'};};
  return p;
}

test('author creates and revises immutable versions, receipts avoid repeat calls and start binds the reviewed version',async t=>{
  const original='  Preciso resolver um pós-venda.  ',revision='Agora não há aparelho provisório.',revision2='Mude o título para Acompanhamento honesto.';
  const revised=authorProposal('Sem provisório',{loanAvailable:false,loanDays:null},{loanAvailable:revision,loanDays:''});
  const last={...structuredClone(revised),title:'Acompanhamento honesto'};
  const provider=offlineAuthor([authorProposal(),revised,last]);const server=await boot(t,{provider}),c=client(server.base),createBody={text:original,policyText:'  Política preservada.  ',commandId:'create-one'};
  const first=await c.req('/api/drafts',createBody);assert.equal(first.status,200,JSON.stringify(first.body));let d=first.body.draft;const v1=structuredClone(d);
  assert.deepEqual((await c.req('/api/drafts',createBody)).body,first.body);assert.equal(provider.calls,1);
  assert.equal((await c.req('/api/drafts',{...createBody,text:'Outro contexto'})).status,409);assert.equal(provider.calls,1);
  assert.equal(d.authorTool.name,'compose_exercise');assert.equal(d.authorTool.validation.environmentId,'assistencia');assert.equal(d.clientBrief.objective,'Conseguir uma resposta confiável.');
  const revisionBody={text:revision,expectedVersion:1,commandId:'revision-one'};
  const second=await c.req(`/api/drafts/${d.id}/revisions`,revisionBody);assert.equal(second.status,200,JSON.stringify(second.body));d=second.body.draft;
  assert.equal(d.version,2);assert.equal(d.rules.loanAvailable,false);assert.equal(d.rawContext,original);assert.equal(d.rawPolicyText,createBody.policyText);assert.equal(d.revisionHistory[0].requestText,revision);
  d=(await c.req(`/api/drafts/${d.id}/revisions`,{text:revision2,expectedVersion:2,commandId:'revision-two'})).body.draft;
  assert.equal(d.version,3);assert.equal(d.revisionHistory.length,2);assert.equal(d.rules.loanAvailable,false);
  assert.deepEqual((await c.req(`/api/drafts/${d.id}/revisions`,revisionBody)).body,second.body);assert.equal(provider.calls,3);
  const stale=await c.req(`/api/drafts/${d.id}/revisions`,{...revisionBody,commandId:'stale'});assert.equal(stale.status,409);assert.equal(provider.calls,3);
  const versions=(await c.req(`/api/drafts/${d.id}/versions`)).body.versions;assert.deepEqual(versions.map(v=>v.version),[3,2,1]);assert.deepEqual(versions[2].draft,v1);assert.equal(versions[1].requestText,revision);
  assert.equal((await c.req(`/api/drafts/${d.id}/publish`,{expectedVersion:2})).status,409);
  const publishBody={expectedVersion:3,commandId:'publish-three'};const published=await c.req(`/api/drafts/${d.id}/publish`,publishBody);assert.equal(published.status,200);
  const s=(await c.req('/api/sessions',{scenarioId:d.id,scenarioVersion:3})).body.session;assert.equal(s.scenarioVersion,3);assert.equal(s.scenario.rules.loanAvailable,false);
  const changed=(await c.req(`/api/drafts/${d.id}`,{expectedVersion:3,rules:{loanAvailable:true}},'PATCH')).body.draft;assert.equal(changed.version,4);
  assert.deepEqual((await c.req(`/api/drafts/${d.id}/publish`,publishBody)).body,published.body);
  assert.equal((await c.req(`/api/sessions/${s.id}`)).body.session.scenario.rules.loanAvailable,false);
  assert.equal((await c.req(`/api/drafts/${d.id}`,{expectedVersion:3,title:'Stale'},'PATCH')).status,409);
});

test('draft commands and histories enforce ACL and fixture never pretends to interpret revisions',async t=>{
  const server=await boot(t),a=client(server.base),b=client(server.base),body={text:'Contexto demonstrativo.',commandId:'same-key'};
  const d=(await a.req('/api/drafts',body)).body.draft;const other=(await b.req('/api/drafts',body)).body.draft;assert.notEqual(d.id,other.id);
  assert.equal((await b.req(`/api/drafts/${d.id}/versions`)).status,404);
  assert.equal((await b.req(`/api/drafts/${d.id}/revisions`,{text:'Mude.',expectedVersion:1,commandId:'x'})).status,404);
  assert.equal((await a.req(`/api/drafts/${d.id}/revisions`,{text:'Mude.',expectedVersion:1,commandId:'x'})).body.error.code,'AUTHOR_REQUIRES_OPENAI');
  assert.equal((await a.req(`/api/drafts/${d.id}/versions`)).body.versions.length,1);
});

test('invalid author final after a valid tool has no partial effects and can be retried',async t=>{
  const provider=offlineAuthor(),original=provider.draft;let fail=false;
  provider.draft=async(...args)=>{const result=await original(...args);if(fail)result.candidate.title='Candidate replaced after tool execution';return result;};
  const server=await boot(t,{provider}),c=client(server.base);const d=(await c.req('/api/drafts',{text:'Relato de pós-venda.'})).body.draft;
  fail=true;const body={text:'Refine o objetivo.',expectedVersion:1,commandId:'retryable'};
  const bad=await c.req(`/api/drafts/${d.id}/revisions`,body);assert.equal(bad.status,503);assert.equal(bad.body.error.code,'INVALID_AUTHOR_RESULT');
  assert.deepEqual((await c.req(`/api/drafts/${d.id}/versions`)).body.versions.map(x=>x.draft),[d]);
  assert.equal(server.app.store.db.prepare('SELECT COUNT(*) n FROM draft_commands WHERE scope=?').get(d.id).n,0);
  fail=false;assert.equal((await c.req(`/api/drafts/${d.id}/revisions`,body)).body.draft.version,2);
});

test('concurrent draft revisions serialize and a second process changing the version cannot be overwritten',async t=>{
  const provider=offlineAuthor(),server=await boot(t,{provider}),c=client(server.base);const d=(await c.req('/api/drafts',{text:'Relato de pós-venda.'})).body.draft;
  const results=await Promise.all(['a','b'].map(commandId=>c.req(`/api/drafts/${d.id}/revisions`,{text:'Ajuste o objetivo.',expectedVersion:1,commandId})));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(provider.calls,2);
  let started,release;const ready=new Promise(r=>started=r),gate=new Promise(r=>release=r),draft=provider.draft;
  provider.draft=async(...args)=>{started();await gate;return draft(...args);};
  const pending=c.req(`/api/drafts/${d.id}/revisions`,{text:'Outra alteração.',expectedVersion:2,commandId:'during-change'});await ready;
  const owner=server.app.store.identity(c.cookie).owner;const external=server.app.store.getDraft(owner,d.id);external.version++;external.policy.version++;external.title='Mudança concorrente sintética';server.app.store.saveDraft(owner,external);release();
  assert.equal((await pending).status,409);assert.equal(server.app.store.getDraft(owner,d.id).title,external.title);
  assert.equal(server.app.store.db.prepare('SELECT COUNT(*) n FROM draft_commands WHERE command_id=?').get('during-change').n,0);
});

test('draft receipt failure rolls back both current draft and immutable version atomically',async t=>{
  const server=await boot(t),c=client(server.base);server.app.store.db.exec("CREATE TRIGGER fail_draft_receipt BEFORE INSERT ON draft_commands BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END;");
  const body={text:'Relato sintético.',commandId:'atomic-create'};assert.equal((await c.req('/api/drafts',body)).status,500);
  for(const table of ['drafts','draft_versions','draft_commands'])assert.equal(server.app.store.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);
  server.app.store.db.exec('DROP TRIGGER fail_draft_receipt');assert.equal((await c.req('/api/drafts',body)).status,200);
});

test('restart preserves draft history and creation/publish receipts without regenerating',async t=>{
  const databasePath=resolve(mkdtempSync(resolve(testRoot,'draft-restart-')),'test.sqlite');const first=await boot(t,{databasePath}),a=client(first.base),body={text:'Relato persistido.',commandId:'create-persisted'};
  const created=await a.req('/api/drafts',body);let d=created.body.draft;d=(await a.req(`/api/drafts/${d.id}`,{expectedVersion:1,rules:{loanDays:2}},'PATCH')).body.draft;
  const publishBody={expectedVersion:2,commandId:'publish-persisted'},published=await a.req(`/api/drafts/${d.id}/publish`,publishBody),cookie=a.cookie;await first.close();
  const provider=fixtureProvider();provider.draft=async()=>{throw Error('Must not regenerate');};const second=await boot(t,{databasePath,provider}),b=client(second.base,cookie);
  assert.deepEqual((await b.req('/api/drafts',body)).body,created.body);assert.deepEqual((await b.req(`/api/drafts/${d.id}/publish`,publishBody)).body,published.body);
  assert.deepEqual((await b.req(`/api/drafts/${d.id}/versions`)).body.versions.map(v=>v.version),[2,1]);
});

test('unsupported domain is rejected with literal source and does not save a candidate or revision',async t=>{
  const unsupported=authorProposal();unsupported.compatibility={supported:false,reason:'O relato descreve uma consulta médica, fora do catálogo de assistência.',sourceQuote:'consulta médica'};
  const provider=offlineAuthor([unsupported,authorProposal(),unsupported]),server=await boot(t,{provider}),c=client(server.base);
  const rejected=await c.req('/api/drafts',{text:'Preciso simular uma consulta médica.',commandId:'unsupported-create'});assert.equal(rejected.status,422);assert.equal(rejected.body.error.code,'UNSUPPORTED_CONTEXT');
  for(const table of ['drafts','draft_versions','draft_commands'])assert.equal(server.app.store.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);
  const d=(await c.req('/api/drafts',{text:'Pós-venda de aparelho em reparo.'})).body.draft;
  const revision=await c.req(`/api/drafts/${d.id}/revisions`,{text:'Troque para uma consulta médica.',expectedVersion:1,commandId:'unsupported-revise'});assert.equal(revision.status,422);
  assert.deepEqual((await c.req(`/api/drafts/${d.id}/versions`)).body.versions.map(v=>v.draft),[d]);
});

test('client brief and domain provenance reject invalid data without mutating current state',async t=>{
  const badBrief=authorProposal();badBrief.clientBrief.traits=['a','b','c','d'];
  const badSource=authorProposal();badSource.compatibility={supported:false,reason:'Fora do domínio.',sourceQuote:'citação inexistente'};
  const crossBoundary=authorProposal();crossBoundary.compatibility={supported:false,reason:'Fora do domínio.',sourceQuote:'Original\n\nRevisão'};
  const provider=offlineAuthor([badBrief,badSource,authorProposal(),crossBoundary]),server=await boot(t,{provider}),c=client(server.base);
  assert.equal((await c.req('/api/drafts',{text:'Original'})).body.error.code,'INVALID_MODEL_OUTPUT');
  assert.equal((await c.req('/api/drafts',{text:'Original'})).body.error.code,'INVALID_CONTEXT_SOURCE');
  const d=(await c.req('/api/drafts',{text:'Original'})).body.draft;
  assert.equal((await c.req(`/api/drafts/${d.id}/revisions`,{text:'Revisão',expectedVersion:1,commandId:'cross-source'})).body.error.code,'INVALID_CONTEXT_SOURCE');
  assert.equal((await c.req(`/api/drafts/${d.id}/versions`)).body.versions.length,1);
});

test('corrected seed appends a version while preserving old scenario and historical session bytes',async t=>{
  const databasePath=resolve(mkdtempSync(resolve(testRoot,'seed-upgrade-')),'test.sqlite');const first=await boot(t,{databasePath}),a=client(first.base),s=await start(a);
  const old=structuredClone(s.scenario);old.rules.clientReturnDays=3;const oldJSON=JSON.stringify(old);
  first.app.store.db.prepare('UPDATE scenarios SET data=? WHERE id=? AND version=?').run(oldJSON,old.id,old.version);
  s.scenario=old;const historicalJSON=JSON.stringify(s);first.app.store.db.prepare('UPDATE sessions SET data=? WHERE id=?').run(historicalJSON,s.id);
  await first.close();const second=await boot(t,{databasePath});
  assert.equal(second.app.store.db.prepare('SELECT data FROM scenarios WHERE id=? AND version=1').get(old.id).data,oldJSON);
  assert.equal(second.app.store.db.prepare('SELECT data FROM sessions WHERE id=?').get(s.id).data,historicalJSON);
  assert.equal(second.app.store.getScenario(old.id,undefined,'*').version,2);assert.equal(second.app.store.getScenario(old.id,undefined,'*').rules.clientReturnDays,4);
  await second.close();const third=await boot(t,{databasePath});assert.equal(third.app.store.db.prepare('SELECT COUNT(*) n FROM scenarios WHERE id=?').get(old.id).n,2);
});
