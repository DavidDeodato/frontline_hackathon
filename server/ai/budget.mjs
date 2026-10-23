import { AppError } from '../engine.mjs';

export const RUN_LIMITS = Object.freeze({ requests: 6, outputTokens: 8000, perRequest: 1300 });

// Reserve synchronously before fetch, including failures and ambiguous outcomes.
// On restart the manager must restore the snapshot, not create a new allowance.
export function createRequestBudget({ maxRequests = RUN_LIMITS.requests, maxOutputTokens = RUN_LIMITS.outputTokens, usedRequests = 0, reservedOutputTokens = 0, stopped = false } = {}) {
  const explicitExtendedRound = maxRequests === 9 && maxOutputTokens === 11700;
  if (!Number.isInteger(maxRequests) || maxRequests < 0 || (maxRequests > RUN_LIMITS.requests && !explicitExtendedRound) || !Number.isInteger(maxOutputTokens) || maxOutputTokens < 0 || (maxOutputTokens > RUN_LIMITS.outputTokens && !explicitExtendedRound) || !Number.isInteger(usedRequests) || usedRequests < 0 || usedRequests > maxRequests || !Number.isInteger(reservedOutputTokens) || reservedOutputTokens < 0 || reservedOutputTokens > maxOutputTokens || typeof stopped !== 'boolean') throw new TypeError('Invalid bounded request budget.');
  let requests = usedRequests, reserved = reservedOutputTokens, halted = stopped;
  function reserveMany(count, tokens) {
    if (!Number.isInteger(count) || count < 1 || !Number.isInteger(tokens) || tokens < 16) throw new TypeError('Invalid output token reservation.');
    if (halted) throw new AppError(503, 'MODEL_QUOTA_EXCEEDED', 'O serviço atingiu o limite de uso. Novas chamadas estão suspensas; a sessão foi preservada.');
    if (requests + count > maxRequests || reserved + count * tokens > maxOutputTokens) throw new AppError(503, 'MODEL_BUDGET_EXCEEDED', 'O orçamento desta rodada terminou. Sua sessão foi preservada.');
    const sequences = Array.from({ length: count }, (_, index) => requests + index + 1);
    requests += count; reserved += count * tokens;
    return sequences;
  }
  return Object.freeze({
    reserve(tokens) { return reserveMany(1, tokens)[0]; },
    reserveMany,
    stop() { halted = true; },
    snapshot() { return { maxRequests, maxOutputTokens, usedRequests: requests, reservedOutputTokens: reserved, stopped: halted }; }
  });
}
export const processBudget = createRequestBudget();
