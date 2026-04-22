import { app, BrowserWindow, shell } from "electron";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const rendererUrl = process.env.ELECTRON_RENDERER_URL || "http://127.0.0.1:5173";
// In packaged builds, dist/ and build/server/ are bundled inside app.asar so
// they share the asar's node_modules tree (otherwise `import "dotenv"` etc.
// fail to resolve once the .app moves outside the dev worktree). app.getAppPath()
// returns the asar root in packaged mode and the project root in dev mode.
const appPath = app.isPackaged ? app.getAppPath() : join(__dirname, "..");
const packagedStaticDir = join(appPath, "dist");
const packagedServerEntry = join(appPath, "build", "server", "index.js");
// icon.png stays in extraResources (real disk path) so BrowserWindow can read it.
const appIconPath = app.isPackaged
  ? join(process.resourcesPath, "icon.png")
  : join(__dirname, "..", "resources", "icons", "icon.png");

let mainWindow = null;
let startedServer = null;

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1680,
    height: 1040,
    minWidth: 1180,
    minHeight: 760,
    title: "知交文献阅读",
    icon: appIconPath,
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
    process.env.ZHIJIAO_USER_DATA = app.getPath("userData");
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
