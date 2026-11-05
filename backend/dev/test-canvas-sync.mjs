// Checks for Canvas sync: the merge rules (pure functions) and the board server's API. Uses a temporary directory, a
// temporary port and a fake Canvas export; never touches real data and never connects to Canvas.
//   node dev/test-canvas-sync.mjs
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { request } from "node:http";
import { fileURLToPath } from "node:url";

process.env.TZ = "Asia/Shanghai";
const HERE = dirname(fileURLToPath(import.meta.url));
const TODO = join(HERE, "..");
const TMP = await mkdtemp(join(tmpdir(), "axi-canvas-"));
process.env.TODO_DIR = TMP;
const lib = await import("../lib.mjs");
const sync = await import("../canvas-sync.mjs");
const { startServer } = await import("../test/helpers.mjs");

let passed = 0;
const check = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.stack?.split("\n").slice(0, 3).join("\n    ")}`); process.exitCode = 1; }
};

// ---- fake data ----
const NOW = Date.parse("2026-10-23T12:00:00+08:00");
const DAY = 86_400_000;
const A = (id, name, due, extra = {}) => ({
  id, name, due_at: due, lock_at: due, unlock_at: null, html_url: `https://canvas.example.com/courses/1/assignments/${id}`,
  submission_types: ["online_upload"], published: true, workflow_state: "unsubmitted", submitted_at: null,
  missing: false, late: false, excused: false, ...extra,
});
const C = (id, name, assignments) => ({ id, name, ok: true, assignments });
const data = (...courses) => ({ ok: true, host: "canvas.example.com", fetched_at: "2026-10-23T04:00:00+00:00", courses });
const baseDoc = () => {
  const d = lib.emptyDoc();
  d.sections.push({ id: "work", title: "工作", sub: "", order: 10, hidden: false });
  d.groups.push({ id: "w1", section: "work", title: "1. 训练", note: "", order: 10 });
  d.items.push({ id: "mine", group: "w1", title: "我自己的事", status: "todo", note: "", order: 10, createdAt: "x", updatedAt: "x" });
  return lib.normalize(d);
};
const stat = (...as) => C(95697, "机器学习", as);
const HW2 = A(421557, "第二次作业", "2026-10-28T15:59:59Z");
const HW3 = A(421558, "第三次作业", "2026-11-10T15:59:59Z");
const canvasItems = (d) => d.items.filter((i) => i.source?.type === "canvas");
const byTitle = (d, t) => d.items.find((i) => i.title.endsWith(t));

console.log("Merge rules");

await check('first sync: imports only assignments not yet submitted that can still be submitted, creates the "课程" section, sorts by due date', () => {
  const d = baseDoc();
  const { logs, summary } = sync.applySync(d, data(
    stat(A(421555, "第一次作业", "2026-09-30T15:59:59Z", { workflow_state: "graded" }), HW3, HW2),
    C(95696, "图像处理与机器视觉", [A(434658, "Quiz 2026/10/21", "2026-10-21T15:59:00Z", { missing: true })]),
    { id: 99, name: "坏掉的课", ok: false, error: "没有权限（403）" },
  ), NOW);
  assert.equal(summary.added.length, 2);
  assert.deepEqual(summary.failedCourses, [{ name: "坏掉的课", error: "没有权限（403）" }]);
  const g = d.groups.find((x) => x.id === d.settings.canvasGroup);
  assert.equal(g.title, "课程");
  assert.equal(d.sections.find((s) => s.id === g.section).title, "课程");
  const items = lib.itemsOf(d, g.id);
  assert.deepEqual(items.map((i) => i.title), ["机器学习 · 第二次作业", "机器学习 · 第三次作业"]);
  assert.equal(items[0].due, "2026-10-28 23:59");
  assert.equal(items[0].status, "todo");
  assert.equal(items[0].source.key, "canvas:canvas.example.com:assignment:421557");
  assert.equal(items[0].source.url, "https://canvas.example.com/courses/1/assignments/421557");
  assert.ok(logs.length > 0);
});

await check("syncing the same data again changes nothing", () => {
  const d = baseDoc(), x = data(stat(HW2, HW3));
  sync.applySync(d, x, NOW);
  const before = JSON.stringify(d);
  const { logs } = sync.applySync(d, x, NOW);
  assert.equal(logs.length, 0);
  assert.equal(JSON.stringify(d), before);
});

await check("Canvas changed the due date and it was not edited on the board: follow Canvas", () => {
  const d = baseDoc();
  sync.applySync(d, data(stat(HW2)), NOW);
  const { summary } = sync.applySync(d, data(stat({ ...HW2, due_at: "2026-10-30T15:59:59Z" })), NOW);
  assert.equal(byTitle(d, "第二次作业").due, "2026-10-30 23:59");
  assert.deepEqual(summary.updated.map((u) => u.fields), [["截止"]]);
  assert.equal(summary.conflicts.length, 0);
});

