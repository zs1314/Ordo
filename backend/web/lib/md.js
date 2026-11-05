// Inline Markdown: [text](link), bare links, **bold**, `code`. Escapes first, then substitutes; only http(s) and mailto links
// are let through.
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LINK = (u, t) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`;
export function md(s) {
  if (!s) return "";
  let h = esc(s);
  const codes = [];
  h = h.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  h = h.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, t, u) => (/^(https?:\/\/|mailto:)/i.test(u) ? LINK(u, t) : m));
  h = h.replace(/(^|[\s(（:：])(https?:\/\/[^\s<>"'）)\]，。；！？、]+)/g, (_, pre, u) => {
    const tail = u.match(/[.,;:!?]+$/)?.[0] ?? "";
    const url = tail ? u.slice(0, -tail.length) : u;
    return `${pre}${LINK(url, url.replace(/^https?:\/\//, ""))}${tail}`;
  });
  h = h.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
  return h;
}
// Strips the Markdown markup and keeps only the text (for title attributes and the calendar chips)
export const stripMd = (s) => String(s ?? "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");
