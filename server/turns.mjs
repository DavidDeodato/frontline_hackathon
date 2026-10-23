import {isDeepStrictEqual} from 'node:util';
import {clone,fail,intentKeys,projectTurn,finalizeTurn,wireSession} from './engine.mjs';

// One invocation, one private candidate, no IO. Nothing is published until the
// final narration succeeds and the API commits against the original revision.
export function createTurnToolExecutor(session,text) {
  const before=clone(session);
  let executed=null,finished=false,attempted=false;
  async function executeTurn(name,args) {
    if (attempted) fail(503,'TURN_TOOL_REPEATED','A interpretação tentou aplicar mais de um turno.');
    attempted=true;
    if (name!=='apply_training_turn' || !args || Array.isArray(args) || Object.keys(args).sort().join(',')!=='evidence,intent') fail(503,'INVALID_TURN_TOOL','A ferramenta de conversa não corresponde à operação permitida.');
    const evidence=args.evidence;
    if (!evidence || Array.isArray(evidence) || typeof evidence!=='object' || Object.keys(evidence).length!==intentKeys.length || intentKeys.some(key=>typeof evidence[key]!=='string') || Object.keys(evidence).some(key=>!intentKeys.includes(key))) fail(503,'INVALID_INTENT_EVIDENCE','A interpretação não apresentou evidências válidas.');
    for (const key of intentKeys) if (args.intent?.[key]===false && evidence[key]!=='') fail(503,'INVALID_INTENT_EVIDENCE','Uma intenção ausente não pode incluir evidência.');
    const captured=clone(args);
    const projection=projectTurn(before,text,captured);
    executed={args:captured,projection};
    return {candidate:wireSession(projection.candidate),validation:{valid:true},responseContext:clone(projection.responseContext)};
  }
  function finish(result) {
    if (finished) fail(503,'TURN_ALREADY_FINALIZED','O turno já foi finalizado.');
    if (!executed || !result || result.turnTool?.name!=='apply_training_turn' || result.turnTool?.status!=='validated' || !isDeepStrictEqual({intent:result.intent,evidence:result.evidence},executed.args)) fail(503,'INVALID_TURN_RESULT','A resposta não corresponde à interpretação validada pelo servidor.');
    const after=finalizeTurn(executed.projection,result.reply);
    finished=true;
    return after;
  }
  return {executeTurn,finish};
}
