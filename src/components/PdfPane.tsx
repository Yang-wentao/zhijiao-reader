import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SpecialZoomLevel, Worker, Viewer, type RenderPageProps } from "@react-pdf-viewer/core";
import { searchPlugin } from "@react-pdf-viewer/search";
import "@react-pdf-viewer/core/lib/styles/index.css";
import "@react-pdf-viewer/search/lib/styles/index.css";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.js?url";
import { IS_WEB_BUILD } from "../lib/appMode";
import type { HighlightRect, PdfContextSelection, PdfHighlight, PdfTabSummary } from "../types";

// A paper to try the reader on when the visitor has none to hand. Served by
// the gateway next to the app, fetched straight into memory and handed to the
// normal open-a-file path — nothing is saved to the visitor's device.
const SAMPLE_PDF_URL = "/deepseek-v4-report.pdf";
const SAMPLE_PDF_NAME = "DeepSeek V4 技术报告.pdf";

type PdfPaneProps = {
  tabs: PdfTabSummary[];
  activeTabId: string | null;
  // Whether the active tab has an undoable highlight / unsaved highlight
  // changes — drives the undo / save buttons in the toolbar.
  canUndo: boolean;
  canSave: boolean;
  onUndo: () => void;
  onSaveHighlights: () => void;
  // Comment editing — the highlight whose comment card is open in edit mode,
  // the author name to stamp/show, plus the callbacks that mutate comment
  // state up in App.
  editingHighlightId: string | null;
  commentAuthor: string;
  onStartEditComment: (highlightId: string) => void;
  onStopEditComment: () => void;
  onCommentChange: (highlightId: string, comment: string) => void;
  onCommentDelete: (highlightId: string) => void;
  // Right-click on an existing highlight → menu (取消高亮 / 写批注).
  onHighlightContextMenu: (highlightId: string, x: number, y: number) => void;
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
  canUndo,
  canSave,
  onUndo,
  onSaveHighlights,
  editingHighlightId,
  commentAuthor,
  onStartEditComment,
  onStopEditComment,
  onCommentChange,
  onCommentDelete,
  onHighlightContextMenu,
  onFileSelected,
  onSelectionCaptured,
  onContextSelection,
  onTabSelected,
  onTabClosed,
  onTabPageIndexChange,
  onTabScrollTopChange,
}: PdfPaneProps) {
  const [sampleState, setSampleState] = useState<"idle" | "loading" | "error">("idle");
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

  // Downloads into a Blob, wraps it in a File, and feeds it to the same
  // handler a picked file goes through — so the sample opens exactly like a
  // local PDF and never lands in the visitor's downloads folder.
  async function openSamplePdf() {
    setSampleState("loading");
    try {
      const response = await fetch(SAMPLE_PDF_URL);
      if (!response.ok) {
        throw new Error(String(response.status));
      }
      const blob = await response.blob();
      onFileSelected(new File([blob], SAMPLE_PDF_NAME, { type: "application/pdf" }));
      setSampleState("idle");
    } catch {
      setSampleState("error");
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
          <div className="highlight-controls">
            <button
              type="button"
              className="icon-button"
              aria-label="撤销高亮"
              title="撤销高亮（⌘Z）"
              disabled={!canUndo}
              onClick={onUndo}
            >
              ↩
            </button>
            <button
              type="button"
              className={`icon-button highlight-save-button ${canSave ? "is-dirty" : ""}`.trim()}
              aria-label="保存高亮到 PDF"
              title="保存高亮到 PDF 文件（⌘S）"
              disabled={!canSave}
              onClick={onSaveHighlights}
            >
              保存
            </button>
          </div>
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
              {IS_WEB_BUILD ? (
                <div className="pdf-dropzone-sample">
                  <p>手边没有 PDF？</p>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={sampleState === "loading"}
                    onClick={() => void openSamplePdf()}
                  >
                    {sampleState === "loading" ? "正在打开…" : "试读 DeepSeek V4 技术报告"}
                  </button>
                  {sampleState === "error" ? (
                    <p className="pdf-dropzone-sample-error">没能打开示例文件，请稍后重试。</p>
                  ) : null}
                </div>
              ) : null}
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
                highlights={tab.highlights ?? []}
                editingHighlightId={editingHighlightId}
                commentAuthor={commentAuthor}
                onStartEditComment={onStartEditComment}
                onStopEditComment={onStopEditComment}
                onCommentChange={onCommentChange}
                onCommentDelete={onCommentDelete}
                onHighlightContextMenu={onHighlightContextMenu}
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
  highlights: PdfHighlight[];
  editingHighlightId: string | null;
  commentAuthor: string;
  onStartEditComment: (highlightId: string) => void;
  onStopEditComment: () => void;
  onCommentChange: (highlightId: string, comment: string) => void;
  onCommentDelete: (highlightId: string) => void;
  onHighlightContextMenu: (highlightId: string, x: number, y: number) => void;
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
  highlights,
  editingHighlightId,
  commentAuthor,
  onStartEditComment,
  onStopEditComment,
  onCommentChange,
  onCommentDelete,
  onHighlightContextMenu,
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
      // Right-click directly on an existing highlight → its own menu
      // (取消高亮 / 写批注), regardless of any text selection.
      const highlightEl = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        ".zhijiao-highlight-rect",
      );
      const highlightId = highlightEl?.dataset.highlightId;
      if (highlightId) {
        event.preventDefault();
        onHighlightContextMenu(highlightId, event.clientX, event.clientY);
        return;
      }
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
        rects: computeHighlightRects(range, container),
      });
    };

    document.addEventListener("mouseup", handleMouseUp);
    container.addEventListener("contextmenu", handleContextMenu);
    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      container.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [isActive, onSelectionCaptured, onContextSelection, onHighlightContextMenu]);

  // Group highlights by page, keeping each highlight's rects together. We
  // render one DOM group per highlight per page (not a flat list of rects)
  // so a multi-line highlight composites as a SINGLE translucent layer —
  // see the comment on .zhijiao-highlight-group in styles.css for why.
  const highlightsByPage = useMemo(() => {
    const map = new Map<
      number,
      { id: string; color: string; rects: HighlightRect[]; comment: string }[]
    >();
    for (const highlight of highlights) {
      const rectsByPage = new Map<number, HighlightRect[]>();
      for (const rect of highlight.rects) {
        const list = rectsByPage.get(rect.pageIndex) ?? [];
        list.push(rect);
        rectsByPage.set(rect.pageIndex, list);
      }
      for (const [pageIndex, rects] of Array.from(rectsByPage.entries())) {
        const pageList = map.get(pageIndex) ?? [];
        pageList.push({
          id: highlight.id,
          color: highlight.color,
          rects,
          comment: highlight.comment,
        });
        map.set(pageIndex, pageList);
      }
    }
    return map;
  }, [highlights]);

  // Custom page renderer: the default three layers (canvas / text /
  // annotation) plus our highlight overlay. Because the overlay is a child
  // of the page element it scrolls with the page for free — no scroll
  // listener, no coordinate recomputation. renderPage's reference only
  // changes when highlights change, so scrolling never re-renders pages.
  const renderPage = useCallback(
    (props: RenderPageProps) => {
      const pageHighlights = highlightsByPage.get(props.pageIndex) ?? [];
      return (
        <>
          {props.canvasLayer.children}
          {props.textLayer.children}
          {props.annotationLayer.children}
          <div className="zhijiao-highlight-layer">
            {pageHighlights.map((highlight) => (
              <div key={highlight.id} className="zhijiao-highlight-group">
                {highlight.rects.map((rect, index) => (
                  <div
                    key={index}
                    className="zhijiao-highlight-rect"
                    data-highlight-id={highlight.id}
                    style={{
                      left: `${rect.left * 100}%`,
                      top: `${rect.top * 100}%`,
                      width: `${rect.width * 100}%`,
                      height: `${rect.height * 100}%`,
                      backgroundColor: highlight.color,
                    }}
                    // Click a highlight to add / edit its comment;
                    // right-click for the 取消高亮 / 写批注 menu.
                    onClick={() => onStartEditComment(highlight.id)}
                    title="点击编辑评论 · 右键更多操作"
                  />
                ))}
              </div>
            ))}
          </div>
        </>
      );
    },
    [highlightsByPage, onStartEditComment],
  );

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
        renderPage={renderPage}
        onDocumentLoad={() => {
          isViewerSettledRef.current = true;
        }}
        onPageChange={(event) => {
          if (!isViewerSettledRef.current) return;
          onPageIndexChange?.(tabId, event.currentPage);
        }}
        plugins={[searchPluginInstance]}
      />
      {isActive ? (
        <CommentGutter
          containerRef={containerRef}
          highlights={highlights}
          zoomLevel={zoomLevel}
          editingHighlightId={editingHighlightId}
          commentAuthor={commentAuthor}
          onStartEditComment={onStartEditComment}
          onStopEditComment={onStopEditComment}
          onCommentChange={onCommentChange}
          onCommentDelete={onCommentDelete}
        />
      ) : null}
    </div>
  );
}

