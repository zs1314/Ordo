// The list of header animations: in layout editing, the slider below the header animation goes through them in this
// order, and the header animation style setting in the settings drawer reads this list too. The choice is stored in
// theme.heroStyle.
// Each header animation is one file carrying its own meta (id, name, one-line hint) and mount(canvas); adding or removing
// one only touches the two places here.
// See README.md in this directory for how to write one and the rules to follow.
import * as argus from "./argus.js";
import * as relay from "./relay.js";
import * as flow from "./flow.js";
import * as ripple from "./ripple.js";
import * as scan from "./scan.js";
import * as cloth from "./cloth.js";
import * as landscape from "./landscape.js";
import * as lidar from "./lidar.js";
import * as filings from "./filings.js";
import * as growth from "./growth.js";
import * as blackhole from "./blackhole.js";

const MODULES = [argus, relay, flow, ripple, scan, cloth, landscape, lidar, filings, growth, blackhole];

export const HEROES = MODULES.map((m) => ({ ...m.meta, mount: m.mount }));
export const heroById = (id) => HEROES.find((h) => h.id === id) ?? HEROES[0];
