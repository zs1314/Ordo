// The full set of checks for the header animations (heroes), in one command: starts its own board server (on a copy of the data
// in a temporary directory, never the real data) and a headless Chrome, and shuts both down at the end.
//
//   node dev/test-heroes.mjs            all of them
//   node dev/test-heroes.mjs relay      only this one (the static checks still cover all of them)
//
// Checks:
//   1. Static: every hero file exports meta (id, name, hint) and mount; the list matches the directory and ids are unique;
//      no text is drawn on the main canvas (ctx.fillText / ctx.strokeText).
//   2. Each hero: sweep the mouse over it, click eight times in a row, move out; check the frame rate (at least three quarters
//      of an empty page's), the time per frame, and errors.
//   3. Each hero: no animation with prefers-reduced-motion; a click after the moment of the still frame causes no error either.
//   4. The slider on the board: only there during layout editing; shows the current one and one on each side, wrapping around;
//      four clicks while it slides move four steps and save once; arrow keys switch; every one can be saved over a full turn;
//      the frame keeps its size; no extra animation loop is left after a full turn.
// Needs Chrome on this machine (the default macOS path; elsewhere set CHROME=...).
import fs from "node:fs";
import path from "node:path";
import { startBoard, sleep, TODO } from "./harness.mjs";

const HEROES_DIR = path.join(TODO, "web/lib/heroes");
const ONLY = process.argv[2] ?? null;
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); };

