import { createHash } from 'node:crypto';
import { IntegrationError, requireCondition as ensure } from './errors.mjs';

export const EXPORT_SCHEMA = 'frontline.export/1';
export const CANONICALIZATION = 'frontline.sorted-json/1';
const MAX_BYTES = 1024 * 1024;
const digest = text => createHash('sha256').update(text, 'utf8').digest('hex');
const pick = (object, names) => Object.fromEntries(names.filter(key => object?.[key] !== undefined).map(key => [key, structuredClone(object[key])]));

// Deliberately named/versioned, rather than claiming RFC8785 compliance.
export function canonicalJSON(value, depth = 0) {
  ensure(depth <= 32, 422, 'EXPORT_TOO_DEEP', 'O arquivo contém uma estrutura muito profunda.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') { ensure(Number.isFinite(value), 422, 'INVALID_EXPORT', 'O arquivo contém um número inválido.'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(item => canonicalJSON(item, depth + 1)).join(',')}]`;
  ensure(value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value)), 422, 'INVALID_EXPORT', 'O arquivo deve conter somente valores JSON.');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJSON(value[key], depth + 1)}`).join(',')}}`;
}

function validateReview(session) {
  ensure(session && typeof session.id === 'string' && session.id.length > 0 && Number.isInteger(session.revision) && session.revision >= 0, 422, 'INVALID_EXPORT', 'Sessão inválida para exportação.');
  ensure(['completed', 'incomplete'].includes(session.status) && session.evaluation, 409, 'EXPORT_NOT_READY', 'Conclua a tentativa e obtenha a avaliação antes de exportar a revisão.');
  ensure(['fixture', 'openai'].includes(session.mode), 422, 'INVALID_EXPORT', 'A origem da conversa precisa estar identificada.');
  ensure(session.scenario?.id === session.scenarioId && session.scenario?.version === session.scenarioVersion, 422, 'INVALID_EXPORT', 'A revisão não corresponde à versão do cenário.');
  ensure(Array.isArray(session.messages) && session.messages.length <= 8 && session.messages.length > 0, 422, 'INVALID_EXPORT', 'Transcrição inválida.');
  const ids = new Set();
  for (const [index, m] of session.messages.entries()) {
    ensure(m && typeof m.id === 'string' && m.id && !ids.has(m.id) && m.seq === index + 1 && ['npc', 'user', 'summary'].includes(m.role) && typeof m.text === 'string' && typeof m.speaker === 'string', 422, 'INVALID_EXPORT', 'Mensagem ou sequência inválida.');
    ids.add(m.id);
  }
  ensure(session.messages.filter(m => m.role === 'user').length <= 3, 422, 'INVALID_EXPORT', 'A tentativa excede o limite de respostas.');
  const criteria = session.evaluation.criteria, rubric = session.scenario.rubric?.criteria;
  ensure(Array.isArray(criteria) && criteria.length === 3 && Array.isArray(rubric) && rubric.length === 3, 422, 'INVALID_EXPORT', 'A revisão deve ter os três critérios do exercício.');
  const seen = new Set();
  for (const c of criteria) {
    ensure(c && rubric.some(r => r.id === c.criterionId) && !seen.has(c.criterionId) && ['observado', 'parcialmente observado', 'não observado', 'sem evidência suficiente'].includes(c.rating) && typeof c.reason === 'string' && c.reason.trim(), 422, 'INVALID_EXPORT', 'Critério inválido na revisão.');
    seen.add(c.criterionId);
    const absent = c.rating === 'sem evidência suficiente' && c.quote === '' && c.messageId === '';
    const message = session.messages.find(m => m.id === c.messageId && m.role === 'user');
    ensure(absent || (typeof c.quote === 'string' && c.quote.trim() && message?.text.includes(c.quote)), 422, 'INVALID_CITATION', 'A revisão contém uma citação que não corresponde à fala do participante.');
  }
}

function publicSession(s) {
  // Account IDs, runtime state, provider traces and credentials never enter the export.
  const value = pick(s, ['id', 'revision', 'status', 'scenarioId', 'scenarioVersion', 'mode', 'parentSessionId', 'branchScope', 'createdAt', 'updatedAt', 'attributes', 'documentsRead']);
  value.scenario = pick(s.scenario, ['id', 'version', 'title', 'summary', 'label', 'rules', 'contextNeed', 'contextUnknowns']);
  value.scenario.facts = s.scenario.facts?.map(f => pick(f, ['id', 'text', 'status', 'sourceObject'])) || [];
  value.scenario.policy = pick(s.scenario.policy, ['id', 'version', 'title', 'terms', 'unknowns']);
  value.scenario.rubric = pick(s.scenario.rubric, ['id', 'version', 'label']);
  value.scenario.rubric.criteria = s.scenario.rubric.criteria.map(c => pick(c, ['id', 'name', 'observable']));
  value.messages = s.messages.map(m => pick(m, ['id', 'role', 'speaker', 'text', 'seq']));
  value.commitment = pick(s.commitment, ['status', 'text', 'sourceMessageId']);
  value.ending = s.ending ? pick(s.ending, ['id', 'title', 'consequence']) : null;
  value.evaluation = { criteria: s.evaluation.criteria.map(c => pick(c, ['criterionId', 'name', 'rating', 'quote', 'messageId', 'reason'])), opportunity: s.evaluation.opportunity };
  return value;
}

export function createSessionExport(session) {
  validateReview(session);
  const payload = { session: publicSession(session), notice: 'Registro de exercício simulado. Integridade não certifica competência, autoria ou correção da avaliação.' };
  const signedContent = { schemaVersion: EXPORT_SCHEMA, payload };
  const canonical = canonicalJSON(signedContent);
  ensure(Buffer.byteLength(canonical, 'utf8') <= MAX_BYTES, 413, 'EXPORT_TOO_LARGE', 'A revisão excede o tamanho permitido.');
  const document = { ...signedContent, integrity: { algorithm: 'sha256', canonicalization: CANONICALIZATION, sha256: digest(canonical) } };
  return { document, filename: `frontline-revisao-${session.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)}.json` };
}

export function verifySessionExport(input, { expectedSha256 } = {}) {
  try {
    let document = input;
    if (typeof input === 'string') {
      ensure(Buffer.byteLength(input, 'utf8') <= MAX_BYTES, 413, 'EXPORT_TOO_LARGE', 'Arquivo muito grande.');
      try { document = JSON.parse(input); } catch { throw new IntegrationError(422, 'INVALID_JSON', 'O arquivo não contém JSON válido.'); }
    }
    ensure(document && Object.keys(document).sort().join(',') === 'integrity,payload,schemaVersion' && document.schemaVersion === EXPORT_SCHEMA, 422, 'UNSUPPORTED_EXPORT', 'Formato de revisão não reconhecido.');
    ensure(document.integrity?.algorithm === 'sha256' && document.integrity?.canonicalization === CANONICALIZATION && /^[a-f0-9]{64}$/.test(document.integrity?.sha256), 422, 'INVALID_INTEGRITY', 'Informações de integridade inválidas.');
    const canonical = canonicalJSON({ schemaVersion: document.schemaVersion, payload: document.payload });
    ensure(Buffer.byteLength(canonical, 'utf8') <= MAX_BYTES, 413, 'EXPORT_TOO_LARGE', 'Arquivo muito grande.');
    const sha256 = digest(canonical);
    ensure(sha256 === document.integrity.sha256, 422, 'HASH_MISMATCH', 'A cópia foi alterada ou corrompida.');
    validateReview(document.payload?.session);
    if (expectedSha256 !== undefined) ensure(/^[a-f0-9]{64}$/.test(expectedSha256), 422, 'INVALID_REFERENCE', 'A referência de comparação é inválida.');
    return { valid: true, sha256, matchesTrustedExport: expectedSha256 === undefined ? null : sha256 === expectedSha256, reason: expectedSha256 === undefined ? 'INTERNALLY_CONSISTENT' : sha256 === expectedSha256 ? 'MATCHES_REFERENCE' : 'DIFFERENT_REFERENCE', anchored: false };
  } catch (error) {
    if (!(error instanceof IntegrationError)) throw error;
    return { valid: false, sha256: null, matchesTrustedExport: false, reason: error.code, message: error.message, anchored: false };
  }
}