await check("due date edited on the board and changed on Canvas: keep the board's, report it once", () => {
  const d = baseDoc();
  sync.applySync(d, data(stat(HW2)), NOW);
  byTitle(d, "第二次作业").due = "2026-10-27 20:00";
  const changed = data(stat({ ...HW2, due_at: "2026-10-30T15:59:59Z" }));
  const r1 = sync.applySync(d, changed, NOW);
  assert.equal(byTitle(d, "第二次作业").due, "2026-10-27 20:00");
  assert.equal(r1.summary.conflicts.length, 1);
  assert.equal(r1.summary.conflicts[0].field, "截止");
  const r2 = sync.applySync(d, changed, NOW);
  assert.equal(r2.summary.conflicts.length, 0);
  assert.equal(r2.logs.length, 0);
});

await check("title edited on the board: a rename on Canvas does not overwrite it", () => {
  const d = baseDoc();
  sync.applySync(d, data(stat(HW2)), NOW);
  const it = byTitle(d, "第二次作业");
  it.title = "统计第二次作业（先做 3.27）";
  const { summary } = sync.applySync(d, data(stat({ ...HW2, name: "第二次作业（更新）" })), NOW);
  assert.equal(it.title, "统计第二次作业（先做 3.27）");
  assert.equal(summary.conflicts[0].field, "标题");
});

await check("Canvas shows it submitted: marked done, the note and agent info are left alone", () => {
  const d = baseDoc();
  sync.applySync(d, data(stat(HW2)), NOW);
  const it = byTitle(d, "第二次作业");
  lib.applyPatch(it, { status: "agent", agent: { where: "Pi", note: "在写 3.27" } });
  it.note = "交 PDF";
  const { summary } = sync.applySync(d, data(stat({ ...HW2, workflow_state: "submitted", submitted_at: "2026-10-27T10:00:00Z" })), NOW);
  assert.equal(it.status, "done");
  assert.ok(it.doneAt);
  assert.equal(it.note, "交 PDF");
  assert.equal(it.agent.where, "Pi");
  assert.equal(it.agent.note, "在写 3.27");
  assert.equal(summary.done.length, 1);
});

await check("an item closed on the board is not reopened, even though Canvas still shows it as not submitted", () => {
  const d = baseDoc();
  sync.applySync(d, data(stat(HW2)), NOW);
  const it = byTitle(d, "第二次作业");
  lib.applyPatch(it, { status: "dropped", reason: "纸质交" });
  const { logs } = sync.applySync(d, data(stat(HW2)), NOW);
  assert.equal(it.status, "dropped");
  assert.equal(logs.length, 0);
});

await check("a course that could not be fetched: its items are left untouched and do not count as gone", () => {
  const d = baseDoc();
  sync.applySync(d, data(stat(HW2)), NOW);
  const before = JSON.stringify(canvasItems(d));
  const { summary, logs } = sync.applySync(d, data({ id: 95697, name: "机器学习", ok: false, error: "连不上 Canvas" }), NOW);
  assert.equal(JSON.stringify(canvasItems(d)), before);
  assert.equal(summary.gone.length, 0);
  assert.equal(logs.length, 0);
});

await check("gone from Canvas: not deleted, only reported", () => {
  const d = baseDoc();
  sync.applySync(d, data(stat(HW2, HW3)), NOW);
  const { summary } = sync.applySync(d, data(stat(HW3)), NOW);
  assert.ok(byTitle(d, "第二次作业"));
  assert.deepEqual(summary.gone.map((g) => g.title), ["机器学习 · 第二次作业"]);
});

await check("a deleted synced item is remembered and not imported again", () => {
  const d = baseDoc();
  sync.applySync(d, data(stat(HW2)), NOW);
  const it = byTitle(d, "第二次作业");
  d.items = d.items.filter((i) => i !== it);
  sync.rememberDismissed(d, [it]);
  const { summary } = sync.applySync(d, data(stat(HW2)), NOW);
  assert.equal(summary.added.length, 0);
  assert.ok(!byTitle(d, "第二次作业"));
});

await check("not imported: locked, more than two weeks past due, unpublished, nothing to submit", () => {
  const d = baseDoc();
  const { summary } = sync.applySync(d, data(stat(
    A(1, "锁了", "2026-10-20T15:59:59Z"),
    A(2, "老作业", "2026-09-01T15:59:59Z", { lock_at: null }),
    A(3, "没发布", "2026-11-01T15:59:59Z", { published: false }),
    A(4, "出勤", null, { lock_at: null, submission_types: ["none"] }),
    A(5, "免交", "2026-11-01T15:59:59Z", { excused: true }),
    A(6, "迟交还能交", "2026-10-20T15:59:59Z", { lock_at: "2026-10-30T15:59:59Z" }),
    A(7, "没截止", null, { lock_at: null }),
  )), NOW);
  assert.deepEqual(summary.added.map((a) => a.title.split(" · ")[1]), ["迟交还能交", "没截止"]);
  assert.equal(byTitle(d, "没截止").due, undefined);
});

