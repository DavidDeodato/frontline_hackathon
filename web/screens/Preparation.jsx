import React, { useState } from 'react';
import { ArrowRight, Check, CircleHelp, Paperclip, UserRound } from 'lucide-react';
import { Header, Mode, Notice, ScenePreview, useStoredText } from './common.jsx';

export default function Preparation({ draft, busy, providerMode, onCancel, onGenerate, onRevise, onPublish }) {
  const [text, setText] = useStoredText('frontline:v1:context');
  const [policy, setPolicy] = useStoredText('frontline:v1:policy');
  const [showPolicy, setShowPolicy] = useState(Boolean(policy));
  const [editing, setEditing] = useState(false), [localError, setLocalError] = useState('');
  const generate = async event => {
    event.preventDefault(); setLocalError('');
    try { const ok = await onGenerate(text, policy); if (ok) setEditing(false); } catch (error) { setLocalError(error.message); }
  };
  if (draft && !editing) return <ScenarioReview key={`${draft.id}-${draft.version}`} scenario={draft} editable busy={busy} onBack={() => setEditing(true)} onConfirm={onPublish} onRevise={onRevise} providerMode={providerMode}/>;
  return <form className="fl-screen fl-preparation" data-frame="F02" onSubmit={generate}>
    <Header title="O que você precisa treinar?" subtitle="Conte a situação. O Frontline prepara um exercício para você revisar."/>
    <div className="fl-prep-grid"><section className="fl-panel fl-context-editor">
      <label className="fl-field-title" htmlFor="context">Descreva a conversa</label>
      <textarea id="context" data-guide="context" rows={8} value={text} onChange={event => setText(event.target.value)} maxLength={6000} required placeholder="Preciso treinar como atender um cliente que vai viajar amanhã. O aparelho dele está no conserto, a peça ainda não tem prazo e ele precisa de uma alternativa…" disabled={busy}/>
      <div className="fl-field-meta"><span>Use um exemplo sem dados pessoais.</span><span>{text.length}/6000</span></div>
      <button className="fl-policy-toggle" type="button" aria-expanded={showPolicy} onClick={() => setShowPolicy(show => !show)}><Paperclip size={22}/><span>{showPolicy ? 'Política do exercício' : 'Adicionar regras conhecidas, se houver'}</span><span>{showPolicy ? '−' : '+'}</span></button>
      {showPolicy && <div className="fl-policy-input"><label htmlFor="policy">Regras e limites conhecidos</label><textarea id="policy" rows={4} value={policy} onChange={event => setPolicy(event.target.value)} maxLength={6000} disabled={busy} placeholder="Ex.: aparelho provisório disponível, documento obrigatório e devolução em até sete dias."/><small>Opcional. Seu texto será preservado junto ao contexto.</small></div>}
      <p className="fl-prep-scope"><strong>Nesta versão:</strong> atendimentos de pós-venda e assistência técnica de aparelhos. O exercício usa personagens e dados fictícios.</p>
    </section><aside className="fl-panel fl-prep-summary">
      <h2>Da situação ao ensaio</h2><div className="fl-prep-guidance"><div><strong>Um contexto para praticar</strong><p>Você descreve a dificuldade. O exercício organiza a necessidade do cliente, as regras conhecidas e as lacunas.</p></div><div><strong>Uma revisão rápida</strong><p>Confira a proposta e diga o que quer mudar, com suas próprias palavras.</p></div><div><strong>Uma conversa com evidências</strong><p>Pratique até três respostas. Depois, revise três critérios com trechos da sua conversa.</p></div></div>
      <p className="fl-help-line"><CircleHelp size={23}/><span>Não precisa montar os parâmetros.<small>Os ajustes avançados ficam disponíveis na revisão.</small></span></p><Mode mode={providerMode}/>
      {providerMode === 'fixture' && <Notice>O modo demonstrativo conserva seu relato e apresenta o cenário base para revisão. Não faz adaptação livre por IA.</Notice>}
    </aside></div>
    {localError && <Notice warning>{localError}</Notice>}<footer className="fl-action-bar"><button className="secondary" type="button" disabled={busy} onClick={draft ? () => setEditing(false) : onCancel}>{draft ? 'Voltar à proposta' : 'Cancelar'}</button><p>Seu relato permanece salvo neste navegador.</p><button className="primary" type="submit" disabled={busy || !text.trim()}>{busy ? 'Preparando exercício…' : 'Preparar meu exercício'}<ArrowRight size={20}/></button></footer>
  </form>;
}

