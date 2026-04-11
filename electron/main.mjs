import { app, BrowserWindow, shell } from "electron";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const rendererUrl = process.env.ELECTRON_RENDERER_URL || "http://127.0.0.1:5173";
const packagedStaticDir = app.isPackaged ? join(process.resourcesPath, "dist") : join(__dirname, "..", "dist");
const packagedServerEntry = app.isPackaged
  ? join(process.resourcesPath, "server", "index.js")
  : join(__dirname, "..", "build", "server", "index.js");

let mainWindow = null;
let startedServer = null;

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1680,
    height: 1040,
    minWidth: 1180,
    minHeight: 760,
    title: "Codex Paper Reader",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow = window;
  return window;
}

function getTargetUrl() {
  return isDev ? rendererUrl : `http://127.0.0.1:${startedServer.port}`;
}

app.whenReady().then(async () => {
  if (!isDev) {
    startedServer = await startEmbeddedServer();
  }

  const window = createMainWindow();
  await window.loadURL(getTargetUrl());
});

app.on("window-all-closed", async () => {
  if (process.platform !== "darwin") {
    if (startedServer?.close) {
      await startedServer.close();
    }
    app.quit();
  }
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const window = createMainWindow();
    await window.loadURL(getTargetUrl());
  }
});

async function startEmbeddedServer() {
  if (!existsSync(packagedServerEntry)) {
    throw new Error(`Missing compiled server entry: ${packagedServerEntry}`);
  }
  if (!existsSync(packagedStaticDir)) {
    throw new Error(`Missing built frontend assets: ${packagedStaticDir}`);
  }

  const moduleUrl = pathToFileURL(resolve(packagedServerEntry)).href;
  const { startServer } = await import(moduleUrl);
  return startServer({
    port: Number(process.env.PORT || 8787),
    staticDir: packagedStaticDir,
  });
}
