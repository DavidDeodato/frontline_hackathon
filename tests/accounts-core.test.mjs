import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { openStore } from '../server/store.mjs';
import { baseScenario, newSession } from '../server/engine.mjs';
import { createAccounts, accountEnvelope, migrateAccounts } from '../server/accounts/index.mjs';

// Synthetic accounts, emails and passwords; no external services or real users.
const PASSWORD = 'synthetic-test-password-2026';
const body = (email = 'person@example.test') => ({ name: 'Pessoa Sintética', email, password: PASSWORD });
const cookie = result => result.setCookies[0].split(';')[0];
const errorCode = code => error => error?.code === code;
function setup(t, options = {}) {
  const store = openStore(':memory:'); t.after(() => store.close());
  return { store, accounts: createAccounts({ db: store.db, ...options }) };
}
function guestWithData(store) {
  const guest = store.identity();
  const draft = baseScenario(); draft.id = randomUUID(); draft.state = 'draft';
  store.saveDraftResult(guest.owner, draft, { body: { commandId: randomUUID() }, scope: 'create', operation: 'draft.create', requestText: 'Relato sintético.' });
  store.publish(guest.owner, draft);
  const session = newSession(draft, 'fixture');
  store.transaction(() => store.insertSession(guest.owner, session));
  return { ...guest, draft, session, header: `frontline_guest=${guest.token}` };
}

