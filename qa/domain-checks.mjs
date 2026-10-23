import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import * as e from '../server/engine.mjs';
import {openStore,hash} from '../server/store.mjs';

// Independent QA with synthetic inputs. No network or paid model request.
const root=resolve(import.meta.dirname,'..');
const evidenceDir=resolve(root,'qa/evidence');mkdirSync(evidenceDir,{recursive:true});
const stamp=new Date().toISOString().replaceAll(':','-').replaceAll('.','-');
const readSet=['server/engine.mjs','server/store.mjs','shared/scene.json','shared/API_CONTRACT.md','qa/domain-checks.mjs'];
const snapshot=()=>Object.fromEntries(readSet.map(f=>[f,createHash('sha256').update(readFileSync(resolve(root,f))).digest('hex')]));
const before=snapshot(),results=[];
async function check(id,name,fn){try{await fn();results.push({id,name,status:'pass'});}catch(err){results.push({id,name,status:'fail',error:err.message});}}
const session=mode=>e.newSession(e.baseScenario(),mode||'fixture');
const flags=extra=>({...Object.fromEntries(e.intentKeys.map(k=>[k,false])),...extra});
function modelTurn(s,text,extra,reply='Preciso manter contato com minha família durante a viagem.'){
 const intent=flags(extra);return e.applyTurn(s,text,{intent,reply,evidence:Object.fromEntries(Object.keys(intent).map(k=>[k,intent[k]?text:'']))});
}
function fixtureTurn(s,text){return e.applyTurn(s,text,{intent:e.fixtureIntent(s,text)});}

