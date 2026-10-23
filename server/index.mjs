import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { openStore, hash } from './store.mjs';
import { createProvider } from './provider.mjs';
import { applyDraftProposal, createDraftToolExecutor } from './drafts.mjs';
import { IntegrationError, integrationCapabilities, createSessionExport, verifySessionExport } from './integrations/index.mjs';
import { AppError, fail, baseScenario, projectRules, validateScenario, newSession, wireSession, clone, openDocument, applyTurn, finishAssessment } from './engine.mjs';

const textField = (value, name, maximum = 6000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail(422, 'INVALID_INPUT', `${name} deve ser texto entre 1 e ${maximum} caracteres.`);
  return value;
};
async function readBody(req, maximumBytes = 65536) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) fail(415, 'JSON_REQUIRED', 'Envie um objeto JSON.');
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > maximumBytes) fail(413, 'BODY_TOO_LARGE', `O conteúdo ultrapassa o limite de ${maximumBytes / 1024} KB.`); chunks.push(chunk); }
  const data = Buffer.concat(chunks).toString('utf8');
  try { const value = JSON.parse(data || '{}'); if (!value || Array.isArray(value) || typeof value !== 'object') throw Error(); return value; } catch { fail(400, 'INVALID_JSON', 'O conteúdo JSON está inválido.'); }
}

