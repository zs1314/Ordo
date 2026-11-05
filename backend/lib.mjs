// The board's data layer: the server (server.mjs), the API client (client.mjs), Canvas sync (canvas-sync.mjs) and the tests
// all import from here. The code lives in core/; this file only gathers it in one place:
//   core/store.mjs   storage: the board and its log in SQLite (todo.db in the data directory); load, mutate
//   core/schema.mjs  default appearance and settings, filling in missing fields (normalize)
//   core/items.mjs   items: add, change, delete, check in, move; the ways to write a repeat
//   core/board.mjs   sections, cards, appearance, settings, yearly goals
//   core/places.mjs  places where items are handed off to agents
//   core/report.mjs  the Markdown copy and the briefing for agents
//   core/doc.mjs     small helpers for finding and ordering things; core/errors.mjs errors with status codes
// Every operation that changes data is (doc, …) → one log entry, or null (nothing changed), and runs inside mutate, which
// writes back the rows that changed, in one transaction.
// Statuses, ordering, dates, recurring items and the ordering of places come straight from the browser's code in web/lib
// (there is only one copy).

export * from "./core/errors.mjs";
export * from "./core/doc.mjs";
export * from "./core/schema.mjs";
export * from "./core/items.mjs";
export * from "./core/board.mjs";
export * from "./core/places.mjs";
export * from "./core/report.mjs";
export * from "./core/store.mjs";
export { LABEL, SHORT, ICON, ORDER, OPEN, sections as sectionsOf, groupsOf, itemsOf } from "./web/lib/model.js";
export { ymd } from "./web/lib/due.js";
export { repeatLabel, repeatDay, repeatState, agentActive } from "./web/lib/repeat.js";
export { placesByRecency } from "./web/lib/places.js";
