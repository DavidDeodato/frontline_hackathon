import { requireCondition as ensure } from './errors.mjs';

function keyInput(namespace, key) {
  ensure(typeof namespace === 'string' && /^[a-z][a-z0-9_-]{0,50}$/.test(namespace) && typeof key === 'string' && key.length > 0 && key.length <= 512, 500, 'INVALID_STORAGE_KEY', 'Chave interna inválida.');
}

/** Explicitly initialized by the API owner. Never opens or migrates a database at import time. */
export function createIntegrationStore(db) {
  ensure(db && typeof db.prepare === 'function', 500, 'STORE_REQUIRED', 'Persistência da integração indisponível.');
  db.exec('CREATE TABLE IF NOT EXISTS integration_records(namespace TEXT NOT NULL, key TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(namespace,key))');
  let sequence = 0;
  return {
    mode: 'sqlite',
    get(namespace, key) { keyInput(namespace, key); const row = db.prepare('SELECT data FROM integration_records WHERE namespace=? AND key=?').get(namespace, key); return row ? JSON.parse(row.data) : null; },
    set(namespace, key, value) { keyInput(namespace, key); const json = JSON.stringify(value); ensure(json !== undefined && Buffer.byteLength(json) <= 262144, 500, 'RECORD_TOO_LARGE', 'Registro interno inválido.'); db.prepare('INSERT INTO integration_records VALUES(?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET data=excluded.data').run(namespace, key, json); },
    remove(namespace, key) { keyInput(namespace, key); db.prepare('DELETE FROM integration_records WHERE namespace=? AND key=?').run(namespace, key); },
    list(namespace) { keyInput(namespace, '_'); return db.prepare('SELECT data FROM integration_records WHERE namespace=? ORDER BY key').all(namespace).map(r => JSON.parse(r.data)); },
    transaction(action) {
      const name = `frontline_integration_${++sequence}`;
      db.exec(`SAVEPOINT ${name}`);
      try { const result = action(); ensure(!result?.then, 500, 'ASYNC_TRANSACTION', 'A transação da integração deve ser síncrona.'); db.exec(`RELEASE ${name}`); return result; }
      catch (error) { db.exec(`ROLLBACK TO ${name}`); db.exec(`RELEASE ${name}`); throw error; }
    }
  };
}
