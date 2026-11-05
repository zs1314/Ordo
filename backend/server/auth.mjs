// The board's password: it keeps strangers out; it is not a strict permission system.
// It is on only when TODO_PASSWORD is set (on the server, in its env file); without a password, as in local tests, nothing is
// checked.
//
// What counts as signed in:
// - Browsers: enter the password once at /login and get a cookie that lasts 180 days (HttpOnly, Secure over HTTPS). The cookie
//   holds not the password but a token signed with TODO_SECRET; changing the password or the secret invalidates all earlier
//   cookies.
// - Programs (agents and scripts, through client.mjs): send Authorization: Bearer <password>, or Basic (any user name).
// Wrong passwords: at most 10 failed attempts per address within ten minutes, and every failure is answered half a second late.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { send, redirect, readBody } from "./http.mjs";

const COOKIE = "axi_todo";
const MAX_AGE = 180 * 86400;
const WINDOW_MS = 10 * 60_000, MAX_TRIES = 10;

const digest = (s) => createHash("sha256").update(String(s ?? "")).digest();
const same = (a, b) => timingSafeEqual(digest(a), digest(b)); // hash both to the same length, then compare: neither the length nor a shared prefix leaks

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const k = part.indexOf("=");
    if (k > 0) out[part.slice(0, k).trim()] = part.slice(k + 1).trim();
  }
  return out;
}

