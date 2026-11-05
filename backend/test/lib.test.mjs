// Behaviour tests for the data layer (lib.mjs; the code lives in core/): node --test test/*.test.mjs
// Uses only a temporary directory, never real data (TODO_DIR is set before lib.mjs is imported).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DIR = mkdtempSync(join(tmpdir(), "axi-todo-test-"));
process.env.TODO_DIR = DIR;
const L = await import("../lib.mjs");

const at = (s) => new Date(s); // local time, e.g. "2026-10-23T11:00"
const weekdays = (time = "") => ({ days: [1, 2, 3, 4, 5], time });
const daily = (time = "") => ({ days: [0, 1, 2, 3, 4, 5, 6], time });
const docWith = (items = [], extra = {}) => L.normalize({ sections: [{ id: "s", title: "S" }], groups: [{ id: "g", section: "s", title: "G" }], items, ...extra });

test("normalizeRepeat accepts several notations", () => {
  assert.deepEqual(L.normalizeRepeat("weekdays").days, [1, 2, 3, 4, 5]);
  assert.equal(L.normalizeRepeat("daily").days.length, 7);
  assert.deepEqual([...L.normalizeRepeat("1,3,5").days].sort(), [1, 3, 5]);
  assert.deepEqual([...L.normalizeRepeat("一三五").days].sort(), [1, 3, 5]);
  assert.equal(L.normalizeRepeat("none"), null);
  assert.throws(() => L.normalizeRepeat("sometimes"));
});

test("recurring item: with no time set it refreshes at midnight", () => {
  const it = { repeat: daily(), doneDates: ["2026-10-22"] };
  const st = L.repeatState(it, at("2026-10-23T01:00"));
  assert.equal(st.key, "2026-10-23");
  assert.equal(st.done, false);
  assert.equal(st.streak, 1, "due today but not done yet: the streak is not broken");
});

test("recurring item: with 12:00 set it refreshes at noon; before that it still counts as the previous day", () => {
  const it = { repeat: weekdays("12:00"), doneDates: ["2026-10-22"] }; // 2026-10-22 is a Thursday
  assert.deepEqual(pick(L.repeatState(it, at("2026-10-23T11:59"))), { key: "2026-10-22", scheduled: true, done: true });
  assert.deepEqual(pick(L.repeatState(it, at("2026-10-23T12:00"))), { key: "2026-10-23", scheduled: true, done: false });
  // after noon on Saturday it is the weekend: not scheduled
  assert.deepEqual(pick(L.repeatState(it, at("2026-10-24T12:30"))), { key: "2026-10-24", scheduled: false, done: false });
  // Monday morning still counts as Sunday (not scheduled); Monday starts at noon
  assert.equal(L.repeatState(it, at("2026-10-26T11:00")).scheduled, false);
  assert.equal(L.repeatState(it, at("2026-10-26T12:01")).key, "2026-10-26");
});
const pick = ({ key, scheduled, done }) => ({ key, scheduled, done });

test("the streak skips days that are not scheduled", () => {
  const it = { repeat: weekdays(), doneDates: ["2026-10-16", "2026-10-19", "2026-10-20"] }; // Friday, Monday, Tuesday
  assert.equal(L.repeatState(it, at("2026-10-20T20:00")).streak, 3);
});

test("agentActive: a recurring item that is done today or not scheduled today does not count as running", () => {
  const base = { status: "agent", agent: { where: "w" } };
  assert.equal(L.agentActive(base), true);
  assert.equal(L.agentActive({ ...base, repeat: daily(), doneDates: [L.ymd(new Date())] }), false);
  assert.equal(L.agentActive({ ...base, status: "todo" }), false);
  const rest = [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== new Date().getDay());
  assert.equal(L.agentActive({ ...base, repeat: { days: rest, time: "" } }), false);
});

test("applyPatch: setting a recurring item to done only records today's check-in", () => {
  const it = { id: "a", title: "PR", status: "agent", agent: { where: "w" }, repeat: daily(), doneDates: [] };
  const ch = L.applyPatch(it, { status: "done" });
  assert.equal(it.status, "agent");
  assert.deepEqual(it.doneDates, [L.ymd(new Date())]);
  assert.deepEqual(ch.check, [L.ymd(new Date()), true]);
});

test("applyPatch: an empty due date, reason or waiting-on removes the field", () => {
  const it = { id: "a", title: "t", status: "dropped", reason: "x", due: "10-25" };
  L.applyPatch(it, { reason: "", due: "" });
  assert.equal("reason" in it, false);
  assert.equal("due" in it, false);
});

test("applyPatch: handing off to an agent or changing where it runs counts as using a place; editing the title does not", () => {
  const doc = docWith([{ id: "a", group: "g", title: "t", status: "todo" }]);
  const it = doc.items[0];
  L.applyPatch(it, { status: "agent", agent: { where: "lab" } }, doc);
  assert.equal(doc.places.find((p) => p.name === "lab").uses, 1);
  L.applyPatch(it, { title: "t2", agent: { where: "lab", note: "" } }, doc);
  assert.equal(doc.places.find((p) => p.name === "lab").uses, 1, "same place: not counted");
  L.applyPatch(it, { agent: { where: "home" } }, doc);
  assert.equal(doc.places.find((p) => p.name === "home").uses, 1);
});