await check('QA-D01','Calendar consultation and reopening documents do not inflate preparation or messages',()=>{
 const s=session();e.openDocument(s,'OBJ-CALENDARIO');assert.equal(s.attributes.preparo,0);e.openDocument(s,'OBJ-ORDEM');e.openDocument(s,'OBJ-ORDEM');e.openDocument(s,'OBJ-POLITICA');e.openDocument(s,'OBJ-POLITICA');assert.equal(s.attributes.preparo,2);assert.equal(s.messages.length,1);assert.equal(s.attributes.autonomia,1);
});
await check('QA-D15','Fixture negation of a repair guarantee must not become an unsupported promise',()=>{
 const s=session();
 for(const text of ['Vou verificar o estoque e te atualizar hoje às 17h, sem garantir o reparo.','Vou atualizar você amanhã, sem garantir prazo de conserto.']){
  const intent=e.fixtureIntent(s,text);assert.equal(intent.unsupportedPromise,false,`Negation misclassified: ${text}`);assert.equal(intent.nextStep,true);assert.equal(intent.explainsUnknownEta,true);
 }
 assert.equal(e.fixtureIntent(s,'Garanto que o reparo ficará pronto amanhã.').unsupportedPromise,true);
});
await check('QA-D02','A single participant turn cannot ask the conditions and already complete the loan',()=>{
 let s=session();e.openDocument(s,'OBJ-POLITICA');s=fixtureTurn(s,'Confirmo o empréstimo provisório: você tem documento e consegue devolver em sete dias?');assert.notEqual(s.commitment.status,'valid');assert.equal(s.attributes.autonomia,2);
});
await check('QA-D03','A loan requires reading the policy even when model intents request it',()=>{
 let s=session('openai');s=modelTurn(s,'Tem RG e consegue trazer o equipamento de volta no prazo?',{offerLoan:true,askIdentity:true,askReturn:true});s=modelTurn(s,'Fechamos a alternativa temporária.',{offerLoan:true,confirmLoan:true});assert.notEqual(s.commitment.status,'valid');
});
await check('QA-D04','Real-mode paraphrases are interpreted from structured intent and preserve contextual reply',()=>{
 let s=session('openai');e.openDocument(s,'OBJ-POLITICA');const text='Tem RG e consegue trazer o equipamento de volta até terça-feira?';const reply='Estou com meu RG e consigo voltar no dia 27; preciso ligar para minha filha.';s=modelTurn(s,text,{offerLoan:true,askIdentity:true,askReturn:true},reply);assert.equal(s.attributes.autonomia,2);assert.equal(s.messages.at(-1).text,reply);
});
await check('QA-D16','OpenAI NPC reply remains exact across three turns without fixture append or extra messages',()=>{
 let s=session('openai');e.openDocument(s,'OBJ-POLITICA');
 const turns=[['A peça está sem prazo confirmado.',{explainsUnknownEta:true},'Entendi, mas preciso falar com minha família.'],['Tem documento e consegue devolver o aparelho provisório no prazo?',{offerLoan:true,askIdentity:true,askReturn:true},'Tenho meu documento e consigo devolver no dia 27.'],['Confirmo o empréstimo provisório nas condições combinadas.',{offerLoan:true,confirmLoan:true},'Obrigado. Vou usar o aparelho provisório na viagem.']];
 for(const [text,intent,reply] of turns){s=modelTurn(s,text,intent,reply);assert.equal(s.messages.filter(m=>m.role==='npc').at(-1).text,reply);}
 assert.equal(s.messages.length,7);e.finishAssessment(s,e.fixtureAssessment(s));assert.equal(s.messages.length,8);assert.equal(s.messages.filter(m=>m.role==='npc').length,4);assert.equal(s.messages.filter(m=>m.role==='user').length,3);assert.equal(s.ending.id,'END-01');
});
await check('QA-D05','Invented literal evidence cannot authorize a real-mode intent',()=>{
 const s=session('openai'),intent=flags({confirmLoan:true});assert.throws(()=>e.applyTurn(s,'Ainda preciso avaliar.',{intent,evidence:{confirmLoan:'Confirmo o empréstimo'},reply:'Entendi.'}),err=>err.status===503);
});
await check('QA-D06','23 October to 27 October requires four days; three-day loan cannot be agreed',()=>{
 const s=e.baseScenario();const elapsed=(Date.UTC(2026,9,27)-Date.UTC(2026,9,23))/86400000;assert.equal(s.rules.clientReturnDays,elapsed);s.rules.loanDays=3;e.projectRules(s);assert.ok(!s.graph.availableEndingIds.includes('END-01'));
});
await check('QA-D07','Unavailable loan removes only END-01 and preserves unknown repair ETA',()=>{
 const s=e.baseScenario();s.rules.loanAvailable=false;e.projectRules(s);assert.deepEqual(s.graph.availableEndingIds,['END-02','END-03']);assert.equal(s.rules.repairEta,null);
});
await check('QA-D08','Fourth participant reply is rejected and prior state remains immutable',()=>{
 let s=session();for(const t of ['Não sei ainda.','Preciso entender melhor.','Ainda não posso combinar.'])s=fixtureTurn(s,t);const saved=JSON.stringify(s);assert.throws(()=>fixtureTurn(s,'Mais uma resposta.'),err=>err.status===409);assert.equal(JSON.stringify(s),saved);assert.equal(s.messages.filter(m=>m.role==='user').length,3);
});
await check('QA-D09','A session freezes its scenario independently of later draft edits',()=>{
 const scenario=e.baseScenario(),s=e.newSession(scenario,'fixture');scenario.rules.loanAvailable=false;scenario.title='Outro contexto';assert.equal(s.scenario.rules.loanAvailable,true);assert.notEqual(s.scenario.title,scenario.title);
});
await check('QA-D10','Assessment rejects nonexistent quotation and duplicate criteria',()=>{
 let s=session();s=fixtureTurn(s,'Entendo a urgência, mas a peça não tem prazo confirmado.');const assessment=e.fixtureAssessment(s);assessment.criteria[0].quote='Uma fala que nunca foi dita';assert.throws(()=>e.validateAssessment(s,assessment),err=>err.code==='INVALID_CITATION');const dup=e.fixtureAssessment(s);dup.criteria[1]=structuredClone(dup.criteria[0]);assert.throws(()=>e.validateAssessment(s,dup),err=>err.status===503);
});
await check('QA-D11','Canonical three endings and assessments use at most eight messages',()=>{
 for(const a of e.fixture.attempts){let s=session();e.openDocument(s,'OBJ-ORDEM');e.openDocument(s,'OBJ-POLITICA');for(const m of a.messages.filter(m=>m.role==='user'))s=fixtureTurn(s,m.text);assert.equal(s.ending?.id,a.ending,a.id);e.finishAssessment(s,e.fixtureAssessment(s));assert.ok(s.messages.length<=8);assert.equal(s.evaluation.criteria.length,3);}
});
await check('QA-D12','Semantically identical JSON payloads hash identically regardless of key order',()=>{
 assert.equal(hash({operation:'pause',body:{commandId:'qa-command',expectedRevision:0}}),hash({body:{expectedRevision:0,commandId:'qa-command'},operation:'pause'}));
});
await check('QA-D13','SQLite reread preserves the session and rejects a second guest',()=>{
 const path=resolve(evidenceDir,`domain-${stamp}.sqlite`);let store=openStore(path);let owner,other,id;
 try{owner=store.identity().owner;other=store.identity().owner;const s=session();id=s.id;store.transaction(()=>store.insertSession(owner,s));assert.throws(()=>store.getSession(id,other),err=>err.status===404);store.close();store=openStore(path);assert.equal(store.getSession(id,owner).scenarioId,s.scenarioId);assert.equal(store.getSession(id,owner).messages[0].text,s.messages[0].text);}finally{store.close();}
});
await check('QA-D14','An idempotent receipt preserves effect and rejects a different payload',()=>{
 const store=openStore(':memory:');try{const owner=store.identity().owner,s=session();store.transaction(()=>store.insertSession(owner,s));const body={commandId:'pause-qa',expectedRevision:0};const receipt=store.receipt(s,body,'pause');const after=structuredClone(s);after.status='paused';const first=store.commit(owner,s,after,body,receipt.payloadHash,'pause');const current=store.getSession(s.id,owner);assert.deepEqual(store.receipt(current,body,'pause').result,first);assert.throws(()=>store.receipt(current,{...body,expectedRevision:1},'pause'),err=>err.code==='IDEMPOTENCY_CONFLICT');assert.equal(current.revision,1);}finally{store.close();}
});

const after=snapshot();const report={runId:'FRONTLINE-CHATS-V3-20261023',ownershipEpoch:5,startedAt:stamp,completedAt:new Date().toISOString(),mode:'offline_synthetic_no_network',node:process.version,readSetBefore:before,readSetAfter:after,snapshotStable:JSON.stringify(before)===JSON.stringify(after),results,passed:results.filter(r=>r.status==='pass').length,failed:results.filter(r=>r.status==='fail').length,limits:['Not a real OpenAI response; manually injected intents test the server guard.','SQLite reread is a handle close/reopen, not an operating-system process restart.','No UI, visual, HTTP or external integration acceptance.']};
const path=resolve(evidenceDir,`domain-${stamp}.json`);writeFileSync(path,JSON.stringify(report,null,2));console.log(JSON.stringify({artifact:path,passed:report.passed,failed:report.failed,snapshotStable:report.snapshotStable,failures:results.filter(r=>r.status==='fail')},null,2));process.exitCode=report.failed||!report.snapshotStable?1:0;
