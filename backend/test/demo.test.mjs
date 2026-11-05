// Demo site (demo/): the generated sample data, the in-browser "server", the static build. The check that clicks through
// the UI is dev/test-demo.mjs.
//   node --test test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sampleDoc } from "../demo/sample.js";
import { localBackend } from "../demo/backend.js";
import { build, moduleGraph, importsOf } from "../demo/build.mjs";
import { normalize } from "../core/schema.mjs";
import { EDITS } from "../core/edits.mjs";
import { repeatState, agentActive } from "../web/lib/repeat.js";
import { ORDER } from "../web/lib/model.js";

// Several different "now"s: a weekday morning (before 12:00, when the sample's paper-reading item still counts as
// yesterday), a weekend evening, just after midnight, the end of a month
const NOWS = [new Date(2026, 10, 4, 9, 30), new Date(2026, 10, 8, 22, 15), new Date(2026, 11, 31, 0, 5), new Date(2027, 1, 28, 12, 0)];

test("sample data: the structure is consistent, and it looks in active use whenever it is opened", () => {
  for (const now of NOWS) {
    const doc = sampleDoc(now);
    const tag = now.toString();
    const same = JSON.stringify(normalize(structuredClone(doc)));
    assert.equal(same, JSON.stringify(normalize(structuredClone(JSON.parse(same)))), `unchanged by a second normalize: ${tag}`);
    const ids = doc.items.map((i) => i.id);
    assert.equal(new Set(ids).size, ids.length, "item ids are unique");
    const groups = new Set(doc.groups.map((g) => g.id)), sections = new Set(doc.sections.map((s) => s.id));
    assert.ok(doc.items.every((i) => groups.has(i.group)), "every item is in a card");
    assert.ok(doc.groups.every((g) => sections.has(g.section)), "every card is in a section");
    assert.ok(groups.has(doc.settings.canvasGroup), "the card for Canvas assignments exists");
    assert.deepEqual(new Set(doc.items.map((i) => i.status)), new Set(ORDER), "all six statuses occur");
    // Times: done and last-checked times are in the past; nothing is done in the future
    const t = now.getTime();
    for (const i of doc.items) {
      assert.ok(Date.parse(i.createdAt) <= t && Date.parse(i.updatedAt) <= t, `${i.title}: times are in the past: ${tag}`);
      if (i.doneAt) assert.ok(Date.parse(i.doneAt) <= t && Date.parse(i.doneAt) >= Date.parse(i.createdAt), `${i.title}: done time is valid: ${tag}`);
      if (i.agent) assert.ok(Date.parse(i.agent.lastSeen) <= t && Date.parse(i.agent.since) <= t, `${i.title}: handed-off and last-checked times are in the past`);
    }
    // Two items were done today (so a card that keeps only today still has something to show), and enough were done in the
    // last two weeks to draw the bars
    const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    assert.equal(doc.items.filter((i) => i.doneAt && Date.parse(i.doneAt) >= day0).length, 2, `two done today: ${tag}`);
    assert.ok(doc.items.filter((i) => i.doneAt && Date.parse(i.doneAt) >= day0 - 13 * 864e5).length >= 15, "at least 15 done in the last two weeks");
    // Recurring items: none is checked in yet for today (by its own refresh time), so visitors can click them; the earlier
    // check-ins include streaks
    const reps = doc.items.filter((i) => i.repeat);
    assert.equal(reps.length, 4);
    for (const i of reps) {
      const st = repeatState(i, now);
      assert.equal(st.done, false, `${i.title} not checked in yet today: ${tag}`);
      assert.ok(i.doneDates.every((d) => d < st.key), `${i.title}: all check-ins are before today`);
      assert.ok(i.doneDates.length >= 3, `${i.title} has check-ins`);
    }
    // Agent: the daily one is running today as well; one of the five cards has not been checked for more than 12 hours
    const agents = doc.items.filter((i) => agentActive(i, now));
    assert.equal(agents.length, 5, `five agent cards: ${tag}`);
    assert.equal(agents.filter((i) => t - Date.parse(i.agent.lastSeen) > doc.settings.staleHours * 3600e3).length, 1, "one has not been checked for a long time");
    assert.ok(doc.items.some((i) => i.due && i.status !== "done"), "some items have a due date");
  }
});

// TODO_PRIVATE_WORDS: a file with one word per line that must not appear in the sample data (real project names, addresses
// and the like). Keep the file outside the repository; without it the test is skipped
test("sample data: no private words", { skip: !process.env.TODO_PRIVATE_WORDS }, () => {
  const text = JSON.stringify(sampleDoc(NOWS[0]));
  const words = readFileSync(process.env.TODO_PRIVATE_WORDS, "utf8").split("\n").map((w) => w.trim()).filter((w) => w && !w.startsWith("#"));
  for (const w of words) assert.ok(!text.includes(w), `must not appear: ${w}`);
});

