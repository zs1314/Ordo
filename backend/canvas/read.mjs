// Reads Canvas: fetches the courses and their assignments (with the token owner's submission state) and assembles one export.
// Sends GET requests only.
//
// Two ways to read, both returning an export in the same format:
// - Normally: Node's built-in fetch against the Canvas REST API at CANVAS_HOST, with the access token in CANVAS_TOKEN (on the
//   server, both are in its env file).
// - With CANVAS_EXPORTER set: run that program instead and read the export JSON it prints (.mjs / .js files run with node).
//   The tests use this to put a fake in place of Canvas.
//
// Export: { ok: true, host, fetched_at, courses: [{ id, name, ok, error?, assignments: [{ id, name, due_at, lock_at, html_url,
//         submission_types, published, workflow_state, submitted_at, missing, late, excused }] }] }
// A malformed export is rejected as a whole (check), so partial data never changes the board; a course that could not be
// fetched is marked on that course only (ok: false).
import { spawn } from "node:child_process";
import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import { homedir } from "node:os";
const TIMEOUT_MS = 120_000;
const MAX_OUT = 8 * 1024 * 1024;
const ASSIGN_FIELDS = ["id", "name", "due_at", "lock_at", "unlock_at", "html_url", "submission_types", "published"];
// How long a connection attempt waits for each address. Node's default is only 250 ms before it moves on to the next address
// (IPv6). With the server overseas, about 230 ms round trip from the Canvas host, a little evening jitter pushes a connection
// past 250 ms; IPv6 does not get through either, so the sync fails with a connection error. Hence 3 seconds
const CONNECT_ATTEMPT_MS = 3000;

/** Reads once. Throws on failure (cannot connect, invalid token, malformed export); the error messages are meant for people */
export function fetchCanvas({ timeoutMs = TIMEOUT_MS } = {}) {
  const { CANVAS_EXPORTER: exporter, CANVAS_TOKEN: token, CANVAS_HOST: host } = process.env;
  if (exporter) return runExporter(exporter, { timeoutMs });
  if (!token || !host) return Promise.reject(new Error("没配 Canvas（CANVAS_HOST、CANVAS_TOKEN）"));
  return fetchCanvasDirect(token, { host, timeoutMs });
}

// ---- Reading the API directly ----

export async function fetchCanvasDirect(token, { host = process.env.CANVAS_HOST, timeoutMs = TIMEOUT_MS } = {}) {
  setDefaultAutoSelectFamilyAttemptTimeout(CONNECT_ATTEMPT_MS); // a process-wide setting; Canvas is the only outbound connection the board server makes
  const signal = AbortSignal.timeout(timeoutMs);
  const rows = (await pages(host, "/api/v1/courses?enrollment_type=student&enrollment_state=active&per_page=100", token, signal)).filter((r) => r?.name);
  const courses = await Promise.all(rows.map(async (r) => {
    const base = { id: r.id, name: r.name || "" };
    try {
      const xs = await pages(host, `/api/v1/courses/${r.id}/assignments?include[]=submission&order_by=due_at&per_page=100`, token, signal);
      return { ...base, ok: true, assignments: xs.map(pickAssignment) };
    } catch (e) {
      return { ...base, ok: false, error: e?.message || "Canvas 出错" };
    }
  }));
  return check({ ok: true, host, fetched_at: new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00"), courses });
}

// Follow the pages one by one (rel="next" in the Link header); pagination links must stay on CANVAS_HOST
async function pages(host, path, token, signal) {
  let url = `https://${host}${path}`;
  const out = [];
  while (url) {
    if (new URL(url).hostname !== host) throw new Error("分页链接指向了别的网站");
    let res;
    try {
      res = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, signal });
    } catch (e) {
      if (e?.name === "TimeoutError") throw new Error("Canvas 没响应（超时）");
      // include the underlying error code (ETIMEDOUT, ENOTFOUND, ...) so the board shows at a glance which kind of connection
      // failure it is
      const code = e?.cause?.code ?? e?.cause?.errors?.[0]?.code;
      throw new Error(`连不上 Canvas${code ? `（${code}）` : ""}`);
    }
    if (!res.ok) {
      const msg = { 401: "token 失效或被撤销（401）", 403: "没有权限（403）", 404: "找不到（404）" }[res.status];
      throw new Error(msg ?? `Canvas 出错（${res.status}）`);
    }
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error("Canvas 返回了看不懂的结果");
    out.push(...rows);
    url = nextLink(res.headers.get("link"));
  }
  return out;
}

function nextLink(header) {
  for (const part of String(header ?? "").split(",")) {
    const m = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
    if (m) return m[1];
  }
  return null;
}

function pickAssignment(a) {
  const sub = a.submission ?? {};
  return {
    ...Object.fromEntries(ASSIGN_FIELDS.map((k) => [k, a[k] ?? null])),
    workflow_state: sub.workflow_state ?? null,
    submitted_at: sub.submitted_at ?? null,
    missing: Boolean(sub.missing),
    late: Boolean(sub.late),
    excused: Boolean(sub.excused),
  };
}

// ---- External exporter program ----

const lastLine = (s) => s.replace(/\x1b\[[0-9;]*m/g, "").trim().split("\n").pop()?.slice(0, 200) ?? "";

function runExporter(cmd, { timeoutMs }) {
  return new Promise((resolve, reject) => {
    // pass only a minimal environment: the server's own variables (CANVAS_TOKEN, TODO_PASSWORD and the like) are not passed on
    const env = { HOME: homedir(), PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8", PYTHONIOENCODING: "utf-8" };
    const [bin, args] = /\.m?js$/.test(cmd) ? [process.execPath, [cmd]] : [cmd, []];
    const child = spawn(bin, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "", settled = false;
    const finish = (fn) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
      finish(() => reject(new Error("Canvas 没响应（超时）")));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (s) => {
      out += s;
      if (out.length > MAX_OUT) { child.kill("SIGKILL"); finish(() => reject(new Error("Canvas 返回的东西太大"))); }
    });
    child.stderr.on("data", (s) => { if (err.length < 65536) err += s; });
    child.on("error", (e) => finish(() => reject(new Error(e.code === "ENOENT" ? "找不到读 Canvas 的程序（CANVAS_EXPORTER）" : "读 Canvas 的程序起不来"))));
    child.on("close", (code) => finish(() => {
      let data = null;
      try { data = JSON.parse(out); } catch {}
      if (data && data.ok === false) return reject(new Error(String(data.error || "Canvas 出错")));
      if (code !== 0 || !data) return reject(new Error(lastLine(err) || `读 Canvas 的程序出错（退出码 ${code}）`));
      try { resolve(check(data)); } catch (e) { reject(e); }
    }));
  });
}

/** Rejects the whole export if its format is wrong */
export function check(d) {
  const bad = () => { throw new Error("Canvas 导出的格式不对"); };
  if (d?.ok !== true || typeof d.host !== "string" || !Array.isArray(d.courses)) bad();
  for (const c of d.courses) {
    if (!Number.isInteger(c.id) || typeof c.name !== "string" || typeof c.ok !== "boolean") bad();
    if (!c.ok) continue;
    if (!Array.isArray(c.assignments)) bad();
    for (const a of c.assignments) if (!Number.isInteger(a.id) || typeof a.name !== "string") bad();
  }
  return d;
}
