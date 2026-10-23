import React from 'react';
import { AlertCircle } from 'lucide-react';
export function StatusBadge({
  tone = 'neutral',
  children
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function AsyncState({
  loading = false,
  title,
  description,
  action
}) {
  return <section className="async-state" role={loading ? 'status' : undefined}>{loading && <span className="loading-orbit" aria-hidden="true" />}<h2>{title}</h2>{description && <p>{description}</p>}{action && <div>{action}</div>}</section>;
}
export class AppBoundary extends React.Component {
  state = {
    failed: false
  };
  static getDerivedStateFromError() {
    return {
      failed: true
    };
  }
  componentDidCatch(error) {
    console.error('Frontline render failed', error);
  }
  render() {
    return this.state.failed ? <main className="fatal-state"><AlertCircle size={32} /><h1>Não foi possível abrir esta tela</h1><p>As tentativas já salvas permanecem no seu espaço. Recarregue para voltar à biblioteca.</p><button className="primary" onClick={() => {
        location.hash = '#/library';
        location.reload();
      }}>Reabrir Frontline</button></main> : this.props.children;
  }
}
