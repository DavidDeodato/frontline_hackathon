# Integrações do Frontline

Este módulo fornece exportação verificável de uma avaliação, vinculação de canal e registro opcional de integridade na Solana Devnet. A API local expõe exportação e verificação. WhatsApp e ancoragem externa permanecem desativados: os testes usam identidades sintéticas, armazenamento temporário e RPC simulado.

Os imports não iniciam processos, acessam rede, carregam credenciais nem abrem banco. Node.js 24 fornece SQLite e criptografia; nenhuma dependência adicional é necessária.

## Exportar e verificar uma revisão

O contrato público está em [INTEGRATIONS_CONTRACT.md](../../shared/INTEGRATIONS_CONTRACT.md).

| Endpoint | Resultado |
|---|---|
| `GET /api/integrations/status` | Capacidades e motivos de indisponibilidade |
| `GET /api/sessions/:id/export` | `{document, filename}` após verificar o dono da sessão |
| `POST /api/exports/verify` | Consistência do arquivo e comparação opcional com uma sessão autorizada |

`createSessionExport(session)` aceita uma tentativa terminada com avaliação. Confere a versão do cenário, o limite de oito mensagens e três respostas, os três critérios da rubrica e as citações literais de falas do participante. Falta de evidência precisa estar explicitamente identificada. O documento preserva a origem `fixture` ou `openai`.

A projeção exportada inclui cenário, regras, transcrição, consequência e avaliação; exclui identidade da conta, estado interno, traces do provedor e os campos brutos de contexto e política. O usuário deve revisar o conteúdo antes de compartilhá-lo: texto escrito na conversa pode conter informações pessoais.

O envelope `frontline.export/1` tem `schemaVersion`, `payload` e `integrity`. O hash SHA-256 cobre `canonicalJSON({schemaVersion,payload})`. O formato `frontline.sorted-json/1` ordena chaves de objetos lexicograficamente, preserva a ordem dos arrays e serializa valores JSON finitos usando `JSON.stringify`. Há limite de 1 MiB e profundidade 32. Este formato não alega conformidade com RFC 8785.

```js
const { document, filename } = createSessionExport(authorizedSession);
const fileContents = JSON.stringify(document, null, 2);
const check = verifySessionExport(fileContents, {
  expectedSha256: currentAuthorizedExport.document.integrity.sha256
});
```

Sem referência confiável, `valid: true` significa apenas consistência interna e `matchesTrustedExport` é `null`. Alguém pode modificar um arquivo e recalcular seu próprio hash. Com `sessionId`, a API busca a sessão autorizada e fornece a referência; nunca usa um hash esperado enviado pelo navegador como prova de autenticidade. Uma cópia consistente mas diferente recebe `DIFFERENT_REFERENCE`. A verificação local sempre retorna `anchored: false`.

## Persistência e identidade

`createIntegrationStore(db)` inicializa explicitamente a tabela aditiva `integration_records(namespace,key,data)` na conexão SQLite recebida. Não altera as tabelas de domínio. Transações usam savepoints síncronos; chamadas de rede ficam fora delas. Registros e recibos sobrevivem ao reinício quando o banco é persistente.

Os métodos recebem um principal criado pela autenticação do servidor. Campos como `authenticated` e `id` em JSON do cliente não concedem identidade. O dono da API deve aplicar ACL, limitar requisições e mapear `IntegrationError.status` e `.code` para a resposta HTTP. O cookie de visitante local não permite vinculação entre dispositivos.

O banco é privado: armazena identificadores internos e recibos com códigos temporários. Códigos, callbacks, segredos de assinatura e conteúdo do banco não devem ser registrados em logs ou enviados ao frontend fora da resposta autorizada do vínculo. A chave de canal é um HMAC; o número completo não é persistido pelo adapter.

## Vínculo e continuidade pelo WhatsApp

`createWhatsAppAdapter` é uma máquina de estados integrada por uma ponte autenticada. Não inicia Baileys nem envia mensagens. Para habilitar a ponte, são necessários autenticação real de conta, segredo HMAC no servidor, transporte de mensagens verificado e uma autorização aplicável à operação externa.

O fluxo é `pending → awaiting_confirmation → linked → revoked`. O código aleatório tem 192 bits, expira por padrão em cinco minutos e só pode ser consumido uma vez. O recebimento do código pela ponte ainda exige confirmação na conta web. Um canal não pode pertencer a duas contas. O modo `fixture` sempre retorna `fixture_linked` e `connected: false`.

