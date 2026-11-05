import { useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { api } from '../lib/api.js';

// Serialized writes plus a projected pending queue: fast clicks stay responsive without
// letting an older response erase a later optimistic change. Failed operations roll back.
export function useStore() {
  const base = useRef(null), queue = useRef([]), active = useRef(false), live = useRef(true);
  const [doc, setDoc] = useState(null), [pending, setPending] = useState(0), [error, setError] = useState('');
  const publish = () => {
    if (!live.current) return;
    let next = base.current;
    for (const op of queue.current) if (op.project && next) next = op.project(next);
    setDoc(next); setPending(queue.current.length);
  };
  const reload = async () => {
    try {
      const d = await api('GET', '/api/todo');
      if (!base.current || d.rev >= base.current.rev) base.current = d;
      if (live.current) setError(''); publish();
    } catch (e) { if (live.current) setError(e.message); }
  };
  const drain = async () => {
    if (active.current) return;
    active.current = true;
    while (queue.current.length) {
      const op = queue.current[0];
      try {
        const d = await api(op.method, op.path, op.body);
        if (!base.current || d.rev >= base.current.rev) base.current = d;
        queue.current.shift(); publish(); op.resolve(d);
        if (live.current) setError('');
      } catch (e) { queue.current.shift(); publish(); if (live.current) setError(e.message); op.reject(e); }
    }
    active.current = false;
  };
  const mutate = (method, path, body, project) => new Promise((resolve, reject) => {
    queue.current.push({ method, path, body, project, resolve, reject }); publish(); drain();
  });
  useEffect(() => {
    live.current = true; reload();
    const interval = setInterval(() => { if (!document.hidden && !queue.current.length) reload(); }, 15000);
    const focus = () => { if (!queue.current.length) reload(); };
    addEventListener('focus', focus);
    return () => { live.current = false; clearInterval(interval); removeEventListener('focus', focus); };
  }, []);
  return { doc, pending, error, reload, mutate };
}
