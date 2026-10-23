import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { canonicalJSON } from './export.mjs';
import { IntegrationError, requireCondition as ensure } from './errors.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const text = (value, max = 200) => typeof value === 'string' && value.length > 0 && value.length <= max;
const iso = ms => new Date(ms).toISOString();
const secretGood = secret => typeof secret === 'string' && Buffer.byteLength(secret) >= 32;

/** Call only after server authentication. No field in a browser JSON body grants account identity. */
function ownerOf(principal) {
  ensure(principal?.authenticated === true && principal?.kind === 'account' && text(principal.id), 401, 'ACCOUNT_REQUIRED', 'Entre em uma conta autenticada para vincular o canal. O visitante local não permite esse vínculo.');
  return principal.id;
}

export function signBridgePayload(rawBody, timestamp, secret) {
  ensure(secretGood(secret), 500, 'BRIDGE_SECRET_REQUIRED', 'A ponte de mensagens não está configurada.');
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex')}`;
}

export function verifyBridgePayload(rawBody, { timestamp, signature }, secret, now = Date.now()) {
  ensure(secretGood(secret), 503, 'BRIDGE_UNAVAILABLE', 'A ponte de mensagens não está configurada.');
  ensure(Buffer.isBuffer(rawBody) && rawBody.length <= 16384, 413, 'INVALID_CALLBACK_BODY', 'Callback inválido.');
  ensure(typeof timestamp === 'string' && /^\d{10,13}$/.test(timestamp) && Math.abs(now - Number(timestamp)) <= 300000, 401, 'CALLBACK_EXPIRED', 'Callback expirado.');
  const expected = signBridgePayload(rawBody, timestamp, secret);
  ensure(typeof signature === 'string' && /^sha256=[a-f0-9]{64}$/.test(signature) && timingSafeEqual(Buffer.from(signature), Buffer.from(expected)), 401, 'INVALID_CALLBACK_SIGNATURE', 'Assinatura da ponte inválida.');
  try { const event = JSON.parse(rawBody.toString('utf8')); ensure(event && !Array.isArray(event) && typeof event === 'object', 422, 'INVALID_CALLBACK', 'Callback inválido.'); return event; }
  catch (error) { if (error instanceof IntegrationError) throw error; throw new IntegrationError(422, 'INVALID_CALLBACK', 'Callback inválido.'); }
}

