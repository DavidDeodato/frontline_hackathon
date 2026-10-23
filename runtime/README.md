# Runtime público do Frontline

`npm start` executa `runtime/start.mjs` em Node.js 24. O processo serve o build de `dist/` e encaminha `/api` para a API do produto na mesma origem. O build precisa existir antes do início:

```sh
npm ci --include=dev
npm run build
npm start
```

O modo padrão é `fixture`, mesmo que haja uma chave no ambiente. Importar o módulo não inicia servidor ou chamadas. `createRuntime({env,distDir,fetchImpl,onTelemetry})` constrói o runtime; `startRuntime` também inicia a escuta e retorna `{server,provider,budget,config,close}`. O chamador que importa a função é responsável por aguardar `close()` ao encerrar.

## Configuração

| Variável | Comportamento |
|---|---|
| `HOST` | `127.0.0.1` por padrão; usar `0.0.0.0` no container |
| `PORT` | Porta fornecida pela plataforma; fallback `FRONTLINE_API_PORT`, depois 8782 |
| `FRONTLINE_DATA_DIR` | Diretório persistente; padrão `data/` do projeto; Docker usa `/data` |
| `FRONTLINE_PUBLIC_ORIGIN` | Origem exata, incluindo esquema e porta, sem caminho; obrigatória para bind público |
| `FRONTLINE_SECURE_COOKIES` | `true`/`false`; padrão derivado de HTTPS; HTTPS não permite `false` |
| `FRONTLINE_PROVIDER_MODE` | `fixture` ou `openai`, explicitamente |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Somente no ambiente do servidor; obrigatórias no modo `openai` |
| `FRONTLINE_MAX_REQUESTS` | Limite operacional explícito; até 36 |
| `FRONTLINE_MAX_OUTPUT_TOKENS` | Reserva operacional explícita; até 46800 |

Para uso local no endereço `http://localhost:5184`, definir `PORT=5184`, `FRONTLINE_PUBLIC_ORIGIN=http://localhost:5184` e cookies sem Secure. A origem deve corresponder ao endereço usado no navegador: `localhost` e `127.0.0.1` não são intercambiáveis para essa validação.

Para o container preparado, montar um volume em **`/data`**, cobrindo tanto `frontline.sqlite` quanto `operational-budget.sqlite` e seus arquivos WAL/SHM. Não montar apenas um arquivo. Usar uma réplica. A aplicação não precisa acessar o banco durante o build; os arquivos são abertos no início do runtime. `GET /api/health` informa o modo do provedor, sem consumir quota.

## Quota operacional persistente

O ledger `operational-budget.sqlite` é separado dos bancos e rodadas de QA. A configuração operacional autorizada é **36 reservas de requisição, 46800 tokens de saída reservados, no máximo 1300 por requisição**. Os números precisam ser fornecidos explicitamente no modo `openai`. O runtime não amplia limites por conta própria.

Uma reserva é persistida por transação SQLite síncrona antes de o provedor receber permissão para chamar a rede. `reserveMany` reserva todas as etapas de uma ação de uma vez. Portanto, uma ação de duas etapas pode consumir duas reservas mesmo se apenas a primeira chamada for executada e falhar. `usedRequests` mede reservas; não é uma contagem de respostas concluídas ou de chamadas realmente feitas. Não há reembolso automático após falha ou timeout.

Reiniciar conserva limites, contadores e suspensão. Dois handles do banco compartilham a mesma quota. Qualquer mudança nos limites configurados em relação ao ledger existente falha no início, sem apagar ou redefinir o registro. `stop()` persiste a suspensão. Não remova nem troque o ledger para renovar orçamento; uma nova autorização de orçamento exige um procedimento explícito de continuidade.

Não existem chamadas de modelo em import, boot, health, leitura de arquivos ou reinício. O provedor só é acionado pelas operações da API demandadas pela interface. Isso não autentica uma pessoa nem impede um cliente automatizado de chamar a API: a quota é global e finita, e o cookie continua sendo identidade de visitante, não login de conta.

## HTTP e arquivos

- `/api` e `/api/*` preservam respostas JSON da API e nunca recebem fallback SPA.
- Requisições de API com `Origin` divergente são recusadas mesmo se o `Host` corresponder. Operações de escrita exigem a origem configurada; clientes HTTP de teste também precisam enviá-la. Não há CORS amplo.
- Somente arquivos dentro do caminho real de `dist/` são servidos. Dotfiles, traversal, barras invertidas e symlinks que escapem do diretório são recusados.
- GET/HEAD preservam MIME e tamanho; assets ausentes respondem 404. Navegações HTML sem extensão recebem `index.html`. O runtime não serve `.local`, fontes do servidor, bancos ou arquivos de ambiente.
- Cookies são `HttpOnly`, `SameSite=Lax` e `Secure` quando a origem é HTTPS. O proxy TLS deve preservar o encaminhamento normal da requisição; headers arbitrários de proxy não concedem origem confiável.

## Verificação

```sh
node --test tests/integrations-runtime.test.mjs
```

Sete testes focados cobrem HTTP real em loopback, MIME/HEAD/SPA, erros API, contenção de arquivos, origin/cookies, isolamento e restauração de sessão, reservas atômicas, restauração de suspensão, dois handles e persistência antes de fetch simulado. O teste de provedor usa chave sintética e `fetchImpl` falso; não realiza chamadas OpenAI.

Esses testes não comprovam deploy, visual do frontend, disponibilidade pública ou uso real do modelo. O processo de release precisa verificar build final, navegador, HTTPS, volume após restart e limites no destino autorizado.
