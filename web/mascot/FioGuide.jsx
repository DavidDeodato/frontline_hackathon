import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './fio-guide.css';

let mascotModule;
function loadMascot() {
  if (customElements.get('frontline-mascot')) return Promise.resolve();
  if (!mascotModule) mascotModule = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = `${import.meta.env.BASE_URL}mascot/fio.js`;
    script.dataset.frontlineMascot = 'true';
    script.onload = resolve;
    script.onerror = () => { script.remove(); mascotModule = undefined; reject(new Error('Mascot unavailable')); };
    document.head.append(script);
  });
  return mascotModule;
}

const GUIDES = {
  library: { title: 'Seu espaço de prática', text: 'Escolha um episódio para revisar o contexto ou crie uma situação. O guia acompanha suas ações.', selector: '[data-guide="scenario"]' },
  preparation: { title: 'Comece pelo contexto', text: 'Descreva a situação com dados fictícios. Depois da preparação, confira os fatos e as regras antes de iniciar.', selector: '[data-guide="context"]' },
  scenario: { title: 'Confira o exercício', text: 'Leia o contexto, os limites e os três critérios. Quando iniciar, eu me recolho para você conduzir a conversa.', selector: '[data-guide="scenario"]' },
  review: { title: 'Sua conversa é a evidência', text: 'Abra um trecho citado para localizar a fala que sustenta o feedback. A revisão se refere somente a esta tentativa.', selector: '[data-guide="review"]' },
  compare: { title: 'Compare os percursos', text: 'Confira a versão do cenário e os compromissos. Uma nova tentativa preserva o histórico anterior.', selector: '[data-guide="retry"]' },
  records: { title: 'Guarde a revisão', text: 'Escolha uma tentativa para consultar o registro. Uma cópia íntegra não é uma certificação profissional.', selector: '[data-guide="review"]' },
  record: { title: 'Seu registro portátil', text: 'O registro reúne a conversa, a versão do contexto e as evidências. Confira o estado real das opções de integridade.', selector: '[data-guide="review"]' },
  channels: { title: 'Continuidade com clareza', text: 'Confira o estado do canal. Uma conexão planejada só fica disponível depois de ser implementada e confirmada.', selector: null },
  continuity: { title: 'Retome o mesmo exercício', text: 'Use o estado salvo e confira a última atualização. A retomada não cria outra tentativa.', selector: null },
};

