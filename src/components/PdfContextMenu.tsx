import { useEffect, useRef } from "react";

export type PdfContextMenuProps = {
  x: number;
  y: number;
  notesReady: boolean;
  onClose: () => void;
  onAppendOriginal: () => void;
  onAppendWithTranslation: () => void;
};

export function PdfContextMenu({
  x,
  y,
  notesReady,
  onClose,
  onAppendOriginal,
  onAppendWithTranslation,
}: PdfContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  const disabledReason = !notesReady ? "请先在「设置」中启用并配置 Obsidian 笔记" : null;

  return (
    <div
      ref={ref}
      className="pdf-context-menu"
      role="menu"
      style={{ left: x, top: y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        className="pdf-context-menu-item"
        disabled={!notesReady}
        title={disabledReason ?? undefined}
        onClick={() => {
          onAppendOriginal();
          onClose();
        }}
      >
        加入笔记（原文）
      </button>
      <button
        type="button"
        role="menuitem"
        className="pdf-context-menu-item"
        disabled={!notesReady}
        title={disabledReason ?? undefined}
        onClick={() => {
          onAppendWithTranslation();
          onClose();
        }}
      >
        加入笔记（原文 + 译文）
      </button>
      {!notesReady ? <p className="pdf-context-menu-hint">{disabledReason}</p> : null}
    </div>
  );
}
