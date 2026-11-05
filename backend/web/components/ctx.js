import { createContext, useContext } from "../vendor/preact-htm.js";

// What the whole board shares (provided in App); components get it with useBoard():
//   doc            the whole document from the server
//   ui, setUi      transient page state: editMode (layout editing), editing (what is being edited: "i:<id>" an item,
//                  "i:<id>@agent" an item in an agent card, "g:<id>" a card, "s:<id>" a section, "goals"), adding (what is
//                  being added), settings (whether the settings drawer is open), locate (the item just located)
//   act            changes data: act.item(id).patch(...), act.theme(...) and so on (actions from lib/api.js)
//   call           the layer below act, (method, path, body, okMsg, opts); toast(msg) shows a line at the bottom;
//                  reload(force) reads the data again
//   pop, setPop    the popover; openPop(kind, id, el, extra) opens one (or closes it if the same one is already open)
//   locate(id)     finds the item in its card, scrolls there and highlights it (clicking an entry in the calendar or
//                  "recently done")
export const Ctx = createContext(null);
export const useBoard = () => useContext(Ctx);
