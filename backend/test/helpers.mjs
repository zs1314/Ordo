// Starts the board server for tests: puts the data in a temporary directory, starts server.mjs on any free port, and
// afterwards stops it and deletes the temporary directory it created.
//   const srv = await startServer({ data: { sections: [...], groups: [...], items: [...] }, env: { TODO_PASSWORD: "x" } });
//   await fetch(srv.base + "/api/todo"); srv.stop();
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { openStore } from "../core/store.mjs";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "server.mjs");
export const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });

/** dir: the directory to use (a new temporary one if omitted); data: the board to start with; env: extra environment variables */
export async function startServer({ dir, data, env = {} } = {}) {
  const own = !dir;
  dir ??= mkdtempSync(join(tmpdir(), "axi-todo-test-"));
  const store = openStore(dir);
  if (data) store.replaceAll(data);
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const proc = spawn(process.execPath, [SERVER], { env: { ...process.env, ...env, TODO_DIR: dir, TODO_PORT: String(port) }, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  proc.stderr.on("data", (s) => (stderr += s));
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${base}/api/health`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    if (i === 49) throw new Error(`server did not start: ${stderr}`);
  }
  return {
    dir, port, base,
    get stderr() { return stderr; },
    /** Every entry of the log, as { ts, actor, op, ... } */
    log: () => store.readLog(),
    stop: () => { proc.kill(); store.close(); if (own) rmSync(dir, { recursive: true, force: true }); },
  };
}
