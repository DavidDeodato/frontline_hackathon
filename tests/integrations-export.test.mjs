import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSessionExport, verifySessionExport, canonicalJSON, integrationCapabilities } from '../server/integrations/index.mjs';

function reviewed() {
  return { id: 'synthetic-review', revision: 4, scenarioId: 'scenario-1', scenarioVersion: 1, status: 'completed', mode: 'fixture', owner: 'MUST_NOT_EXPORT', _state: { private: true }, providerTrace: { secret: 'MUST_NOT_EXPORT' },
    scenario: { id: 'scenario-1', version: 1, title: 'Exercício sintético', facts: [{ id: 'f1', text: 'Sem prazo', status: 'provided', owner: 'MUST_NOT_EXPORT' }], policy: { id: 'p1', version: 1, terms: ['Sem garantia de prazo'] }, rubric: { id: 'r1', version: 1, criteria: [1, 2, 3].map(i => ({ id: `c${i}`, name: `Critério ${i}`, observable: 'Uma fala verificável' })) } },
    messages: [{ id: 'm1', role: 'npc', speaker: 'Cliente fictício', text: 'Preciso viajar.', seq: 1 }, { id: 'm2', role: 'user', speaker: 'Participante', text: 'Não posso garantir o prazo. Vou verificar uma alternativa.', seq: 2 }],
    commitment: { status: 'valid', text: 'Próximo passo', sourceMessageId: 'm2' }, ending: { id: 'END-02', title: 'Próximo passo combinado', consequence: 'Sem garantia' },
    evaluation: { criteria: [1, 2, 3].map(i => ({ criterionId: `c${i}`, name: `Critério ${i}`, rating: 'observado', quote: 'Não posso garantir o prazo.', messageId: 'm2', reason: 'Citação sintética literal.' })), opportunity: 'Verifique a necessidade.' }
  };
}

test('deterministic portable JSON excludes runtime identity and source secrets', () => {
  const first = createSessionExport(reviewed()), second = createSessionExport(reviewed());
  assert.deepEqual(first, second);
  const json = JSON.stringify(first.document);
  assert.ok(!json.includes('MUST_NOT_EXPORT')); assert.ok(!json.includes('_state')); assert.ok(!json.includes('providerTrace'));
  assert.equal(first.document.payload.session.mode, 'fixture');
  assert.equal(verifySessionExport(json).valid, true);
  assert.equal(verifySessionExport(json).matchesTrustedExport, null);
  assert.equal(verifySessionExport(json).anchored, false);
});

test('canonicalization is independently predictable and key ordering insensitive', () => {
  assert.equal(canonicalJSON({ z: [2, null, 'á'], a: { b: true } }), '{"a":{"b":true},"z":[2,null,"á"]}');
  const { document } = createSessionExport(reviewed());
  const reordered = { payload: document.payload, integrity: document.integrity, schemaVersion: document.schemaVersion };
  assert.equal(verifySessionExport(reordered, { expectedSha256: document.integrity.sha256 }).matchesTrustedExport, true);
});

test('tampering, malformed files and a different trusted reference are distinguishable', () => {
  const { document } = createSessionExport(reviewed());
  const tampered = structuredClone(document); tampered.payload.session.messages[1].text += ' Garantido.';
  assert.equal(verifySessionExport(tampered).reason, 'HASH_MISMATCH');
  assert.equal(verifySessionExport('{broken').reason, 'INVALID_JSON');
  assert.equal(verifySessionExport(document, { expectedSha256: '0'.repeat(64) }).reason, 'DIFFERENT_REFERENCE');
  tampered.integrity.sha256 = createHash('sha256').update(canonicalJSON({ schemaVersion: tampered.schemaVersion, payload: tampered.payload })).digest('hex');
  const forged = verifySessionExport(tampered, { expectedSha256: document.integrity.sha256 });
  assert.equal(forged.valid, true); assert.equal(forged.matchesTrustedExport, false); assert.equal(forged.anchored, false);
});

test('export refuses unassessed sessions, fabricated quotes, NPC quotes and duplicate criteria', () => {
  const s = reviewed(); s.status = 'active'; assert.throws(() => createSessionExport(s), { code: 'EXPORT_NOT_READY' });
  for (const change of [s => s.evaluation.criteria[0].quote = 'Texto inexistente', s => { s.evaluation.criteria[0].quote = 'Preciso viajar.'; s.evaluation.criteria[0].messageId = 'm1'; }, s => s.evaluation.criteria[1].criterionId = 'c1']) {
    const s = reviewed(); change(s); assert.throws(() => createSessionExport(s));
  }
});

test('insufficient evidence is explicit and capability status never claims connectivity', () => {
  const s = reviewed(); Object.assign(s.evaluation.criteria[0], { rating: 'sem evidência suficiente', quote: '', messageId: '', reason: 'Não há fala para este critério.' });
  assert.equal(verifySessionExport(createSessionExport(s).document).valid, true);
  const c = integrationCapabilities(); assert.equal(c.whatsapp.available, false); assert.equal(c.whatsapp.status, 'unlinked'); assert.equal(c.devnet.status, 'not_requested');
});

test('bounded verifier rejects oversized and deeply nested input', () => {
  assert.equal(verifySessionExport(' '.repeat(1024 * 1024 + 1)).reason, 'EXPORT_TOO_LARGE');
  let deep = {}; for (let i = 0; i < 40; i++) deep = { child: deep };
  assert.throws(() => canonicalJSON(deep), { code: 'EXPORT_TOO_DEEP' });
});
