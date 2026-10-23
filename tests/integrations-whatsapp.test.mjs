import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { createIntegrationStore, createWhatsAppAdapter, signBridgePayload } from '../server/integrations/index.mjs';

const principal = { id: 'synthetic-account-a', kind: 'account', authenticated: true };
const second = { id: 'synthetic-account-b', kind: 'account', authenticated: true };
const secret = 'synthetic-test-key-not-a-real-secret-0001';
function setup(t, options = {}) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const store = createIntegrationStore(db); let now = 1792773000000, allowed = true;
  const api = createWhatsAppAdapter({ store, mode: 'fixture', accountAuthAvailable: true, callbackSecret: secret, clock: () => now, resolveSession(owner, id) {
    if (!allowed || owner !== principal.id || id !== 'owned-session') return null;
    return { id, revision: 7, status: 'paused', messages: new Array(5).fill({}) };
  }, ...options });
  const callback = event => { const body = Buffer.from(JSON.stringify(event)), timestamp = String(now); return api.receiveCallback(body, { timestamp, signature: signBridgePayload(body, timestamp, secret) }); };
  return { api, store, callback, advance: ms => now += ms, denyAccess: () => allowed = false };
}
const claimEvent = (code, id = 'event-claim') => ({ eventId: id, type: 'link.claim', code, channelId: 'synthetic-01@channel.test', direct: true, fromSelf: false });
function link(h) {
  const first = h.api.beginLink(principal, { commandId: 'begin' });
  const claimed = h.callback(claimEvent(first.code));
  assert.equal(claimed.kind, 'confirmation_required');
  const state = h.api.status(principal);
  h.api.confirmLink(principal, { linkId: state.linkId, commandId: 'confirm', expectedRevision: state.revision });
  return first;
}

test('guest is never permitted to create a cross-device identity; default unavailable', t => {
  const h = setup(t);
  assert.equal(h.api.status({ id: 'guest', kind: 'guest', authenticated: true }).reason, 'ACCOUNT_REQUIRED');
  assert.throws(() => h.api.beginLink({ id: 'guest', kind: 'guest', authenticated: true }, { commandId: 'x' }), { code: 'ACCOUNT_REQUIRED' });
  const disabled = createWhatsAppAdapter({ store: h.store });
  assert.throws(() => disabled.beginLink(principal, { commandId: 'x' }), { code: 'CHANNEL_UNAVAILABLE' });
});

test('one-time claim requires web confirmation and fixture can never claim connected', t => {
  const h = setup(t); const first = h.api.beginLink(principal, { commandId: 'begin' });
  assert.equal(first.link.status, 'pending');
  assert.deepEqual(h.api.beginLink(principal, { commandId: 'begin' }), first);
  assert.throws(() => h.api.confirmLink(principal, { linkId: first.link.linkId, commandId: 'early', expectedRevision: first.link.revision }), { code: 'CHANNEL_CONFIRMATION_REQUIRED' });
  h.callback(claimEvent(first.code)); assert.equal(h.api.status(principal).status, 'awaiting_confirmation');
  assert.throws(() => h.callback(claimEvent(first.code, 'other-event')), { code: 'INVALID_LINK_CODE' });
  const state = h.api.status(principal);
  const confirmed = h.api.confirmLink(principal, { linkId: state.linkId, commandId: 'confirm', expectedRevision: state.revision });
  assert.equal(confirmed.link.status, 'fixture_linked'); assert.equal(confirmed.link.connected, false); assert.equal(confirmed.link.externalDelivery, 'not_attempted');
});

test('expired code, signature mutation, Unicode signature and group events fail closed', t => {
  const h = setup(t); const first = h.api.beginLink(principal, { commandId: 'begin' }); h.advance(300001);
  assert.equal(h.api.status(principal).status, 'expired');
  assert.throws(() => h.callback(claimEvent(first.code)), { code: 'LINK_EXPIRED' });
  const body = Buffer.from(JSON.stringify(claimEvent(first.code))), timestamp = String(1792773300001);
  assert.throws(() => h.api.receiveCallback(body, { timestamp, signature: 'sha256=' + 'f'.repeat(64) }), { code: 'INVALID_CALLBACK_SIGNATURE' });
  assert.throws(() => h.api.receiveCallback(body, { timestamp, signature: 'sha256=' + 'á'.repeat(64) }), { code: 'INVALID_CALLBACK_SIGNATURE' });
  assert.throws(() => h.callback({ ...claimEvent(first.code), direct: false }), { code: 'INVALID_CHANNEL_EVENT' });
});

