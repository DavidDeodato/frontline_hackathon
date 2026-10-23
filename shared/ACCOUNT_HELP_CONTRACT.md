# Conta e ajuda — account-help.v0.1

## Entrada explícita — atualização v0.1b

Ao abrir o site, a interface aguarda a consulta da conta. Sem conta autenticada e sem escolha explícita de visitante nesta aba, apresenta login. Erro de consulta não concede acesso automático. O botão Continuar como visitante registra uma escolha deliberada; logout volta ao login. Contas válidas preservam o acesso. Links de preparação do WhatsApp e seus textos devem sobreviver à passagem pelo login ou à escolha de visitante. Este controle de entrada da interface não elimina a API de visitante nem cria autenticação pelo WhatsApp.

Extensão aditiva. Visitante, treino e versões existentes são preservados.

## Conta

GET /api/account -> {authenticated:boolean,user:null|{id,name,email}}
POST /api/account/register {name,email,password} -> mesmo envelope; cria sessão.
POST /api/account/login {email,password} -> mesmo envelope; cria nova sessão.
POST /api/account/logout {} -> {authenticated:false,user:null}; revoga sessão e limpa account e guest cookies.

Cadastro: nome 2–80, email normalizado e válido até254, senha10–128. Hash scrypt com salt aleatório. Token de sessão aleatório, só hash no banco, expiração, HttpOnly/SameSite=Lax/Secure conforme ambiente. Sem token no localStorage. Erros seguros {error:{code,message}} conforme API vigente. Registro concorrente deve respeitar email único. Limitar tentativas. Sem alegar email verificado nem recuperação de senha que ainda não existe.

Owner estável `user:<id>` somente internamente; auth.resolve(cookie) não expõe token. Invalid/stale auth cookie não pode virar acesso ao guest antigo. Registro pode reivindicar dados do guest atual transacionalmente (scenarios,drafts,sessions,draft_versions,draft_commands,help_conversations quando existir). Login não importa histórico guest implicitamente. Logout descarta cookieguest antigo para impedir acesso aos registros da conta. UI atualiza biblioteca e limpa caches em mudança de identidade.

Interface: #/login e #/register; acesso visitante permitido. Rotas existentes não são bloqueadas globalmente. Nome real no menu; Visitante quando sem conta. Não salvar senha em armazenamento local nem telemetria. Fio animado reutiliza o componente oficial, sem logo/mascote alternativo.

## Ajuda

GET /api/help/conversation -> {conversation:{id,messages:[{id,seq,role,text,createdAt}],mode:'guide'|'openai'},actions:[]}
POST /api/help/messages {commandId,text,view} -> mesmo envelope com actions da última resposta.

Limites: texto1–1000, commandId1–100, view allowlist. Uma conversa de ajuda por owner; máximo40turnos, histórico de até80mensagens. seq é ordem autoritativa, timestamp apenas apresentação. Roles user/assistant. FK mensagens->conversa. Índice unique(conversation_id,seq). Isolamento por owner. Idempotência por commandId, payload divergente409. Erro de provedor preserva histórico confirmado e texto na UI; não cria resposta falsa. Não misturar com messages de treino ou avaliação.

Delta aditivo: cada mensagem também informa mode:'guide'|'openai' de sua origem. A UI deve preservar esse rótulo quando o histórico atravessar mudança de provedor; conversation.mode indica a capacidade atual, não converte retrospectivamente respostas locais em IA.

Ações permitidas: open_library,open_preparation,open_reviews,open_records,open_channels,highlight_documents. API retorna {id,label}; UI executa somente clique explícito e ação mapeada localmente. Sem URLs, seletores, HTML ou código arbitrário do modelo. Não ler transcript de treino. Se treino ativo/pausado, ajuda conversacional permanece indisponível e tutorial orienta apenas uso dos controles, sem resposta ao cliente.

Backend aplica assertCanChat(owner) antes de chamar provedor e novamente dentro da transação de commit; consulta estado active/paused no banco, não confia no view enviado pelo browser. GET continua permitindo ler histórico. Pedido confirmado idempotente pode recuperar somente sua resposta já persistida.

Modo guide: instruções locais determinísticas, label “Guia da plataforma”; não é atividade de IA. Modo openai: provider.help usa request/budget vigente e retorna JSON validado. Se serviço indisponível, erro honesto, sem fallback oculto. Nenhum worker faz chamada paga; gestor decide prova sob orçamento existente.

## DoD

1. Cadastro/login/logout, dados persistem em reinício, sessão expira, duas contas isoladas.
2. Guest mantém jornada; cadastro preserva seus exercícios; logout não vaza histórico.
3. Fio conversa sobre recursos presentes, histórico ordenado/idempotente e ações só explícitas.
4. Erros honestos, label guide/OpenAI correto, sem interferir nos limites de treino.
5. Build e testes focados; login e ajuda desktop/mobile/teclado/console.
6. A integração preserva os contratos e a jornada existentes; testes locais não comprovam implantação externa.
