import { rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const targets = [
  path.join(root, "dist-desktop"),
  path.join(root, ".next", "standalone", "dist-desktop"),
];

for (const target of targets) {
  await rm(target, { recursive: true, force: true });
}

console.log("Cleaned previous desktop build artifacts.");
