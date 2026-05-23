import "@testing-library/jest-dom";

// jsdom doesn't implement IntersectionObserver / ResizeObserver, but
// @react-pdf-viewer's Viewer constructs both on mount. Provide inert stubs so
// component tests that render a Viewer don't crash on construction.
class InertObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

if (typeof globalThis.IntersectionObserver === "undefined") {
  globalThis.IntersectionObserver = InertObserver as unknown as typeof IntersectionObserver;
}
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = InertObserver as unknown as typeof ResizeObserver;
}
