import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { AppError, baseScenario, wireSession } from './engine.mjs';
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const hash = x => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(canonical(x))).digest('hex');
export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path); db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;');
  db.exec(`CREATE TABLE IF NOT EXISTS guests(hash TEXT PRIMARY KEY, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS scenarios(id TEXT NOT NULL, version INTEGER NOT NULL, owner TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(id,version));
    CREATE TABLE IF NOT EXISTS drafts(id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, owner TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), seq INTEGER NOT NULL, role TEXT NOT NULL CHECK(role IN ('user','npc','summary')), data TEXT NOT NULL, UNIQUE(session_id,seq));
    CREATE TABLE IF NOT EXISTS commands(session_id TEXT NOT NULL REFERENCES sessions(id), command_id TEXT NOT NULL, payload_hash TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(session_id,command_id));
    CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id), revision INTEGER NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS draft_versions(id TEXT NOT NULL,version INTEGER NOT NULL,owner TEXT NOT NULL,data TEXT NOT NULL,request_text TEXT,created_at TEXT NOT NULL,PRIMARY KEY(id,version));
    CREATE TABLE IF NOT EXISTS draft_commands(owner TEXT NOT NULL,scope TEXT NOT NULL,command_id TEXT NOT NULL,payload_hash TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(owner,scope,command_id));`);
  // Only the surviving legacy snapshot is recoverable. Never invent earlier versions.
  const legacyInsert = db.prepare('INSERT OR IGNORE INTO draft_versions VALUES(?,?,?,?,?,?)');
  for (const row of db.prepare('SELECT * FROM drafts').all()) {
    const draft = JSON.parse(row.data);
    legacyInsert.run(row.id,draft.version,row.owner,row.data,null,new Date().toISOString());
  }
  const base = baseScenario();
  // An older seed is immutable. A corrected calendar gets a new version instead
  // of rewriting a scenario already embedded in historical sessions.
  const previous = db.prepare('SELECT data,version FROM scenarios WHERE id=? AND owner=? ORDER BY version DESC LIMIT 1').get(base.id, '*');
  if (previous) {
    const prior = JSON.parse(previous.data);
    base.version = prior.rules?.clientReturnDays === base.rules.clientReturnDays ? previous.version : previous.version + 1;
    base.policy.version = base.version;
  }
  db.prepare('INSERT OR IGNORE INTO scenarios VALUES (?,?,?,?)').run(base.id, base.version, '*', JSON.stringify(base));
  const q = (sql, ...args) => db.prepare(sql).get(...args);
  function identity(cookie) {
    const token = /(?:^|;\s*)frontline_guest=([a-f0-9]{64})(?:;|$)/.exec(cookie || '')?.[1];
    if (token && q('SELECT hash FROM guests WHERE hash=?', hash(token))) return { owner: hash(token) };
    const fresh = randomBytes(32).toString('hex'); const owner = hash(fresh); db.prepare('INSERT INTO guests VALUES (?,?)').run(owner, new Date().toISOString()); return { owner, token: fresh };
  }
  function getSession(id, owner) { const r = q('SELECT * FROM sessions WHERE id=? AND owner=?', id, owner); if (!r) throw new AppError(404, 'NOT_FOUND', 'Sessão não encontrada.'); return JSON.parse(r.data); }
  function getScenario(id, version, owner) { const r = version === undefined ? q('SELECT data FROM scenarios WHERE id=? AND (owner=? OR owner=?) ORDER BY version DESC LIMIT 1', id, owner, '*') : q('SELECT data FROM scenarios WHERE id=? AND version=? AND (owner=? OR owner=?)', id, version, owner, '*'); if (!r) throw new AppError(404, 'NOT_FOUND', 'Cenário não encontrado.'); return JSON.parse(r.data); }
  function getDraft(owner, id) { const r = q('SELECT data FROM drafts WHERE id=? AND owner=?', id, owner); if (!r) throw new AppError(404, 'NOT_FOUND', 'Rascunho não encontrado.'); return JSON.parse(r.data); }
  function checkDraftVersion(d, expectedVersion, required = false) {
    if (expectedVersion === undefined && !required) return;
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new AppError(422,'INVALID_VERSION','Informe expectedVersion como inteiro positivo.');
    if (d.version !== expectedVersion) throw new AppError(409,'DRAFT_VERSION_CONFLICT','O rascunho mudou. Atualize a prévia antes de continuar.');
  }
  function draftReceipt(owner, scope, body, operation) {
    if (body.commandId === undefined) return {payloadHash:null};
    if (typeof body.commandId !== 'string' || !body.commandId.trim() || body.commandId.length > 200) throw new AppError(422,'INVALID_COMMAND','Informe commandId válido.');
    const payloadHash = hash({operation,body});
    const prior = q('SELECT * FROM draft_commands WHERE owner=? AND scope=? AND command_id=?',owner,scope,body.commandId);
    if (prior && prior.payload_hash !== payloadHash) throw new AppError(409,'IDEMPOTENCY_CONFLICT','Este comando já foi usado com outro conteúdo.');
    return {payloadHash,...(prior ? {result:JSON.parse(prior.result)} : {})};
  }
  function writeDraft(owner,d,requestText) {
    const prior=q('SELECT owner,data FROM drafts WHERE id=?',d.id);
    if(prior && prior.owner!==owner) throw new AppError(404,'NOT_FOUND','Rascunho não encontrado.');
    if(prior && JSON.parse(prior.data).version+1!==d.version) throw new AppError(409,'DRAFT_VERSION_CONFLICT','A próxima versão do rascunho é inválida.');
    const data=JSON.stringify(d);
    db.prepare('INSERT INTO draft_versions VALUES(?,?,?,?,?,?)').run(d.id,d.version,owner,data,requestText ?? null,new Date().toISOString());
    db.prepare('INSERT INTO drafts VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE drafts.owner=excluded.owner').run(d.id,owner,data);
  }
  function saveDraftResult(owner,d,{scope=d.id,body={},operation='draft.save',expectedVersion,requestText}={}) {
    return transaction(()=>{
      const receipt=draftReceipt(owner,scope,body,operation);if(receipt.result)return receipt.result;
      if(expectedVersion!==undefined)checkDraftVersion(getDraft(owner,d.id),expectedVersion,true);
      writeDraft(owner,d,requestText);
      const result={draft:d};
      if(body.commandId!==undefined)db.prepare('INSERT INTO draft_commands VALUES(?,?,?,?,?)').run(owner,scope,body.commandId,receipt.payloadHash,JSON.stringify(result));
      return result;
    });
  }
  function transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; } }
  function saveMessages(s) { db.prepare('DELETE FROM messages WHERE session_id=?').run(s.id); const insert = db.prepare('INSERT INTO messages VALUES(?,?,?,?,?)'); for (const m of s.messages) insert.run(m.id, s.id, m.seq, m.role, JSON.stringify(m)); }
  function insertSession(owner, s) { db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(s.id, owner, s.revision, JSON.stringify(s)); saveMessages(s); db.prepare('INSERT INTO events(session_id,revision,type,data) VALUES(?,?,?,?)').run(s.id, s.revision, 'session.started', JSON.stringify({ parentSessionId: s.parentSessionId || null })); }
  function receipt(s, body, operation) {
    if (typeof body.commandId !== 'string' || !body.commandId.trim() || body.commandId.length > 200 || !Number.isInteger(body.expectedRevision)) throw new AppError(422, 'INVALID_COMMAND', 'Informe commandId e expectedRevision.');
    const payloadHash = hash({ operation, body }); const old = q('SELECT * FROM commands WHERE session_id=? AND command_id=?', s.id, body.commandId);
    if (old) { if (old.payload_hash !== payloadHash) throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Este comando já foi usado com outro conteúdo.', wireSession(s)); return { result: JSON.parse(old.result), payloadHash }; }
    if (s.revision !== body.expectedRevision) throw new AppError(409, 'REVISION_CONFLICT', 'A sessão mudou. Atualize antes de tentar novamente.', wireSession(s));
    return { payloadHash };
  }
  function commit(owner, before, after, body, payloadHash, type, branch) {
    return transaction(() => {
      const current = getSession(before.id, owner); const previous = receipt(current, body, type); if (previous.result) return previous.result;
      if (current.revision !== before.revision) throw new AppError(409, 'REVISION_CONFLICT', 'A sessão mudou durante o processamento.', wireSession(current));
      if (branch) insertSession(owner, branch);
      else { after.revision = before.revision + 1; after.updatedAt = new Date().toISOString(); const result = db.prepare('UPDATE sessions SET revision=?,data=? WHERE id=? AND owner=? AND revision=?').run(after.revision, JSON.stringify(after), before.id, owner, before.revision); if (!result.changes) throw new AppError(409, 'REVISION_CONFLICT', 'A sessão mudou.'); saveMessages(after); }
      const result = { session: wireSession(branch || after) };
      db.prepare('INSERT INTO commands VALUES(?,?,?,?)').run(before.id, body.commandId, payloadHash, JSON.stringify(result));
      db.prepare('INSERT INTO events(session_id,revision,type,data) VALUES(?,?,?,?)').run(before.id, branch ? before.revision : after.revision, type, JSON.stringify({ commandId: body.commandId, branchId: branch?.id || null }));
      return result;
    });
  }
  return { db, identity, getSession, getScenario, getDraft, checkDraftVersion, draftReceipt, saveDraftResult, transaction, insertSession, receipt, commit,
    library(owner) { return { scenarios: db.prepare('SELECT data FROM scenarios WHERE owner=? OR owner=? ORDER BY id, version DESC').all(owner, '*').map(r => JSON.parse(r.data)), sessions: db.prepare('SELECT data FROM sessions WHERE owner=? ORDER BY rowid DESC LIMIT 100').all(owner).map(r => wireSession(JSON.parse(r.data))) }; },
    saveDraft(owner, d) { return saveDraftResult(owner,d); },
    draftVersions(owner,id) { getDraft(owner,id);return db.prepare('SELECT * FROM draft_versions WHERE id=? AND owner=? ORDER BY version DESC').all(id,owner).map(r=>({version:r.version,createdAt:r.created_at,...(r.request_text!==null?{requestText:r.request_text}:{}),draft:JSON.parse(r.data)})); },
    publish(owner, d, body={}) { return transaction(() => {
      const receipt=draftReceipt(owner,d.id,body,'draft.publish');if(receipt.result)return receipt.result.scenario;
      const current=getDraft(owner,d.id);checkDraftVersion(current,body.expectedVersion);checkDraftVersion(current,d.version,true);
      const prior = q('SELECT data FROM scenarios WHERE id=? AND version=? AND owner=?', d.id, d.version, owner);
      const s=prior?JSON.parse(prior.data):{ ...d, state: 'ready' };
      if(!prior)db.prepare('INSERT INTO scenarios VALUES(?,?,?,?)').run(s.id,s.version,owner,JSON.stringify(s));
      if(body.commandId!==undefined)db.prepare('INSERT INTO draft_commands VALUES(?,?,?,?,?)').run(owner,d.id,body.commandId,receipt.payloadHash,JSON.stringify({scenario:s}));
      return s;
    }); },
    close() { db.close(); }
  };
}
