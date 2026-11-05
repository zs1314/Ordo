// Storage: the board, its log and the state of the Canvas sync, in one SQLite file in the data directory (TODO_DIR, default
// ./data): todo.db, through Node's built-in node:sqlite. The business rules never see the database: they change a plain
// document (see doc.mjs), and this file maps the document to tables and back. Every change goes through mutate(): in one
// transaction it reads the board, lets fn change the document, and writes back only the rows that changed, with the log entries
// fn returns. data.mjs exports and imports the board on the command line.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nowIso } from "./doc.mjs";
import { normalize } from "./schema.mjs";

export const dataDir = () => process.env.TODO_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "data");

// The schema, versioned with PRAGMA user_version: step n takes a database from version n to n + 1, so a change to the schema is
// a step added at the end. The document calls cards groups (item.group, group.section) and positions order; check_ins holds
// item.doneDates; meta holds rev, updatedAt, and as JSON theme, settings, extras and the Canvas sync state (canvasSync).
const MIGRATIONS = [`
  CREATE TABLE sections (id TEXT PRIMARY KEY, title TEXT NOT NULL, sub TEXT, note TEXT, hidden INTEGER, position REAL NOT NULL);
  CREATE TABLE cards (id TEXT PRIMARY KEY, section_id TEXT NOT NULL REFERENCES sections(id), title TEXT NOT NULL, note TEXT,
    plain INTEGER, position REAL NOT NULL);
  CREATE TABLE items (id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id), title TEXT NOT NULL, note TEXT,
    status TEXT NOT NULL CHECK (status IN ('todo', 'doing', 'agent', 'waiting', 'done', 'dropped')), position REAL NOT NULL,
    created_at TEXT, updated_at TEXT, done_at TEXT, due TEXT, reason TEXT, waiting_on TEXT,
    repeat_days TEXT, repeat_time TEXT, -- repeat_days: a JSON array of weekdays
    agent_where TEXT, agent_note TEXT, agent_since TEXT, agent_last_seen TEXT,
    source TEXT); -- JSON: where a synced item came from (canvas/merge.mjs)
  CREATE TABLE check_ins (item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE, day TEXT NOT NULL, PRIMARY KEY (item_id, day));
  CREATE TABLE places (name TEXT PRIMARY KEY, last_used TEXT, uses INTEGER NOT NULL, added_at TEXT);
  CREATE TABLE log (id INTEGER PRIMARY KEY, ts TEXT NOT NULL, actor TEXT NOT NULL, op TEXT NOT NULL, entry TEXT NOT NULL); -- entry: JSON of the rest
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); -- value: JSON
  CREATE INDEX cards_by_section ON cards (section_id);
  CREATE INDEX items_by_card ON items (card_id);
`, `
  ALTER TABLE items ADD COLUMN priority INTEGER;
  ALTER TABLE items ADD COLUMN tags TEXT;
  ALTER TABLE items ADD COLUMN subtasks TEXT;
`];

// ---- The document and its rows ----

// The tables that hold the document, parents before children (rows are inserted in this order and deleted in reverse, as the
// foreign keys require), each with the columns of its primary key; meta holds the document's DOC_META keys among others
const KEYS = { sections: ["id"], cards: ["id"], items: ["id"], check_ins: ["item_id", "day"], places: ["name"], meta: ["key"] };
const DOC_META = ["rev", "updatedAt", "theme", "settings", "extras"];
const NONE = Object.fromEntries(Object.keys(KEYS).map((t) => [t, []]));

// An optional field is a NULL column when the object does not have it, and is left out of the object when read back
const bit = (b) => (b == null ? null : b ? 1 : 0);
const flag = (n) => (n === null ? null : !!n);
const json = (v) => (v == null ? null : JSON.stringify(v));
const row = (r) => { for (const k in r) r[k] ??= null; return r; };
const present = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null));

/** A normalized document → its rows, table by table */
function rowsOf(doc) {
  return {
    sections: doc.sections.map((s) => row({ id: s.id, title: s.title, sub: s.sub, note: s.note, hidden: bit(s.hidden), position: s.order })),
    cards: doc.groups.map((g) => row({ id: g.id, section_id: g.section, title: g.title, note: g.note, plain: bit(g.plain), position: g.order })),
    items: doc.items.map((i) => row({
      id: i.id, card_id: i.group, title: i.title, note: i.note, status: i.status, position: i.order,
      created_at: i.createdAt, updated_at: i.updatedAt, done_at: i.doneAt, due: i.due, reason: i.reason, waiting_on: i.waitingOn,
      repeat_days: json(i.repeat?.days), repeat_time: i.repeat?.time,
      agent_where: i.agent?.where, agent_note: i.agent?.note, agent_since: i.agent?.since, agent_last_seen: i.agent?.lastSeen,
      source: json(i.source), priority: i.priority, tags: json(i.tags), subtasks: json(i.subtasks),
    })),
    check_ins: doc.items.flatMap((i) => (i.doneDates ?? []).map((day) => ({ item_id: i.id, day }))),
    places: doc.places.map((p) => row({ name: p.name, last_used: p.lastUsed, uses: p.uses, added_at: p.addedAt })),
    meta: DOC_META.map((key) => ({ key, value: JSON.stringify(doc[key]) })),
  };
}

