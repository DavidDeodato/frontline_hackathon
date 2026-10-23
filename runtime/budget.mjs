import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { AppError } from '../server/engine.mjs';

export const OPERATIONAL_CEILING = Object.freeze({ requests: 36, outputTokens: 46800, perRequest: 1300 });
const deny = (code, message) => { throw new AppError(503, code, message); };

/** Separate operational ledger. Reservations commit synchronously before the provider can fetch. */
export function createDurableBudget({ filename, maxRequests, maxOutputTokens }) {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > OPERATIONAL_CEILING.requests || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 16 || maxOutputTokens > OPERATIONAL_CEILING.outputTokens) throw new TypeError('Explicit operational limits must fit the authorized ceiling.');
  mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  function transaction(action) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = action(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function read() {
    const row = db.prepare('SELECT * FROM operational_budget WHERE id=1').get();
    if (!row || row.schema_version !== 1 || row.max_requests !== maxRequests || row.max_output_tokens !== maxOutputTokens) deny('BUDGET_LIMITS_MISMATCH', 'Os limites configurados divergem do ledger operacional. Não houve redefinição da quota.');
    return { maxRequests: row.max_requests, maxOutputTokens: row.max_output_tokens, usedRequests: row.used_requests, reservedOutputTokens: row.reserved_output_tokens, stopped: row.stopped === 1 };
  }
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;');
    db.exec('CREATE TABLE IF NOT EXISTS operational_budget(id INTEGER PRIMARY KEY CHECK(id=1),schema_version INTEGER NOT NULL,max_requests INTEGER NOT NULL,max_output_tokens INTEGER NOT NULL,used_requests INTEGER NOT NULL,reserved_output_tokens INTEGER NOT NULL,stopped INTEGER NOT NULL CHECK(stopped IN (0,1))); CREATE TABLE IF NOT EXISTS operational_reservations(sequence INTEGER PRIMARY KEY,tokens INTEGER NOT NULL,created_at TEXT NOT NULL);');
    transaction(() => {
      db.prepare('INSERT OR IGNORE INTO operational_budget VALUES(1,1,?,?,0,0,0)').run(maxRequests, maxOutputTokens);
      const state = read(), sums = db.prepare('SELECT COUNT(*) AS requests,COALESCE(SUM(tokens),0) AS tokens,COALESCE(MAX(sequence),0) AS last_sequence FROM operational_reservations').get();
      if (state.usedRequests !== sums.requests || state.reservedOutputTokens !== sums.tokens || state.usedRequests !== sums.last_sequence || state.usedRequests > state.maxRequests || state.reservedOutputTokens > state.maxOutputTokens) deny('BUDGET_LEDGER_INVALID', 'O ledger operacional precisa ser conferido antes de novas chamadas.');
    });
  } catch (error) { db.close(); throw error; }
  function reserveMany(count, tokens) {
    if (!Number.isSafeInteger(count) || count < 1 || count > OPERATIONAL_CEILING.requests || !Number.isSafeInteger(tokens) || tokens < 16 || tokens > OPERATIONAL_CEILING.perRequest) throw new TypeError('Invalid operational reservation.');
    return transaction(() => {
      const state = read();
      if (state.stopped) deny('MODEL_QUOTA_EXCEEDED', 'Novas chamadas estão suspensas; a sessão foi preservada.');
      if (state.usedRequests + count > maxRequests || state.reservedOutputTokens + count * tokens > maxOutputTokens) deny('MODEL_BUDGET_EXCEEDED', 'O orçamento operacional terminou; a sessão foi preservada.');
      const sequences = Array.from({ length: count }, (_, i) => state.usedRequests + i + 1);
      const insert = db.prepare('INSERT INTO operational_reservations VALUES(?,?,?)'), now = new Date().toISOString();
      for (const sequence of sequences) insert.run(sequence, tokens, now);
      db.prepare('UPDATE operational_budget SET used_requests=?,reserved_output_tokens=? WHERE id=1').run(state.usedRequests + count, state.reservedOutputTokens + count * tokens);
      return sequences;
    });
  }
  return Object.freeze({
    reserve: tokens => reserveMany(1, tokens)[0], reserveMany,
    snapshot: read,
    stop() { transaction(() => { read(); db.exec('UPDATE operational_budget SET stopped=1 WHERE id=1'); }); },
    close() { db.close(); }
  });
}
