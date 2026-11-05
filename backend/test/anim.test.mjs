// The pure computation behind two small animations on the board: dominoes (web/lib/domino.js) and snake (web/lib/snake.js)
import test from "node:test";
import assert from "node:assert/strict";
import { dominoes, corners, overlap } from "../web/lib/domino.js";
import { createSnake } from "../web/lib/snake.js";
import { cut, area } from "../web/lib/fx/shatter.js";
import { fxOf, fxOptions } from "../web/lib/fx/index.js";

const run = (bars, wall, dt = 1 / 60) => {
  const sim = dominoes(bars, { wall });
  const start = bars.map(() => -1);
  let f = 0;
  for (; !sim.step(dt) && f < 2000; f++) sim.angles.forEach((a, k) => { if (start[k] < 0 && a > 0.03) start[k] = f; });
  return { sim, start, f };
};
const restingOverlaps = (bars, angles) => bars.slice(0, -1).filter((b, i) => overlap(corners(b, angles[i]), corners(bars[i + 1], angles[i + 1]), 0.5)).length;

test("dominoes: at desktop spacing they fall one after another and come to rest without overlapping or passing through the wall", () => {
  const bars = Array.from({ length: 14 }, (_, k) => ({ x: 16 + k * 66 + (k >= 7 ? 6 : 0), w: 14, h: 66 }));
  const wall = 942, { sim, start } = run(bars, wall);
  assert.ok(sim.t < 4, `took ${sim.t.toFixed(2)} s`);
  assert.ok(start.every((s, k) => s >= 0 && (k === 0 || s > start[k - 1])), `frames at which each started to fall: ${start}`);
  assert.ok(sim.angles.every((a) => a > 0.3 && a <= Math.PI / 2 + 1e-9), sim.angles.join(","));
  assert.equal(restingOverlaps(bars, sim.angles), 0);
  assert.ok(bars.every((b, i) => corners(b, sim.angles[i]).every(([x, y]) => x <= wall + 0.5 && y >= -0.5)));
});

test("dominoes: a tightly packed row still falls all the way (each leaning piece keeps pushing) and ends up leaning against the wall together", () => {
  const bars = Array.from({ length: 14 }, (_, k) => ({ x: k * 20, w: 18, h: 46 }));
  const { sim } = run(bars, 14 * 20 + 6);
  assert.ok(sim.angles.every((a) => a > 0.1), sim.angles.map((a) => (a * 57.3).toFixed(0)).join(" "));
  assert.equal(restingOverlaps(bars, sim.angles), 0);
});

test("dominoes: a piece too far away to reach the next one falls flat on its own, and the next one falls after it", () => {
  const bars = Array.from({ length: 5 }, (_, k) => ({ x: k * 100, w: 16, h: 40 }));
  const { sim, start } = run(bars, 600);
  assert.ok(start.every((s, k) => k === 0 || s > start[k - 1]));
  assert.ok(sim.angles.every((a) => Math.abs(a - Math.PI / 2) < 1e-6));
});

test("dominoes: they still come to rest when frame lengths vary", () => {
  let seed = 3;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const bars = Array.from({ length: 14 }, (_, k) => ({ x: 16 + k * 66, w: 14, h: 66 }));
  for (let trial = 0; trial < 10; trial++) {
    const sim = dominoes(bars, { wall: 942 });
    let f = 0;
    while (!sim.step(0.008 + rnd() * 0.03) && f < 2000) f++;
    assert.ok(sim.t < 5, `trial ${trial} took ${sim.t.toFixed(2)} s`);
  }
});

