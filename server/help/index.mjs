import { randomUUID, createHash } from 'node:crypto';
import { AppError } from '../engine.mjs';

export const HELP_ACTIONS = Object.freeze({
  open_library: 'Ver exercícios',
  open_preparation: 'Criar uma situação',
  open_reviews: 'Abrir revisões',
  open_records: 'Ver registros',
  open_channels: 'Ver conexões',
  highlight_documents: 'Mostrar documentos',
});

export const HELP_KNOWLEDGE = Object.freeze({
  product: 'Frontline, prática de atendimento profissional com um cliente fictício.',
  guide: 'Fio explica a interface e os recursos. Não responde pelo participante e não avalia sua habilidade.',
  library: 'Biblioteca reúne cenários disponíveis e tentativas do visitante ou da conta atual. É possível usar um exercício pronto.',
  preparation: 'Criar situação recebe um relato e regras. A geração produz um rascunho revisável, não inicia o exercício. O domínio atual é assistência/pós-venda. Revise fatos, regras e lacunas antes de iniciar.',
  practice: 'No ensaio, consulte ordem de serviço, política e agenda. Converse com um cliente fictício. O recorte atual admite três respostas do participante e até oito mensagens visíveis. O estado do servidor determina as consequências, não promessas do cliente.',
  pause: 'É possível pausar e retomar o ensaio. O rascunho local e a última ação confirmada são coisas distintas: aguarde a confirmação antes de fechar.',
  reviews: 'Depois de concluir, veja três critérios, trechos da conversa e uma melhoria. Uma nova tentativa pode ser comparada à anterior sem apagá-la. Não é certificação profissional nem prova de aprendizado.',
  records: 'Registros permitem exportar dados da tentativa e verificar a integridade da cópia. Um hash local não é prova de registro em blockchain.',
  channels: 'A tela Conexões apresenta o estado real dos canais. WhatsApp e blockchain ainda não devem ser descritos como conectados ou disponíveis. Não envie dados sensíveis.',
  account: 'Pode praticar como visitante ou criar uma conta. O cadastro preserva os exercícios do visitante atual quando integrado. Login não importa histórico de outro visitante. Email não é verificado e não há recuperação automática de senha nesta versão.',
  limits: 'Não executar ações, criar links, inventar recursos, prometer eficácia ou fornecer a resposta ideal ao cliente. Para perguntas fora do produto, explicar o limite e oferecer ajuda de navegação. Não solicitar senha ou credenciais no chat.',
});

