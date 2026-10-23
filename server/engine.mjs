import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export const fixture = JSON.parse(readFileSync(new URL('../shared/scene.json', import.meta.url), 'utf8'));
export const clone = value => structuredClone(value);
export class AppError extends Error {
  constructor(status, code, message, session) { super(message); Object.assign(this, { status, code, session }); }
}
export const fail = (status, code, message, session) => { throw new AppError(status, code, message, session); };
export const now = () => new Date().toISOString();
export function baseScenario() {
  return projectRules({ ...clone(fixture.scenario), label: fixture.label, facts: clone(fixture.facts), policy: clone(fixture.policy), rubric: clone(fixture.rubric), render: clone(fixture.render), graph: clone(fixture.graph), rules: { loanAvailable: true, loanDays: 7, clientReturnDays: 4, clientHasIdentity: true, repairEta: null } });
}
export function projectRules(s) {
  const r = s.rules;
  if (!r || typeof r.loanAvailable !== 'boolean' || !Number.isInteger(r.loanDays) || r.loanDays < 1 || r.loanDays > 7 || r.clientReturnDays !== 4 || r.clientHasIdentity !== true || r.repairEta !== null) fail(422, 'INVALID_RULES', 'Escolha disponibilidade e devolução entre um e sete dias; o prazo do reparo continua desconhecido.');
  const availability = r.loanAvailable ? 'Um aparelho provisório disponível.' : 'Não há aparelho provisório disponível neste exercício.';
  const due = `Documento de identificação obrigatório; devolução em até ${r.loanDays} dias.`;
  s.policy.terms = [availability, 'Empréstimo sem cobrança neste exercício.', due, 'Acordo somente após consultar a política, confirmar identidade e prazo de devolução.', 'Não é permitido garantir reparo sem confirmação da chegada da peça.'];
  s.policy.unknowns = ['Data de chegada da peça', 'Data de conclusão do reparo'];
  s.time.loanDue = `2026-10-${23 + r.loanDays}`;
  for (const f of s.facts) { if (f.id === 'F-02') f.text = 'Roberto viaja em 24 de outubro às 18h e retorna em 27 de outubro.'; if (f.id === 'F-03') f.text = availability; if (f.id === 'F-04') f.text = due; if (f.id === 'F-05') f.text = 'Roberto pode apresentar documento e devolver em 27 de outubro, quatro dias após o início do exercício.'; }
  const object = s.render.objects.find(o => o.id === 'OBJ-POLITICA');
  if (object) object.content = `${availability} ${due}`;
  s.graph.availableEndingIds = r.loanAvailable && r.loanDays >= r.clientReturnDays && r.clientHasIdentity ? ['END-01', 'END-02', 'END-03'] : ['END-02', 'END-03'];
  return s;
}
export function validateScenario(s) {
  if (!s || typeof s.title !== 'string' || !s.title.trim() || !Array.isArray(s.facts) || !s.facts.length) fail(422, 'INVALID_SCENARIO', 'Informe título e fatos do cenário.');
  if (s.npcCount !== 1 || s.sceneCount !== 1 || s.rubric?.criteria?.length !== 3 || s.graph?.endings?.length !== 3 || s.graph?.decisions?.length !== 3 || !['END-01','END-02','END-03'].every(id => s.graph.endings.some(e => e.id === id))) fail(422, 'INVALID_SCENARIO', 'O cenário precisa ter um cliente, três critérios, três decisões e três finais definidos.');
  const ids = new Set();
  for (const c of s.rubric.criteria) { if (!c || typeof c.id !== 'string' || !c.id || typeof c.name !== 'string' || !c.name.trim() || typeof c.observable !== 'string' || !c.observable.trim() || ids.has(c.id)) fail(422, 'INVALID_RUBRIC', 'Critérios precisam de identificadores únicos, nome e comportamento.'); ids.add(c.id); }
  const factIds = new Set();
  for (const f of s.facts) { if (!f || typeof f.id !== 'string' || !f.id || typeof f.text !== 'string' || !f.text.trim() || factIds.has(f.id)) fail(422, 'INVALID_FACTS', 'Cada fato precisa de identificador único e texto.'); factIds.add(f.id); }
  if (!Array.isArray(s.policy?.terms) || !s.policy.terms.length || s.policy.terms.some(t => typeof t !== 'string')) fail(422, 'INVALID_POLICY', 'A política deve possuir regras textuais.');
  return projectRules(s);
}
export function newSession(scenario, mode, parentSessionId) {
  const time = now();
  const s = { id: randomUUID(), revision: 0, status: 'active', scenarioId: scenario.id, scenarioVersion: scenario.version, scenario: clone(scenario), mode, messages: [], attributes: { preparo: 0, autonomia: 0 }, documentsRead: [], commitment: { status: 'none', text: 'Nenhum compromisso assumido' }, ending: null, evaluation: null, createdAt: time, updatedAt: time, _state: { unsupported: false, identity: false, returnConfirmed: false, loanOffered: false, loanAgreed: false, nextStep: false, signals: [] } };
  if (parentSessionId) { s.parentSessionId = parentSessionId; s.branchScope = 'from_opening'; }
  addMessage(s, 'npc', scenario.opening || fixture.attempts[0].messages[0].text);
  return s;
}
export function wireSession(session) { const s = clone(session); delete s._state; return s; }
export function addMessage(session, role, text) {
  const m = { id: randomUUID(), role, speaker: role === 'npc' ? 'Roberto Almeida' : role === 'user' ? 'Mariana Oliveira' : 'Frontline', text, seq: session.messages.length + 1 };
  session.messages.push(m); return m;
}
export function openDocument(s, objectId) {
  if (!s.scenario.render.objects.some(o => o.id === objectId)) fail(422, 'INVALID_OBJECT', 'Documento não pertence a este cenário.');
  if (!s.documentsRead.includes(objectId)) s.documentsRead.push(objectId);
  s.attributes.preparo = ['OBJ-ORDEM', 'OBJ-POLITICA'].filter(id => s.documentsRead.includes(id)).length;
  updateAutonomy(s); return s;
}
function updateAutonomy(s) { s.attributes.autonomia = !s.documentsRead.includes('OBJ-POLITICA') ? 0 : s._state.identity && s._state.returnConfirmed ? 2 : 1; }

