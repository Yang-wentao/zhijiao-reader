import { useEffect, useRef, useState } from "react";
import { SpecialZoomLevel, Worker, Viewer } from "@react-pdf-viewer/core";
import { searchPlugin } from "@react-pdf-viewer/search";
import "@react-pdf-viewer/core/lib/styles/index.css";
import "@react-pdf-viewer/search/lib/styles/index.css";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.js?url";
import type { PdfContextSelection, PdfTabSummary } from "../types";

type PdfPaneProps = {
  tabs: PdfTabSummary[];
  activeTabId: string | null;
  activeFileUrl: string | null;
  onFileSelected: (file: File) => void;
  onSelectionCaptured: (text: string, pageNumber: number | null) => void;
  onContextSelection: (selection: PdfContextSelection) => void;
  onTabSelected: (tabId: string) => void;
  onTabClosed: (tabId: string) => void;
};

export function PdfPane({
  tabs,
  activeTabId,
  activeFileUrl,
  onFileSelected,
  onSelectionCaptured,
  onContextSelection,
  onTabSelected,
  onTabClosed,
}: PdfPaneProps) {
  const [zoomLevel, setZoomLevel] = useState<number | SpecialZoomLevel>(SpecialZoomLevel.PageWidth);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Track the last selection text we auto-translated so we don't re-fire when the
  // user clicks/right-clicks while the same selection is still on screen.
  const lastTranslatedTextRef = useRef<string>("");
  // Counts nested dragenter/dragleave so we don't flicker when the cursor moves
  // between child elements inside the drop target.
  const dragDepthRef = useRef(0);
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

  // Drag-and-drop: dropping a .pdf onto the left pane opens it in a NEW tab.
  // The handlers live on the outer .pdf-shell so users can drop anywhere on the
  // left side, including the empty-state hero area when no PDF is open yet.
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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    // Mouseup is captured at document level so the user can release the mouse
    // outside the PDF viewer (e.g. on the toolbar) and we still pick up the
    // selection. We then verify the selection is anchored INSIDE the PDF before
    // firing.
    const handleMouseUp = (event: MouseEvent) => {
      // Right-click handled separately (see contextmenu below); skip here so
      // we don't double-fire.
      if (event.button === 2) {
        return;
      }
      // Defer: at the time mouseup fires, the selection is sometimes still
      // settling (especially with PDF.js text layer overlays).
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
        if (!text || text === lastTranslatedTextRef.current) {
          return;
        }
        lastTranslatedTextRef.current = text;
        onSelectionCaptured(text, findPageNumber(range.startContainer));
      }, 0);
    };

    const handleContextMenu = (event: MouseEvent) => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        return;
      }
      const range = selection.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer)) {
        return;
      }
      const text = selection.toString().trim();
      if (!text) {
        return;
      }
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
  }, [onContextSelection, onSelectionCaptured]);

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
          {/* The active PDF is already indicated by the dark/highlighted tab in
              the tab strip — repeating the filename here just steals horizontal
              room from the tab strip. Keep the zoom + search controls only. */}
          <div className="zoom-controls">
            <button
              type="button"
              className="icon-button"
              aria-label="Zoom out"
              disabled={!activeFileUrl}
              onClick={() => setZoomLevel((current) => getNextZoomLevel(current, -1))}
            >
              A-
            </button>
            <button
              type="button"
              className="icon-button zoom-indicator"
              disabled={!activeFileUrl}
              onClick={() => setZoomLevel(SpecialZoomLevel.PageWidth)}
            >
              {formatZoomLabel(zoomLevel)}
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Zoom in"
              disabled={!activeFileUrl}
              onClick={() => setZoomLevel((current) => getNextZoomLevel(current, 1))}
            >
              A+
            </button>
          </div>
          <searchPluginInstance.ShowSearchPopover />
        </div>
      </div>
      <div ref={containerRef} className="pdf-viewer-area">
        {!activeFileUrl ? (
          <div className={`pdf-dropzone ${isDraggingFile ? "active" : ""}`}>
            <div className="pdf-dropzone-inner">
              <div className="pdf-dropzone-icon" aria-hidden="true">📄</div>
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
            <Viewer
              key={`${activeFileUrl}-${typeof zoomLevel === "string" ? zoomLevel : zoomLevel.toFixed(2)}`}
              fileUrl={activeFileUrl}
              defaultScale={zoomLevel}
              plugins={[searchPluginInstance]}
            />
          </Worker>
        )}
      </div>
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
