// CommonJS preload — NOT an ES module.
//
// Electron renderers are sandboxed by default (sandbox: true). A sandboxed
// preload script cannot use ESM `import`; it must be CommonJS. An ESM
// (`.mjs`) preload silently fails to load under the sandbox, which means
// `window.desktopShell` would never be defined and the renderer could not
// resolve PDF file paths for writing annotations. Hence: `.cjs` + `require`.
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("desktopShell", {
  isElectron: true,
  // Resolve the real on-disk path for a File obtained from <input type=file>
  // or a drag-drop. Electron removed the legacy non-standard `File.path`
  // property, so `webUtils.getPathForFile` is the only supported way. The
  // renderer needs this path so the backend can write highlight annotations
  // back into the original PDF. Returns null when it can't be determined.
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || null;
    } catch {
      return null;
    }
  },
  // PDFs the OS asked the app to open (「打开方式」/ double-click). Call
  // takePendingPdfs once on mount for the ones that arrived before the UI
  // existed — that call also tells the main process the listener is live —
  // and onOpenPdf for the ones that arrive later. Each is { path, name, data }.
  takePendingPdfs: () => ipcRenderer.invoke("zhijiao:take-pending-pdfs"),
  onOpenPdf: (callback) => {
    const listener = (_event, pdf) => callback(pdf);
    ipcRenderer.on("zhijiao:open-pdf", listener);
    return () => ipcRenderer.removeListener("zhijiao:open-pdf", listener);
  },
});