test('registration stores salted scrypt and hashed session tokens; public envelope exposes no auth internals', async t => {
  const { store, accounts } = setup(t, { secureCookies: true });
  const first = await accounts.register(body(' FIRST@EXAMPLE.TEST '));
  const second = await accounts.register(body('second@example.test'));
  const rows = store.db.prepare('SELECT * FROM users ORDER BY email').all();
  assert.equal(first.user.email, 'first@example.test');
  assert.equal(first.owner, `user:${first.user.id}`);
  assert.match(rows[0].password_hash, /^scrypt\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  assert.notEqual(rows[0].password_hash, rows[1].password_hash);
  assert.ok(!JSON.stringify(rows).includes(PASSWORD));
  const storedSession = store.db.prepare('SELECT token_hash FROM account_sessions WHERE user_id=?').get(first.user.id);
  assert.notEqual(storedSession.token_hash, cookie(first).split('=')[1]);
  assert.match(first.setCookies[0], /HttpOnly; SameSite=Lax; Secure; Max-Age=604800/);
  assert.match(first.setCookies[1], /^frontline_guest=;.*Max-Age=0$/);
  assert.deepEqual(accountEnvelope(first), { authenticated: true, user: first.user });
  assert.deepEqual(accountEnvelope(null), { authenticated: false, user: null });
  assert.deepEqual(accounts.resolve(cookie(second)).user, second.user);
  migrateAccounts(store.db); // Idempotent migration preserves the sessions.
  assert.equal(accounts.resolve(cookie(first)).user.id, first.user.id);
});

test('wrong password and unknown account return the same generic credential error', async t => {
  const { accounts } = setup(t);
  await accounts.register(body());
  const errors = [];
  for (const input of [{ email: 'person@example.test', password: 'wrong-password' }, { email: 'absent@example.test', password: 'wrong-password' }]) {
    try { await accounts.login(input); assert.fail('must reject'); } catch (error) { errors.push({ code: error.code, status: error.status, message: error.message }); }
  }
  assert.deepEqual(errors[0], errors[1]);
  assert.equal(errors[0].status, 401);
  assert.equal(errors[0].code, 'INVALID_CREDENTIALS');
});

test('login rotates the current token and accepts normalized email without claiming a guest', async t => {
  const { store, accounts } = setup(t);
  const original = await accounts.register(body());
  const guest = guestWithData(store);
  const next = await accounts.login({ email: ' PERSON@EXAMPLE.TEST ', password: PASSWORD }, { cookie: `${cookie(original)}; ${guest.header}` });
  assert.notEqual(cookie(original), cookie(next));
  assert.throws(() => accounts.resolve(cookie(original)), errorCode('ACCOUNT_SESSION_INVALID'));
  assert.equal(accounts.resolve(cookie(next)).user.id, original.user.id);
  assert.equal(store.library(next.owner).sessions.length, 0);
  assert.equal(store.getSession(guest.session.id, guest.owner).id, guest.session.id);
});

test('registration atomically claims guest exercises, versions and receipts without rewriting snapshots', async t => {
  const { store, accounts } = setup(t);
  const guest = guestWithData(store), other = guestWithData(store);
  store.db.exec('CREATE TABLE help_conversations(id TEXT PRIMARY KEY,owner TEXT NOT NULL UNIQUE,data TEXT);');
  store.db.prepare('INSERT INTO help_conversations VALUES(?,?,?)').run('help-1', guest.owner, 'synthetic help');
  const before = JSON.stringify(store.getSession(guest.session.id, guest.owner));
  const result = await accounts.register(body(), guest.owner, { cookie: guest.header });
  for (const table of ['drafts', 'scenarios', 'sessions', 'draft_versions', 'draft_commands', 'help_conversations']) {
    assert.equal(store.db.prepare(`SELECT count(*) n FROM ${table} WHERE owner=?`).get(guest.owner).n, 0, table);
    assert.ok(store.db.prepare(`SELECT count(*) n FROM ${table} WHERE owner=?`).get(result.owner).n >= 1, table);
  }
  assert.equal(JSON.stringify(store.getSession(guest.session.id, result.owner)), before);
  assert.equal(store.draftVersions(result.owner, guest.draft.id)[0].version, 1);
  assert.equal(store.db.prepare('SELECT count(*) n FROM guests WHERE hash=?').get(guest.owner).n, 0);
  assert.throws(() => store.getSession(guest.session.id, guest.owner), errorCode('NOT_FOUND'));
  assert.equal(store.getSession(other.session.id, other.owner).id, other.session.id);
  assert.ok(store.db.prepare("SELECT count(*) n FROM scenarios WHERE owner='*'").get().n >= 1);
});

test('claim failure rolls back the user, session and every ownership change', async t => {
  const { store, accounts } = setup(t); const guest = guestWithData(store);
  store.db.exec("CREATE TRIGGER account_test_claim_failure BEFORE UPDATE OF owner ON sessions BEGIN SELECT RAISE(ABORT,'synthetic claim failure'); END;");
  await assert.rejects(accounts.register(body(), guest.owner), /synthetic claim failure/);
  assert.equal(store.db.prepare('SELECT count(*) n FROM users').get().n, 0);
  assert.equal(store.db.prepare('SELECT count(*) n FROM account_sessions').get().n, 0);
  assert.equal(store.getDraft(guest.owner, guest.draft.id).id, guest.draft.id);
  assert.equal(store.getSession(guest.session.id, guest.owner).id, guest.session.id);
  assert.ok(store.db.prepare('SELECT hash FROM guests WHERE hash=?').get(guest.owner));
});

test('concurrent duplicate email yields one account; rejected registration leaves guest data intact', async t => {
  const { store, accounts } = setup(t);
  const results = await Promise.allSettled([accounts.register(body()), accounts.register(body('PERSON@example.test'))]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'ACCOUNT_UNAVAILABLE');
  const guest = guestWithData(store);
  await assert.rejects(accounts.register(body(), guest.owner), errorCode('ACCOUNT_UNAVAILABLE'));
  assert.equal(store.getSession(guest.session.id, guest.owner).id, guest.session.id);
  assert.equal(store.db.prepare('SELECT count(*) n FROM users').get().n, 1);
});

test('two concurrent registrations cannot both claim the same guest', async t => {
  const { store, accounts } = setup(t); const guest = guestWithData(store);
  const results = await Promise.allSettled([accounts.register(body('a@example.test'), guest.owner), accounts.register(body('b@example.test'), guest.owner)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'GUEST_IDENTITY_CHANGED');
  assert.equal(store.db.prepare('SELECT count(*) n FROM users').get().n, 1);
});

test('malformed, duplicate, unknown and expired account cookies reject instead of falling back to guest', async t => {
  let clock = Date.UTC(2026, 9, 23); const { store, accounts } = setup(t, { now: () => clock });
  const session = await accounts.register(body()), guest = store.identity();
  assert.equal(accounts.resolve(`frontline_guest=${guest.token}`), null);
  for (const bad of ['frontline_account', 'frontline_account=', 'frontline_account=%zz', 'frontline_account=abc', `frontline_account=${'a'.repeat(64)}`, `${cookie(session)}; ${cookie(session)}`]) {
    assert.throws(() => accounts.resolve(`${bad}; frontline_guest=${guest.token}`), errorCode('ACCOUNT_SESSION_INVALID'), bad);
  }
  clock += 7 * 24 * 3600 * 1000 + 1;
  assert.throws(() => accounts.resolve(cookie(session)), errorCode('ACCOUNT_SESSION_INVALID'));
  assert.equal(store.db.prepare('SELECT count(*) n FROM account_sessions').get().n, 0);
});

test('logout revokes even duplicate valid tokens, clears both cookies, and cannot expose another user', async t => {
  const { accounts, store } = setup(t);
  const first = await accounts.register(body('a@example.test'));
  const second = await accounts.register(body('b@example.test'));
  const ended = accounts.logout(`${cookie(first)}; ${cookie(first)}; frontline_guest=${'f'.repeat(64)}`);
  assert.deepEqual(accountEnvelope(ended), { authenticated: false, user: null });
  assert.equal(ended.setCookies.length, 2);
  assert.ok(ended.setCookies.every(value => value.includes('Max-Age=0') && value.includes('HttpOnly')));
  assert.throws(() => accounts.resolve(cookie(first)), errorCode('ACCOUNT_SESSION_INVALID'));
  assert.equal(accounts.resolve(cookie(second)).user.id, second.user.id);
  const guest = store.identity(); assert.equal(store.library(guest.owner).sessions.length, 0);
  assert.deepEqual(accountEnvelope(accounts.logout('frontline_account=malformed')), { authenticated: false, user: null });
});

test('input validation enforces name/email/password limits and prevents claiming an account owner', async t => {
  const { accounts } = setup(t);
  const invalid = [
    [{ ...body('name@example.test'), name: 'x' }, 'INVALID_NAME'],
    [{ ...body('email@example.test'), email: 'bad@@example.test' }, 'INVALID_EMAIL'],
    [{ ...body('short@example.test'), password: 'short' }, 'INVALID_PASSWORD'],
    [{ ...body('long@example.test'), password: 'x'.repeat(129) }, 'INVALID_PASSWORD']
  ];
  for (let i = 0; i < invalid.length; i++) await assert.rejects(accounts.register(invalid[i][0], undefined, { rateKey: `validation-${i}` }), errorCode(invalid[i][1]));
  await assert.rejects(accounts.register(body('claim@example.test'), 'user:other', { rateKey: 'claim' }), errorCode('GUEST_IDENTITY_CHANGED'));
});

test('login and registration rate limits persist in SQLite and expire at the injected clock', async t => {
  let clock = 1000000; const { accounts, store } = setup(t, { now: () => clock });
  for (let i = 0; i < 5; i++) await assert.rejects(accounts.login({ email: 'none@example.test', password: 'wrong-password' }, { rateKey: `client-${i}` }), errorCode('INVALID_CREDENTIALS'));
  const nextInstance = createAccounts({ db: store.db, now: () => clock });
  await assert.rejects(nextInstance.login({ email: 'none@example.test', password: 'wrong-password' }, { rateKey: 'new-client' }), error => error.code === 'ACCOUNT_RATE_LIMIT' && error.retryAfter > 0);
  for (let i = 0; i < 5; i++) await assert.rejects(accounts.register({ ...body(`bad-${i}@example.test`), name: '' }, undefined, { rateKey: 'registration-client' }), errorCode('INVALID_NAME'));
  await assert.rejects(accounts.register(body('last@example.test'), undefined, { rateKey: 'registration-client' }), errorCode('ACCOUNT_RATE_LIMIT'));
  clock += 15 * 60 * 1000 + 1;
  await assert.rejects(nextInstance.login({ email: 'none@example.test', password: 'wrong-password' }, { rateKey: 'new-client' }), errorCode('INVALID_CREDENTIALS'));
});

test('accounts, ownership and revocation persist after closing and reopening the database', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'frontline-accounts-test-'));
  const path = join(directory, 'accounts.sqlite'); let store;
  try {
    store = openStore(path); let accounts = createAccounts({ db: store.db });
    const guest = guestWithData(store), registered = await accounts.register(body(), guest.owner);
    store.close(); store = openStore(path); accounts = createAccounts({ db: store.db });
    assert.equal(accounts.resolve(cookie(registered)).owner, registered.owner);
    assert.equal(store.getSession(guest.session.id, registered.owner).id, guest.session.id);
    accounts.logout(cookie(registered)); store.close(); store = openStore(path); accounts = createAccounts({ db: store.db });
    assert.throws(() => accounts.resolve(cookie(registered)), errorCode('ACCOUNT_SESSION_INVALID'));
    const fresh = await accounts.login(body()); assert.equal(fresh.user.id, registered.user.id);
  } finally {
    store?.close();
    // Only the temporary test directory created above; no recursive deletion.
    for (const filename of readdirSync(directory)) unlinkSync(join(directory, filename));
    rmdirSync(directory);
  }
});

