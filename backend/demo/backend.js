// The demo site's "server": one document held in the browser's memory. Changes go through the same endpoint table as the server
// (core/edits.mjs) and the same operations, so everything the board can do works here, with the same error messages; nothing is
// stored anywhere, though, and reloading the page brings back the original data.
// Canvas sync is pretend: it shows a sync an hour ago, and clicking it spins for a moment and reports no changes.
//
//   setBackend(localBackend(sampleDoc()))   // web/lib/api.js hands all later requests to it
import { EDITS, match } from "../core/edits.mjs";
import { normalize } from "../core/schema.mjs";
import { nowIso } from "../core/doc.mjs";

// As over the network: what comes in and what goes out are fresh copies, so objects in the UI never share data with the copy here
const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NO_CHANGE = { added: [], updated: [], done: [], conflicts: [], failedCourses: [], gone: [] };

/** start: the initial data; syncMs: how long the pretend Canvas sync takes */
export function localBackend(start, { syncMs = 1200, repo = "" } = {}) {
  let doc = normalize(clone(start));
  doc.demo = { repo }; // the header bar shows a demo badge next to the title, and a link to the repository
  const ago = new Date(Date.now() - 3600e3).toISOString();
  let canvas = { lastAttempt: ago, lastSuccess: ago, ok: true, result: NO_CHANGE };

  return async (method, path, body) => {
    path = path.split("?")[0];
    if (method === "GET" && path === "/api/todo") return clone(doc);
    if (method === "GET" && path === "/api/canvas") return { ...clone(canvas), running: false };
    if (method === "POST" && path === "/api/canvas/sync") {
      await sleep(syncMs);
      const at = nowIso();
      canvas = { lastAttempt: at, lastSuccess: at, ok: true, result: NO_CHANGE };
      return { ok: true, ...clone(NO_CHANGE) };
    }
    const e = match(EDITS, method, path);
    if (!e) throw new Error("not found");
    // Change a copy, so an error halfway leaves the original untouched (the server reads a fresh copy from the file each time)
    const next = clone(doc);
    const logs = await e.fn(next, clone(body) ?? {}, e.id);
    if (logs == null || (Array.isArray(logs) && !logs.length)) return clone(doc); // nothing changed: rev stays the same
    next.rev = (next.rev ?? 0) + 1;
    next.updatedAt = nowIso();
    doc = normalize(next);
    return clone(doc);
  };
}
