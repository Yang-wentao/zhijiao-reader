import { useEffect, useMemo, useRef, useState } from "react";
import { SpecialZoomLevel, Worker, Viewer } from "@react-pdf-viewer/core";
import { searchPlugin } from "@react-pdf-viewer/search";
import "@react-pdf-viewer/core/lib/styles/index.css";
import "@react-pdf-viewer/search/lib/styles/index.css";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.js?url";
import type { PdfContextSelection, PdfTabSummary } from "../types";

type PdfPaneProps = {
  tabs: PdfTabSummary[];
  activeTabId: string | null;
  onFileSelected: (file: File) => void;
  onSelectionCaptured: (text: string, pageNumber: number | null) => void;
  onContextSelection: (selection: PdfContextSelection) => void;
  onTabSelected: (tabId: string) => void;
  onTabClosed: (tabId: string) => void;
  onTabPageIndexChange?: (tabId: string, pageIndex: number) => void;
  onTabScrollTopChange?: (tabId: string, scrollTop: number) => void;
};

type SearchPluginInstance = ReturnType<typeof searchPlugin>;

export function PdfPane({
  tabs,
  activeTabId,
  onFileSelected,
  onSelectionCaptured,
  onContextSelection,
  onTabSelected,
  onTabClosed,
  onTabPageIndexChange,
  onTabScrollTopChange,
}: PdfPaneProps) {
  const [zoomLevel, setZoomLevel] = useState<number | SpecialZoomLevel>(SpecialZoomLevel.PageWidth);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const dragDepthRef = useRef(0);

  // ONE search plugin shared across every Viewer. Why not per-tab? Because
  // `searchPlugin()` internally calls React hooks (useMemo, useState, etc.),
  // so it must be invoked at component top level — unconditionally and once
  // per render — to satisfy the Rules of Hooks. Calling it inside a useMemo
  // or a Map.get-or-create helper makes the hook count vary between renders
  // and crashes the whole tree (white screen) the first time a tab is
  // opened. Only one Viewer is visible at any time, so a shared plugin
  // operates on the active Viewer in practice.
  const searchPluginInstance = searchPlugin();

  function ingestPdfFiles(fileList: FileList | File[] | null | undefined) {
    if (!fileList) {
      return;
    }
    const files = Array.from(fileList).filter(
      (file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"),
    );
    for (const file of files) {
      onFileSelected(file);
    }
  }

  function handleDragEnter(event: React.DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingFile(true);
  }
  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }
  function handleDragLeave(event: React.DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDraggingFile(false);
    }
  }
  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingFile(false);
    ingestPdfFiles(event.dataTransfer.files);
  }

  return (
    <div
      className={`pdf-shell ${isDraggingFile ? "dragging-file" : ""}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="pdf-toolbar">
        <label className="upload-button">
          <input
            type="file"
            accept="application/pdf"
            multiple
            onChange={(event) => {
              ingestPdfFiles(event.target.files);
              event.currentTarget.value = "";
            }}
          />
          <span>打开 PDF</span>
        </label>
        <div className="pdf-tab-strip" role="tablist" aria-label="Open PDFs">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`pdf-tab ${tab.id === activeTabId ? "active" : ""}`}
              role="presentation"
            >
              <button
                type="button"
                className="pdf-tab-button"
                onClick={() => onTabSelected(tab.id)}
                aria-pressed={tab.id === activeTabId}
              >
                {tab.fileName}
              </button>
              <button
                type="button"
                className="pdf-tab-close"
                aria-label={`Close ${tab.fileName}`}
                onClick={() => onTabClosed(tab.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="pdf-toolbar-meta">
          <div className="zoom-controls">
            <button
              type="button"
              className="icon-button"
              aria-label="Zoom out"
              disabled={!activeTabId}
              onClick={() => setZoomLevel((current) => getNextZoomLevel(current, -1))}
            >
              A-
            </button>
            <button
              type="button"
              className="icon-button zoom-indicator"
              disabled={!activeTabId}
              onClick={() => setZoomLevel(SpecialZoomLevel.PageWidth)}
            >
              {formatZoomLabel(zoomLevel)}
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Zoom in"
              disabled={!activeTabId}
              onClick={() => setZoomLevel((current) => getNextZoomLevel(current, 1))}
            >
              A+
            </button>
          </div>
          {activeTabId ? <searchPluginInstance.ShowSearchPopover /> : null}
        </div>
      </div>
      <div className="pdf-viewer-area">
        {tabs.length === 0 ? (
          <div className={`pdf-dropzone ${isDraggingFile ? "active" : ""}`}>
            <div className="pdf-dropzone-inner">
              <div className="pdf-dropzone-icon" aria-hidden="true">
                📄
              </div>
              <h2>把 PDF 拖到这里</h2>
              <p>或点击下方按钮选择文件</p>
              <label className="upload-button upload-button-large">
                <input
                  type="file"
                  accept="application/pdf"
                  multiple
                  onChange={(event) => {
                    ingestPdfFiles(event.target.files);
                    event.currentTarget.value = "";
                  }}
                />
                <span>选择 PDF 文件</span>
              </label>
              <p className="pdf-dropzone-hint">
                建议使用文字可选的 PDF；扫描图片版 PDF 暂不支持。
              </p>
            </div>
          </div>
        ) : (
          <Worker workerUrl={workerUrl}>
            {tabs.map((tab) => (
              <PdfTabViewer
                key={tab.id}
                tabId={tab.id}
                fileUrl={tab.fileUrl}
                isActive={tab.id === activeTabId}
                initialPageIndex={tab.lastPageIndex ?? 0}
                initialScrollTop={tab.lastScrollTop ?? 0}
                zoomLevel={zoomLevel}
                searchPluginInstance={searchPluginInstance}
                onPageIndexChange={onTabPageIndexChange}
                onScrollTopChange={onTabScrollTopChange}
                onSelectionCaptured={onSelectionCaptured}
                onContextSelection={onContextSelection}
              />
            ))}
          </Worker>
        )}
      </div>
    </div>
  );
}

type PdfTabViewerProps = {
  tabId: string;
  fileUrl: string;
  isActive: boolean;
  initialPageIndex: number;
  initialScrollTop: number;
  zoomLevel: number | SpecialZoomLevel;
  searchPluginInstance: SearchPluginInstance;
  onPageIndexChange?: (tabId: string, pageIndex: number) => void;
  onScrollTopChange?: (tabId: string, scrollTop: number) => void;
  onSelectionCaptured: (text: string, pageNumber: number | null) => void;
  onContextSelection: (selection: PdfContextSelection) => void;
};

function PdfTabViewer({
  tabId,
  fileUrl,
  isActive,
  initialPageIndex,
  initialScrollTop,
  zoomLevel,
  searchPluginInstance,
  onPageIndexChange,
  onScrollTopChange,
  onSelectionCaptured,
  onContextSelection,
}: PdfTabViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isViewerSettledRef = useRef(false);
  const lastTranslatedTextRef = useRef("");
  // Mirrors `isActive` so handlers running outside React's render cycle
  // (the scroll listener attached imperatively to the inner-pages element)
  // can check liveness without re-binding on every isActive flip.
  const isActiveRef = useRef(isActive);
  // True briefly during a "just-became-active" transition: between the
  // moment isActive flips false→true and the moment our scrollTop restore
  // has settled. While true, scroll events are NOT saved — react-pdf-viewer
  // emits programmatic scrolls (virtualizer.scrollToItem etc.) when a
  // hidden viewer is revealed, and they'd otherwise be misread as user
  // intent and clobber the saved scrollTop with intermediate values like 0.
  const isRestoringRef = useRef(false);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    isViewerSettledRef.current = false;
    const timer = window.setTimeout(() => {
      isViewerSettledRef.current = true;
    }, 800);
    return () => window.clearTimeout(timer);
  }, [fileUrl, zoomLevel]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) {
      return;
    }
    const targetScrollTop = initialScrollTop;
    let scrollEl: HTMLElement | null = null;
    let saveTimer: number | null = null;
    let pollHandle: number | null = null;
    let restored = false;

    function commitScrollTop(el: HTMLElement) {
      if (saveTimer != null) window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        onScrollTopChange?.(tabId, el.scrollTop);
      }, 150);
    }
    function handleScroll(event: Event) {
      if (!restored) return;
      // Only save scrolls that come from the active (visible) tab and only
      // OUTSIDE the post-activation restore window. Programmatic scrolls
      // fired by react-pdf-viewer's internals when a tab becomes visible
      // would otherwise clobber the saved scrollTop with junk values like 0.
      if (!isActiveRef.current) return;
      if (isRestoringRef.current) return;
      commitScrollTop(event.currentTarget as HTMLElement);
    }
    function tryAttach() {
      scrollEl = root!.querySelector<HTMLElement>('[data-testid="core__inner-pages"]');
      if (!scrollEl) {
        pollHandle = window.setTimeout(tryAttach, 60);
        return;
      }
      scrollEl.addEventListener("scroll", handleScroll, { passive: true });
      if (targetScrollTop > 0) {
        const apply = () => {
          if (!scrollEl) return;
          const maxScrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
          scrollEl.scrollTop = Math.min(targetScrollTop, maxScrollTop);
          restored = true;
        };
        window.setTimeout(() => {
          requestAnimationFrame(() => requestAnimationFrame(apply));
        }, 80);
      } else {
        restored = true;
      }
    }
    pollHandle = window.setTimeout(tryAttach, 0);

    return () => {
      if (pollHandle != null) window.clearTimeout(pollHandle);
      if (saveTimer != null) window.clearTimeout(saveTimer);
      if (scrollEl) scrollEl.removeEventListener("scroll", handleScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl, zoomLevel, tabId]);

  const wasActiveRef = useRef(isActive);
  useEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = isActive;
    if (!isActive || wasActive) return;
    // The tab just became active again after being hidden. Two things go
    // wrong without this code path:
    //   1. Chromium doesn't reliably preserve scrollTop across
    //      display:none → display:block on a virtualised scroller.
    //   2. react-pdf-viewer's IntersectionObserver fires when the Viewer
    //      becomes visible and runs some internal scroll adjustment ~150ms
    //      later that resets scrollTop to 0.
    // A single rAF restore handles (1) but (2) overrides it. So we
    // continuously re-apply the target scrollTop every frame for ~500ms,
    // which beats any internal reset back into submission. Meanwhile the
    // isRestoringRef gate stops the scroll listener from saving any of
    // these intermediate values to state.
    if (initialScrollTop <= 0) return;
    const scrollEl = containerRef.current?.querySelector<HTMLElement>(
      '[data-testid="core__inner-pages"]',
    );
    if (!scrollEl) return;
    isRestoringRef.current = true;
    const start = performance.now();
    let frameId = 0;
    const tick = () => {
      const elapsed = performance.now() - start;
      const maxScrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
      const target = Math.min(initialScrollTop, maxScrollTop);
      if (scrollEl.scrollTop !== target) {
        scrollEl.scrollTop = target;
      }
      if (elapsed < 500) {
        frameId = requestAnimationFrame(tick);
      } else {
        isRestoringRef.current = false;
      }
    };
    frameId = requestAnimationFrame(tick);
    return () => {
      if (frameId) cancelAnimationFrame(frameId);
      isRestoringRef.current = false;
    };
  }, [isActive, initialScrollTop]);

  useEffect(() => {
    if (!isActive) return;
    const container = containerRef.current;
    if (!container) return;

    const handleMouseUp = (event: MouseEvent) => {
      if (event.button === 2) return;
      window.setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
          lastTranslatedTextRef.current = "";
          return;
        }
        const range = selection.getRangeAt(0);
        if (!container.contains(range.commonAncestorContainer)) {
          return;
        }
        const text = selection.toString().trim();
        if (!text || text === lastTranslatedTextRef.current) return;
        lastTranslatedTextRef.current = text;
        onSelectionCaptured(text, findPageNumber(range.startContainer));
      }, 0);
    };

    const handleContextMenu = (event: MouseEvent) => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer)) return;
      const text = selection.toString().trim();
      if (!text) return;
      event.preventDefault();
      onContextSelection({
        text,
        startPage: findPageNumber(range.startContainer),
        endPage: findPageNumber(range.endContainer),
        x: event.clientX,
        y: event.clientY,
      });
    };

    document.addEventListener("mouseup", handleMouseUp);
    container.addEventListener("contextmenu", handleContextMenu);
    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      container.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [isActive, onSelectionCaptured, onContextSelection]);

  return (
    <div
      ref={containerRef}
      className="pdf-tab-viewer"
      // Why visibility + absolute instead of display:none/block?
      //
      // react-pdf-viewer uses an IntersectionObserver inside each Viewer to
      // decide whether to keep its page canvases rendered. `display: none`
      // makes the element have zero size → IO reports "not visible" → the
      // render queue drops the canvases. Switching back then requires
      // ~500ms to re-paint every visible page (the bug we were debugging).
      //
      // With `visibility: hidden` + absolute positioning, the inactive
      // viewer is still laid out at full size (IO sees it as visible), its
      // canvases stay painted in memory, and switching is instantaneous —
      // we just flip which one wins the z-stack.
      style={{
        position: "absolute",
        inset: 0,
        visibility: isActive ? "visible" : "hidden",
        pointerEvents: isActive ? "auto" : "none",
        zIndex: isActive ? 1 : 0,
      }}
    >
      <Viewer
        key={typeof zoomLevel === "string" ? zoomLevel : zoomLevel.toFixed(2)}
        fileUrl={fileUrl}
        defaultScale={zoomLevel}
        initialPage={initialPageIndex}
        onDocumentLoad={() => {
          isViewerSettledRef.current = true;
        }}
        onPageChange={(event) => {
          if (!isViewerSettledRef.current) return;
          onPageIndexChange?.(tabId, event.currentPage);
        }}
        plugins={[searchPluginInstance]}
      />
    </div>
  );
}

const ZOOM_STEPS = [0.8, 0.95, 1.1, 1.25, 1.45, 1.7, 2];

function getNextZoomLevel(current: number | SpecialZoomLevel, direction: -1 | 1) {
  const currentValue = typeof current === "number" ? current : 1.1;
  const currentIndex = findClosestZoomIndex(currentValue);
  const nextIndex = Math.max(0, Math.min(ZOOM_STEPS.length - 1, currentIndex + direction));
  return ZOOM_STEPS[nextIndex];
}

function findClosestZoomIndex(value: number) {
  return ZOOM_STEPS.reduce((bestIndex, step, index) => {
    const bestDistance = Math.abs(ZOOM_STEPS[bestIndex] - value);
    const nextDistance = Math.abs(step - value);
    return nextDistance < bestDistance ? index : bestIndex;
  }, 0);
}

function formatZoomLabel(zoomLevel: number | SpecialZoomLevel) {
  if (typeof zoomLevel === "string") {
    return "适合宽度";
  }
  return `${Math.round(zoomLevel * 100)}%`;
}

function findPageNumber(node: Node | null): number | null {
  let current: Node | null = node;
  while (current) {
    if (current instanceof HTMLElement) {
      const explicitPage = current.dataset.pageNumber;
      if (explicitPage) {
        const pageNumber = Number(explicitPage);
        return Number.isFinite(pageNumber) ? pageNumber : null;
      }
      const testId = current.getAttribute("data-testid");
      if (testId?.startsWith("core__page-layer-")) {
        const index = Number(testId.replace("core__page-layer-", ""));
        return Number.isFinite(index) ? index + 1 : null;
      }
    }
    current = current.parentNode;
  }
  return null;
}
