// Appearance: applies the board's theme to the page (CSS variables, data-* on <html>, custom CSS), plus a few values that
// need validating

/** How many columns the agent block uses: 1 / 2 / 3 */
export const agentColsOf = (t) => ([1, 2, 3].includes(Number(t?.agentCols)) ? Number(t.agentCols) : 1);

/** demo: running as the demo site (demo/); the tab title gets a "· demo" suffix (in Chinese) */
export function applyTheme(t = {}, { demo = false } = {}) {
  const r = document.documentElement;
  r.dataset.mode = t.mode || "auto";
  r.dataset.density = t.density || "comfortable";
  r.dataset.layout = t.layout || "sidebar";
  const font = t.font === "system" ? "-apple-system" : t.font === "default" || !t.font ? '"Adventor Todo"' : `"${t.font}"`;
  r.style.setProperty("--font", font);
  r.style.setProperty("--fs", `${t.fontSize || 15}px`);
  r.style.setProperty("--width", `${t.width || 1040}px`);
  r.style.setProperty("--radius", `${t.radius ?? 12}px`);
  r.style.setProperty("--hero-h", `${t.heroHeight || 220}px`);
  if (t.accent) { r.style.setProperty("--accent", t.accent); r.style.setProperty("--accent-ink", "#fff"); }
  else { r.style.removeProperty("--accent"); r.style.removeProperty("--accent-ink"); }
  // The color of the mobile browser's top bar follows light/dark: once settings fix light or dark, it stops following the system
  const BAR = { light: "#fcfcfd", dark: "#0b0b10" };
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
    m.content = BAR[t.mode] ?? (m.media.includes("dark") ? BAR.dark : BAR.light);
  }
  document.getElementById("custom-css").textContent = t.customCss || "";
  document.title = `${t.title || "ToDo"}${demo ? " · 示例" : ""}`;
}
// Reads the colors currently in effect (HSL triples) for the header animation
export function cssColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  return { ink: v("--foreground"), paper: v("--card"), red: v("--hero-flag") };
}