test('in-browser "server": applies changes like the server, changes nothing on error, and always hands out a fresh copy', async () => {
  const be = localBackend(sampleDoc(NOWS[0]), { syncMs: 0 });
  const d0 = await be("GET", "/api/todo");
  assert.ok(d0.demo, "marked as a demo");
  assert.equal(d0.rev, 1);
  d0.items[0].title = "在外面改了也不算";
  assert.notEqual((await be("GET", "/api/todo")).items[0].title, "在外面改了也不算", "what it hands out is a copy");

  const d1 = await be("PATCH", "/api/items/t01", { status: "done" });
  assert.equal(d1.rev, 2);
  assert.equal(d1.items.find((i) => i.id === "t01").status, "done");
  assert.ok(d1.items.find((i) => i.id === "t01").doneAt);

  await assert.rejects(be("PATCH", "/api/items/t02", { title: "  " }), /标题不能是空的/);
  await assert.rejects(be("DELETE", "/api/sections/s-research", null), /.+/, "a section that still has contents cannot be deleted directly");
  assert.equal((await be("GET", "/api/todo")).rev, 2, "a failed change is not applied");

  const same = await be("PATCH", "/api/items/t02", { title: d1.items.find((i) => i.id === "t02").title });
  assert.equal(same.rev, 2, "nothing changed, so rev stays the same");

  const added = await be("POST", "/api/items", { group: "g-trip", title: "新加的" });
  assert.equal(added.rev, 3);
  assert.ok(added.items.some((i) => i.title === "新加的" && i.group === "g-trip"));
  const themed = await be("PATCH", "/api/theme", { mode: "dark" });
  assert.equal(themed.theme.mode, "dark");
  const moved = await be("POST", "/api/sections/s-blog/move", { dir: "up" });
  assert.deepEqual(moved.sections.map((s) => s.id), ["s-research", "s-course", "s-blog", "s-life"], "reordered after the move");

  assert.deepEqual(Object.keys(await be("GET", "/api/canvas")).sort(), ["lastAttempt", "lastSuccess", "ok", "result", "running"]);
  const sync = await be("POST", "/api/canvas/sync");
  assert.equal(sync.ok, true);
  assert.equal(sync.added.length + sync.updated.length, 0, "sync: no changes");
  await assert.rejects(be("GET", "/api/health"), /not found/);
  await assert.rejects(be("POST", "/api/nothing", {}), /not found/);
});

test('in-browser "server": handles every kind of change in the route table', async () => {
  // Every route reaches its operation in core (bad arguments raise that operation's own error, not "not found")
  const be = localBackend(sampleDoc(NOWS[0]), { syncMs: 0 });
  for (const key of Object.keys(EDITS)) {
    const [method, pattern] = key.split(" ");
    const path = pattern.replace(":id", "nope");
    await be(method, path, {}).catch((e) => assert.notEqual(e.message, "not found", key));
  }
});

test("static build: only what the browser needs, and every import resolves", () => {
  const out = mkdtempSync(join(tmpdir(), "axi-demo-build-"));
  try {
    const site = join(out, "site");
    const files = build(site);
    const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f).slice(site.length + 1)]));
    assert.deepEqual(walk(site).sort(), [...files].sort(), "the files written are exactly the ones listed");
    assert.ok(files.includes("core/edits.mjs") && files.includes("web/components/App.js") && files.includes("demo/sample.js"));
    for (const f of files) assert.ok(!/^(server|canvas|deploy|test|dev)\/|store\.mjs$|report\.mjs$|^demo\/build\.mjs$|package\.json$|\.md$/.test(f), `should not be included: ${f}`);
    for (const f of files.filter((f) => /\.m?js$/.test(f))) {
      const src = readFileSync(join(site, f), "utf8");
      assert.ok(!/from\s+["']node:/.test(src), `${f} must not import node: modules`);
    }
    const html = readFileSync(join(site, "index.html"), "utf8");
    assert.match(html, /src="\/demo\/main\.js"/);
    assert.match(html, /href="\/web\/styles\.css"/);
    assert.ok(!html.includes('src="/main.js"'));
    assert.throws(() => build(site), /not empty/, "refuses to write into a directory that is not empty");
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("static build: the rules for finding imports", () => {
  const src = `import { a } from "./a.js";\nimport b from '../b.mjs';\nimport "./c.js";\nexport { d } from "./d.js";\nexport * from "./e.js";\nimport {\n  f,\n  g,\n} from "./fg.js";\nconst h = import("./h.js");\nconst x = Array.from("abc");`;
  assert.deepEqual(importsOf(src).sort(), ["../b.mjs", "./a.js", "./c.js", "./d.js", "./e.js", "./fg.js", "./h.js"]);
  assert.ok(moduleGraph().every((f) => /^(web|core|demo)\//.test(f)));
});
