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
