import { html } from "../vendor/preact-htm.js";

export const CalIcon = () => html`<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 6.5h12M5.5 1.8v2.6M10.5 1.8v2.6"/></svg>`;
export const RepeatIcon = () => html`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>`;
export const Chev = ({ d }) => html`<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d=${d}/></svg>`;

// Status icons: one set of 16×16 line drawings. Characters such as ○ ▶ ⚙ ◷ differ in size and width from font to font,
// so the text after them would not line up
const SHAPES = {
  todo: html`<circle cx="8" cy="8" r="5.4" />`,
  doing: html`<path d="M5.4 3.9v8.2l6.6-4.1z" fill="currentColor" />`,
  agent: html`<path d="M6.37 3.27 6.57 1.25 9.43 1.25 9.63 3.27 11.28 4.23 13.13 3.38 14.56 5.87 12.91 7.05 12.91 8.95 14.56 10.13 13.13 12.62 11.28 11.77 9.63 12.73 9.43 14.75 6.57 14.75 6.37 12.73 4.72 11.77 2.87 12.62 1.44 10.13 3.09 8.95 3.09 7.05 1.44 5.87 2.87 3.38 4.72 4.23z" stroke-width="1.3" /><circle cx="8" cy="8" r="2" stroke-width="1.3" />`,
  waiting: html`<circle cx="8" cy="8" r="5.4" /><path d="M8 5.2V8l1.9 1.3" />`,
  done: html`<path d="M3.6 8.4l2.8 2.8 6-6.2" />`,
  dropped: html`<path d="M4.8 4.8l6.4 6.4M11.2 4.8l-6.4 6.4" />`,
  rest: html`<circle cx="8" cy="8" r="1.7" fill="currentColor" stroke="none" />`,
};
export const StatusIcon = ({ s }) => html`<svg class="si" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${SHAPES[s] ?? SHAPES.todo}</svg>`;
// The dashed frame of a pill whose item is with an agent: an SVG rounded rectangle over the pill's border, so its dashes can
// travel around it while the agent is running (a CSS dashed border cannot move). handoff adds a second, faster frame that
// whirls once around and fades out, for the moment the item is handed off
export const AgentFrame = ({ handoff }) => html`<svg class="ants" aria-hidden="true"><rect class="a" x=".5" y=".5" width="100%" height="100%" rx="7.5" />${
  handoff ? html`<rect class="in" x=".5" y=".5" width="100%" height="100%" rx="7.5" />` : null}</svg>`;
export const EditIcon = () => html`<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10.7 2.8l2.5 2.5-7.7 7.7-3.2.7.7-3.2z" /><path d="M9.3 4.2l2.5 2.5" /></svg>`;
// Sync (Canvas): two arcs with arrowheads; warning: an exclamation mark in a circle
export const SyncIcon = () => html`<svg class="sync-ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" /></svg>`;
export const WarnIcon = () => html`<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6.2" /><path d="M8 4.7v4" /><circle cx="8" cy="11.2" r=".55" fill="currentColor" /></svg>`;
// The small button in the corner of "recently done": for the bar chart, three dominoes (standing, halfway down, flat); for
// the heatmap, a small snake and the cell it is about to eat
export const DominoIcon = () => html`<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><rect x="1.6" y="4.2" width="2.8" height="9" rx=".6" /><rect x="5.6" y="4.2" width="2.8" height="9" rx=".6" transform="rotate(32 8.4 13.2)" /><rect x="10.2" y="10.4" width="4.6" height="2.8" rx=".6" /><path d="M1 13.9h14" stroke-linecap="round" /></svg>`;
export const SnakeIcon = () => html`<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.8 11.4c1.5-2.9 3-2.9 4.5 0s3 2.9 4.5 0" /><path d="M10.8 11.4c.5-1.1 1.2-2 2.2-2.4" /><circle cx="13.5" cy="8.6" r="1.35" fill="currentColor" stroke="none" /><circle cx="13.9" cy="3.6" r=".9" fill="currentColor" stroke="none" /></svg>`;
