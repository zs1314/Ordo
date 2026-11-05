import { useState, useEffect, useRef } from "../vendor/preact-htm.js";
import { api } from "../lib/api.js";
import { noteChanges } from "../lib/motion.js";

// The board's data: read once on open, then every 15 s (not while the tab is in the background) and again when the window
// regains focus; it re-renders every minute so "N minutes ago" keeps up.
// While busy (editing, or a menu or the settings drawer open), data read in the background is held and swapped in when no
// longer busy, so nothing is interrupted. Old data that arrives late does not overwrite newer data (compared by rev).
// Every swap first compares with the old data and notes whose status just changed, which the cards animate (lib/motion.js).
// save(method, path, body): sends one change and swaps in the whole new document the server returns; throws on error
export function useDoc(busy) {
  const [doc, setDoc] = useState(null);
  const [err, setErr] = useState(null);
  const [, setTick] = useState(0);
  const busyRef = useRef(busy), pending = useRef(null);
  busyRef.current = busy;
  const take = (d, force = false) => setDoc((old) => {
    if (old && !force && d.rev <= old.rev) return old;
    noteChanges(old, d);
    return d;
  });

  const reload = async (force = false) => {
    try {
      const d = await api("GET", "/api/todo");
      setErr(null);
      if (!force && busyRef.current) { pending.current = d; return; }
      pending.current = null;
      take(d, force);
    } catch (e) { setErr(e.message); }
  };
  const save = async (method, path, body) => {
    const d = await api(method, path, body);
    pending.current = null;
    take(d, true);
  };

  useEffect(() => {
    reload(true);
    const poll = setInterval(() => !document.hidden && reload(), 15000);
    const tick = setInterval(() => setTick((x) => x + 1), 60000);
    const onFocus = () => reload();
    addEventListener("focus", onFocus);
    return () => { clearInterval(poll); clearInterval(tick); removeEventListener("focus", onFocus); };
  }, []);
  useEffect(() => {
    if (busy || !pending.current) return;
    const d = pending.current;
    pending.current = null;
    take(d);
  }, [busy]);

  return { doc, err, reload, save };
}
