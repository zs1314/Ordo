import { html, useEffect, useRef } from "../vendor/preact-htm.js";
import { useBoard } from "./ctx.js";
import { HEROES, heroById } from "../lib/heroes/index.js";
import { cssColors } from "../lib/theme.js";
import { SlidePicker } from "./SlidePicker.js";

// Header animation (hero): the drawing code is in lib/heroes/; this only mounts it and recolors it for light and dark mode.
// During layout editing a slider below switches it: click a name on either side
export function Hero({ theme }) {
  const { ui, act } = useBoard();
  const style = heroById(theme.heroStyle);
  return html`<div class="hero"><${HeroCanvas} key=${style.id} style=${style} theme=${theme} /></div>
    ${ui.editMode ? html`<${SlidePicker} cls="hero-picker" label="头图" items=${HEROES} cur=${style} onPick=${(heroStyle) => act.theme({ heroStyle })} />` : null}`;
}

function HeroCanvas({ style, theme }) {
  const ref = useRef(null), engine = useRef(null);
  useEffect(() => {
    engine.current = style.mount(ref.current);
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const recolor = () => requestAnimationFrame(() => engine.current?.setColors(cssColors()));
    mq.addEventListener("change", recolor);
    recolor();
    return () => { mq.removeEventListener("change", recolor); engine.current?.destroy(); engine.current = null; };
  }, []);
  useEffect(() => { requestAnimationFrame(() => engine.current?.setColors(cssColors())); }, [theme.mode, theme.customCss]);
  return html`<canvas ref=${ref} aria-hidden="true"></canvas>`;
}
