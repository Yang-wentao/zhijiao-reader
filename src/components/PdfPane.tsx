import { useEffect, useRef, useState } from "react";
import { SpecialZoomLevel, Worker, Viewer } from "@react-pdf-viewer/core";
import { searchPlugin } from "@react-pdf-viewer/search";
import "@react-pdf-viewer/core/lib/styles/index.css";
import "@react-pdf-viewer/search/lib/styles/index.css";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.js?url";
import type { PdfTabSummary, SelectionOverlay } from "../types";

type PdfPaneProps = {
  tabs: PdfTabSummary[];
  activeTabId: string | null;
  activeFileUrl: string | null;
  activeFileName: string | null;
  onFileSelected: (file: File) => void;
  onSelectionCaptured: (selection: SelectionOverlay | null) => void;
  onTabSelected: (tabId: string) => void;
  onTabClosed: (tabId: string) => void;
};

export function PdfPane({
  tabs,
  activeTabId,
  activeFileUrl,
  activeFileName,
  onFileSelected,
  onSelectionCaptured,
  onTabSelected,
  onTabClosed,
}: PdfPaneProps) {
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number | SpecialZoomLevel>(SpecialZoomLevel.PageWidth);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchPluginInstance = searchPlugin();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handleMouseUp = () => {
      window.requestAnimationFrame(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
          onSelectionCaptured(null);
          return;
        }

        const range = selection.getRangeAt(0);
        const commonNode = range.commonAncestorContainer;
        if (!container.contains(commonNode)) {
          return;
        }

        const selectedText = selection.toString().trim();
        if (!selectedText) {
          onSelectionCaptured(null);
          return;
        }

        const rect = range.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
          setSelectionError("This PDF may not expose selectable text. Scanned PDFs are not supported in MVP.");
          onSelectionCaptured(null);
          return;
        }

        setSelectionError(null);
        onSelectionCaptured({
          text: selectedText,
          pageNumber: findPageNumber(commonNode),
          x: rect.left + rect.width / 2,
          y: rect.bottom + 12,
        });
      });
    };

    container.addEventListener("mouseup", handleMouseUp);
    return () => container.removeEventListener("mouseup", handleMouseUp);
  }, [onSelectionCaptured]);

  return (
    <div className="pdf-shell">
      <div className="pdf-toolbar">
        <label className="upload-button">
          <input
            type="file"
            accept="application/pdf"
            multiple
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              for (const file of files) {
                onFileSelected(file);
              }
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
          <span className="pdf-file-name">{activeFileName ?? "未打开 PDF"}</span>
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
          <div className="empty-state">
            <h2>打开一篇 PDF 开始阅读</h2>
            <p>建议使用文字可选的 PDF；扫描图片版 PDF 暂不支持。</p>
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
      {selectionError ? <p className="inline-warning">{selectionError}</p> : null}
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
