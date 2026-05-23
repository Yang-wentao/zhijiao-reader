// CommonJS preload — NOT an ES module.
//
// Electron renderers are sandboxed by default (sandbox: true). A sandboxed
// preload script cannot use ESM `import`; it must be CommonJS. An ESM
// (`.mjs`) preload silently fails to load under the sandbox, which means
// `window.desktopShell` would never be defined and the renderer could not
// resolve PDF file paths for writing annotations. Hence: `.cjs` + `require`.
const { contextBridge, webUtils } = require("electron");

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
});
