import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../server/store.mjs';
import { createHelp } from '../server/help/index.mjs';

function setup(t, provider = { mode: 'fixture' }, now) {
  const store = openStore(':memory:');
  t.after(() => store.close());
  return { store, help: createHelp({ db: store.db, provider, ...(now ? { now } : {}) }) };
}
const input = (commandId = 'first', text = 'Como começar?', view = 'library') => ({ commandId, text, view });

test('guia tem histórico separado, ordem estável e navegação permitida', async t => {
  const { store, help } = setup(t, undefined, () => 1000);
  const result = await help.sendMessage('guest-one', input());
  assert.equal(result.conversation.mode, 'guide');
  assert.deepEqual(result.conversation.messages.map(m => [m.seq, m.role]), [[1, 'user'], [2, 'assistant']]);
  assert.equal(result.conversation.messages[0].createdAt, result.conversation.messages[1].createdAt);
  assert.equal(result.actions[0].id, 'open_library');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 0);
  assert.equal(help.getConversation('guest-two').conversation.messages.length, 0);
});

test('envio simultâneo idempotente consome o provedor uma vez', async t => {
  let calls = 0;
  const { help } = setup(t, { mode: 'openai', async help(data) { calls++; assert.equal(data.history.length, 0); return { text: 'Abra a Biblioteca.', actionIds: ['open_library'] }; } });
  const [a, b] = await Promise.all([help.sendMessage('one', input()), help.sendMessage('one', input())]);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
  assert.equal(a.conversation.mode, 'openai');
  await assert.rejects(help.sendMessage('one', input('first', 'Outra dúvida')), { code: 'IDEMPOTENCY_CONFLICT' });
});

test('falha do provedor não cria resposta predefinida ou histórico parcial', async t => {
  const { help } = setup(t, { mode: 'openai', async help() { throw Error('provider failed'); } });
  await assert.rejects(help.sendMessage('one', input()));
  assert.equal(help.getConversation('one').conversation.messages.length, 0);
});

test('ações arbitrárias e texto excessivo são rejeitados', async t => {
  const { help } = setup(t, { mode: 'openai', async help() { return { text: 'Execute isto', actionIds: ['https://evil.invalid'] }; } });
  await assert.rejects(help.sendMessage('one', input()), { code: 'INVALID_HELP_RESPONSE' });
  await assert.rejects(help.sendMessage('one', input('two', 'x'.repeat(1001))), { code: 'INVALID_HELP_MESSAGE' });
  await assert.rejects(help.sendMessage('one', input('two', 'Ajuda', 'arbitrary')), { code: 'INVALID_HELP_MESSAGE' });
});

test('guia não declara canais ativos nem responde pelo participante', async t => {
  const { help } = setup(t);
  const channels = await help.sendMessage('one', input('channel', 'Como uso o WhatsApp?'));
  assert.match(channels.conversation.messages.at(-1).text, /não está habilitado/);
  const training = await help.sendMessage('one', input('training', 'O que responder para Roberto?'));
  assert.match(training.conversation.messages.at(-1).text, /não responder pelo participante/);
});

test('limite por dono não impede reenviar comando já confirmado', async t => {
  const { help } = setup(t, undefined, () => 1000);
  for (let n = 0; n < 6; n++) await help.sendMessage('one', input(String(n)));
  await assert.rejects(help.sendMessage('one', input('new')), { code: 'HELP_RATE_LIMIT' });
  assert.equal((await help.sendMessage('one', input('0'))).conversation.messages.length, 2);
  assert.equal((await help.sendMessage('two', input())).conversation.messages.length, 2);
});

test('histórico é recuperado por outra instância do serviço na mesma base', async t => {
  const { store, help } = setup(t);
  const sent = await help.sendMessage('one', input());
  const restored = createHelp({ db: store.db, provider: { mode: 'fixture' } });
  assert.deepEqual(restored.getConversation('one').conversation, sent.conversation);
});

test('modo OpenAI indisponível é erro explícito, sem cair para guia', async t => {
  const { help } = setup(t, { mode: 'openai' });
  await assert.rejects(help.sendMessage('one', input()), { code: 'HELP_UNAVAILABLE' });
});

test('troca de dono durante uma resposta não grava na conta com identidade antiga', async t => {
  let release, began;
  const started = new Promise(resolve => { began = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  const { help, store } = setup(t, { mode: 'openai', async help() { began(); await pending; return { text: 'Abra a biblioteca.', actionIds: [] }; } });
  const request = help.sendMessage('guest', input());
  await started;
  store.db.prepare('UPDATE help_conversations SET owner=? WHERE owner=?').run('user:1', 'guest');
  release();
  await assert.rejects(request, { code: 'HELP_IDENTITY_CHANGED' });
  assert.equal(help.getConversation('user:1').conversation.messages.length, 0);
});