test('replay and payload conflict are explicit, revocation invalidates receipts and resume', t => {
  const h = setup(t); const first = link(h);
  assert.equal(h.callback(claimEvent(first.code)).replay, true);
  assert.throws(() => h.callback({ ...claimEvent(first.code), code: 'different' }), { code: 'EVENT_CONFLICT' });
  const event = { eventId: 'resume-1', type: 'session.resume', channelId: 'synthetic-01@channel.test', direct: true, fromSelf: false, sessionId: 'owned-session' };
  const result = h.callback(event); assert.equal(result.resume.messageCount, 5); assert.equal(result.resume.revision, 7); assert.equal(result.resume.requiresAccountLogin, true); assert.equal(result.externalDelivery, 'not_attempted');
  assert.equal(h.callback(event).replay, true);
  h.denyAccess(); assert.throws(() => h.callback(event), { code: 'SESSION_NOT_FOUND' });
  const state = h.api.status(principal); h.api.revokeLink(principal, { commandId: 'revoke', expectedRevision: state.revision });
  assert.equal(h.api.status(principal).status, 'revoked'); assert.throws(() => h.callback(claimEvent(first.code)), { code: 'LINK_INACTIVE' });
  assert.throws(() => h.callback({ ...event, eventId: 'new-resume' }), { code: 'LINK_INACTIVE' });
});

test('a channel cannot be linked to two accounts and session access is owner scoped', t => {
  const h = setup(t); link(h);
  const secondCode = h.api.beginLink(second, { commandId: 'begin-second' });
  assert.throws(() => h.callback(claimEvent(secondCode.code, 'claim-second')), { code: 'CHANNEL_ALREADY_LINKED' });
  const state = h.api.status(principal);
  assert.throws(() => h.api.confirmLink(second, { linkId: state.linkId, commandId: 'steal', expectedRevision: 1 }), { code: 'LINK_NOT_FOUND' });
  assert.throws(() => h.callback({ eventId: 'wrong-session', type: 'session.resume', channelId: 'synthetic-01@channel.test', direct: true, fromSelf: false, sessionId: 'foreign-session' }), { code: 'SESSION_NOT_FOUND' });
});

test('old command receipts never restore a revoked link or an expired/consumed code', t => {
  const h = setup(t, { mode: 'bridge' }); const first = link(h);
  assert.equal(h.api.status(principal).connected, true);
  const consumed = h.api.beginLink(principal, { commandId: 'begin' });
  assert.equal(consumed.code, undefined); assert.equal(consumed.link.status, 'linked');
  h.api.revokeLink(principal, { commandId: 'revoke', expectedRevision: 3 });
  const confirmedReplay = h.api.confirmLink(principal, { linkId: first.link.linkId, commandId: 'confirm', expectedRevision: 2 });
  assert.equal(confirmedReplay.link.status, 'revoked'); assert.equal(confirmedReplay.link.connected, false);
  const oldBegin = h.api.beginLink(principal, { commandId: 'begin' }); assert.equal(oldBegin.code, undefined);
  const next = h.api.beginLink(principal, { commandId: 'next', expectedRevision: 4 }); h.advance(300001);
  const expired = h.api.beginLink(principal, { commandId: 'next', expectedRevision: 4 });
  assert.equal(expired.link.status, 'expired'); assert.equal(expired.code, undefined); assert.equal(expired.link.linkId, next.link.linkId);
  assert.throws(() => h.api.beginLink(principal, { commandId: 'next', expectedRevision: 5 }), { code: 'IDEMPOTENCY_CONFLICT' });
});

test('bridge configuration loss cannot claim connection and resume replay reads current state', t => {
  let revision = 5;
  const h = setup(t, { mode: 'bridge', resolveSession: (owner, id) => ({ id, revision, status: 'paused', messages: [] }) }); link(h);
  const missingBridge = createWhatsAppAdapter({ store: h.store, mode: 'bridge', accountAuthAvailable: true });
  assert.equal(missingBridge.status(principal).connected, false); assert.equal(missingBridge.status(principal).reason, 'BRIDGE_UNAVAILABLE');
  const event = { eventId: 'resume-updated', type: 'session.resume', channelId: 'synthetic-01@channel.test', direct: true, fromSelf: false, sessionId: 'owned-session' };
  assert.equal(h.callback(event).resume.revision, 5); revision = 8;
  assert.equal(h.callback(event).resume.revision, 8);
});

test('additive SQLite store survives restart and rolls back partial mutations', () => {
  const directory = mkdtempSync(join(tmpdir(), 'frontline-integration-test-')), path = join(directory, 'store.sqlite');
  let db = new DatabaseSync(path);
  try {
    db.exec('CREATE TABLE untouched(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO untouched(value) VALUES(\'preserved\')');
    let store = createIntegrationStore(db); store.set('sample', 'stable', { value: 1 });
    assert.throws(() => store.transaction(() => { store.set('sample', 'unstable', { value: 2 }); throw Error('rollback'); }));
    assert.equal(store.get('sample', 'unstable'), null); db.close(); db = new DatabaseSync(path); store = createIntegrationStore(db);
    assert.deepEqual(store.get('sample', 'stable'), { value: 1 }); assert.equal(db.prepare('SELECT value FROM untouched').get().value, 'preserved');
  } finally { db.close(); assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('frontline-integration-test-')); rmSync(directory, { recursive: true, force: true }); }
});
