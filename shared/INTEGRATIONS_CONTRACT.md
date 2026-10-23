# Integrações — contrato frontline.integrations/1

Endpoints locais aditivos; identidade/ACL pertencem à API. Adapters não abrem processo, rede ou banco ao importar. Exportação não demonstra vínculo ou ancoragem externa.

- GET /api/integrations/status → capabilities com contractVersion,whatsapp{available,status,mode,reason,message},export{available,format,verification},devnet{available,status,mode,reason,message}. Guest/ponte ausente: WhatsApp unavailable/unlinked/disabled; Devnet disabled/not_requested até autorização e prova.
- GET /api/sessions/:id/export → {document,filename}. Exige ACL da sessão e statuscompleted/incomplete com avaliação válida. Envelope schemaVersion='frontline.export/1',payload{session,notice},integrity{algorithm:'sha256',canonicalization:'frontline.sorted-json/1',sha256}. Hash de canonicalJSON({schemaVersion,payload}); chaves de objeto ordenadas, arrays em ordem, somente JSON finito, limites1MiB/profundidade32. Não alegar RFC8785.
- POST /api/exports/verify {document,sessionId?} → {valid,sha256,matchesTrustedExport,reason,message?,anchored:false}. SemsessionId compara consistência interna e matchesTrustedExport=null; comsessionId consultaACL e compara export atual canônico. Uma cópia pode ser internamente consistente e diferente da referência; não confundir hashautodeclarado com autenticidade.

Export exclui identidade de conta,rawContext/rawPolicy,segredos,providerTrace e estado interno. Transcrição simulada,versões,rubrica,citações,fatos e regras entram para revisão portátil. Origemfixture/openai permanece explícita. Nenhum dado enviado à blockchain nesta entrega local.

Persistência opcional aditiva integration_records(namespace,key,data),inicializada explicitamente pelo backend através createIntegrationStore(db); sem migração concorrente ou reescrita de tabelas aplicadas. Guest não concede identidade WhatsApp. RotasWA/external devem negar enquanto accountauth/bridge não existirem; fluxo de teste rotulado não vira connected real.
