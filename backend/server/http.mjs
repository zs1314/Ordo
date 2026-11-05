// Small HTTP helpers: send a response, redirect, read the request body, send files
import { promises as fs } from "node:fs";
import { join, normalize, sep, extname } from "node:path";
import { fail } from "../core/errors.mjs";

// Every response carries no-transform: when the site is proxied through Cloudflare (orange cloud), Cloudflare leaves pages
// alone and does not inject its Web Analytics script (the CSP would block it anyway, with an error in the console)
const CACHE = (v) => `${v}, no-transform`;

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2",
};

export function send(res, code, body, type = "application/json; charset=utf-8") {
  res.writeHead(code, { "content-type": type, "cache-control": CACHE("no-store") });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

export function redirect(res, to, headers = {}) {
  res.writeHead(303, { location: to, "cache-control": CACHE("no-store"), ...headers });
  res.end();
}

/** Reads the request body: JSON (the login form is urlencoded), at most 512 KB; an empty body counts as {} */
export async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 512 * 1024) throw fail(413, "请求太大");
    chunks.push(c);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  if (String(req.headers["content-type"] ?? "").startsWith("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(text));
  try { return JSON.parse(text); } catch { throw fail(400, "请求不是合法的 JSON"); }
}

export async function sendFile(res, file, cache = "no-cache") {
  let buf;
  try { buf = await fs.readFile(file); } catch { return send(res, 404, { error: "not found" }); }
  res.writeHead(200, { "content-type": TYPES[extname(file)], "cache-control": CACHE(cache) });
  res.end(buf);
}

/** Serves files from a directory: only files inside it with a known extension; "/" is index.html */
export function serveDir(dir) {
  return (res, pathname, cache) => {
    const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
    const file = normalize(join(dir, rel));
    if (!file.startsWith(dir + sep) || !TYPES[extname(file)]) return send(res, 404, { error: "not found" });
    return sendFile(res, file, cache);
  };
}
