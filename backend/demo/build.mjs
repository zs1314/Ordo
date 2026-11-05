// Builds the demo site into a directory of static files that nginx serves as they are (deploy/demo.sh uploads it):
//   node demo/build.mjs <output dir>        the output directory must not exist or must be empty
// It contains only: index.html (web/index.html changed to load demo/main.js), web/styles.css, the fonts in web/fonts/, and the
// modules reachable from demo/main.js through imports (in web/, core/ and demo/; the server's file storage in store.mjs, Canvas,
// login and the like are not reachable).
// An import of node: or of a file that does not exist is an error, and nothing is built.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = "demo/main.js";

/** What a module imports (static import / export … from, and import("…") with a literal path) */
export function importsOf(src) {
  const out = [];
  for (const re of [/\b(?:import|export)\b[^"'`;]*?\bfrom\s*["']([^"']+)["']/g, /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, /\bimport\s*["']([^"']+)["']/g]) {
    for (const m of src.matchAll(re)) out.push(m[1]);
  }
  return [...new Set(out)];
}

/** Follows the imports from demo/main.js and returns the modules to include (paths relative to the repository root) */
export function moduleGraph(root = ROOT) {
  const seen = new Set(), queue = [ENTRY];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    for (const spec of importsOf(fs.readFileSync(path.join(root, rel), "utf8"))) {
      if (!spec.startsWith(".")) throw new Error(`${rel} imports ${spec}: the demo runs in a browser and can only import files from this repository`);
      const dep = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
      if (dep.startsWith("..") || !/^(web|core|demo)\//.test(dep)) throw new Error(`${rel} imports ${spec}, which is outside web/, core/ and demo/`);
      if (!fs.existsSync(path.join(root, dep))) throw new Error(`${rel} imports ${spec}, which does not exist`);
      queue.push(dep);
    }
  }
  return [...seen].sort();
}

/** Builds the site into out; returns the files it wrote */
export function build(out, root = ROOT) {
  if (fs.existsSync(out) && fs.readdirSync(out).length) throw new Error(`${out} is not empty`);
  let html = fs.readFileSync(path.join(root, "web/index.html"), "utf8");
  const swap = (from, to) => {
    if (!html.includes(from)) throw new Error(`web/index.html has no ${from}`);
    html = html.replace(from, to);
  };
  swap('href="/styles.css"', 'href="/web/styles.css"');
  swap('src="/main.js"', 'src="/demo/main.js"');
  swap("<title>ToDo</title>", `<title>Axi's ToDo · 示例</title>\n<meta name="description" content="一个 ToDo 看板的示例。数据是编的，可以随便点，刷新回到原样。" />`);
  const fonts = fs.readdirSync(path.join(root, "web/fonts")).filter((f) => f.endsWith(".woff2")).map((f) => `web/fonts/${f}`);
  const files = ["web/styles.css", ...fonts, ...moduleGraph(root)];
  for (const f of files) {
    fs.mkdirSync(path.join(out, path.dirname(f)), { recursive: true });
    fs.copyFileSync(path.join(root, f), path.join(out, f));
  }
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "index.html"), html);
  return ["index.html", ...files];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) { console.error("usage: node demo/build.mjs <output directory>"); process.exit(2); }
  try {
    const files = build(path.resolve(out));
    const kb = files.reduce((s, f) => s + fs.statSync(path.join(out, f)).size, 0) / 1024;
    console.log(`demo: ${files.length} files, ${kb.toFixed(0)} KB → ${out}`);
  } catch (e) { console.error(`demo build failed: ${e.message}`); process.exit(1); }
}
