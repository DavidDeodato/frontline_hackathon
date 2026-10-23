# Frontline

**Cada escolha tem uma consequência.**

Pratique conversas difíceis, entenda consequências e experimente outra resposta.

Frontline é um simulador narrativo de atendimento profissional. A pessoa prepara uma situação, conversa com um cliente fictício, consulta informações no ambiente e recebe uma avaliação ligada às próprias falas. Uma nova tentativa permite comparar decisões sem colocar um cliente real em risco.

![Idealização do ensaio Frontline: ambiente 2.5D, documentos e conversa com Roberto](docs/visuals/images/scene/04-ensaio-v2.png)

*Idealização visual do produto. Esta imagem representa a direção de design; não é uma captura do aplicativo em execução.*

## Para quem

Mariana, nossa persona de design, está começando no suporte de uma empresa de comércio eletrônico. Ela conhece o procedimento, mas precisa praticar como explicar limites e negociar alternativas quando um cliente está frustrado. Roberto é o personagem do exercício — o cliente atendido por Mariana, não outro usuário da plataforma.

No episódio **A viagem de amanhã**, Roberto precisa de um aparelho antes de viajar. O reparo não tem prazo confirmado. Existe uma alternativa de empréstimo, mas suas condições precisam ser consultadas e confirmadas. O que Mariana responde muda o compromisso que pode assumir.

## A experiência

- **Preparar:** escolher um episódio ou descrever uma situação e revisar seu contexto.
- **Praticar:** conversar por texto em uma sala 2.5D com ordem de serviço, política e agenda.
- **Compreender:** receber três critérios de avaliação, trechos da conversa e uma melhoria concreta.
- **Experimentar:** repetir o exercício e comparar consequências, preservando a tentativa anterior.
- **Continuar:** retomar sessões salvas; WhatsApp e exportação verificável fazem parte da expansão planejada.

