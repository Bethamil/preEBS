import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const port = process.env.PREEBS_DESKTOP_PORT?.trim() || "3000";
const nextUrl = `http://127.0.0.1:${port}`;
const dataDir = path.join(os.homedir(), ".preebs-desktop");
const baseEnv = {
  ...process.env,
  PREEBS_DESKTOP: "1",
  PREEBS_DATA_DIR: dataDir,
};

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const electronBinary = path.join(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron.cmd" : "electron",
);

let devServerProcess = null;
let electronProcess = null;
let shuttingDown = false;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, maxAttempts = 120) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.ok || response.status === 307 || response.status === 308) {
        return;
      }
    } catch {
      // Retry until Next.js is ready.
    }
    await wait(500);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function stopAll(exitCode = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  if (electronProcess && !electronProcess.killed) {
    electronProcess.kill("SIGTERM");
  }

  if (devServerProcess && !devServerProcess.killed) {
    devServerProcess.kill("SIGTERM");
  }

  setTimeout(() => process.exit(exitCode), 100);
}

process.on("SIGINT", () => stopAll(130));
process.on("SIGTERM", () => stopAll(143));

devServerProcess = spawn(npmCommand, ["run", "dev:web", "--", "--port", port], {
  env: baseEnv,
  stdio: "inherit",
});

devServerProcess.on("exit", (code) => {
  if (!shuttingDown) {
    console.error(`Next.js dev server exited early (code ${String(code ?? "unknown")}).`);
    stopAll(code ?? 1);
  }
});

try {
  await waitForServer(nextUrl);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown startup error.";
  console.error(message);
  stopAll(1);
  process.exit(1);
}

electronProcess = spawn(electronBinary, ["electron/main.cjs"], {
  env: {
    ...baseEnv,
    PREEBS_SERVER_URL: nextUrl,
  },
  stdio: "inherit",
});

electronProcess.on("exit", (code) => {
  stopAll(code ?? 0);
});

electronProcess.on("error", (error) => {
  console.error(`Failed to launch Electron: ${error.message}`);
  stopAll(1);
});
