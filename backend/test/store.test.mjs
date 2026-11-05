// Tests for the storage (core/store.mjs) and its command line (data.mjs): documents come back from the database as they went
// in, export and import, two processes changing the board at once, and changes that are refused.
//   node --test test/*.test.mjs
// Uses only temporary directories, never real data.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { openStore } from "../core/store.mjs";
import { normalize, emptyDoc } from "../core/schema.mjs";
import { checkDate } from "../core/items.mjs";
import { toMarkdown } from "../core/report.mjs";
import { sampleDoc } from "../demo/sample.js";

const STORE = new URL("../core/store.mjs", import.meta.url).href, DATA = fileURLToPath(new URL("../data.mjs", import.meta.url));
const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), "axi-todo-store-")); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
/** Saves doc in a new database and reads it back */
const roundTrip = (doc) => {
  const s = openStore(tmp());
  s.replaceAll(doc);
  const back = s.load();
  s.close();
  return back;
};
const same = (doc) => normalize(structuredClone(doc));

const T = (h) => `2026-10-20T${String(h).padStart(2, "0")}:00:00.000Z`;
// Every optional field, present and absent; items not in the order of their cards, and two cards with the same order
const FULL = {
  version: 2, rev: 7, updatedAt: T(9),
  sections: [
    { id: "s2", title: "Hidden", sub: "under the title", order: 20, hidden: true },
    { id: "s1", title: "Work", sub: "", note: "a note", order: 10, hidden: false },
  ],
  groups: [
    { id: "g1", section: "s1", title: "Work", note: "", order: 10, plain: true },
    { id: "g4", section: "s1", title: "Tie", note: "", order: 20 },
    { id: "g2", section: "s1", title: "Second", note: "a card note", order: 20 },
    { id: "g3", section: "s2", title: "No note", order: 12.5 },
  ],
  items: [
    { id: "g", group: "g3", title: "from Canvas", status: "done", note: "", order: -5, createdAt: T(1), updatedAt: T(4), due: "2026-10-28 23:59", doneAt: T(4),
      source: { type: "canvas", key: "canvas:canvas.example.com:assignment:7", id: 7, courseId: 3, course: "Course", url: "https://canvas.example.com/courses/3/assignments/7",
        title: "Course · Homework", state: "submitted", due: "2026-10-28 23:59" } },
    { id: "a", group: "g1", title: "every agent field", status: "agent", note: "", order: 10, createdAt: T(1), updatedAt: T(2), agent: { where: "lab", note: "running", since: T(1), lastSeen: T(2) } },
    { id: "d", group: "g2", title: "weekdays at noon", status: "todo", order: 10, repeat: { days: [1, 2, 3, 4, 5], time: "12:00" }, doneDates: ["2026-10-16", "2026-10-19", "2026-10-20"] },
    { id: "b", group: "g1", title: "only where, and that is empty", status: "agent", order: 15.25, agent: { where: "" } },
    { id: "e", group: "g2", title: "repeat without a time", status: "todo", order: 20, repeat: { days: [1, 3, 5] } },
    { id: "c", group: "g1", title: "an agent note left from before", status: "doing", order: 20, agent: { note: "old", lastSeen: T(3) } },
    { id: "f", group: "g2", title: "repeat with an empty time", status: "todo", order: 30, repeat: { days: [0, 6], time: "" }, doneDates: ["2026-10-18"] },
    { id: "h", group: "g3", title: "waiting", status: "waiting", order: 0.001, waitingOn: "a reply", due: "2026-11-01 23:59 AoE" },
    { id: "i", group: "g4", title: "dropped", status: "dropped", order: 40, reason: "not needed" },
  ],
  places: [
    { name: "lab", lastUsed: T(2), uses: 3 },
    { name: "home", lastUsed: null, uses: 0, addedAt: T(5) },
    { name: "never used", lastUsed: null, uses: 0 },
  ],
  extras: { yearGoalsTitle: "This year", yearGoals: ["one", "two"], canvasDismissed: ["canvas:canvas.example.com:assignment:9"] },
  theme: { mode: "dark", customCss: "body { letter-spacing: .1px }" },
  settings: { staleHours: 6, canvasGroup: "g3" },
};