// This classifier exists ONLY for explicitly labelled fixture mode and deterministic tests.
export function fixtureIntent(s, text) {
  const t = text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const unknown = /nao.{0,30}(confirm|prazo|garant)|sem.{0,18}(confirm|prazo)|desconhecid|ainda.{0,20}confirm/.test(t);
  const withdrawLoan = /(?:nao|nunca|sem|cancel|retiro|desist)[^.!?;]{0,35}(?:emprest|provisor|reserv|acordo)|(?:emprest|provisor|acordo)[^.!?;]{0,25}(?:cancelad|retirad)/.test(t);
  const withdrawNextStep = /(?:nao|nunca|cancel|retiro)[^.!?;]{0,30}(?:avis|atualiza|contato|acompanh|retorno)/.test(t);
  const loan = /provisor|emprest|alternativ/.test(t) && !withdrawLoan;
  const promise = /garant|pode contar|pronto.{0,15}amanha|entreg.{0,15}amanha/.test(t) && !/nao.{0,25}garant|nao posso|nao podemos|sem garantia|posso garantir\?|sera que/.test(t) && (!loan || /repar|consert|pronto|peca/.test(t));
  return {
    acknowledgesNeed: /entend|urgenc|viag|necess|comunic|ajud/.test(t), explainsUnknownEta: unknown,
    unsupportedPromise: promise, explicitRetraction: unknown && /corrig|retiro|desculp|nao posso garantir|nao podemos garantir/.test(t),
    offerLoan: loan, askIdentity: /document|identidade/.test(t) && !/(?:nao|sem).{0,20}(?:document|identidade)/.test(t), askReturn: /devol|retorn/.test(t) && !/nao.{0,20}(?:devol|retorn)/.test(t),
    confirmLoan: loan && /combinado|confirmo|vamos.{0,12}(emprest|combinar)|vou.{0,10}reserv|fica acordado/.test(t),
    nextStep: !promise && !withdrawNextStep && /(vou|vamos|posso|combinado|combinamos|confirmo).{0,45}(avis|atualiza|contato|retorno)|aviso.{0,50}(quando|amanha)|atualizacao.{0,20}(amanha|10h)/.test(t),
    ambiguous: /\b(?:talvez|hipoteticamente|quem sabe)\b|se (?:eu|nos|voce|pudesse|tivesse)|nao sei se/.test(t), withdrawLoan, withdrawNextStep
  };
}
export const intentKeys = ['acknowledgesNeed', 'explainsUnknownEta', 'unsupportedPromise', 'explicitRetraction', 'offerLoan', 'askIdentity', 'askReturn', 'confirmLoan', 'nextStep', 'ambiguous', 'withdrawLoan', 'withdrawNextStep'];
export function validateIntent(intent) {
  if (!intent || typeof intent !== 'object' || Array.isArray(intent) || intentKeys.some(k => typeof intent[k] !== 'boolean') || Object.keys(intent).some(k => !intentKeys.includes(k))) fail(503, 'INVALID_MODEL_OUTPUT', 'O modelo retornou uma interpretação inválida; sua resposta foi preservada para tentar novamente.');
  return intent;
}
export function applyTurn(session, text, interpretation) {
  const s = clone(session); const state = s._state; const i = { ...validateIntent(interpretation?.intent) };
  if (typeof text !== 'string' || !text.trim() || text.length > 2000) fail(422, 'INVALID_INPUT', 'Resposta deve conter de 1 a 2000 caracteres.');
  if (s.status !== 'active') fail(409, 'SESSION_NOT_ACTIVE', 'Retome uma sessão ativa para responder.', wireSession(s));
  const count = s.messages.filter(m => m.role === 'user').length;
  if (count >= 3) fail(409, 'SESSION_LIMIT_REACHED', 'Esta tentativa já atingiu três respostas.', wireSession(s));
  // Only the fixture provider classifies by keywords. Real mode consumes the full
  // model interpretation, with literal evidence, and applies domain guards here.
  if (s.mode === 'openai') {
    for (const key of intentKeys) if (i[key] && (typeof interpretation.evidence?.[key] !== 'string' || !interpretation.evidence[key].trim() || !text.includes(interpretation.evidence[key]))) fail(503, 'INVALID_INTENT_EVIDENCE', 'A interpretação não citou sua fala literalmente; tente novamente.', wireSession(session));
    if (typeof interpretation.reply !== 'string' || !interpretation.reply.trim() || interpretation.reply.length > 900) fail(503, 'INVALID_MODEL_OUTPUT', 'O personagem não produziu uma resposta válida; tente novamente.', wireSession(session));
  }
  const couldAgreeBeforeReply = state.identity && state.returnConfirmed && s.documentsRead.includes('OBJ-POLITICA') && state.loanOffered;
  const user = addMessage(s, 'user', text); state.signals.push({ messageId: user.id, ...i });
  let npc = 'Pode explicar melhor o próximo passo? Preciso saber com o que posso contar para a viagem.';
  if (!i.ambiguous) {
    if (i.withdrawLoan) { i.offerLoan = false; i.confirmLoan = false; state.loanAgreed = false; state.loanOffered = false; if (!state.unsupported) s.commitment = { status: 'none', text: 'Proposta de empréstimo retirada', sourceMessageId: user.id }; }
    if (i.withdrawNextStep) { i.nextStep = false; state.nextStep = false; if (!state.unsupported && !state.loanAgreed) s.commitment = { status: 'none', text: 'Próximo passo retirado', sourceMessageId: user.id }; }
    if (i.explicitRetraction && !i.unsupportedPromise) state.unsupported = false;
    if (i.unsupportedPromise) { state.unsupported = true; s.commitment = { status: 'unsupported', text: 'Reparo prometido sem prazo confirmado', sourceMessageId: user.id }; }
    if (i.offerLoan) state.loanOffered = true;
    if (i.askIdentity && s.scenario.rules.clientHasIdentity) { state.identity = true; npc = 'Estou com meu documento de identificação.'; }
    if (i.askReturn && s.scenario.rules.clientReturnDays <= s.scenario.rules.loanDays) { state.returnConfirmed = true; npc = 'Posso devolver em 27 de outubro.'; }
    if (i.askIdentity && i.askReturn && state.identity && state.returnConfirmed) npc = 'Estou com meu documento e posso devolver no dia 27.';
    updateAutonomy(s);
    if (i.askReturn && !state.returnConfirmed) npc = `Só consigo devolver em ${s.scenario.rules.clientReturnDays} dias; esse prazo não atende à política de ${s.scenario.rules.loanDays} dias.`;
    if (i.offerLoan && !i.askIdentity && !i.askReturn) npc = s.scenario.rules.loanAvailable ? 'Um aparelho provisório ajudaria, sim. Como funciona e quais são as condições?' : 'A política informa que não há provisório disponível. Que próximo passo podemos combinar?';
    if (i.unsupportedPromise) npc = 'A peça já chegou? Preciso saber se posso contar com essa entrega antes da viagem.';
    if (i.nextStep && !state.unsupported) { state.nextStep = true; state.nextStepMessageId = user.id; npc = 'Está bem. Vou aguardar sua atualização, sabendo que o prazo do reparo ainda não está confirmado.'; if (!state.loanAgreed) s.commitment = { status: 'valid', text: 'Atualização combinada, sem promessa de reparo', sourceMessageId: user.id }; }
    if (i.confirmLoan && couldAgreeBeforeReply && s.scenario.rules.loanAvailable && !state.unsupported) { state.loanAgreed = true; s.commitment = { status: 'valid', text: 'Aparelho provisório · devolução em 27 out', sourceMessageId: user.id }; npc = 'Combinado. Com o provisório consigo viajar e aguardar a confirmação do reparo.'; }
    else if (i.offerLoan && !state.unsupported && !state.loanAgreed && !state.nextStep) s.commitment = { status: 'draft', text: s.scenario.rules.loanAvailable ? 'Aparelho provisório · confirmar condições antes do acordo' : 'Empréstimo indisponível nesta configuração', sourceMessageId: user.id };
    if (i.explicitRetraction && !state.unsupported && s.commitment.status === 'unsupported') s.commitment = { status: 'none', text: 'Promessa retirada; próximo passo ainda não combinado', sourceMessageId: user.id };
  }
  // The character can phrase a contextual response. The authoritative factual
  // acknowledgement is always appended from the resulting server state.
  if (count === 2) {
    const endingId = state.unsupported ? 'END-03' : state.loanAgreed ? 'END-01' : state.nextStep ? 'END-02' : null;
    s.ending = endingId ? clone(s.scenario.graph.endings.find(e => e.id === endingId)) : null;
    if (s.ending) delete s.ending.guard;
    s.status = endingId ? 'completed' : 'incomplete';
    if (endingId === 'END-02') s.commitment = { status: 'valid', text: 'Atualização combinada, sem promessa de reparo', sourceMessageId: state.nextStepMessageId || s.commitment.sourceMessageId };
    npc = endingId === 'END-03' ? 'Vou me organizar contando com essa entrega.' : endingId === 'END-01' ? 'Com o provisório consigo viajar. Vou devolver dentro do prazo combinado.' : endingId === 'END-02' ? 'Vou aguardar a atualização. Entendi que o reparo ainda não tem prazo garantido.' : 'Ainda não ficou claro com o que posso contar. Vamos encerrar esta tentativa sem um acordo.';
  }
  addMessage(s, 'npc', s.mode === 'openai' ? `${interpretation.reply.trim()}\n\n${npc}` : npc);
  return s;
}
export function fixtureAssessment(s) {
  const sig = s._state.signals; const users = s.messages.filter(m => m.role === 'user');
  const chosen = [sig.find(x => x.acknowledgesNeed), [...sig].reverse().find(x => x.unsupportedPromise) || [...sig].reverse().find(x => x.explainsUnknownEta), [...sig].reverse().find(x => x.confirmLoan || x.nextStep || x.offerLoan)];
  const ratings = [chosen[0] ? 'observado' : 'não observado', s._state.unsupported ? 'não observado' : sig.some(x => x.explainsUnknownEta) ? 'observado' : 'parcialmente observado', s.ending?.id === 'END-01' || s.ending?.id === 'END-02' ? 'observado' : 'não observado'];
  const reasons = ['A avaliação observa se a necessidade da viagem foi reconhecida na fala.', s._state.unsupported ? 'A promessa de reparo não possui respaldo: o prazo da peça permanece desconhecido.' : 'A comunicação é comparada com a incerteza registrada na ordem de serviço.', s.ending?.id === 'END-01' ? 'As condições foram confirmadas antes de combinar o empréstimo.' : s.ending?.id === 'END-02' ? 'Há próximo passo combinado sem prometer reparo.' : 'Não houve solução viável combinada nesta tentativa.'];
  return { criteria: s.scenario.rubric.criteria.map((c, idx) => { const m = users.find(m => m.id === chosen[idx]?.messageId); return { criterionId: c.id, name: c.name, rating: m ? ratings[idx] : 'sem evidência suficiente', quote: m?.text || '', messageId: m?.id || '', reason: m ? reasons[idx] : 'Não há uma fala do participante que sustente este critério nesta tentativa.' }; }), opportunity: s._state.unsupported ? 'Retire a garantia de prazo, explique a incerteza e verifique uma alternativa antes de combiná-la.' : s.ending?.id === 'END-01' ? 'Na próxima tentativa, verifique a necessidade principal antes de apresentar a alternativa.' : 'Consulte a política e combine um próximo passo explícito, sem transformar incerteza em promessa.' };
}
export function validateAssessment(s, e) {
  if (!e || !Array.isArray(e.criteria) || e.criteria.length !== 3 || typeof e.opportunity !== 'string' || !e.opportunity.trim() || e.opportunity.length > 1500) fail(503, 'INVALID_MODEL_OUTPUT', 'A avaliação não apresentou os três critérios esperados.');
  const ratings = new Set(fixture.rubric.ratingVocabulary);
  const seen = new Set();
  for (const c of e.criteria) {
    const criterion = s.scenario.rubric.criteria.find(r => r.id === c?.criterionId);
    if (!criterion || seen.has(c.criterionId) || !ratings.has(c.rating) || typeof c.reason !== 'string' || !c.reason.trim() || c.reason.length > 1500) fail(503, 'INVALID_MODEL_OUTPUT', 'A avaliação contém um critério inválido.');
    seen.add(c.criterionId); c.name = criterion.name;
    const m = s.messages.find(m => m.id === c.messageId && m.role === 'user');
    const absent = c.rating === 'sem evidência suficiente' && c.quote === '' && c.messageId === '' && c.reason.trim().length > 0;
    if (!absent && (typeof c.quote !== 'string' || !c.quote.trim() || !m || !m.text.includes(c.quote))) fail(503, 'INVALID_CITATION', 'Uma citação não corresponde à fala original do participante.');
  }
  return e;
}
export function finishAssessment(s, evaluation) {
  s.evaluation = validateAssessment(s, evaluation);
  delete s.assessmentError;
  s.messages = s.messages.filter(m => m.role !== 'summary');
  addMessage(s, 'summary', s.evaluation.opportunity);
  if (s.messages.length > 8) fail(500, 'INVARIANT_FAILED', 'A sessão excedeu o limite de mensagens.');
  return s;
}