/* ---------- 1. static checks ---------- */
const files = fs.readdirSync(HEROES_DIR).filter((f) => f.endsWith(".js") && !["kit.js", "index.js"].includes(f));
const indexSrc = fs.readFileSync(path.join(HEROES_DIR, "index.js"), "utf8");
for (const f of files) {
  const src = fs.readFileSync(path.join(HEROES_DIR, f), "utf8");
  check(`${f} exports meta and mount`, /export const meta = \{/.test(src) && /export function mount\(canvas\)/.test(src));
  check(`${f} draws no text on the main canvas`, !/\bctx\.(fillText|strokeText)\(/.test(src));
  check(`${f} is registered in index.js`, indexSrc.includes(`from "./${f}"`));
}

/* ---------- start the server and the browser ---------- */
const board = await startBoard({ theme: { heroStyle: "argus", hero: true } });
const base = board.base;
// Every tab counts requestAnimationFrame callbacks and saves of the hero style (PATCH /api/theme)
const COUNTERS = `window.__raf = 0; { const r0 = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => r0((ts) => { window.__raf++; cb(ts); }); }
  window.__saves = 0; { const f0 = window.fetch.bind(window); window.fetch = (u, o) => { if (o && o.method === "PATCH" && String(u).includes("/api/theme") && String(o.body).includes("heroStyle")) window.__saves++; return f0(u, o); }; }`;
const tab = (url, { width = 1080, height = 300, reduce = false } = {}) => board.tab(url, { width, height, reduce, init: COUNTERS });

// How many frames per second the browser on this machine draws anyway: usually 60 on mains power; on battery or with a low
// battery, Chrome saves power and caps it at 30. The heroes' frame rates are measured against this
const cap = await (async () => {
  const p = await tab(`${base}/dev/heroes.html?only=none`);
  const n = await p.ev("new Promise((ok) => { let n = 0; const t0 = performance.now(); const f = () => { n++; performance.now() - t0 < 1000 ? requestAnimationFrame(f) : ok(n); }; requestAnimationFrame(f); })");
  await p.close();
  return n;
})();
console.log(`an empty page on this machine: ${cap} frames per second`);

const ids = (await (async () => { const p = await tab(`${base}/dev/heroes.html?only=none`); const v = await p.ev(`import('/lib/heroes/index.js').then((m) => JSON.stringify(m.HEROES.map((h) => [h.id, h.name, h.hint, typeof h.mount])))`); await p.close(); return JSON.parse(v); })());
check("ids in the list are unique", new Set(ids.map((x) => x[0])).size === ids.length, ids.map((x) => x[0]).join(", "));
check("each has a name, a hint and mount", ids.every(([id, name, hint, m]) => id && name && hint && m === "function"));
check("the list has as many entries as the directory has files", ids.length === files.length, `${ids.length} / ${files.length}`);

/* ---------- 2, 3. each hero ---------- */
for (const [id] of ids.filter(([id]) => !ONLY || id === ONLY)) {
  const p = await tab(`${base}/dev/heroes.html?only=${id}&w=1040&h=220`);
  for (let i = 0; i < 40 && !(await p.ev("window.__ready === true")); i++) await sleep(100);
  await sleep(1200);
  const n0 = await p.ev("window.__cost.length"), t0 = Date.now();
  for (let k = 0; k < 40; k++) { await p.mouse("mouseMoved", 60 + k * 24, 70 + 120 * Math.abs(Math.sin(k / 5))); await sleep(25); }
  for (let k = 0; k < 8; k++) { await p.clickAt(90 + k * 115, 80 + (k % 3) * 50); await sleep(140); }
  await p.mouse("mouseMoved", 3, 3); await p.ev("document.dispatchEvent(new PointerEvent('pointerout', { relatedTarget: null }))");
  await sleep(1200);
  const n1 = await p.ev("window.__cost.length"), fps = (n1 - n0) / ((Date.now() - t0) / 1000);
  const [med, p95] = JSON.parse(await p.ev("(() => { const c = window.__cost.slice(-240).sort((a, b) => a - b); return JSON.stringify([c[c.length >> 1], c[Math.floor(c.length * 0.95)]]); })()"));
  check(`${id}: sweep the mouse, click repeatedly, move out`, fps > cap * 0.75 && !p.errors.length, `${fps.toFixed(0)} fps, median ${med.toFixed(1)} ms per frame, p95 ${p95.toFixed(1)} ms${p.errors.length ? "; error: " + p.errors[0] : ""}`);
  await p.close();
  const r = await tab(`${base}/dev/heroes.html?only=${id}&w=1040&h=220`, { reduce: true });
  // Wait until after the moment of the still frame (stillT, 4 s by default) before clicking: clicks used to record the real
  // time, so a click after that moment produced a negative radius in the drawing
  await r.ev("new Promise((ok) => { const f = () => (performance.now() > 5200 ? ok(true) : setTimeout(f, 100)); f(); })");
  const a = await r.ev("window.__raf"); await r.clickAt(500, 120); await sleep(1000); const b = await r.ev("window.__raf");
  check(`${id}: still with prefers-reduced-motion`, b - a < 3 && !r.errors.length, `${b - a} frames${r.errors.length ? "; error: " + r.errors[0] : ""}`);
  await r.close();
}

/* ---------- 4. the slider on the board ---------- */
if (!ONLY) {
  const p = await tab(`${base}/`, { width: 1440, height: 900 });
  await sleep(2500);
  const style = () => p.ev(`fetch('/api/todo').then((r) => r.json()).then((d) => d.theme.heroStyle)`);
  const rate = async () => { const a = await p.ev("window.__raf"); await sleep(1000); return (await p.ev("window.__raf")) - a; };
  const before = await rate();
  check("no slider normally", !(await p.ev("!!document.querySelector('.hero-picker')")));
  await p.ev(`[...document.querySelectorAll('header .tbtn')].find((b) => b.textContent.includes('编辑布局')).click()`); await sleep(400);
  const box = JSON.parse(await p.ev(`JSON.stringify(document.querySelector('.hero-picker')?.getBoundingClientRect() ?? null)`) ?? "null");
  check("the slider is there during layout editing", !!box);
  if (box) {
    const frame = () => p.ev(`(() => { const r = document.querySelector('.hero-picker .hp-frame').getBoundingClientRect(); return [r.width, r.height].join('×'); })()`);
    const right = () => p.clickAt(box.x + box.width - 50, box.y + box.height / 2);
    const key = (k) => p.key(k, k, k === "ArrowLeft" ? 37 : 39);
    const f0 = await frame();
    const shown = await p.ev(`[...document.querySelectorAll('.hero-picker .hp-item')].filter((b) => +getComputedStyle(b).opacity > 0.05).map((b) => b.textContent).join(' | ')`);
    const want = [ids[ids.length - 1][1], ids[0][1], ids[1][1]].join(" | ");
    check("shows the current one and one on each side, wrapping around", shown === want, shown);
    // Four clicks while it slides (at uneven intervals, some landing just as a name slides into the frame): each one counts,
    // and it saves only once when it stops
    const s0 = await p.ev("window.__saves");
    for (const gap of [60, 110, 160, 90]) { await right(); await sleep(gap); }
    await sleep(1200);
    const s1 = await p.ev("window.__saves"), at4 = await style();
    check("four clicks move four steps and save once", at4 === ids[4 % ids.length][0] && s1 - s0 === 1, `at ${at4}, saved ${s1 - s0} times`);
    await p.ev("document.querySelector('.hero-picker').focus()");
    for (let k = 0; k < 4; k++) { await key("ArrowLeft"); await sleep(110); }
    await sleep(1200);
    check("arrow keys switch", (await style()) === "argus", await style());
    const seen = [];
    for (let k = 0; k < ids.length; k++) { await right(); await sleep(700); seen.push(await style()); }
    check("a full turn of the slider: every one can be saved", seen[seen.length - 1] === "argus" && new Set(seen).size === ids.length, seen.join(" → "));
    const f1 = await frame();
    check("the frame size does not change with the name", f0 === f1, `${f0} → ${f1}`);
    check("only one canvas", (await p.ev("document.querySelectorAll('.hero canvas').length")) === 1);
    const after = await rate();
    check("no extra animation loop after a full turn", after <= before * 1.3 + 5, `${before} → ${after} per second`);
  }
  check("no errors on the board", !p.errors.length, p.errors[0] ?? "");
  await p.close();
}

const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length} passed, ${bad.length} failed`);
board.close();
process.exit(bad.length ? 1 : 0);