await check("new assignments are inserted in due-date order; if a card is chosen in the settings they go into that card", () => {
  const d = baseDoc();
  d.settings.canvasGroup = "w1";
  lib.itemsOf(d, "w1")[0].due = "2026-11-01 12:00";
  sync.applySync(d, data(stat(HW2, HW3)), NOW);
  assert.ok(!d.sections.some((s) => s.title === "课程"));
  assert.deepEqual(lib.itemsOf(d, "w1").map((i) => i.title), ["机器学习 · 第二次作业", "我自己的事", "机器学习 · 第三次作业"]);
});

await check("Canvas removed the due date: it is removed from the item too", () => {
  const d = baseDoc();
  sync.applySync(d, data(stat(HW2)), NOW);
  sync.applySync(d, data(stat({ ...HW2, due_at: null, lock_at: null })), NOW);
  assert.equal(byTitle(d, "第二次作业").due, undefined);
  assert.equal(byTitle(d, "第二次作业").source.due, undefined);
});

await check("auto sync is scheduled from the last attempt: a restart does not reset the clock; it waits at least a minute", () => {
  const now = Date.parse("2026-11-03T12:00:00Z");
  assert.equal(sync.nextSyncDelay("2026-11-03T09:12:00Z", now), 12 * 60_000, "last one at 9:12, so three hours later is 12:12");
  assert.equal(sync.nextSyncDelay("2026-11-03T02:00:00Z", now), 60_000, "long overdue: in a minute");
  assert.equal(sync.nextSyncDelay(undefined, now), 60_000, "never synced: in a minute");
});

await check("localDue converts to local time", () => {
  assert.equal(sync.localDue("2026-10-28T15:59:59Z"), "2026-10-28 23:59");
  assert.equal(sync.localDue("2026-10-31T16:00:00Z"), "2026-11-01 00:00");
  assert.equal(sync.localDue(null), null);
  assert.equal(sync.localDue("不是日期"), null);
});

console.log("The layer that reads Canvas only sends GET");