test('an account session survives a real Node process replacement using the same database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'frontline-accounts-process-test-'));
  const databasePath = join(directory, 'accounts.sqlite');
  const storeModule = new URL('../server/store.mjs', import.meta.url).href;
  const accountsModule = new URL('../server/accounts/index.mjs', import.meta.url).href;
  const program = `
    import {readFileSync} from 'node:fs';
    import {openStore} from ${JSON.stringify(storeModule)};
    import {createAccounts} from ${JSON.stringify(accountsModule)};
    const input=JSON.parse(readFileSync(0,'utf8'));
    const store=openStore(input.databasePath),accounts=createAccounts({db:store.db});
    try {
      if(input.operation==='create') {
        const result=await accounts.register({name:'Processo Sintético',email:'process@example.test',password:'synthetic-process-password'});
        process.stdout.write(JSON.stringify({pid:process.pid,userId:result.user.id,cookie:result.setCookies[0].split(';')[0]}));
      } else {
        const result=accounts.resolve(input.cookie);
        process.stdout.write(JSON.stringify({pid:process.pid,userId:result.user.id}));
      }
    } finally {store.close();}
  `;
  try {
    const run = input => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', program], { cwd: new URL('..', import.meta.url), input: JSON.stringify({ databasePath, ...input }), encoding: 'utf8', timeout: 15000 }));
    const first = run({ operation: 'create' }), second = run({ operation: 'resolve', cookie: first.cookie });
    assert.notEqual(first.pid, second.pid);
    assert.equal(first.userId, second.userId);
  } finally {
    for (const filename of readdirSync(directory)) unlinkSync(join(directory, filename));
    rmdirSync(directory);
  }
});