/** An optional UI guide. It never reads the transcript or changes training data. */
export default function FioGuide({ view = 'library', session, busy = false, onNavigate }) {
  const mascot = useRef(null), panel = useRef(null), heading = useRef(null), opener = useRef(null);
  const [ready, setReady] = useState(false), [open, setOpen] = useState(false), [assetError, setAssetError] = useState(false);
  const training = view === 'practice' && ['active', 'paused'].includes(session?.status);
  const stage = GUIDES[view] || (view === 'practice' ? GUIDES.review : GUIDES.library);
  const current = useRef({ training, busy }); current.current = { training, busy };
  const close = (restore = true) => {
    setOpen(false); mascot.current?.dock?.(); mascot.current?.setState?.('idle');
    if (restore && opener.current?.isConnected) {
      const focusTarget = opener.current === mascot.current ? mascot.current.shadowRoot?.querySelector('button') : opener.current;
      focusTarget?.focus?.({ preventScroll: true });
    }
  };
  const activate = () => {
    if (current.current.training || current.current.busy) return;
    opener.current = document.activeElement; setOpen(true);
  };

  useEffect(() => {
    let active = true;
    const el = mascot.current;
    const onDismiss = () => close();
    el?.addEventListener('fio-activate', activate); el?.addEventListener('fio-dismiss', onDismiss);
    loadMascot().then(async () => {
      await customElements.whenDefined('frontline-mascot'); await el?.ready;
      if (active) setReady(true);
    }).catch(() => { if (active) setAssetError(true); });
    return () => { active = false; el?.removeEventListener('fio-activate', activate); el?.removeEventListener('fio-dismiss', onDismiss); el?.dock?.(); };
  }, []);

  useEffect(() => {
    const el = mascot.current;
    if (training) { setOpen(false); el?.dock?.(); el?.setState?.('rest'); }
    else if (!open) { el?.dock?.(); el?.setState?.('idle'); }
    el?.shadowRoot?.querySelector('button')?.setAttribute('aria-label', training ? 'Fio recolhido durante o ensaio' : 'Abrir ajuda com Fio');
  }, [training, open, ready]);

  useEffect(() => {
    if (!open || training) return;
    heading.current?.focus({ preventScroll: true });
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, training]);

  useEffect(() => {
    if (!open || training) return;
    let animationFrame = null, disposed = false;
    const target = stage.selector ? document.querySelector(stage.selector) : null;
    target?.classList.add('fio-guide-target');
    const place = () => {
      animationFrame = null;
      if (disposed || !panel.current) return;
      const targetBox = target?.getBoundingClientRect(), p = panel.current, margin = 16;
      let left = innerWidth - p.offsetWidth - margin, top = innerHeight - p.offsetHeight - 100;
      if (targetBox && targetBox.width && targetBox.height) {
        const rightFits = targetBox.right + p.offsetWidth + 92 < innerWidth;
        left = rightFits ? targetBox.right + 82 : Math.min(innerWidth - p.offsetWidth - margin, Math.max(margin, targetBox.left));
        top = rightFits ? targetBox.top : targetBox.bottom + 16;
        if (top + p.offsetHeight > innerHeight - margin) top = Math.max(margin, targetBox.top - p.offsetHeight - 16);
      }
      p.style.left = `${Math.max(margin, left)}px`; p.style.top = `${Math.max(margin, Math.min(innerHeight - p.offsetHeight - margin, top))}px`;
    };
    const reposition = () => {
      if (animationFrame === null) animationFrame = requestAnimationFrame(() => {
        place();
        if (ready && target?.isConnected) mascot.current?.flyTo?.(target, { side: 'right', gap: 12, animate: false }).catch(() => {});
      });
    };
    place();
    if (ready && target) mascot.current?.flyTo?.(target, { side: 'right', gap: 12 }).catch(() => {});
    else mascot.current?.setState?.('greeting');
    window.addEventListener('resize', reposition); window.addEventListener('scroll', reposition, { passive: true, capture: true });
    return () => { disposed = true; cancelAnimationFrame(animationFrame); target?.classList.remove('fio-guide-target'); window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true); mascot.current?.dock?.(); };
  }, [open, training, stage.selector, view, ready]);

  return createPortal(<div className={`fio-guide${training ? ' fio-guide--retracted' : ''}`} data-fio-state={training ? 'rest' : open ? 'guiding' : 'idle'} data-guide-stage={view}>
    <div className="fio-guide__dock" hidden={training}>
      <frontline-mascot ref={mascot} state="idle" style={{ '--fio-size': '74px' }} />
      {!ready ? <button type="button" className="fio-guide__fallback" disabled={busy} onClick={activate} aria-label="Abrir ajuda">{assetError ? 'Ajuda' : 'Fio'}</button> : null}
      {!open ? <span className="fio-guide__label">Ajuda</span> : null}
    </div>
    {open && !training ? <section className="fio-guide__panel" ref={panel} aria-labelledby="fio-guide-heading" aria-label="Ajuda opcional">
      <div className="fio-guide__heading"><span>FIO · GUIA DO ESPAÇO</span><button type="button" onClick={() => close()} aria-label="Fechar ajuda">×</button></div>
      <h2 id="fio-guide-heading" ref={heading} tabIndex={-1}>{stage.title}</h2><p>{stage.text}</p>
      <div className="fio-guide__actions"><button type="button" onClick={() => close()}>Dispensar guia</button>{!stage.selector && onNavigate ? <button type="button" onClick={() => onNavigate('library')}>Ver exercícios</button> : null}</div>
      <small>Continue pelas ações da página · Esc para sair</small>
    </section> : null}
  </div>, document.body);
}
