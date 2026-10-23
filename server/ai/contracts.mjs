import { AppError } from '../engine.mjs';

export const AI_CONTRACT_VERSION = 'ai.v0.4';
export const RATINGS = ['observado', 'parcialmente observado', 'não observado', 'sem evidência suficiente'];
const string = { type: 'string' };
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const intentDescriptions = {
  acknowledgesNeed: 'Mariana reconhece ou investiga a necessidade concreta do cliente. Oferecer estoque sozinho não é reconhecer a necessidade.',
  explainsUnknownEta: 'Mariana comunica que peça ou reparo não têm prazo confirmado.',
  unsupportedPromise: 'Mariana garante reparo ou chegada da peça sem prazo confirmado; não marcar para pergunta, negação ou promessa de atualização.',
  explicitRetraction: 'Mariana retira explicitamente uma garantia de reparo feita anteriormente.',
  offerLoan: 'Mariana oferece ou explora o provisório como alternativa, inclusive pergunta se ajudaria. Oferta exploratória é true mesmo sem condições verificadas; não significa acordo.',
  askIdentity: 'Mariana pergunta se Roberto tem/apresenta documento. Você está com seu documento? é true, independentemente de pré-condições ou resposta anterior. Não confundir pergunta da atendente com confirmação do cliente.',
  askReturn: 'Mariana pergunta se Roberto consegue devolver no prazo/data. Consegue devolver no dia 27? é true, mesmo sem aprovação do empréstimo.',
  confirmLoan: 'Mariana propõe fechar explicitamente o empréstimo, mesmo se o motor poderá negar. Avaliar o ato dito, nunca decidir se o acordo é permitido.',
  nextStep: 'Mariana combina atualização com horário ou gatilho explícito. Aviso quando houver atualização é true; intenção vaga não basta.',
  ambiguous: 'A mensagem mantém a decisão hipotética ou ambígua, sem compromisso. Perguntar se um provisório ajudaria, por si só, não torna uma oferta inexistente.',
  withdrawLoan: 'Mariana retira ou cancela explicitamente a proposta/acordo de empréstimo.',
  withdrawNextStep: 'Mariana retira ou cancela explicitamente a atualização combinada.'
};
export function interpretationSchema(keys) {
  return object({ intent: object(Object.fromEntries(keys.map(k => [k, { type: 'boolean', description: intentDescriptions[k] }]))), evidence: object(Object.fromEntries(keys.map(k => [k, { type: 'string', description: 'Se a flag é true, copiar trecho contínuo literal da última fala de Mariana. Se false, string vazia.' } ]))) });
}
export const turnReplySchema = object({ reply: { type: 'string', description: 'Uma única fala de Roberto cliente, em primeira pessoa, limitada ao resultado real de apply_training_turn. Nunca aceitar empréstimo negado ou ainda não acordado.' } });
export function turnSchema(keys) {
  return object({ intent: object(Object.fromEntries(keys.map(k => [k, { type: 'boolean' }]))), evidence: object(Object.fromEntries(keys.map(k => [k, string]))), reply: { type: 'string', description: 'Somente a próxima fala de Roberto, cliente, em primeira pessoa. Não continuar a fala de Mariana nem oferecer serviço ou pedir documento da atendente.' } });
}
export const assessmentSchema = object({
  criteria: { type: 'array', items: object({ criterionId: string, name: string, rating: { type: 'string', enum: RATINGS }, quote: string, messageId: string, reason: string }) },
  opportunity: string
});
export const draftSchema = object({
  title: string, summary: string, need: string, opening: { type: 'string', description: 'Primeira fala de Roberto, CLIENTE, em primeira pessoa, pedindo ajuda para sua própria necessidade. Não é uma fala da atendente nem texto do autor.' }, unknowns: { type: 'array', items: string },
  clientBrief: object({ objective: string, traits: { type: 'array', items: string }, initialState: string }),
  compatibility: object({ supported: { type: 'boolean' }, reason: string, sourceQuote: string }),
  contextualFacts: { type: 'array', items: object({ id: string, text: string, status: { type: 'string', enum: ['provided', 'unknown', 'fictional'] }, sourceQuote: string }) },
  rules: object({ loanAvailable: { type: ['boolean', 'null'] }, loanDays: { type: ['integer', 'null'] } }),
  ruleEvidence: object({ loanAvailable: string, loanDays: string })
});
export const authorToolSchema = object({ operation: { type: 'string', enum: ['create', 'revise'] }, proposal: draftSchema });
export const authorReviewSchema = object({ authorMessage: string });

