import test from 'node:test';
import assert from 'node:assert/strict';
import { baseScenario, newSession, openDocument, applyTurn, intentKeys } from '../server/engine.mjs';
import { validateTurn } from '../server/ai/contracts.mjs';

// Immutable captured outputs, not newly generated fixtures or corrected flags.
// Passing this replay proves that the engine did NOT promote an invalid loan.
// The NPC prose in the capture is a known failure and remains unacceptable.
const recorded = {
  "label": "Captured real model outputs on a synthetic scenario; known semantic failure, not an accepted conversation.",
  "opening": "Preciso de um aparelho provisório para conseguir falar com a minha avó por videochamada durante a viagem; eu viajo amanhã e volto no dia 27 de outubro, e quero entender se dá para me ajudar sem prometer o conserto.",
  "rules": {
    "loanAvailable": true,
    "loanDays": 7,
    "clientReturnDays": 4,
    "clientHasIdentity": true,
    "repairEta": null
  },
  "documents": [
    "OBJ-ORDEM",
    "OBJ-POLITICA"
  ],
  "userTexts": [
    "Entendo que a videochamada com sua avó durante a viagem é importante. A peça não tem prazo confirmado. Um aparelho provisório para essa conversa ajudaria?",
    "Temos um provisório disponível, sem cobrança. Você está com seu documento e consegue devolver no dia 27 de outubro, dentro dos sete dias da política?",
    "Combinado: vamos emprestar o aparelho provisório com devolução em 27 de outubro e documento confirmado. O prazo do reparo continua sem confirmação; aviso quando houver atualização."
  ],
  "captures": [
    {
      "source": ".local/orchestration/evidence/full-regression-2026-10-23T17-31-40-507Z/provider-visible-3.json",
      "sha256": "ac9368a9cce887b4588c8912f82caa3bd0566e107630fbb14c9c7bd79336753e",
      "interpretation": {
        "intent": {
          "acknowledgesNeed": true,
          "explainsUnknownEta": true,
          "unsupportedPromise": false,
          "explicitRetraction": false,
          "offerLoan": false,
          "askIdentity": false,
          "askReturn": false,
          "confirmLoan": false,
          "nextStep": false,
          "ambiguous": false,
          "withdrawLoan": false,
          "withdrawNextStep": false
        },
        "evidence": {
          "acknowledgesNeed": "Entendo que a videochamada com sua avó durante a viagem é importante.",
          "explainsUnknownEta": "A peça não tem prazo confirmado.",
          "unsupportedPromise": "",
          "explicitRetraction": "",
          "offerLoan": "",
          "askIdentity": "",
          "askReturn": "",
          "confirmLoan": "",
          "nextStep": "",
          "ambiguous": "",
          "withdrawLoan": "",
          "withdrawNextStep": ""
        },
        "reply": "Sim, ajudaria bastante. Eu preciso conseguir falar com a minha avó durante a viagem, então um aparelho provisório me atende enquanto a peça não tem prazo confirmado. Se eu puder pegar, eu levo meu documento e devolvo no dia 27 de outubro, sem problema."
      }
    },
    {
      "source": ".local/orchestration/evidence/full-regression-2026-10-23T17-31-40-507Z/provider-visible-4.json",
      "sha256": "d12e81f9ce0d8b60443a9b40b0b0c5df04faaf4ddae6637676a67c189ac2bc4c",
      "interpretation": {
        "intent": {
          "acknowledgesNeed": true,
          "explainsUnknownEta": false,
          "unsupportedPromise": false,
          "explicitRetraction": false,
          "offerLoan": false,
          "askIdentity": false,
          "askReturn": false,
          "confirmLoan": false,
          "nextStep": false,
          "ambiguous": false,
          "withdrawLoan": false,
          "withdrawNextStep": false
        },
        "evidence": {
          "acknowledgesNeed": "Temos um provisório disponível, sem cobrança.",
          "explainsUnknownEta": "",
          "unsupportedPromise": "",
          "explicitRetraction": "",
          "offerLoan": "",
          "askIdentity": "",
          "askReturn": "",
          "confirmLoan": "",
          "nextStep": "",
          "ambiguous": "",
          "withdrawLoan": "",
          "withdrawNextStep": ""
        },
        "reply": "Sim, estou com meu documento e consigo devolver no dia 27 de outubro, dentro dos sete dias. Se estiver tudo certo, eu posso seguir com o provisório para a viagem e conseguir falar com a minha avó."
      }
    },
    {
      "source": ".local/orchestration/evidence/full-regression-2026-10-23T17-31-40-507Z/provider-visible-5.json",
      "sha256": "5d37125867feab6a78399a55326b090042c621de1fb5bc748aa1798b8b5e45eb",
      "interpretation": {
        "intent": {
          "acknowledgesNeed": true,
          "explainsUnknownEta": true,
          "unsupportedPromise": false,
          "explicitRetraction": false,
          "offerLoan": false,
          "askIdentity": false,
          "askReturn": false,
          "confirmLoan": true,
          "nextStep": true,
          "ambiguous": false,
          "withdrawLoan": false,
          "withdrawNextStep": false
        },
        "evidence": {
          "acknowledgesNeed": "emprestar o aparelho provisório",
          "explainsUnknownEta": "O prazo do reparo continua sem confirmação",
          "unsupportedPromise": "",
          "explicitRetraction": "",
          "offerLoan": "",
          "askIdentity": "",
          "askReturn": "",
          "confirmLoan": "vamos emprestar o aparelho provisório",
          "nextStep": "aviso quando houver atualização",
          "ambiguous": "",
          "withdrawLoan": "",
          "withdrawNextStep": ""
        },
        "reply": "Perfeito, obrigado. Então eu fico com o aparelho provisório e devolvo no dia 27 de outubro com meu documento confirmado. Enquanto isso, aguardo o aviso quando houver atualização do reparo."
      }
    }
  ]
};

