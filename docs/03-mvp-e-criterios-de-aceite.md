# MVP e critérios de aceite

> Registro da concepção inicial, anterior à implementação. Para o estado atual do produto e da entrega, consulte [estado da implementação](product/implementation-status.md) e [roteiro atual de demonstração](product/demo.md). As pendências e descrições de ausência de código abaixo pertencem àquele momento inicial.

MVP significa produto mínimo viável. Aqui, a prioridade proposta é uma sessão completa de treinamento, da apresentação do caso ao feedback, antes de expandir personagens ou funcionalidades.

## Escopo derivado do chat

Base: desafio #5, conforme E02 em [contexto e fontes](01-contexto-e-fontes.md). Requisitos centrais: um personagem, um cenário, interação por texto, até oito interações por sessão e avaliação por três critérios fornecidos, citando exemplos da conversa.

Proposta do GPT: incorporar do #10 duas características do jogo, progresso salvo e finais diferentes. O limite de até cinco decisões relevantes e três finais é uma restrição narrativa voluntária; não substitui o teto de oito interações do #5. A futura implementação precisa definir como as mensagens se agrupam nos momentos de decisão.

## Requisitos e aceite proposto

| ID | Prioridade | Requisito | Critério de aceite |
| --- | --- | --- | --- |
| RF01 | Essencial | Apresentar o caso de entrega atrasada e Roberto | Antes do primeiro envio, o participante consegue ler cenário, objetivo e limite da sessão |
| RF02 | Essencial | Receber respostas em texto livre | Aceita texto próprio; não depende exclusivamente de alternativas prontas; rejeita envio vazio sem avançar |
| RF03 | Essencial | Conduzir conversa coerente e limitada | Mantém personagem, cenário e histórico; contabiliza até oito envios aceitos do participante; impede um nono envio e permite encerrar para avaliação |
| RF04 | Essencial | Avaliar pelos três critérios fornecidos | Cada critério tem justificativa e exemplo verificável do histórico; há uma sugestão concreta de melhoria; não inventa falas |
| RF05 | Diferencial | Exibir empatia e resolução como características do jogo | As alterações são perceptíveis e vinculadas a uma decisão; não são apresentadas como critérios oficiais nem medidas psicológicas |
| RF06 | Diferencial | Salvar e retomar a sessão localmente | Reabrir preserva histórico, contador e características; reiniciar limpa a sessão anterior; dado inválido oferece recuperação sem travar |
| RF07 | Diferencial | Produzir consequências e finais diferentes | Duas execuções do mesmo caso podem demonstrar finais distintos; proposta de três finais: satisfeito, resolução parcial e atendimento malsucedido |
| RNF01 | Essencial | Tratar falhas com clareza | Uma falha de resposta não duplica mensagens nem consome uma nova interação confirmada; oferece ação de recuperação |
| RNF02 | Essencial | Permitir uso em tela pequena e por teclado | Campo, envio e resultado acessíveis por teclado; texto legível e indicadores compreensíveis sem depender apenas de cor |

RF significa requisito funcional; RNF descreve uma condição de qualidade. São especificações propostas, ainda sem implementação ou resultado de teste.

## Lacuna que afeta o aceite

Os nomes e descrições dos três critérios fornecidos pela organização não aparecem nos trechos recuperados. Registrar como **A preencher**:

| Critério | Nome oficial | Descrição oficial |
| --- | --- | --- |
| C1 | A preencher | A preencher |
| C2 | A preencher | A preencher |
| C3 | A preencher | A preencher |

Empatia e resolução são indicadores narrativos propostos e não resolvem essa lacuna. Antes de alegar cumprimento integral do desafio, obter a rubrica da organização e conferir a correspondência com RF04. Os quatro critérios da banca, com peso de 25%, são outra camada de avaliação.

## Abordagem técnica sugerida no chat

Narrativa estruturada com IA para diálogo e avaliação. O estado da sessão deve controlar limites, histórico e conclusão. O armazenamento local foi sugerido para a retomada sem autenticação. Nenhuma stack, modelo, API, mecanismo de pontuação ou contrato de persistência está implementado ou aprovado neste repositório.

Ficam para uma evolução posterior: múltiplos cenários, múltiplos personagens, voz, autenticação, integrações empresariais e painéis de gestão. Antes de implementar qualquer fluxo, conferir os consumidores e contratos existentes no estado mais recente do código.
