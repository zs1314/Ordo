// Tests for running as a server: password, public host, X-Actor; also client.mjs (the API client for agents and scripts).
//   node --test test/*.test.mjs
// Starts a server in a temporary directory (on any free port), never touches real data, and stops it afterwards.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { startServer } from "./helpers.mjs";

const PASSWORD = "test-password-only", PUBLIC = "dashboard.example.test";
const MIRROR_DIR = mkdtempSync(join(tmpdir(), "axi-todo-mirror-"));
process.env.TODO_MIRROR = join(MIRROR_DIR, "mirror.json"); // the local mirror client.mjs reads when the server is unreachable (must be set before the import)
const { createClient } = await import("../client.mjs");
let srv;

// Uses http.request so the Host header can be set and redirects are not followed
function raw(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: srv.port, method, path, headers }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (s) => (text += s));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
const bearer = { authorization: `Bearer ${PASSWORD}` };
const form = (o) => new URLSearchParams(o).toString();
const formHeaders = (extra = {}) => ({ "content-type": "application/x-www-form-urlencoded", ...extra });

before(async () => {
  writeFileSync(process.env.TODO_MIRROR, JSON.stringify({ sections: [], groups: [], items: [{ id: "m", group: "x", title: "副本里的", status: "doing" }] }));
  srv = await startServer({ env: { TODO_PASSWORD: PASSWORD, TODO_SECRET: "s3cret", TODO_PUBLIC_HOST: PUBLIC }, data: {
    sections: [{ id: "s", title: "工作", order: 10 }, { id: "c", title: "课程", order: 20 }],
    groups: [{ id: "g1", section: "s", title: "一号线", order: 10 }, { id: "gc", section: "c", title: "课程", order: 10, plain: true }],
    items: [
      { id: "a", group: "g1", title: "甲", status: "todo", order: 10 },
      { id: "r", group: "g1", title: "每天的例行", status: "agent", agent: { where: "lab" }, repeat: { days: [0, 1, 2, 3, 4, 5, 6], time: "" }, order: 20 },
    ],
  } });
});
after(() => { srv?.stop(); rmSync(MIRROR_DIR, { recursive: true, force: true }); });

test("not logged in: pages redirect to the login page and the API returns 401; health and the login page need no login", async () => {
  let r = await raw("GET", "/");
  assert.equal(r.status, 303);
  assert.equal(r.headers.location, "/login?next=%2F");
  assert.equal((await raw("GET", "/api/todo")).status, 401);
  assert.equal((await raw("GET", "/main.js")).status, 401);
  assert.equal((await raw("GET", "/api/health")).status, 200);
  r = await raw("GET", "/login?next=%2F&err=1");
  assert.equal(r.status, 200);
  assert.match(r.text, /<form method="post" action="\/api\/login">/);
  assert.match(r.text, /密码不对/);
});

test("accepts both Bearer and Basic; rejects a wrong password", async () => {
  assert.equal((await raw("GET", "/api/todo", { headers: bearer })).status, 200);
  const basic = "Basic " + Buffer.from(`axi:${PASSWORD}`).toString("base64");
  assert.equal((await raw("GET", "/api/todo", { headers: { authorization: basic } })).status, 200);
  assert.equal((await raw("GET", "/api/todo", { headers: { authorization: "Bearer nope" } })).status, 401);
});

test("login page: the right password sets a cookie and redirects back to the original page; a wrong one goes back to the login page; the cookie works", async () => {
  let r = await raw("POST", "/api/login", { headers: formHeaders(), body: form({ password: "wrong", next: "/" }) });
  assert.equal(r.status, 303);
  assert.match(r.headers.location, /^\/login\?err=1/);
  r = await raw("POST", "/api/login", { headers: formHeaders({ "x-forwarded-proto": "https" }), body: form({ password: PASSWORD, next: "/?x=1" }) });
  assert.equal(r.status, 303);
  assert.equal(r.headers.location, "/?x=1");
  const cookie = r.headers["set-cookie"][0];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.equal(cookie.includes(PASSWORD), false, "the cookie does not contain the password");
  assert.equal((await raw("GET", "/api/todo", { headers: { cookie: cookie.split(";")[0] } })).status, 200);
  // the redirect target must be a path on this site
  r = await raw("POST", "/api/login", { headers: formHeaders(), body: form({ password: PASSWORD, next: "//evil.example/x" }) });
  assert.equal(r.headers.location, "/");
});

