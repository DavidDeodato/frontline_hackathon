import React, { useEffect, useRef, useState } from 'react';
import { buildRoom } from './scene/room.js';
import './scene/scene.css';

const DOCUMENTS = [
  { id: 'OBJ-ORDEM', label: 'Ordem de serviço', offset: [-104, 12] },
  { id: 'OBJ-POLITICA', label: 'Política', offset: [36, -52] },
  { id: 'OBJ-CALENDARIO', label: 'Agenda', offset: [26, -50] },
];
const EMPTY = [];

/** The scene projects state. Its parent commits document reads. */
export default function Scene({ onDocument, onFailure, selected, documentsRead = EMPTY, busy = false, readOnly = false }) {
  const host = useRef(null), labels = useRef({}), room = useRef(null);
  const callbacks = useRef({ onDocument, onFailure });
  callbacks.current = { onDocument, onFailure };
  const [failed, setFailed] = useState(false);
  const [hovered, setHovered] = useState(null);

  useEffect(() => {
    const mount = host.current;
    if (!mount) return;
    let disposed = false;
    const fail = () => {
      if (disposed) return;
      setFailed(true);
      callbacks.current.onFailure?.('A cena não está disponível neste dispositivo. Consulte os mesmos documentos na lista de informações.');
    };
    try {
      room.current = buildRoom(mount, {
        onFailure: fail,
        onProject(points) {
          for (const doc of DOCUMENTS) {
            const node = labels.current[doc.id], point = points[doc.id];
            if (!node || !point) continue;
            const button = node.querySelector('button');
            const halfWidth = (button?.offsetWidth || 100) / 2, halfHeight = (button?.offsetHeight || 34) / 2;
            const dx = Math.max(halfWidth + 8, Math.min(mount.clientWidth - halfWidth - 8, point.x + doc.offset[0])) - point.x;
            const dy = Math.max(halfHeight + 8, Math.min(mount.clientHeight - halfHeight - 8, point.y + doc.offset[1])) - point.y;
            node.style.left = `${point.x}px`; node.style.top = `${point.y}px`;
            node.style.setProperty('--label-x', `${dx}px`);
            node.style.setProperty('--label-y', `${dy}px`);
            const leader = node.querySelector('line');
            leader?.setAttribute('x2', String(dx));
            leader?.setAttribute('y2', String(dy + (dy < 0 ? halfHeight : -halfHeight)));
          }
        },
      });
    } catch { fail(); }
    return () => { disposed = true; room.current?.dispose(); room.current = null; };
  }, []);

  const readKey = documentsRead.join('|');
  useEffect(() => { room.current?.setFocus(readOnly ? null : (hovered || selected)); }, [selected, hovered, readOnly, readKey]);

  return <div className={`frontline-scene${readOnly ? ' frontline-scene--preview' : ''}`} data-scene-state={failed ? 'fallback' : 'ready'}>
    <div ref={host} className="frontline-scene__canvas" aria-hidden="true" />
    {failed ? <div className="frontline-scene__fallback" role="status">Cena 3D indisponível. Os documentos continuam acessíveis na aba Informações.</div> : null}
    {!readOnly && !failed ? <div className="frontline-scene__objects" aria-label="Objetos do ambiente">
      {DOCUMENTS.map(doc => <div className="frontline-scene__anchor" key={doc.id} ref={node => { labels.current[doc.id] = node; }}>
        <svg className="frontline-scene__leader" width="180" height="120" viewBox="-130 -90 180 120" aria-hidden="true"><line x1="0" y1="0" x2={doc.offset[0]} y2={doc.offset[1] + 16}/><circle cx="0" cy="0" r="3.6"/></svg>
        <button type="button" className={`frontline-scene__hotspot${selected === doc.id ? ' is-selected' : ''}${documentsRead.includes(doc.id) ? ' is-read' : ''}`}
          disabled={busy} aria-label={`Consultar ${doc.label}${documentsRead.includes(doc.id) ? ' — já consultado' : ''}`} aria-pressed={selected === doc.id}
          data-object-id={doc.id} data-guide={doc.id === 'OBJ-POLITICA' ? 'policy' : undefined}
          onPointerEnter={() => setHovered(doc.id)} onPointerLeave={() => setHovered(null)} onFocus={() => setHovered(doc.id)} onBlur={() => setHovered(null)}
          onClick={() => callbacks.current.onDocument?.(doc.id)}>{doc.label}</button>
      </div>)}
    </div> : null}
    {!readOnly ? <span className="frontline-scene__caption">Dados fictícios</span> : null}
  </div>;
}
