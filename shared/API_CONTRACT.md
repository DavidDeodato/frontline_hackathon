# Frontline API — contrato v0.1

Correção aditiva v0.1e: [TURN_CONTRACT.md](TURN_CONTRACT.md) condiciona a fala real ao resultado do domínio, com candidato em memória e persistência única após retorno válido. Não muda endpoints ou DTOs públicos existentes.

Extensão compatível de autoria e revisão conversacional: [AUTHOR_CONTRACT.md](AUTHOR_CONTRACT.md), author.v0.2a / provider ai.v0.3. Novo fluxo usa ferramenta real, versões de draft e expectedVersion ao publicar; endpointsP0 permanecem compatíveis.

## Correção compatível v0.1d — fala e consequência

Mariana Oliveira é a participante e atendente (`role=user`); Roberto Almeida é o cliente simulado (`role=npc`). Em modo OpenAI, cada mensagem do cliente contém somente a resposta contextual validada do modelo. Não concatenar uma fala de fixture, não trocar o papel e não mascarar falha semântica com prefixo ou sufixo fixo. Consequências autoritativas permanecem em `commitment`, `attributes`, `ending` e no estado do servidor, apresentadas separadamente pela interface. Esses campos não autorizam o cliente a falar como atendente. Fixture preserva suas respostas predefinidas e rotuladas. O limite de três respostas do participante e oito mensagens permanece.

## Delta aditivo v0.1c

O rascunho preserva integralmente `rawContext` e `rawPolicyText`. Pode conter `contextNeed:string`, `contextUnknowns:string[]` e `contextualFacts:[{id,text,status:'provided'|'unknown'|'fictional',sourceQuote:string}]`. Uma origem fornecida deve citar literalmente um trecho do contexto ou da política; lacunas e premissas de simulação permanecem distintas de fatos confirmados. A revisão humana precede a publicação. O catálogo suportado permanece assistência/pós-venda.

A geração pode propor disponibilidade e prazo de empréstimo com evidência literal, através do contrato `AI_CONTRACT.md`. O servidor valida e projeta `rules`, fatos, política e finais alcançáveis. Ausência de regra no relato mantém premissa fictícia revisável, nunca uma alegação de extração confirmada. Regex não substitui a interpretação do modelo no modo OpenAI.

`Session.assessmentError?:{code,message}` identifica uma avaliação que falhou e pode ser repetida. A conversa persistida não desaparece nem se duplica por esse erro. `providerTrace?` admite somente metadados sem segredos. O modo OpenAI nunca cai silenciosamente para fixture.

Correção de calendário: início fictício23out2026, retorno27out2026; `rules.clientReturnDays=4`. Prazo de3dias não cobre o retorno; prazo de7dias termina30out. As duas condições do cliente devem ser confirmadas em resposta anterior ao acordo. Autonomia2 autoriza negociar, mas não conclui acordo.

Modo real consome intenção estruturada com evidência literal por flag verdadeira e resposta contextual. Consequências e limites são validados no servidor; o texto original é preservado. Exatamente3critérios únicos da rubrica, citações literais de mensagensuser ou ausência explícita de evidência. Os endpointsP0 e campos anteriores permanecem compatíveis.

Mariana Oliveira é atendente iniciante de e-commerce; Roberto Almeida é cliente simulado. O episódio demonstrativo trata de pós-venda de aparelho em assistência técnica. A política e os fatos do cenário delimitam as consequências da conversa. Alterações incompatíveis neste contrato exigem nova versão.

## Runtime

Node 24; backend ESM .mjs com HTTP e SQLite nativos, dados em data/ (ignorado pelo Git). Dependências de Vite, React e Three.js estão fixadas no package-lock.json. Porta web 5182; API 8782; proxy /api no desenvolvimento. O modo fixture é determinístico e identificado na interface. O adaptador OpenAI usa Responses com credencial somente no servidor; sua existência não comprova o fluxo completo com modelo real. PostgreSQL/Neon é uma integração planejada.

## DTOs de fio JSON

`Scenario`: {id, version, title, summary, state, label, facts:[{id,text,status,sourceObject}], policy:{id,version,title,terms:string[],unknowns:string[]}, rubric:{id,version,label,criteria:[{id,name,observable}]}, render, graph, rawContext?, rules?:{loanAvailable:boolean,loanDays:number,clientReturnDays:number,clientHasIdentity:boolean,repairEta:null}}. Fixture canônica shared/scene.json; mapear scenario+facts+policy+rubric+render+graph em um Scenario de resposta.

