# Provider — contrato ai.v0.2

Interface interna compatível: `createProvider(options)` retorna `mode`, `draft(text,policyText)`, `turn(session,text)`, `assess(session)`. Fixture explícita pode retornar null em draft. Contexto/histórico completos chegam ao modelo; nunca credenciais ou identificação externa do visitante.

Turno real: `{intent,evidence,reply}`. Flags booleanas: acknowledgesNeed,explainsUnknownEta,unsupportedPromise,explicitRetraction,offerLoan,askIdentity,askReturn,confirmLoan,nextStep,ambiguous,withdrawLoan,withdrawNextStep. Cada flagtrue tem evidence[key] não vazio e substring literal de text. Reply não vazio<=900caracteres; personagem únicoRoberto, sem alterar regras/estoque/prazo. Backend aplica guardas; modelo propõe. Fixture pode dispensar evidence, claramente identificada.

Draft: campos existentes title,summary,need,opening,unknowns; aditivos contextualFacts[{id,text,status,sourceQuote}], rules{loanAvailable:boolean|null,loanDays:integer|null}, ruleEvidence{loanAvailable:string,loanDays:string}. Prazo1..7 quando não nulo. Regra não nula exige evidência literal no contexto/política. Null significa não extraído; defaults são ficção revisável. Servidor mantém os textos originais, valida proveniência e projeta regras. ContextualFacts não substitui fatos operacionais protegidos. Domínio não suportado deve ser declarado na revisão.

Assessment: criteria exatamente3,um porcriterionIdda rubrica; name,rating,quote,messageId,reason. Quote literal de mensagemuser; ausência explícita pode ter rating='sem evidência suficiente',quote='',messageId='',reason não vazio. opportunity:string. Provider valida estrutura; backend valida transcrição/rubrica antes de persistir.

ErrosAppError503 específicos para quota,timeout,provider indisponível,saída inválida/budget. Sem retry automático; quota trava novas chamadas neste budget. Opção maxOutputTokens<=1300 para smoke; medição usage sem segredo. Teto de execução gerido fora do prompt:6requests/8000outputtokens global. Chamadas offline simuladas não se apresentam como reais.
