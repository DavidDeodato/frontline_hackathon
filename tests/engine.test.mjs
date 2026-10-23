import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../server/engine.mjs';

// Deterministic, synthetic scenarios: no provider calls or external services.
function completeAttempt(attempt) {
  let session = engine.newSession(engine.baseScenario(), 'fixture');
  engine.openDocument(session, 'OBJ-ORDEM');
  engine.openDocument(session, 'OBJ-POLITICA');
  for (const message of attempt.messages.filter(message => message.role === 'user')) {
    session = engine.applyTurn(session, message.text, {
      intent: engine.fixtureIntent(session, message.text),
    });
  }
  return session;
}

for (const attempt of engine.fixture.attempts) {
  test(`${attempt.id}: reaches the declared narrative ending`, () => {
    assert.equal(completeAttempt(attempt).ending?.id, attempt.ending);
  });

  test(`${attempt.id}: assessment stays within eight visible messages`, () => {
    const session = completeAttempt(attempt);
    engine.finishAssessment(session, engine.fixtureAssessment(session));
    assert.ok(session.messages.length <= 8);
  });

  test(`${attempt.id}: evaluation quotes match the stored practitioner message`, () => {
    const session = completeAttempt(attempt);
    engine.finishAssessment(session, engine.fixtureAssessment(session));
    assert.equal(session.evaluation.criteria.length, 3);
    for (const criterion of session.evaluation.criteria) {
      if (!criterion.quote) continue;
      const source = session.messages.find(message => message.role === 'user' && message.id === criterion.messageId);
      assert.ok(source, `Missing source message for ${criterion.criterionId}`);
      assert.ok(source.text.includes(criterion.quote), `Nonliteral quotation for ${criterion.criterionId}`);
    }
  });
}

test('reopening a document does not inflate preparation', () => {
  const session = engine.newSession(engine.baseScenario(), 'fixture');
  engine.openDocument(session, 'OBJ-ORDEM');
  engine.openDocument(session, 'OBJ-ORDEM');
  assert.equal(session.attributes.preparo, 1);
});

test('an assessment without practitioner evidence does not require fabricated quotations', () => {
  const session = engine.newSession(engine.baseScenario(), 'fixture');
  const assessment = {
    criteria: session.scenario.rubric.criteria.map(criterion => ({
      criterionId: criterion.id, name: criterion.name,
      rating: 'sem evidência suficiente', quote: '', messageId: '',
      reason: 'Nenhuma fala da participante foi enviada.',
    })),
    opportunity: 'Pratique a primeira resposta.',
  };
  assert.doesNotThrow(() => engine.validateAssessment(session, assessment));
});

test('fixture negation preserves a concrete update without promising repair', () => {
  const text = 'Vou verificar o estoque e te atualizar hoje às 17h, sem garantir o reparo.';
  let session = engine.newSession(engine.baseScenario(), 'fixture');
  for (const opening of ['Entendo a urgência da viagem.', 'O prazo ainda não foi confirmado.']) {
    session = engine.applyTurn(session, opening, {intent:engine.fixtureIntent(session, opening)});
  }
  const intent = engine.fixtureIntent(session, text);
  assert.equal(intent.explainsUnknownEta, true);
  assert.equal(intent.unsupportedPromise, false);
  assert.equal(intent.nextStep, true);
  session = engine.applyTurn(session, text, {intent});
  assert.equal(session.ending.id, 'END-02');
  assert.equal(session.commitment.status, 'valid');
  assert.equal(session.messages.find(m => m.role === 'user' && m.text === text)?.text, text);
  engine.finishAssessment(session, engine.fixtureAssessment(session));
  assert.equal(session.messages.length, 8);
});

test('fixture guarantee negation does not conceal an affirmative repair promise in a separate clause', () => {
  const session = engine.newSession(engine.baseScenario(), 'fixture');
  for (const text of ['Vou te atualizar hoje, sem garantir o reparo.', 'Vou te atualizar hoje, sem garantia de reparo.', 'Não posso garantir o reparo. Vou te atualizar hoje.']) {
    assert.equal(engine.fixtureIntent(session, text).unsupportedPromise, false, text);
  }
  for (const text of ['Garanto o reparo amanhã.', 'Sem garantir o estoque. Garanto o reparo amanhã.', 'Sem garantir o estoque, mas garanto o reparo amanhã.']) {
    assert.equal(engine.fixtureIntent(session, text).unsupportedPromise, true, text);
  }
});