// Floating comment cards in the PDF's right margin. Each card is anchored to
// its highlight: we read the live page-layer geometry (so the card scrolls
// and zooms with the page) and stack cards top-to-bottom without overlap.
// Cards can also be dragged (by the header) and resized (bottom-right corner);
// those tweaks are kept per highlight for the current session.
type CommentGutterProps = {
  containerRef: React.RefObject<HTMLDivElement | null>;
  highlights: PdfHighlight[];
  zoomLevel: number | SpecialZoomLevel;
  editingHighlightId: string | null;
  commentAuthor: string;
  onStartEditComment: (highlightId: string) => void;
  onStopEditComment: () => void;
  onCommentChange: (highlightId: string, comment: string) => void;
  onCommentDelete: (highlightId: string) => void;
};

const COMMENT_CARD_DEFAULT_WIDTH = 250;

function CommentGutter({
  containerRef,
  highlights,
  zoomLevel,
  editingHighlightId,
  commentAuthor,
  onStartEditComment,
  onStopEditComment,
  onCommentChange,
  onCommentDelete,
}: CommentGutterProps) {
  // A card shows for any highlight that has a comment, plus the one currently
  // being edited (so a brand-new, still-empty comment gets an open card).
  const visible = useMemo(
    () =>
      highlights.filter(
        (h) => h.comment.trim() !== "" || h.id === editingHighlightId,
      ),
    [highlights, editingHighlightId],
  );

  const [tops, setTops] = useState<Map<string, number>>(new Map());
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // Bumped on scroll / resize to force a reposition pass.
  const [tick, setTick] = useState(0);
  // Per-card user tweaks (session-only): drag offset relative to the anchored
  // position, and a resized width / height.
  const [offsets, setOffsets] = useState<Map<string, { dx: number; dy: number }>>(new Map());
  const [sizes, setSizes] = useState<Map<string, { width: number; height: number }>>(new Map());

  // Recompute card positions whenever the page scrolls or the pane resizes.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let raf = 0;
    const bump = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setTick((t) => (t + 1) % 1_000_000));
    };
    let scrollEl: HTMLElement | null = null;
    let poll: number | null = null;
    const attach = () => {
      scrollEl = container.querySelector<HTMLElement>('[data-testid="core__inner-pages"]');
      if (!scrollEl) {
        poll = window.setTimeout(attach, 80);
        return;
      }
      scrollEl.addEventListener("scroll", bump, { passive: true });
    };
    attach();
    window.addEventListener("resize", bump);
    const observer = new ResizeObserver(bump);
    observer.observe(container);
    return () => {
      cancelAnimationFrame(raf);
      if (poll != null) window.clearTimeout(poll);
      scrollEl?.removeEventListener("scroll", bump);
      window.removeEventListener("resize", bump);
      observer.disconnect();
    };
  }, [containerRef]);

  // After mount and after a zoom change the Viewer re-renders its pages
  // asynchronously; nudge a few repositions so cards re-anchor once the new
  // page-layer elements exist (no scroll event would otherwise fire).
  useEffect(() => {
    const timers = [120, 320, 650, 1100].map((delay) =>
      window.setTimeout(() => setTick((t) => (t + 1) % 1_000_000), delay),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [zoomLevel]);

  // Position pass: anchor each card to its highlight's top, then push cards
  // down so they never overlap. Runs after every render and converges (it
  // only writes state when a position actually changed).
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const containerBox = container.getBoundingClientRect();
    const anchored: { id: string; anchor: number }[] = [];
    for (const highlight of visible) {
      const rect = topMostRect(highlight.rects);
      if (!rect) continue;
      const pageEl = container.querySelector<HTMLElement>(
        `[data-testid="core__page-layer-${rect.pageIndex}"]`,
      );
      if (!pageEl) continue;
      const pageBox = pageEl.getBoundingClientRect();
      if (pageBox.height <= 0) continue;
      anchored.push({
        id: highlight.id,
        anchor: pageBox.top + rect.top * pageBox.height - containerBox.top,
      });
    }
    anchored.sort((a, b) => a.anchor - b.anchor);

    const next = new Map<string, number>();
    let prevBottom = -Infinity;
    for (const { id, anchor } of anchored) {
      const height = cardRefs.current.get(id)?.offsetHeight ?? 96;
      const top = Math.round(Math.max(anchor, prevBottom + 10));
      next.set(id, top);
      prevBottom = top + height;
    }

    let changed = next.size !== tops.size;
    if (!changed) {
      for (const [id, top] of Array.from(next)) {
        if (tops.get(id) !== top) {
          changed = true;
          break;
        }
      }
    }
    if (changed) setTops(next);
    // tick / zoomLevel are intentional triggers; tops drives the convergence.
  }, [containerRef, visible, tops, tick, zoomLevel]);

  // Drag a card by its header. The offset is stored relative to the anchored
  // position, so the card still scrolls with the page after being moved.
  function startDrag(event: React.MouseEvent, id: string) {
    if ((event.target as HTMLElement).closest(".zhijiao-comment-close")) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const base = offsets.get(id) ?? { dx: 0, dy: 0 };
    const onMove = (move: MouseEvent) => {
      setOffsets((current) => {
        const updated = new Map(current);
        updated.set(id, {
          dx: base.dx + (move.clientX - startX),
          dy: base.dy + (move.clientY - startY),
        });
        return updated;
      });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // Resize is handled by the browser via CSS `resize: both`; we just capture
  // the final size (after the drag on the bottom-right corner ends) so it
  // survives re-renders and the card scrolling out of view and back.
  function startMaybeResize(event: React.MouseEvent, id: string) {
    const el = cardRefs.current.get(id);
    if (!el) return;
    const box = el.getBoundingClientRect();
    const inResizeCorner = event.clientX >= box.right - 22 && event.clientY >= box.bottom - 22;
    if (!inResizeCorner) return;
    const capture = () => {
      window.removeEventListener("mouseup", capture);
      setSizes((current) => {
        const updated = new Map(current);
        updated.set(id, { width: el.offsetWidth, height: el.offsetHeight });
        return updated;
      });
    };
    window.addEventListener("mouseup", capture);
  }

  return (
    <div className="zhijiao-comment-gutter">
      {visible.map((highlight) => {
        const offset = offsets.get(highlight.id);
        const size = sizes.get(highlight.id);
        const isEditing = editingHighlightId === highlight.id;
        // Height auto-fits the comment by default; an explicit height is used
        // only after the user has resized the card (and never while editing,
        // so the growing textarea drives the card's height instead).
        const cardStyle: React.CSSProperties = {
          top: (tops.get(highlight.id) ?? 0) + (offset?.dy ?? 0),
          right: 14 - (offset?.dx ?? 0),
          width: size?.width ?? COMMENT_CARD_DEFAULT_WIDTH,
          visibility: tops.has(highlight.id) ? "visible" : "hidden",
        };
        if (size && !isEditing) {
          cardStyle.height = size.height;
        }
        return (
          <div
            key={highlight.id}
            ref={(el) => {
              if (el) cardRefs.current.set(highlight.id, el);
              else cardRefs.current.delete(highlight.id);
            }}
            className="zhijiao-comment-card"
            style={cardStyle}
            onMouseDown={(event) => startMaybeResize(event, highlight.id)}
          >
            <div
              className="zhijiao-comment-head"
              onMouseDown={(event) => startDrag(event, highlight.id)}
              title="拖动可移动卡片"
            >
              <span className="zhijiao-comment-author">
                {highlight.author || commentAuthor || "未署名"}
              </span>
              <span className="zhijiao-comment-time">
                {formatCommentTime(highlight.createdAt)}
              </span>
              <button
                type="button"
                className="zhijiao-comment-close"
                aria-label="删除评论"
                title="删除评论"
                onClick={() => onCommentDelete(highlight.id)}
              >
                ×
              </button>
            </div>
            {isEditing ? (
              <CommentEditArea
                value={highlight.comment}
                onChange={(value) => onCommentChange(highlight.id, value)}
                onBlur={onStopEditComment}
              />
            ) : (
              <div
                className="zhijiao-comment-body"
                onClick={() => onStartEditComment(highlight.id)}
                title="点击编辑"
              >
                {highlight.comment}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// The comment editor — a textarea that auto-grows to fit what's typed, so the
// card's height tracks its content the same way the display body does.
function CommentEditArea({
  value,
  onChange,
  onBlur,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      className="zhijiao-comment-input"
      autoFocus
      value={value}
      placeholder="输入评论…"
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
    />
  );
}

// The rect a comment card anchors to: topmost line on the earliest page.
function topMostRect(rects: HighlightRect[]): HighlightRect | null {
  let best: HighlightRect | null = null;
  for (const rect of rects) {
    if (
      !best ||
      rect.pageIndex < best.pageIndex ||
      (rect.pageIndex === best.pageIndex && rect.top < best.top)
    ) {
      best = rect;
    }
  }
  return best;
}

function formatCommentTime(ms: number): string {
  const d = new Date(Number.isFinite(ms) ? ms : Date.now());
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
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

// Convert a text selection into highlight rectangles in page-relative
// fractions (0..1, top-left origin). The result is zoom-independent (rect
// and page element scale together).
//
// IMPORTANT: range.getClientRects() returns several overlapping bands per
// visual line — one per text span, plus extra bands with slightly different
// font metrics. Writing each band as its own PDF QuadPoint makes WPS render
// the line darker wherever bands overlap (the "darker middle lines" bug).
// So we merge every raw rect that sits on the same visual line into ONE
// rectangle: union its horizontal extent, and use a single Y-band per line.
function computeHighlightRects(range: Range, container: HTMLElement): HighlightRect[] {
  const pageBoxes = Array.from(
    container.querySelectorAll<HTMLElement>('[data-testid^="core__page-layer-"]'),
  )
    .map((el) => ({ index: pageLayerIndex(el), box: el.getBoundingClientRect() }))
    .filter((p) => p.index != null && p.box.width > 0 && p.box.height > 0);
  if (pageBoxes.length === 0) {
    return [];
  }

  // 1. Assign each raw client rect to a page, keep client-pixel coordinates.
  type LineRect = { pageIndex: number; left: number; right: number; top: number; bottom: number };
  const raw: LineRect[] = [];
  for (const clientRect of Array.from(range.getClientRects())) {
    if (clientRect.width < 1 || clientRect.height < 1) continue;
    const centerX = clientRect.left + clientRect.width / 2;
    const centerY = clientRect.top + clientRect.height / 2;
    const page = pageBoxes.find(
      (p) =>
        centerX >= p.box.left &&
        centerX <= p.box.right &&
        centerY >= p.box.top &&
        centerY <= p.box.bottom,
    );
    if (!page || page.index == null) continue;
    raw.push({
      pageIndex: page.index,
      left: clientRect.left,
      right: clientRect.right,
      top: clientRect.top,
      bottom: clientRect.bottom,
    });
  }

  // 2. Merge raw rects that share a visual line (same page, vertical centers
  //    close relative to line height) into a single rectangle.
  const lines: LineRect[] = [];
  for (const r of raw) {
    const rHeight = r.bottom - r.top;
    const rCenter = (r.top + r.bottom) / 2;
    const line = lines.find((l) => {
      if (l.pageIndex !== r.pageIndex) return false;
      const lCenter = (l.top + l.bottom) / 2;
      const tol = Math.max(rHeight, l.bottom - l.top) * 0.5;
      return Math.abs(lCenter - rCenter) <= tol;
    });
    if (line) {
      line.left = Math.min(line.left, r.left);
      line.right = Math.max(line.right, r.right);
      line.top = Math.min(line.top, r.top);
      line.bottom = Math.max(line.bottom, r.bottom);
    } else {
      lines.push({ ...r });
    }
  }

  // 3. Defensive: keep merged lines from vertically overlapping each other,
  //    which would also create a doubled QuadPoint band between lines.
  const byPage = new Map<number, LineRect[]>();
  for (const l of lines) {
    const arr = byPage.get(l.pageIndex) ?? [];
    arr.push(l);
    byPage.set(l.pageIndex, arr);
  }
  for (const arr of Array.from(byPage.values())) {
    arr.sort((a, b) => a.top - b.top);
    for (let i = 0; i < arr.length - 1; i += 1) {
      if (arr[i].bottom > arr[i + 1].top) {
        const mid = (arr[i].bottom + arr[i + 1].top) / 2;
        arr[i].bottom = mid;
        arr[i + 1].top = mid;
      }
    }
  }

  // 4. Express each merged line relative to its page element.
  const rects: HighlightRect[] = [];
  for (const l of lines) {
    const page = pageBoxes.find((p) => p.index === l.pageIndex);
    if (!page) continue;
    rects.push({
      pageIndex: l.pageIndex,
      left: (l.left - page.box.left) / page.box.width,
      top: (l.top - page.box.top) / page.box.height,
      width: (l.right - l.left) / page.box.width,
      height: (l.bottom - l.top) / page.box.height,
    });
  }
  return rects;
}

function pageLayerIndex(el: HTMLElement): number | null {
  const raw = (el.getAttribute("data-testid") ?? "").replace("core__page-layer-", "");
  const index = Number(raw);
  return Number.isInteger(index) && index >= 0 ? index : null;
}