await check("canvas/read.mjs makes no request that changes data", async () => {
  const src = await readFile(join(TODO, "canvas", "read.mjs"), "utf8");
  assert.ok(!/method\s*:|\.(post|put|patch|delete)\(|["'](POST|PUT|PATCH|DELETE)["']/.test(src), "there is a non-GET request");
  assert.ok(/fetch\(url, \{ headers:/.test(src), "the fetch call has changed; update this check to match");
});

console.log("Board server");

// Fake export: reads canvas-data.json from its own directory, appends a line to runs.log on every run, waits 400 ms, then
// writes its output
const FAKE = join(TMP, "fake-export.mjs");
await writeFile(FAKE, `import { readFileSync, appendFileSync } from "node:fs";
const dir = new URL(".", import.meta.url).pathname;
appendFileSync(dir + "runs.log", "run\\n");
const d = JSON.parse(readFileSync(dir + "canvas-data.json", "utf8"));
await new Promise((r) => setTimeout(r, 400));
process.stdout.write(JSON.stringify(d.out));
process.exit(d.exit ?? 0);
`);
const setFake = (out, exit = 0) => writeFile(join(TMP, "canvas-data.json"), JSON.stringify({ out, exit }));
const runs = async () => (existsSync(join(TMP, "runs.log")) ? (await readFile(join(TMP, "runs.log"), "utf8")).trim().split("\n").length : 0);

const srv = await startServer({ dir: TMP, data: baseDoc(), env: { CANVAS_EXPORTER: FAKE } });
const PORT = srv.port;
const http = (method, path, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const h = { host: `127.0.0.1:${PORT}`, ...headers };
  if (body !== undefined) h["content-type"] = "application/json";
  const req = request({ host: "127.0.0.1", port: PORT, method, path, headers: h }, (res) => {
    let s = "";
    res.setEncoding("utf8");
    res.on("data", (c) => (s += c));
    res.on("end", () => { let j = null; try { j = JSON.parse(s); } catch {} resolve({ status: res.statusCode, json: j }); });
  });
  req.on("error", reject);
  if (body !== undefined) req.write(JSON.stringify(body));
  req.end();
});
const ORIGIN = { origin: `http://127.0.0.1:${PORT}` };

try {
  await check("Host is not a local address: 403", async () => {
    const r = await http("GET", "/api/todo", { headers: { host: `evil.example:${PORT}` } });
    assert.equal(r.status, 403);
  });

  await check("a change sent from another site: 403, data unchanged", async () => {
    const r = await http("POST", "/api/items", { headers: { origin: "https://evil.example" }, body: { group: "w1", title: "不该加上" } });
    assert.equal(r.status, 403);
    const d = (await http("GET", "/api/todo")).json;
    assert.ok(!d.items.some((i) => i.title === "不该加上"));
  });

  await check("changes from a local page, and local requests without Origin: work as usual", async () => {
    assert.equal((await http("POST", "/api/items", { headers: ORIGIN, body: { group: "w1", title: "本机加的" } })).status, 200);
    assert.equal((await http("PATCH", "/api/settings", { body: { staleHours: 5 } })).status, 200);
  });

  await check("two sync requests at once: it runs once and both get the same result", async () => {
    // The board server uses the real "now": move the due dates into the future, or in a few days these assignments would count
    // as past due and not be imported
    const later = (a) => ({ ...a, due_at: new Date(Date.parse(a.due_at) + 365 * DAY).toISOString(), lock_at: new Date(Date.parse(a.lock_at) + 365 * DAY).toISOString() });
    await setFake(data(stat(later(HW2), later(HW3)), { id: 99, name: "坏掉的课", ok: false, error: "没有权限（403）" }));
    const [a, b] = await Promise.all([http("POST", "/api/canvas/sync", { headers: ORIGIN }), http("POST", "/api/canvas/sync", { headers: ORIGIN })]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(await runs(), 1);
    assert.equal(a.json.added.length, 2);
    assert.deepEqual(a.json, b.json);
    const d = (await http("GET", "/api/todo")).json;
    assert.equal(canvasItems(d).length, 2);
    assert.ok(d.settings.canvasGroup);
  });

  await check("GET /api/canvas: the time of the last success and the courses that could not be fetched", async () => {
    const st = (await http("GET", "/api/canvas")).json;
    assert.equal(st.ok, true);
    assert.equal(st.running, false);
    assert.ok(st.lastSuccess);
    assert.equal(st.result.added, 2);
    assert.deepEqual(st.result.failedCourses.map((c) => c.name), ["坏掉的课"]);
  });

  await check("sync requested by another site: 403, it does not run", async () => {
    const before = await runs();
    assert.equal((await http("POST", "/api/canvas/sync", { headers: { origin: "https://evil.example" } })).status, 403);
    assert.equal(await runs(), before);
  });

  await check("a synced item deleted on the board does not come back on the next sync", async () => {
    let d = (await http("GET", "/api/todo")).json;
    const it = canvasItems(d).find((i) => i.title.endsWith("第三次作业"));
    assert.equal((await http("DELETE", `/api/items/${it.id}`, { headers: ORIGIN })).status, 200);
    const r = await http("POST", "/api/canvas/sync", { headers: ORIGIN });
    assert.equal(r.status, 200);
    assert.equal(r.json.added.length, 0);
    d = (await http("GET", "/api/todo")).json;
    assert.ok(!d.items.some((i) => i.title.endsWith("第三次作业")));
    assert.ok(d.extras.canvasDismissed.includes("canvas:canvas.example.com:assignment:421558"));
  });

  await check("Canvas unreachable: 502, data unchanged, the failure is recorded but the time of the last success is kept", async () => {
    const before = (await http("GET", "/api/todo")).json;
    const st0 = (await http("GET", "/api/canvas")).json;
    await setFake({ ok: false, error: "连不上 Canvas" }, 1);
    const r = await http("POST", "/api/canvas/sync", { headers: ORIGIN });
    assert.equal(r.status, 502);
    assert.equal(r.json.error, "连不上 Canvas");
    const after = (await http("GET", "/api/todo")).json;
    assert.equal(after.rev, before.rev);
    const st = (await http("GET", "/api/canvas")).json;
    assert.equal(st.ok, false);
    assert.equal(st.error, "连不上 Canvas");
    assert.equal(st.lastSuccess, st0.lastSuccess);
  });

  await check("malformed export: the whole run is discarded", async () => {
    const before = (await http("GET", "/api/todo")).json;
    await setFake({ ok: true, host: "canvas.example.com", courses: [{ id: "x", name: 1, ok: true }] });
    const r = await http("POST", "/api/canvas/sync", { headers: ORIGIN });
    assert.equal(r.status, 502);
    assert.equal((await http("GET", "/api/todo")).json.rev, before.rev);
  });

  await check("log entries written by sync have actor canvas-sync", async () => {
    const lines = srv.log();
    assert.ok(lines.some((l) => l.actor === "canvas-sync" && l.op === "canvas-add"));
  });
} finally {
  srv.stop();
  if (srv.stderr.trim()) console.log(srv.stderr.trim());
  await rm(TMP, { recursive: true, force: true });
}

console.log(process.exitCode ? `some checks failed (${passed} passed)` : `all ${passed} passed`);
