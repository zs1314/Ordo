// A before/after comparison for refactoring: with the same data and a fixed clock, captures each main view of the board
// (screenshot and page structure), captures again after the change, and compares them one by one.
//
//   node dev/snapshot.mjs shoot <dir> [--like <old dir>]   capture (desktop light and dark, phone; menu, date picker, repeat, hand off to an agent, edit form, settings, layout editing, heatmap)
//   node dev/snapshot.mjs diff <old dir> <new dir>         compare: page structure line by line, screenshots pixel by pixel; report whatever differs
//
// Usage: shoot once before the change and again after it with the same data (--like <old dir>), then diff. To shoot an older version of the code:
//   git worktree add /tmp/old <commit>; TODO_CODE=/tmp/old node dev/snapshot.mjs shoot before
// The first shoot takes its data from the file in SNAPSHOT_DATA (default: the demo's sample data) and saves it as data.json in
// the directory; the clock is fixed at one hour after the data's last update, so texts like "N hours ago" match both times.
// All animations are off (prefers-reduced-motion).
import fs from "node:fs";
import path from "node:path";
import { startBoard, sleep } from "./harness.mjs";
import { sampleDoc } from "../demo/sample.js";

const [cmd, A, B, C] = process.argv.slice(2);
if (cmd === "shoot" && A) await shoot(A, B === "--like" && C ? path.join(C, "data.json") : process.env.SNAPSHOT_DATA);
else if (cmd === "diff" && A && B) await diff(A, B);
else { console.log("node dev/snapshot.mjs shoot <dir> | diff <old dir> <new dir>"); process.exit(1); }

async function shoot(out, src) {
  const data = src ? fs.readFileSync(src, "utf8") : JSON.stringify(sampleDoc());
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const from = path.join(out, "data.json");
  fs.writeFileSync(from, data);
  const T = Date.parse(JSON.parse(data).updatedAt) + 3600_000;
  const board = await startBoard({ from, theme: { hero: false, doneChart: "bars" } });
  const clock = `(() => { const T = ${T}, D = Date; class F extends D { constructor(...a) { super(...(a.length ? a : [T])); } static now() { return T; } } window.Date = F; })();`;
  const errors = [];
  const shots = async (name, opts, steps) => {
    const p = await board.tab(board.base, { ...opts, scale: 1, reduce: true, init: clock });
    if (opts.dark) { await p.media([{ name: "prefers-color-scheme", value: "dark" }, { name: "prefers-reduced-motion", value: "reduce" }]); await sleep(300); }
    const save = async (what, full = false) => {
      const file = `${out}/${name}-${what}`;
      const shot = await p.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: full });
      fs.writeFileSync(`${file}.png`, Buffer.from(shot.result.data, "base64"));
      fs.writeFileSync(`${file}.html`, await p.ev(`(() => { const b = document.body.cloneNode(true); b.querySelectorAll("script").forEach((s) => s.remove());
        return [...document.documentElement.attributes].map((a) => a.name + "=" + a.value).join(" ") + "\\n" + b.innerHTML.replace(/></g, ">\\n<") })()`));
    };
    await steps(p, save);
    errors.push(...p.errors.map((e) => `${name}: ${e}`));
    await p.close();
  };
  const row = `document.querySelector('main section.block[id^="b-s-"] .items .item.todo')`;
  const opt = (t) => `[...document.querySelectorAll('.pop .opt')].find((o) => o.textContent.includes(${JSON.stringify(t)}))`;
  const popups = async (p, save, phone) => {
    await p.click(`${row}.querySelector('.pill')`); await sleep(250); await save("menu");
    await p.click(opt("截止")); await sleep(250); await save("picker"); await p.esc(); await sleep(200);
    for (const [label, what] of [["重复", "repeat"], ["Agent 在做", "ask"]]) {
      await p.click(`${row}.querySelector('.pill')`); await sleep(200); await p.click(opt(label)); await sleep(250); await save(what); await p.esc(); await sleep(200);
    }
    await p.click(`${row}.querySelector('.tool[title="编辑"]')`); await sleep(300); await save("form"); await p.esc(); await sleep(200);
    if (phone) { await p.click(`document.querySelector('[data-agent-card] .b-more')`); await sleep(200); await p.click(opt("编辑")); }
    else await p.click(`[...document.querySelectorAll('[data-agent-card] .btn')].find((b) => b.textContent === "编辑")`);
    await sleep(300); await save("agentform"); await p.esc(); await sleep(200);
    await p.ev("scrollTo(0, 0), true");
    await p.click(`[...document.querySelectorAll('header .tbtn')].find((b) => b.textContent === "设置")`); await sleep(500); await save("settings");
    await p.ev("document.querySelector('.drawer').scrollTop = 99999, true"); await sleep(200); await save("settings-end"); await p.esc(); await sleep(500);
  };
  await shots("desk", { width: 1440, height: 900 }, async (p, save) => {
    await save("page", true);
    await popups(p, save, false);
    await p.click("document.querySelector('header .tbtn.edit-btn')"); await sleep(400); await save("editmode", true);
  });
  await shots("desk-dark", { width: 1440, height: 900, dark: true }, (p, save) => save("page", true));
  await shots("phone", { width: 390, height: 844, phone: true }, async (p, save) => { await save("page", true); await popups(p, save, true); });
  // Heatmap: once a setting has changed, the data's update time is the real "now", so the "updated N minutes ago" line in the
  // header bar differs every time; hide it before shooting
  await board.api("PATCH", "/api/theme", { doneChart: "heatmap" });
  for (const [name, o] of [["desk-heatmap", { width: 1440, height: 900 }], ["phone-heatmap", { width: 390, height: 844, phone: true }]]) {
    await shots(name, o, async (p, save) => {
      await p.ev(`(() => { document.querySelectorAll('.hdr-meta').forEach((e) => e.remove()); document.getElementById('b-done').scrollIntoView({ block: "center" }); return true })()`);
      await sleep(300); await save("done");
    });
  }
  board.close();
  console.log(`${fs.readdirSync(out).filter((f) => f.endsWith(".png")).length} screenshots in ${out}${errors.length ? `\nerrors in the page:\n${errors.join("\n")}` : ""}`);
}

