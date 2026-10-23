import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fail, projectRules, validateScenario, baseScenario, clone } from './engine.mjs';

const modelText = (value, limit, field) => {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) fail(503, 'INVALID_MODEL_OUTPUT', `O rascunho não apresentou ${field} válido.`);
  return value;
};
const hasSource = (quote, ...sources) => typeof quote === 'string' && quote.trim().length > 0 && sources.some(source => typeof source === 'string' && source.includes(quote));

export function applyDraftProposal(draft, proposal, context, policy = '', mode = 'fixture', revisionText = '') {
  const sources = [context, policy, revisionText, ...(draft.revisionHistory || []).map(item => item.requestText)];
  draft.rawContext = context;
  draft.rawPolicyText = policy;
  draft.contextNeed = 'Aparelho para comunicação durante uma viagem';
  draft.contextUnknowns = ['Prazo do reparo não confirmado'];
  draft.contextualFacts = [];
  if (mode === 'openai' && !proposal) fail(503, 'INVALID_MODEL_OUTPUT', 'O serviço não produziu um rascunho revisável.');
  if (proposal) {
    if (proposal.compatibility !== undefined) {
      const compatibility = proposal.compatibility;
      if (!compatibility || typeof compatibility.supported !== 'boolean' || typeof compatibility.sourceQuote !== 'string' || compatibility.sourceQuote.length > 1200) fail(503,'INVALID_MODEL_OUTPUT','A compatibilidade do relato não foi informada corretamente.');
      const reason = modelText(compatibility.reason,500,'justificativa de compatibilidade');
      if (compatibility.sourceQuote && !hasSource(compatibility.sourceQuote,...sources)) fail(503,'INVALID_CONTEXT_SOURCE','A justificativa de compatibilidade não corresponde às fontes recebidas.');
      if (!compatibility.supported) {
        if (!hasSource(compatibility.sourceQuote,...sources)) fail(503,'INVALID_CONTEXT_SOURCE','A incompatibilidade precisa apontar um trecho literal do relato.');
        fail(422,'UNSUPPORTED_CONTEXT',`Este relato não cabe no catálogo de assistência e pós-venda disponível. ${reason}`);
      }
      draft.compatibility = {supported:true,reason,sourceQuote:compatibility.sourceQuote};
    }
    draft.title = modelText(proposal.title, 160, 'título');
    draft.summary = modelText(proposal.summary, 1200, 'resumo');
    draft.opening = modelText(proposal.opening, 900, 'abertura');
    draft.contextNeed = modelText(proposal.need, 1000, 'necessidade');
    if (proposal.clientBrief !== undefined) {
      const brief = proposal.clientBrief;
      if (!brief || !Array.isArray(brief.traits) || brief.traits.length > 3) fail(503,'INVALID_MODEL_OUTPUT','O perfil narrativo do cliente é inválido.');
      draft.clientBrief = {objective:modelText(brief.objective,400,'objetivo do cliente'),traits:brief.traits.map(x=>modelText(x,160,'traço observável')),initialState:modelText(brief.initialState,400,'estado inicial do cliente')};
    }
    if (!Array.isArray(proposal.unknowns) || proposal.unknowns.length > 12 || proposal.unknowns.some(x => typeof x !== 'string' || !x.trim() || x.length > 800)) fail(503, 'INVALID_MODEL_OUTPUT', 'O rascunho contém lacunas inválidas.');
    if (!Array.isArray(proposal.contextualFacts) || proposal.contextualFacts.length > 10) fail(503, 'INVALID_MODEL_OUTPUT', 'O rascunho contém fatos inválidos.');
    const ids = new Set();
    draft.contextualFacts = proposal.contextualFacts.map(f => {
      if (!f || typeof f.id !== 'string' || !f.id.trim() || f.id.length > 80 || ids.has(f.id) || !['provided','unknown','fictional'].includes(f.status) || typeof f.sourceQuote !== 'string' || f.sourceQuote.length > 1200) fail(503, 'INVALID_MODEL_OUTPUT', 'O rascunho contém fatos ou origens inválidos.');
      ids.add(f.id);
      if (f.status === 'provided' && !hasSource(f.sourceQuote, ...sources)) fail(503, 'INVALID_CONTEXT_SOURCE', 'Uma origem do rascunho não corresponde ao contexto enviado.');
      if (f.sourceQuote && !hasSource(f.sourceQuote, ...sources)) fail(503, 'INVALID_CONTEXT_SOURCE', 'Uma origem do rascunho não corresponde ao contexto enviado.');
      return { id: f.id, text: modelText(f.text, 1200, 'fato'), status: f.status, sourceQuote: f.sourceQuote };
    });
    draft.contextUnknowns = [...new Set([...proposal.unknowns, 'Prazo do reparo não confirmado'])];
    if (!proposal.rules || !proposal.ruleEvidence) fail(503, 'INVALID_MODEL_OUTPUT', 'O rascunho não apresentou as regras revisáveis.');
    for (const key of ['loanAvailable','loanDays']) {
      const value = proposal.rules[key];
      if (value === null) continue;
      const valid = key === 'loanAvailable' ? typeof value === 'boolean' : Number.isInteger(value) && value >= 1 && value <= 7;
      if (!valid || !hasSource(proposal.ruleEvidence[key], ...sources)) fail(503, 'INVALID_RULE_SOURCE', 'A regra proposta não tem valor e origem válidos; revise o contexto.');
      draft.rules[key] = value;
    }
  }
  for (const [key, text] of [['loanAvailable',`Disponibilidade ${draft.rules.loanAvailable ? 'presente' : 'ausente'} do aparelho provisório mantida do cenário de referência; revise antes de publicar.`],['loanDays',`Prazo de ${draft.rules.loanDays} dias mantido do cenário de referência; revise antes de publicar.`]]) {
    if (!proposal || proposal.rules[key] === null) draft.contextualFacts.push({id:`DEFAULT-${key}`,text,status:'fictional',sourceQuote:''});
  }
  draft.policyInputNotice = mode === 'openai' ? 'Regras propostas a partir do relato são revisáveis. Premissas sem origem estão identificadas como fictícias; confirme disponibilidade e prazo antes de publicar.' : 'Modo demonstrativo: contexto e política foram preservados, mas não interpretados por IA. Disponibilidade e prazo são premissas fictícias revisáveis.';
  draft.clientBrief ||= {objective:'Conseguir comunicação durante a viagem.',traits:['Busca uma resposta clara.'],initialState:'Cliente fictício preocupado com a ausência do aparelho.'};
  return projectRules(draft);
}

