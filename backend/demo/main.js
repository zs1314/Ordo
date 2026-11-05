// Entry point of the demo site: the board's interface as it is, with data made up in the browser (sample.js) instead; changes go
// to backend.js, and no requests are sent.
import { setBackend } from "../web/lib/api.js";
import { localBackend } from "./backend.js";
import { sampleDoc } from "./sample.js";

setBackend(localBackend(sampleDoc(), { repo: "https://github.com/Axi404/todo" }));
import("../web/main.js");