test("a new database loads as an empty board", () => {
  const s = openStore(tmp());
  const d = s.load();
  assert.equal(d.rev, 0);
  assert.deepEqual({ ...d, updatedAt: "" }, { ...emptyDoc(), updatedAt: "" });
  assert.deepEqual(s.readLog(), []);
  s.close();
});

test("the sample board comes back from the database unchanged", () => {
  const doc = sampleDoc();
  assert.deepEqual(roundTrip(doc), same(doc));
});

test("every optional field comes back as it was: absent stays absent, partial agents, repeats with and without a time, check-ins, Canvas source", () => {
  const back = roundTrip(FULL);
  assert.deepEqual(back, same(FULL));
  const it = (id) => back.items.find((i) => i.id === id);
  assert.deepEqual(it("b").agent, { where: "" });
  assert.equal("time" in it("e").repeat, false);
  assert.equal("note" in it("e"), false);
  assert.deepEqual(back.groups.map((g) => g.id), ["g1", "g4", "g2", "g3"], "cards with the same order keep theirs");
});

test("normalize writes the details the database keeps one way in that way: no empty agent or check-in list, places always have lastUsed and uses", () => {
  const doc = { rev: 1, updatedAt: T(1), sections: [{ id: "s", title: "S" }], groups: [{ id: "g", section: "s", title: "G" }],
    items: [{ id: "a", group: "g", title: "a", status: "todo", agent: {}, doneDates: [] }], places: [{ name: "p" }] };
  const n = same(doc);
  assert.equal("agent" in n.items[0], false);
  assert.equal("doneDates" in n.items[0], false);
  assert.deepEqual(n.places, [{ name: "p", lastUsed: null, uses: 0 }]);
  assert.deepEqual(roundTrip(doc), n);
});

test("a change writes only the rows it changed; state kept next to the board (getMeta / setMeta) does not touch rev and stays", () => {
  const dir = tmp(), s = openStore(dir);
  s.replaceAll(FULL);
  // count the writes, with triggers added on a connection of their own; rev and updatedAt change with every change (updatedAt
  // not within the same millisecond), so they are left out of the count
  const raw = new DatabaseSync(join(dir, "todo.db"));
  raw.exec("CREATE TABLE writes (what TEXT)");
  for (const t of ["sections", "cards", "items", "check_ins", "places", "meta"]) for (const op of ["INSERT", "UPDATE", "DELETE"]) {
    const when = t === "meta" ? `WHEN ${op === "DELETE" ? "OLD" : "NEW"}.key NOT IN ('rev', 'updatedAt')` : "";
    raw.exec(`CREATE TRIGGER count_${op}_${t} AFTER ${op} ON ${t} ${when} BEGIN INSERT INTO writes VALUES ('${op} ${t}'); END`);
  }
  const writes = () => raw.prepare("DELETE FROM writes RETURNING what").all().map((r) => r.what).sort();
  const change = (fn) => s.mutate((d) => (fn(d), { op: "test" }));
  change((d) => { d.items.find((i) => i.id === "a").note = "changed"; });
  assert.deepEqual(writes(), ["UPDATE items"]);
  change((d) => checkDate(d.items.find((i) => i.id === "e"), "2026-10-21"));
  assert.deepEqual(writes(), ["INSERT check_ins", "UPDATE items"]);
  change((d) => { d.items = d.items.filter((i) => i.id !== "d"); });
  assert.deepEqual(writes(), ["DELETE check_ins", "DELETE check_ins", "DELETE check_ins", "DELETE items"]);
  change((d) => { d.theme.mode = "light"; });
  assert.deepEqual(writes(), ["UPDATE meta"]);
  raw.close();
  assert.equal(s.load().rev, FULL.rev + 4);

  const rev = s.load().rev;
  s.setMeta("canvasSync", { ok: true, result: { added: 1 } });
  assert.equal(s.load().rev, rev);
  change((d) => { d.theme.mode = "auto"; });
  s.replaceAll(FULL);
  assert.deepEqual(s.getMeta("canvasSync"), { ok: true, result: { added: 1 } }, "kept through changes and imports");
  assert.equal(s.getMeta("nothing"), undefined);
  s.close();
});

