import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvider, createRequestBudget } from '../server/provider.mjs';
import { createDraftToolExecutor } from '../server/drafts.mjs';
import { baseScenario, newSession, openDocument, applyTurn, finishAssessment, intentKeys } from '../server/engine.mjs';

// Synthetic transport, real provider and domain tool. No credentials or network.
const context = '  Roberto precisa de mapas e contato com a família durante a viagem.\nO aparelho está em assistência.  ';
const policy = 'Há um provisório disponível. Devolução em até sete dias.';
const proposal = () => ({ title: 'Mapas durante a viagem', summary: 'Roberto precisa se orientar durante a viagem, mas o reparo não tem prazo.', need: 'Mapas e contato com a família', opening: 'Como vou usar mapas e falar com minha família sem o aparelho?', unknowns: ['Data da peça e do reparo'], clientBrief: { objective: 'Usar mapas e falar com a família', traits: ['Prefere explicações diretas'], initialState: 'Chega preocupado com a viagem.' }, compatibility: { supported: true, reason: 'Atendimento de assistência do catálogo.', sourceQuote: '' }, contextualFacts: [{ id: 'CTX-1', text: 'Roberto precisa de mapas e contato.', status: 'provided', sourceQuote: 'Roberto precisa de mapas e contato com a família' }], rules: { loanAvailable: true, loanDays: 7 }, ruleEvidence: { loanAvailable: 'Há um provisório disponível.', loanDays: 'Devolução em até sete dias.' } });
const messageOutput = value => [{ type: 'message', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(value) }] }];
const jsonResponse = output => new Response(JSON.stringify({ status: 'completed', output, usage: { input_tokens: 200, output_tokens: 300, total_tokens: 500 } }));
const call = (value = proposal(), operation = 'create') => ({ type: 'function_call', name: 'compose_exercise', call_id: 'synthetic-call', arguments: JSON.stringify({ operation, proposal: value }) });
function authorProvider({ planned = call(), review = { authorMessage: 'Exercício preparado para revisão; o reparo segue sem prazo confirmado.' }, budget = createRequestBudget() } = {}) {
  const requests = [];
  const provider = createProvider({ apiKey: 'synthetic-key', model: 'synthetic-model', budget, fetchImpl: async (_, request) => {
    const body = JSON.parse(request.body); requests.push(body);
    return jsonResponse(body.tool_choice === 'required' ? (Array.isArray(planned) ? planned : [planned]) : messageOutput(review));
  } });
  return { provider, requests };
}
async function compose(provider, currentDraft = null, revisionText = '') {
  const executor = createDraftToolExecutor({ text: context, policyText: policy, currentDraft, revisionText });
  const output = await provider.draft(context, policy, { currentDraft, revisionText, executeTool: executor.executeTool });
  return executor.finish(output);
}

test('author executes the real composer and returns its authoritative candidate in two requests', async () => {
  const { provider, requests } = authorProvider();
  const candidate = await compose(provider);
  assert.equal(candidate.state, 'draft'); assert.equal(candidate.version, 1);
  assert.equal(candidate.rawContext, context); assert.equal(candidate.rawPolicyText, policy);
  assert.equal(candidate.contextNeed, proposal().need); assert.equal(candidate.rules.loanAvailable, true);
  assert.deepEqual(candidate.clientBrief, proposal().clientBrief);
  assert.deepEqual(candidate.graph.availableEndingIds, ['END-01', 'END-02', 'END-03']);
  assert.equal(candidate.authorTool.name, 'compose_exercise'); assert.equal(candidate.authorTool.status, 'validated');
  assert.equal(requests.length, 2); assert.equal(requests[1].tool_choice, 'none');
  const result = requests[1].input.find(item => item.type === 'function_call_output');
  assert.equal(result.call_id, 'synthetic-call');
  const returned = JSON.parse(result.output);
  assert.equal(returned.candidate.id, candidate.id); assert.equal(returned.validation.valid, true);
  assert.equal(provider.getBudget().usedRequests, 2); assert.equal(provider.getBudget().reservedOutputTokens, 2600);
});

