import { mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const sourcePng = path.join(root, "public", "favicon.png");
const buildDir = path.join(root, "build");
const iconOutput = path.join(buildDir, "icon.png");

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit" });
}

try {
  if (process.platform !== "darwin") {
    console.log("Skipping icon generation: macOS only.");
    process.exit(0);
  }

  await mkdir(buildDir, { recursive: true });
  await rm(iconOutput, { force: true });

  // Normalize favicon to a square 1024x1024 PNG for electron-builder.
  run("sips", [sourcePng, "--resampleHeightWidthMax", "1024", "--out", iconOutput]);
  run("sips", [iconOutput, "--padToHeightWidth", "1024", "1024", "--out", iconOutput]);
  console.log(`Generated macOS icon: ${iconOutput}`);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown icon generation error.";
  console.error(`Failed to generate macOS icon: ${message}`);
  process.exit(1);
}
