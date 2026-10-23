import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { AppError } from '../engine.mjs';

const derive = promisify(scrypt);
const KDF = Object.freeze({ N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
const PREFIX = 'scrypt$32768$8$3$';
const COOKIE_NAME = 'frontline_account';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const digest = text => createHash('sha256').update(text).digest('hex');
const publicUser = row => ({ id: row.id, name: row.name, email: row.email });
const reject = (status, code, message) => { throw new AppError(status, code, message); };
const invalidSession = () => reject(401, 'ACCOUNT_SESSION_INVALID', 'Sua sessão expirou ou não é válida. Entre novamente ou saia para continuar como visitante.');

function accountToken(cookie) {
  if (cookie === undefined || cookie === null || cookie === '') return null;
  if (typeof cookie !== 'string' || cookie.length > 16384) return invalidSession();
  const values = [];
  for (const part of cookie.split(';')) {
    const pair = part.trim(), separator = pair.indexOf('=');
    const name = separator < 0 ? pair : pair.slice(0, separator).trim();
    if (name === COOKIE_NAME) values.push(separator < 0 ? '' : pair.slice(separator + 1));
  }
  if (!values.length) return null;
  if (values.length !== 1 || !/^[a-f0-9]{64}$/.test(values[0])) return invalidSession();
  return values[0];
}

function validEmail(value) {
  if (typeof value !== 'string') reject(422, 'INVALID_EMAIL', 'Informe um email válido.');
  const email = value.trim().toLowerCase();
  const pieces = email.split('@');
  if (email.length > 254 || pieces.length !== 2 || pieces[0].length > 64 || !pieces[0] || pieces[0].startsWith('.') || pieces[0].endsWith('.') || pieces[0].includes('..') ||
      !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(email)) reject(422, 'INVALID_EMAIL', 'Informe um email válido.');
  return email;
}

function validPassword(password) {
  if (typeof password !== 'string' || [...password].length < 10 || [...password].length > 128 || Buffer.byteLength(password, 'utf8') > 512) reject(422, 'INVALID_PASSWORD', 'Use uma senha entre 10 e 128 caracteres.');
  return password;
}

function validName(value) {
  if (typeof value !== 'string') reject(422, 'INVALID_NAME', 'Informe seu nome, entre 2 e 80 caracteres.');
  const name = value.trim().normalize('NFC');
  if ([...name].length < 2 || [...name].length > 80 || /[\u0000-\u001f\u007f]/.test(name)) reject(422, 'INVALID_NAME', 'Informe seu nome, entre 2 e 80 caracteres.');
  return name;
}

async function passwordHash(password) {
  const salt = randomBytes(16), key = await derive(password, salt, 64, KDF);
  return PREFIX + salt.toString('hex') + '$' + key.toString('hex');
}

async function passwordMatches(password, stored, dummy) {
  const valid = typeof stored === 'string' && /^scrypt\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(stored);
  const source = valid ? stored : dummy;
  const [, , , , salt, expected] = source.split('$');
  const key = await derive(password, Buffer.from(salt, 'hex'), 64, KDF);
  return timingSafeEqual(key, Buffer.from(expected, 'hex')) && valid;
}

/** Additive schema, on the same SQLite connection used by the exercise store. */
export function migrateAccounts(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS account_sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS account_sessions_user ON account_sessions(user_id);
  CREATE TABLE IF NOT EXISTS account_attempts (
    bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL
  );`);
}

/** Internal return values carry cookies; only accountEnvelope belongs in JSON. */
export function createAccounts({ db, secureCookies = false, now = Date.now } = {}) {
  if (!db?.prepare || !db?.exec || typeof now !== 'function') throw new TypeError('createAccounts requires an open SQLite database and a clock function.');
  migrateAccounts(db);
  const dummyHash = PREFIX + randomBytes(16).toString('hex') + '$' + randomBytes(64).toString('hex');
  const time = () => { const value = Number(now()); if (!Number.isFinite(value)) throw new TypeError('Invalid account clock.'); return value; };
  const cookie = (name, value, seconds) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax${secureCookies ? '; Secure' : ''}; Max-Age=${seconds}`;
  const clearCookies = () => [cookie(COOKIE_NAME, '', 0), cookie('frontline_guest', '', 0)];
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };

  function consumeRate(action, email, rateKey = 'local') {
    const at = time();
    const client = typeof rateKey === 'string' && rateKey.length <= 256 ? rateKey : 'local';
    const checks = [
      { bucket: digest(`${action}:client:${client}`), max: action === 'login' ? 20 : 5 },
      { bucket: digest(`${action}:email:${email}`), max: action === 'login' ? 5 : 3 }
    ];
    transaction(() => {
      db.prepare('DELETE FROM account_attempts WHERE reset_at<=?').run(at);
      for (const check of checks) {
        const row = db.prepare('SELECT count,reset_at FROM account_attempts WHERE bucket=?').get(check.bucket);
        if (row && row.count >= check.max) {
          const error = new AppError(429, 'ACCOUNT_RATE_LIMIT', 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.');
          error.retryAfter = Math.max(1, Math.ceil((row.reset_at - at) / 1000));
          throw error;
        }
      }
      for (const { bucket } of checks) db.prepare('INSERT INTO account_attempts VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1').run(bucket, at + WINDOW_MS);
    });
  }

  function resolve(cookieHeader) {
    const token = accountToken(cookieHeader);
    if (!token) return null;
    const tokenHash = digest(token);
    const row = db.prepare('SELECT u.id,u.name,u.email,s.expires_at FROM account_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?').get(tokenHash);
    if (!row || row.expires_at <= time()) {
      if (row) db.prepare('DELETE FROM account_sessions WHERE token_hash=?').run(tokenHash);
      return invalidSession();
    }
    return { user: publicUser(row), owner: `user:${row.id}` };
  }

  function revokePrevious(cookieHeader) {
    // Login/logout are explicit recovery routes: malformed cookies are cleared,
    // never interpreted as permission to read or claim a visitor's history.
    if (typeof cookieHeader !== 'string' || cookieHeader.length > 16384) return;
    for (const part of cookieHeader.split(';')) {
      const match = /^frontline_account=([a-f0-9]{64})$/.exec(part.trim());
      if (match) db.prepare('DELETE FROM account_sessions WHERE token_hash=?').run(digest(match[1]));
    }
  }

  function createSession(user, cookieHeader) {
    const at = time();
    revokePrevious(cookieHeader);
    db.prepare('DELETE FROM account_sessions WHERE expires_at<=?').run(at);
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO account_sessions VALUES(?,?,?,?)').run(digest(token), user.id, at + SESSION_MS, at);
    return { user: publicUser(user), owner: `user:${user.id}`, setCookies: [cookie(COOKIE_NAME, token, SESSION_MS / 1000), cookie('frontline_guest', '', 0)] };
  }

  function claimGuest(guestOwner, owner) {
    if (guestOwner === undefined || guestOwner === null) return;
    if (typeof guestOwner !== 'string' || !/^[a-f0-9]{64}$/.test(guestOwner) || !db.prepare('SELECT hash FROM guests WHERE hash=?').get(guestOwner)) reject(409, 'GUEST_IDENTITY_CHANGED', 'A sessão de visitante mudou. Atualize a página antes de criar sua conta.');
    // Whitelist only. JSON snapshots, messages, receipts and version numbers stay
    // unchanged; their ownership is inherited through the existing foreign keys.
    for (const table of ['drafts', 'scenarios', 'sessions', 'draft_versions', 'draft_commands', 'help_conversations']) {
      if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
      db.prepare(`UPDATE ${table} SET owner=? WHERE owner=?`).run(owner, guestOwner);
    }
    db.prepare('DELETE FROM guests WHERE hash=?').run(guestOwner);
  }

  async function register(body, guestOwner, { cookie: cookieHeader, rateKey } = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) reject(422, 'INVALID_ACCOUNT', 'Informe os dados da conta.');
    if (resolve(cookieHeader)) reject(409, 'ALREADY_AUTHENTICATED', 'Saia da conta atual antes de criar outra conta.');
    const rawEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 254) : '';
    consumeRate('register', rawEmail, rateKey);
    const email = validEmail(body.email), name = validName(body.name), password = validPassword(body.password);
    const encoded = await passwordHash(password);
    return transaction(() => {
      if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) reject(409, 'ACCOUNT_UNAVAILABLE', 'Não foi possível criar a conta com esses dados. Entre na sua conta ou use outro email.');
      const user = { id: randomUUID(), name, email };
      db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(user.id, name, email, encoded, new Date(time()).toISOString());
      claimGuest(guestOwner, `user:${user.id}`);
      return createSession(user, cookieHeader);
    });
  }

  async function login(body, { cookie: cookieHeader, rateKey } = {}) {
    const rawEmail = typeof body?.email === 'string' ? body.email.trim().toLowerCase().slice(0, 254) : '';
    consumeRate('login', rawEmail, rateKey);
    let email, password;
    try { email = validEmail(body?.email); password = validPassword(body?.password); }
    catch { reject(401, 'INVALID_CREDENTIALS', 'Email ou senha incorretos.'); }
    const row = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (!await passwordMatches(password, row?.password_hash, dummyHash)) reject(401, 'INVALID_CREDENTIALS', 'Email ou senha incorretos.');
    // No guest owner enters this operation, even when guest and account cookies
    // coexist. Logging into an existing account cannot silently merge histories.
    return transaction(() => createSession(row, cookieHeader));
  }

  function logout(cookieHeader) {
    transaction(() => revokePrevious(cookieHeader));
    return { authenticated: false, user: null, setCookies: clearCookies() };
  }

  return { resolve, register, login, logout };
}

