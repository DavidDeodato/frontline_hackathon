import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../server/store.mjs';
import { baseScenario, newSession, AppError } from '../server/engine.mjs';
import { createAccounts, createAccountHttpHandler } from '../server/accounts/index.mjs';

// Offline request/response adapter tests. Full HTTP integration belongs to the
// createApp owner; these tests do not start the product server or make network calls.
const input = { name: 'Conta Sintética', email: 'synthetic@example.test', password: 'synthetic-password-2026' };
const code = wanted => error => error?.code === wanted;
function setup(t, options = {}) {
  const store = openStore(':memory:'); t.after(() => store.close());
  const accounts = createAccounts({ db: store.db, ...options });
  let maximum;
  const handler = createAccountHttpHandler({ accounts, store, readBody: async (req, cap) => {
    maximum = cap;
    if (req.badBody) throw new AppError(400, 'INVALID_JSON', 'JSON inválido.');
    return req.body ?? {};
  } });
  async function request(path, { method = 'GET', cookie = '', body, badBody } = {}) {
    const headers = new Map();
    const output = await handler({ method, headers: { cookie }, socket: { remoteAddress: '127.0.0.1' }, body, badBody }, { setHeader: (key, value) => headers.set(key.toLowerCase(), value) }, new URL(path, 'http://synthetic.local'));
    return { ...output, headers, maximum };
  }
  return { store, accounts, handler, request };
}

test('guest account status is false without creating a guest or exposing owner internals', async t => {
  const { request, store } = setup(t);
  assert.deepEqual((await request('/api/account')).output, { authenticated: false, user: null });
  assert.equal(store.db.prepare('SELECT count(*) n FROM guests').get().n, 0);
  assert.deepEqual(await request('/api/library'), { handled: false, headers: new Map(), maximum: undefined });
});

test('register adapter claims the current guest and returns only the public envelope with two cookies', async t => {
  const { store, request } = setup(t);
  const guest = store.identity(), scenario = baseScenario(), session = newSession(scenario, 'fixture');
  store.transaction(() => store.insertSession(guest.owner, session));
  const result = await request('/api/account/register', { method: 'POST', cookie: `frontline_guest=${guest.token}`, body: input });
  assert.equal(result.maximum, 8192);
  assert.equal(result.handled, true);
  assert.deepEqual(Object.keys(result.output).sort(), ['authenticated', 'user']);
  assert.deepEqual(Object.keys(result.output.user).sort(), ['email', 'id', 'name']);
  assert.equal(result.output.authenticated, true);
  const cookies = result.headers.get('set-cookie'); assert.equal(cookies.length, 2);
  const authenticated = await request('/api/account', { cookie: cookies[0].split(';')[0] });
  assert.deepEqual(authenticated.output, result.output);
  assert.equal(store.getSession(session.id, `user:${result.output.user.id}`).id, session.id);
  assert.throws(() => store.getSession(session.id, guest.owner), code('NOT_FOUND'));
  assert.ok(!JSON.stringify(result.output).includes('password'));
  assert.ok(!JSON.stringify(result.output).includes('owner'));
});

test('invalid account cookie cannot fall through to guest; login and logout are explicit recovery routes', async t => {
  const { accounts, store, request } = setup(t);
  await accounts.register(input);
  const guest = store.identity();
  const invalidCookie = `frontline_account=invalid; frontline_guest=${guest.token}`;
  await assert.rejects(request('/api/account', { cookie: invalidCookie }), code('ACCOUNT_SESSION_INVALID'));
  await assert.rejects(request('/api/account/register', { method: 'POST', cookie: invalidCookie, body: { ...input, email: 'second@example.test' } }), code('ACCOUNT_SESSION_INVALID'));
  assert.equal(store.db.prepare('SELECT count(*) n FROM users').get().n, 1);
  const login = await request('/api/account/login', { method: 'POST', cookie: invalidCookie, body: input });
  assert.equal(login.output.authenticated, true);
  const accountCookie = login.headers.get('set-cookie')[0].split(';')[0];
  const logout = await request('/api/account/logout', { method: 'POST', cookie: accountCookie, body: {} });
  assert.deepEqual(logout.output, { authenticated: false, user: null });
  assert.ok(logout.headers.get('set-cookie').every(value => value.endsWith('Max-Age=0')));
  await assert.rejects(request('/api/account', { cookie: accountCookie }), code('ACCOUNT_SESSION_INVALID'));
  assert.deepEqual((await request('/api/account')).output, { authenticated: false, user: null });
});

test('register while authenticated rejects without creating or adopting a different identity', async t => {
  const { accounts, request, store } = setup(t);
  const existing = await accounts.register(input);
  await assert.rejects(request('/api/account/register', { method: 'POST', cookie: existing.setCookies[0].split(';')[0], body: { ...input, email: 'new@example.test' } }), code('ALREADY_AUTHENTICATED'));
  assert.equal(store.db.prepare('SELECT count(*) n FROM users').get().n, 1);
  assert.equal(store.db.prepare('SELECT count(*) n FROM guests').get().n, 0);
});

test('rate-limited adapter supplies Retry-After and does not disclose credential data', async t => {
  const { handler } = setup(t);
  const req = { method: 'POST', headers: {}, socket: { remoteAddress: '127.0.0.1' }, body: { email: 'synthetic@example.test', password: 'short' } };
  const headers = new Map(), res = { setHeader: (name, value) => headers.set(name, value) };
  for (let i = 0; i < 5; i++) await assert.rejects(handler(req, res, '/api/account/login'), code('INVALID_CREDENTIALS'));
  await assert.rejects(handler(req, res, '/api/account/login'), code('ACCOUNT_RATE_LIMIT'));
  assert.ok(Number(headers.get('Retry-After')) > 0);
  assert.equal(headers.has('Set-Cookie'), false);
});

test('method and body errors have no partial account or ownership effect', async t => {
  const { request, store } = setup(t);
  await assert.rejects(request('/api/account/login'), code('METHOD_NOT_ALLOWED'));
  await assert.rejects(request('/api/account/register', { method: 'POST', badBody: true }), code('INVALID_JSON'));
  assert.equal(store.db.prepare('SELECT count(*) n FROM users').get().n, 0);
  assert.equal(store.db.prepare('SELECT count(*) n FROM guests').get().n, 0);
});

test('two authenticated accounts remain isolated across library and session reads', async t => {
  const { store, accounts } = setup(t);
  const aGuest = store.identity(), bGuest = store.identity();
  const aSession = newSession(baseScenario(), 'fixture'), bSession = newSession(baseScenario(), 'fixture');
  store.transaction(() => { store.insertSession(aGuest.owner, aSession); store.insertSession(bGuest.owner, bSession); });
  const a = await accounts.register(input, aGuest.owner);
  const b = await accounts.register({ ...input, email: 'second@example.test' }, bGuest.owner);
  assert.deepEqual(store.library(a.owner).sessions.map(item => item.id), [aSession.id]);
  assert.deepEqual(store.library(b.owner).sessions.map(item => item.id), [bSession.id]);
  assert.throws(() => store.getSession(bSession.id, a.owner), code('NOT_FOUND'));
  assert.throws(() => store.getSession(aSession.id, b.owner), code('NOT_FOUND'));
});
