import React, { useEffect, useRef, useState } from 'react';

export default function AuthMascot({ privateField = false }) {
  const mascot = useRef(null);
  const currentPrivateField = useRef(privateField);
  currentPrivateField.current = privateField;
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let active = true;
    let timer;
    async function prepare() {
      try {
        if (!customElements.get('frontline-mascot') && !document.querySelector('script[data-frontline-mascot]')) {
          const script = document.createElement('script');
          script.type = 'module';
          script.src = '/mascot/fio.js';
          script.dataset.frontlineMascot = 'true';
          script.onerror = () => active && setUnavailable(true);
          document.head.appendChild(script);
        }
        await customElements.whenDefined('frontline-mascot');
        await mascot.current?.ready;
        if (!active) return;
        const button = mascot.current?.shadowRoot?.querySelector('button');
        if (button) button.tabIndex = -1;
        mascot.current?.setState(currentPrivateField.current ? 'rest' : 'greeting');
        timer = setTimeout(() => mascot.current?.setState(currentPrivateField.current ? 'rest' : 'idle'), 2600);
      } catch { if (active) setUnavailable(true); }
    }
    prepare();
    return () => { active = false; clearTimeout(timer); };
  }, []);
  useEffect(() => {
    mascot.current?.setState?.(privateField ? 'rest' : 'idle');
  }, [privateField]);
  return <div className="auth-mascot" aria-hidden="true">
    <div className="auth-orbit auth-orbit-one" /><div className="auth-orbit auth-orbit-two" /><div className="auth-orbit auth-orbit-three" />
    {unavailable ? <img src="/mascot/fio.svg" alt="" /> : <frontline-mascot ref={mascot} state="greeting" />}
  </div>;
}