test("a refused change leaves the database as it was, also when the database refuses it after rows were written", () => {
  const s = openStore(tmp());
  s.replaceAll(FULL, { log: [{ ts: T(1), actor: "board", op: "add", id: "a" }] });
  const before = s.load(), log = s.readLog();
  assert.throws(() => s.mutate((d) => { d.items[0].title = "changed"; d.items.pop(); throw new Error("refused"); }), /refused/);
  assert.throws(() => s.mutate((d) => {
    d.items[0].title = "changed";
    d.items.push({ id: "x", group: "no such card", title: "x", status: "todo" });
    return { op: "add", id: "x" };
  }), /FOREIGN KEY/);
  assert.throws(() => s.mutate((d) => { d.items[0].status = "maybe"; return { op: "update" }; }), /CHECK/);
  assert.deepEqual(s.load(), before);
  assert.deepEqual(s.readLog(), log);
  s.close();
});

test("an async fn is refused before anything is written, and no transaction is left open", () => {
  const s = openStore(tmp());
  s.replaceAll(FULL);
  assert.throws(() => s.mutate(async (d) => { d.items = []; return { op: "clear" }; }), /synchronous/);
  assert.equal(s.load().items.length, FULL.items.length);
  assert.equal(s.mutate((d) => { d.items[0].note = "after"; return { op: "update" }; }).rev, FULL.rev + 1);
  s.close();
});

test("two processes changing the board at once: rev goes up by 40 and nothing is lost", async () => {
  const dir = tmp(), s = openStore(dir);
  s.replaceAll({ sections: [{ id: "s", title: "S" }], groups: [{ id: "g", section: "s", title: "G" }], items: [] });
  // Both start at the same moment, hold each transaction for 3 ms and pause 2 ms between changes, so they take turns
  const start = Date.now() + 300;
  const child = (name) => new Promise((resolve, reject) => {
    const code = `import { openStore } from ${JSON.stringify(STORE)};
      const s = openStore(${JSON.stringify(dir)}), pause = new Int32Array(new SharedArrayBuffer(4));
      while (Date.now() < ${start});
      for (let k = 0; k < 20; k++) {
        s.mutate((d) => {
          d.items.push({ id: "${name}" + k, group: "g", title: "${name} " + k, status: "todo" });
          Atomics.wait(pause, 0, 0, 3);
          return { op: "add", id: "${name}" + k };
        }, "${name}");
        Atomics.wait(pause, 0, 0, 2);
      }`;
    const p = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (c) => (err += c));
    p.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(err))));
  });
  await Promise.all([child("a"), child("b")]);
  const d = s.load();
  assert.equal(d.rev, 40);
  assert.deepEqual(d.items.map((i) => i.id).sort(), [..."ab"].flatMap((n) => Array.from({ length: 20 }, (_, k) => n + k)).sort());
  assert.deepEqual(s.readLog().map((l) => l.op), Array(40).fill("add"));
  s.close();
});

test("data.mjs: export, import with the log, Markdown and the log; import does not overwrite a board with items unless --replace", () => {
  const dir = tmp(), src = tmp();
  const cli = (...args) => spawnSync(process.execPath, [DATA, ...args], { env: { ...process.env, TODO_DIR: dir }, encoding: "utf8" });
  const doc = sampleDoc(), file = join(src, "todo.json"), logFile = join(src, "todo-log.jsonl");
  const log = [
    { ts: T(1), actor: "board", op: "add", id: "t01", title: "x", group: "g-paper", status: "todo" },
    { ts: T(2), actor: "pi", op: "update", id: "t01", title: "x", changes: { status: ["todo", "agent"], due: [null, "2026-10-28"] } },
    { ts: T(3), actor: "canvas-sync", op: "settings", keys: ["canvasGroup"] },
  ];
  const logText = log.map((l) => JSON.stringify(l) + "\n").join("");
  writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
  writeFileSync(logFile, logText);
  let r = cli("import", file, "--log", logFile);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(cli("export").stdout), same(doc));
  assert.equal(cli("log").stdout, logText, "the log comes back line by line");
  assert.equal(cli("markdown").stdout, toMarkdown(same(doc)));

  const other = join(src, "other.json");
  writeFileSync(other, JSON.stringify(FULL));
  r = cli("import", other);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--replace/);
  assert.deepEqual(JSON.parse(cli("export").stdout), same(doc), "the board is left as it was");
  r = cli("import", other, "--replace");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(cli("export").stdout), same(FULL));
  assert.equal(cli("log").stdout, logText, "without --log the log stays as it was");
  assert.equal(cli("nonsense").status, 2);
});
