import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { createApp } from '../server/index.mjs';
import { createProvider } from '../server/provider.mjs';
import { createDurableBudget } from './budget.mjs';
import { staticHandler, jsonError } from './static.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
function integer(value, name, fallback) {
  const parsed = value === undefined ? fallback : /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed)) throw new TypeError(`Invalid ${name}.`);
  return parsed;
}
export function readRuntimeConfig(env = process.env) {
  const mode = env.FRONTLINE_PROVIDER_MODE || 'fixture';
  if (!['fixture', 'openai'].includes(mode)) throw new TypeError('FRONTLINE_PROVIDER_MODE must be fixture or openai.');
  const host = env.HOST || '127.0.0.1', port = integer(env.PORT ?? env.FRONTLINE_API_PORT, 'PORT', 8782);
  if (!['127.0.0.1', 'localhost', '0.0.0.0', '::1', '::'].includes(host) || port < 0 || port > 65535) throw new TypeError('Invalid listen configuration.');
  const publicListen = !['127.0.0.1', 'localhost', '::1'].includes(host);
  if (publicListen && !env.FRONTLINE_PUBLIC_ORIGIN) throw new TypeError('Public listen requires FRONTLINE_PUBLIC_ORIGIN.');
  const origin = new URL(env.FRONTLINE_PUBLIC_ORIGIN || `http://127.0.0.1:${port}`);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || (origin.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname))) throw new TypeError('Use an exact HTTPS public origin or a loopback HTTP origin.');
  const secureValue = env.FRONTLINE_SECURE_COOKIES;
  if (secureValue !== undefined && !['true', 'false'].includes(secureValue)) throw new TypeError('FRONTLINE_SECURE_COOKIES must be true or false.');
  const secureCookies = secureValue === undefined ? origin.protocol === 'https:' : secureValue === 'true';
  if (origin.protocol === 'https:' && !secureCookies) throw new TypeError('HTTPS origin requires Secure cookies.');
  if (mode === 'openai' && (!env.OPENAI_API_KEY?.trim() || !env.OPENAI_MODEL?.trim())) throw new TypeError('Explicit OpenAI mode requires server credentials.');
  return { mode, host, port, origin: origin.origin, secureCookies, dataDir: resolve(env.FRONTLINE_DATA_DIR || join(root, 'data')), maxRequests: mode === 'openai' ? integer(env.FRONTLINE_MAX_REQUESTS, 'FRONTLINE_MAX_REQUESTS') : null, maxOutputTokens: mode === 'openai' ? integer(env.FRONTLINE_MAX_OUTPUT_TOKENS, 'FRONTLINE_MAX_OUTPUT_TOKENS') : null };
}

/** Construction is explicit; importing this module has no filesystem/network/listener effects. */
export function createRuntime({ env = process.env, distDir = join(root, 'dist'), fetchImpl = fetch, onTelemetry } = {}) {
  const config = readRuntimeConfig(env), serveStatic = staticHandler(distDir);
  let budget, app;
  try {
    if (config.mode === 'openai') budget = createDurableBudget({ filename: join(config.dataDir, 'operational-budget.sqlite'), maxRequests: config.maxRequests, maxOutputTokens: config.maxOutputTokens });
    const provider = createProvider({ mode: config.mode, apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL, fetchImpl, ...(budget ? { budget } : {}), onTelemetry });
    app = createApp({ databasePath: join(config.dataDir, 'frontline.sqlite'), provider, allowedOrigins: [config.origin], secureCookies: config.secureCookies });
    const listeners = app.server.listeners('request');
    if (listeners.length !== 1) throw new Error('Unexpected API listener configuration.');
    const apiHandler = listeners[0]; app.server.removeAllListeners('request');
    app.server.on('request', (req, res) => {
      const raw = req.url.split('?')[0];
      // Prefix is deliberately checked before URL normalization or SPA fallback.
      if (raw === '/api' || raw.startsWith('/api/')) {
        if ((req.headers.origin && req.headers.origin !== config.origin) || (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== config.origin)) return jsonError(res, 403, 'ORIGIN_FORBIDDEN');
        return apiHandler(req, res);
      }
      return serveStatic(req, res);
    });
    let closed = false;
    return { server: app.server, provider, budget, config, async close() {
      if (closed) return; closed = true;
      try { if (app.server.listening) await app.close(); else app.store.close(); } finally { budget?.close(); }
    } };
  } catch (error) { if (app) app.store.close(); budget?.close(); throw error; }
}

export async function startRuntime(options = {}) {
  const runtime = createRuntime(options);
  try { await new Promise((accept, reject) => { runtime.server.once('error', reject); runtime.server.listen(runtime.config.port, runtime.config.host, () => { runtime.server.removeListener('error', reject); accept(); }); }); }
  catch (error) { await runtime.close(); throw error; }
  return runtime;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runtime = await startRuntime();
  process.stdout.write(JSON.stringify({ event: 'frontline_runtime_started', mode: runtime.config.mode, port: runtime.server.address().port, secureCookies: runtime.config.secureCookies }) + '\n');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => runtime.close().then(() => process.exit(0), () => process.exit(1)));
}
