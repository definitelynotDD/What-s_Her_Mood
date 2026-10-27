// Everything in the publish folder is downloadable by anyone from the live
// site, so it should hold the app and nothing else: no handover notes, deploy
// steps or database schema (those live in docs/ and supabase/). Plain Node.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checker } from "./lib/browser.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { check, done } = checker();

const toml = fs.readFileSync(path.join(ROOT, "netlify.toml"), "utf8");
const publish = (toml.match(/^\s*publish\s*=\s*"([^"]+)"/m) || [])[1];
check("netlify.toml names the publish folder", publish === "whm-site", publish);

const APP = new Set([".html", ".js", ".css", ".woff2", ".woff", ".png", ".jpg", ".jpeg",
  ".webp", ".svg", ".ico", ".webmanifest"]);
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : [path.relative(path.join(ROOT, publish), path.join(dir, e.name))]);
const files = walk(path.join(ROOT, publish));

check("the app is there", files.includes("index.html") && files.includes(path.join("js", "main.js")), files.length);
const stray = files.filter((f) => !APP.has(path.extname(f).toLowerCase()));
check("nothing but app files is published (no .md, .sql, notes)", stray.length === 0, stray);
for (const f of ["docs/HANDOVER.md", "docs/DEPLOY.md", "docs/README.md", "supabase/schema.sql"]) {
  check(`${f} kept, outside the publish folder`, fs.existsSync(path.join(ROOT, f)));
}

done();
