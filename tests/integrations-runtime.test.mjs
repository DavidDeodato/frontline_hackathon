import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { request } from 'node:http';
import { createDurableBudget } from '../runtime/budget.mjs';
import { readRuntimeConfig, startRuntime } from '../runtime/start.mjs';
import { baseScenario } from '../server/engine.mjs';

function files(t) {
  const directory = mkdtempSync(join(tmpdir(), 'frontline-runtime-test-')), dist = join(directory, 'dist'), data = join(directory, 'data');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Fixture runtime</title><main>Synthetic build</main>');
  writeFileSync(join(dist, 'assets', 'entry-abcdefgh.js'), '/* synthetic bundle */');
  writeFileSync(join(directory, 'private.txt'), 'SYNTHETIC_PRIVATE_MARKER');
  t.after(() => { assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('frontline-runtime-test-')); rmSync(directory, { recursive: true, force: true }); });
  return { directory, dist, data, env: { HOST: '127.0.0.1', PORT: '0', FRONTLINE_DATA_DIR: data, FRONTLINE_PUBLIC_ORIGIN: 'http://localhost:5184', FRONTLINE_PROVIDER_MODE: 'fixture' } };
}
async function call(runtime, path, { method = 'GET', body, cookie, origin = runtime.config.origin } = {}) {
  return fetch(`http://127.0.0.1:${runtime.server.address().port}${path}`, { method, headers: { ...(origin ? { Origin: origin } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
function raw(runtime, path) {
  return new Promise((accept, reject) => { const req = request({ hostname: '127.0.0.1', port: runtime.server.address().port, path, headers: { Accept: 'text/html' } }, res => { let body = ''; res.on('data', b => body += b); res.on('end', () => accept({ status: res.statusCode, body })); }); req.on('error', reject); req.end(); });
}

test('explicit configuration defaults fixture and denies incomplete or unsafe cloud settings', () => {
  assert.equal(readRuntimeConfig({ OPENAI_API_KEY: 'synthetic', OPENAI_MODEL: 'synthetic' }).mode, 'fixture');
  assert.throws(() => readRuntimeConfig({ HOST: '0.0.0.0' }), /PUBLIC_ORIGIN/);
  assert.throws(() => readRuntimeConfig({ FRONTLINE_PROVIDER_MODE: 'openai' }), /credentials/);
  assert.throws(() => readRuntimeConfig({ FRONTLINE_PROVIDER_MODE: 'openai', OPENAI_API_KEY: 'synthetic', OPENAI_MODEL: 'synthetic' }), /MAX_REQUESTS/);
  assert.throws(() => readRuntimeConfig({ FRONTLINE_PUBLIC_ORIGIN: 'https://frontline.example', FRONTLINE_SECURE_COOKIES: 'false' }), /Secure/);
  const c = readRuntimeConfig({ HOST: '0.0.0.0', PORT: '3000', FRONTLINE_DATA_DIR: '/data', FRONTLINE_PUBLIC_ORIGIN: 'https://frontline.example' });
  assert.equal(c.port, 3000); assert.equal(c.secureCookies, true);
});

test('same-origin static/SPA has MIME and HEAD; API never falls back to HTML', async t => {
  const f = files(t), runtime = await startRuntime({ env: f.env, distDir: f.dist });
  try {
    const base = `http://127.0.0.1:${runtime.server.address().port}`;
    const index = await fetch(base); assert.equal(index.status, 200); assert.match(index.headers.get('content-type'), /text\/html/);
    assert.match(await index.text(), /Synthetic build/);
    const js = await fetch(`${base}/assets/entry-abcdefgh.js`); assert.equal(js.status, 200); assert.match(js.headers.get('content-type'), /javascript/); assert.match(js.headers.get('cache-control'), /immutable/);
    const head = await fetch(`${base}/assets/entry-abcdefgh.js`, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
    assert.equal((await fetch(`${base}/history/session`, { headers: { Accept: 'text/html' } })).status, 200);
    assert.equal((await fetch(`${base}/assets/missing.js`, { headers: { Accept: 'text/html' } })).status, 404);
    const unknown = await fetch(`${base}/api/does-not-exist`, { headers: { Accept: 'text/html' } }); assert.equal(unknown.status, 404); assert.match(unknown.headers.get('content-type'), /application\/json/);
    assert.equal((await raw(runtime, '/api%2fdoes-not-exist')).status, 404);
    const health = await call(runtime, '/api/health'); assert.equal((await health.json()).providerMode, 'fixture');
    assert.equal(existsSync(join(f.data, 'operational-budget.sqlite')), false);
  } finally { await runtime.close(); }
});

test('static containment rejects traversal, dotfiles, encoded backslashes and escaping symlinks', async t => {
  const f = files(t), runtime = await startRuntime({ env: f.env, distDir: f.dist });
  try {
    for (const path of ['/../private.txt', '/%2e%2e/private.txt', '/.env', '/%5c..%5cprivate.txt', '/assets/%00.js']) {
      const r = await raw(runtime, path); assert.equal(r.status, 404, path); assert.ok(!r.body.includes('SYNTHETIC_PRIVATE_MARKER'));
    }
    // Directory junctions are available without symlink privileges on Windows.
    symlinkSync(f.directory, join(f.dist, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    const leaked = await raw(runtime, '/escape/private.txt'); assert.equal(leaked.status, 404); assert.ok(!leaked.body.includes('SYNTHETIC_PRIVATE_MARKER'));
  } finally { await runtime.close(); }
});

test('origin is exact even when core Host matches; HTTPS cookie is Secure; sessions survive restart', async t => {
  const f = files(t); f.env.FRONTLINE_PUBLIC_ORIGIN = 'https://frontline.example';
  let runtime = await startRuntime({ env: f.env, distDir: f.dist });
  try {
    const health = await call(runtime, '/api/health'); const cookie = health.headers.get('set-cookie').split(';')[0];
    assert.match(health.headers.get('set-cookie'), /HttpOnly/); assert.match(health.headers.get('set-cookie'), /SameSite=Lax/); assert.match(health.headers.get('set-cookie'), /; Secure/);
    assert.equal((await call(runtime, '/api/health', { origin: 'http://frontline.example' })).status, 403);
    const localHostOrigin = `http://127.0.0.1:${runtime.server.address().port}`;
    assert.equal((await call(runtime, '/api/health', { origin: localHostOrigin })).status, 403);
    const body = { scenarioId: baseScenario().id, scenarioVersion: 1 };
    assert.equal((await call(runtime, '/api/sessions', { method: 'POST', body, cookie, origin: null })).status, 403);
    const created = await call(runtime, '/api/sessions', { method: 'POST', body, cookie }); assert.equal(created.status, 200); const session = (await created.json()).session;
    await runtime.close(); runtime = await startRuntime({ env: f.env, distDir: f.dist });
    const restored = await call(runtime, `/api/sessions/${session.id}`, { cookie }); assert.equal(restored.status, 200); assert.equal((await restored.json()).session.id, session.id);
    assert.equal((await call(runtime, `/api/sessions/${session.id}`)).status, 404);
  } finally { await runtime.close(); }
});

test('durable quota reserves atomically, rejects silent limit changes and survives stop/restart', t => {
  const f = files(t), filename = join(f.data, 'operational-budget.sqlite'), limits = { filename, maxRequests: 3, maxOutputTokens: 3900 };
  let b = createDurableBudget(limits); assert.deepEqual(b.reserveMany(2, 1300), [1, 2]);
  assert.throws(() => b.reserveMany(2, 1300), { code: 'MODEL_BUDGET_EXCEEDED' }); assert.equal(b.snapshot().usedRequests, 2); b.close();
  assert.throws(() => createDurableBudget({ ...limits, maxRequests: 4 }), { code: 'BUDGET_LIMITS_MISMATCH' });
  b = createDurableBudget(limits); assert.equal(b.snapshot().reservedOutputTokens, 2600); assert.equal(b.reserve(1300), 3); b.stop(); b.close();
  b = createDurableBudget(limits); assert.equal(b.snapshot().stopped, true); assert.throws(() => b.reserve(1300), { code: 'MODEL_QUOTA_EXCEEDED' }); b.close();
});

test('separate database handles cannot spend the same remaining allowance', t => {
  const f = files(t), limits = { filename: join(f.data, 'quota.sqlite'), maxRequests: 2, maxOutputTokens: 2600 };
  const a = createDurableBudget(limits), b = createDurableBudget(limits);
  try { assert.equal(a.reserve(1300), 1); assert.equal(b.reserve(1300), 2); assert.throws(() => a.reserve(1300), { code: 'MODEL_BUDGET_EXCEEDED' }); }
  finally { a.close(); b.close(); }
});

test('OpenAI demand reserves before fake fetch, failed requests persist and boot performs no calls', async t => {
  const f = files(t), env = { ...f.env, FRONTLINE_PROVIDER_MODE: 'openai', OPENAI_API_KEY: 'synthetic-not-a-key', OPENAI_MODEL: 'synthetic', FRONTLINE_MAX_REQUESTS: '36', FRONTLINE_MAX_OUTPUT_TOKENS: '46800' };
  let fetches = 0, observedBeforeFetch;
  const fetchImpl = async () => {
    fetches++;
    const observer = createDurableBudget({ filename: join(f.data, 'operational-budget.sqlite'), maxRequests: 36, maxOutputTokens: 46800 });
    try { observedBeforeFetch = observer.snapshot(); } finally { observer.close(); }
    return { ok: false, status: 401, json: async () => ({ error: { code: 'synthetic_failure' } }) };
  };
  let runtime = await startRuntime({ env, distDir: f.dist, fetchImpl });
  try {
    assert.equal(fetches, 0); const health = await call(runtime, '/api/health'); assert.equal((await health.json()).providerMode, 'openai'); assert.equal(fetches, 0);
    const r = await call(runtime, '/api/drafts', { method: 'POST', body: { text: 'Contexto sintético para teste.', commandId: 'runtime-fake-1' } });
    assert.equal(r.status, 503); assert.equal(fetches, 1); assert.equal(runtime.budget.snapshot().usedRequests, 2);
    assert.equal(observedBeforeFetch.usedRequests, 2); assert.equal(observedBeforeFetch.reservedOutputTokens, 2600);
    await runtime.close(); runtime = await startRuntime({ env, distDir: f.dist, fetchImpl });
    assert.equal(runtime.budget.snapshot().usedRequests, 2); assert.equal(fetches, 1);
  } finally { await runtime.close(); }
});
