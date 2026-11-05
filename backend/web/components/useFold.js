import { useRef, useState, useEffect, useLayoutEffect } from "../vendor/preact-htm.js";
import { reducedMotion, fold, FOLD_OUT, FOLD_STAGGER } from "../lib/motion.js";

/**
 * Animates entries entering and leaving a list: new ones unfold one after another from top to bottom; ones no longer shown
 * stay where they were and fold one after another from the bottom up, and are removed once folded.
 * Used for expanding and collapsing "N more done earlier", listing one more week in "recently done" and collapsing it, and
 * revealing and hiding again an item located from elsewhere.
 *   list    what to show this time
 *   key     identifies an entry
 *   exists  whether an entry no longer shown still exists (deleted ones are removed at once, without folding); while it
 *           folds it is drawn as it last was
 *   ok      whether this entry animates (e.g. an item whose status just changed has its own strike-through and slide
 *           animations, which are not handled here)
 * Returns [{ x, enter, leave }]: enter / leave is the entry's index among those unfolding / folding together (for
 * staggering), null for entries that do not animate
 */
export function useFold(list, key, { exists = () => true, ok = () => true } = {}) {
  const [, bump] = useState(0);
  const prev = useRef(null), leaving = useRef(new Map());
  const now = new Set(list.map(key));
  const animate = prev.current != null && !reducedMotion();
  if (animate) {
    for (const [k, x] of prev.current) {
      if (now.has(k) || leaving.current.has(k)) continue;
      if (exists(k) && ok(x)) leaving.current.set(k, x);
    }
  }
  for (const k of [...leaving.current.keys()]) if (now.has(k)) leaving.current.delete(k); // came back
  let n = 0;
  const rows = list.map((x) => ({ x, enter: animate && !prev.current.has(key(x)) && ok(x) ? n++ : null, leave: null }));
  const gone = [...leaving.current.values()];
  gone.forEach((x, i) => rows.push({ x, enter: null, leave: gone.length - 1 - i })); // fold from the bottom up
  prev.current = new Map(list.map((x) => [key(x), x]));
  const goneKey = gone.map(key).join("|");
  useEffect(() => {
    if (!goneKey) return;
    const t = setTimeout(() => { for (const x of gone) leaving.current.delete(key(x)); bump((v) => v + 1); }, FOLD_OUT + FOLD_STAGGER * gone.length + 40);
    return () => clearTimeout(t);
  }, [goneKey]);
  return rows;
}

/** Start delay for the k-th of the entries unfolding / folding together (past a limit the rest start together, so it does
 *  not drag on) */
export const staggerOf = (k) => Math.min(8, k ?? 0) * FOLD_STAGGER;

/** Plays the unfold (phase = "in") or fold ("out") animation; opts are fold()'s delay, duration and easing.
 *  It acts only when phase changes: a re-render halfway through unfolding does not interrupt it; if the entry comes back
 *  halfway through folding (phase back to ""), the animation stops and the entry is restored */
export function useFoldAnim(ref, phase, opts = {}) {
  const anim = useRef(null), dir = useRef("");
  useLayoutEffect(() => {
    if (phase) {
      anim.current?.cancel();
      anim.current = fold(ref.current, phase, opts);
      dir.current = phase;
    } else if (dir.current === "out") {
      anim.current?.cancel(); // a folded entry is shown again: restore it
      if (ref.current) ref.current.style.overflow = "";
      dir.current = "";
    }
  }, [phase]);
}
