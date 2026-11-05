import { html, useState, useEffect } from "../vendor/preact-htm.js";
import { useBoard } from "./ctx.js";
import { onEnter } from "./ui.js";
import { placeOptions, placesByRecency } from "../lib/places.js";
import { ago } from "../lib/time.js";

// Picking a place when handing off to an agent: the recently used places in a row, one click picks one (value is the
// current text of the input, used for highlighting and filtering)
export function PlaceChips({ value = "", onPick }) {
  const { doc } = useBoard();
  const opts = placeOptions(doc, value);
  if (!opts.length) return null;
  return html`<div class="places">${opts.map((name) => html`<button key=${name} class=${`place ${name === value.trim() ? "on" : ""}`} onClick=${() => onPick(name)}>${name}</button>`)}</div>`;
}

// Managing places in settings: rename (items under the old name are renamed too), delete, add. Each row shows how many
// times it was used and when it was last used
export function PlacesEditor() {
  const { doc, act } = useBoard();
  const [add, setAdd] = useState("");
  const submit = async () => { if (add.trim() && (await act.places.add(add.trim()))) setAdd(""); };
  return html`<div class="placelist">
    ${placesByRecency(doc).map((p) => html`<${PlaceRow} key=${p.name} p=${p} />`)}
    <input class="input" value=${add} placeholder="新的地方" onInput=${(e) => setAdd(e.target.value)} onKeyDown=${onEnter(submit)} />
  </div>`;
}

function PlaceRow({ p }) {
  const { act } = useBoard();
  const [v, setV] = useState(p.name);
  useEffect(() => setV(p.name), [p.name]);
  const save = () => {
    const t = v.trim();
    if (!t) return setV(p.name);
    if (t !== p.name) act.places.rename(p.name, t);
  };
  return html`<div class="placerow">
    <input class="input" value=${v} onInput=${(e) => setV(e.target.value)} onKeyDown=${onEnter(save)} onBlur=${save} />
    <span class="meta">${p.uses ? `${p.uses} 次` : "没用过"}${p.lastUsed ? ` · ${ago(p.lastUsed)}` : ""}</span>
    <button class="tool" title="删掉" onClick=${() => act.places.remove(p.name)}>×</button>
  </div>`;
}
