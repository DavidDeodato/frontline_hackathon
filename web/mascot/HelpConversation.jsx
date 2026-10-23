import React, { useEffect, useRef, useState } from 'react';

const ACTIONS = new Set(['open_library', 'open_preparation', 'open_reviews', 'open_records', 'open_channels', 'highlight_documents']);
const VIEWS = new Set(['library', 'preparation', 'scenario', 'practice', 'reviews', 'review', 'compare', 'records', 'record', 'channels', 'continuity']);
const SUGGESTIONS = ['Como começar?', 'Como comparar tentativas?', 'O que posso fazer aqui?'];

function readEnvelope(data) {
  const conversation = data?.conversation;
  if (!conversation || !['guide', 'openai'].includes(conversation.mode) || !Array.isArray(conversation.messages)) throw new Error('A ajuda retornou uma resposta inválida. Tente novamente.');
  const messages = conversation.messages.filter(m => m && ['user', 'assistant'].includes(m.role) && typeof m.text === 'string' && Number.isFinite(m.seq)).sort((a, b) => a.seq - b.seq);
  return { ...conversation, messages, actions: Array.isArray(data.actions) ? data.actions.filter(a => ACTIONS.has(a?.id) && typeof a.label === 'string') : [] };
}

/** Separate help history. No training transcript, browser storage or automatic actions. */
export default function HelpConversation({ view, onAction, onActivity, disabled = false }) {
  const [conversation, setConversation] = useState(null), [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true), [sending, setSending] = useState(false), [error, setError] = useState('');
  const [failedCommand, setFailedCommand] = useState(null), [reload, setReload] = useState(0);
  const request = useRef(null), generation = useRef(0), mounted = useRef(true), locked = useRef(false), input = useRef(null), log = useRef(null);
  const activity = useRef(onActivity); activity.current = onActivity;

  async function call(method, body, signal) {
    const response = await fetch(`/api/help/${method === 'GET' ? 'conversation' : 'messages'}`, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, signal });
    let data; try { data = await response.json(); } catch { throw new Error('A ajuda está indisponível no momento. Tente novamente.'); }
    if (response.status === 404) throw new Error('A conversa com Fio ainda não está disponível. Você pode usar o guia desta tela.');
    if (!response.ok) throw new Error(data.error?.message || 'Não foi possível consultar a ajuda. Tente novamente.');
    return readEnvelope(data);
  }

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController(), version = ++generation.current;
    request.current = controller; setLoading(true); setError('');
    const timeout = setTimeout(() => controller.abort('timeout'), 65000);
    call('GET', null, controller.signal).then(data => {
      if (mounted.current && version === generation.current) setConversation(data);
    }).catch(cause => {
      if (mounted.current && version === generation.current && controller.signal.reason !== 'unmount') setError(controller.signal.aborted ? 'A ajuda demorou para carregar. Tente novamente.' : cause instanceof TypeError ? 'Não foi possível conectar à ajuda. Tente novamente.' : cause.message || 'Não foi possível conectar à ajuda.');
    }).finally(() => { clearTimeout(timeout); if (mounted.current && version === generation.current) setLoading(false); });
    return () => { mounted.current = false; generation.current++; request.current?.abort('unmount'); clearTimeout(timeout); activity.current?.('idle'); };
  }, [reload]);

  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [conversation?.messages.length, sending]);
  useEffect(() => { activity.current?.(sending ? 'thinking' : draft.trim() ? 'listening' : 'greeting'); }, [sending, draft]);

  async function send(command) {
    if (locked.current || disabled || loading || !conversation) return;
    const text = (command?.text || draft).trim(); if (!text || text.length > 1000) return;
    const payload = command || (failedCommand?.text === text ? failedCommand : { commandId: crypto.randomUUID(), text, view: VIEWS.has(view) ? view : 'library' });
    locked.current = true; setSending(true); setError(''); setFailedCommand(null);
    const version = generation.current, controller = new AbortController(); request.current = controller;
    const timeout = setTimeout(() => controller.abort('timeout'), 65000);
    try {
      const data = await call('POST', payload, controller.signal);
      if (mounted.current && version === generation.current) { setConversation(data); setDraft(''); }
    } catch (cause) {
      if (mounted.current && version === generation.current) {
        setFailedCommand(payload);
        setError(controller.signal.aborted ? 'A resposta demorou. Sua pergunta foi preservada; tentar novamente consulta a mesma ação.' : cause instanceof TypeError ? 'Não foi possível conectar à ajuda. Sua pergunta foi preservada.' : cause.message || 'Não foi possível conectar à ajuda. Sua pergunta foi preservada.');
      }
    } finally { clearTimeout(timeout); locked.current = false; if (mounted.current && version === generation.current) setSending(false); }
  }

  return <div className="fio-help">
    <div className="fio-help__mode"><span className="fio-help__dot" aria-hidden="true" />{conversation ? conversation.mode === 'openai' ? 'Ajuda com IA' : 'Guia da plataforma' : 'Ajuda sobre o Frontline'}<span>Histórico de ajuda</span></div>
    <div className="fio-help__messages" ref={log} role="log" aria-label="Conversa de ajuda com Fio" aria-live="polite" aria-relevant="additions" aria-busy={loading || sending}>
      {loading ? <p className="fio-help__empty" role="status">Carregando sua conversa…</p> : conversation?.messages.length ? conversation.messages.map(message => <div key={message.id} className={`fio-help__message fio-help__message--${message.role}`}><span>{message.role === 'user' ? 'Você' : 'Fio'}</span><p>{message.text}</p></div>) : <div className="fio-help__empty"><strong>Vamos encontrar o próximo passo.</strong><p>Posso explicar como criar situações, consultar revisões e navegar pelo Frontline.</p></div>}
      {sending ? <p className="fio-help__working" role="status">{conversation?.mode === 'openai' ? 'Fio está preparando a resposta…' : 'Consultando o guia…'}</p> : null}
    </div>
    {!loading && !conversation?.messages.length ? <div className="fio-help__suggestions" aria-label="Sugestões de perguntas">{SUGGESTIONS.map(text => <button type="button" key={text} disabled={sending || disabled} onClick={() => { setDraft(text); input.current?.focus(); }}>{text}</button>)}</div> : null}
    {conversation?.actions?.length ? <div className="fio-help__links" aria-label="Próximos passos sugeridos">{conversation.actions.map(action => <button type="button" key={action.id} disabled={sending || disabled} onClick={() => onAction?.(action.id)}>{action.label}<span aria-hidden="true"> ↗</span></button>)}</div> : null}
    {error ? <div className="fio-help__error" role="alert"><p>{error}</p><button type="button" disabled={loading || sending || disabled} onClick={() => failedCommand ? send(failedCommand) : setReload(value => value + 1)}>Tentar novamente</button></div> : null}
    <form className="fio-help__composer" onSubmit={event => { event.preventDefault(); send(); }}>
      <label htmlFor="fio-help-question">Sua dúvida sobre a plataforma</label>
      <div><textarea id="fio-help-question" ref={input} value={draft} maxLength={1000} rows={2} disabled={sending || disabled} placeholder="Como posso usar o Frontline?" onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} /><button type="submit" disabled={loading || sending || disabled || !conversation || !draft.trim()} aria-label="Enviar pergunta ao Fio">{sending ? '…' : '↑'}</button></div>
      <small>Ajuda de uso · não responde pelo participante no ensaio.</small>
    </form>
  </div>;
}