export function ScenarioReview({ scenario, busy, onBack, onConfirm, onRevise, editable = false, providerMode }) {
  const [title, setTitle] = useState(scenario.title), [summary, setSummary] = useState(scenario.summary);
  const [loanAvailable, setLoanAvailable] = useState(scenario.rules?.loanAvailable ?? true), [loanDays, setLoanDays] = useState(scenario.rules?.loanDays ?? 7);
  const [criteria, setCriteria] = useState(() => scenario.rubric.criteria.map(item => ({ ...item })));
  const [revision, setRevision] = useStoredText(`frontline:v1:revision:${scenario.id}`);
  const [error, setError] = useState('');
  const blockedLoan = !loanAvailable || Number(loanDays) < (scenario.rules?.clientReturnDays ?? 4);
  const changed = title !== scenario.title || summary !== scenario.summary || loanAvailable !== scenario.rules?.loanAvailable || Number(loanDays) !== scenario.rules?.loanDays || JSON.stringify(criteria) !== JSON.stringify(scenario.rubric.criteria);
  const confirm = async () => {
    setError('');
    if (editable && revision.trim()) { setError('Aplique o pedido de revisão ou limpe o campo antes de começar. Assim você inicia a versão que acabou de conferir.'); return; }
    if (!title.trim() || !summary.trim() || criteria.some(c => !c.name.trim() || !c.observable.trim())) { setError('Complete o título, o contexto e os três critérios antes de continuar.'); return; }
    const changes = editable && changed ? { title: title.trim(), summary: summary.trim(), rules: { loanAvailable, loanDays: Number(loanDays) }, rubric: { ...scenario.rubric, criteria } } : {};
    try { await onConfirm(changes); } catch (problem) { setError(problem.message); }
  };
  const revise = async event => {
    event.preventDefault(); setError(''); if (!revision.trim() || !onRevise || busy) return;
    if (changed) { setError('Há ajustes manuais ainda não salvos. Desfaça esses ajustes antes de revisar por texto, ou limpe o pedido e comece com os ajustes manuais.'); return; }
    try { const ok = await onRevise(revision); if (ok) setRevision(''); } catch (problem) { setError(problem.message); }
  };
  return <div className="fl-screen fl-scenario-review" data-frame="F03" data-guide="scenario">
    <div className="fl-scenario-grid"><section className="fl-panel fl-scenario-copy">
      <div className="fl-section-heading"><span className="fl-muted">{editable ? 'Seu exercício / Revisão' : 'Biblioteca / Cenário'}</span><span className="fl-pill">Dados fictícios</span></div><h1>{title}</h1><p className="fl-lead">{editable ? 'Confira a proposta. Depois, comece a conversa.' : 'Uma situação para praticar antes do atendimento.'}</p>
      {scenario.authorMessage && <Notice>{scenario.authorMessage}</Notice>}
      <section className="fl-review-section"><h2>Você vai praticar</h2><p className="fl-soft-block">{summary}</p>{scenario.contextNeed && <p className="fl-need"><strong>Necessidade do cliente:</strong> {scenario.contextNeed}</p>}
        <p className="fl-prep-scope">{scenario.rules?.loanAvailable ? `Há um aparelho provisório, sujeito a documento e devolução em até ${scenario.rules.loanDays} dias.` : 'Não há aparelho provisório disponível neste exercício.'} O prazo do reparo não está confirmado. <strong>Premissas do cenário fictício; confira as fontes abaixo.</strong></p>
        {scenario.contextUnknowns?.length > 0 && <div className="fl-unknowns"><strong>O que ainda não sabemos</strong><ul>{scenario.contextUnknowns.map((text, index) => <li key={index}>{text}</li>)}</ul></div>}
      </section>
      {editable && <form className="fl-revision-form" onSubmit={revise}><label htmlFor="revision">O que você quer ajustar?</label><textarea id="revision" rows={3} value={revision} maxLength={6000} disabled={busy} onChange={event => setRevision(event.target.value)} placeholder="Ex.: o provisório só pode ficar por três dias. Quero praticar como explicar esse limite."/><div><small>{providerMode === 'fixture' ? 'Modo demonstrativo: as regras seguem o cenário determinístico disponível.' : 'Descreva a mudança. Você poderá conferir a nova versão antes de começar.'}</small><button className="secondary" type="submit" disabled={busy || !onRevise || !revision.trim()}>{busy ? 'Revisando…' : 'Revisar exercício'}<ArrowRight size={17}/></button></div></form>}
      <section className="fl-review-section"><h2>O que será observado</h2><ol className="fl-criteria-list">{criteria.map((criterion, index) => <li key={criterion.id}><span>{String(index + 1).padStart(2, '0')}</span>{criterion.name}</li>)}</ol><small>O feedback usará trechos da conversa, sem nota de competência profissional.</small></section>
      <details className="fl-advanced"><summary>{editable ? 'Fontes, condições e ajustes avançados' : 'Fontes e condições do exercício'}</summary>
        {scenario.rawContext && <details className="fl-source-details"><summary>Relato original preservado</summary><p>{scenario.rawContext}</p>{scenario.rawPolicyText && <><strong>Política informada</strong><p>{scenario.rawPolicyText}</p></>}</details>}
        {scenario.contextualFacts?.length > 0 && <section className="fl-source-details"><h3>Fatos e suas fontes</h3>{scenario.contextualFacts.map(fact => <article key={fact.id}><span className="fl-pill">{{ provided: 'Informado no relato', unknown: 'Desconhecido', fictional: 'Premissa fictícia' }[fact.status] || fact.status}</span><p>{fact.text}</p>{fact.sourceQuote && <blockquote>“{fact.sourceQuote}”</blockquote>}</article>)}</section>}
        <section className="fl-review-section"><h2>Fatos e limites</h2><dl className="fl-fact-table"><div><dt>Reparo</dt><dd><span className="fl-dot fl-dot-warning"/>Peça sem prazo confirmado</dd><small>Ordem de serviço fictícia</small></div><div><dt>Alternativa</dt><dd><span className="fl-dot"/>{loanAvailable ? '1 aparelho provisório disponível' : 'Provisório indisponível'}</dd><small>Política do exercício</small></div><div><dt>Identificação</dt><dd><span className="fl-dot"/>Documento obrigatório</dd><small>A confirmar com o cliente</small></div><div><dt>Devolução</dt><dd><span className="fl-dot"/>Em até {loanDays} {Number(loanDays) === 1 ? 'dia' : 'dias'}</dd><small>Política do exercício</small></div></dl>
          {editable && <fieldset className="fl-rule-editor" disabled={busy}><legend>Ajustar condições</legend><label className="fl-check-row"><input type="checkbox" checked={loanAvailable} onChange={event => setLoanAvailable(event.target.checked)}/>Aparelho provisório disponível</label><label htmlFor="loan-days">Prazo de devolução</label><select id="loan-days" value={loanDays} onChange={event => setLoanDays(Number(event.target.value))}>{[1, 2, 3, 4, 5, 6, 7].map(day => <option key={day} value={day}>{day} {day === 1 ? 'dia' : 'dias'}</option>)}</select><small>Alterações manuais serão salvas ao começar.</small></fieldset>}
          {blockedLoan && <Notice warning>Com estas condições, o empréstimo não é uma saída viável. Ainda é possível combinar uma atualização sem prometer o reparo.</Notice>}
        </section>
        {editable && <section className="fl-review-section fl-advanced-fields"><h2>Ajustar texto e critérios</h2><label className="field-label" htmlFor="scenario-title">Título</label><input id="scenario-title" disabled={busy} value={title} maxLength={160} onChange={event => setTitle(event.target.value)}/><label className="field-label" htmlFor="scenario-summary">Contexto</label><textarea id="scenario-summary" disabled={busy} rows={4} value={summary} maxLength={1200} onChange={event => setSummary(event.target.value)}/>{criteria.map((criterion, index) => <div key={criterion.id}><label className="field-label" htmlFor={`criterion-${index}`}>Critério {index + 1}</label><input id={`criterion-${index}`} disabled={busy} value={criterion.name} maxLength={160} onChange={event => setCriteria(items => items.map((item, i) => i === index ? { ...item, name: event.target.value } : item))}/><label className="field-label" htmlFor={`observable-${index}`}>O que observar</label><textarea id={`observable-${index}`} disabled={busy} rows={2} value={criterion.observable} maxLength={600} onChange={event => setCriteria(items => items.map((item, i) => i === index ? { ...item, observable: event.target.value } : item))}/></div>)}</section>}
        {scenario.revisionHistory?.length > 0 && <details className="fl-source-details"><summary>Histórico de revisões</summary>{scenario.revisionHistory.map((item, index) => <article key={`${item.version}-${index}`}><strong>Versão {item.version}</strong><p>{item.requestText}</p></article>)}</details>}
      </details>
    </section><aside className="fl-scenario-aside"><section className="fl-dark-panel"><div className="fl-section-heading"><h2>Balcão de atendimento</h2><span className="fl-outline-pill">Ambiente de exemplo</span></div><ScenePreview readOnly/><h2>Roberto Almeida</h2><p>Cliente fictício</p>{scenario.clientBrief && <div className="fl-client-brief"><span className="fl-outline-pill">Caracterização fictícia</span><h3>O que ele procura</h3><p>{scenario.clientBrief.objective}</p><h3>Como chega à conversa</h3><p>{scenario.clientBrief.initialState}</p>{scenario.clientBrief.traits?.length > 0 && <ul>{scenario.clientBrief.traits.map((trait, index) => <li key={index}>{trait}</li>)}</ul>}</div>}<div className="fl-person-summary"><UserRound size={22}/>1 cliente<span>·</span>até 8 mensagens</div></section><section className="fl-panel fl-person-card"><h3>Você pratica como</h3><div className="fl-person-line"><span className="avatar fl-avatar-cyan">M</span><strong>Mariana Oliveira</strong></div></section><Mode mode={providerMode}/></aside></div>
    {error && <Notice warning>{error}</Notice>}<footer className="fl-action-bar"><span className="fl-ready-label"><span className="fl-round-icon"><Check size={22}/></span>Versão {scenario.version}{changed && editable ? ' · ajustes manuais pendentes' : ' · confira antes de começar'}</span><div className="fl-actions"><button className="secondary" disabled={busy} onClick={onBack}>{editable ? 'Voltar ao relato' : 'Voltar à biblioteca'}</button><button className="primary" disabled={busy} onClick={confirm}>{busy ? 'Confirmando…' : 'Começar ensaio'}<ArrowRight size={21}/></button></div></footer>
  </div>;
}