test("too many wrong passwords within ten minutes: further attempts are refused for a while", async () => {
  const ip = { "x-real-ip": "203.0.113.9" };
  for (let k = 0; k < 10; k++) await raw("POST", "/api/login", { headers: formHeaders(ip), body: form({ password: "wrong" }) });
  const r = await raw("POST", "/api/login", { headers: formHeaders(ip), body: form({ password: PASSWORD }) });
  assert.match(r.headers.location, /err=2/, "even the right password is refused for now");
  const other = await raw("POST", "/api/login", { headers: formHeaders({ "x-real-ip": "203.0.113.10" }), body: form({ password: PASSWORD }) });
  assert.equal(other.headers.location, "/", "other addresses are not affected");
});

test("public host: accepted as Host and as Origin; changes sent from other sites are refused", async () => {
  assert.equal((await raw("GET", "/api/todo", { headers: { ...bearer, host: PUBLIC } })).status, 200);
  assert.equal((await raw("GET", "/api/todo", { headers: { ...bearer, host: "evil.example" } })).status, 403);
  const body = JSON.stringify({ note: "改一下" });
  const h = (origin) => ({ ...bearer, host: PUBLIC, origin, "content-type": "application/json" });
  assert.equal((await raw("PATCH", "/api/items/a", { headers: h(`https://${PUBLIC}`), body })).status, 200);
  assert.equal((await raw("PATCH", "/api/items/a", { headers: h("https://evil.example"), body })).status, 403);
});

test("X-Actor: the log records who made the change", async () => {
  await raw("PATCH", "/api/items/a", { headers: { ...bearer, "x-actor": "pi", "content-type": "application/json" }, body: JSON.stringify({ note: "pi 改的" }) });
  await raw("PATCH", "/api/items/a", { headers: { ...bearer, "x-actor": "someone", "content-type": "application/json" }, body: JSON.stringify({ note: "看板改的" }) });
  const lines = srv.log();
  assert.equal(lines.at(-2).actor, "pi");
  assert.equal(lines.at(-1).actor, "board", "an unknown actor counts as the board");
});

test("Canvas: the sync status needs a login; the old endpoint that sync results used to be pushed to is gone", async () => {
  assert.equal((await raw("GET", "/api/canvas")).status, 401);
  const st = (await raw("GET", "/api/canvas", { headers: bearer })).json;
  assert.equal(st.running, false);
  const r = await raw("POST", "/api/canvas/import", { headers: { ...bearer, "content-type": "application/json" }, body: "{}" });
  assert.equal(r.status, 404);
});

test("client: status, set, check-in and add all go through the API and are logged with actor pi", async () => {
  const c = createClient({ url: srv.base, password: PASSWORD });
  assert.match(await c.status(), /Agent 在做/);
  assert.match(await c.set({ item: "甲", status: "agent", where: "lab" }), /已更新：\[a\] 甲 → Agent 在做（挂在：lab）/);
  assert.match(await c.set({ item: "例行", check: "today" }), /今天做完了/);
  assert.match(await c.set({ item: "例行", check: "today", uncheck: true }), /今天还没做/);
  assert.match(await c.add({ group: "一号", title: "新加的", status: "waiting", waitingOn: "别人" }), /已添加：\[t.+\] 新加的（一号线，等别人）/);
  assert.match(await c.list(), /新加的/);
  assert.equal(srv.log().at(-1).actor, "pi");
  await assert.rejects(c.set({ item: "没有这一条" }), /找不到/);
});

test("client: a wrong password is an error; when the server is unreachable the read-only calls fall back to the local mirror", async () => {
  await assert.rejects(createClient({ url: srv.base, password: "nope" }).status(), /密码不对/);
  const off = createClient({ url: "http://127.0.0.1:9", password: PASSWORD, timeoutMs: 2000 });
  const s = await off.status();
  assert.match(s, /本机的副本/);
  assert.match(s, /副本里的/);
  await assert.rejects(off.set({ item: "甲", note: "x" }), /连不上/);
});