test("places: sorted by most recent use; renaming merges places and updates the old name in items", () => {
  const doc = docWith([
    { id: "a", group: "g", title: "a", status: "agent", agent: { where: "A", since: "2026-10-20T00:00:00Z" } },
    { id: "b", group: "g", title: "b", status: "agent", agent: { where: "B", since: "2026-10-21T00:00:00Z" } },
  ]);
  doc.places = [{ name: "A", lastUsed: "2026-10-20T00:00:00Z", uses: 1 }, { name: "B", lastUsed: "2026-10-21T00:00:00Z", uses: 1 }];
  assert.deepEqual(L.placesByRecency(doc).map((p) => p.name), ["B", "A"]);
  assert.ok(L.renamePlace(doc, "A", "B"));
  assert.deepEqual(doc.places.map((p) => [p.name, p.uses]), [["B", 2]]);
  assert.equal(doc.items[0].agent.where, "B");
  assert.equal(L.renamePlace(doc, "B", "B"), null);
});

test("normalize: a new section's built-in card shows its title once it has been renamed", () => {
  const doc = L.normalize({
    sections: [{ id: "s", title: "S" }, { id: "s2", title: "S2" }],
    groups: [{ id: "g", section: "s", title: "改过名的卡", plain: true }, { id: "g2", section: "s2", title: "S2", plain: true }],
    items: [],
  });
  assert.equal(doc.groups[0].plain, undefined);
  assert.equal(doc.groups[1].plain, true);
  assert.deepEqual(doc.places, []);
});

test("summary: the agent count includes only items running today, and the places are listed", () => {
  const doc = docWith([
    { id: "a", group: "g", title: "长任务", status: "agent", agent: { where: "lab", since: "2026-10-20T00:00:00Z", lastSeen: "2026-10-20T00:00:00Z" } },
    { id: "r", group: "g", title: "例行", status: "agent", agent: { where: "home" }, repeat: daily(), doneDates: [L.ymd(new Date())] },
  ]);
  doc.places = [{ name: "lab", lastUsed: "2026-10-20T00:00:00Z", uses: 3 }, { name: "home", lastUsed: null, uses: 1 }];
  const s = L.summary(doc);
  assert.match(s, /Agent 在做（1；另有 1 件/);
  assert.match(s, /常挂的地方.*：(lab|home)/);
});

test("mutate: writes to the database, bumps rev, logs, the Markdown copy shows the change; writes nothing when nothing changed", () => {
  L.replaceAll(L.emptyDoc());
  const d1 = L.mutate((d) => {
    d.sections.push({ id: "s", title: "S" });
    d.groups.push({ id: "g", section: "s", title: "S" });
    d.items.push({ id: "x", group: "g", title: "写进去", status: "todo" });
    return { op: "add", id: "x" };
  }, "test");
  assert.equal(d1.rev, 1);
  assert.equal(L.load().items[0].title, "写进去");
  assert.match(L.toMarkdown(L.load()), /写进去/);
  assert.deepEqual(L.readLog(), [{ ts: d1.updatedAt, actor: "test", op: "add", id: "x" }]);
  const d2 = L.mutate((d) => { d.items[0].title = "没写进去"; return null; }, "test");
  assert.equal(d2.rev, 1, "rev stays the same when nothing changed");
  assert.equal(L.load().items[0].title, "写进去", "nothing written when nothing changed");
  assert.equal(L.readLog().length, 1, "nothing logged when nothing changed");
});

test("due date: the date must exist; a month-day date gets the year filled in", async () => {
  const D = await import("../web/lib/due.js");
  assert.equal(D.parseDue("2026-02-31"), null);
  assert.equal(D.parseDue("2026-10-21 25:00"), null);
  assert.equal(D.parseDue("2026-10-21 23:59 AoE").aoe, true);
  assert.equal(L.fixDueYear("1-5", at("2026-12-20T10:00")), "2027-01-05", "1-5 written in December means next year");
  assert.equal(L.fixDueYear("10-25 18:00", at("2026-10-28T10:00")), "2026-10-25 18:00", "a few days ago is still this year");
  assert.equal(L.fixDueYear("待确认"), "待确认");
});

test('closed items: cards keep the last few days (by local date) and fold older ones away; dropped items appear only under "全部"', async () => {
  const D = await import("../web/lib/done.js");
  const now = at("2026-11-02T10:00");
  const iso = (s) => at(s).toISOString();
  const items = [
    { id: "o", status: "todo" },
    { id: "d0", status: "done", doneAt: iso("2026-11-02T08:00") },
    { id: "d2", status: "done", doneAt: iso("2026-10-31T00:30") }, // two days ago: within 3 days
    { id: "d3", status: "done", doneAt: iso("2026-10-30T23:00") }, // three days ago: not counted
    { id: "x", status: "dropped", updatedAt: iso("2026-11-02T09:00") },
  ];
  const s = D.splitClosed(items, { recentDays: 3 }, now);
  assert.deepEqual(s.recent.map((i) => i.id), ["d0", "d2"]);
  assert.deepEqual(s.older.map((i) => i.id), ["d3"]);
  assert.deepEqual(s.all.map((i) => i.id), ["x", "d0", "d2", "d3"], 'newest first; dropped items are under "全部" too');
  const v = (theme, opts = {}) => D.visibleClosed(items, theme, { now, ...opts }).map((i) => i.id);
  assert.deepEqual(v({ closedMode: "recent", recentDays: 1 }), ["d0"], "1 day means only today");
  assert.deepEqual(v({ closedMode: "recent", recentDays: 3 }, { expanded: true }), ["d0", "d2", "d3"], "once expanded, older done items are shown too, dropped ones are not");
  assert.deepEqual(v({ closedMode: "none" }), []);
  assert.equal(v({ closedMode: "all" }).length, 4);
  assert.equal(D.calendarShowsClosed({ status: "done" }, { closedMode: "recent" }), true);
  assert.equal(D.calendarShowsClosed({ status: "dropped" }, { closedMode: "recent" }), false);
  assert.deepEqual(Object.keys(D.doneByDay(items)).sort(), ["2026-10-30", "2026-10-31", "2026-11-02"], "grouped by day; dropped items are not counted");
});