const invalid = (code = 'INVALID_MODEL_OUTPUT', message = 'A resposta do serviço não corresponde ao formato esperado. Sua entrada foi preservada.', fieldPath, reason) => {
  const error = new AppError(503, code, message);
  // Fixed schema paths and categories only; never include the rejected value.
  if (fieldPath && reason) error.validationDiagnostic = { fieldPath, reason };
  throw error;
};
// Validate the schema subset sent to Responses; business rules stay in engine.
export function assertSchema(value, schema) {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (!types.includes(type) && !(type === 'number' && types.includes('integer') && Number.isInteger(value))) invalid();
  if (schema.enum && !schema.enum.includes(value)) invalid();
  if (type === 'object') {
    if (Object.keys(value).some(k => !Object.hasOwn(schema.properties, k)) || schema.required.some(k => !Object.hasOwn(value, k))) invalid();
    for (const [key, child] of Object.entries(schema.properties)) assertSchema(value[key], child);
  }
  if (type === 'array') for (const item of value) assertSchema(item, schema.items);
  return value;
}
function bounded(text, limit, empty = false) {
  if (typeof text !== 'string' || text.length > limit || (!empty && !text.trim())) invalid();
}
function literal(quote, texts, code, fieldPath) {
  bounded(quote, 6000);
  if (!texts.some(text => typeof text === 'string' && text.includes(quote))) invalid(code, 'Uma evidência não coincide literalmente com o texto recebido. Revise e tente novamente.', fieldPath, 'not_literal_substring');
}
export function validateTurn(value, keys, text) {
  assertSchema(value, turnSchema(keys)); bounded(value.reply, 900);
  validateInterpretation({ intent: value.intent, evidence: value.evidence }, keys, text);
  return value;
}
export function validateInterpretation(value, keys, text) {
  assertSchema(value, interpretationSchema(keys));
  for (const key of keys) {
    if (value.intent[key]) literal(value.evidence[key], [text], 'INVALID_INTENT_EVIDENCE', `evidence.${key}`);
    else if (value.evidence[key] !== '') invalid('INVALID_INTENT_EVIDENCE');
  }
  return value;
}
export function validateTurnReply(value) { assertSchema(value, turnReplySchema); bounded(value.reply, 900); return value; }
export function validateDraft(value, text, policyText = '', revisionTexts = []) {
  assertSchema(value, draftSchema);
  const sources = [text, policyText, ...revisionTexts];
  bounded(value.compatibility.reason, 500);
  if (!value.compatibility.supported || value.compatibility.sourceQuote !== '') literal(value.compatibility.sourceQuote, sources, 'INVALID_CONTEXT_EVIDENCE', 'compatibility.sourceQuote');
  // The real domain tool decides UNSUPPORTED_CONTEXT. Do not require a fabricated
  // exercise when the model has explicitly identified an unsupported request.
  if (!value.compatibility.supported) return value;
  bounded(value.clientBrief.objective, 400); bounded(value.clientBrief.initialState, 400);
  if (value.clientBrief.traits.length > 3) invalid();
  value.clientBrief.traits.forEach(trait => bounded(trait, 160));
  bounded(value.title, 160); bounded(value.summary, 1200); bounded(value.need, 1000); bounded(value.opening, 900);
  if (value.unknowns.length > 8 || value.contextualFacts.length > 6) invalid();
  value.unknowns.forEach(v => bounded(v, 500));
  const ids = new Set();
  for (const [index, fact] of value.contextualFacts.entries()) {
    bounded(fact.id, 80); bounded(fact.text, 700);
    if (ids.has(fact.id)) invalid(); ids.add(fact.id);
    if (fact.status === 'provided') literal(fact.sourceQuote, [text, policyText, ...revisionTexts], 'INVALID_CONTEXT_EVIDENCE', `contextualFacts[${index}].sourceQuote`);
    else if (fact.sourceQuote !== '') invalid('INVALID_CONTEXT_EVIDENCE', undefined, `contextualFacts[${index}].sourceQuote`, 'unexpected_source');
  }
  for (const key of ['loanAvailable', 'loanDays']) {
    if (value.rules[key] === null) {
      if (value.ruleEvidence[key] !== '') invalid('INVALID_RULE_EVIDENCE');
    } else literal(value.ruleEvidence[key], [text, policyText, ...revisionTexts], 'INVALID_RULE_EVIDENCE', `ruleEvidence.${key}`);
  }
  if (value.rules.loanDays !== null && (value.rules.loanDays < 1 || value.rules.loanDays > 7)) invalid('INVALID_RULE_PROPOSAL');
  return value;
}
export function validateAuthorReview(value) {
  assertSchema(value, authorReviewSchema); bounded(value.authorMessage, 1200);
  return value;
}
export function validateAssessment(value, session) {
  assertSchema(value, assessmentSchema);
  if (value.criteria.length !== 3 || session.scenario.rubric.criteria.length !== 3) invalid();
  bounded(value.opportunity, 1000);
  const ids = new Set();
  for (const [index, item] of value.criteria.entries()) {
    const criterion = session.scenario.rubric.criteria.find(c => c.id === item.criterionId);
    if (!criterion || ids.has(item.criterionId)) invalid(); ids.add(item.criterionId);
    bounded(item.reason, 1000); bounded(item.name, 200);
    const absent = item.rating === 'sem evidência suficiente' && item.quote === '' && item.messageId === '';
    if (!absent) {
      const message = session.messages.find(m => m.id === item.messageId && m.role === 'user');
      literal(item.quote, [message?.text], 'INVALID_CITATION', `criteria[${index}].quote`);
    }
    item.name = criterion.name;
  }
  return value;
}