function structuredTurn(session, text, selected, reply) {
  const intent = Object.fromEntries(engine.intentKeys.map(key => [key, selected.includes(key)]));
  const evidence = Object.fromEntries(engine.intentKeys.map(key => [key, intent[key] ? text : '']));
  return engine.applyTurn(session, text, {intent,evidence,reply});
}

test('OpenAI character reply is shown once while the proposed commitment remains a separate domain result', () => {
  const before = engine.newSession(engine.baseScenario(), 'openai');
  const text = 'Um aparelho provisório ajudaria na videochamada com sua avó?';
  const reply = 'Sim, eu conseguiria conversar com minha avó durante a viagem. Quais são as condições do provisório?';
  const session = structuredTurn(before,text,['offerLoan'],reply);
  assert.equal(session.messages.at(-1).text,reply);
  assert.equal(session.messages.at(-1).speaker,'Roberto Almeida');
  assert.equal(session.messages.length,3);
  assert.equal(session.commitment.status,'draft');
  assert.equal(session.commitment.sourceMessageId,session.messages[1].id);
  assert.equal(session.ending,null);
  assert.equal(before.messages.length,1);
});

test('OpenAI transcript keeps one reply per turn through ending and assessment without relaxing loan guards', () => {
  let session = engine.newSession(engine.baseScenario(), 'openai');
  engine.openDocument(session,'OBJ-POLITICA');
  const replies = ['Estou com meu documento e posso devolver no dia 27. O provisório ajudaria na viagem.', 'Combinado. Vou usar o provisório durante a viagem e devolver no dia 27.', 'Obrigado. Ficou claro como vou manter contato até o reparo ter uma previsão.'];
  session = structuredTurn(session,'Confirmo o empréstimo provisório; está com documento e consegue devolver dia 27?',['offerLoan','confirmLoan','askIdentity','askReturn'],replies[0]);
  assert.equal(session.commitment.status,'draft');
  assert.equal(session.attributes.autonomia,2);
  session = structuredTurn(session,'Com as condições confirmadas, combinamos o empréstimo do provisório.',['offerLoan','confirmLoan'],replies[1]);
  assert.equal(session.commitment.status,'valid');
  session = structuredTurn(session,'O reparo ainda não tem prazo confirmado.',['explainsUnknownEta'],replies[2]);
  assert.equal(session.ending.id,'END-01');
  assert.deepEqual(session.messages.filter(m=>m.role==='npc').slice(1).map(m=>m.text),replies);
  assert.equal(session.messages.length,7);
  engine.finishAssessment(session,engine.fixtureAssessment(session));
  assert.equal(session.messages.length,8);
  assert.equal(session.messages.filter(m=>m.role==='summary').length,1);
});

test('separating OpenAI prose does not authorize unavailable inventory or invent repair evidence', () => {
  const scenario=engine.baseScenario();scenario.rules.loanAvailable=false;engine.projectRules(scenario);
  let session=engine.newSession(scenario,'openai');engine.openDocument(session,'OBJ-POLITICA');
  session=structuredTurn(session,'Você tem documento e pode devolver em sete dias?',['askIdentity','askReturn'],'Tenho meu documento e posso devolver no dia 27.');
  const reply='Sem um aparelho disponível, preciso combinar uma atualização sobre o reparo.';
  session=structuredTurn(session,'Confirmo o empréstimo do provisório.',['offerLoan','confirmLoan'],reply);
  assert.equal(session.messages.at(-1).text,reply);
  assert.equal(session._state.loanAgreed,false);
  assert.notEqual(session.commitment.status,'valid');
  assert.equal(session.scenario.rules.loanAvailable,false);
  assert.equal(session.scenario.rules.repairEta,null);
});
