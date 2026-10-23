import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createPublicKey, verify } from 'node:crypto';
import { createSessionExport, createIntegrationStore, createDevnetAdapter } from '../server/integrations/index.mjs';
import { createSignedMemoTransaction, createSolanaDevnetTransport, base58Decode, base58Encode, DEVNET_RPC, DEVNET_GENESIS, MEMO_PROGRAM } from '../server/integrations/solana-transport.mjs';

const seed = Uint8Array.from({ length: 32 }, (_, i) => i + 1); // Public synthetic test key, never funded.
const blockhash = base58Encode(Buffer.alloc(32, 4));
const principal = { id: 'synthetic-owner', kind: 'guest', authenticated: true };
function document() {
  const s = { id: 'synthetic', revision: 1, status: 'completed', mode: 'fixture', scenarioId: 's1', scenarioVersion: 1,
    scenario: { id: 's1', version: 1, title: 'Fixture', rubric: { id: 'r1', version: 1, criteria: [1, 2, 3].map(i => ({ id: `c${i}`, name: 'Critério', observable: 'Limite dito' })) } },
    messages: [{ id: 'u1', role: 'user', text: 'Sem garantia.', speaker: 'Participante fictício', seq: 1 }],
    commitment: { status: 'none', text: 'Nenhum' }, evaluation: { criteria: [1, 2, 3].map(i => ({ criterionId: `c${i}`, name: 'Critério', rating: 'observado', quote: 'Sem garantia.', messageId: 'u1', reason: 'Evidência sintética literal.' })), opportunity: 'Confira a regra.' }, ending: null };
  return createSessionExport(s).document;
}
function storage(t) { const db = new DatabaseSync(':memory:'); t.after(() => db.close()); return createIntegrationStore(db); }
function mockedRPC(overrides = {}) {
  const calls = [];
  return { calls, fetch: async (url, options) => {
    assert.equal(url, DEVNET_RPC); assert.equal(options.redirect, 'error');
    const request = JSON.parse(options.body); calls.push(request);
    const results = { getGenesisHash: DEVNET_GENESIS, getLatestBlockhash: { value: { blockhash, lastValidBlockHeight: 100 } }, getFeeForMessage: { value: 5000 }, getBalance: { value: 100000 }, simulateTransaction: { value: { err: null } } };
    const result = Object.hasOwn(overrides, request.method) ? await overrides[request.method](request) : results[request.method];
    return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: request.id, result }) };
  } };
}

test('legacy memo layout and Ed25519 signature are independently decoded', () => {
  const memo = '{"v":1,"sha256":"' + 'a'.repeat(64) + '"}';
  const tx = createSignedMemoTransaction({ secretKey: seed, blockhash, memo }), bytes = Buffer.from(tx.rawTransaction, 'base64');
  assert.equal(bytes[0], 1); const signature = bytes.subarray(1, 65), message = bytes.subarray(65);
  assert.deepEqual([...message.subarray(0, 4)], [1, 0, 1, 2]);
  assert.equal(base58Encode(message.subarray(4, 36)), tx.signer); assert.equal(base58Encode(message.subarray(36, 68)), MEMO_PROGRAM); assert.equal(base58Encode(message.subarray(68, 100)), blockhash);
  assert.deepEqual([...message.subarray(100, 104)], [1, 1, 1, 0]);
  assert.equal(message[104], Buffer.byteLength(memo)); assert.equal(message.subarray(105).toString('utf8'), memo);
  const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), message.subarray(4, 36)]), format: 'der', type: 'spki' });
  assert.equal(verify(null, message, publicKey, signature), true); assert.deepEqual(base58Decode(tx.signature, 64), signature); assert.ok(bytes.length < 1232);
});

test('transport defaults deny before network; wrong genesis and fee excess refuse send', async () => {
  const rpc = mockedRPC(); const disabled = createSolanaDevnetTransport({ secretKey: seed, fetchImpl: rpc.fetch });
  await assert.rejects(disabled.prepare({ memo: 'test' }), { code: 'ANCHOR_NOT_AUTHORIZED' }); assert.equal(rpc.calls.length, 0);
  for (const [override, code] of [[{ getGenesisHash: () => 'mainnet' }, 'WRONG_NETWORK'], [{ getFeeForMessage: () => ({ value: 10001 }) }, 'FEE_LIMIT']]) {
    const r = mockedRPC(override), t = createSolanaDevnetTransport({ secretKey: seed, fetchImpl: r.fetch, allowSend: true });
    await assert.rejects(t.prepare({ memo: 'test' }), { code }); assert.ok(!r.calls.some(c => c.method === 'sendTransaction'));
  }
});

test('submit accepts only its immutable preparation, once; no retries', async () => {
  let signature; const rpc = mockedRPC({ sendTransaction: () => signature });
  const transport = createSolanaDevnetTransport({ secretKey: seed, fetchImpl: rpc.fetch, allowSend: true });
  const prepared = await transport.prepare({ memo: 'synthetic proof' }); signature = prepared.signature;
  await assert.rejects(transport.submit({ ...prepared }), { code: 'UNTRUSTED_TRANSACTION' });
  assert.equal(Object.isFrozen(prepared), true); await transport.submit(prepared);
  await assert.rejects(transport.submit(prepared), { code: 'UNTRUSTED_TRANSACTION' });
  const sends = rpc.calls.filter(c => c.method === 'sendTransaction'); assert.equal(sends.length, 1); assert.equal(sends[0].params[1].maxRetries, 0);
});

