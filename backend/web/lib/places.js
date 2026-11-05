// Places where items handed off to an agent run (doc.places). The server's lib.mjs uses placesByRecency from here directly too
// Most recently used (or just added in settings and not used yet) first; ties go by use count, then by name
const recency = (p) => p.lastUsed ?? p.addedAt ?? "";
export const placesByRecency = (doc) =>
  [...(doc.places ?? [])].sort((a, b) => recency(b).localeCompare(recency(a)) || (b.uses ?? 0) - (a.uses ?? 0) || a.name.localeCompare(b.name));

// The few places offered when picking one: if something is typed in the input (and it is not exactly a place's name), they are
// filtered by substring
export function placeOptions(doc, typed = "", n = 6) {
  const all = placesByRecency(doc).map((p) => p.name), q = typed.trim();
  if (!q || all.includes(q)) return all.slice(0, n);
  return all.filter((x) => x.toLowerCase().includes(q.toLowerCase())).slice(0, n);
}
