import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import Scene from '../Scene.jsx';
import FioGuide from '../mascot/FioGuide.jsx';
import './preview.css';
function Preview() {
  const [selected, setSelected] = useState('OBJ-POLITICA'), [read, setRead] = useState([]), [readOnly, setReadOnly] = useState(false), [view, setView] = useState('library');
  const open = id => { setSelected(id); setRead(previous => previous.includes(id) ? previous : [...previous, id]); };
  return <main><header><h1>Verificação da cena</h1><p>Fixture local de componente · não comprova persistência ou API</p></header><div className="preview-stage" data-guide="scenario"><Scene selected={selected} documentsRead={read} readOnly={readOnly} onDocument={open}/></div>
    <aside><p role="status">Objeto: {selected || 'nenhum'} · consultas únicas: {read.length}</p><label><input type="checkbox" checked={readOnly} onChange={e => setReadOnly(e.target.checked)}/>Prévia sem interação</label><button onClick={() => setView(view === 'practice' ? 'library' : 'practice')}>Alternar ensaio avaliado</button><p>Estado do guia: {view}</p></aside>
    <FioGuide view={view} session={view === 'practice' ? { status: 'active' } : null} onNavigate={setView}/>
  </main>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
