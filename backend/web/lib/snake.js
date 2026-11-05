// Snake: the board is the heatmap, with cols columns (one per week) and rows (7) rows, Monday to Sunday; days yet to come are
// walls.
// food: cell → how many items were done that day. Cell index = column × rows + row (as in the heatmap, counting down one column
// after another).
// The snake sets off from start and finds the nearest food by itself (BFS, steering around its own body); when it cannot find
// any, it heads to where it can go farthest, staying alive first.
// Once the player presses a direction (steer), it follows the player from then on. Each cell eaten adds a segment; hitting a
// wall or itself ends the game.
// When all those days are eaten, a pellet (bonus) pops up on a random empty cell, one at a time, as in ordinary snake: playing
// by itself, it stops (a win) after eating `extra` more; under player control the game goes on until it crashes.
// Pure computation, no DOM: components/done/Heatmap.js calls step() once per tick. Tests are in test/anim.test.mjs.

export const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPP = { up: "down", down: "up", left: "right", right: "left" };

export function createSnake({ cols, rows = 7, walls = new Set(), food = new Map(), start, extra = 5, seed = 1 }) {
  const at = (c, r) => (c < 0 || c >= cols || r < 0 || r >= rows ? -1 : c * rows + r);
  const cr = (i) => [Math.floor(i / rows), i % rows];
  const next = (i, d) => { const [c, r] = cr(i); return at(c + DIRS[d][0], r + DIRS[d][1]); };
  const s = { body: [start], dir: null, want: null, manual: false, food: new Map(food), total: food.size, eaten: 0, items: 0, grow: 0,
    bonus: new Set(), bonusEaten: 0, over: false, won: false, steps: 0 };
  let r = seed >>> 0 || 1;
  const rand = () => ((r = (r * 1103515245 + 12345) >>> 0) / 4294967296);
  const eat = (i) => {
    if (!s.food.has(i)) return;
    s.items += s.food.get(i); s.food.delete(i); s.eaten++; s.grow++;
    if (s.bonus.delete(i)) s.bonusEaten++;
  };
  // All eaten: put a new pellet on an empty cell
  const spawn = () => {
    const empty = [];
    for (let i = 0; i < cols * rows; i++) if (!walls.has(i) && !s.body.includes(i)) empty.push(i);
    if (!empty.length) return false;
    const i = empty[Math.floor(rand() * empty.length)];
    s.food.set(i, 1); s.bonus.add(i);
    return true;
  };
  eat(start);

  // Whether moving to i is safe: on the board, not a wall, not the body (the tail moves away this tick, so it does not count;
  // while growing, the tail stays put, so it does)
  const free = (i, body = s.body, grow = s.grow) => {
    if (i < 0 || walls.has(i)) return false;
    const k = body.indexOf(i);
    return k === -1 || (k === body.length - 1 && grow === 0);
  };
  const moves = (i) => Object.keys(DIRS).filter((d) => free(next(i, d)));

  // From the head, the direction in which the nearest food lies
  function towardFood() {
    const head = s.body[0], seen = new Map([[head, null]]), q = [head];
    while (q.length) {
      const u = q.shift();
      if (u !== head && s.food.has(u)) { let v = u; while (seen.get(v) !== head) v = seen.get(v); return Object.keys(DIRS).find((d) => next(head, d) === v); }
      for (const d of Object.keys(DIRS)) {
        const v = next(u, d);
        if (v < 0 || seen.has(v) || walls.has(v)) continue;
        if (s.body.includes(v) && v !== s.body[s.body.length - 1]) continue;
        seen.set(v, u); q.push(v);
      }
    }
    return null;
  }
  // How many cells are still reachable after one step toward d (the more, the less likely the snake traps itself)
  function room(d) {
    const head = next(s.body[0], d), body = [head, ...s.body.slice(0, s.grow ? s.body.length : -1)];
    const seen = new Set([head]), q = [head];
    while (q.length) {
      const u = q.pop();
      for (const e of Object.keys(DIRS)) { const v = next(u, e); if (v >= 0 && !seen.has(v) && !walls.has(v) && !body.includes(v)) { seen.add(v); q.push(v); } }
    }
    return seen.size;
  }
  function choose() {
    const ok = moves(s.body[0]).filter((d) => s.body.length === 1 || d !== OPP[s.dir]);
    if (!ok.length) return s.dir ?? "left";
    const f = towardFood();
    // Look before going for the food: only go if there is still room to turn around once there
    if (f && ok.includes(f) && room(f) > s.body.length) return f;
    return ok.map((d) => [d, room(d) + (d === s.dir ? 0.5 : 0)]).sort((a, b) => b[1] - a[1])[0][0];
  }

  return {
    state: s,
    /** The player pressed a direction: follow the player from this tick on; a straight reversal is ignored */
    steer(d) {
      if (!DIRS[d] || s.over) return;
      if (s.body.length > 1 && d === OPP[s.dir]) return;
      s.want = d; s.manual = true;
    },
    /** Moves one cell. Returns "move" / "eat" / "dead" / "won" */
    step() {
      if (s.over) return s.won ? "won" : "dead";
      s.steps++;
      const d = s.manual ? (s.want ?? s.dir ?? choose()) : choose();
      if (s.body.length > 1 && d === OPP[s.dir]) s.want = s.dir; // a reversing direction is ignored
      s.dir = s.body.length > 1 && d === OPP[s.dir] ? s.dir : d;
      const head = next(s.body[0], s.dir);
      if (!free(head)) { s.over = true; return "dead"; }
      const ate = s.food.has(head);
      s.body.unshift(head);
      if (s.grow > 0) s.grow--; else s.body.pop();
      if (ate) eat(head);
      if (!s.food.size && (s.manual || s.bonusEaten < extra) && spawn()) return ate ? "eat" : "move";
      if (!s.food.size) { s.over = true; s.won = true; return "won"; }
      return ate ? "eat" : "move";
    },
  };
}
