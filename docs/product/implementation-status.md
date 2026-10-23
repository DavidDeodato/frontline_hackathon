# Frontline — estado da implementação

23 de outubro de 2026 · versão de trabalho · snapshot de código de 14h00 BRT.

O repositório contém o código do protótipo para colaboração e execução local. Esta publicação não é uma versão final homologada nem uma demonstração pública hospedada.

## Código incluído

- Interface React com biblioteca, preparação e revisão de contexto, ensaio, avaliação, comparação e telas de conexões e registro.
- Ambiente Three.js 2.5D, documentos consultáveis e guia de navegação Fio.
- API Node.js com SQLite, identidade de visitante, sessões persistidas, controle de versões, comandos idempotentes e isolamento entre usuários.
- Regras do exercício, três desfechos e avaliação com citações da conversa.
- Geração e revisão de exercícios por ferramenta de domínio, com contexto original preservado, versões e validação de compatibilidade.
- Adaptador OpenAI, exportação e verificação de integridade; adaptadores de WhatsApp e Solana Devnet com execução externa desativada por padrão.
- Contratos compartilhados e testes reproduzíveis.

Presença de código não comprova operação externa. As telas de integração devem refletir os recursos efetivamente habilitados no servidor.

## Verificações desta cópia

| Verificação | Resultado | Limite |
|---|---|---|
| Instalação limpa | Dependências instaladas em cópia isolada com `npm ci --include=dev --offline --no-audit --no-fund` | Usou cache local; rede pública do npm não foi validada neste teste |
| Build | `npm run build` passou, com 1.600 módulos transformados | Compilação não comprova acabamento ou todas as interações no navegador |
| Testes automatizados | `npm test`: **121 aprovados, zero falhas** | IA e serviços externos usam transportes simulados; não houve chamadas pagas |
| Consistência do código | Arquivos conferidos por SHA-256 contra a cópia congelada | Alterações posteriores da equipe pertencem às próximas publicações |

Os testes abrangem regras e finais, limite de mensagens, citações, contexto e revisões, API HTTP, persistência e reinício, isolamento, concorrência, exportação e controles dos adaptadores. Os resultados não demonstram eficácia de treinamento ou certificação de competência.

## Pendências para a versão estável

1. Validar geração, conversa e avaliação com OpenAI real.
2. Concluir a revisão integrada das dez telas, responsividade, acessibilidade e fidelidade visual.
3. Finalizar detalhes da apresentação do perfil do cliente e corrigir a largura excessiva observada na tela de registro.
4. Validar o fluxo completo da última versão integrada no navegador, sem depender de resultados de versões anteriores.
5. Configurar e verificar o endereço público de demonstração.

WhatsApp autenticado entre dispositivos e ancoragem pública em Devnet permanecem indisponíveis nesta publicação. A exportação e seus testes locais não comprovam envio de mensagens ou transações externas.

## Reproduzir

Siga o [README](../../README.md) para instalar e iniciar os dois processos. Para conferir código e build:

```sh
npm test
npm run build
```

O modo determinístico pode ser explorado sem credenciais. Os scripts adicionais em `qa/` produzem evidências e bancos temporários em `qa/evidence/`, pasta ignorada pelo Git. Não confundir esses dados de teste com dados de produção.
