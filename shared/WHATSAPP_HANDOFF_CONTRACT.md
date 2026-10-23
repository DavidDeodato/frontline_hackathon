# WhatsApp para preparação — frontline.whatsapp-handoff/1

O assistente ajuda a descrever uma dificuldade de atendimento e prepara um briefing para revisão no Frontline. Não cria treino, vincula conta, lê histórico nem promete continuidade autenticada.

## Entrada e saída

- O serviço existente responde somente a DM recebida com o prefixo `!bot`, preservando deduplicação e fila. Sem envio proativo, grupos ou sessão local concorrente.
- Ferramenta `prepare_training`, quando implementada, recebe `{brief:string}` com texto não vazio de até 2000 caracteres e retorna `{brief,url,created:false}`. O texto é contexto fornecido pelo usuário, não uma instrução privilegiada.
- URL permitida: `https://frontline-production-4f55.up.railway.app/#/library?brief=` seguida de `encodeURIComponent(brief)`. O fragmento não é enviado no pedido HTTP da página. Não incluir dados pessoais, telefone, credenciais ou histórico completo no briefing.
- A interface decodifica uma vez, valida tamanho e conteúdo textual, mostra prévia e exige ação humana para usar o briefing na preparação. Preserva rascunho existente até confirmação. Remove o parâmetro após reter a proposta em memória. Não gera nem inicia automaticamente, não chama o modelo na importação e não executa HTML ou URLs contidos no texto.
- Entradas vazias, malformadas ou acima do limite são rejeitadas com indicação recuperável. O fluxo comum da biblioteca continua funcionando sem parâmetro.

## Disponibilidade e limites

Código implantado não comprova sessão WhatsApp conectada. O CTA só pode indicar disponibilidade operacional após health autenticado/estado do bot confirmarem conexão. Link público ou instruções podem ser apresentados como preparação, sem alegar vínculo. Conta e histórico do site continuam isolados; nenhuma autenticação pelo número foi criada.

O código sanitizado fica em `services/whatsapp/`. Credenciais, sessão de WhatsApp, dados e arquivos de autenticação ficam fora do Git e do contexto de build. O volume e as variáveis do serviço existente são preservados. Aceite externo depende de uma mensagem de teste iniciada pelo usuário e do link devolvido; testes locais não substituem essa evidência.