export function accountEnvelope(identity) {
  return { authenticated: Boolean(identity?.user), user: identity?.user ? publicUser(identity.user) : null };
}

/** Call after origin validation and BEFORE the legacy store.identity fallback. */
export function createAccountHttpHandler({ accounts, store, readBody }) {
  return async function handleAccount(req, res, url) {
    const path = typeof url === 'string' ? url : url.pathname;
    if (!['/api/account', '/api/account/register', '/api/account/login', '/api/account/logout'].includes(path)) return { handled: false };
    const cookieHeader = req.headers.cookie;
    try {
      let identity;
      if (req.method === 'GET' && path === '/api/account') identity = accounts.resolve(cookieHeader);
      else if (req.method === 'POST' && path === '/api/account/register') {
        const body = await readBody(req, 8192);
        if (accounts.resolve(cookieHeader)) reject(409, 'ALREADY_AUTHENTICATED', 'Saia da conta atual antes de criar outra conta.');
        const guest = store.identity(cookieHeader);
        identity = await accounts.register(body, guest.owner, { cookie: cookieHeader, rateKey: req.socket?.remoteAddress || 'local' });
      } else if (req.method === 'POST' && path === '/api/account/login') {
        identity = await accounts.login(await readBody(req, 8192), { cookie: cookieHeader, rateKey: req.socket?.remoteAddress || 'local' });
      } else if (req.method === 'POST' && path === '/api/account/logout') {
        await readBody(req, 8192);
        identity = accounts.logout(cookieHeader);
      } else reject(405, 'METHOD_NOT_ALLOWED', 'Método não permitido para esta operação.');
      if (identity?.setCookies) res.setHeader('Set-Cookie', identity.setCookies);
      return { handled: true, output: accountEnvelope(identity) };
    } catch (error) {
      if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
      throw error;
    }
  };
}
