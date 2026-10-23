# Frontline — estado da implementação

23 de outubro de 2026 · versão de trabalho · snapshot de código de 15h10 BRT.

O código desta publicação permite colaboração e execução local. A [demonstração pública](https://frontline-production-4f55.up.railway.app) teve o núcleo anterior verificado em HTTPS às 15h11 BRT. A atualização de conta e Fio ainda será conferida nesse destino; não representa aceite visual final.

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

Na publicação anterior, Railway confirmou deploy concluído, uma réplica e volume em `/data`. A verificação HTTP confirmou página, JS, CSS, biblioteca e health em modo OpenAI, com cookies Secure e HttpOnly. A preservação de uma sessão existente após a atualização ainda está em verificação.

## Limites atuais

- Conta e ajuda possuem testes locais. Verificação de email, recuperação de senha e autenticação por serviços externos não estão implementadas.
- WhatsApp entre dispositivos e transações em Devnet não estão habilitados. Presença de adaptador não comprova uma operação externa.
- Revisão responsiva, acessibilidade e fidelidade às dez idealizações visuais continuam pendentes.
- Testes pontuais com IA não demonstram robustez de todos os cenários, eficácia de aprendizagem ou certificação profissional.
- Persistência e quota em ambiente cloud precisam de verificação após o deploy. Não reutilize bancos de teste em produção.

## Reproduzir

Siga o [README](../../README.md) e as [instruções do runtime](../../runtime/README.md). Execute `npm test` e `npm run build`. O modo determinístico funciona sem credenciais. Evidências e bancos temporários de `qa/` são locais, sintéticos e ignorados pelo Git.