/** Rows → the normalized document. An item has agent when any agent column is set, repeat when repeat_days is set, doneDates
 *  when it has check-ins; a place always has lastUsed and uses */
function docOf(rows) {
  const meta = Object.fromEntries(rows.meta.map((r) => [r.key, JSON.parse(r.value)]));
  const days = Map.groupBy(rows.check_ins, (r) => r.item_id);
  return normalize({
    version: 2, rev: meta.rev, updatedAt: meta.updatedAt,
    sections: rows.sections.map((r) => present({ id: r.id, title: r.title, sub: r.sub, note: r.note, hidden: flag(r.hidden), order: r.position })),
    groups: rows.cards.map((r) => present({ id: r.id, section: r.section_id, title: r.title, note: r.note, plain: flag(r.plain), order: r.position })),
    items: rows.items.map((r) => {
      const agent = present({ where: r.agent_where, note: r.agent_note, since: r.agent_since, lastSeen: r.agent_last_seen });
      return present({
        id: r.id, group: r.card_id, title: r.title, status: r.status, note: r.note, order: r.position,
        createdAt: r.created_at, updatedAt: r.updated_at, doneAt: r.done_at, due: r.due, reason: r.reason, waitingOn: r.waiting_on,
        repeat: r.repeat_days && present({ days: JSON.parse(r.repeat_days), time: r.repeat_time }),
        agent: Object.keys(agent).length ? agent : null,
        doneDates: days.get(r.id)?.map((c) => c.day),
        source: r.source && JSON.parse(r.source), priority: r.priority,
        tags: r.tags && JSON.parse(r.tags), subtasks: r.subtasks && JSON.parse(r.subtasks),
      });
    }),
    places: rows.places.map((r) => ({ name: r.name, lastUsed: r.last_used, uses: r.uses, ...present({ addedAt: r.added_at }) })),
    extras: meta.extras, theme: meta.theme, settings: meta.settings,
  });
}

// ---- The store: one connection per process and data directory ----

const stores = new Map();

/** The store of a data directory: the functions below, over one connection that the first call for that directory opens (later
 *  calls get the same store, until close) */
