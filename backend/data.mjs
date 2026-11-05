// The board's data on the command line, in the same data directory as the server (TODO_DIR, default ./data):
//   node data.mjs export                       the board as JSON (the document GET /api/todo returns)
//   node data.mjs import <board.json> [--log <log.jsonl>] [--replace]
//                                              loads a board, and its log if given (one JSON object per line, as `log`
//                                              prints it; without --log the log stays as it is); a board that already has
//                                              items is replaced only with --replace
//   node data.mjs markdown                     the board as Markdown
//   node data.mjs log                          the log, one JSON line per change: { ts, actor, op, ... }
// Run it as the user the server runs as: SQLite creates files next to todo.db that the server must be able to write.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { dataDir, load, replaceAll, readLog } from "./core/store.mjs";
import { toMarkdown } from "./core/report.mjs";

const { positionals: [cmd, file], values: opts } = parseArgs({ allowPositionals: true, options: { log: { type: "string" }, replace: { type: "boolean" } } });

if (cmd === "export") process.stdout.write(JSON.stringify(load(), null, 2) + "\n");
else if (cmd === "markdown") process.stdout.write(toMarkdown(load()));
else if (cmd === "log") process.stdout.write(readLog().map((l) => JSON.stringify(l) + "\n").join(""));
else if (cmd === "import" && file) importBoard(file, opts);
else {
  console.error("usage: node data.mjs export | import <board.json> [--log <log.jsonl>] [--replace] | markdown | log");
  process.exitCode = 2;
}

function importBoard(file, { log: logFile, replace }) {
  const doc = JSON.parse(readFileSync(file, "utf8"));
  const log = logFile && readFileSync(logFile, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  const items = load().items.length;
  if (items && !replace) {
    console.error(`the board in ${dataDir()} already has ${items} items; add --replace to overwrite it`);
    process.exitCode = 1;
    return;
  }
  replaceAll(doc, { log });
  console.log(`imported ${doc.items?.length ?? 0} items${log ? ` and ${log.length} log entries` : ""} into ${join(dataDir(), "todo.db")}`);
}
