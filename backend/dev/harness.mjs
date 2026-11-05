// Shared base for the browser checks in dev/: starts a board server in a temporary directory (on a copy of the data, so the
// real data is never touched) and a headless Chrome, opens tabs and sends CDP commands; when the process exits, both are
// shut down and the temporary directory is deleted.
//
//   const board = await startBoard({ theme: { hero: false } });
//   const page = await board.tab();                 // opens the board by default, 1440×900
//   await page.click(`document.querySelector('.pill')`);
//   console.log(await page.ev(`document.title`));
//
// Needs Chrome on this machine (the default macOS path; elsewhere set CHROME=...). TODO_CODE=<dir> starts the server.mjs in
// that directory instead (e.g. an older version of the code, one that keeps the board in todo.db).
// Browser only, without a board server (the demo site checks): const chrome = await startChrome(); const page = await chrome.tab(url, { network: true });
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { sampleDoc } from "../demo/sample.js";
import { openStore } from "../core/store.mjs";

export const TODO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CODE = process.env.TODO_CODE ?? TODO;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });

/** Starts a board server and a headless Chrome. from: the data file to use (default: the demo's sample data); data(doc)
 *  can modify it first; theme is a fixed look for the tests (so they do not depend on the settings saved in the data) */
export async function startBoard({ from, data, theme, env = {} } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "axi-board-"));
  const doc = from ? JSON.parse(fs.readFileSync(from, "utf8")) : sampleDoc();
  if (data) data(doc);
  const store = openStore(tmp);
  store.replaceAll(doc);
  store.close();
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [path.join(CODE, "server.mjs")], { env: { ...process.env, ...env, TODO_DIR: tmp, TODO_PORT: String(port) }, stdio: "ignore" });
  const chrome = await startChrome(path.join(tmp, "chrome"));
  const close = () => { try { server.kill(); } catch {} chrome.close(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} };
  process.on("exit", close);
  for (let i = 0; i < 80; i++) { try { await fetch(`${base}/api/health`); break; } catch { await sleep(250); } }
  const api = async (method, p, body) => (await fetch(base + p, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
  if (theme) await api("PATCH", "/api/theme", theme);
  return { base, tmp, api, close, tab: (url = base, opts) => chrome.tab(url, opts) };
}

/** Starts only a headless Chrome. profile: the directory for Chrome's user data (default: a temporary one, deleted on close) */
export async function startChrome(profile) {
  const own = !profile, dir = profile ?? fs.mkdtempSync(path.join(os.tmpdir(), "axi-chrome-"));
  const cport = await freePort();
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${cport}`, `--user-data-dir=${dir}`, "--window-size=1440,900", "about:blank"], { stdio: "ignore" });
  const close = () => { try { chrome.kill(); } catch {} if (own) try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };
  process.on("exit", close);
  for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${cport}/json/version`); break; } catch { await sleep(250); } }
  return { close, tab: (url, opts) => openTab(cport, url, opts) };
}

/**
 * Opens a tab. width, height, scale; phone: emulate a phone (touch, mobile); reduce: prefers-reduced-motion; init: a script
 * run before every page load; network: record every request the page makes (requests: { url, method, type }), and put
 * failed ones (4xx, 5xx, blocked) in errors.
 * The returned helpers take selectors as a JS expression (e.g. `document.querySelector('.pill')`)
 */
