const { app, BrowserWindow, dialog, shell } = require("electron");
const { fork } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

let mainWindow = null;
let serverProcess = null;
let startUrl = null;
let isQuitting = false;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not resolve a free port.")));
        return;
      }
      const { port } = address;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForServer(url, maxAttempts = 120) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.ok || response.status === 307 || response.status === 308) {
        return;
      }
    } catch {
      // Retry until the server becomes reachable.
    }
    await wait(500);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function createMainWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    if (mainWindow) {
      mainWindow.show();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    shell.openExternal(targetUrl);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.loadURL(url);
}

function resolveServerEntry() {
  const unpackedServerEntry = path.join(
    process.resourcesPath,
    "app.asar.unpacked",
    ".next",
    "standalone",
    "server.js",
  );
  const devServerEntry = path.join(path.resolve(__dirname, ".."), ".next", "standalone", "server.js");
  const candidates = app.isPackaged ? [unpackedServerEntry] : [devServerEntry, unpackedServerEntry];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

async function startBundledServer() {
  const serverEntry = resolveServerEntry();

  if (!fs.existsSync(serverEntry)) {
    throw new Error(
      "Desktop server bundle is missing. Run `npm run build:web` and `node scripts/prepare-desktop.mjs` first.",
    );
  }

  const port = await getFreePort();
  const nextUrl = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    PREEBS_DESKTOP: "1",
    PREEBS_DATA_DIR: app.getPath("userData"),
  };
  const serverCwd = app.isPackaged ? process.resourcesPath : path.dirname(serverEntry);

  serverProcess = fork(serverEntry, [], {
    cwd: serverCwd,
    env,
    silent: true,
  });

  serverProcess.on("error", (error) => {
    dialog.showErrorBox(
      "PreEBS Desktop",
      `Failed to start server: ${error.message}\nEntry: ${serverEntry}\nCWD: ${serverCwd}`,
    );
    app.quit();
  });

  serverProcess.stdout?.on("data", (chunk) => {
    process.stdout.write(`[next] ${chunk}`);
  });
  serverProcess.stderr?.on("data", (chunk) => {
    process.stderr.write(`[next] ${chunk}`);
  });

  serverProcess.on("exit", (code, signal) => {
    if (isQuitting) {
      return;
    }
    const exitReason = signal ? `signal ${signal}` : `code ${String(code ?? "unknown")}`;
    dialog.showErrorBox("PreEBS Desktop", `Local server exited unexpectedly (${exitReason}).`);
    app.quit();
  });

  await waitForServer(nextUrl);
  return nextUrl;
}

async function resolveStartUrl() {
  if (process.env.PREEBS_SERVER_URL) {
    const url = process.env.PREEBS_SERVER_URL;
    await waitForServer(url);
    return url;
  }
  return startBundledServer();
}

function shutdownServer() {
  if (!serverProcess) {
    return;
  }
  serverProcess.kill("SIGTERM");
  serverProcess = null;
}

app.on("before-quit", () => {
  isQuitting = true;
  shutdownServer();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.whenReady().then(async () => {
  try {
    startUrl = await resolveStartUrl();
    createMainWindow(startUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown startup error.";
    dialog.showErrorBox("PreEBS Desktop", message);
    app.quit();
    return;
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && startUrl) {
      createMainWindow(startUrl);
    }
  });
});