**Demonstração:** [abrir Frontline](https://frontline-production-4f55.up.railway.app). Versão de trabalho; atualizações podem causar uma breve indisponibilidade.

## Estado do projeto

**Protótipo em desenvolvimento, criado para o DevDay Community Hackathon São Paulo de 23 de outubro de 2026.** A proposta parte do desafio #5, com mecânicas narrativas inspiradas no #10. O recorte de inscrição é a simulação de atendimento profissional.

Este repositório disponibiliza uma **versão de trabalho do código**, junto à especificação de produto e às dez idealizações visuais. O código pode ser estudado e executado localmente; ainda não é uma versão final homologada. Consulte o [estado da implementação](docs/product/implementation-status.md) para conhecer as verificações e pendências desta publicação. A jornada completa e a fidelidade visual continuam em revisão. A publicação inicial teve HTML, assets e API verificados no endereço público. Os ambientes e personagens são fictícios; resultados de treino não representam certificação profissional nem eficácia de aprendizagem comprovada.

| Camada | Estado desta versão |
|---|---|
| Web, API e persistência local | Runtime publicado e verificado em HTTPS; validação completa da jornada pendente |
| Conta e ajuda Fio | Cadastro, login e guia contextual integrados; sem verificação de email ou recuperação de senha |
| Cenário demonstrativo | Um personagem, três decisões e três finais definidos |
| OpenAI | Adaptador e conversa contextual presentes; testes reais pontuais, sem garantia semântica geral |
| WhatsApp, banco cloud e registro em blockchain | Integrações planejadas; não apresentadas como fluxo concluído |
| Imagens da plataforma | Conceitos visuais; não comprovam implementação |

## Executar localmente

As instruções abaixo executam o protótipo local. A demonstração determinística não exige credenciais.

Requer **Node.js 24 ou superior** e npm. A persistência local usa SQLite nativo do Node.

```sh
npm ci --include=dev
```

Em um terminal, inicie a API:

```sh
npm run server
```

Em outro, inicie a interface:

```sh
npm run dev
```

Abra [http://127.0.0.1:5182](http://127.0.0.1:5182). A API local usa a porta `8782`; seu estado está em `/api/health`.

Sem `OPENAI_API_KEY` e `OPENAI_MODEL` definidos no processo do servidor, o protótipo utiliza **fixture**, uma simulação determinística identificada na interface. Esse modo não interpreta livremente o contexto com IA. Para usar o adaptador OpenAI, configure ambas as variáveis apenas no servidor e confira o modo retornado pelo health check. Nunca inclua chaves no código, no frontend ou em commits.

O arquivo `.env` não é carregado automaticamente por `npm run server`. Se optar por criá-lo localmente a partir de `.env.example`, inicie a API com:

```sh
node --env-file=.env server/index.mjs
```

`FRONTLINE_API_PORT` altera a porta da API; se alterá-la, ajuste também o proxy de desenvolvimento. A chave e o modelo são opcionais para explorar o cenário determinístico.

Comandos disponíveis no projeto:

```sh
npm test
npm run build
```

Esses comandos permitem verificar a versão local; sua presença aqui não representa uma alegação de testes aprovados. O runtime em `runtime/` reúne interface e API na mesma origem, com persistência SQLite e orçamento de IA durável. A configuração pública precisa de origem HTTPS exata, cookies Secure e volume persistente; veja [runtime/README.md](runtime/README.md).

## Executar interface e API juntas

Após instalar as dependências:

```sh
npm run build
npm start
```

Sem configuração adicional, esse runtime usa o modo determinístico em `http://127.0.0.1:8782`. Para usar `.env.example` com porta 3000 e origem `http://localhost:3000`, copie-o localmente para `.env` e execute `node --env-file=.env runtime/start.mjs`. O modo OpenAI exige `FRONTLINE_PROVIDER_MODE=openai`, credenciais no servidor e limites explícitos. Há um `Dockerfile` para Node.js 24; persistência deve ser montada em `/data`.

## Documentação

- [Estado da implementação e verificações](docs/product/implementation-status.md)
- [Solução completa: problema, personas, telas, dados e integrações](docs/product/solution.md)
- [Guia de estilo e limites de construção](docs/product/style-guide.md)
- [Roteiro de demonstração de três minutos](docs/product/demo.md)
- [Arquivo da galeria visual](docs/visuals/index.html) — abra localmente após clonar; no GitHub, o link mostra o código HTML, não um site publicado.

As dez vistas podem ser abertas diretamente como imagens:

| Preparação | Prática e revisão | Continuidade planejada |
|---|---|---|
| [Biblioteca](docs/visuals/images/flows/01-biblioteca.png) | [Ensaio 2.5D](docs/visuals/images/scene/04-ensaio-v2.png) | [Conectar WhatsApp](docs/visuals/images/channels/08-whatsapp-v2.png) |
| [Criar situação](docs/visuals/images/flows/02-contexto-v2.png) | [Documentos](docs/visuals/images/scene/05-documento.png) | [Retomar pelo WhatsApp](docs/visuals/images/channels/09-continuidade-v2.png) |
| [Revisar contexto](docs/visuals/images/flows/03-revisao-v2.png) | [Avaliação](docs/visuals/images/scene/06-avaliacao.png) | [Registro e exportação](docs/visuals/images/channels/10-registro.png) |
| | [Comparar tentativas](docs/visuals/images/flows/07-comparacao.png) | |

## Estrutura

```text
web/                 Interface React e cena Three.js
server/              API HTTP, regras, provedor e persistência
shared/              Cenário e contrato compartilhados
tests/               Testes do protótipo
docs/product/        Produto, design e demonstração
docs/visuals/        Idealizações da experiência
```

## Dados e limites

As sessões demonstrativas não executam empréstimos, reservas ou contatos reais. É possível praticar como visitante ou criar uma conta. O cadastro preserva os exercícios do visitante atual; login não importa automaticamente o histórico de outro visitante. Email não é verificado e recuperação de senha não está implementada. Não use informações de clientes reais nos exercícios públicos. Uma avaliação deve se apoiar na conversa e indicar quando não houver evidência suficiente.
