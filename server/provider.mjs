import { AppError, fixtureIntent, fixtureAssessment, intentKeys } from './engine.mjs';
import { AI_CONTRACT_VERSION, turnSchema, assessmentSchema, authorToolSchema, authorReviewSchema, assertSchema, validateTurn, validateDraft, validateAssessment, validateAuthorReview } from './ai/contracts.mjs';
import { processBudget, RUN_LIMITS } from './ai/budget.mjs';
import { DRAFT_INSTRUCTIONS, AUTHOR_REVIEW_INSTRUCTIONS, TURN_INSTRUCTIONS, ASSESSMENT_INSTRUCTIONS } from './ai/prompts.mjs';
export { createRequestBudget } from './ai/budget.mjs';

const error = (code, message) => new AppError(503, code, message);
const quotaCodes = new Set(['insufficient_quota', 'rate_limit_exceeded', 'billing_hard_limit_reached']);
const usageNumber = value => Number.isInteger(value) && value >= 0 ? value : null;

export function createProvider({ apiKey = process.env.OPENAI_API_KEY, model = process.env.OPENAI_MODEL, mode: requestedMode = 'auto', fetchImpl = fetch, maxOutputTokens = RUN_LIMITS.perRequest, timeoutMs = 45000, budget = processBudget, onTelemetry } = {}) {
  if (!['auto', 'openai', 'fixture'].includes(requestedMode)) throw new TypeError('Invalid provider mode.');
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 16 || maxOutputTokens > RUN_LIMITS.perRequest || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new TypeError('Invalid provider limits.');
  const configured = typeof apiKey === 'string' && !!apiKey.trim() && typeof model === 'string' && !!model.trim();
  if (requestedMode === 'openai' && !configured) throw error('MODEL_NOT_CONFIGURED', 'Configure chave e modelo no servidor para usar o modo OpenAI.');
  const mode = requestedMode === 'fixture' ? 'fixture' : configured ? 'openai' : 'fixture';
  if (typeof budget?.reserve !== 'function' || typeof budget?.snapshot !== 'function' || typeof budget?.stop !== 'function') throw new TypeError('A shared request budget is required.');
  const telemetry = [];

  const inputData = data => [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(data) }] }];
  const format = (name, schema) => ({ format: { type: 'json_schema', name, strict: true, schema } });
  function parseOutput(result) {
    if (result.output?.some(item => item.type === 'function_call')) throw error('INVALID_MODEL_OUTPUT', 'O serviço tentou executar uma ação fora da etapa permitida.');
    const content = (result.output || []).flatMap(item => Array.isArray(item?.content) ? item.content : []);
    const outputText = typeof result.output_text === 'string' ? result.output_text : content.filter(item => item?.type === 'output_text' && typeof item.text === 'string').map(item => item.text).join('');
    if (!outputText || outputText.length > 50000) throw error('INVALID_MODEL_OUTPUT', 'O serviço retornou uma resposta inválida. Sua entrada foi preservada.');
    try { return JSON.parse(outputText); } catch { throw error('INVALID_MODEL_OUTPUT', 'O serviço retornou JSON inválido. Sua entrada foi preservada.'); }
  }
  async function request(stage, body, validate, sequence = budget.reserve(maxOutputTokens)) {
    if (budget.snapshot().stopped) throw error('MODEL_QUOTA_EXCEEDED', 'Novas chamadas estão suspensas. Sua entrada foi preservada.');
    const entry = { stage, sequence, contractVersion: AI_CONTRACT_VERSION, mode, model, status: 'pending', maxOutputTokens, startedAt: new Date().toISOString() };
    telemetry.push(entry);
    const start = Date.now();
    try {
      const response = await fetchImpl('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, model, max_output_tokens: maxOutputTokens, store: false }),
        signal: AbortSignal.timeout(timeoutMs)
      });
      entry.httpStatus = response.status;
      let result;
      try { result = await response.json(); } catch (cause) { if (cause?.name === 'AbortError' || cause?.name === 'TimeoutError') throw cause; result = null; }
      if (!response.ok) {
        if (response.status === 429 || quotaCodes.has(result?.error?.code)) { budget.stop(); throw error('MODEL_QUOTA_EXCEEDED', 'O serviço atingiu o limite de uso. Novas chamadas estão suspensas; sua sessão foi preservada.'); }
        if (response.status === 401 || response.status === 403) throw error('MODEL_CONFIGURATION_ERROR', 'O servidor não conseguiu acessar o serviço de IA. Sua sessão foi preservada.');
        throw error('MODEL_UNAVAILABLE', 'O serviço de conversa está indisponível. Sua sessão foi preservada.');
      }
      entry.usage = { inputTokens: usageNumber(result?.usage?.input_tokens), outputTokens: usageNumber(result?.usage?.output_tokens), totalTokens: usageNumber(result?.usage?.total_tokens) };
      if (entry.usage.outputTokens > maxOutputTokens) { budget.stop(); throw error('MODEL_BUDGET_EXCEEDED', 'O uso retornado ultrapassou a reserva de tokens. Novas chamadas estão suspensas.'); }
      const output = Array.isArray(result?.output) ? result.output : [];
      const content = output.flatMap(item => Array.isArray(item?.content) ? item.content : []);
      if (content.some(item => item?.type === 'refusal')) throw error('MODEL_REFUSAL', 'O serviço não pôde responder a este conteúdo. Sua sessão foi preservada.');
      if (result?.status === 'incomplete') throw error('MODEL_INCOMPLETE', 'A resposta do serviço ficou incompleta. Sua entrada foi preservada.');
      if (result?.status !== 'completed' || result?.error || output.some(item => item?.type === 'message' && item.status && item.status !== 'completed')) throw error('INVALID_MODEL_OUTPUT', 'O serviço não concluiu uma resposta válida. Sua entrada foi preservada.');
      const validated = validate(result);
      entry.status = 'completed';
      return validated;
    } catch (cause) {
      const safe = cause instanceof AppError ? cause : error(cause?.name === 'TimeoutError' || cause?.name === 'AbortError' ? 'MODEL_TIMEOUT' : 'MODEL_UNAVAILABLE', 'O serviço não respondeu. Sua sessão e sua entrada foram preservadas.');
      entry.status = 'failed'; entry.errorCode = safe.code;
      throw safe;
    } finally {
      entry.durationMs = Date.now() - start;
      // Metadata only: never log credentials, user text, raw outputs or errors.
      if (typeof onTelemetry === 'function') { try { onTelemetry(structuredClone(entry)); } catch { /* Observability cannot change a confirmed response. */ } }
    }
  }
  async function structured(stage, schema, instructions, data, validate) {
    return request(stage, { instructions, input: inputData(data), text: format(stage, schema) }, result => validate(parseOutput(result)));
  }
  function checkSession(session) {
    if (!session || !Array.isArray(session.messages) || !session.scenario) throw new AppError(422, 'INVALID_SESSION', 'A sessão não possui contexto válido.');
    if (session.mode && session.mode !== mode) throw error('PROVIDER_MODE_CHANGED', 'Retome esta sessão com o mesmo modo de interpretação.');
  }
  function checkText(text, max) {
    if (typeof text !== 'string' || !text.trim() || text.length > max) throw new AppError(422, 'INVALID_INPUT', 'Informe um texto dentro do limite do exercício.');
  }
  return {
    mode, contractVersion: AI_CONTRACT_VERSION,
    getTelemetry: () => structuredClone(telemetry),
    getBudget: () => budget.snapshot(),
    async turn(session, text) {
      checkSession(session); checkText(text, 2000);
      const userTurns = session.messages.filter(message => message.role === 'user').length;
      if (session.status !== 'active' || userTurns >= 3 || session.messages.length >= 8) throw new AppError(409, 'SESSION_NOT_ACTIVE', 'Esta sessão não aceita outra resposta.');
      if (mode === 'fixture') return { intent: fixtureIntent(session, text) };
      return structured('professional_turn', turnSchema(intentKeys), TURN_INSTRUCTIONS, { scenario: session.scenario, history: session.messages, attributes: session.attributes, documentsRead: session.documentsRead, commitment: session.commitment, confirmedState: session._state, remainingUserTurns: 3 - userTurns, lastUserText: text }, value => validateTurn(value, intentKeys, text));
    },
    async assess(session) {
      checkSession(session);
      if (!['completed', 'incomplete'].includes(session.status)) throw new AppError(409, 'INVALID_TRANSITION', 'Conclua a conversa antes de avaliar.');
      if (mode === 'fixture') return fixtureAssessment(session);
      return structured('professional_assessment', assessmentSchema, ASSESSMENT_INSTRUCTIONS, { scenario: session.scenario, messages: session.messages, ending: session.ending, commitment: session.commitment }, value => validateAssessment(value, session));
    },
    async draft(text, policyText = '', { currentDraft = null, revisionText = '', executeTool } = {}) {
      checkText(text, 6000);
      if (typeof policyText !== 'string' || policyText.length > 6000) throw new AppError(422, 'INVALID_POLICY', 'A política deve conter até 6000 caracteres.');
      if (mode === 'fixture') return null;
      if (typeof executeTool !== 'function' || typeof budget.reserveMany !== 'function') throw error('MODEL_TOOL_NOT_CONFIGURED', 'A composição do exercício ainda não está disponível no servidor.');
      if (currentDraft) checkText(revisionText, 6000);
      else if (revisionText !== '') throw new AppError(422, 'INVALID_INPUT', 'A revisão precisa de um rascunho existente.');
      const operation = currentDraft ? 'revise' : 'create';
      const history = Array.isArray(currentDraft?.revisionHistory) ? currentDraft.revisionHistory : [];
      const revisionTexts = history.map(item => item?.requestText ?? item?.text).filter(item => typeof item === 'string');
      if (revisionText) revisionTexts.push(revisionText);
      const sequences = budget.reserveMany(2, maxOutputTokens);
      const input = inputData({ text, policyText, currentDraft, revisionText, operation });
      const tools = [{ type: 'function', name: 'compose_exercise', description: 'Compor ou revisar um exercício de assistência e validar fatos, regras, documentos e finais. Não publica nem cria sessões. Use create sem rascunho existente e revise com rascunho existente.', strict: true, parameters: authorToolSchema }];
      const planned = await request('professional_author_tool', { instructions: DRAFT_INSTRUCTIONS, input, tools, tool_choice: 'required', parallel_tool_calls: false, include: ['reasoning.encrypted_content'] }, result => {
        const calls = result.output?.filter(item => item.type === 'function_call') || [];
        if (calls.length !== 1 || calls[0].name !== 'compose_exercise' || (calls[0].status && calls[0].status !== 'completed') || typeof calls[0].call_id !== 'string' || !calls[0].call_id || typeof calls[0].arguments !== 'string' || calls[0].arguments.length > 50000) throw error('INVALID_TOOL_CALL', 'O autor não apresentou uma operação válida de composição.');
        let args;
        try { args = JSON.parse(calls[0].arguments); } catch { throw error('INVALID_TOOL_CALL', 'O autor não apresentou argumentos válidos.'); }
        assertSchema(args, authorToolSchema);
        if (args.operation !== operation) throw error('INVALID_TOOL_OPERATION', 'A operação proposta não corresponde ao rascunho atual.');
        validateDraft(args.proposal, text, policyText, revisionTexts);
        return { args, callId: calls[0].call_id, output: result.output };
      }, sequences[0]);
      let toolResult;
      try { toolResult = await executeTool('compose_exercise', structuredClone(planned.args)); }
      catch (cause) { if (cause instanceof AppError) throw cause; throw error('MODEL_TOOL_FAILED', 'Não foi possível validar o exercício. Seu rascunho anterior foi preservado.'); }
      if (!toolResult?.candidate || toolResult.validation?.valid !== true || toolResult.validation.environmentId !== 'assistencia') throw error('INVALID_TOOL_RESULT', 'A composição não produziu um exercício válido para revisão.');
      const confirmed = structuredClone(toolResult);
      const review = await request('professional_author_review', { instructions: AUTHOR_REVIEW_INSTRUCTIONS, input: [...input, ...planned.output, { type: 'function_call_output', call_id: planned.callId, output: JSON.stringify(confirmed) }], tools, tool_choice: 'none', parallel_tool_calls: false, text: format('professional_author_review', authorReviewSchema) }, result => validateAuthorReview(parseOutput(result)), sequences[1]);
      return { ...planned.args.proposal, candidate: confirmed.candidate, authorMessage: review.authorMessage, authorTool: { name: 'compose_exercise', operation, status: 'validated', validation: confirmed.validation } };
    }
  };
}
