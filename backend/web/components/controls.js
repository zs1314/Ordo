import { html, useState, useEffect, useRef } from "../vendor/preact-htm.js";
import { useBoard } from "./ctx.js";
import { onEnter } from "./ui.js";

// Inputs used in the settings drawer: a row (Field), a set of options (Seg), show / hide (Toggle), text (Text), a slider
// (Range). k is the field name; it is saved to the appearance (theme) by default, or to settings with to="settings"
const useSave = (to) => {
  const { act } = useBoard();
  return (k, v) => (to === "settings" ? act.settings : act.theme)({ [k]: v });
};

export const Field = ({ label, children, cls = "" }) => html`<div class=${`field ${cls}`}><span>${label}</span>${children}</div>`;

// Options in a row; clicking one saves it
export function Seg({ k, opts, cur, to }) {
  const save = useSave(to);
  return html`<span class="seg">${opts.map(([v, l]) => html`<button key=${String(v)} class=${String(cur) === String(v) ? "on" : ""} onClick=${() => save(k, v)}>${l}</button>`)}</span>`;
}

// Show / hide (unset counts as show)
export const Toggle = ({ k, value }) => html`<${Seg} k=${k} cur=${value !== false} opts=${[[true, "显示"], [false, "不显示"]]} />`;

// Text setting: saved on Enter or when the input loses focus
export function Text({ k, value, placeholder, style, to }) {
  const save = useSave(to);
  const [v, setV] = useState(value ?? "");
  useEffect(() => setV(value ?? ""), [value]);
  const done = () => { if ((value ?? "") !== v.trim()) save(k, v.trim()); };
  return html`<input class="input" style=${style} value=${v} placeholder=${placeholder} onInput=${(e) => setV(e.target.value)} onKeyDown=${onEnter(done)} onBlur=${done} />`;
}

// Slider: while dragging it only updates the CSS variable as a preview, and saves once it stops
export function Range({ k, min, max, step, value, unit, cssVar, to }) {
  const save = useSave(to);
  const [v, setV] = useState(value), timer = useRef(0);
  useEffect(() => setV(value), [value]);
  const onInput = (e) => {
    const n = Number(e.target.value);
    setV(n);
    if (cssVar) document.documentElement.style.setProperty(cssVar, `${n}px`);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(k, n), 350);
  };
  return html`<span class="rangewrap"><input type="range" min=${min} max=${max} step=${step} value=${v} onInput=${onInput} /><span class="v mono">${v}${unit}</span></span>`;
}
