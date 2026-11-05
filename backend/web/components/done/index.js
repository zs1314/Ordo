// The list of charts shown on top of "recently done": its order is the slider order during layout editing, and the settings
// drawer reads it too. The choice is stored in theme.doneChart; an unknown id falls back to the first one.
// One file per chart, exporting meta (id, name) and Chart({ now, count, jump }): count(back) is how many items were done back
// days ago, jump(back) jumps to that day.
// Chart draws its own title row (explaining what the shading and cells mean), the chart itself, and the small button at the
// top right, which plays a playful animation.
// Clicking a bar or cell jumps to that day, so the animation starts only from that small button.
import * as bars from "./Bars.js";
import * as heatmap from "./Heatmap.js";

const MODULES = [bars, heatmap];

export const CHARTS = MODULES.map((m) => ({ ...m.meta, Chart: m.Chart }));
export const chartById = (id) => CHARTS.find((c) => c.id === id) ?? CHARTS[0];
