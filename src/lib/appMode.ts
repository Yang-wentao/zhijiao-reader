// True in the browser-only bundle（网页版）: `vite --mode web` (dev) or
// `vite build --mode web` (built to site/app/, served at
// zhijiao-reader.com/app/ by the cloud/ gateway). Every other mode — desktop
// dev, the Electron production build, and vitest — keeps the local-server
// behavior.
export const IS_WEB_BUILD = import.meta.env.MODE === "web";
