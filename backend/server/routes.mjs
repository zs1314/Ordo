// The API table: one line per endpoint.
// HANDLERS: handled directly; what they return is the response.
// EDITS: the endpoints that change data, in core/edits.mjs (the demo site uses the same table in the browser); server.mjs runs
// each in one transaction (mutate), records who made the change and returns the whole updated document.
import * as L from "../lib.mjs";
import { syncCanvas, syncing, readState } from "../canvas-sync.mjs";
export { EDITS, match } from "../core/edits.mjs";

export const HANDLERS = {
  "GET /api/health": () => ({ ok: true }),
  "GET /api/todo": () => L.load(),
  // Canvas assignment sync: the state of the last run; read Canvas once and merge it in (only one run at a time: clicking again
  // gets the result of the same run)
  "GET /api/canvas": async () => ({ ...(await readState()), running: syncing() }),
  "POST /api/canvas/sync": async () => {
    const r = await syncCanvas();
    if (!r.ok) throw L.fail(502, r.error);
    return r;
  },
};