async function openTab(cport, url, { width = 1440, height = 900, scale = 2, phone = false, reduce = false, init, network = false } = {}) {
  const t = await (await fetch(`http://127.0.0.1:${cport}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map(), errors = [], requests = [], urls = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text);
    if (d.method === "Runtime.consoleAPICalled" && ["error", "warn"].includes(d.params.type)) errors.push(d.params.args.map((a) => a.value ?? a.description).join(" "));
    if (d.method === "Network.requestWillBeSent") { const q = d.params.request; requests.push({ url: q.url, method: q.method, type: d.params.type }); urls.set(d.params.requestId, q.url); }
    if (d.method === "Network.responseReceived" && d.params.response.status >= 400) errors.push(`${d.params.response.status} ${d.params.response.url}`);
    if (d.method === "Network.loadingFailed" && !d.params.canceled) errors.push(`request failed: ${urls.get(d.params.requestId) ?? "?"} ${d.params.blockedReason ?? d.params.errorText}`);
  };
  await new Promise((r) => (ws.onopen = r));
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  /** Evaluates an expression in the page (it may be async) and returns the result; throws if it fails in the page */
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? expr);
    return r.result?.result?.value;
  };
  let touched = false; // touch emulation only needs turning off if it was turned on (turning it off when it was never on changes how Chrome handles mouse clicks)
  const device = async (o) => {
    await send("Emulation.setDeviceMetricsOverride", { width: o.width, height: o.height, deviceScaleFactor: o.scale ?? 2, mobile: !!o.phone });
    if (o.phone || touched) await send("Emulation.setTouchEmulationEnabled", { enabled: !!o.phone, maxTouchPoints: o.phone ? 5 : 0 });
    touched ||= !!o.phone;
  };
  const media = (features) => send("Emulation.setEmulatedMedia", { features });
  await send("Runtime.enable"); await send("Page.enable"); await send("Page.bringToFront");
  if (network) await send("Network.enable");
  await device({ width, height, scale, phone });
  if (reduce) await media([{ name: "prefers-reduced-motion", value: "reduce" }]);
  if (init) await send("Page.addScriptToEvaluateOnNewDocument", { source: init });
  // Wait until the page is ready: on the board (the page that loads /main.js) until the data has loaded and the header bar is
  // rendered, on other pages until loading finishes; then a little longer for animations and polling to settle
  const loaded = "document.readyState === 'complete' && (!document.querySelector('script[src$=\"main.js\"]') || !!document.querySelector('#root > header, .d-workspace'))";
  const ready = async () => { for (let i = 0; i < 100 && !(await ev(loaded).catch(() => false)); i++) await sleep(100); await sleep(600); };
  await send("Page.navigate", { url }); await ready();

  const mouse = (type, x, y) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  const center = (sel) => ev(`(() => { const e = ${sel}; if (!e) throw new Error("not found: " + ${JSON.stringify(sel)}); e.scrollIntoView({ block: "center", behavior: "instant" }); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })()`);
  const tapAt = async (x, y) => { await send("Input.synthesizeTapGesture", { x, y, duration: 40, gestureSourceType: "touch" }); await sleep(350); };
  return {
    send, ev, errors, requests, mouse, device, media, tapAt,
    /** Scrolls to the element and clicks it (a DOM click) */
    click: (sel) => ev(`(() => { const e = ${sel}; if (!e) throw new Error("not found: " + ${JSON.stringify(sel)}); e.scrollIntoView({ block: "center" }); e.click(); return true })()`),
    /** A real mouse click at (x, y) */
    clickAt: async (x, y) => { await mouse("mouseMoved", x, y); await mouse("mousePressed", x, y); await mouse("mouseReleased", x, y); },
    /** Scrolls to the element and taps it with a finger (touch) */
    tap: async (sel) => { const p = await center(sel); await sleep(250); await tapAt(p.x, p.y); },
    /** Fills in an input (fires input, as typing does) */
    type: (sel, text) => ev(`(() => { const e = ${sel}; const set = Object.getOwnPropertyDescriptor(e.constructor.prototype, "value").set; set.call(e, ${JSON.stringify(text)}); e.dispatchEvent(new Event("input", { bubbles: true })); return true })()`),
    key: async (key, code = key, keyCode = 0) => { for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: keyCode }); },
    esc: () => ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })), true`),
    reload: async () => { await send("Page.reload", { ignoreCache: true }); await ready(); },
    screenshot: async (file, clip) => fs.writeFileSync(file, Buffer.from((await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip, captureBeyondViewport: true } : {}) })).result.data, "base64")),
    close: async () => { ws.close(); await fetch(`http://127.0.0.1:${cport}/json/close/${t.id}`).catch(() => {}); },
  };
}
