import { html, useState, useEffect, useLayoutEffect, useRef } from "../vendor/preact-htm.js";
import { reducedMotion } from "../lib/motion.js";

// Table of contents on the left, shown only when the left margin of the page is wide enough. It lists every block on the
// page (section.block with data-toc), marks the one in view while scrolling (darker, bolder text, and a short vertical bar
// on the left slides to it), and scrolls there smoothly on click
const W = 150, GAP = 44, LINE = 130; // TOC width, gap to the content, and the "in view" line (a little below the header bar)

export function Toc() {
  const [items, setItems] = useState([]);
  const [left, setLeft] = useState(null);
  const [cur, setCur] = useState(null);
  const [ind, setInd] = useState(null);
  const list = useRef(null), lock = useRef(0);

  // After every render, collect the blocks again (sections get added, deleted, hidden) and measure whether there is room on
  // the left
  useLayoutEffect(() => {
    const next = [...document.querySelectorAll("main section.block[data-toc]")].map((el) => ({ id: el.id, label: el.dataset.toc }));
    setItems((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    measure();
  });
  const measure = () => {
    const c = document.querySelector("main > .container");
    if (!c) return;
    const start = c.getBoundingClientRect().left + (parseFloat(getComputedStyle(c).paddingLeft) || 0);
    const x = start >= W + GAP + 20 ? Math.round(start - W - GAP) : null;
    setLeft((v) => (v === x ? v : x));
  };
  useEffect(() => { addEventListener("resize", measure); return () => removeEventListener("resize", measure); }, []);

  // The block in view is the last one whose top has passed LINE; at the bottom of the page it is the last block
  useEffect(() => {
    let raf = 0;
    const spy = () => {
      raf = 0;
      if (performance.now() < lock.current) return;
      const els = items.map((x) => document.getElementById(x.id)).filter(Boolean);
      if (!els.length) return;
      let k = 0;
      els.forEach((el, n) => { if (el.getBoundingClientRect().top <= LINE) k = n; });
      if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) k = els.length - 1;
      setCur(els[k].id);
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(spy); };
    spy();
    addEventListener("scroll", on, { passive: true });
    return () => { removeEventListener("scroll", on); cancelAnimationFrame(raf); };
  }, [items]);

  // The vertical bar follows the current entry
  useLayoutEffect(() => {
    const a = list.current?.querySelector(`[data-id="${cur}"]`);
    setInd(a ? { y: a.offsetTop, h: a.offsetHeight } : null);
  }, [cur, items, left]);

  const go = (e, id) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    const smooth = !reducedMotion();
    lock.current = performance.now() + (smooth ? 900 : 0); // do not track the scroll position during the smooth scroll
    setCur(id);
    el.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    setTimeout(() => { lock.current = 0; dispatchEvent(new Event("scroll")); }, smooth ? 950 : 0);
  };

  if (left == null || items.length < 2) return null;
  return html`<nav class="toc" style=${{ left: `${left}px`, width: `${W}px` }} aria-label="目录">
    <div class="toc-list" ref=${list}>
      ${ind ? html`<span class="toc-ind" style=${{ transform: `translateY(${ind.y}px)`, height: `${ind.h}px` }}></span>` : null}
      ${items.map((x) => html`<a key=${x.id} data-id=${x.id} href=${`#${x.id}`} class=${x.id === cur ? "on" : ""} onClick=${(e) => go(e, x.id)}>${x.label}</a>`)}
    </div>
  </nav>`;
}
