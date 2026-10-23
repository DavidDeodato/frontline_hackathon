import React, { useEffect, useRef, useState, lazy, Suspense } from 'react';
import { CheckCircle2, Circle, Info, X, FileText, AlertCircle } from 'lucide-react';
import { stateLabel } from '../api.js';

const Scene = lazy(() => import('../Scene.jsx'));
export const finished = session => ['completed', 'incomplete', 'cancelled'].includes(session?.status);
export const lastNpc = session => session?.messages?.filter(message => message.role === 'npc').at(-1);
export const lastUser = session => session?.messages?.filter(message => message.role === 'user').at(-1);
export const attemptName = session => session.parentSessionId ? 'Nova tentativa' : 'Primeira tentativa';
export const commitmentLabel = { none: 'Sem compromisso', draft: 'Rascunho', valid: 'Combinado no exercício', unsupported: 'Promessa sem respaldo' };
export function Status({ session }) { return <span className={`fl-status fl-status-${session.status}`}><Circle size={11}/>{stateLabel[session.status] || session.status}</span>; }
export function Mode({ mode }) { return mode ? <span className="fl-mode">{mode === 'openai' ? 'Conversa com IA' : 'Demonstração determinística · fixture'}</span> : null; }
export function Header({ title, subtitle, children }) { return <header className="fl-page-header"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{children && <div className="fl-header-actions">{children}</div>}</header>; }
export function Notice({ children, warning = false }) { return <div className={`fl-notice ${warning ? 'fl-notice-warning' : ''}`} role="status">{warning ? <AlertCircle size={19}/> : <Info size={19}/>}<span>{children}</span></div>; }
export function Empty({ title, children, action }) { return <div className="fl-empty"><FileText size={30}/><h3>{title}</h3><p>{children}</p>{action}</div>; }
export function ScenePreview({ className = '', ...props }) { return <div className={`fl-scene-stage ${className}`}><Suspense fallback={<div className="fl-scene-loading" role="status">Preparando ambiente…</div>}><Scene {...props}/></Suspense></div>; }
export function useStoredText(key, fallback = '') {
  const [value, setValue] = useState(() => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } });
  const update = next => { setValue(next); try { if (next) localStorage.setItem(key, next); else localStorage.removeItem(key); } catch {} };
  return [value, update];
}
export function TranscriptDialog({ session, messageId, onClose }) {
  const dialog = useRef(null);
  useEffect(() => {
    const element = dialog.current, previous = document.activeElement;
    element?.showModal();
    if (messageId) element?.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`)?.scrollIntoView({ block: 'center', behavior: 'instant' });
    return () => { element?.close(); previous?.focus?.(); };
  }, [messageId]);
  return <dialog className="fl-dialog" ref={dialog} onCancel={event => { event.preventDefault(); onClose(); }} aria-labelledby="fl-transcript-title"><header><div><h2 id="fl-transcript-title">A conversa</h2><p>{session.scenario.title} · Contexto v{session.scenarioVersion}</p></div><button className="icon-button" onClick={onClose} aria-label="Fechar conversa"><X size={22}/></button></header><div className="fl-dialog-body">{session.messages.map(message => <article className={`fl-message fl-message-${message.role} ${message.id === messageId ? 'fl-message-highlight' : ''}`} data-message-id={message.id} key={message.id}><strong>{message.speaker}</strong><p>{message.text}</p></article>)}</div><footer><span>{session.messages.length} de 8 mensagens · {session.mode === 'openai' ? 'IA' : 'Fixture'}</span><button className="secondary" onClick={onClose}>Voltar à revisão</button></footer></dialog>;
}
export function Commitment({ session }) { const commitment = session.commitment; return <div className={`fl-commitment fl-commitment-${commitment.status}`}><span className="fl-icon-tile">{commitment.status === 'valid' ? <CheckCircle2 size={25}/> : <FileText size={25}/>}</span><div><span className="fl-pill">{commitmentLabel[commitment.status]}</span><p>{commitment.text}</p></div></div>; }
export function DeskSymbol() { return <svg viewBox="0 0 240 140" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="m35 70 85-25 85 25-85 30-85-30Zm0 0v43l85 26V100m85-30v43l-85 26"/><circle cx="118" cy="20" r="12"/><path d="M101 51V43a17 17 0 0 1 34 0v18M175 95v24a14 14 0 0 0 28 0V95a14 14 0 0 0-28 0Z"/><circle cx="189" cy="64" r="11"/></svg>; }
