# Validação e entrega

Este documento propõe um roteiro para a futura aplicação. Nenhum caso abaixo foi executado em software: o repositório foi iniciado com documentação.

## Backlog inicial

| Ordem | Entrega | Aceite | Evidência esperada |
| --- | --- | --- | --- |
| 1 | Obter os três critérios da organização | C1, C2 e C3 preenchidos com a fonte | Rubrica identificada e RF04 conferido |
| 2 | Cenário e diálogo livre até oito interações | RF01 a RF03 | Execução completa com histórico e contador |
| 3 | Feedback fundamentado | RF04 | Avaliação com exemplos verificáveis e melhoria concreta |
| 4 | Erros e acessibilidade básica | RNF01 e RNF02 | Casos de falha, teclado e tela pequena |
| 5 | Consequências, indicadores e finais | RF05 e RF07 | Duas partidas comparáveis com finais diferentes |
| 6 | Progresso local | RF06 | Fechar, reabrir, retomar e reiniciar |
| 7 | Publicação, vídeo e submissão | Entregáveis de E02 | URL testada, vídeo cronometrado e confirmação de envio |

As ordens 2 a 4 formam o núcleo do desafio #5. Os diferenciais narrativos não devem atrasar a conversa completa e sua avaliação.

## Cama de teste mínima proposta

Hipótese de funcionamento: uma sessão respeita os limites e produz feedback rastreável, inclusive após retomada ou erro. Executar na aplicação disponível, registrando versão, ambiente, entrada e saída; um checklist preenchido sem execução não constitui evidência.

| Caso | Como testar | Sinal de aprovação |
| --- | --- | --- |
| T01, caminho cooperativo | Usar a resposta empática do roteiro e concluir | Respostas coerentes com Roberto e com o histórico |
| T02, caminho alternativo | Recomeçar e usar a resposta inadequada do roteiro | Consequência perceptível; finais distintos se RF07 implementado |
| T03, limite | Enviar oito mensagens válidas e tentar uma nona | Contador consistente, bloqueio do nono envio e acesso à avaliação |
| T04, avaliação | Comparar as evidências citadas com o histórico | Três critérios corretos, trechos existentes e uma melhoria concreta |
| T05, entrada vazia | Enviar vazio ou apenas espaços | Nenhum avanço nem mensagem vazia no histórico |
| T06, falha | Interromper uma requisição em ambiente de teste | Erro legível, sem duplicação ou perda do estado confirmado |
| T07, retomada | Fechar e reabrir após duas interações | Histórico, contador e características preservados |
| T08, reinício e dado inválido | Reiniciar; depois testar armazenamento inválido | Sessão limpa ou recuperação explícita, sem misturar partidas |
| T09, acesso | Percorrer por teclado e em viewport móvel | Fluxo principal operável, legível e sem depender apenas de cor |
| T10, link público | Abrir a URL em sessão sem autenticação de desenvolvimento | Jornada acessível e completa na versão publicada |

## Métricas simples e limites

- Funcionamento: resultado de cada caso e quantidade de falhas observadas.
- Fidelidade do feedback: quantidade de citações conferidas e quantidade sem correspondência; alvo proposto de zero citação inventada nos casos testados.
- Limite da sessão: zero nono envio aceito nos casos de fronteira.
- Publicação: SHA implantado, URL e data da verificação; publicar arquivos no GitHub não demonstra deploy.
- Vídeo: duração medida de até 180 segundos, com meta de 175.
- Uso futuro: conclusão de sessão e capacidade de explicar uma melhoria, conforme H02 em [personas](02-produto-e-personas.md).

Coerência da IA, eficácia de treinamento, retenção e disposição a pagar exigem avaliações próprias. Duas partidas e build aprovado não comprovam melhoria no atendimento real.

## Registro de execução a preencher

| Campo | Estado |
| --- | --- |
| SHA da aplicação avaliada | A preencher |
| Ambiente e URL | A preencher |
| Comandos ou passos efetivamente executados | A preencher |
| Evidências dos casos T01 a T10 | A preencher |
| Limitações e falhas encontradas | A preencher |
| Vídeo e duração | A preencher |
| Confirmação de submissão | A preencher |

O aceite de implementação depende dessas evidências e da rubrica oficial. A documentação atual entrega a definição consolidada, não o produto executável.
