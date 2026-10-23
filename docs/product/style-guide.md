# Frontline — guia de estilo

Versão 1.0 · direção visual do protótipo · 23 de outubro de 2026

## Identidade

O nome é **Frontline**, com a mesma grafia e wordmark em todas as vistas. O produto é uma interface de prática: a informação deve orientar uma ação, uma decisão ou uma revisão. Evitar frases de campanha no espaço de trabalho, indicadores decorativos e mudanças de logo entre telas.

| Token | Valor | Uso |
|---|---|---|
| Navegação | `#161C22` | Shell e áreas estruturais grafite |
| Superfície | `#F4F6F6` | Área principal clara |
| Texto | `#18242A` | Leitura, títulos e informação essencial |
| Acento | `#37CFDB` | Ação principal, seleção e foco |
| Atenção | `#AC633E` | Condição que exige análise, sempre acompanhada de texto |

Ciano não significa automaticamente sucesso. Estados precisam de rótulo e, quando útil, ícone. Contraste e foco devem ser medidos na implementação; uma cor definida não comprova acessibilidade.

## Tipografia e composição

Usar uma família sans-serif legível, com fallback de sistema. Títulos distinguem contexto; rótulos compactos explicam estado; corpo confortável preserva leitura de documentos e conversa. Evitar tipografia pontilhada em texto corrido, títulos enormes e painéis que pareçam slides.

O shell é um componente único. Navegação, espaçamentos, botões, bordas e cabeçalhos se repetem por função. A tela de ensaio dá destaque à cena e ao diálogo; avaliação e comparação priorizam evidências. Cada superfície mantém uma ação seguinte identificável.

## Componentes compartilhados

| Componente | Conteúdo obrigatório |
|---|---|
| Cartão de episódio | Título, contexto, estado e ação de abrir/continuar |
| Editor de contexto | Texto original preservado, geração, revisão e erro recuperável |
| Fato ou regra | Origem ou condição, valor e indicação de desconhecido |
| Mensagem | Autor, conteúdo e estado de envio; não duplicar após reenvio |
| Documento | Título, conteúdo, estado consultado e retorno claro à conversa |
| Compromisso | Proposta, condições pendentes e aceite; não confundir os três |
| Critério de avaliação | Rótulo qualitativo, evidência e orientação |
| Comparação | Identificação das duas tentativas, versão e ponto de divergência |
| Canal | Estado real do vínculo, ação de conectar ou revogar |
| Registro | Conteúdo exportado, versão e estado de verificação |

Vazios explicam como começar; carregamentos preservam contexto; erros oferecem recuperação sem apagar entrada. A interface não deve fingir respostas, processamento ou confirmação externa.

## Cena 2.5D construível

Uma sala em corte, com câmera ortográfica fixa. Base, duas paredes, balcão, prateleiras e objetos derivam de caixas, cilindros e planos. A composição usa sombras suaves e poucos materiais consistentes.

Roberto é uma figura geométrica estilizada. Não são necessários pele realista, cabelo detalhado, roupa com física, animação esquelética ou caminhada livre. Reações discretas e realce de seleção bastam para comunicar mudança de foco.

Três objetos têm função: **ordem de serviço**, **política** e **agenda**. Seus controles e conteúdos são HTML, acompanhados de uma lista acessível com as mesmas ações. A consulta altera informação disponível e estado do exercício; a decoração não substitui comportamento.

## Consistência de conteúdo

- Mariana Oliveira é a participante; Roberto Almeida é o cliente fictício.
- O episódio é **A viagem de amanhã**.
- O reparo permanece sem prazo confirmado, mesmo quando o empréstimo é combinado.
- No estado anterior ao aceite, mostrar proposta ou condição pendente, nunca acordo concluído.
- A avaliação usa três critérios e trechos reais da tentativa correspondente.
- Contadores, documentos e consequências precisam pertencer à mesma versão do cenário.
- WhatsApp conectado e registro confirmado só podem aparecer como estados reais após confirmação; imagens desses estados são conceitos de design.

## Responsividade e verificação

Em telas menores, a cena pode recolher. Conversa, documentos, estado e ação principal continuam acessíveis. A sequência por teclado deve acompanhar a tarefa, com foco visível e retorno previsível ao fechar painéis.

A [galeria](../visuals/index.html) é referência visual. Antes de declarar fidelidade, comparar a interface renderizada com as imagens, conferir legibilidade, estados, nomes e ações. Medir desempenho no dispositivo de demonstração; não presumir taxa de quadros pela simplicidade da geometria.
