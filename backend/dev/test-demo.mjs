// Checks for the demo site, in one command: builds the demo site (demo/build.mjs) into a temporary directory, serves it with a
// small static server whose response headers copy the add_header lines in deploy/demo.nginx (the same CSP as in production:
// connect-src 'none'), then clicks through it in a headless Chrome.
//
//   node dev/test-demo.mjs                                     screenshots go to a directory under /tmp (SHOTS=<dir> to change it)
//   DEMO_URL=https://demo.example.com node dev/test-demo.mjs   clicks through the deployed site instead of a local server
//                                                              (changes stay in the browser and affect no one else), and also
//                                                              checks that its response headers match the nginx config
//
// Checks: the build has only frontend files; the main blocks are present and the title has the demo tag next to it;
// finishing an agent card, checking in, adding an item, switching to dark mode and syncing Canvas all work; no request ever
// goes to /api/, nothing cross-site, nothing blocked by CSP, no errors; a reload restores the original state; no horizontal
// overflow on a phone.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startChrome, sleep, freePort, TODO } from "./harness.mjs";
import { build } from "../demo/build.mjs";

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); };
const SHOTS = process.env.SHOTS ?? "/tmp/axi-demo-shots";
fs.mkdirSync(SHOTS, { recursive: true });

// ---- build and serve ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "axi-demo-"));
process.on("exit", () => fs.rmSync(tmp, { recursive: true, force: true }));
const site = path.join(tmp, "site");
const files = build(site);
check("the build has only frontend files (no server, Canvas, login or file storage code)", files.every((f) => f === "index.html" || /^(web|core|demo)\//.test(f)) && !files.some((f) => /server|store\.mjs|report\.mjs|canvas|auth|build\.mjs|package\.json|\.md$/.test(f)), files.filter((f) => /server|store|report|canvas|auth/.test(f)).join(" "));

const conf = fs.readFileSync(path.join(TODO, "deploy/demo.nginx"), "utf8");
// The fixed ones (Cache-Control is a $variable set per path, so it is not compared here)
const HEADERS = Object.fromEntries([...conf.matchAll(/^\s*add_header\s+(\S+)\s+(?:"([^"]*)"|(\S+))\s+always;/gm)].map((m) => [m[1], m[2] ?? m[3]]).filter(([, v]) => !v.startsWith("$")));
check("the CSP read from the nginx config has connect-src 'none'", /connect-src 'none'/.test(HEADERS["Content-Security-Policy"] ?? ""));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2" };
const LIVE = process.env.DEMO_URL?.replace(/\/$/, "");
const port = await freePort(), base = LIVE ?? `http://127.0.0.1:${port}`;
if (LIVE) {
  const r = await fetch(`${LIVE}/`);
  const diff = Object.entries(HEADERS).filter(([k, v]) => r.headers.get(k) !== v).map(([k]) => k);
  check("the deployed site's response headers match the nginx config", r.ok && !diff.length, diff.join(" "));
}
const server = LIVE ? null : http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, base).pathname);
  const file = path.join(site, p === "/" ? "index.html" : p);
  if (!["GET", "HEAD"].includes(req.method)) { res.writeHead(405, HEADERS); return res.end(); }
  if (!file.startsWith(site) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404, HEADERS); return res.end(); }
  res.writeHead(200, { ...HEADERS, "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
  res.end(fs.readFileSync(file));
});
if (server) { server.listen(port, "127.0.0.1"); process.on("exit", () => server.close()); }

// ---- open ----
const chrome = await startChrome();
// The browser reports what CSP blocked only in a different part of the console, so record that as an error here too
const init = `document.addEventListener("securitypolicyviolation", (e) => console.error("blocked by CSP: " + e.violatedDirective + " " + e.blockedURI));`;
const page = await chrome.tab(base, { network: true, init });
const { ev, click, type, errors, requests } = page;
const waitFor = async (expr, ms = 6000) => { for (let t = 0; t < ms; t += 100) { if (await ev(expr)) return true; await sleep(100); } return false; };
const row = (title) => `[...document.querySelectorAll('main .items .item')].find((r) => r.querySelector('.t')?.textContent === ${JSON.stringify(title)})`;
const shoot = async (name) => {
  const h = await ev(`document.documentElement.scrollHeight`), w = await ev(`innerWidth`);
  await page.screenshot(path.join(SHOTS, `${name}.png`), { x: 0, y: 0, width: w, height: Math.min(h, 6000), scale: 1 });
};
await waitFor(`!!document.querySelector('[data-agent-card]')`);

check("tab title", (await ev(`document.title`)) === "Axi's ToDo · 示例");
check('header bar: the brand, with "示例" next to it', (await ev(`document.querySelector('header .brand').textContent`)) === "Axi's ToDo" && (await ev(`document.querySelector('header .demo-tag')?.textContent`)) === "示例");
check("header bar: a link to the repository", await ev(`(() => { const a = document.querySelector('header a.demo-tag'); return a?.textContent === "GitHub" && a.href === "https://github.com/Axi404/todo" && a.target === "_blank" && a.rel.includes("noopener") })()`));
check("Agent: five cards, one not checked for a long time", (await ev(`document.querySelectorAll('[data-agent-card]').length`)) === 5 && (await ev(`document.querySelectorAll('[data-agent-card] .stale').length`)) === 1);
check("four sections", (await ev(`[...document.querySelectorAll('main h2')].map((h) => h.textContent).join(",")`)).includes("科研,课程,生活,博客"));
check("calendar, check-ins, recently done and yearly goals are all there", await ev(`["b-calendar", "b-repeat", "b-done", "b-goals"].every((id) => document.getElementById(id))`) && (await ev(`document.querySelectorAll('#b-goals li').length`)) === 5);
check("check-ins: four recurring items", (await ev(`document.querySelectorAll('#b-repeat .hab .nm').length`)) === 4);
check("recently done: the two weeks of bars show done items", (await ev(`[...document.querySelectorAll('#b-done .b')].filter((b) => !b.classList.contains('zero')).length`)) >= 8);
check('the overdue item says "过了 1 天"', /过了 1 天/.test(await ev(`${row("报销上个月的打车票")}?.textContent ?? ""`)));
check('the courses section has "同步 Canvas", last synced an hour ago', (await ev(`document.querySelector('.csync-btn')?.textContent`)) === "同步 Canvas" && /1 小时前同步/.test(await ev(`document.querySelector('.csync-st')?.textContent ?? ""`)));
await shoot("1-desktop");

// ---- click around ----
const agentBtn = `[...document.querySelectorAll('[data-agent-card="t01"] .btn')].find((b) => b.textContent.includes("做完了"))`;
await click(agentBtn);
check('clicking "做完了" on an agent card: that card leaves, four are left', await waitFor(`document.querySelectorAll('[data-agent-card]').length === 4`, 5000));
check("it shows as done in its own card", await waitFor(`/完成/.test(${row("补消融实验：去掉数据增强再跑一遍")}?.querySelector('.pill')?.textContent ?? "")`, 3000));

const pill = `${row("背 20 个单词")}.querySelector('.pill')`;
const before = await ev(`${pill}.textContent`);
await click(pill); await sleep(500);
check("clicking the status pill of a recurring item checks it in", (await ev(`${pill}.textContent`)) !== before, `${before} → ${await ev(`${pill}.textContent`)}`);

const trip = `[...document.querySelectorAll('.card')].find((c) => c.querySelector('h3')?.textContent.includes("出门"))`;
await click(`${trip}.querySelector('.addlink')`); await sleep(200);
await type(`${trip}.querySelector('.add input')`, "测试新加的一条");
await ev(`${trip}.querySelector('.add input').dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })), true`);
check("add an item", await waitFor(`!!${row("测试新加的一条")}`, 3000));

await click(`[...document.querySelectorAll('header .tbtn')].find((b) => b.textContent === "设置")`); await sleep(500);
await click(`[...document.querySelectorAll('.drawer button')].find((b) => b.textContent.trim() === "暗")`);
check("switch to dark mode in the settings", await waitFor(`document.documentElement.dataset.mode === "dark"`, 2000));
await ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })), true`); await sleep(500);
await shoot("2-desktop-dark");

await click(`document.querySelector('.csync-btn')`); await sleep(300);
check('"同步 Canvas": it starts syncing', (await ev(`document.querySelector('.csync-btn').textContent`)) === "同步中");
check("when the sync finishes it reports no changes", await waitFor(`/Canvas：没有变化/.test(document.body.textContent)`, 4000));

check("no request to /api/ at any point", !requests.some((r) => r.url.includes("/api/")), requests.filter((r) => r.url.includes("/api/")).map((r) => r.url).join(" "));
const fetched = requests.filter((r) => !r.url.startsWith("data:")); // data: URLs are small icons inlined in the styles, not requests
const odd = fetched.filter((r) => !r.url.startsWith(base + "/") || r.method !== "GET");
check("files come only from this site, all with GET", fetched.length > 40 && !odd.length, odd.map((r) => `${r.method} ${r.url}`).slice(0, 3).join(" "));
check("no fetch / XHR", !requests.some((r) => ["Fetch", "XHR", "WebSocket", "EventSource", "Ping"].includes(r.type)), requests.filter((r) => ["Fetch", "XHR"].includes(r.type)).map((r) => r.url).join(" "));

// ---- a reload restores the original state ----
await page.reload(); await waitFor(`document.querySelectorAll('[data-agent-card]').length === 5`, 4000);
check("reload: back to the original state (the added item is gone, five agent cards again, light / dark follows the system)", !(await ev(`!!${row("测试新加的一条")}`)) && (await ev(`document.querySelectorAll('[data-agent-card]').length`)) === 5 && (await ev(`document.documentElement.dataset.mode`)) === "auto");

// ---- phone ----
await page.device({ width: 390, height: 844, scale: 3, phone: true });
await page.reload(); await waitFor(`!!document.querySelector('[data-agent-card]')`);
check("phone: the GitHub link fits in the header bar too", await ev(`(() => { const t = [...document.querySelectorAll('header a.demo-tag')].pop()?.getBoundingClientRect(), b = document.querySelector('header .bar').getBoundingClientRect(); return !!t && t.width > 0 && t.right <= b.right })()`));
check('phone: "示例" fits in the one-line header bar', await ev(`(() => { const t = document.querySelector('header .demo-tag').getBoundingClientRect(), b = document.querySelector('header .bar').getBoundingClientRect(); return t.width > 0 && t.right <= b.right && t.top >= b.top && t.bottom <= b.bottom })()`));
const [sw, iw] = await ev(`[document.documentElement.scrollWidth, innerWidth]`);
check("phone: no horizontal overflow", sw <= iw, sw > iw ? `${sw} > ${iw}` : "");
await shoot("3-phone");

check("no errors at any point (including anything blocked by CSP, and 404s)", errors.length === 0, errors.slice(0, 4).join(" | "));
await page.close();
console.log(failed ? `\n${failed} failed` : `\nall passed (screenshots in ${SHOTS})`);
process.exit(failed ? 1 : 0);
