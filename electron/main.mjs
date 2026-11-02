import { app, BrowserWindow, ipcMain, shell } from "electron";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
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

// ── PDFs handed over by the OS（「打开方式」/ 双击 / 拖到程序坞图标）──────────
// They arrive three ways: macOS fires `open-file` (before `ready` too, when
// the open itself launched the app); Windows / Linux put the path in argv on
// first launch, and in the argv of a would-be second instance afterwards.
// All of them land in pendingPdfPaths, which the renderer drains once it has
// mounted — a push sent before its listener exists would simply be lost.
const pendingPdfPaths = [];
let rendererReady = false;

function isPdfPath(filePath) {
  return extname(filePath).toLowerCase() === ".pdf";
}

function pdfPathsFromArgv(argv, workingDirectory) {
  return argv
    .filter((arg) => !arg.startsWith("-") && isPdfPath(arg))
    .map((arg) => resolve(workingDirectory, arg))
    .filter((filePath) => existsSync(filePath));
}

async function readPendingPdfs() {
  const paths = pendingPdfPaths.splice(0);
  const pdfs = await Promise.all(
    paths.map(async (filePath) => {
      try {
        // A Buffer crosses IPC as a Uint8Array.
        return { path: filePath, name: basename(filePath), data: await readFile(filePath) };
      } catch (error) {
        console.error(`[zhijiao] 无法读取 ${filePath}:`, error);
        return null;
      }
    }),
  );
  return pdfs.filter(Boolean);
}

function queuePdf(filePath) {
  pendingPdfPaths.push(filePath);
  if (!rendererReady || !mainWindow) {
    return;
  }
  const target = mainWindow;
  void readPendingPdfs().then((pdfs) => {
    for (const pdf of pdfs) {
      target.webContents.send("zhijiao:open-pdf", pdf);
    }
  });
}

function focusMainWindow() {
  if (!mainWindow) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

ipcMain.handle("zhijiao:take-pending-pdfs", () => {
  rendererReady = true;
  return readPendingPdfs();
});

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  if (!isPdfPath(filePath)) {
    return;
  }
  queuePdf(filePath);
  if (!app.isReady()) {
    return;
  }
  // macOS keeps the app alive with every window closed; reopen one for it.
  if (mainWindow) {
    focusMainWindow();
  } else {
    void openMainWindow();
  }
});

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
      // preload.cjs (CommonJS) — a sandboxed renderer cannot load an ESM
      // preload, so this must stay .cjs or window.desktopShell breaks.
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  // A (re)loading renderer has no open-pdf listener until it mounts again.
  window.webContents.on("did-start-loading", () => {
    rendererReady = false;
  });
  window.on("closed", () => {
    rendererReady = false;
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  mainWindow = window;
  return window;
}

async function openMainWindow() {
  const window = createMainWindow();
  await window.loadURL(getTargetUrl());
}

function getTargetUrl() {
  return isDev ? rendererUrl : `http://127.0.0.1:${startedServer.port}`;
}

// One instance only. A second launch — Windows does this when you open a PDF
// while the app is running — would also try to bind the embedded server's
// port; it hands its PDFs to the running instance and quits instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv, workingDirectory) => {
    pdfPathsFromArgv(argv.slice(1), workingDirectory).forEach(queuePdf);
    focusMainWindow();
  });

  app.whenReady().then(async () => {
    if (!isDev) {
      process.env.ZHIJIAO_USER_DATA = app.getPath("userData");
      startedServer = await startEmbeddedServer();
    }

    pdfPathsFromArgv(process.argv.slice(1), process.cwd()).forEach(queuePdf);
    await openMainWindow();
  });
}

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
    await openMainWindow();
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
