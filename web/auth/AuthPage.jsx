import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Eye, EyeOff, LoaderCircle } from 'lucide-react';
import AuthMascot from './AuthMascot.jsx';
import './AuthPage.css';

export default function AuthPage({ mode = 'login', onNavigate, onVisitor, onSubmit, busy, error, online = true }) {
  const registering = mode === 'register';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [privateField, setPrivateField] = useState(false);
  const heading = useRef(null);
  const errorMessage = useRef(null);
  useEffect(() => {
    setPassword(''); setVisible(false); setPrivateField(false);
    heading.current?.focus({ preventScroll: true });
  }, [mode]);
  useEffect(() => {
    if (error && !busy) errorMessage.current?.focus();
  }, [error, busy]);
  async function submit(event) {
    event.preventDefault();
    if (busy || !online) return;
    const done = await onSubmit(mode, { ...(registering ? { name: name.trim() } : {}), email: email.trim(), password });
    if (done) setPassword('');
  }
  return <main className="auth-page">
    <section className="auth-story" aria-label="Frontline, seu espaço de prática">
      <button className="auth-brand" onClick={onVisitor} disabled={busy} aria-label="Frontline — abrir biblioteca">Frontline<span>.</span></button>
      <div className="auth-story-copy"><h1>Uma boa conversa<br />começa com prática.</h1><p>Ensaie situações. Experimente respostas.<br className="auth-desktop-break" /> Encontre seu próximo passo.</p></div>
      <AuthMascot privateField={privateField} />
      <p className="auth-story-caption">Cada escolha tem uma consequência.</p>
    </section>
    <section className="auth-access" aria-labelledby="auth-heading">
      <button className="auth-visitor" type="button" onClick={onVisitor} disabled={busy}>Continuar como visitante <ArrowRight size={20} aria-hidden="true" /></button>
      <div className="auth-form-wrap">
        <nav className="auth-modes" aria-label="Acesso à sua conta">
          <button type="button" aria-current={!registering ? 'page' : undefined} onClick={() => onNavigate('login')} disabled={busy}>Entrar</button>
          <button type="button" aria-current={registering ? 'page' : undefined} onClick={() => onNavigate('register')} disabled={busy}>Criar conta</button>
        </nav>
        <header className="auth-intro"><h2 id="auth-heading" ref={heading} tabIndex={-1}>{registering ? 'Seu próximo passo começa aqui.' : 'Bom ter você de volta.'}</h2><p>{registering ? 'Crie seu espaço para praticar e acompanhar suas tentativas.' : 'Entre para continuar de onde parou.'}</p></header>
        <form onSubmit={submit} aria-busy={busy}>
          <fieldset disabled={busy} className="auth-fields">
            <legend className="sr-only">{registering ? 'Dados para criar sua conta' : 'Dados de acesso'}</legend>
            {registering && <div className="auth-field"><label htmlFor="auth-name">Seu nome</label><input id="auth-name" name="name" autoComplete="name" value={name} onChange={e => setName(e.target.value)} placeholder="Como podemos chamar você?" minLength={2} maxLength={80} required /></div>}
            <div className="auth-field"><label htmlFor="auth-email">E-mail</label><input id="auth-email" name="email" type="email" inputMode="email" autoCapitalize="none" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="voce@exemplo.com" maxLength={254} required /></div>
            <div className="auth-field"><label htmlFor="auth-password">Senha</label><div className="auth-password"><input id="auth-password" name="password" type={visible ? 'text' : 'password'} autoComplete={registering ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} onFocus={() => setPrivateField(true)} onBlur={() => setPrivateField(false)} placeholder={registering ? 'Crie uma senha' : 'Digite sua senha'} minLength={registering ? 10 : undefined} maxLength={128} aria-describedby={registering ? 'auth-password-hint' : undefined} required /><button type="button" onClick={() => setVisible(value => !value)} aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={visible}>{visible ? <EyeOff size={20} /> : <Eye size={20} />}</button></div>{registering && <p id="auth-password-hint" className="auth-field-hint">Use pelo menos 10 caracteres.</p>}</div>
            {error && <p className="auth-error" role="alert" ref={errorMessage} tabIndex={-1}>{error}</p>}
            {!online && <p className="auth-error" role="status">Você está sem conexão. Reconecte para continuar.</p>}
            <button className="auth-submit" type="submit" disabled={busy || !online}>{busy ? <><LoaderCircle className="auth-spinner" size={19} />{registering ? 'Criando sua conta…' : 'Entrando…'}</> : <>{registering ? 'Criar conta' : 'Entrar'}<ArrowRight size={21} aria-hidden="true" /></>}</button>
          </fieldset>
        </form>
        <p className="auth-switch">{registering ? 'Já tem uma conta?' : 'Ainda não tem conta?'} <button type="button" onClick={() => onNavigate(registering ? 'login' : 'register')} disabled={busy}>{registering ? 'Entrar' : 'Criar conta'}</button></p>
      </div>
    </section>
  </main>;
}
