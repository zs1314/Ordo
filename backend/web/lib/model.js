// Statuses, ordering, and what a few things in the data are called. The server (core/) uses this file directly too.
export const LABEL = { todo: "还没做", doing: "我在做", agent: "Agent 在做", waiting: "等别人", done: "做完了", dropped: "不做了" };
export const SHORT = { todo: "还没做", doing: "在做", agent: "Agent", waiting: "等别人", done: "完成", dropped: "不做了" };
export const ICON = { todo: "○", doing: "▶", agent: "⚙", waiting: "◷", done: "✓", dropped: "✕" };
export const ORDER = ["todo", "doing", "agent", "waiting", "done", "dropped"];
export const OPEN = ["todo", "doing", "agent", "waiting"];

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
export const sections = (doc) => [...doc.sections].sort(byOrder);
export const groupsOf = (doc, sid) => doc.groups.filter((g) => g.section === sid).sort(byOrder);
export const itemsOf = (doc, gid) => doc.items.filter((i) => i.group === gid).sort(byOrder);
export const groupOf = (doc, id) => doc.groups.find((g) => g.id === id);
export const sectionOf = (doc, id) => doc.sections.find((s) => s.id === id);

// Card names
// The card a new section comes with (plain), or a card titled the same as its section, stands for the section itself
const standsForSection = (doc, g) => g.plain || g.title === sectionOf(doc, g.section)?.title;
/** What a card is called elsewhere: the section title for a card that stands for its section, otherwise the card title (this is
 *  what follows each entry in "recently done") */
export const cardName = (doc, g) => (standsForSection(doc, g) ? sectionOf(doc, g.section)?.title ?? "" : g.title);
/** How a card is written in the card dropdown: "section · card"; a card that stands for its section shows only the section title */
export const cardPath = (doc, g) => {
  const s = sectionOf(doc, g.section)?.title ?? "";
  return standsForSection(doc, g) ? s : `${s} · ${g.title}`;
};
/** All cards, ordered by section, then by card */
export const allCards = (doc) => sections(doc).flatMap((s) => groupsOf(doc, s.id));