Interface:

- `status(principal)` consulta o estado atual.
- `beginLink(principal,{commandId,expectedRevision})` cria um código temporário.
- `confirmLink(principal,{linkId,commandId,expectedRevision})` confirma a reivindicação da ponte.
- `revokeLink(principal,{commandId,expectedRevision})` invalida código e associação.
- `receiveCallback(rawBody,{timestamp,signature})` recebe um evento assinado.

O timestamp é uma string de milissegundos Unix. A assinatura é `sha256=<hex>` de HMAC-SHA256 sobre `timestamp + '.' + rawBody`, sem reserializar o corpo. `signBridgePayload` produz esse formato. A janela aceita é de cinco minutos e o corpo tem no máximo 16 KiB.

Eventos suportados:

```js
// Valores ilustrativos; não são códigos ou canais reais.
{ eventId: 'event-example', type: 'link.claim', code: '<temporary-code>',
  channelId: '<bridge-channel>', direct: true, fromSelf: false }
{ eventId: 'resume-example', type: 'session.resume', sessionId: '<session>',
  channelId: '<bridge-channel>', direct: true, fromSelf: false }
```

Comandos são idempotentes por conta e `commandId`; mudar o conteúdo de um comando já usado causa conflito. Repetições devolvem o estado atual, sem ressuscitar vínculo revogado ou devolver código expirado/consumido. Eventos repetidos também conferem revogação, prazo e ACL. A retomada consulta o resolver síncrono `resolveSession(ownerId,sessionId)` a cada acesso, preservando a tentativa e a revisão corrente. O link exige login; não é um token de acesso e não reinicia a conversa. Todas as respostas mantêm `externalDelivery: 'not_attempted'`.

## Registro opcional na Solana Devnet

`createDevnetAdapter({store,transport,executionAuthorized:false})` gerencia os recibos. `createSolanaDevnetTransport({secretKey,allowSend:false})` implementa a transação e o RPC. Ambos negam envio por padrão; a aplicação não oferece uma rota habilitada para ancoragem nesta versão.

Quando uma execução externa for autorizada, o backend precisa fornecer o documento e o hash calculado da sessão autenticada. O adapter publica somente versão, tipo, schema e SHA-256. Nome, conta, sessão, telefone e transcrição não entram no Memo. Integridade não certifica autoria, competência nem correção da avaliação.

O transporte usa apenas o endpoint oficial Devnet, valida o genesis hash, verifica a taxa e o saldo de teste, simula a transação assinada e aceita uma preparação imutável do próprio transporte uma única vez. O teto configurável de taxa não pode exceder 10.000 lamports. Não há faucet automático, transferência, configuração Mainnet ou repetição automática de envio.

| Estado | Significado |
|---|---|
| `not_requested` | Nenhum registro solicitado |
| `preparing` | Intenção persistida; preparação em andamento |
| `needs_reconciliation` | Assinatura persistida antes do envio, ou confirmação ainda incerta |
| `submitted` | RPC reconheceu a assinatura; confirmação ainda pendente |
| `confirmed` | Consulta encontrou a assinatura, signatário e Memo esperados em transação confirmada/finalizada |
| `failed` | Preparação recusada ou transação falhou |

`requestAnchor(principal,{document,expectedSha256,commandId})` deduplica por dono e hash. Persiste a assinatura antes do broadcast; um timeout não dispara outro envio. `reconcile(principal,sha256)` consulta o recibo. Uma resposta pendente atrasada não sobrescreve um resultado terminal. Falhas e interrupções não geram nova tentativa automática; exigem análise do registro antes de uma política futura de recuperação.

A serialização usa transação legacy, assinatura Ed25519 e uma instrução Memo. Referências: [estrutura de transações Solana](https://solana.com/docs/core/transactions/transaction-structure) e [Memo Program](https://www.solana-program.com/docs/memo).

## Verificação local

```sh
node --test tests/integrations*.test.mjs
```

Os testes cobrem exportação adulterada e referência confiável, isolamento, citações, expiração, uso único, revogação, replay, persistência após reinício, assinatura e layout da transação, gates antes de rede, teto de taxa, envio único e reconciliação concorrente. A suíte usa fixtures e RPC simulado; não prova entrega de mensagens nem ancoragem pública. A conexão WhatsApp e a execução Devnet de ponta a ponta continuam pendentes.