test('two natural-language revisions preserve original text and prior revision sources', async () => {
  const budget = createRequestBudget();
  const first = await compose(authorProvider({ budget }).provider);
  const revisionText = 'Agora não há provisório disponível. Reduza a devolução para três dias.';
  const revised = proposal(); revised.rules = { loanAvailable: false, loanDays: 3 };
  revised.ruleEvidence = { loanAvailable: 'não há provisório disponível', loanDays: 'Reduza a devolução para três dias.' };
  const second = await compose(authorProvider({ budget, planned: call(revised, 'revise') }).provider, first, revisionText);
  assert.equal(second.id, first.id); assert.equal(second.version, 2);
  assert.equal(first.version, 1); assert.equal(first.rules.loanAvailable, true);
  assert.equal(second.rules.loanAvailable, false); assert.equal(second.rules.loanDays, 3);
  assert.ok(!second.graph.availableEndingIds.includes('END-01'));
  const thirdProposal = structuredClone(revised); thirdProposal.title = 'Orientação e contato';
  const thirdRun = authorProvider({ budget, planned: call(thirdProposal, 'revise') });
  const third = await compose(thirdRun.provider, second, 'Altere apenas o título para Orientação e contato.');
  assert.equal(third.version, 3); assert.equal(third.rawContext, context); assert.equal(third.rawPolicyText, policy);
  assert.equal(third.rules.loanDays, 3); assert.equal(third.revisionHistory.length, 2);
  assert.equal(third.revisionHistory[0].requestText, revisionText);
  assert.deepEqual(JSON.parse(thirdRun.requests[0].input[0].content[0].text).currentDraft, second);
  assert.equal(budget.snapshot().usedRequests, 6); assert.equal(budget.snapshot().reservedOutputTokens, 7800);
});

for (const [name, planned, code] of [
  ['missing call', messageOutput({ authorMessage: 'Pretend composition' }), 'INVALID_TOOL_CALL'],
  ['multiple calls', [call(), call()], 'INVALID_TOOL_CALL'],
  ['unknown tool', { ...call(), name: 'publish_exercise' }, 'INVALID_TOOL_CALL'],
  ['wrong operation', call(proposal(), 'revise'), 'INVALID_TOOL_OPERATION'],
  ['missing call id', { ...call(), call_id: '' }, 'INVALID_TOOL_CALL'],
  ['incomplete call', { ...call(), status: 'in_progress' }, 'INVALID_TOOL_CALL'],
  ['broken arguments', { ...call(), arguments: '{broken' }, 'INVALID_TOOL_CALL'],
  ['model-supplied identity', { ...call(), arguments: JSON.stringify({ operation: 'create', proposal: proposal(), ownerId: 'other' }) }, 'INVALID_MODEL_OUTPUT']
]) test(`author rejects ${name} before domain effects or a second request`, async () => {
  const { provider, requests } = authorProvider({ planned }); let effects = 0;
  await assert.rejects(provider.draft(context, policy, { executeTool: async () => { effects++; } }), { code });
  assert.equal(effects, 0); assert.equal(requests.length, 1);
});

test('failure after tool execution does not mutate prior draft or accept model candidate changes', async () => {
  const prior = await compose(authorProvider().provider), before = structuredClone(prior);
  const { provider, requests } = authorProvider({ planned: call(proposal(), 'revise'), review: { authorMessage: 'Publicado', candidate: { state: 'published' } } });
  await assert.rejects(compose(provider, prior, 'Preserve a necessidade e revise o título.'), { code: 'INVALID_MODEL_OUTPUT' });
  assert.deepEqual(prior, before); assert.equal(requests.length, 2);
});

test('author does not start without a tool executor or two reserved request slots', async () => {
  const { provider, requests } = authorProvider({ budget: createRequestBudget({ usedRequests: 5, reservedOutputTokens: 6500 }) });
  await assert.rejects(provider.draft(context, policy), { code: 'MODEL_TOOL_NOT_CONFIGURED' });
  await assert.rejects(compose(provider), { code: 'MODEL_BUDGET_EXCEEDED' });
  assert.equal(requests.length, 0); assert.equal(provider.getBudget().usedRequests, 5);
});

test('invalid tool result and internal errors cannot be passed to the model as success', async () => {
  for (const [executeTool, code] of [
    [async () => ({ candidate: {}, validation: { valid: false } }), 'INVALID_TOOL_RESULT'],
    [async () => { throw Error('sensitive-internal-error'); }, 'MODEL_TOOL_FAILED']
  ]) {
    const { provider, requests } = authorProvider();
    await assert.rejects(provider.draft(context, policy, { executeTool }), error => { assert.equal(error.code, code); assert.ok(!error.message.includes('sensitive')); return true; });
    assert.equal(requests.length, 1);
  }
});

test('reasoning items accompany the function result without entering telemetry', async () => {
  const reasoning = { type: 'reasoning', id: 'rs_synthetic', encrypted_content: 'synthetic-opaque-content', summary: [] };
  const { provider, requests } = authorProvider({ planned: [reasoning, call()] });
  await compose(provider);
  assert.ok(requests[1].input.some(item => item.type === 'reasoning' && item.encrypted_content === reasoning.encrypted_content));
  assert.ok(!JSON.stringify(provider.getTelemetry()).includes('synthetic-opaque-content'));
});