const views = new Set(['library', 'preparation', 'scenario', 'practice', 'review', 'reviews', 'compare', 'records', 'record', 'channels', 'continuity', 'login', 'register']);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function localGuide(text) {
  const query = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/whats|conex|canal|blockchain|solana/.test(query)) return { text: 'Em Conexões você confere o estado real dos canais. WhatsApp ainda não está habilitado nesta versão. A exportação tem verificação de integridade; isso não significa um registro em blockchain.', actionIds: ['open_channels', 'open_records'] };
  if (/senha|cadast|conta|login|entrar/.test(query)) return { text: 'Use Entrar ou Criar conta no menu do seu perfil. No cadastro, informe nome, email e senha; nunca envie sua senha aqui. Você também pode continuar como visitante. A verificação de email e a recuperação de senha ainda não estão disponíveis.', actionIds: [] };
  if (/export|registro|integridade|hash/.test(query)) return { text: 'Em Registros você acessa a exportação da tentativa e confere a integridade de uma cópia. O registro preserva a versão do cenário e a conversa daquele exercício.', actionIds: ['open_records'] };
  if (/compar|tentativa|refaz|repet|rebobin/.test(query)) return { text: 'Abra uma revisão concluída e escolha uma nova tentativa. A conversa anterior é preservada. Depois de concluir a nova, compare as decisões e as evidências das duas tentativas.', actionIds: ['open_reviews'] };
  if (/avali|feedback|criter|nota|revis/.test(query)) return { text: 'Ao concluir um ensaio, a revisão reúne três critérios, trechos da sua conversa e uma oportunidade de melhoria. Esses critérios descrevem aquela tentativa; não são uma certificação profissional.', actionIds: ['open_reviews'] };
  if (/document|politica|agenda|ordem de servico/.test(query)) return { text: 'Durante o ensaio, os documentos ficam junto da conversa: ordem de serviço, política e agenda. Eles mostram fatos e limites da situação. Consulte-os sem sair do exercício.', actionIds: ['highlight_documents'] };
  if (/criar|situacao|contexto|personaliz|cena/.test(query)) return { text: 'Na Biblioteca, escolha Criar situação. Descreva o atendimento e as regras, gere o rascunho e revise fatos e lacunas antes de iniciar. O domínio disponível hoje é assistência e pós-venda.', actionIds: ['open_preparation'] };
  if (/responder|resposta|roberto|cliente|ganhar/.test(query)) return { text: 'Posso explicar os controles e onde estão as informações, mas não responder pelo participante. No ensaio, consulte os documentos e escolha sua própria abordagem. Depois, a revisão explica o resultado com trechos da conversa.', actionIds: ['open_library'] };
  return { text: 'Você pode escolher um exercício, criar uma situação de assistência/pós-venda, praticar uma conversa, consultar documentos e revisar o resultado. Depois, tente outra abordagem e compare. Por onde quer começar?', actionIds: ['open_library', 'open_preparation', 'open_reviews'] };
}