export function openStore(dir = dataDir()) {
  const path = resolve(dir);
  if (stores.has(path)) return stores.get(path);
  mkdirSync(path, { recursive: true });
  const db = new DatabaseSync(join(path, "todo.db"));
  db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON");
  // Switching a new database to WAL fails at once, without waiting, while another process is switching it at the same moment;
  // then wait a little and try again (by then it is in WAL mode, and switching does nothing)
  for (let waited = 0; ; waited += 20) {
    try { db.exec("PRAGMA journal_mode = WAL"); break; } catch (err) {
      if (err.errcode !== 5 || waited >= 5000) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  const cache = new Map(), sql = (text) => cache.get(text) ?? cache.set(text, db.prepare(text)).get(text);

  // BEGIN IMMEDIATE takes the write lock at the start: another process waits for it (busy_timeout) rather than failing halfway.
  // fn may end the transaction itself with ROLLBACK
  function transaction(fn) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      if (db.isTransaction) db.exec("COMMIT");
      return result;
    } catch (err) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw err;
    }
  }
  const version = () => db.prepare("PRAGMA user_version").get().user_version;
  if (version() < MIGRATIONS.length) transaction(() => {
    for (let v = version(); v < MIGRATIONS.length; v++) db.exec(`${MIGRATIONS[v]}; PRAGMA user_version = ${v + 1}`);
  });

  // The rows of the document, in the order they were added (rowid), which is the order of the document's arrays
  const readRows = () => ({
    sections: sql("SELECT * FROM sections ORDER BY rowid").all(),
    cards: sql("SELECT * FROM cards ORDER BY rowid").all(),
    items: sql("SELECT * FROM items ORDER BY rowid").all(),
    check_ins: sql("SELECT * FROM check_ins ORDER BY day").all(),
    places: sql("SELECT * FROM places ORDER BY rowid").all(),
    meta: sql(`SELECT * FROM meta WHERE key IN (${DOC_META.map(() => "?").join(", ")})`).all(...DOC_META),
  });

  /** Writes what differs between the rows in the database and the rows wanted */
  function write(before, after) {
    const id = (t, r) => JSON.stringify(KEYS[t].map((k) => r[k]));
    const where = (t) => KEYS[t].map((k) => `${k} = ?`).join(" AND ");
    for (const t of Object.keys(KEYS)) {
      const old = new Map(before[t].map((r) => [id(t, r), r]));
      for (const r of after[t]) {
        const cols = Object.keys(r), was = old.get(id(t, r));
        if (!was) sql(`INSERT INTO ${t} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...Object.values(r));
        else if (cols.some((c) => r[c] !== was[c])) {
          const set = cols.filter((c) => !KEYS[t].includes(c));
          sql(`UPDATE ${t} SET ${set.map((c) => `${c} = ?`).join(", ")} WHERE ${where(t)}`).run(...set.map((c) => r[c]), ...KEYS[t].map((k) => r[k]));
        }
      }
    }
    for (const t of Object.keys(KEYS).reverse()) {
      const kept = new Set(after[t].map((r) => id(t, r)));
      for (const r of before[t]) if (!kept.has(id(t, r))) sql(`DELETE FROM ${t} WHERE ${where(t)}`).run(...KEYS[t].map((k) => r[k]));
    }
  }
  const addLog = (ts, actor, op, rest) => sql("INSERT INTO log (ts, actor, op, entry) VALUES (?, ?, ?, ?)").run(ts, actor, op, JSON.stringify(rest));

  /** The normalized document; an empty board (rev 0) when the database is new */
  function load() {
    db.exec("BEGIN"); // one snapshot of all the tables
    try { return docOf(readRows()); } finally { db.exec("COMMIT"); }
  }

  /** Reads the latest board and lets fn change it. fn returns the log entries (one, several, or null when nothing changed); they
   *  are written with the rows that changed, in one transaction. fn must be synchronous: a transaction cannot stay open across an
   *  await, since everything in the process shares this connection */
  function mutate(fn, actor = "unknown") {
    return transaction(() => {
      const before = readRows(), doc = docOf(before);
      const out = fn(doc);
      if (out instanceof Promise) throw new Error("mutate: fn returned a promise; it must change the document synchronously");
      const logs = [out].flat().filter(Boolean);
      if (!logs.length) { db.exec("ROLLBACK"); return docOf(before); } // nothing changed: nothing is written, and rev stays the same
      doc.rev += 1;
      doc.updatedAt = nowIso();
      const after = rowsOf(normalize(doc));
      write(before, after);
      for (const { op, ...rest } of logs) addLog(doc.updatedAt, actor, op, rest);
      return docOf(after);
    });
  }

  /** Replaces the whole board, and the log too if one is given (entries as readLog returns them); for data.mjs import */
  function replaceAll(doc, { log } = {}) {
    transaction(() => {
      write(readRows(), NONE);
      write(NONE, rowsOf(normalize(structuredClone(doc))));
      if (log) {
        sql("DELETE FROM log").run();
        for (const { ts, actor, op, ...rest } of log) addLog(ts, actor, op, rest);
      }
    });
  }

  /** Every log entry, oldest first: { ts, actor, op, ... } */
  const readLog = () => sql("SELECT * FROM log ORDER BY id").all().map((r) => ({ ts: r.ts, actor: r.actor, op: r.op, ...JSON.parse(r.entry) }));

  // State kept next to the board that is not part of it (the Canvas sync's): reading or writing it does not touch rev
  const getMeta = (key) => { const r = sql("SELECT value FROM meta WHERE key = ?").get(key); return r && JSON.parse(r.value); };
  const setMeta = (key, value) => { sql("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(key, JSON.stringify(value)); };

  function close() {
    stores.delete(path);
    db.close();
  }

  const store = { load, mutate, replaceAll, readLog, getMeta, setMeta, close };
  stores.set(path, store);
  return store;
}

// The same functions for the data directory in TODO_DIR (what the server, Canvas sync and data.mjs use)
const store = () => openStore(dataDir());
export const load = () => store().load();
export const mutate = (fn, actor) => store().mutate(fn, actor);
export const replaceAll = (doc, opts) => store().replaceAll(doc, opts);
export const readLog = () => store().readLog();
export const getMeta = (key) => store().getMeta(key);
export const setMeta = (key, value) => store().setMeta(key, value);
