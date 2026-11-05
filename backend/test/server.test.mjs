// API tests for the board server: node --test test/*.test.mjs
// Starts a server in a temporary directory (on any free port), never touches real data, and stops it afterwards.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.mjs";

let srv;
const req = async (method, path, body, raw) => {
  const r = await fetch(srv.base + path, { method, headers: { "content-type": "application/json" }, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  return { status: r.status, body: await r.json() };
};
const logLines = () => srv.log().length;

before(async () => {
  srv = await startServer({ data: {
    sections: [{ id: "s", title: "工作", order: 10 }],
    groups: [{ id: "g1", section: "s", title: "一号线", order: 10 }, { id: "g2", section: "s", title: "二号线", order: 20 }],
    items: [
      { id: "a", group: "g1", title: "甲", status: "todo", order: 10 },
      { id: "b", group: "g1", title: "乙", status: "done", order: 20, doneAt: "2026-10-20T04:00:00.000Z" },
      { id: "c", group: "g1", title: "丙", status: "todo", order: 30 },
    ],
  } });
});
after(() => srv?.stop());

test("add an item: it goes last in its card; the agent's place is recorded in the places", async () => {
  const { status, body } = await req("POST", "/api/items", { group: "二号", title: "新的", status: "agent", agent: { where: "lab" } });
  assert.equal(status, 200);
  const it = body.items.find((i) => i.title === "新的");
  assert.equal(it.group, "g2");
  assert.equal(it.status, "agent");
  assert.equal(it.order, 10);
  assert.equal(body.places.find((p) => p.name === "lab").uses, 1);
});

test("move to another card: a title fragment works; never moves to a card that does not exist", async () => {
  const { body } = await req("PATCH", "/api/items/a", { group: "一号" }); // already in that card (g1): nothing changes
  assert.equal(body.items.find((i) => i.id === "a").group, "g1");
  const r = await req("PATCH", "/api/items/a", { group: "二号" });
  const a = r.body.items.find((i) => i.id === "a");
  assert.equal(a.group, "g2");
  assert.ok(a.order > 10, "placed last in that card");
  assert.equal((await req("PATCH", "/api/items/a", { group: "没有这个" })).status, 400);
  await req("PATCH", "/api/items/a", { group: "g1" });
});

test("move up / down: with within=open, hidden done items are skipped", async () => {
  const { body } = await req("POST", "/api/items/c/move", { dir: "up", within: "open" });
  const order = body.items.filter((i) => i.group === "g1").sort((x, y) => x.order - y.order).map((i) => i.id);
  assert.deepEqual(order.filter((id) => id !== "b"), ["c", "a"], "c and a swapped places");
  assert.equal((await req("POST", "/api/items/c/move", { dir: "sideways" })).status, 400);
});

test("bad input returns 400: malformed JSON, unknown status, empty title", async () => {
  assert.equal((await req("PATCH", "/api/items/c", null, "{oops")).status, 400);
  assert.equal((await req("PATCH", "/api/items/c", { status: "maybe" })).status, 400);
  assert.equal((await req("PATCH", "/api/items/c", { title: "  " })).status, 400);
  assert.equal((await req("PATCH", "/api/groups/g1", { title: "" })).status, 400);
  assert.equal((await req("PATCH", "/api/sections/s", { title: "" })).status, 400);
  assert.equal((await req("PATCH", "/api/items/nope", { title: "x" })).status, 404);
});

test("an unchanged theme is neither written to disk nor logged", async () => {
  const r1 = await req("PATCH", "/api/theme", { agentCols: 3 });
  const n = logLines(), rev = r1.body.rev;
  const r2 = await req("PATCH", "/api/theme", { agentCols: 3 });
  assert.equal(r2.body.rev, rev);
  assert.equal(logLines(), n);
});

test("making a done item recurring: it is back to todo, and the day it was done becomes a check-in", async () => {
  const { body } = await req("PATCH", "/api/items/b", { repeat: "daily" });
  const b = body.items.find((i) => i.id === "b");
  assert.equal(b.status, "todo");
  assert.deepEqual(b.doneDates, ["2026-10-20"]);
  assert.equal("doneAt" in b, false);
});

test("due date with only month and day: saved with the year filled in", async () => {
  const { body } = await req("PATCH", "/api/items/c", { due: "12-31 18:00" });
  assert.match(body.items.find((i) => i.id === "c").due, /^\d{4}-12-31 18:00$/);
});

test("places: add, rename (items are updated too), delete", async () => {
  let r = await req("POST", "/api/places", { name: "home" });
  const p = r.body.places.find((x) => x.name === "home");
  assert.equal(p.lastUsed, null, "not used yet");
  assert.ok(p.addedAt);
  r = await req("PATCH", "/api/places", { from: "lab", to: "实验室" });
  assert.ok(r.body.items.some((i) => i.agent?.where === "实验室"));
  r = await req("DELETE", "/api/places", { name: "home" });
  assert.equal(r.body.places.some((x) => x.name === "home"), false);
});