/** State machine only. It does not start Baileys, read a bot session, or send a message. */
export function createWhatsAppAdapter({ store, mode = 'disabled', accountAuthAvailable = false, callbackSecret, clock = Date.now, resolveSession, webOrigin = 'http://127.0.0.1:5182', tokenTtlMs = 300000 } = {}) {
  ensure(store && ['get', 'set', 'remove', 'transaction'].every(k => typeof store[k] === 'function'), 500, 'STORE_REQUIRED', 'Persistência da integração indisponível.');
  ensure(['disabled', 'fixture', 'bridge'].includes(mode), 500, 'INVALID_CHANNEL_MODE', 'Modo de canal inválido.');
  ensure(Number.isInteger(tokenTtlMs) && tokenTtlMs >= 1000 && tokenTtlMs <= 600000, 500, 'INVALID_TOKEN_TTL', 'Prazo do vínculo inválido.');
  const url = new URL(webOrigin);
  ensure(!url.username && !url.password && !url.search && !url.hash && (url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))), 500, 'INVALID_WEB_ORIGIN', 'Endereço da aplicação inválido.');
  const available = () => mode !== 'disabled' && accountAuthAvailable && secretGood(callbackSecret);
  function assertAvailable() { ensure(available(), 503, 'CHANNEL_UNAVAILABLE', 'A vinculação do WhatsApp ainda não está habilitada.'); }
  const channelKey = channelId => createHmac('sha256', callbackSecret).update(channelId).digest('hex');
  function descriptor(record) {
    const expired = record?.status === 'pending' || record?.status === 'awaiting_confirmation' ? record.expiresAtMs <= clock() : false;
    const status = expired ? 'expired' : record?.status || 'unlinked';
    return { status: mode === 'fixture' && status === 'linked' ? 'fixture_linked' : status, mode, connected: mode === 'bridge' && available() && status === 'linked', available: mode === 'bridge' && available(), linkId: record?.id || null, revision: record?.revision || 0, expiresAt: record?.expiresAtMs ? iso(record.expiresAtMs) : null, channelHint: record?.channelHint || null, confirmedAt: record?.confirmedAt || null, revokedAt: record?.revokedAt || null, externalDelivery: 'not_attempted', reason: !accountAuthAvailable ? 'ACCOUNT_REQUIRED' : !available() ? 'BRIDGE_UNAVAILABLE' : mode === 'fixture' ? 'LOCAL_FIXTURE_ONLY' : null };
  }
  function resumeDescriptor(session) { return { sessionId: session.id, revision: session.revision, status: session.status, messageCount: session.messages.length, url: `${url.origin}/?session=${encodeURIComponent(session.id)}`, requiresAccountLogin: true }; }
  function expected(record, revision) { ensure(Number.isInteger(revision) && record?.revision === revision, 409, 'LINK_REVISION_CONFLICT', 'O vínculo mudou. Atualize antes de continuar.'); }
  function release(record) {
    if (!record) return;
    if (record.tokenHash) store.remove('wa-tokens', record.tokenHash);
    if (record.channelKey) { const bound = store.get('wa-channels', record.channelKey); if (bound?.linkId === record.id) store.remove('wa-channels', record.channelKey); }
  }
  function effect(owner, commandId, input, action) {
    ensure(text(commandId), 422, 'INVALID_COMMAND', 'Informe um identificador de comando.');
    const key = sha(`${owner}\0${commandId}`), hash = sha(canonicalJSON(input));
    return store.transaction(() => {
      const prior = store.get('wa-commands', key);
      if (prior) {
        ensure(prior.hash === hash, 409, 'IDEMPOTENCY_CONFLICT', 'O comando já foi usado com outro conteúdo.');
        // The operation stays idempotent, but its receipt never resurrects an old link/code.
        const record = store.get('wa-links', owner), result = structuredClone(prior.result);
        result.link = descriptor(record);
        if (record?.id !== prior.result.link.linkId || record.status !== 'pending' || record.expiresAtMs <= clock()) { delete result.code; delete result.instruction; }
        return result;
      }
      const result = action(); store.set('wa-commands', key, { hash, result }); return result;
    });
  }
  return {
    status(principal) { if (!principal || principal.kind !== 'account' || !principal.authenticated) return { ...descriptor(null), available: false, reason: 'ACCOUNT_REQUIRED' }; return descriptor(store.get('wa-links', ownerOf(principal))); },
    beginLink(principal, { commandId, expectedRevision = 0 } = {}) {
      const owner = ownerOf(principal); assertAvailable();
      return effect(owner, commandId, { action: 'begin', expectedRevision }, () => {
        const old = store.get('wa-links', owner);
        ensure((old?.revision || 0) === expectedRevision, 409, 'LINK_REVISION_CONFLICT', 'O vínculo mudou. Atualize antes de continuar.');
        ensure(old?.status !== 'linked', 409, 'ALREADY_LINKED', 'Revogue o vínculo atual antes de criar outro.');
        release(old);
        const code = randomBytes(24).toString('base64url'), tokenHash = sha(code), id = randomUUID();
        const record = { id, owner, revision: expectedRevision + 1, status: 'pending', tokenHash, createdAt: iso(clock()), expiresAtMs: clock() + tokenTtlMs };
        store.set('wa-links', owner, record); store.set('wa-tokens', tokenHash, { owner, linkId: id });
        // This one-time code is sensitive runtime data. The API must never log it.
        return { link: descriptor(record), code, instruction: 'Envie o código à ponte autorizada e confirme o vínculo nesta conta.', fixture: mode === 'fixture' };
      });
    },
    confirmLink(principal, { linkId, commandId, expectedRevision } = {}) {
      const owner = ownerOf(principal); assertAvailable();
      return effect(owner, commandId, { action: 'confirm', linkId, expectedRevision }, () => {
        const record = store.get('wa-links', owner); expected(record, expectedRevision);
        ensure(record.id === linkId, 404, 'LINK_NOT_FOUND', 'Vínculo não encontrado.');
        ensure(record.expiresAtMs > clock(), 410, 'LINK_EXPIRED', 'O código de vínculo expirou.');
        ensure(record.status === 'awaiting_confirmation', 409, 'CHANNEL_CONFIRMATION_REQUIRED', 'Aguarde a confirmação do código pela ponte.');
        const claim = store.get('wa-channels', record.channelKey);
        ensure(claim?.linkId === record.id, 409, 'CHANNEL_ALREADY_LINKED', 'Esse canal já está associado a outro vínculo.');
        record.status = 'linked'; record.revision++; record.confirmedAt = iso(clock()); store.set('wa-links', owner, record);
        return { link: descriptor(record) };
      });
    },
    revokeLink(principal, { commandId, expectedRevision } = {}) {
      const owner = ownerOf(principal);
      return effect(owner, commandId, { action: 'revoke', expectedRevision }, () => {
        const record = store.get('wa-links', owner); expected(record, expectedRevision);
        release(record); record.status = 'revoked'; record.revision++; record.revokedAt = iso(clock()); delete record.tokenHash; delete record.channelKey; delete record.channelHint;
        store.set('wa-links', owner, record); return { link: descriptor(record) };
      });
    },
    receiveCallback(rawBody, headers) {
      assertAvailable();
      const event = verifyBridgePayload(rawBody, headers, callbackSecret, clock());
      ensure(text(event.eventId) && text(event.channelId) && event.direct === true && event.fromSelf === false && ['link.claim', 'session.resume'].includes(event.type), 422, 'INVALID_CHANNEL_EVENT', 'Somente mensagens diretas elegíveis são aceitas.');
      const channel = channelKey(event.channelId), receiptKey = sha(event.eventId), inputHash = sha(canonicalJSON(event));
      return store.transaction(() => {
        const previous = store.get('wa-events', receiptKey);
        if (previous) {
          ensure(previous.hash === inputHash, 409, 'EVENT_CONFLICT', 'O evento já foi usado com outro conteúdo.');
          // Revocation/expiry is checked on retries; a cached receipt grants no access.
          const record = store.get('wa-links', previous.owner);
          ensure(record?.id === previous.linkId && record.status !== 'revoked' && (record.status === 'linked' || record.expiresAtMs > clock()), 403, 'LINK_INACTIVE', 'O vínculo não está ativo.');
          if (previous.result.kind === 'resume_available') {
            const current = resolveSession?.(record.owner, previous.result.resume.sessionId);
            ensure(current && !current.then && current.id === previous.result.resume.sessionId, 404, 'SESSION_NOT_FOUND', 'Sessão não encontrada.');
            return { ...structuredClone(previous.result), resume: resumeDescriptor(current), replay: true };
          }
          return { ...structuredClone(previous.result), replay: true };
        }
        let record, result;
        if (event.type === 'link.claim') {
          ensure(text(event.code, 100), 422, 'INVALID_LINK_CODE', 'Código de vínculo inválido.');
          const token = store.get('wa-tokens', sha(event.code));
          ensure(token, 404, 'INVALID_LINK_CODE', 'Código de vínculo não encontrado ou já utilizado.');
          record = store.get('wa-links', token.owner);
          ensure(record?.id === token.linkId && record.status === 'pending' && record.expiresAtMs > clock(), 410, 'LINK_EXPIRED', 'O código de vínculo expirou.');
          const existing = store.get('wa-channels', channel);
          if (existing) {
            const existingLink = store.get('wa-links', existing.owner);
            ensure(!existingLink || existingLink.status === 'revoked' || (existingLink.status !== 'linked' && existingLink.expiresAtMs <= clock()), 409, 'CHANNEL_ALREADY_LINKED', 'O canal já possui vínculo ou confirmação em andamento.');
          }
          store.remove('wa-tokens', record.tokenHash); delete record.tokenHash;
          record.status = 'awaiting_confirmation'; record.revision++; record.channelKey = channel;
          const digits = event.channelId.split('@')[0].replace(/\D/g, ''); record.channelHint = digits ? `•••• ${digits.slice(-2)}` : 'Canal confirmado pela ponte';
          store.set('wa-links', record.owner, record); store.set('wa-channels', channel, { owner: record.owner, linkId: record.id });
          result = { accepted: true, kind: 'confirmation_required', linkId: record.id, fixture: mode === 'fixture', externalDelivery: 'not_attempted' };
        } else {
          const channelLink = store.get('wa-channels', channel); record = channelLink ? store.get('wa-links', channelLink.owner) : null;
          ensure(record?.id === channelLink?.linkId && record?.status === 'linked', 403, 'LINK_INACTIVE', 'O canal não possui vínculo ativo.');
          ensure(text(event.sessionId) && typeof resolveSession === 'function', 422, 'SESSION_REQUIRED', 'Informe uma sessão para retomar.');
          // Resolver must enforce session ownership on every invocation. No anonymous bearer link is created.
          const session = resolveSession(record.owner, event.sessionId);
          ensure(session && !session.then && session.id === event.sessionId, 404, 'SESSION_NOT_FOUND', 'Sessão não encontrada.');
          result = { accepted: true, kind: 'resume_available', fixture: mode === 'fixture', externalDelivery: 'not_attempted', resume: resumeDescriptor(session) };
        }
        store.set('wa-events', receiptKey, { hash: inputHash, owner: record.owner, linkId: record.id, result });
        return result;
      });
    }
  };
}
