import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/index.mjs';
import {fixtureIntent,fixtureAssessment,intentKeys} from '../server/engine.mjs';

// Synthetic accounts on local ephemeral servers only; no external auth/model calls.
const password='Synthetic-Password-123';
const providerFixture=()=>({mode:'fixture',draft:async()=>null,turn:async(s,text)=>({intent:fixtureIntent(s,text)}),assess:async s=>fixtureAssessment(s)});
const testRoot=resolve(import.meta.dirname,'../.local/orchestration/agents/backend/test-data');mkdirSync(testRoot,{recursive:true});
async function boot(t,{provider=providerFixture(),databasePath=':memory:',secureCookies=false}={}){
  const app=createApp({provider,databasePath,secureCookies});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));let closed=false;
  const close=async()=>{if(!closed){closed=true;await app.close();}};t.after(close);
  return {app,base:`http://127.0.0.1:${app.server.address().port}`,close};
}
function client(base,initial=''){
  const jar=new Map(initial.split(';').map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)];}));
  return {get cookie(){return [...jar].map(([k,v])=>`${k}=${v}`).join('; ');},async req(path,body,method=body===undefined?'GET':'POST'){
    const response=await fetch(base+path,{method,headers:{cookie:this.cookie,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const setCookies=response.headers.getSetCookie();for(const raw of setCookies){const pair=raw.split(';')[0],i=pair.indexOf('='),name=pair.slice(0,i),value=pair.slice(i+1);if(/(?:^|;)\s*Max-Age=0(?:;|$)/i.test(raw))jar.delete(name);else jar.set(name,value);}
    return {status:response.status,body:await response.json(),setCookies,headers:response.headers};
  }};
}
const register=(c,email='first@test.invalid')=>c.req('/api/account/register',{name:'Pessoa Sintética',email,password});
const login=(c,email='first@test.invalid')=>c.req('/api/account/login',{email,password});
async function start(c){const library=await c.req('/api/library');const scenario=library.body.scenarios[0];const r=await c.req('/api/sessions',{scenarioId:scenario.id,scenarioVersion:scenario.version});assert.equal(r.status,200);return r.body.session;}
const command=(c,s,op,extra={})=>c.req(`/api/sessions/${s.id}/${op}`,{commandId:randomUUID(),expectedRevision:s.revision,...extra});
function latch(){let started,release;return {ready:new Promise(r=>started=r),wait:new Promise(r=>release=r),start:()=>started(),release:()=>release()};}
const helpBody=(commandId='help-one')=>({commandId,text:'Como exportar uma revisão?',view:'library'});

test('registration claims visitor drafts, versions, session and help atomically; logout never exposes claimed data',async t=>{
  const server=await boot(t),c=client(server.base);const h=await c.req('/api/help/messages',helpBody());assert.equal(h.status,200);assert.equal(h.body.conversation.mode,'guide');
  let d=(await c.req('/api/drafts',{text:'Relato fictício de pós-venda.',commandId:'draft-one'})).body.draft;
  d=(await c.req(`/api/drafts/${d.id}`,{expectedVersion:1,rules:{loanDays:4}},'PATCH')).body.draft;
  const p=(await c.req(`/api/drafts/${d.id}/publish`,{expectedVersion:2,commandId:'publish-two'})).body.scenario;
  const s=(await c.req('/api/sessions',{scenarioId:p.id,scenarioVersion:2})).body.session;
  const guestCookie=c.cookie;const registered=await register(c);assert.equal(registered.status,200);assert.equal(registered.body.authenticated,true);
  assert.ok(registered.setCookies.some(x=>x.startsWith('frontline_account=')&&x.includes('HttpOnly')&&x.includes('SameSite=Lax')));assert.ok(registered.setCookies.some(x=>x.startsWith('frontline_guest=;')&&x.includes('Max-Age=0')));
  assert.equal((await c.req('/api/library')).body.sessions[0].id,s.id);assert.equal((await c.req(`/api/drafts/${d.id}/versions`)).body.versions.length,2);
  assert.equal((await c.req('/api/help/conversation')).body.conversation.id,h.body.conversation.id);
  assert.deepEqual((await c.req('/api/help/messages',helpBody())).body,h.body);
  const oldGuest=client(server.base,guestCookie);assert.equal((await oldGuest.req(`/api/sessions/${s.id}`)).status,404);assert.equal((await oldGuest.req('/api/help/conversation')).body.conversation.messages.length,0);
  const accountCookie=c.cookie;const logout=await c.req('/api/account/logout',{});assert.equal(logout.status,200);assert.equal(logout.setCookies.length,2);assert.equal(c.cookie,'');
  assert.equal((await c.req('/api/library')).body.sessions.length,0);
  assert.equal((await client(server.base,accountCookie+'; '+guestCookie).req('/api/library')).status,401);
  assert.equal(server.app.store.db.prepare('SELECT COUNT(*) n FROM help_messages').get().n,2);
});

test('two accounts remain isolated and login never silently imports a different visitor history',async t=>{
  const server=await boot(t),a=client(server.base),b=client(server.base),visitor=client(server.base);
  assert.equal((await register(a,'a@test.invalid')).status,200);const sessionA=await start(a);
  assert.equal((await register(b,'b@test.invalid')).status,200);assert.equal((await b.req(`/api/sessions/${sessionA.id}`)).status,404);
  const guestSession=await start(visitor);const guestCookie=visitor.cookie;
  assert.equal((await login(visitor,'a@test.invalid')).status,200);
  const ids=(await visitor.req('/api/library')).body.sessions.map(s=>s.id);assert.ok(ids.includes(sessionA.id));assert.ok(!ids.includes(guestSession.id));
  assert.equal((await client(server.base,guestCookie).req(`/api/sessions/${guestSession.id}`)).status,200);
  const wrong=await b.req('/api/account/login',{email:'a@test.invalid',password:'Incorrect-password-123'});assert.equal(wrong.status,401);assert.equal(wrong.body.error.code,'INVALID_CREDENTIALS');
  assert.equal((await b.req('/api/account')).body.user.email,'b@test.invalid');
});

test('account/help survive restart; expired authentication cannot fall back to a guest and explicit login recovers',async t=>{
  const databasePath=resolve(mkdtempSync(resolve(testRoot,'account-http-')),'test.sqlite');const first=await boot(t,{databasePath,secureCookies:true}),a=client(first.base);
  const reg=await register(a);assert.equal(reg.status,200);assert.ok(reg.setCookies.every(x=>x.includes('; Secure')));
  const help=await a.req('/api/help/messages',helpBody());const cookie=a.cookie;await first.close();
  const second=await boot(t,{databasePath}),b=client(second.base,cookie);assert.equal((await b.req('/api/account')).body.authenticated,true);assert.deepEqual((await b.req('/api/help/conversation')).body.conversation,help.body.conversation);
  second.app.store.db.prepare('UPDATE account_sessions SET expires_at=?').run(Date.now()-1);
  assert.equal((await b.req('/api/account')).status,401);assert.equal((await b.req('/api/library')).status,401);
  assert.equal((await login(b)).status,200);assert.equal((await b.req('/api/help/conversation')).body.conversation.messages.length,2);
  const malformed=client(second.base,'frontline_account=bad; frontline_guest=old');assert.equal((await malformed.req('/api/account/logout',{})).status,200);assert.equal(malformed.cookie,'');
});

test('help actions are bounded and a fake view cannot bypass active or paused training',async t=>{
  const server=await boot(t),c=client(server.base);const sent=await c.req('/api/help/messages',helpBody());assert.equal(sent.status,200);
  assert.ok(sent.body.actions.some(x=>x.id==='open_records'),'Export guidance should link to records.');
  assert.ok(sent.body.actions.every(x=>['open_library','open_preparation','open_reviews','open_records','open_channels','highlight_documents'].includes(x.id)));
  const replay=await c.req('/api/help/messages',helpBody());assert.deepEqual(replay.body,sent.body);
  assert.equal((await c.req('/api/help/messages',{...helpBody(),text:'Outro conteúdo'})).status,409);
  let s=await start(c);assert.equal((await c.req('/api/help/messages',helpBody('blocked-active'))).body.error.code,'HELP_DURING_TRAINING');
  s=(await command(c,s,'pause')).body.session;assert.equal((await c.req('/api/help/messages',helpBody('blocked-paused'))).body.error.code,'HELP_DURING_TRAINING');
  assert.equal((await c.req('/api/help/conversation')).body.conversation.messages.length,2);
  s=(await command(c,s,'cancel')).body.session;assert.equal((await c.req('/api/help/messages',helpBody('after-cancel'))).status,200);
});

test('help starting before training cannot commit after a training session begins',async t=>{
  const gate=latch(),provider={...providerFixture(),mode:'openai',help:async input=>{assert.equal(input.history.length,0);assert.equal(input.session,undefined);gate.start();await gate.wait;return {text:'Abra a Biblioteca.',actionIds:['open_library']};}};
  const server=await boot(t,{provider}),c=client(server.base);await c.req('/api/health');
  const pending=c.req('/api/help/messages',helpBody());await gate.ready;await start(c);gate.release();
  const result=await pending;assert.equal(result.status,409);assert.equal(result.body.error.code,'HELP_DURING_TRAINING');
  assert.equal((await c.req('/api/help/conversation')).body.conversation.messages.length,0);assert.equal(server.app.store.db.prepare('SELECT COUNT(*) n FROM help_commands').get().n,0);
});

test('logout during help inference revokes the pending request before any messages are stored',async t=>{
  const gate=latch(),provider={...providerFixture(),mode:'openai',help:async()=>{gate.start();await gate.wait;return{text:'Abra a Biblioteca.',actionIds:[]};}};
  const server=await boot(t,{provider}),c=client(server.base);await register(c);
  const pending=c.req('/api/help/messages',helpBody());await gate.ready;await c.req('/api/account/logout',{});gate.release();
  assert.equal((await pending).status,401);assert.equal((await login(c)).status,200);
  assert.equal((await c.req('/api/help/conversation')).body.conversation.messages.length,0);
});

test('registration while authoring cannot save a draft under a deleted visitor identity',async t=>{
  const gate=latch(),provider={...providerFixture(),mode:'openai',draft:async(_text,_policy,{executeTool})=>{
    gate.start();await gate.wait;const projected=await executeTool('compose_exercise',{operation:'create',proposal:{title:'Atendimento sintético',summary:'Um exercício de assistência.',opening:'Preciso de uma alternativa para minha viagem.',need:'Comunicação durante a viagem',unknowns:[],contextualFacts:[],rules:{loanAvailable:null,loanDays:null},ruleEvidence:{loanAvailable:'',loanDays:''}}});
    return {...projected,authorMessage:'Confira as premissas fictícias.'};
  }};
  const server=await boot(t,{provider}),c=client(server.base);await c.req('/api/health');
  const pending=c.req('/api/drafts',{text:'Relato de assistência.',commandId:'pending-author'});await gate.ready;assert.equal((await register(c)).status,200);gate.release();
  const result=await pending;assert.equal(result.status,409);assert.equal(result.body.error.code,'IDENTITY_CHANGED');
  assert.equal(server.app.store.db.prepare('SELECT COUNT(*) n FROM drafts').get().n,0);assert.equal(server.app.store.db.prepare('SELECT COUNT(*) n FROM draft_commands').get().n,0);
});

test('logout after turn projection prevents the training commit and preserves the saved transcript',async t=>{
  const gate=latch(),provider={...providerFixture(),mode:'openai',turn:async(s,text,{executeTurn})=>{
    const intent=Object.fromEntries(intentKeys.map(k=>[k,k==='acknowledgesNeed'])),evidence=Object.fromEntries(intentKeys.map(k=>[k,intent[k]?text:'']));
    await executeTurn('apply_training_turn',{intent,evidence});gate.start();await gate.wait;
    return {intent,evidence,reply:'Preciso manter contato durante a viagem.',turnTool:{name:'apply_training_turn',status:'validated'}};
  }};
  const server=await boot(t,{provider}),c=client(server.base);await register(c);const s=await start(c);
  const pending=command(c,s,'messages',{text:'Entendo sua necessidade.'});await gate.ready;await c.req('/api/account/logout',{});gate.release();
  assert.equal((await pending).status,401);await login(c);
  assert.deepEqual((await c.req(`/api/sessions/${s.id}`)).body.session,s);assert.equal(server.app.store.db.prepare('SELECT COUNT(*) n FROM commands WHERE session_id=?').get(s.id).n,0);
});

test('help mode changes never relabel old guide messages or silently substitute a guide for missing OpenAI',async t=>{
  const provider=providerFixture(),server=await boot(t,{provider}),c=client(server.base);
  const first=await c.req('/api/help/messages',helpBody());assert.equal(first.status,200);assert.ok(first.body.conversation.messages.every(m=>m.mode==='guide'));
  provider.mode='openai';
  const unavailable=await c.req('/api/help/messages',helpBody('no-provider'));assert.equal(unavailable.status,503);assert.equal(unavailable.body.error.code,'HELP_UNAVAILABLE');
  let history=(await c.req('/api/help/conversation')).body.conversation;assert.equal(history.mode,'openai');assert.equal(history.messages.length,2);assert.ok(history.messages.every(m=>m.mode==='guide'));
  provider.help=async()=>({text:'Abra Registros para exportar a revisão.',actionIds:['open_records']});
  history=(await c.req('/api/help/messages',helpBody('available-provider'))).body.conversation;
  assert.deepEqual(history.messages.map(m=>m.mode),['guide','guide','openai','openai']);
});
