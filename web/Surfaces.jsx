import './screens/screens.css';
import React, { useEffect, useState } from 'react';
import LibraryScreen from './screens/Library.jsx';
import { BRIEF_LIMIT, combineIncomingBrief, readIncomingBrief } from './api.js';

export function Library(props) {
  const [incoming, setIncoming] = useState(() => readIncomingBrief(window.location.hash));
  const [error, setError] = useState('');
  useEffect(() => {
    const capture = () => {
      const next = readIncomingBrief(window.location.hash);
      if (next) { setIncoming(next); consume(); }
    };
    capture();
    window.addEventListener('hashchange', capture);
    return () => window.removeEventListener('hashchange', capture);
  }, []);
  const consume = () => {
    const [route, ...query] = window.location.hash.split('?');
    if (route !== '#/library') return;
    const params = new URLSearchParams(query.join('?'));
    params.delete('brief');
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${route}${params.size ? `?${params}` : ''}`);
  };
  const accept = () => {
    setError('');
    try {
      const previous = window.localStorage.getItem('frontline:v1:context') || '';
      const next = combineIncomingBrief(previous, incoming.text);
      window.localStorage.setItem('frontline:v1:context', next);
      consume(); setIncoming(null); props.onCreate();
    } catch (problem) { setError(problem.message || 'Não foi possível guardar o texto. Copie o relato antes de continuar.'); }
  };
  return <>{incoming && <section className="fl-screen fl-panel" aria-label="Relato recebido do WhatsApp">
    <h2>Revise o relato recebido</h2>
    <p>O texto do link ainda não foi enviado ao Frontline. Confira os dados antes de usar.</p>
    {incoming.error ? <p role="alert">{incoming.error}</p> : <><label className="field-label" htmlFor="incoming-brief">Relato para um novo ensaio</label><textarea id="incoming-brief" rows={5} maxLength={BRIEF_LIMIT} value={incoming.text} onChange={event => setIncoming({ text: event.target.value, error: '' })}/><p>Ao continuar, este texto será acrescentado ao relato salvo e abrirá uma nova preparação. A proposta aberta será deixada; os exercícios já salvos permanecem na biblioteca. Nenhum exercício será gerado automaticamente.</p></>}
    {error && <p role="alert">{error}</p>}<div className="fl-actions"><button type="button" className="secondary" onClick={() => { consume(); setIncoming(null); }}>Descartar texto recebido</button>{!incoming.error && <button type="button" className="primary" disabled={props.busy || !props.onCreate || !incoming.text.trim()} onClick={accept}>Adicionar ao relato e revisar</button>}</div>
  </section>}<LibraryScreen {...props}/></>;
}
export { default as Preparation, ScenarioReview } from './screens/Preparation.jsx';
export { default as Practice } from './screens/Practice.jsx';
export { default as Review, Comparison } from './screens/Review.jsx';
export { default as Channels, Continuity } from './screens/Channels.jsx';
export { default as Record } from './screens/Record.jsx';
