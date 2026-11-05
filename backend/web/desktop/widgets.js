import { html, useLayoutEffect, useRef } from '../vendor/preact-htm.js';
import { Icon } from './icons.js';

export function Button({ children, icon, onClick, title, class: cls = '', disabled = false, type = 'button', ...rest }) {
  return html`<button type=${type} class=${`d-button ${cls}`} onClick=${onClick} title=${title} disabled=${disabled} ...${rest}>${icon && html`<${Icon} name=${icon} size=${16} />`}${children}</button>`;
}
export function IconButton({ icon, label, onClick, class: cls = '', ...rest }) {
  return html`<button type="button" class=${`d-icon-button ${cls}`} title=${label} aria-label=${label} onClick=${onClick} ...${rest}><${Icon} name=${icon} /></button>`;
}
export function Dialog({ children, title, onClose, class: cls = '' }) {
  const ref = useRef(null), close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const before = document.activeElement;
    const root = ref.current;
    const focusable = () => [...root.querySelectorAll('input:not(:disabled),textarea:not(:disabled),select:not(:disabled),button:not(:disabled),[tabindex="0"]')].filter(el => el.offsetParent !== null);
    const first = root.querySelector('[data-autofocus]') || focusable()[0];
    first?.focus();
    const workspace = document.querySelector('.d-workspace');
    if (workspace) workspace.inert = true;
    const key = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close.current(); }
      if (e.key === 'Tab') {
        const fs = focusable(), first = fs[0], last = fs.at(-1);
        if (e.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) { e.preventDefault(); first?.focus(); }
      }
    };
    root.addEventListener('keydown', key);
    return () => { if (workspace) workspace.inert = false; root.removeEventListener('keydown', key); if (before?.isConnected) before.focus(); };
  }, []);
  return html`<div class=${`d-modal-backdrop ${cls.includes('inspector') ? 'inspector-backdrop' : ''}`} onMouseDown=${e => { if (e.target === e.currentTarget) onClose(); }}>
    <section class=${`d-dialog ${cls}`} role="dialog" aria-modal="true" aria-label=${title} ref=${ref}>${children}</section>
  </div>`;
}

export function Empty({ icon = 'inbox', title, detail, action }) {
  return html`<div class="d-empty"><div class="d-empty-art"><div class="empty-halo"></div><${Icon} name=${icon} size=${35} /><span class="empty-orbit"></span></div><h3>${title}</h3><p>${detail}</p>${action}</div>`;
}
