import { createHash, randomUUID } from 'node:crypto';
import { verifySessionExport, canonicalJSON, EXPORT_SCHEMA } from './export.mjs';
import { IntegrationError, requireCondition as ensure } from './errors.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const ownerOf = principal => { ensure(principal?.authenticated === true && ['guest', 'account'].includes(principal.kind) && typeof principal.id === 'string' && principal.id.length > 0 && principal.id.length <= 200, 401, 'IDENTITY_REQUIRED', 'Identidade da sessão necessária.'); return principal.id; };
const errorCode = error => error instanceof IntegrationError ? error.code : 'ADAPTER_FAILED';

export function createDevnetAdapter({ store, transport, executionAuthorized = false, clock = Date.now } = {}) {
  ensure(store && typeof store.transaction === 'function', 500, 'STORE_REQUIRED', 'Persistência da integração indisponível.');
  const recordKey = (owner, digest) => sha(`${owner}\0${digest}`);
  const view = record => record ? { id: record.id, status: record.status, network: 'solana-devnet', sha256: record.sha256, signature: record.signature || null, explorer: record.signature ? `https://explorer.solana.com/tx/${encodeURIComponent(record.signature)}?cluster=devnet` : null, createdAt: record.createdAt, updatedAt: record.updatedAt, confirmedAt: record.confirmedAt || null, slot: record.slot ?? null, error: record.error || null, integrityOnly: true } : { status: 'not_requested', network: 'solana-devnet', signature: null, integrityOnly: true };
  const save = (key, record) => store.transaction(() => {
    const current = store.get('anchors', key);
    // A slower pending RPC response cannot overwrite a confirmed/failed receipt.
    if (current && ['confirmed', 'failed'].includes(current.status)) return view(current);
    record.updatedAt = new Date(clock()).toISOString(); store.set('anchors', key, record); return view(record);
  });
  return {
    status(principal, digest) { const owner = ownerOf(principal); ensure(/^[a-f0-9]{64}$/.test(digest), 422, 'INVALID_HASH', 'Hash de revisão inválido.'); return { ...view(store.get('anchors', recordKey(owner, digest))), available: executionAuthorized === true && transport?.mode === 'solana-devnet', reason: executionAuthorized ? null : 'EXTERNAL_EXECUTION_NOT_AUTHORIZED' }; },
    async requestAnchor(principal, { document, expectedSha256, commandId } = {}) {
      const owner = ownerOf(principal);
      ensure(executionAuthorized === true && transport?.mode === 'solana-devnet', 403, 'ANCHOR_NOT_AUTHORIZED', 'A ancoragem externa não está autorizada.');
      ensure(typeof commandId === 'string' && commandId.length > 0 && commandId.length <= 200, 422, 'INVALID_COMMAND', 'Informe um identificador de comando.');
      ensure(/^[a-f0-9]{64}$/.test(expectedSha256), 422, 'TRUSTED_EXPORT_REQUIRED', 'A API precisa fornecer o hash da revisão autenticada.');
      const verified = verifySessionExport(document, { expectedSha256 });
      ensure(verified.valid && verified.matchesTrustedExport, 422, 'EXPORT_MISMATCH', 'O arquivo não corresponde à revisão autenticada.');
      const key = recordKey(owner, verified.sha256), receiptKey = sha(`${owner}\0${commandId}`);
      const selection = store.transaction(() => {
        const receipt = store.get('anchor-commands', receiptKey);
        if (receipt) { ensure(receipt.key === key, 409, 'IDEMPOTENCY_CONFLICT', 'O comando já foi usado para outra revisão.'); return { existing: true, record: store.get('anchors', key) }; }
        const prior = store.get('anchors', key);
        store.set('anchor-commands', receiptKey, { key });
        if (prior) return { existing: true, record: prior };
        // Only version/type/hash are published. No names, transcript, phone or session/account IDs.
        const memo = canonicalJSON({ v: 1, kind: 'frontline-review', schema: EXPORT_SCHEMA, sha256: verified.sha256 });
        const record = { id: randomUUID(), owner, sha256: verified.sha256, status: 'preparing', memo, createdAt: new Date(clock()).toISOString() };
        save(key, record); return { existing: false, record };
      });
      if (selection.existing) return view(selection.record);
      const record = selection.record;
      let prepared;
      try {
        prepared = await transport.prepare({ memo: record.memo });
        ensure(typeof prepared?.signature === 'string' && typeof prepared.signer === 'string' && typeof prepared.rawTransaction === 'string', 503, 'INVALID_PREPARED_TRANSACTION', 'O adapter não produziu uma transação válida.');
        Object.assign(record, { signature: prepared.signature, signer: prepared.signer, status: 'needs_reconciliation' });
        // Persist a known signature BEFORE broadcasting. A timeout can no longer authorize a duplicate send.
        save(key, record);
      } catch (error) { record.status = 'failed'; record.error = errorCode(error); return save(key, record); }
      try {
        await transport.submit(prepared); record.status = 'submitted'; record.error = null;
      } catch (error) { record.status = 'needs_reconciliation'; record.error = errorCode(error); }
      return save(key, record);
    },
    async reconcile(principal, digest) {
      ensure(/^[a-f0-9]{64}$/.test(digest), 422, 'INVALID_HASH', 'Hash de revisão inválido.');
      const owner = ownerOf(principal), key = recordKey(owner, digest), record = store.get('anchors', key);
      ensure(record, 404, 'ANCHOR_NOT_FOUND', 'Registro de integridade não encontrado.');
      if (['confirmed', 'failed'].includes(record.status)) return view(record);
      if (!record.signature) { record.status = 'needs_reconciliation'; record.error = 'PREPARATION_INTERRUPTED'; return save(key, record); }
      ensure(transport?.mode === 'solana-devnet', 503, 'DEVNET_UNAVAILABLE', 'Consulta Devnet indisponível.');
      try {
        const receipt = await transport.inspect({ signature: record.signature, signer: record.signer, memo: record.memo });
        if (receipt.status === 'confirmed') {
          ensure(receipt.signature === record.signature && receipt.signer === record.signer && receipt.memo === record.memo && receipt.network === 'solana-devnet' && Number.isInteger(receipt.slot), 503, 'RECEIPT_MISMATCH', 'Recibo externo divergente.');
          record.status = 'confirmed'; record.slot = receipt.slot; record.confirmedAt = new Date(clock()).toISOString(); record.error = null;
        } else if (receipt.status === 'failed') { record.status = 'failed'; record.error = receipt.reason || 'TRANSACTION_FAILED'; }
        else { record.status = 'needs_reconciliation'; record.error = 'CONFIRMATION_PENDING'; }
      } catch (error) { record.status = 'needs_reconciliation'; record.error = errorCode(error); }
      return save(key, record);
    }
  };
}