test("snake: on autopilot it eats all the days, then a few extra pieces appear and the game ends", () => {
  const cols = 18, rows = 7, walls = new Set([17 * 7 + 3, 17 * 7 + 4, 17 * 7 + 5, 17 * 7 + 6]);
  const food = new Map([[17 * 7 + 1, 3], [16 * 7 + 4, 1], [15 * 7 + 0, 7], [10 * 7 + 6, 2], [2 * 7 + 3, 1]]);
  const g = createSnake({ cols, rows, walls, food, start: 17 * 7 + 2, extra: 3, seed: 5 });
  let r;
  do { r = g.step(); } while (r === "move" || r === "eat");
  assert.equal(r, "won");
  assert.equal(g.state.eaten, 5 + 3);
  assert.equal(g.state.items, 3 + 1 + 7 + 2 + 1 + 3);
  assert.equal(g.state.body.length + g.state.grow, g.state.eaten + 1); // one segment per piece eaten (the growth from the last piece may still be pending)
});

test("snake: once the player presses a direction it follows the player; reversing is ignored; hitting a wall ends the game", () => {
  const g = createSnake({ cols: 10, rows: 7, start: 3 * 7 + 3, food: new Map([[9 * 7 + 6, 1]]) });
  g.steer("up");
  assert.equal(g.step(), "move");
  assert.equal(g.state.body[0], 3 * 7 + 2);
  let r, n = 1;
  do { r = g.step(); n++; } while (r === "move");
  assert.equal(r, "dead");
  assert.equal(n, 4); // up from row 3: rows 2, 1, 0, then one more step leaves the board
});

test("snake: once it has grown it cannot reverse directly; it never moves into a wall or itself", () => {
  const g = createSnake({ cols: 6, rows: 7, start: 2 * 7 + 3, food: new Map([[3 * 7 + 3, 1], [4 * 7 + 3, 1]]) });
  g.steer("right"); g.step(); g.step(); // ate two pieces, now three segments long
  g.steer("left"); // reversing: ignored
  assert.equal(g.state.want, "right");
  // on autopilot it does not hit a wall, even over a long run
  const h = createSnake({ cols: 20, rows: 7, walls: new Set([19 * 7 + 6]), start: 0, food: new Map([[19 * 7 + 5, 1], [0 * 7 + 6, 1]]), extra: 6, seed: 9 });
  let r;
  do { r = h.step(); } while (r === "move" || r === "eat");
  assert.equal(r, "won");
});

test("shatter: the shards make up exactly the whole card (their areas add up and every shard lies inside the card), wherever the crack starts", () => {
  for (const [w, h] of [[300, 200], [380, 150], [120, 44], [900, 60]]) {
    for (const P of [{ x: w / 2, y: h / 2 }, { x: w * 0.8, y: h * 0.75 }, { x: 3, y: 3 }, { x: w - 2, y: h / 3 }]) {
      const polys = cut(w, h, P);
      const total = polys.reduce((s, p) => s + area(p), 0);
      assert.ok(Math.abs(total - w * h) < w * h * 0.002, `${w}×${h} from (${P.x}, ${P.y}): ${total.toFixed(1)} / ${w * h}`);
      assert.ok(polys.every((p) => p.every((q) => q.x >= -0.01 && q.x <= w + 0.01 && q.y >= -0.01 && q.y <= h + 0.01)));
      assert.ok(polys.length >= 12, `${polys.length} shards`);
    }
  }
});

test('completion effect: unknown values fall back to the default; the options start with "不要" and end with "随机"', () => {
  assert.equal(fxOf({}, "agent"), "shatter");
  assert.equal(fxOf({ agentFx: "stamp" }, "agent"), "stamp");
  assert.equal(fxOf({ agentFx: "pop" }, "agent"), "shatter", "sparks are only for check-ins");
  assert.equal(fxOf({ checkFx: "none" }, "check"), "none");
  assert.equal(fxOf({ checkFx: "random" }, "check"), "random");
  for (const kind of ["agent", "check"]) {
    const ids = fxOptions(kind).map(([id]) => id);
    assert.equal(ids[0], "none");
    assert.equal(ids.at(-1), "random");
    assert.equal(new Set(ids).size, ids.length);
  }
});