async function diff(a, b) {
  const names = fs.readdirSync(a).filter((f) => f.endsWith(".png")).map((f) => f.slice(0, -4)).sort();
  // The browser decodes the screenshots, and they are compared pixel by pixel
  const board = await startBoard();
  const p = await board.tab("about:blank", { width: 400, height: 300 });
  let same = 0;
  for (const n of names) {
    if (!fs.existsSync(path.join(b, `${n}.png`))) { console.log(`✗ ${n}: missing from the new set`); continue; }
    const img = (dir) => `data:image/png;base64,${fs.readFileSync(path.join(dir, `${n}.png`)).toString("base64")}`;
    const px = await p.ev(`(async () => {
      const load = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
      const [x, y] = await Promise.all([load(${JSON.stringify(img(a))}), load(${JSON.stringify(img(b))})]);
      if (x.width !== y.width || x.height !== y.height) return "size differs: " + x.width + "×" + x.height + " → " + y.width + "×" + y.height;
      const data = (i) => { const c = document.createElement("canvas"); c.width = i.width; c.height = i.height; const g = c.getContext("2d"); g.drawImage(i, 0, 0); return g.getImageData(0, 0, i.width, i.height).data; };
      const u = data(x), v = data(y); let k = 0;
      for (let j = 0; j < u.length; j += 4) if (u[j] !== v[j] || u[j + 1] !== v[j + 1] || u[j + 2] !== v[j + 2]) k++;
      return k;
    })()`);
    const lines = (dir) => fs.readFileSync(path.join(dir, `${n}.html`), "utf8").split("\n");
    const [la, lb] = [lines(a), lines(b)], gone = la.filter((l) => !lb.includes(l)), added = lb.filter((l) => !la.includes(l));
    if (px === 0 && !gone.length && !added.length) { same++; continue; }
    console.log(`\n✗ ${n}: screenshot ${px === 0 ? "same" : typeof px === "number" ? `${px} pixels differ` : px}; page structure ${gone.length + added.length ? `${gone.length + added.length} lines differ` : "same"}`);
    for (const l of gone.slice(0, 6)) console.log(`   - ${l.slice(0, 200)}`);
    for (const l of added.slice(0, 6)) console.log(`   + ${l.slice(0, 200)}`);
  }
  await p.close(); board.close();
  console.log(`\n${same}/${names.length} identical`);
}
