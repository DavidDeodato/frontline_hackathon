# Frontline — estado da implementação

23 de outubro de 2026 · versão de trabalho · snapshot de código de 15h10 BRT.

A [demonstração pública](https://frontline-production-4f55.up.railway.app) está publicada com o código `a65b907`. O deploy final, a interface, a conta e a preservação de sessão foram verificados em HTTPS. Essa verificação funcional não representa aceite visual final nem garantia semântica para todos os diálogos.

## Código incluído

- Interface React: biblioteca, criação e revisão de contexto, ensaio 2.5D, documentos, avaliação, comparação e registro.
- API Node.js e SQLite: visitante por cookie, sessões, versões, comandos idempotentes e isolamento entre usuários.
- Conversa contextual: interpretação da resposta, execução de regras do exercício e geração da reação do personagem a partir do estado resultante.
- Criação de exercícios por ferramenta de domínio, com contexto original preservado e rascunho revisável.
- Runtime único para interface e API, validação de origem, cookies seguros configuráveis, arquivos estáticos e orçamento de IA persistente.
- Dockerfile, exemplo de ambiente sem credenciais e instruções de operação.
- Exportação e verificação de integridade; adaptadores de WhatsApp e Solana Devnet desativados por padrão.
- Cadastro, login e logout integrados, preservação dos exercícios do visitante no cadastro e ajuda conversacional Fio separada do treino. A ajuda é bloqueada durante exercícios ativos ou pausados e compartilha a quota de IA do servidor.

## Verificações

| Verificação | Resultado | Limite |
|---|---|---|
| Instalação limpa | `npm ci --include=dev --offline --no-audit --no-fund`, 67 pacotes | Cache local; não valida disponibilidade do registro público |
| Testes automatizados | **210 aprovados, zero falhas, zero ignorados** | Provedores externos simulados; nenhuma chamada paga neste teste |
| Build | `npm run build`, 1.606 módulos | Compilação não comprova todas as interações nem acabamento visual |
| Integridade | 96 arquivos conferidos por SHA-256 | Mudanças posteriores da equipe ficam para outra publicação |
| IA real, ensaio anterior | 12 verificações mecânicas do fluxo passaram: contexto, ferramentas, versões, conversa, citações, persistência e acesso | Houve falha de papel do personagem no primeiro turno; não é aceite semântico geral |
| Correção do primeiro turno | Reteste pontual com duas chamadas reais e hashes do provedor correspondentes a esta versão | Não substitui nova validação completa de todos os diálogos |

Os testes e o build foram executados na cópia isolada desta publicação, com os arquivos conferidos por SHA-256 antes e depois. Incluem controles de conta, migração dos dados do visitante, ajuda, runtime, origem, persistência, orçamento, API, regras, conversas e integrações simuladas.

## Verificação no endereço público

- Railway confirmou deploy concluído, uma réplica e volume persistente em `/data`. Página, JS, CSS, biblioteca e health responderam HTTP 200; o servidor informou modo OpenAI.
- Uma sessão fictícia criada na versão anterior manteve o mesmo identificador, dois documentos consultados, a mensagem inicial e o estado pausado após a atualização do contêiner. Retomar e pausar funcionaram novamente.
- Cadastro preservou o exercício do visitante. Logout ocultou o histórico; login e recarregamento recuperaram a sessão. Cookies de autenticação foram observados com Secure e HttpOnly.
- A inspeção do navegador cobriu desktop e mobile. O lote final de rede teve 25 respostas HTTP 200 e nenhuma exceção observada; não é uma auditoria completa de acessibilidade ou desempenho.
- Uma única pergunta sintética de ajuda recebeu resposta OpenAI em HTTPS, com ações de navegação permitidas; o histórico permaneceu salvo após nova leitura. A chamada levou aproximadamente 3,9 segundos. Esse ensaio pontual não prova o fluxo inteiro de treinamento com IA no servidor público.

O limite configurado é de 36 chamadas e 46.800 tokens de saída reservados, compartilhado entre operações de IA. As contagens globais do ledger cloud não foram inspecionadas; não se afirma que a quota esteja intacta nem que o teste tenha sido a única utilização. Não houve redefinição do orçamento. Os 210 testes automatizados são o total da suíte; verificações adicionais não foram somadas como testes independentes.

## Limites atuais

- Verificação de email, recuperação de senha e autenticação por serviços externos não estão implementadas.
- O microserviço WhatsApp e a importação de relato foram acrescentados no commit `98c8c6d`. O teste completo de mensagem recebida, resposta e revisão na plataforma permanece pendente. Transações em Devnet continuam desativadas.
- Revisão responsiva, acessibilidade e fidelidade às dez idealizações visuais continuam pendentes.
- Testes pontuais com IA não demonstram robustez de todos os cenários, eficácia de aprendizagem ou certificação profissional.
- Persistência de sessão foi verificada após o deploy; o contador global da quota cloud não foi lido. Não reutilize bancos de teste nem reinicie o ledger para renovar orçamento.

## Reproduzir

Siga o [README](../../README.md) e as [instruções do runtime](../../runtime/README.md). Execute `npm test` e `npm run build`. O modo determinístico funciona sem credenciais. Evidências e bancos temporários de `qa/` são locais, sintéticos e ignorados pelo Git.

## Atualização de preparação por WhatsApp

Código publicado em `98c8c6d`: serviço independente em `services/whatsapp`, contrato de handoff e importação de texto pela biblioteca. A cópia isolada passou em 12 verificações de entrada/limites e 9 testes do serviço, sem chamadas de rede, além do build de 1.606 módulos. O pacote preserva os três arquivos de autenticação já publicados. Esta verificação adicional não repete nem amplia a comprovação semântica dos diálogos. Deploy cumulativo confirmado pela Railway em 23/10/2026 às 16:01 BRT. Página e health responderam HTTP 200; JS e CSS públicos correspondem byte a byte ao build revisado. Conexão do bot e teste humano de ponta a ponta são verificações separadas.

A atualização cumulativa `f774b08` acrescenta entrada por login e escolha explícita de visitante, mantendo os parâmetros do relato recebido. Build isolado: 1.607 módulos, sem erros. O bundle público `index-CDxten5U.js` foi confirmado no endereço canônico. A verificação HTTP e de integridade não substitui o teste de navegação no navegador; os testes públicos anteriores pertencem à versão precedente.
