import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, BookOpenCheck, FileCheck2, LibraryBig, MessageCircle, RefreshCw, WifiOff } from 'lucide-react';
import { api, uid } from './api.js';
import { Library, Preparation, ScenarioReview, Practice, Review, Comparison, Channels, Continuity, Record } from './Surfaces.jsx';
import FioGuide from './mascot/FioGuide.jsx';
import { AsyncState, StatusBadge } from './design-system/Components.jsx';
import Sidebar from './design-system/Sidebar.jsx';
import AuthPage from './auth/AuthPage.jsx';
import { accessState, loginHash, resumeHash } from './auth/access.js';
const complete = s => ['completed', 'incomplete', 'cancelled'].includes(s?.status);
const titles = {
  login: 'Entrar',
  register: 'Criar conta',
  library: 'Biblioteca',
  reviews: 'Revisões',
  records: 'Registros',
  preparation: 'Criar situação',
  scenario: 'Revisar contexto',
  practice: 'Ensaio',
  review: 'Avaliação',
  compare: 'Comparar tentativas',
  channels: 'WhatsApp',
  continuity: 'Continuidade',
  record: 'Registro e exportação'
};
function readRoute() {
  const [view, rawId] = location.hash.replace(/^#\/?/, '').split('?')[0].split('/');
  let id = null;
  try {
    id = rawId ? decodeURIComponent(rawId) : null;
  } catch {}
  return {
    view: Object.hasOwn(titles, view) ? view : 'library',
    id
  };
}
const screens = { Library, Preparation, ScenarioReview, Practice, Review, Comparison, Channels, Continuity, Record };
function Surface({
  name,
  ...props
}) {
  const Component = screens[name];
  return <Component {...props} />;
}
export default function App() {
  const [account, setAccount] = useState({ authenticated: false, user: null });
  const [accountExpired, setAccountExpired] = useState(false);
  const [accountChecked, setAccountChecked] = useState(false);
  const [accountUncertain, setAccountUncertain] = useState(false);
  const [guestSelected, setGuestSelected] = useState(false);
  const entryHash = useRef('');
  const access = accessState(accountChecked, account.authenticated, guestSelected);
  const [identityEpoch, setIdentityEpoch] = useState(0);
  const identityGeneration = useRef(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem('frontline.sidebar.collapsed');
      if (saved !== null) return saved === 'true';
    } catch { /* Navigation remains usable when storage is unavailable. */ }
    return window.matchMedia('(min-width: 761px) and (max-width: 1150px)').matches;
  });
  useEffect(() => {
    try { localStorage.setItem('frontline.sidebar.collapsed', String(sidebarCollapsed)); } catch {}
  }, [sidebarCollapsed]);
  const [route, setRoute] = useState(readRoute),
    [library, setLibrary] = useState({
      scenarios: [],
      sessions: []
    }),
    [health, setHealth] = useState(null),
    [session, setSession] = useState(null),
    [draft, setDraft] = useState(null),
    [scenario, setScenario] = useState(null),
    [comparison, setComparison] = useState(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [sessionLoading, setSessionLoading] = useState(false),
    [online, setOnline] = useState(navigator.onLine);
  const locked = useRef(false),
    pending = useRef(null),
    draftPending = useRef(null),
    publishPending = useRef(null),
    currentSession = useRef(null),
    content = useRef(null),
    view = route.view;
  const remember = next => {
    currentSession.current = next;
    setSession(next);
  };
  const navigate = (nextView, id = null) => {
    if (!Object.hasOwn(titles, nextView)) return;
    const hash = `#/${nextView}${id ? `/${encodeURIComponent(id)}` : ''}`;
    if (location.hash === hash) setRoute({
      view: nextView,
      id
    });else location.hash = hash;
    setError('');
    setNotice('');
    window.scrollTo({
      top: 0,
      behavior: 'instant'
    });
  };
  const refresh = async () => {
    const generation = identityGeneration.current;
    const result = await api('/library');
    if (generation === identityGeneration.current) setLibrary(result);
    return result;
  };
  const refreshQuiet = async () => {
    try {
      await refresh();
    } catch {
      setNotice('A ação foi salva. A biblioteca ainda precisa ser atualizada.');
    }
  };
  useEffect(() => {
    let active = true;
    const generation = identityGeneration.current;
    api('/account').then(result => {
      if (active && generation === identityGeneration.current) setAccount(result);
    }).catch(problem => {
      if (!active || generation !== identityGeneration.current) return;
      setAccountUncertain(true);
      if (problem.status === 401) {
        setAccountExpired(true);
        setError('Sua sessão expirou. Entre novamente ou continue como visitante.');
      } else setError('Não foi possível verificar seu acesso. Tente entrar novamente quando a conexão estiver disponível.');
    }).finally(() => active && generation === identityGeneration.current && setAccountChecked(true));
    const onHash = () => setRoute(readRoute()),
      up = () => setOnline(true),
      down = () => setOnline(false);
    window.addEventListener('hashchange', onHash);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      active = false;
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  useEffect(() => {
    if (access !== 'login' || ['login', 'register'].includes(view)) return;
    entryHash.current = location.hash || '#/library';
    history.replaceState(history.state, '', `${location.pathname}${location.search}${loginHash(location.hash)}`);
    setRoute(readRoute());
  }, [access, view]);
  useEffect(() => {
    if (access !== 'allowed') return;
    let active = true;
    const generation = identityGeneration.current;
    setLoading(true);
    Promise.all([api('/library'), api('/health')]).then(([data, status]) => {
      if (active && generation === identityGeneration.current) { setLibrary(data); setHealth(status); }
    }).catch(problem => active && generation === identityGeneration.current && setError(problem.message || 'Não foi possível carregar seu espaço.'))
      .finally(() => active && generation === identityGeneration.current && setLoading(false));
    return () => { active = false; };
  }, [access, identityEpoch]);
  useEffect(() => {
    let active = true;
    const generation = identityGeneration.current;
    if (access !== 'allowed' || !route.id || currentSession.current?.id === route.id || !['practice', 'review', 'record', 'continuity'].includes(view)) {
      setSessionLoading(false);
      return;
    }
    setSessionLoading(true);
    api(`/sessions/${encodeURIComponent(route.id)}`).then(data => active && generation === identityGeneration.current && remember(data.session)).catch(e => active && generation === identityGeneration.current && setError(e.message || 'Esta tentativa não pôde ser aberta.')).finally(() => active && generation === identityGeneration.current && setSessionLoading(false));
    return () => {
      active = false;
    };
  }, [route.id, view, identityEpoch, access]);
  useEffect(() => {
    content.current?.focus({
      preventScroll: true
    });
  }, [view]);
  const perform = async action => {
    if (locked.current) return false;
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      return true;
    } catch (e) {
      if (e.session) remember(e.session);
      if (e.status === 409) pending.current = null;
      setError(e.message || 'Não foi possível concluir. Seu texto foi preservado.');
      return false;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const changeAccount = async (next, operation) => {
    identityGeneration.current += 1;
    setIdentityEpoch(identityGeneration.current);
    setAccount(next);
    setAccountExpired(false);
    setAccountUncertain(false);
    setAccountChecked(true);
    setGuestSelected(operation === 'visitor');
    remember(null);
    setDraft(null);
    setScenario(null);
    setComparison(null);
    setLibrary({ scenarios: [], sessions: [] });
    pending.current = null;
    draftPending.current = null;
    publishPending.current = null;
    if (operation !== 'register') {
      try {
        Object.keys(localStorage).filter(key => key.startsWith('frontline:v1:')).forEach(key => localStorage.removeItem(key));
      } catch { /* Storage can be unavailable; no account credentials are stored here. */ }
    }
    setLoading(operation !== 'logout');
    setSessionLoading(false);
    if (operation === 'logout') {
      entryHash.current = '';
      navigate('login');
      setRoute({ view: 'login', id: null });
    } else {
      location.hash = resumeHash(location.hash, entryHash.current);
      entryHash.current = '';
      setRoute(readRoute());
    }
  };
  const authenticate = (operation, credentials) => perform(async () => {
    try {
      const result = await api(`/account/${operation}`, 'POST', credentials);
      await changeAccount(result, operation);
    } catch (problem) {
      if (problem.status === 404) throw new Error('O acesso por conta ainda não está disponível neste servidor. Você pode continuar como visitante.');
      throw problem;
    }
  });
  const logout = () => perform(async () => {
    const result = await api('/account/logout', 'POST', {});
    await changeAccount(result, 'logout');
  });
  const continueAsVisitor = () => perform(async () => {
    if (accountExpired || accountUncertain || account.authenticated) {
      const result = await api('/account/logout', 'POST', {});
      await changeAccount(result, 'visitor');
    } else {
      setGuestSelected(true);
      location.hash = resumeHash(location.hash, entryHash.current);
      entryHash.current = '';
      setRoute(readRoute());
    }
  });
  const recoverDraftConflict = async (problem, id) => {
    if (problem.status !== 409) return;
    draftPending.current = null;
    publishPending.current = null;
    if (id) {
      try {
        const result = await api(`/drafts/${encodeURIComponent(id)}/versions`);
        const latest = result.versions?.slice().sort((a, b) => b.version - a.version)[0]?.draft;
        if (latest) setDraft(latest);
      } catch {/* Preserve the current preview if refreshing it fails. */}
    }
  };
  const generate = (text, policyText = '') => perform(async () => {
    const signature = JSON.stringify({
      operation: 'create',
      text,
      policyText
    });
    if (draftPending.current?.signature !== signature) draftPending.current = {
      signature,
      commandId: uid()
    };
    try {
      const result = await api('/drafts', 'POST', {
        text,
        policyText,
        commandId: draftPending.current.commandId
      });
      setDraft(result.draft);
      draftPending.current = null;
      publishPending.current = null;
    } catch (problem) {
      await recoverDraftConflict(problem);
      throw problem;
    }
  });
  const revise = text => perform(async () => {
    if (!draft) throw new Error('Prepare o exercício antes de pedir uma alteração.');
    const signature = JSON.stringify({
      operation: 'revise',
      id: draft.id,
      text
    });
    if (draftPending.current?.signature !== signature) draftPending.current = {
      signature,
      commandId: uid(),
      expectedVersion: draft.version
    };
    try {
      const result = await api(`/drafts/${encodeURIComponent(draft.id)}/revisions`, 'POST', {
        text,
        commandId: draftPending.current.commandId,
        expectedVersion: draftPending.current.expectedVersion
      });
      setDraft(result.draft);
      draftPending.current = null;
      publishPending.current = null;
    } catch (problem) {
      await recoverDraftConflict(problem, draft.id);
      throw problem;
    }
  });
  const publish = (changes = {}) => perform(async () => {
    if (!draft) throw new Error('Prepare o contexto antes de iniciar.');
    let confirmed = draft;
    try {
      if (Object.keys(changes).length) {
        const result = await api(`/drafts/${encodeURIComponent(draft.id)}`, 'PATCH', {
          ...changes,
          expectedVersion: draft.version
        });
        confirmed = result.draft;
        setDraft(confirmed);
      }
      const signature = JSON.stringify({
        id: confirmed.id,
        version: confirmed.version
      });
      if (publishPending.current?.signature !== signature) publishPending.current = {
        signature,
        commandId: uid()
      };
      const {
        scenario: published
      } = await api(`/drafts/${encodeURIComponent(confirmed.id)}/publish`, 'POST', {
        expectedVersion: confirmed.version,
        commandId: publishPending.current.commandId
      });
      const {
        session: next
      } = await api('/sessions', 'POST', {
        scenarioId: published.id,
        scenarioVersion: published.version
      });
      remember(next);
      publishPending.current = null;
      draftPending.current = null;
      pending.current = null;
      navigate('practice', next.id);
      await refreshQuiet();
    } catch (problem) {
      await recoverDraftConflict(problem, draft.id);
      throw problem;
    }
  });
  const open = (id, destination) => perform(async () => {
    const {
      session: next
    } = await api(`/sessions/${encodeURIComponent(id)}`);
    remember(next);
    setComparison(null);
    navigate(destination || (complete(next) ? 'review' : 'practice'), next.id);
  });
  const start = candidate => perform(async () => {
    const {
      session: next
    } = await api('/sessions', 'POST', {
      scenarioId: candidate.id,
      scenarioVersion: candidate.version
    });
    remember(next);
    pending.current = null;
    setComparison(null);
    navigate('practice', next.id);
    await refreshQuiet();
  });
  const command = (action, extra = {}) => perform(async () => {
    const current = currentSession.current;
    if (!current) throw new Error('Abra uma tentativa antes de continuar.');
    const signature = JSON.stringify({
      id: current.id,
      action,
      extra
    });
    if (pending.current?.signature !== signature) pending.current = {
      signature,
      commandId: uid(),
      expectedRevision: current.revision
    };
    const {
      session: next
    } = await api(`/sessions/${encodeURIComponent(current.id)}/${action}`, 'POST', {
      ...extra,
      commandId: pending.current.commandId,
      expectedRevision: pending.current.expectedRevision
    });
    remember(next);
    pending.current = null;
    if (action === 'branches') {
      setComparison(null);
      navigate('practice', next.id);
    }
    await refreshQuiet();
  });
  const compare = (left, right = currentSession.current?.id) => perform(async () => {
    if (!left || !right || left === right) throw new Error('Selecione duas tentativas diferentes para comparar.');
    const result = await api(`/compare?left=${encodeURIComponent(left)}&right=${encodeURIComponent(right)}`);
    setComparison(result);
    remember(result.right);
    navigate('compare');
  });
  const home = () => {
    navigate('library');
    refreshQuiet();
  };
  const selectedSession = session || library.sessions.find(item => item.status === 'paused') || library.sessions[0] || null;
  const resume = () => selectedSession ? open(selectedSession.id) : navigate('library');
  const openHistory = () => selectedSession ? open(selectedSession.id, 'practice') : navigate('library');
  const showRecord = () => session && navigate('record', session.id),
    showReview = id => id ? open(id, 'review') : session && navigate('review', session.id);
  const sections = [{
    id: 'library',
    label: 'Praticar',
    Icon: LibraryBig,
    active: ['library', 'preparation', 'scenario', 'practice'].includes(view)
  }, {
    id: 'reviews',
    label: 'Revisões',
    Icon: BookOpenCheck,
    active: ['reviews', 'review', 'compare'].includes(view)
  }, {
    id: 'channels',
    label: 'Conexões',
    Icon: MessageCircle,
    active: ['channels', 'continuity'].includes(view)
  }, {
    id: 'records',
    label: 'Registros',
    Icon: FileCheck2,
    active: ['records', 'record'].includes(view)
  }];
  const missingSession = ['practice', 'review', 'record'].includes(view) && (!session || route.id && session.id !== route.id);
  if (access === 'checking') return <AsyncState loading title="Verificando seu acesso…" />;
  if (access === 'login' || view === 'login' || view === 'register') return <AuthPage mode={view === 'register' ? 'register' : 'login'} onNavigate={(next) => {
    const query = location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?')) : '';
    location.hash = `#/${next}${query}`;
    setRoute(readRoute());
    setError('');
  }} onVisitor={continueAsVisitor} onSubmit={authenticate} busy={busy} error={error || (accountExpired ? 'Sua sessão expirou. Entre novamente ou continue como visitante.' : '')} online={online} />;
  return <div className={`app-shell frontline-shell${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}`} style={{ '--sidebar-width': sidebarCollapsed ? '80px' : '244px' }}>
  <a className="skip-link" href="#main-content" onClick={e => {
      e.preventDefault();
      content.current?.focus();
    }}>Pular para o conteúdo</a>
  <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(value => !value)} sections={sections} onNavigate={id => id === 'library' ? home() : navigate(id)} onHome={home} busy={busy} user={account.user} onLogin={() => navigate('login')} onLogout={logout} />
  <main className="main" ref={content} id="main-content" tabIndex={-1} aria-busy={busy || loading || sessionLoading}>
   <header className="topbar"><div className="breadcrumb"><span>Seu espaço</span><span aria-hidden="true">/</span><strong>{titles[view]}</strong></div><div className="topbar-meta">{health && <StatusBadge tone="neutral">{health.providerMode === 'openai' ? 'Conversa com IA' : 'Modo demonstração'}</StatusBadge>}<span className="simulation-label">Dados fictícios</span><button className="mobile-account" disabled={busy} onClick={account.authenticated ? logout : () => navigate('login')} aria-label={account.authenticated ? `Sair da conta de ${account.user?.name}` : 'Entrar na sua conta'}>{account.authenticated ? 'Sair' : 'Entrar'}</button></div></header>
   {!online && <div className="notice" role="status"><WifiOff size={18} /><span>Sem conexão. Os envios ficam indisponíveis até a reconexão.</span></div>}
   {notice && <div className="notice" role="status"><span>{notice}</span><button className="text-button" disabled={busy} onClick={() => perform(refresh)}>Atualizar biblioteca</button></div>}
   {error && (view !== 'practice' || missingSession) && <div className="global-error" role="alert"><span>{error}</span>{accountExpired ? <button className="text-button" disabled={busy} onClick={logout}>Continuar como visitante</button> : <button className="text-button" disabled={busy} onClick={() => perform(refresh)}><RefreshCw size={16} />Atualizar biblioteca</button>}</div>}
   {!['library', 'reviews', 'records'].includes(view) && <button className="back-link" disabled={busy} onClick={home}><ArrowLeft size={16} />Biblioteca</button>}
   {loading || sessionLoading ? <AsyncState loading title={loading ? 'Carregando seu espaço…' : 'Abrindo tentativa…'} /> : missingSession ? <AsyncState title="Escolha uma tentativa" description="Abra uma sessão salva na biblioteca para continuar." action={<button className="primary" onClick={home}>Ir para a biblioteca</button>} /> : <>
    {['library', 'reviews', 'records'].includes(view) && <Surface key={identityEpoch} name="Library" {...library} userName={account.user?.name || 'Visitante'} variant={view} busy={busy} providerMode={health?.providerMode} onStart={start} onOpen={id => open(id, view === 'records' ? 'record' : undefined)} onCreate={() => {
          setDraft(null);
          draftPending.current = null;
          publishPending.current = null;
          navigate('preparation');
        }} onInspect={next => {
          setScenario(next);
          navigate('scenario');
        }} onCompare={compare} />}
    {view === 'preparation' && <Surface name="Preparation" draft={draft} busy={busy} providerMode={health?.providerMode} onCancel={home} onGenerate={generate} onRevise={revise} onPublish={publish} />}
    {view === 'scenario' && (scenario ? <Surface name="ScenarioReview" scenario={scenario} busy={busy} editable={false} onBack={home} onConfirm={() => start(scenario)} /> : <AsyncState title="Escolha um cenário" action={<button className="primary" onClick={home}>Abrir biblioteca</button>} />)}
    {view === 'practice' && session && <Surface name="Practice" session={session} busy={busy || !online} error={error} onMessage={text => command('messages', {
          text
        })} onDocument={objectId => command('documents', {
          objectId
        })} onState={action => command(action)} onReview={() => showReview()} />}
    {view === 'review' && session && <Surface name="Review" session={session} sessions={library.sessions} comparison={comparison} busy={busy} onBranch={() => command('branches')} onRetry={() => command('assessment/retry')} onCompare={compare} onExport={showRecord} onOpen={id => open(id)} onConversation={() => navigate('practice', session.id)} />}
    {view === 'compare' && (comparison ? <Surface name="Comparison" comparison={comparison} busy={busy} onBranch={() => command('branches')} onOpen={id => open(id, 'review')} onReview={id => open(id, 'review')} onExport={showRecord} /> : <AsyncState title="Selecione duas tentativas" action={<button className="primary" onClick={home}>Abrir biblioteca</button>} />)}
    {view === 'channels' && <Surface name="Channels" session={selectedSession} onResume={resume} onContinuity={() => navigate('continuity', selectedSession?.id)} />}
    {view === 'continuity' && <Surface name="Continuity" session={selectedSession} busy={busy} onResume={resume} onOpen={openHistory} onChannels={() => navigate('channels')} />}
    {view === 'record' && session && <Surface name="Record" session={session} busy={busy} onBack={() => showReview()} onReview={() => showReview()} />}
   </>}
  </main>
  <FioGuide view={view} session={session} busy={busy || loading || sessionLoading} onNavigate={navigate} accountKey={`${account.user?.id || 'guest'}:${identityEpoch}`} />
 </div>;
}
