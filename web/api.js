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
