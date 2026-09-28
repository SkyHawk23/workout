// Fails the build if a secret-shaped string leaked into the client bundle.
// Run automatically as part of `npm run build` (see package.json).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DIST = "dist";
const PATTERNS = [/sk-ant-[a-zA-Z0-9_-]{10,}/, /postgres(ql)?:\/\/[^\s"']+/i];

function walk(dir) {
  let files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    files = statSync(full).isDirectory() ? files.concat(walk(full)) : files.concat([full]);
  }
  return files;
}

let failed = false;
for (const file of walk(DIST)) {
  if (!/\.(js|html|css|map)$/.test(file)) continue;
  const content = readFileSync(file, "utf8");
  for (const pattern of PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      console.error(`Secret-shaped string found in ${file}: ${match[0].slice(0, 20)}…`);
      failed = true;
    }
  }
}

if (failed) {
  console.error("Build output contains what looks like a secret. Failing the build.");
  process.exit(1);
}
console.log("check-no-secrets: clean");
