# Frontline — serviço WhatsApp
Microserviço Node independente. Recebe somente DMs com `!bot `, pede à OpenAI um briefing de prática e devolve link Frontline com contexto para revisão humana. Não cria treino, não autentica usuário na plataforma e não acessa histórico. O link contém o contexto informado; use relatos fictícios e anonimizados.

Instalação: `npm ci`; execução: `npm start`. Configure OPENAI_API_KEY, OPENAI_MODEL, ADMIN_TOKEN (mínimo24 caracteres), AUTH_DIR=/data/auth e volume persistente /data. Use uma única réplica/sessão. Nunca copie auth, .env, logs ou banco para o repositório/imagem.

GET /health informa processo/conexão. GET /admin/status requer Bearer ADMIN_TOKEN; painel / permite parear QR. Baileys é integração não oficial; pode exigir reconexão. Filtros ignoram grupos, histórico, mensagens antigas e próprias; ledger deduplica e limita30 chamadas. Sem ferramentas de negócio ou envio proativo. Falha/crash pode perder resposta; não há exactly-once.

`npm test` valida filtros e handoff. prepareTraining é função local determinística; não é ferramenta chamada pelo modelo. O briefing usa chamada real Responses; o link transporta o relato original validado entre1e2000caracteres; acima disso pede reenvio sem cortar. Backend Frontline continua responsável por gerar/revisar/publicar treino após ação humana.
