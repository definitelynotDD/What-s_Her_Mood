// Runs every *.test.mjs here, one after another, and fails if any did.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(HERE).filter((f) => f.endsWith(".test.mjs")).sort();
const failed = [];
for (const f of files) {
  console.log(`\n── ${f}`);
  const r = spawnSync(process.execPath, [path.join(HERE, f)], { stdio: "inherit" });
  if (r.status !== 0) failed.push(f);
}
console.log(failed.length ? `\nFAILED: ${failed.join(", ")}` : `\nall ${files.length} files passed`);
process.exit(failed.length ? 1 : 0);
