# Frontline UI composition — v1

Delta aditivo author.v0.2a: Preparation recebe `onRevise(text):Promise<boolean>`. Relato livre é principal, controles de regras ficam em ajuste avançado opcional. App chama POSTdraftrevisions comcommandId/expectedVersion e preserva texto emfalha; onPublish envia expectedVersion e Começar usa scenarioId/version do retorno. Fonte AUTHOR_CONTRACT.md. Screens renderiza o conteúdo; App coordena requests e navegação.

Tokens globais e shell ficam em styles.css; conteúdo e layout específico usam screens/*.css com prefixo .fl-screen. Este contrato preserva a API compartilhada.

Exports de Surfaces.jsx: Library, Preparation, ScenarioReview, Practice, Review, Comparison, Channels, Continuity, Record. App coordena navegação/requests e passa dados confirmados. Conteúdo permanece em Surfaces/screens.

- Library: scenarios,sessions,variant='library'|'reviews'|'records',busy,providerMode,onStart(scenario),onOpen(id),onCreate(),onInspect(scenario),onCompare(leftId,rightId).
- Preparation: draft,busy,providerMode,onCancel(),onGenerate(text,policyText),onPublish(changes).
- ScenarioReview: scenario,busy,onBack(),onConfirm(changes),editable=false.
- Practice: session,busy,error,onMessage(text),onDocument(objectId),onState(action),onReview().
- Review: session,sessions,comparison?,busy,onBranch(),onRetry(),onCompare(leftId),onExport(),onOpen(id).
- Comparison: comparison{left,right,sameContext},busy,onBranch(),onReview(id),onExport().
- Channels: session,onResume(),onContinuity().
- Continuity: session,busy,onResume(),onOpen().
- Record: session,busy,onBack(),onReview().

Compatibilidade acordada na convergência: App fornece Review.onConversation() além de onOpen(id); Comparison.onOpen(id) além de onReview(id); Continuity.onChannels() além de onOpen(); Record.onReview() além de onBack(). Aliases navegam para os mesmos dados, sem criar sessões.

FioGuide default em ../mascot/FioGuide.jsx: {view,session,busy,onNavigate}. Portalbody e alvosdata-guide context/scenario/documents/review/retry; treinoativo recolhe e não sugere respostas.

App action callbacks async retornam Promise<boolean>, true apenas após efeito confirmado. busy bloqueia mutações concorrentes, navegação preserva draft/sessão. Entrada de sessão não é criada por navegação. Retry de command reusa commandId/payload; erro409 exige revisão e chave nova depois do snapshot atualizado.

Tokens: --ink #18242A, --muted #627084, --line #DCE2E8, --accent #37CFDB, --dark #161C22, --paper #FFF, --surface #F4F6F6, --attention #AC633E; radius12px. Controles .primary/.secondary/.subtle/.text-button/.icon-button; .badge, .avatar, .panel, .notice/.global-error, .empty, .field-label. Fonte sans de sistema (não depende de CDN).

Shell: rail220px desktop,76px entre900–1150px, navegação inferior compacta abaixo760px. Área principal min-width0, conteúdo max1600px, espaçamento24–36px. Teclado:foco3px,skiplink,header e navsemânticos; prefer-reduced-motion sem animação.