test('unsupported domain reaches the real tool gate without candidate or a second request', async () => {
  const unsupportedText = 'Quero simular a triagem de um paciente no hospital.';
  const value = proposal();
  value.compatibility = { supported: false, reason: 'O catálogo atual cobre assistência de aparelhos, não atendimento hospitalar.', sourceQuote: 'triagem de um paciente no hospital' };
  value.title = value.summary = value.need = value.opening = '';
  value.unknowns = []; value.contextualFacts = [];
  value.rules = { loanAvailable: null, loanDays: null }; value.ruleEvidence = { loanAvailable: '', loanDays: '' };
  value.clientBrief = { objective: '', traits: [], initialState: '' };
  const { provider, requests } = authorProvider({ planned: call(value) });
  const executor = createDraftToolExecutor({ text: unsupportedText });
  await assert.rejects(provider.draft(unsupportedText, '', { executeTool: executor.executeTool }), error => { assert.equal(error.status, 422); assert.equal(error.code, 'UNSUPPORTED_CONTEXT'); return true; });
  assert.equal(requests.length, 1);
  assert.throws(() => executor.finish({}), { code: 'INVALID_AUTHOR_RESULT' });
});

test('unsupported revision preserves the last supported candidate and original input', async () => {
  const prior = await compose(authorProvider().provider), before = structuredClone(prior);
  const revisionText = 'Troque para uma entrevista de seleção de funcionários.';
  const value = proposal(); value.compatibility = { supported: false, reason: 'Seleção de funcionários não está no catálogo assistência.', sourceQuote: 'entrevista de seleção de funcionários' };
  const { provider, requests } = authorProvider({ planned: call(value, 'revise') });
  await assert.rejects(compose(provider, prior, revisionText), { code: 'UNSUPPORTED_CONTEXT' });
  assert.deepEqual(prior, before); assert.equal(requests.length, 1);
});

for (const available of [true, false]) test(`provider and engine preserve contextual reply and enforce inventory=${available}`, async () => {
  let current = newSession(baseScenario(), 'openai'); current.scenario.rules.loanAvailable = available;
  openDocument(current, 'OBJ-ORDEM'); openDocument(current, 'OBJ-POLITICA');
  const speeches = [
    ['Entendo que precisa dos mapas e contato com a família. O reparo ainda não tem prazo confirmado.', ['acknowledgesNeed', 'explainsUnknownEta']],
    ['Posso oferecer um provisório. Você trouxe documento e pode devolver no dia 27?', ['offerLoan', 'askIdentity', 'askReturn']],
    ['Pode seguir com a cessão temporária nos termos que acabamos de acertar.', ['confirmLoan']]
  ];
  let stage = 0;
  const provider = createProvider({ apiKey: 'synthetic-key', model: 'synthetic-model', budget: createRequestBudget(), fetchImpl: async (_, request) => {
    const body = JSON.parse(request.body), data = JSON.parse(body.input[0].content[0].text);
    if (stage < 3) {
      const [speech, selected] = speeches[stage++]; assert.equal(data.lastUserText, speech);
      assert.deepEqual(data.history, current.messages);
      return jsonResponse(messageOutput({ intent: Object.fromEntries(intentKeys.map(key => [key, selected.includes(key)])), evidence: Object.fromEntries(intentKeys.map(key => [key, selected.includes(key) ? speech : ''])), reply: available ? 'Os mapas e o contato fazem diferença na minha viagem.' : 'Sem provisório, preciso saber qual atualização posso esperar.' }));
    }
    const user = current.messages.find(message => message.role === 'user');
    return jsonResponse(messageOutput({ criteria: current.scenario.rubric.criteria.map(criterion => ({ criterionId: criterion.id, name: criterion.name, rating: 'parcialmente observado', quote: user.text, messageId: user.id, reason: 'Evidência sintética para testar o vínculo literal da avaliação.' })), opportunity: 'Confira as condições antes de combinar o próximo passo.' }));
  } });
  for (const [speech] of speeches) current = applyTurn(current, speech, await provider.turn(current, speech));
  assert.equal(current.status, available ? 'completed' : 'incomplete');
  assert.equal(current.ending?.id ?? null, available ? 'END-01' : null);
  assert.ok(current.messages.some(message => message.role === 'npc' && message.text.includes(available ? 'Os mapas e o contato' : 'Sem provisório')));
  const finished = finishAssessment(current, await provider.assess(current));
  assert.equal(finished.messages.length, 8); assert.equal(finished.evaluation.criteria.length, 3);
  for (const criterion of finished.evaluation.criteria) assert.ok(finished.messages.find(message => message.role === 'user' && message.id === criterion.messageId)?.text.includes(criterion.quote));
  assert.equal(provider.getBudget().usedRequests, 4);
});