export function createApp({ databasePath = fileURLToPath(new URL('../data/frontline.sqlite', import.meta.url)), provider = createProvider(), allowedOrigins = ['http://127.0.0.1:5182', 'http://localhost:5182'], secureCookies = false } = {}) {
  const store = openStore(databasePath);
  const locks = new Map();
  async function serialized(key, action) {
    const prior = locks.get(key) || Promise.resolve();
    const current = prior.catch(() => {}).then(action); locks.set(key, current);
    try { return await current; } finally { if (locks.get(key) === current) locks.delete(key); }
  }
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const url = new URL(req.url, 'http://frontline.local');
      const origin = req.headers.origin;
      const sameHost = origin && (() => { try { return new URL(origin).host === req.headers.host; } catch { return false; } })();
      if (origin && !allowedOrigins.includes(origin) && !sameHost) fail(403, 'ORIGIN_FORBIDDEN', 'Origem não autorizada.');
      const ident = store.identity(req.headers.cookie);
      if (ident.token) res.setHeader('Set-Cookie', `frontline_guest=${ident.token}; Path=/; HttpOnly; SameSite=Lax${secureCookies ? '; Secure' : ''}; Max-Age=604800`);
      const owner = ident.owner;
      const method = req.method;
      let output;
      if (method === 'GET' && url.pathname === '/api/health') output = { status: 'ok', providerMode: provider.mode, contractVersion: '0.1' };
      else if (method === 'GET' && url.pathname === '/api/library') output = store.library(owner);
      else if (method === 'GET' && url.pathname === '/api/integrations/status') output = integrationCapabilities();
      else if (method === 'POST' && url.pathname === '/api/exports/verify') {
        const body = await readBody(req, 1024 * 1024);
        let expectedSha256;
        if (body.sessionId !== undefined) {
          const session = store.getSession(textField(body.sessionId, 'Sessão de referência', 200), owner);
          expectedSha256 = createSessionExport(wireSession(session)).document.integrity.sha256;
        }
        output = verifySessionExport(body.document, { expectedSha256 });
      }
      else if (url.pathname === '/api/integrations/whatsapp' || url.pathname.startsWith('/api/integrations/whatsapp/')) fail(401, 'ACCOUNT_AUTH_REQUIRED', 'O vínculo requer uma conta autenticada e uma ponte WhatsApp verificada.');
      else if (method === 'POST' && url.pathname === '/api/drafts') {
        const body = await readBody(req); const text = textField(body.text, 'Contexto');
        if (body.policyText !== undefined && (typeof body.policyText !== 'string' || body.policyText.length > 6000)) fail(422, 'INVALID_POLICY', 'Política deve ser um texto de até 6000 caracteres.');
        output = await serialized(`draft-create:${owner}:${body.commandId ?? randomUUID()}`, async () => {
          const receipt = store.draftReceipt(owner,'create',body,'draft.create'); if (receipt.result) return receipt.result;
          let d;
          if (provider.mode === 'fixture') {
            const proposal = await provider.draft(text,body.policyText);
            d = baseScenario(); d.id = randomUUID(); d.version = 1; d.state = 'draft';
            d.label = 'Modelo demonstrativo • dados fictícios • contexto não interpretado por IA';
            applyDraftProposal(d,proposal,text,body.policyText || '',provider.mode);
          } else {
            const tool = createDraftToolExecutor({text,policyText:body.policyText || '',mode:provider.mode});
            d = tool.finish(await provider.draft(text,body.policyText || '',{executeTool:tool.executeTool}));
          }
          validateScenario(d);
          return store.saveDraftResult(owner,d,{scope:'create',body,operation:'draft.create',requestText:text});
        });
      } else if (method === 'GET' && /^\/api\/drafts\/[^/]+\/versions$/.test(url.pathname)) {
        output = {versions:store.draftVersions(owner,url.pathname.split('/')[3])};
      } else if (method === 'POST' && /^\/api\/drafts\/[^/]+\/revisions$/.test(url.pathname)) {
        const id = url.pathname.split('/')[3], body = await readBody(req);
        const revisionText = textField(body.text,'Alteração');
        if (body.commandId === undefined) fail(422,'INVALID_COMMAND','Informe commandId válido.');
        output = await serialized(`draft:${id}`,async () => {
          const before = store.getDraft(owner,id);
          const receipt = store.draftReceipt(owner,id,body,'draft.revise'); if (receipt.result) return receipt.result;
          store.checkDraftVersion(before,body.expectedVersion,true);
          if (provider.mode !== 'openai') fail(503,'AUTHOR_REQUIRES_OPENAI','A alteração por linguagem natural requer o autor OpenAI. No modo demonstrativo, use os controles avançados.');
          const text = before.rawContext || '', policyText = before.rawPolicyText || '';
          const tool = createDraftToolExecutor({text,policyText,currentDraft:before,revisionText,mode:provider.mode});
          const proposal = await provider.draft(text,policyText,{currentDraft:clone(before),revisionText,executeTool:tool.executeTool});
          const d = tool.finish(proposal); validateScenario(d);
          return store.saveDraftResult(owner,d,{body,operation:'draft.revise',expectedVersion:before.version,requestText:revisionText});
        });
      } else if ((method === 'PATCH' || method === 'POST') && /^\/api\/drafts\/[^/]+(?:\/publish)?$/.test(url.pathname)) {
        const [, , , id, action] = url.pathname.split('/'); const body = await readBody(req);
        output = await serialized(`draft:${id}`,async () => {
        const d = store.getDraft(owner,id);
        if (method === 'POST' && action === 'publish') { validateScenario(d); return { scenario: store.publish(owner,d,body) }; }
        else if (method === 'PATCH' && !action) {
          store.checkDraftVersion(d,body.expectedVersion);
          const beforeVersion = d.version;
          if (body.title !== undefined) d.title = textField(body.title, 'Título', 160);
          if (body.summary !== undefined) d.summary = textField(body.summary, 'Resumo', 1200);
          if (body.facts !== undefined) {
            if (!Array.isArray(body.facts) || JSON.stringify(body.facts) !== JSON.stringify(d.facts)) fail(422, 'RULE_CONTROL_REQUIRED', 'Os fatos operacionais são derivados das regras; altere os controles de disponibilidade e prazo.');
          }
          if (body.policy !== undefined && (!body.policy || typeof body.policy !== 'object' || JSON.stringify(body.policy.terms) !== JSON.stringify(d.policy.terms))) fail(422, 'RULE_CONTROL_REQUIRED', 'A política é derivada das regras. Texto livre não altera disponibilidade, prazo ou permissões.');
          if (body.rubric !== undefined) {
            if (!body.rubric || !Array.isArray(body.rubric.criteria)) fail(422, 'INVALID_RUBRIC', 'Informe três critérios válidos.');
            d.rubric = { ...clone(d.rubric), criteria: clone(body.rubric.criteria), version: d.rubric.version + 1 };
          }
          if (body.rules !== undefined) {
            if (!body.rules || Array.isArray(body.rules) || typeof body.rules !== 'object' || Object.keys(body.rules).some(k => !['loanAvailable', 'loanDays'].includes(k))) fail(422, 'INVALID_RULES', 'Somente disponibilidade e prazo podem ser alterados.');
            d.rules = { ...d.rules, ...body.rules };
          }
          // Advanced edits are validated here; they were not composed by the
          // model tool for this new version, so do not retain that claim.
          delete d.authorTool; delete d.authorMessage;
          d.version++; d.policy.version = d.version; d.state = 'draft'; projectRules(d); validateScenario(d);
          return store.saveDraftResult(owner,d,{expectedVersion:beforeVersion});
        } else fail(404, 'NOT_FOUND', 'Rota não encontrada.');
        });
      } else if (method === 'POST' && url.pathname === '/api/sessions') {
        const body = await readBody(req);
        if (body.scenarioVersion !== undefined && (!Number.isInteger(body.scenarioVersion) || body.scenarioVersion < 1)) fail(422, 'INVALID_VERSION', 'Informe uma versão inteira positiva.');
        const scenario = store.getScenario(textField(body.scenarioId, 'Cenário', 200), body.scenarioVersion, owner);
        const s = newSession(scenario, provider.mode); store.transaction(() => store.insertSession(owner, s)); output = { session: wireSession(s) };
      } else if (method === 'GET' && url.pathname === '/api/compare') {
        const left = wireSession(store.getSession(textField(url.searchParams.get('left'), 'Tentativa esquerda', 200), owner)); const right = wireSession(store.getSession(textField(url.searchParams.get('right'), 'Tentativa direita', 200), owner));
        output = { left, right, sameContext: left.scenarioId === right.scenarioId && left.scenarioVersion === right.scenarioVersion && hash(left.scenario) === hash(right.scenario) };
      } else if (/^\/api\/sessions\/[^/]+/.test(url.pathname)) {
        const parts = url.pathname.split('/'); const id = parts[3]; const operation = parts.slice(4).join('/');
        if (method === 'GET' && !operation) output = { session: wireSession(store.getSession(id, owner)) };
        else if (method === 'GET' && operation === 'export') output = createSessionExport(wireSession(store.getSession(id, owner)));
        else if (method === 'POST' && ['messages','documents','pause','resume','cancel','branches','assessment/retry'].includes(operation)) {
          const body = await readBody(req);
          output = await serialized(id, async () => {
            const before = store.getSession(id, owner); const receipt = store.receipt(before, body, operation); if (receipt.result) return receipt.result;
            let after = clone(before); let branch;
            if (operation === 'messages') {
              const text = textField(body.text, 'Resposta', 2000);
              if (before.status !== 'active' || before.messages.filter(m => m.role === 'user').length >= 3) fail(409, 'SESSION_NOT_ACTIVE', 'A sessão não aceita mais respostas.', wireSession(before));
              if (before.mode !== provider.mode) fail(503, 'PROVIDER_MODE_CHANGED', 'Retome esta sessão com o mesmo modo de interpretação.', wireSession(before));
              after = applyTurn(before, text, await provider.turn(before, text));
              if (['completed', 'incomplete'].includes(after.status)) {
                try { finishAssessment(after, await provider.assess(after)); }
                catch (error) { after.assessmentError = { code: error instanceof AppError ? error.code : 'MODEL_UNAVAILABLE', message: error instanceof AppError ? error.message : 'A conversa foi salva. Não foi possível avaliar agora; tente novamente.' }; }
              }
            } else if (operation === 'documents') {
              if (!['active', 'paused'].includes(before.status)) fail(409, 'SESSION_NOT_ACTIVE', 'A tentativa terminou; consulte os documentos no resultado.', wireSession(before));
              openDocument(after, textField(body.objectId, 'Objeto', 200));
            } else if (operation === 'pause') {
              if (before.status !== 'active') fail(409, 'INVALID_TRANSITION', 'Somente uma sessão ativa pode ser pausada.', wireSession(before)); after.status = 'paused';
            } else if (operation === 'resume') {
              if (before.status !== 'paused') fail(409, 'INVALID_TRANSITION', 'Somente uma sessão pausada pode ser retomada.', wireSession(before)); after.status = 'active';
            } else if (operation === 'cancel') {
              if (!['active','paused'].includes(before.status)) fail(409, 'INVALID_TRANSITION', 'A sessão já terminou.', wireSession(before)); after.status = 'cancelled'; after.ending = null;
            } else if (operation === 'branches') {
              if (body.beforeMessageId && !before.messages.some(m => m.id === body.beforeMessageId && m.role === 'user')) fail(422, 'INVALID_BRANCH_POINT', 'Escolha uma fala do participante nesta tentativa.');
              branch = newSession(before.scenario, before.mode, before.id);
            } else if (operation === 'assessment/retry') {
              if (!['completed','incomplete'].includes(before.status)) fail(409, 'INVALID_TRANSITION', 'Conclua a conversa antes de avaliar.', wireSession(before));
              if (before.mode !== provider.mode) fail(503, 'PROVIDER_MODE_CHANGED', 'Avalie esta sessão com o mesmo modo de interpretação.', wireSession(before));
              if (!before.evaluation) finishAssessment(after, await provider.assess(after));
            }
            return store.commit(owner, before, after, body, receipt.payloadHash, operation, branch);
          });
        } else fail(404, 'NOT_FOUND', 'Rota não encontrada.');
      } else fail(404, 'NOT_FOUND', 'Rota não encontrada.');
      res.statusCode = 200; res.end(JSON.stringify(output));
    } catch (error) {
      const known = error instanceof AppError || error instanceof IntegrationError; res.statusCode = known ? error.status : 500;
      res.end(JSON.stringify({ error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : 'Não foi possível concluir a operação. Tente novamente.' }, ...(error.session ? { session: error.session } : {}) }));
    }
  });
  return { server, store, provider, async close() { await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve())); store.close(); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp(); const port = Number(process.env.FRONTLINE_API_PORT || 8782);
  app.server.listen(port, '127.0.0.1', () => process.stdout.write(`Frontline API local http://127.0.0.1:${port} • modo ${app.provider.mode}\n`));
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => app.close().finally(() => process.exit(0)));
}
