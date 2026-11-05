// Canvas sync: brings Canvas assignments into the board. It reads Canvas (canvas/read.mjs), merges the assignments into the
// board by the rules in canvas/merge.mjs (listed at the top of that file) and records the outcome in the database next to the
// board (meta canvasSync, through getMeta / setMeta in core/store.mjs). The board's sync button and the command line both run
// through here; no agent is involved.
// On the server (with CANVAS_HOST and CANVAS_TOKEN set), the board server also runs it every three hours (scheduleSync,
// called when server.mjs starts).
//
//   TODO_DIR=<data dir> node canvas-sync.mjs            sync once
//   TODO_DIR=<data dir> node canvas-sync.mjs --dry-run  only show what would change, write nothing
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load, mutate, getMeta, setMeta } from "./core/store.mjs";
import { fetchCanvas } from "./canvas/read.mjs";
import { applySync } from "./canvas/merge.mjs";

export { applySync, localDue } from "./canvas/merge.mjs";
export { fetchCanvas, fetchCanvasDirect } from "./canvas/read.mjs";
export { rememberDismissed } from "./core/items.mjs";

export const readState = () => getMeta("canvasSync") ?? {};
const saveState = (st) => setMeta("canvasSync", st);

let running = null;
export const syncing = () => !!running;

const EVERY = 3 * 3600_000;
/** How long until the next automatic sync: three hours after the last attempt, but at least one minute (no rush right after
 *  startup) */
export const nextSyncDelay = (lastAttempt, now = Date.now()) => Math.max(60_000, (Date.parse(lastAttempt ?? "") || 0) + EVERY - now);

/** Syncs automatically every three hours, timed from the last attempt, so restarting the service (every deploy restarts it)
 *  does not reset the clock */
export async function scheduleSync() {
  const run = () => syncCanvas().catch(() => {});
  const wait = nextSyncDelay((await readState()).lastAttempt);
  setTimeout(() => { run(); setInterval(run, EVERY).unref(); }, wait).unref();
  return wait;
}

/** Only one run at a time: clicking again gets the result of the same run */
export function syncCanvas(opts = {}) {
  if (opts.dryRun) return runOnce(opts);
  return (running ??= runOnce(opts).finally(() => { running = null; }));
}

async function runOnce({ dryRun = false, fetch = fetchCanvas } = {}) {
  const at = new Date().toISOString();
  let data;
  try {
    data = await fetch();
  } catch (e) {
    const error = e?.message || String(e);
    if (!dryRun) await saveState({ ...(await readState()), lastAttempt: at, ok: false, error });
    return { ok: false, at, error };
  }
  let summary;
  if (dryRun) summary = applySync(structuredClone(await load()), data).summary;
  else await mutate((doc) => { const r = applySync(doc, data); summary = r.summary; return r.logs; }, "canvas-sync");
  const result = { ok: true, at, dryRun, courses: data.courses.length, ...summary };
  if (!dryRun) await saveState({ lastAttempt: at, lastSuccess: at, ok: true, error: null, result: brief(result) });
  return result;
}

// What is recorded of a run: the board uses it to show how the last sync went
const brief = (r) => ({
  courses: r.courses, added: r.added.length, updated: r.updated.length, done: r.done.length,
  conflicts: r.conflicts, gone: r.gone, failedCourses: r.failedCourses,
});

/** The result as printed on the command line */
export function report(r) {
  if (!r.ok) return `没同步上：${r.error}`;
  const out = [`Canvas：${r.courses} 门课${r.dryRun ? "（只看，不写）" : ""}`];
  const list = (label, xs, fmt) => { if (xs.length) out.push(`${label} ${xs.length}：`, ...xs.map((x) => `  ${fmt(x)}`)); };
  list("新增", r.added, (x) => `${x.title}${x.due ? `（截止 ${x.due}）` : ""}`);
  list("更新", r.updated, (x) => `${x.title}（${x.fields.join("、")}）`);
  list("已提交，标成做完", r.done, (x) => x.title);
  list("你改过、没覆盖", r.conflicts, (x) => `${x.title}：${x.field}，你的是 ${x.mine}，Canvas 上是 ${x.canvas}`);
  list("Canvas 上找不到了", r.gone, (x) => x.title);
  list("没拉到", r.failedCourses, (x) => `${x.name}：${x.error}`);
  if (out.length === 1) out.push("没有变化");
  return out.join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = await syncCanvas({ dryRun: process.argv.includes("--dry-run") });
  console.log(report(r));
  process.exitCode = r.ok ? 0 : 1;
}