test('receipt requires confirmed status, exact memo and signer on Devnet', async () => {
  const tx = createSignedMemoTransaction({ secretKey: seed, blockhash, memo: 'synthetic memo' }); let memo = 'wrong';
  const rpc = mockedRPC({ getSignatureStatuses: () => ({ value: [{ err: null, confirmationStatus: 'confirmed' }] }), getTransaction: () => ({ slot: 99, meta: { err: null }, transaction: { signatures: [tx.signature], message: { accountKeys: [{ pubkey: tx.signer, signer: true }], instructions: [{ programId: MEMO_PROGRAM, parsed: memo }] } } }) });
  const transport = createSolanaDevnetTransport({ fetchImpl: rpc.fetch });
  await assert.rejects(transport.inspect({ ...tx, memo: 'synthetic memo' }), { code: 'RECEIPT_MISMATCH' });
  memo = 'synthetic memo'; const result = await transport.inspect({ ...tx, memo }); assert.equal(result.status, 'confirmed'); assert.equal(result.slot, 99);
});

test('anchor persists signature BEFORE submit and an ambiguous send is never blindly repeated', async t => {
  const store = storage(t), doc = document(); let submits = 0, savedMemo;
  const tx = createSignedMemoTransaction({ secretKey: seed, blockhash, memo: 'placeholder' });
  const transport = { mode: 'solana-devnet', async prepare({ memo }) { savedMemo = memo; return tx; }, async submit() {
    submits++; const record = store.list('anchors')[0]; assert.equal(record.signature, tx.signature); assert.equal(record.status, 'needs_reconciliation'); throw Error('Synthetic timeout after potential broadcast');
  }, async inspect() { return { status: 'confirmed', slot: 24, network: 'solana-devnet', signature: tx.signature, signer: tx.signer, memo: savedMemo }; } };
  const adapter = createDevnetAdapter({ store, transport, executionAuthorized: true });
  const payload = { document: doc, expectedSha256: doc.integrity.sha256, commandId: 'anchor-1' };
  assert.equal((await adapter.requestAnchor(principal, payload)).status, 'needs_reconciliation');
  await adapter.requestAnchor(principal, payload); await adapter.requestAnchor(principal, { ...payload, commandId: 'different-command-same-content' }); assert.equal(submits, 1);
  assert.equal((await adapter.reconcile(principal, doc.integrity.sha256)).status, 'confirmed');
  const memoRecord = JSON.parse(savedMemo); assert.deepEqual(Object.keys(memoRecord).sort(), ['kind', 'schema', 'sha256', 'v']); assert.ok(!savedMemo.includes('Participante'));
  assert.equal(adapter.status({ ...principal, id: 'another-owner' }, doc.integrity.sha256).status, 'not_requested');
});

test('external execution is disabled by default, and trusted export reference is mandatory', async t => {
  const store = storage(t), doc = document(), a = createDevnetAdapter({ store });
  assert.equal(a.status(principal, doc.integrity.sha256).available, false);
  await assert.rejects(a.requestAnchor(principal, { document: doc, commandId: 'x' }), { code: 'ANCHOR_NOT_AUTHORIZED' });
  const enabled = createDevnetAdapter({ store, transport: { mode: 'solana-devnet' }, executionAuthorized: true });
  await assert.rejects(enabled.requestAnchor(principal, { document: doc, commandId: 'x' }), { code: 'TRUSTED_EXPORT_REQUIRED' });
  await assert.rejects(enabled.requestAnchor(principal, { document: doc, expectedSha256: 'f'.repeat(64), commandId: 'x' }), { code: 'EXPORT_MISMATCH' });
});

test('pending reconciliation response cannot overwrite a faster confirmed receipt', async t => {
  const store = storage(t), doc = document(); let resolveSlow, memo;
  const tx = createSignedMemoTransaction({ secretKey: seed, blockhash, memo: 'placeholder' }); let inspections = 0;
  const transport = { mode: 'solana-devnet', async prepare(input) { memo = input.memo; return tx; }, async submit() {}, async inspect() {
    if (++inspections === 1) return new Promise(resolve => resolveSlow = resolve);
    return { status: 'confirmed', slot: 42, network: 'solana-devnet', signature: tx.signature, signer: tx.signer, memo };
  } };
  const a = createDevnetAdapter({ store, transport, executionAuthorized: true });
  await a.requestAnchor(principal, { document: doc, expectedSha256: doc.integrity.sha256, commandId: 'anchor' });
  const slow = a.reconcile(principal, doc.integrity.sha256); await a.reconcile(principal, doc.integrity.sha256); resolveSlow({ status: 'pending' });
  assert.equal((await slow).status, 'confirmed'); assert.equal(a.status(principal, doc.integrity.sha256).status, 'confirmed');
});