/** Returns null when no login is needed */
export function createAuth({ password = process.env.TODO_PASSWORD, secret = process.env.TODO_SECRET, title = () => "ToDo" } = {}) {
  if (!password) return null;
  const token = createHmac("sha256", secret || password).update(`axi-todo-session:${password}`).digest("base64url");
  const tries = new Map(); // address → times of its recent failures

  return {
    title,
    /** Whether the request carries a valid cookie or password */
    ok(req) {
      const c = cookies(req)[COOKIE];
      if (c && same(c, token)) return true;
      const h = String(req.headers.authorization ?? "");
      if (h.startsWith("Bearer ")) return same(h.slice(7).trim(), password);
      if (h.startsWith("Basic ")) {
        const s = Buffer.from(h.slice(6).trim(), "base64").toString("utf8");
        return same(s.slice(s.indexOf(":") + 1), password);
      }
      return false;
    },
    /** Whether this address may try again (not after too many failures within ten minutes) */
    canTry(ip) {
      const now = Date.now(), xs = (tries.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
      tries.set(ip, xs);
      if (tries.size > 1000) for (const [k, v] of tries) if (!v.length) tries.delete(k);
      return xs.length < MAX_TRIES;
    },
    /** Checks the password; a wrong one counts as a failure */
    check(ip, given) {
      if (same(given, password)) { tries.delete(ip); return true; }
      tries.set(ip, [...(tries.get(ip) ?? []), Date.now()]);
      return false;
    },
    setCookie: (secure) => `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${secure ? "; Secure" : ""}`,
    clearCookie: (secure) => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`,
  };
}

/** The client's address: for requests forwarded by nginx on this machine, the X-Real-IP header nginx sets */
export function clientIp(req) {
  const peer = req.socket?.remoteAddress ?? "";
  const local = peer === "127.0.0.1" || peer === "::1" || peer === "::ffff:127.0.0.1";
  return (local && req.headers["x-real-ip"]) || peer;
}

/** Where to go after signing in: only paths on this site */
export function safeNext(next) {
  const s = String(next ?? "/");
  return s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/\\") ? s : "/";
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const LOGIN_ERRORS = { 1: "密码不对", 2: "试得太多了，过十分钟再来" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The login stage: handles the login page, signing in and signing out, and stops requests that are not signed in (pages
 *  redirect to the login page; the API and other files get 401). Only the login page, /api/health and the fonts are open
 *  without signing in. Returns true when the request has been handled (nothing more to do) */
export async function handleAuth(auth, req, res, url) {
  const secure = req.headers["x-forwarded-proto"] === "https";
  if (url.pathname === "/login" && req.method === "GET") {
    send(res, 200, loginPage({ next: url.searchParams.get("next") ?? "/", error: LOGIN_ERRORS[url.searchParams.get("err")] ?? "", title: await auth.title() }), "text/html; charset=utf-8");
    return true;
  }
  if (url.pathname === "/api/login" && req.method === "POST") {
    const b = await readBody(req), ip = clientIp(req), next = safeNext(b.next);
    const back = (err) => redirect(res, `/login?err=${err}&next=${encodeURIComponent(next)}`);
    if (!auth.canTry(ip)) back(2);
    else if (!auth.check(ip, b.password)) { await sleep(500); back(1); }
    else redirect(res, next, { "set-cookie": auth.setCookie(secure) });
    return true;
  }
  if (url.pathname === "/logout") { redirect(res, "/login", { "set-cookie": auth.clearCookie(secure) }); return true; }
  const open = url.pathname === "/api/health" || (req.method === "GET" && url.pathname.startsWith("/fonts/"));
  if (open || auth.ok(req)) return false;
  const page = req.method === "GET" && (url.pathname === "/" || url.pathname.endsWith(".html"));
  if (page) redirect(res, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  else send(res, 401, { error: "要先登录" });
  return true;
}

/** The login page: no scripts, one password field; it looks like the board (Adventor Todo, black and white, plenty of space) */
export function loginPage({ next = "/", error = "", title = "ToDo" } = {}) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>${esc(title)}</title>
<link rel="icon" href="data:," />
<style>
  @font-face { font-family: "Adventor Todo"; src: url("/fonts/adventor-todo-regular.woff2") format("woff2"); font-weight: 400; font-display: swap; }
  @font-face { font-family: "Adventor Todo"; src: url("/fonts/adventor-todo-bold.woff2") format("woff2"); font-weight: 700; font-display: swap; }
  :root { --bg: 210 33% 99%; --fg: 240 10% 3.9%; --card: 0 0% 100%; --border: 240 5.9% 88%; --faint: 240 4% 46%; --warn: 32 85% 34%; color-scheme: light dark; }
  @media (prefers-color-scheme: dark) { :root { --bg: 240 20.54% 5.2%; --fg: 0 0% 98%; --card: 240 10% 3.9%; --border: 240 3.7% 19.9%; --faint: 240 4% 58%; --warn: 40 95% 72%; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; min-height: 100dvh; display: grid; place-items: center; padding: 24px; background: hsl(var(--bg)); color: hsl(var(--fg));
    font: 15px/1.7 "Adventor Todo", -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; -webkit-font-smoothing: antialiased; }
  form { width: min(340px, 100%); display: flex; flex-direction: column; gap: 12px; }
  h1 { margin: 0 0 6px; font-size: 1.6em; font-weight: 700; letter-spacing: .2px; }
  input[type=password] { width: 100%; height: 44px; padding: 0 14px; border: 1px solid hsl(var(--border)); border-radius: 12px; background: hsl(var(--card)); color: inherit; font: inherit; font-size: 16px; outline: none; }
  input[type=password]:focus { border-color: hsl(var(--fg) / .6); }
  button { height: 44px; border: 0; border-radius: 12px; background: hsl(var(--fg)); color: hsl(var(--bg)); font: inherit; cursor: pointer; }
  button:hover { opacity: .9; }
  .err { color: hsl(var(--warn)); font-size: 13.5px; margin: 0; }
  .user { position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0; }
</style>
</head>
<body>
<form method="post" action="/api/login">
  <h1>${esc(title)}</h1>
  <input class="user" type="text" name="username" value="axi" autocomplete="username" tabindex="-1" aria-hidden="true" />
  <input type="password" name="password" placeholder="密码" autocomplete="current-password" autofocus required />
  <input type="hidden" name="next" value="${esc(safeNext(next))}" />
  ${error ? `<p class="err">${esc(error)}</p>` : ""}
  <button type="submit">进入</button>
</form>
</body>
</html>
`;
}