test('recorded P1 replay preserves false flags and refuses to manufacture END-01', () => {
  const scenario = baseScenario(); scenario.opening = recorded.opening; scenario.rules = structuredClone(recorded.rules);
  let session = newSession(scenario, 'openai');
  for (const document of recorded.documents) openDocument(session, document);
  const snapshots = [];
  for (let index = 0; index < recorded.captures.length; index++) {
    const interpretation = structuredClone(recorded.captures[index].interpretation);
    assert.doesNotThrow(() => validateTurn(interpretation, intentKeys, recorded.userTexts[index]));
    session = applyTurn(session, recorded.userTexts[index], interpretation);
    snapshots.push(structuredClone(session));
  }
  assert.equal(recorded.captures[0].interpretation.intent.offerLoan, false);
  assert.equal(snapshots[0]._state.loanOffered, false);
  assert.equal(recorded.captures[1].interpretation.intent.askIdentity, false);
  assert.equal(recorded.captures[1].interpretation.intent.askReturn, false);
  assert.equal(snapshots[1]._state.identity, false);
  assert.equal(snapshots[1]._state.returnConfirmed, false);
  assert.equal(recorded.captures[1].interpretation.reply, 'Sim, estou com meu documento e consigo devolver no dia 27 de outubro, dentro dos sete dias. Se estiver tudo certo, eu posso seguir com o provisório para a viagem e conseguir falar com a minha avó.');
  assert.equal(recorded.captures[2].interpretation.intent.confirmLoan, true);
  assert.equal(session._state.loanAgreed, false);
  assert.equal(session.ending.id, 'END-02');
  assert.equal(session.commitment.text, 'Atualização combinada, sem promessa de reparo');
  assert.equal(recorded.captures[2].interpretation.reply, 'Perfeito, obrigado. Então eu fico com o aparelho provisório e devolvo no dia 27 de outubro com meu documento confirmado. Enquanto isso, aguardo o aviso quando houver atualização do reparo.');
});