// This closure validates and composes a candidate in memory. Persistence belongs
// to the HTTP command transaction after the provider's final response succeeds.
export function createDraftToolExecutor({text, policyText = '', currentDraft = null, revisionText = '', mode = 'openai'}) {
  const operation = currentDraft ? 'revise' : 'create';
  let executed = null;
  async function executeTool(name, args) {
    if (executed) fail(503, 'AUTHOR_TOOL_REPEATED', 'A autoria tentou compor mais de um candidato.');
    if (name !== 'compose_exercise' || !args || args.operation !== operation || Object.keys(args).some(k => !['operation','proposal'].includes(k))) fail(503, 'INVALID_AUTHOR_TOOL', 'A ferramenta de autoria não corresponde à operação solicitada.');
    const candidate = currentDraft ? clone(currentDraft) : baseScenario();
    candidate.id = currentDraft?.id || randomUUID();
    candidate.version = currentDraft ? currentDraft.version + 1 : 1;
    candidate.policy.version = candidate.version;
    candidate.state = 'draft';
    candidate.label = 'Exercício simulado • contexto adaptado por IA • revisão necessária';
    applyDraftProposal(candidate, args.proposal, text, policyText, mode, revisionText);
    if (revisionText) {
      candidate.lastRevisionText = revisionText;
      candidate.revisionHistory = [...(currentDraft?.revisionHistory || []), {version:candidate.version,requestText:revisionText,createdAt:new Date().toISOString()}];
    }
    validateScenario(candidate);
    executed = {candidate, validation:{valid:true,environmentId:'assistencia',availableEndingIds:clone(candidate.graph.availableEndingIds),scenarioVersion:candidate.version}};
    return clone(executed);
  }
  function finish(providerResult) {
    if (!executed || !providerResult || !isDeepStrictEqual(providerResult.candidate, executed.candidate)) fail(503, 'INVALID_AUTHOR_RESULT', 'O resultado não corresponde ao candidato validado pela ferramenta.');
    const candidate = clone(executed.candidate);
    candidate.authorMessage = modelText(providerResult.authorMessage, 2000, 'explicação da autoria');
    candidate.authorTool = {name:'compose_exercise',operation,status:'validated',validation:clone(executed.validation)};
    return candidate;
  }
  return {executeTool, finish};
}
