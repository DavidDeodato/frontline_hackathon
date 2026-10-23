import { createReadStream, realpathSync, statSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg' };
function contained(root, target) { const child = relative(root, target); return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`)); }
export function jsonError(res, status, code) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify({ error: { code, message: 'Não foi possível atender esta solicitação.' } }));
}
export function staticHandler(distDir) {
  const root = realpathSync(distDir), index = resolve(root, 'index.html');
  if (!statSync(index).isFile()) throw new Error('Build index.html is required.');
  function file(path) {
    try { const real = realpathSync(path); if (!contained(root, real) || !statSync(real).isFile()) return null; return real; }
    catch { return null; }
  }
  if (!file(index)) throw new Error('Build index must stay inside dist.');
  return (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) return jsonError(res, 405, 'METHOD_NOT_ALLOWED');
    let path;
    try { path = decodeURIComponent(req.url.split('?')[0]); } catch { return jsonError(res, 400, 'INVALID_PATH'); }
    if (path === '/api' || path.startsWith('/api/')) return jsonError(res, 404, 'NOT_FOUND');
    if (!path.startsWith('/') || path.startsWith('//') || /[\\\0]/.test(path) || path.split('/').some(part => part.startsWith('.'))) return jsonError(res, 404, 'NOT_FOUND');
    const target = resolve(root, `.${path}`);
    if (!contained(root, target)) return jsonError(res, 404, 'NOT_FOUND');
    let chosen = file(target);
    const navigate = String(req.headers.accept || '').includes('text/html');
    if (!chosen && (path === '/' || (!extname(path) && navigate && !path.startsWith('/assets/')))) chosen = file(index);
    if (!chosen) return jsonError(res, 404, 'NOT_FOUND');
    res.writeHead(200, { 'Content-Type': MIME[extname(chosen).toLowerCase()] || 'application/octet-stream', 'Content-Length': statSync(chosen).size, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': path.startsWith('/assets/') && /[-.][a-zA-Z0-9_-]{8,}\./.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache' });
    if (req.method === 'HEAD') return res.end();
    const stream = createReadStream(chosen); stream.on('error', () => res.destroy()); stream.pipe(res);
  };
}
