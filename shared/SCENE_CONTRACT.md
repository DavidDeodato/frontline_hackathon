# Cena e guia — contrato scene.v0.2

Scene default em web/Scene.jsx: onDocument(objectId),onFailure(message),selected,documentsRead=[],busy=false,readOnly=false. IDs: OBJ-ORDEM,OBJ-POLITICA,OBJ-CALENDARIO. Callback abre objeto real via API; cena não altera domínio. readOnly escondehotspots/caption interativos e animação nos previews. CSS isolado web/scene/ com prefixo próprio; tokensglobais pertencem shell. Canvas decorativo aria-hidden; controlesHTML e lista equivalente; reducedmotion,resize e disposal.

FioGuide default em web/mascot/FioGuide.jsx: `{view,session,busy,onNavigate}`. Portalbody,ajuda opcional por ação humana; Escape/dispensar/reducedmotion. Recolhido durante practice/session.active; não interpreta falas,não revela avaliação,não inventa atividade de modelo. Só eventos confirmados movem etapa. Consumidor confirma props antes de integrar.
