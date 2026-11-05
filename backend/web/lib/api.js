// All talk with the server goes through here. api() sends one request; actions() lists every change that can be made on the
// board, one per route in server/routes.mjs, so components only say what to do (act.item(id).patch({ seen: true })) and never
// build URLs.
//
// The send in actions(send) is App's call(method, path, body, okMsg, opts): on success it swaps in the whole new document the
// server returns; okMsg is the message shown on success; opts.quiet keeps the popover open (the date picker and the repeat picker
// save as you edit), and opts.close also closes the edit form.

// The demo site (demo/) has no server: after setBackend(fn), api() hands every call to fn(method, path, body); see demo/backend.js
let backend = null;
export const setBackend = (fn) => { backend = fn; };

export async function api(method, path, body) {
  if (backend) return backend(method, path, body);
  const r = await fetch(path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  // The server requires a password: if not logged in (or the login has expired), go to the login page and come back afterwards
  if (r.status === 401) {
    location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
    throw new Error("要先登录");
  }
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

const enc = encodeURIComponent;

export function actions(send) {
  // Three operations shared by items, cards and sections: edit, delete (force: delete even if it still has contents), move up/down
  const node = (base) => ({
    patch: (body, msg, opts) => send("PATCH", base, body, msg, opts),
    remove: ({ force, ...opts } = {}) => send("DELETE", base, force ? { force: true } : null, "删掉了", opts),
    move: (dir) => send("POST", `${base}/move`, { dir }),
  });
  return {
    item: (id) => {
      const base = `/api/items/${enc(id)}`;
      return {
        ...node(base),
        // Moves only among the open items: closed ones sit below, sorted by when they were closed, so moving them makes no sense
        move: (dir) => send("POST", `${base}/move`, { dir, within: "open" }),
        // Check in a recurring item for a given day (done: false undoes the check-in)
        check: (date, done = true, msg) => send("POST", `${base}/check`, { date, done }, msg),
      };
    },
    group: (id) => node(`/api/groups/${enc(id)}`),
    section: (id) => node(`/api/sections/${enc(id)}`),
    addItem: (body) => send("POST", "/api/items", body),
    addGroup: (body) => send("POST", "/api/groups", body),
    addSection: (body) => send("POST", "/api/sections", body),
    theme: (patch, msg) => send("PATCH", "/api/theme", patch, msg),
    settings: (patch) => send("PATCH", "/api/settings", patch),
    extras: (patch, opts) => send("PATCH", "/api/extras", patch, null, opts),
    places: {
      add: (name) => send("POST", "/api/places", { name }),
      rename: (from, to) => send("PATCH", "/api/places", { from, to }),
      remove: (name) => send("DELETE", "/api/places", { name }),
    },
  };
}
