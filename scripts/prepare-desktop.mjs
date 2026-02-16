import { access, cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const standaloneRoot = path.join(root, ".next", "standalone");
const staticSource = path.join(root, ".next", "static");
const staticTarget = path.join(standaloneRoot, ".next", "static");
const publicSource = path.join(root, "public");
const publicTarget = path.join(standaloneRoot, "public");
const staleDesktopOutputInStandalone = path.join(standaloneRoot, "dist-desktop");

async function ensureExists(targetPath) {
  await access(targetPath);
}

async function copyDirectory(source, target) {
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { force: true, recursive: true });
}

try {
  await ensureExists(standaloneRoot);
  await ensureExists(staticSource);
  await ensureExists(publicSource);
  await rm(staleDesktopOutputInStandalone, { recursive: true, force: true });

  await copyDirectory(staticSource, staticTarget);
  await copyDirectory(publicSource, publicTarget);

  console.log("Desktop bundle prepared in .next/standalone");
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown preparation error.";
  console.error(`Failed to prepare desktop bundle: ${message}`);
  process.exit(1);
}
