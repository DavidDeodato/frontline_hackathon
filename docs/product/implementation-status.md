# Frontline — estado da implementação

23 de outubro de 2026 · versão de trabalho · snapshot de código de 15h04 BRT.

O código desta publicação permite colaboração e execução local. Não representa aceite visual final nem garantia de operação pública. O endereço de demonstração será informado após a verificação do deploy.

## Código incluído

- Interface React: biblioteca, criação e revisão de contexto, ensaio 2.5D, documentos, avaliação, comparação e registro.
- API Node.js e SQLite: visitante por cookie, sessões, versões, comandos idempotentes e isolamento entre usuários.
- Conversa contextual: interpretação da resposta, execução de regras do exercício e geração da reação do personagem a partir do estado resultante.
- Criação de exercícios por ferramenta de domínio, com contexto original preservado e rascunho revisável.
- Runtime único para interface e API, validação de origem, cookies seguros configuráveis, arquivos estáticos e orçamento de IA persistente.
- Dockerfile, exemplo de ambiente sem credenciais e instruções de operação.
- Exportação e verificação de integridade; adaptadores de WhatsApp e Solana Devnet desativados por padrão.
- Componentes iniciais de contas e ajuda conversacional. São módulos em desenvolvimento: esta cópia não oferece essas extensões como jornada integrada.

## Verificações

| Verificação | Resultado | Limite |
|---|---|---|
| Instalação limpa | `npm ci --include=dev --offline --no-audit --no-fund`, 67 pacotes | Cache local; não valida disponibilidade do registro público |
| Testes automatizados | **182 aprovados, zero falhas, zero ignorados** | Provedores externos simulados; nenhuma chamada paga neste teste |
| Build | `npm run build`, 1.603 módulos | Compilação não comprova todas as interações nem acabamento visual |
| Integridade | 86 arquivos conferidos por SHA-256 | Mudanças posteriores da equipe ficam para outra publicação |
| IA real, ensaio anterior | 12 verificações mecânicas do fluxo passaram: contexto, ferramentas, versões, conversa, citações, persistência e acesso | Houve falha de papel do personagem no primeiro turno; não é aceite semântico geral |
| Correção do primeiro turno | Reteste pontual com duas chamadas reais e hashes do provedor correspondentes a esta versão | Não substitui nova validação completa de todos os diálogos |

Os 182 testes foram executados na cópia anterior com fontes idênticos aos desta publicação. A revisão seguinte removeu artefatos privados e reforçou apenas `.dockerignore`; instalação e build foram conferidos novamente na cópia sanitizada. Os testes incluem controles de runtime, origem, persistência e limites de orçamento, além de API, regras, conversas e integrações simuladas.

## Limites atuais

- A identidade integrada nesta cópia é de visitante por cookie. Login e ajuda conversacional completa ainda estão em integração.
- WhatsApp entre dispositivos e transações em Devnet não estão habilitados. Presença de adaptador não comprova uma operação externa.
- Revisão responsiva, acessibilidade e fidelidade às dez idealizações visuais continuam pendentes.
- Testes pontuais com IA não demonstram robustez de todos os cenários, eficácia de aprendizagem ou certificação profissional.
- Persistência e quota em ambiente cloud precisam de verificação após o deploy. Não reutilize bancos de teste em produção.

## Reproduzir

Siga o [README](../../README.md) e as [instruções do runtime](../../runtime/README.md). Execute `npm test` e `npm run build`. O modo determinístico funciona sem credenciais. Evidências e bancos temporários de `qa/` são locais, sintéticos e ignorados pelo Git.
