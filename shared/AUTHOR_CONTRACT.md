# Autoria de exercício — author.v0.2a / provider ai.v0.3

Direção: Frontline monta o exercício pelo relato livre. Configuração manual é ajuste avançado opcional. Não há seleção obrigatória de ambiente/personagem nem promessa de qualquer profissão. Único template executável nesta versão: `assistencia`; ambiente e domínio existentes preservados.

## Autor com ferramenta real

Assinatura: `provider.draft(text,policyText='',{currentDraft=null,revisionText='',executeTool})`.

Em modo OpenAI são no máximo2requests por autoria/revisão. Round1 oferece a ferramenta `compose_exercise` strict,parallel_tool_calls=false,tool_choice=required; argumentos `{operation:'create'|'revise',proposal:DraftSchema}`. DraftSchema é a proposta contextual ai.v0.2. A operação esperada vem do contexto confiável do backend; chamada desconhecida,múltipla,ausente ou divergente é rejeitada,sem efeito.

Delta author.v0.2b aditivo: ToolDraftSchema ai.v0.3 exige `clientBrief:{objective:string,traits:string[],initialState:string}` (limites400/3×160/400caracteres). É caracterização fictícia para o exercício: objetivo,comportamentos observáveis e estado inicial em linguagem natural; não diagnóstico/escala psicológica nem autoridade sobre fatos/regras. Backend valida e conserva no Scenario; modeloRoberto recebe o cenário completo e o histórico/compromisso atual prevalece sobre o estado inicial. UI pode resumir em preview sem formulário obrigatório. Propostas legadas podem omitir e receber default fictício explícito.

ToolDraftSchema também exige `compatibility:{supported:boolean,reason:string,sourceQuote:string}` para o catálogo assistência. Se unsupported, reason não vazio e sourceQuote literal de fonte recebida justificam422UNSUPPORTED_CONTEXT; não persistir candidate nem fabricar adaptação silenciosa. Não usar regex para decidir domínio. Se supported, todas as validações mecânicas continuam obrigatórias. Falha preserva input e draft anterior.

Callback: `executeTool(name,{operation,proposal})` → `{candidate,validation:{valid:true,environmentId:'assistencia',availableEndingIds:string[]}}`. Backend valida schema,proveniência,regra,pessoa/catálogo,permissão e versão. Compõe em memória; não publica/persiste resultado parcial. Candidate é o Scenario com identidade/versão confiáveis do servidor.

Round2 recebe output da chamada anterior e function_call_output com o resultado estruturado. Retorna somente `{authorMessage:string}` conciso para revisão; não pode substituir candidate. Provider retorna `{candidate,authorMessage,authorTool:{name:'compose_exercise',operation,validation}}`. Persistência ocorre apenas depois do retorno final válido. Autoria real não é inferida de animação/roteiro; existe chamada de ferramenta executada e resposta recebida pelo modelo.

Modo fixture é explicitamente rotulado e determinístico,sem fingir interpretação de relato. Compatibilidade pode retornar null/resultado fixture já contratado; resultado de ferramenta simulada não prova execução OpenAI.

## HTTP e persistência

- POST /api/drafts `{text,policyText?,commandId?}` → `{draft}`. Novos clientes enviam commandId estável; legado semchave permanece compatível. Mesma chave/payload retorna o mesmo rascunho sem novo modelo; diferente409.
- POST /api/drafts/:id/revisions `{text,commandId,expectedVersion}` → `{draft}`. Texto é pedido de alteraçãoNL; preserva relato/política originais,consulta a versão atual e compõe candidato da próxima versão. ACLguest,serialização porrascunho,revisioncheck antes/depois do modelo,recibo idempotente transacional.
- GET /api/drafts/:id/versions → `{versions:[{version,createdAt,requestText?,draft}]}` do próprio visitante. Versões anteriores preservadas; não misturar autorizações.
- PATCH /api/drafts/:id mantém controles avançados com `expectedVersion?`; novos clientes enviam a versão esperada. Continua projetando fatos/política das regras suportadas.
- POST /api/drafts/:id/publish `{expectedVersion?,commandId?}` → `{scenario}`. Novos clientes enviam expectedVersion; stale409 nunca publica silenciosamente outra versão. Começar usa o scenarioId e scenarioVersion retornados.

Draft adiciona `authorMessage?`, `authorTool?`, `revisionHistory?:[{version,requestText,createdAt}]`. Histórico/origens podem citar relato original,política original ou pedidos de revisão anteriores/atual; `sourceQuote` continua literal. Candidate não reescreve rawContext para esconder o original. Snapshot de sessão é imutável em relação a revisões futuras.

Erros: unknown/invalidtool,modelquota,timeout,finalinválido preservam draft anterior e inputUI; draftversionconflict409 retorna erro recuperável. Nenhum retry automático de modelo. Falha pode ter consumido tokens; budget não reinicia. Teto total desta rodada6requests/8000outputtokens,cap1300porrequest (6×1300=7800reservados).

## UI e aceite

Preparation mantém relato,mostra resumo/preview útil,origens/lacunas e CTA Começar; campo opcional de alteraçãoNL dispara `onRevise(text):Promise<boolean>`. Falha mantém texto e draft. Controles avançados não são etapa obrigatória. Se realmente indispensável,autor faz uma pergunta por vez; caso contrário utiliza premissas fictícias explícitas. Incompatibilidade de domínio é explicada antes de iniciar.

Aceite: relato distinto muda campos suportados; revisãoNL altera versão preservando histórico; idempotência não duplica geração; cenárioincompatível declarado; Começar executa exatamente versão revisada; erro preservaentrada. Provasoffline e reais identificadas separadamente. Nenhum novo ambiente está autorizado por este delta.
