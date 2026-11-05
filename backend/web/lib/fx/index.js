// Completion effects: the list, and the places on the board that use them.
// Two places can be configured (theme.agentFx, theme.checkFx, the "Effects" section of the settings):
//   agent  clicking "done" on an agent card ("done today" for a recurring item): the card leaves the agent section
//          with the effect
//   check  check-ins: clicking a cell in the check-in table, the "to do today" pill to the left of an item, or
//          "done today" in the status menu
// Each place can be set to none, one effect from the list, or random. Nothing plays when prefers-reduced-motion is set.
// One effect per file; see the top of kit.js for how to write one. To add one: write the file, import it below, add it
// to BY_ID, and list its id under LISTS.agent and/or LISTS.check.
import { reducedMotion } from "../motion.js";
import { pick, wait } from "./kit.js";
import * as confetti from "./confetti.js";
import * as shatter from "./shatter.js";
import * as dust from "./dust.js";
import * as stamp from "./stamp.js";
import * as fireworks from "./fireworks.js";
import * as pop from "./pop.js";
import * as ripple from "./ripple.js";

const BY_ID = Object.fromEntries([confetti, shatter, dust, stamp, fireworks, pop, ripple].map((m) => [m.meta.id, m]));
const LISTS = {
  agent: ["confetti", "shatter", "dust", "stamp", "fireworks"],
  check: ["confetti", "pop", "fireworks", "ripple"],
};
const KEYS = { agent: "agentFx", check: "checkFx" };
const DEFAULTS = { agent: "shatter", check: "confetti" };

/** The options in the settings: [id, name], with "none" first and "random" last */
export const fxOptions = (kind) => [["none", "不要"], ...LISTS[kind].map((id) => [id, BY_ID[id].meta.name]), ["random", "随机"]];

/** Which effect is currently set (anything unrecognized falls back to the default) */
export function fxOf(theme, kind) {
  const v = theme?.[KEYS[kind]];
  return v === "none" || v === "random" || LISTS[kind].includes(v) ? v : DEFAULTS[kind];
}

/** Play an effect: kind is agent or check, target is the thing the effect plays on (a card, a cell), origin is the button
 *  that was clicked. Returns null when nothing plays (set to "none", prefers-reduced-motion); otherwise returns
 *  { took, ready, done, restore } (see kit.js) */
export function celebrate(kind, theme, target, origin, setting = fxOf(theme, kind)) {
  if (reducedMotion() || !target?.isConnected || setting === "none") return null;
  const id = setting === "random" ? pick(LISTS[kind]) : setting;
  try {
    return BY_ID[id].play(target, origin ?? target, { big: kind === "agent" });
  } catch (err) {
    console.error("fx failed", err);
    return null;
  }
}

/** An agent card is done (or today's check-in was made): play the effect; if the effect did not take the card away, the
 *  card fades out by itself. Save only after that has finished (save returns true when it was saved), and the card
 *  disappears from the agent section; if the save fails, put the card back */
export async function leaveCard(card, origin, theme, save) {
  if (!card || card.dataset.leaving) return;
  card.dataset.leaving = "1"; // not clickable while the effect plays (pointer-events: none in the stylesheet)
  const fx = celebrate("agent", theme, card, origin);
  const fade = fx?.took ? null : card.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.98)" }], { duration: reducedMotion() ? 0 : 220, easing: "ease", fill: "forwards" });
  await Promise.all([fx?.ready, fade?.finished.catch(() => {})]);
  if (await save()) return;
  fade?.cancel();
  fx?.restore();
  delete card.dataset.leaving;
}

/** Check-in: play an effect on the clicked cell (or pill); saving does not wait for it and happens right away */
export const cheer = (theme, el) => celebrate("check", theme, el, el);

/** Clicking an option in the settings plays it once right there as a preview. Effects that take their target away
 *  (shatter, dust, stamp) play on the row of options, and the row fades back in once they have finished */
export async function preview(kind, setting, row, chip) {
  const fx = celebrate(kind, null, kind === "agent" ? row : chip, chip, setting);
  if (!fx?.took) return;
  await Promise.all([fx.done, wait(200)]);
  fx.restore();
  row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280, easing: "ease-out" });
}
