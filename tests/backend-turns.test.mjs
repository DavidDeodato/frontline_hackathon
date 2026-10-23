import test from 'node:test';
import assert from 'node:assert/strict';
import {baseScenario,newSession,openDocument,intentKeys,finishAssessment,fixtureAssessment} from '../server/engine.mjs';
import {createTurnToolExecutor} from '../server/turns.mjs';

const args=(text,selected=[])=>({intent:Object.fromEntries(intentKeys.map(k=>[k,selected.includes(k)])),evidence:Object.fromEntries(intentKeys.map(k=>[k,selected.includes(k)?text:'']))});
const result=(input,reply)=>({...structuredClone(input),reply,turnTool:{name:'apply_training_turn',status:'validated'}});

test('projection has one pending user message, no NPC placeholder, and returned copies cannot mutate the candidate',async()=>{
  const before=newSession(baseScenario(),'openai');openDocument(before,'OBJ-POLITICA');
  const original=structuredClone(before),text='Está com seu documento e consegue devolver no dia27?',input=args(text,['askIdentity','askReturn']);
  const tool=createTurnToolExecutor(before,text),projected=await tool.executeTurn('apply_training_turn',input);
  assert.deepEqual(before,original);assert.equal(projected.candidate.messages.length,2);assert.equal(projected.candidate.messages.at(-1).role,'user');
  assert.equal(projected.candidate.revision,before.revision);assert.equal(projected.candidate._state,undefined);
  assert.equal(projected.responseContext.confirmedState.identity,true);assert.equal(projected.responseContext.allowedFacts.confirmReturn,true);assert.equal(projected.responseContext.allowedFacts.acceptLoan,false);
  const userId=projected.candidate.messages.at(-1).id;
  projected.candidate.messages.at(-1).text='forged';projected.responseContext.allowedFacts.acceptLoan=true;input.intent.confirmLoan=true;
  const after=tool.finish(result(args(text,['askIdentity','askReturn']),'Estou com meu documento e devolvo no dia27.'));
  assert.equal(after.messages.length,3);assert.equal(after.messages[1].id,userId);assert.equal(after.messages[1].text,text);assert.equal(after._state.loanAgreed,false);
  assert.throws(()=>tool.finish(result(args(text,['askIdentity','askReturn']),'Outra fala.')),e=>e.code==='TURN_ALREADY_FINALIZED');
});

test('unknown tools, repeated calls, invented evidence and altered echoes fail without changing prior state',async()=>{
  const before=newSession(baseScenario(),'openai'),snapshot=structuredClone(before),text='Um provisório ajudaria?',input=args(text,['offerLoan']);
  await assert.rejects(createTurnToolExecutor(before,text).executeTurn('wrong_tool',input),e=>e.code==='INVALID_TURN_TOOL');
  const bad=args(text,['offerLoan']);bad.evidence.offerLoan='texto inexistente';
  await assert.rejects(createTurnToolExecutor(before,text).executeTurn('apply_training_turn',bad),e=>e.code==='INVALID_INTENT_EVIDENCE');
  const unselected=args(text);unselected.evidence.offerLoan=text;
  await assert.rejects(createTurnToolExecutor(before,text).executeTurn('apply_training_turn',unselected),e=>e.code==='INVALID_INTENT_EVIDENCE');
  const tool=createTurnToolExecutor(before,text);await tool.executeTurn('apply_training_turn',input);
  await assert.rejects(tool.executeTurn('apply_training_turn',input),e=>e.code==='TURN_TOOL_REPEATED');
  const changed=result(input,'Sim, ajudaria.');changed.intent.confirmLoan=true;
  assert.throws(()=>tool.finish(changed),e=>e.code==='INVALID_TURN_RESULT');
  assert.throws(()=>tool.finish(result(input,' ')),e=>e.code==='INVALID_MODEL_OUTPUT');
  assert.throws(()=>createTurnToolExecutor(before,text).finish(result(input,'Sim.')),e=>e.code==='INVALID_TURN_RESULT');
  assert.deepEqual(before,snapshot);
});

test('projected agreement respects prior-turn conditions and narration adds exactly one message through the third turn',async()=>{
  let session=newSession(baseScenario(),'openai');openDocument(session,'OBJ-POLITICA');
  const steps=[
    ['Confirmo o provisório: tem documento e devolve no dia27?',['offerLoan','confirmLoan','askIdentity','askReturn'],'Tenho o documento e posso devolver no dia27.'],
    ['Combinado, vamos emprestar o provisório.',['offerLoan','confirmLoan'],'Combinado, vou devolver no dia27.'],
    ['O prazo do reparo continua desconhecido.',['explainsUnknownEta'],'Entendi. O provisório atende a viagem enquanto aguardo.']
  ];
  for(const [index,[text,selected,reply]] of steps.entries()){
    const tool=createTurnToolExecutor(session,text),input=args(text,selected),projected=await tool.executeTurn('apply_training_turn',input);
    assert.equal(projected.candidate.messages.length,2+index*2);
    assert.equal(projected.responseContext.allowedFacts.acceptLoan,index>0);
    if(index===0)assert.ok(projected.responseContext.deniedTransitions[0].reasons.includes('conditions_not_confirmed_in_previous_turn'));
    session=tool.finish(result(input,reply));assert.equal(session.messages.at(-1).text,reply);
  }
  assert.equal(session.ending.id,'END-01');assert.equal(session.messages.length,7);
  finishAssessment(session,fixtureAssessment(session));assert.equal(session.messages.length,8);
});

test('failed real-round flags stay unchanged and round two receives denied loan rather than a forced END01',async()=>{
  // Synthetic case recorded in full-regression-2026-10-23T17-31-40-507Z.
  // Flags below preserve its mistaken interpretation. Narration is an OFFLINE
  // test double based on the tool result, not a newly observed model response.
  let session=newSession(baseScenario(),'openai');openDocument(session,'OBJ-ORDEM');openDocument(session,'OBJ-POLITICA');
  const steps=[
    ['Entendo que a videochamada com sua avó durante a viagem é importante. A peça não tem prazo confirmado. Um aparelho provisório para essa conversa ajudaria?',['acknowledgesNeed','explainsUnknownEta']],
    ['Temos um provisório disponível, sem cobrança. Você está com seu documento e consegue devolver no dia 27 de outubro, dentro dos sete dias da política?',['acknowledgesNeed']],
    ['Combinado: vamos emprestar o aparelho provisório com devolução em 27 de outubro e documento confirmado. O prazo do reparo continua sem confirmação; aviso quando houver atualização.',['acknowledgesNeed','explainsUnknownEta','confirmLoan','nextStep']]
  ];
  for(const [text,selected] of steps){
    const input=args(text,selected),tool=createTurnToolExecutor(session,text),projection=await tool.executeTurn('apply_training_turn',input);
    assert.equal(projection.responseContext.confirmedState.identity,false);assert.equal(projection.responseContext.confirmedState.returnConfirmed,false);assert.equal(projection.responseContext.allowedFacts.acceptLoan,false);
    const reply=projection.responseContext.allowedFacts.acceptUpdate?'Vou aguardar sua atualização; o empréstimo não ficou combinado.':'Ainda preciso combinar uma alternativa para a viagem.';
    session=tool.finish(result(input,reply));
  }
  assert.equal(session.ending.id,'END-02');assert.equal(session._state.loanAgreed,false);assert.equal(session.messages.length,7);
});
