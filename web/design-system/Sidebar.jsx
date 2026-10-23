import React from 'react';
import { ChevronLeft, ChevronRight, PanelLeftOpen } from 'lucide-react';
import './Sidebar.css';

export default function Sidebar({ collapsed, onToggle, sections, onNavigate, onHome, busy }) {
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
      <div className="user-profile" title={collapsed ? 'Mariana Oliveira · Participante do exercício' : undefined}>
        <div className="avatar participant" aria-hidden="true">M</div>
        <div className="sidebar-profile-copy"><strong>Mariana Oliveira</strong><span>Participante do exercício</span></div>
      </div>
    </div>
  </aside>;
}
