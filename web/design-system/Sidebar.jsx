import React from 'react';
import { ChevronLeft, ChevronRight, LogIn, LogOut, PanelLeftOpen } from 'lucide-react';
import './Sidebar.css';

export default function Sidebar({ collapsed, onToggle, sections, onNavigate, onHome, busy, user, onLogin, onLogout }) {
  const displayName = user?.name || 'Visitante';
  return <aside className="sidebar refined-sidebar" aria-label="Seu espaço Frontline">
    <div className="sidebar-heading">
      <button type="button" className="brand" onClick={onHome} disabled={busy} aria-label="Frontline — biblioteca">
        <span className="brand-wordmark">Frontline<span className="brand-period">.</span></span>
        <span className="brand-compact" aria-hidden="true">F<span>.</span></span>
      </button>
      <button type="button" className="sidebar-toggle" onClick={onToggle} aria-expanded={!collapsed} aria-controls="frontline-navigation" aria-label={collapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'} title={collapsed ? 'Expandir menu' : 'Recolher menu'}>
        {collapsed ? <PanelLeftOpen size={17} /> : <ChevronLeft size={17} />}
      </button>
    </div>
    <div className="workspace-label"><span aria-hidden="true" />Seu espaço de prática</div>
    <nav id="frontline-navigation" aria-label="Navegação principal">
      {sections.map(({ id, label, Icon, active }) => <button type="button" key={id} className={`nav-item${active ? ' active' : ''}`} onClick={() => onNavigate(id)} disabled={busy} aria-current={active ? 'page' : undefined} aria-label={label} data-tooltip={label}>
        <span className="sidebar-nav-icon"><Icon size={20} strokeWidth={1.7} /></span>
        <span className="sidebar-nav-label">{label}</span>
        <ChevronRight className="sidebar-nav-arrow" size={14} aria-hidden="true" />
      </button>)}
    </nav>
    <div className="sidebar-bottom">
      <div className="sidebar-rule" />
      <div className="user-profile" title={collapsed ? displayName : undefined}>
        <div className="avatar participant" aria-hidden="true">{user?.name?.trim().charAt(0).toLocaleUpperCase('pt-BR') || 'V'}</div>
        <div className="sidebar-profile-copy"><strong>{displayName}</strong><span>{user ? 'Sua conta' : 'Acesso sem conta'}</span></div>
      </div>
      <button className="sidebar-account-action" type="button" onClick={user ? onLogout : onLogin} disabled={busy} aria-label={user ? `Sair da conta de ${displayName}` : 'Entrar na sua conta'} title={collapsed ? (user ? 'Sair da conta' : 'Entrar') : undefined}>{user ? <LogOut size={17} /> : <LogIn size={17} />}<span>{user ? 'Sair da conta' : 'Entrar ou criar conta'}</span></button>
    </div>
  </aside>;
}
