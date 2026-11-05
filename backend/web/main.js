import { html, render } from "./vendor/preact-htm.js";
import { App } from "./components/App.js";
import { DesktopApp } from './desktop/App.js';

const desktop = !!window.webkit?.messageHandlers?.desktop || new URLSearchParams(location.search).has('desktop');
if (desktop) {
  document.documentElement.classList.add('desktop');
  if (window.webkit?.messageHandlers?.desktop) document.documentElement.classList.add('native');
}
render(html`<${desktop ? DesktopApp : App} />`, document.getElementById("root"));
// On iPhone, the :active style of a pressed button only shows up when there is a touchstart listener
document.addEventListener("touchstart", () => {}, { passive: true });
