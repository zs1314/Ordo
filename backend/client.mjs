// A client for the board's API, for agents and scripts (for example a pi extension). The log records the caller as actor.
//
//   createClient({ url, passwordFile, mirror, actor })   or set TODO_URL, TODO_PASSWORD_FILE, TODO_MIRROR
//
// mirror: a local copy of the board as JSON (what node data.mjs export prints). When the server cannot be reached, status, list
// and groups read it instead and say so; changes fail.

import { readFileSync, statSync } from "node:fs";
import * as L from "./lib.mjs";

export function readPassword(file) {
  try { return readFileSync(file, "utf8").trim(); } catch { return ""; }
}

const when = (iso) => (iso ? iso.replace("T", " ").slice(0, 16) : "—");

export function createClient({ url = process.env.TODO_URL, passwordFile = process.env.TODO_PASSWORD_FILE, password = passwordFile ? readPassword(passwordFile) : "",
  mirror = process.env.TODO_MIRROR, actor = "pi", timeoutMs = 15_000 } = {}) {
  if (!url) throw new Error("没设看板的地址（url 或 TODO_URL）");
  const base = url.replace(/\/+$/, "");

  /** Calls the API once. On error, err.status is the HTTP status code (absent when the server cannot be reached) */
  async function request(method, path, body) {
    const headers = { "x-actor": actor };
    if (password) headers.authorization = `Bearer ${password}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    let r;
    try {
      r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      throw new Error(`连不上 ${base}（${e.cause?.code ?? e.name ?? "网络错误"}）`);
    }
    const text = await r.text();
    let j;
    try { j = JSON.parse(text); } catch { j = { error: text.slice(0, 200) }; }
    if (!r.ok) throw Object.assign(new Error(r.status === 401 ? `密码不对或者没配${passwordFile ? `（${passwordFile}）` : ""}` : j.error || `HTTP ${r.status}`), { status: r.status });
    return j;
  }
  const getDoc = async () => L.normalize(await request("GET", "/api/todo"));

  // The read-only calls: fall back to the local mirror when the server cannot be reached
  async function read(render) {
    try { return render(await getDoc()); } catch (e) {
      if (e.status || !mirror) throw e;
      let doc, at;
      try { doc = L.normalize(JSON.parse(readFileSync(mirror, "utf8"))); at = statSync(mirror).mtime.toISOString(); }
      catch { throw e; }
      return `（${e.message}。下面是本机的副本，${when(at)} 从服务器拉下来的，可能不是最新的）\n\n${render(doc)}`;
    }
  }

  const status = () => read((doc) => L.summary(doc));
  const groups = () => read((doc) => doc.groups
    .map((g) => `- ${g.id}：${g.title}（${doc.sections.find((s) => s.id === g.section)?.title ?? g.section}）`).join("\n"));
  const list = ({ includeClosed = false } = {}) => read((doc) => {
    const open = new Set(L.OPEN), lines = [];
    for (const g of doc.groups) {
      const items = L.itemsOf(doc, g.id).filter((i) => includeClosed || open.has(i.status));
      if (!items.length) continue;
      lines.push(`## ${g.title}（${g.id}）`);
      for (const i of items) {
        const a = i.status === "agent" && i.agent ? `｜挂在：${i.agent.where || "没写"}｜上次看 ${when(i.agent.lastSeen)}` : "";
        lines.push(`- [${i.id}] ${L.ICON[i.status]} ${i.title}（${L.LABEL[i.status]}）${a}${i.due ? `｜截止：${i.due}` : ""}${i.note ? `｜${i.note}` : ""}`);
      }
    }
    return lines.join("\n") || "没有条目。";
  });

  const describe = (it) => {
    const rs = L.repeatState(it);
    return `[${it.id}] ${it.title} → ${L.LABEL[it.status]}${it.status === "agent" ? `（挂在：${it.agent?.where || "没写"}）` : ""}`
      + (rs ? `；↻ ${rs.label}，今天${!rs.scheduled ? "不用做" : rs.done ? "做完了" : "还没做"}` : "");
  };

  /** Changes one item: item is an id or a piece of text found in exactly one title */
  async function set(p) {
    if (!p.item) throw new Error("set 需要 item（id 或标题片段）");
    let doc = await getDoc();
    const item = L.findItem(doc, p.item);
    if (!item) throw new Error(`找不到：${p.item}`);
    const patch = {};
    for (const k of ["status", "title", "note", "due", "waitingOn", "reason"]) if (p[k] !== undefined) patch[k] = p[k];
    if (p.group) patch.group = p.group; // the server looks up the card (id or part of its title) and puts the item last in it
    const agent = {};
    if (p.where !== undefined) agent.where = p.where;
    if (p.agentNote !== undefined) agent.note = p.agentNote;
    if (Object.keys(agent).length) patch.agent = agent;
    if (p.seen) patch.seen = true;
    if (p.repeat !== undefined || p.repeatTime !== undefined) {
      const r = p.repeat !== undefined ? L.normalizeRepeat(p.repeat) : item.repeat ? { ...item.repeat } : null;
      if (r && p.repeatTime !== undefined) r.time = p.repeatTime;
      patch.repeat = r;
    }
    const path = `/api/items/${encodeURIComponent(item.id)}`;
    if (Object.keys(patch).length) doc = L.normalize(await request("PATCH", path, patch));
    if (p.check) {
      // "today" sends no date: the server works out which day is today from the item's refresh time
      const body = { done: !p.uncheck };
      if (p.check !== "today") body.date = p.check;
      doc = L.normalize(await request("POST", `${path}/check`, body));
    }
    return `已更新：${describe(doc.items.find((i) => i.id === item.id))}`;
  }

  /** Adds an item to a card: group is an id or part of a title */
  async function add(p) {
    if (!p.group || !p.title?.trim()) throw new Error("add 需要 group 和 title");
    const before = new Set((await getDoc()).items.map((i) => i.id));
    const doc = L.normalize(await request("POST", "/api/items", {
      group: p.group, title: p.title, note: p.note ?? "", status: p.status, due: p.due,
      agent: p.where || p.agentNote ? { where: p.where ?? "", note: p.agentNote ?? "" } : undefined,
      waitingOn: p.waitingOn, reason: p.reason,
    }));
    const it = doc.items.find((i) => !before.has(i.id));
    const g = it && doc.groups.find((x) => x.id === it.group);
    return it ? `已添加：[${it.id}] ${it.title}（${g?.title ?? it.group}，${L.LABEL[it.status]}）` : "已添加";
  }

  return { url: base, request, getDoc, status, groups, list, set, add };
}