export function createHelp({ db, provider, now = () => Date.now(), assertCanChat = () => {} }) {
  db.exec(`CREATE TABLE IF NOT EXISTS help_conversations(
    id TEXT PRIMARY KEY, owner TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS help_messages(
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES help_conversations(id),
    seq INTEGER NOT NULL, role TEXT NOT NULL CHECK(role IN ('user','assistant')),
    text TEXT NOT NULL, created_at TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'guide', UNIQUE(conversation_id,seq)
  );
  CREATE TABLE IF NOT EXISTS help_commands(
    conversation_id TEXT NOT NULL REFERENCES help_conversations(id), command_id TEXT NOT NULL,
    payload_hash TEXT NOT NULL, result TEXT NOT NULL,
    PRIMARY KEY(conversation_id,command_id)
  );`);
  if (!db.prepare('PRAGMA table_info(help_messages)').all().some(column => column.name === 'mode')) db.exec("ALTER TABLE help_messages ADD COLUMN mode TEXT NOT NULL DEFAULT 'guide'");
  const locks = new Map();
  const mode = () => provider?.mode === 'openai' ? 'openai' : 'guide';
  const timestamp = () => new Date(now()).toISOString();
  const find = owner => db.prepare('SELECT * FROM help_conversations WHERE owner=?').get(owner);
  function conversation(owner) {
    if (typeof owner !== 'string' || !owner) throw new AppError(401, 'IDENTITY_REQUIRED', 'Identifique sua sessão para abrir a ajuda.');
    let row = find(owner);
    if (!row) {
      db.prepare('INSERT OR IGNORE INTO help_conversations VALUES(?,?,?)').run(randomUUID(), owner, timestamp());
      row = find(owner);
    }
    return row;
  }
  function envelope(owner, actions = []) {
    const row = conversation(owner);
    const messages = db.prepare('SELECT id,seq,role,text,mode,created_at AS createdAt FROM help_messages WHERE conversation_id=? ORDER BY seq').all(row.id).map(message => ({ ...message }));
    return { conversation: { id: row.id, messages, mode: mode() }, actions };
  }
  async function serialized(owner, task) {
    const prior = locks.get(owner) || Promise.resolve();
    const current = prior.catch(() => {}).then(task);
    locks.set(owner, current);
    try { return await current; } finally { if (locks.get(owner) === current) locks.delete(owner); }
  }
  async function sendMessage(owner, input, { assertIdentity = () => {} } = {}) {
    const { commandId, text, view } = input || {};
    if (typeof commandId !== 'string' || !commandId.trim() || commandId.length > 100 ||
      typeof text !== 'string' || !text.trim() || text.length > 1000 || !views.has(view)) {
      throw new AppError(422, 'INVALID_HELP_MESSAGE', 'Escreva uma dúvida de até 1.000 caracteres.');
    }
    return serialized(owner, async () => {
      assertIdentity();
      const row = conversation(owner);
      const payloadHash = digest({ text, view });
      const prior = db.prepare('SELECT * FROM help_commands WHERE conversation_id=? AND command_id=?').get(row.id, commandId);
      if (prior) {
        if (prior.payload_hash !== payloadHash) throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Este envio já foi utilizado com outro conteúdo.');
        return JSON.parse(prior.result);
      }
      assertCanChat(owner);
      const current = envelope(owner);
      if (current.conversation.messages.length >= 80) throw new AppError(429, 'HELP_HISTORY_LIMIT', 'O histórico de ajuda atingiu o limite desta demonstração.');
      const since = new Date(now() - 60_000).toISOString();
      const recent = db.prepare("SELECT COUNT(*) AS n FROM help_messages WHERE conversation_id=? AND role='user' AND created_at>?").get(row.id, since).n;
      if (recent >= 6) throw new AppError(429, 'HELP_RATE_LIMIT', 'Aguarde um minuto antes de enviar outra dúvida.');
      let reply;
      if (mode() === 'openai') {
        if (typeof provider.help !== 'function') throw new AppError(503, 'HELP_UNAVAILABLE', 'A ajuda com IA ainda não está disponível. Use as orientações da tela.');
        reply = await provider.help({
          history: current.conversation.messages.slice(-12).map(({ role, text }) => ({ role, text })),
          text, view, knowledge: HELP_KNOWLEDGE, allowedActions: Object.keys(HELP_ACTIONS),
        });
      } else reply = localGuide(text);
      if (!reply || typeof reply.text !== 'string' || !reply.text.trim() || reply.text.length > 1800 ||
        !Array.isArray(reply.actionIds) || reply.actionIds.length > 3 || reply.actionIds.some(id => !Object.hasOwn(HELP_ACTIONS, id))) {
        throw new AppError(503, 'INVALID_HELP_RESPONSE', 'A ajuda não retornou uma resposta válida. Sua pergunta pode ser reenviada.');
      }
      const actions = [...new Set(reply.actionIds)].map(id => ({ id, label: HELP_ACTIONS[id] }));
      db.exec('BEGIN IMMEDIATE');
      try {
        assertIdentity();
        assertCanChat(owner);
        // A concurrent account registration may have claimed this guest's data
        // while the provider was responding. Do not write under stale ownership.
        if (find(owner)?.id !== row.id) throw new AppError(409, 'HELP_IDENTITY_CHANGED', 'Sua identidade mudou. Abra a ajuda novamente antes de continuar.');
        const seq = current.conversation.messages.length;
        const insert = db.prepare('INSERT INTO help_messages(id,conversation_id,seq,role,text,created_at,mode) VALUES(?,?,?,?,?,?,?)');
        insert.run(randomUUID(), row.id, seq + 1, 'user', text, timestamp(), mode());
        insert.run(randomUUID(), row.id, seq + 2, 'assistant', reply.text, timestamp(), mode());
        const result = envelope(owner, actions);
        db.prepare('INSERT INTO help_commands VALUES(?,?,?,?)').run(row.id, commandId, payloadHash, JSON.stringify(result));
        db.exec('COMMIT');
        return result;
      } catch (cause) { db.exec('ROLLBACK'); throw cause; }
    });
  }
  return { getConversation: owner => envelope(owner), sendMessage };
}