`Message`: {id, role:'npc'|'user'|'summary', speaker, text, seq}.

`Session`: {id,revision,status:'active'|'paused'|'completed'|'cancelled'|'incomplete',scenarioId,scenarioVersion,scenario:Scenario,mode:'fixture'|'openai',messages:Message[],attributes:{preparo:number,autonomia:number},documentsRead:string[],commitment:{status:'none'|'draft'|'valid'|'unsupported',text:string,sourceMessageId?:string},ending:null|{id,title,consequence},evaluation:null|{criteria:[{criterionId,name,rating,quote,messageId,reason}],opportunity:string},parentSessionId?:string,createdAt,updatedAt}.

`Error`: {error:{code,message},session?:Session}. HTTP401/404ownership,409revision/idempotency/turnlimit,422invalid,503provider. Preservar rascunho frontend. Identidade guest por cookie opaco servidor, seguraHttpOnlySameSite; não é login multiplataforma. APIs não aceitam ownerId como autorização.

## Endpoints P0

- GET /api/health → {status:'ok',providerMode:'fixture'|'openai',contractVersion:'0.1'}
- GET /api/library → {scenarios:Scenario[],sessions:Session[]}
- POST /api/drafts {text:string,policyText?:string} → {draft:Scenario}. Não apresentar simples troca de nomes como geração contextual real; modo fixture é identificado.
- PATCH /api/drafts/:id {title?,summary?,facts?,policy?,rubric?,rules?:{loanAvailable?,loanDays?}} → {draft:Scenario}. Delta aditivo v0.1a: rules explicitamente validadas alteram permissões reais; disponibilizar controle provisório disponível e prazo de devolução1..7. Texto da política é projeção coerente dessas regras, não fonte desconectada.
- POST /api/drafts/:id/publish {} → {scenario:Scenario}; valida exatamente3critérios,1NPC,3finais.
- POST /api/sessions {scenarioId,scenarioVersion?} → {session:Session}
- GET /api/sessions/:id → {session:Session}
- POST /api/sessions/:id/messages {text,commandId,expectedRevision} → {session:Session}
- POST /api/sessions/:id/documents {objectId,commandId,expectedRevision} → {session:Session}
- POST /api/sessions/:id/pause|resume|cancel {commandId,expectedRevision} → {session:Session}
- POST /api/sessions/:id/branches {beforeMessageId?,commandId,expectedRevision} → {session:Session}. Primeiro suporte pode ramificar desde abertura, rotulado claramente.
- POST /api/sessions/:id/assessment/retry {commandId,expectedRevision} → {session:Session}
- GET /api/compare?left=:id&right=:id → {left:Session,right:Session,sameContext:boolean}

## Invariantes congelados

Delta aditivo v0.1b: `Scenario.graph.availableEndingIds` declara os finais alcançáveis com as regras atuais. O catálogo mantém três finais; END-01 fica indisponível quando não há aparelho provisório ou quando as condições do cliente não cabem na política. A fixture padrão permite e deve provar os três; uma adaptação incompatível não promete os três nem fabrica estoque. Os consumidores devem usar a disponibilidade declarada ao explicar o cenário.

Até8mensagens:1abertura+3usuario+2NPCintermediárias+1NPCencerramento+1resumoavaliação. Trêsdecisões no máximo. Documentos não consomem fala. Preparo0..2 por ordem/política consultadas uma vez. Autonomia0nãoconsultada;1políticaconsultada/podeapresentar;2identidade+devoluçãoaté7diasconfirmadas/podecombinar. Autonomia2nãoéacordoconcluído. Os3finais estão emgraph, comincomplete/cancelledsemfinal comoestadotécnico. Promessaerradaépreservada, nãoviraestoque/prazoverdadeiro. ConsertosemETA. Avaliação3critérios, quotesliteralmenteexistentesemmensagensuser;semnotaoucompetênciacertificada.

Persistir comando+estado+resultado numatransação; commandId+payloadigual idempotente, diferente409. expectedRevisionchecada. Originalpreservadono branch. Mudançadecontextocriaversão,nãoreescrevesessão. ModoOpenAI usa histórico+fatossó,propõeintents,servidorvalida. Nenhumenvioexterno/deploy/WAativoautorizadonestaonda.
