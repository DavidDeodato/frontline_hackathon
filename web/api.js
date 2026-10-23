export class ApiError extends Error { constructor(message,status,session,code){super(message);this.name='ApiError';this.status=status;this.session=session;this.code=code;} }
export async function api(path,method='GET',body){
  const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),65000);
  try {const response=await fetch(`/api${path}`,{method,credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:controller.signal});
    let data;try{data=await response.json();}catch{throw new ApiError('O serviço retornou uma resposta inválida. Seu texto foi preservado.',response.status);}
    if(!response.ok)throw new ApiError(data.error?.message||'Não foi possível concluir. Tente novamente.',response.status,data.session,data.error?.code);
    return data;
  }catch(error){if(error.name==='AbortError')throw new ApiError('A resposta demorou. Seu texto foi preservado. Tente novamente para consultar o resultado da mesma ação.',408,undefined,'REQUEST_TIMEOUT');if(error instanceof TypeError)throw new ApiError('Não foi possível conectar ao serviço. Seu texto foi preservado; tente novamente quando a conexão voltar.',0,undefined,'NETWORK_ERROR');throw error;}finally{clearTimeout(timeout);}
}
export const uid=()=>crypto.randomUUID();
export const stateLabel={active:'Em andamento',paused:'Pausado',completed:'Concluído',cancelled:'Interrompido',incomplete:'Incompleto'};

export const BRIEF_LIMIT = 2000;
export const CONTEXT_LIMIT = 6000;
export function readIncomingBrief(hash) {
  const [route, ...queryParts] = String(hash || '').split('?');
  if (route !== '#/library' || !queryParts.length) return null;
  const query = queryParts.join('?');
  if (!/(?:^|&)brief(?:=|&|$)/.test(query)) return null;
  try {
    if (query.length > 24000) throw new Error();
    const values = query.split('&').map(part => {
      const separator = part.indexOf('=');
      const key = separator < 0 ? part : part.slice(0, separator);
      const value = separator < 0 ? '' : part.slice(separator + 1);
      return [decodeURIComponent(key.replace(/\+/g, ' ')), decodeURIComponent(value.replace(/\+/g, ' '))];
    }).filter(([key]) => key === 'brief').map(([,value]) => value);
    if (values.length !== 1 || !values[0].trim() || values[0].length > BRIEF_LIMIT || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(values[0])) throw new Error();
    return { text: values[0], error: '' };
  } catch { return { text: '', error: 'Este link não contém um relato válido de até 2000 caracteres. Copie o relato original para a preparação.' }; }
}

export function combineIncomingBrief(existing, incoming) {
  const text = existing ? `${existing}\n\n${incoming}` : incoming;
  if (!incoming.trim() || incoming.length > BRIEF_LIMIT || text.length > CONTEXT_LIMIT) throw new Error('O relato atual e o texto recebido ultrapassam os limites permitidos: 2000 no link e 6000 no contexto. Seu trabalho foi preservado; revise os textos antes de continuar.');
  return text;
}
