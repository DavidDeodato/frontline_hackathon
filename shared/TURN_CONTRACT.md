# Turno condicionado ao domínio — turn.v0.4 / provider ai.v0.4

Correção de consistência do fluxo existente. Sem nova tela, canal, ambiente ou mudança no limite de três respostas e oito mensagens.

## Sequência e autoria

`provider.turn(session,text,{executeTurn})` realiza no máximo duas requests, reservadas atomicamente antes da primeira chamada. O texto completo, os fatos e o histórico continuam disponíveis. A primeira request escolhe a ferramenta `apply_training_turn`, com argumentos strict `{intent,evidence}`. Cada flag descreve exclusivamente um ato de Mariana na última mensagem, independente de o empréstimo já poder ser aprovado. Perguntar documento ou devolução é `askIdentity`/`askReturn`, mesmo sem acordo. Perguntar se um provisório ajudaria é oferta exploratória (`offerLoan`), não confirmação de empréstimo. Evidências verdadeiras são substrings literais da mensagem; não inferir flags de uma resposta futura do cliente.

O callback `executeTurn('apply_training_turn',{intent,evidence})` valida argumentos e projeta uma única transição em memória. Retorna `{candidate,validation:{valid:true},responseContext}`. `candidate` pertence ao backend; contém a mensagem do usuário e o estado projetado, ainda sem nova mensagem do cliente. Não grava banco, recibo, revisão nem resposta provisória. `responseContext` resume consequências permitidas e recusadas, confirmação de identidade/devolução, compromisso, final e limites derivados desse estado.

A segunda request recebe o resultado real da ferramenta e redige somente `{reply:string}` como Roberto. Não faz nova chamada de ferramenta. Deve respeitar o estado projetado: empréstimo não aprovado não pode ser aceito na fala; uma pergunta por condição pode ser respondida pelo cliente conforme os fatos. O modelo não decide o resultado final por meio de texto livre.

Provider retorna `{intent,evidence,reply,turnTool:{name:'apply_training_turn',status:'validated'}}`. Backend confere que intenção/evidência retornadas coincidem com os argumentos executados, finaliza o candidato capturado com a reply validada e persiste uma única vez. Não reaplica a transição nem confia em um candidato devolvido pelo modelo. Em fixture, a assinatura anterior permanece válida e a resposta é explicitamente predefinida.

## Concorrência e falhas

Permissão, commandId, payload e expectedRevision continuam verificados antes e depois das chamadas. Erro no modelo, ferramenta ou finalização preserva sessão/recibo/revisão anterior. O cliente mantém a entrada para nova tentativa explícita. Nenhum fallback silencioso, retry automático, parser por palavras-chave ou apêndice de fala fixa no modo OpenAI.

O orçamento é explícito por rodada; restaurar snapshots preserva consumo. O default conservador do processo não é um limite funcional universal do produto. Uma rodada com nove requests e11700tokens deve ser criada e registrada explicitamente; não alterar silenciosamente o ledger de rodadas encerradas.

## Evidência mínima

Replay identificado dos outputs que falharam; testes de literalidade, flags de pergunta, callback único, estado recusado, rollback após ferramenta, versão concorrente, reply única e três turnos. O teste real verifica criação2requests, três turnos2requests cada e avaliação1request, com leitura independente de opening, falas, final e citações. Passar schema não comprova semântica.
