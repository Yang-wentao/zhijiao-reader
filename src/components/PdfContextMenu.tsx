import { useEffect, useRef } from "react";

// Preset highlight colors offered in the right-click menu. Stored as hex so
// they round-trip cleanly through the PDF `/C` annotation color and back.
export const HIGHLIGHT_COLORS: { name: string; hex: string }[] = [
  { name: "黄色", hex: "#FFE920" },
  { name: "绿色", hex: "#A8E66C" },
  { name: "蓝色", hex: "#7FD0FF" },
  { name: "粉色", hex: "#FFAFC8" },
  { name: "紫色", hex: "#C9A8FF" },
];

export type PdfContextMenuProps = {
  x: number;
  y: number;
  /**
   * When true, the menu shows a "翻译" item under the colors. We render it
   * only when the user has switched their translation trigger to "menu"
   * mode — otherwise selections auto-translate and a menu item is just noise.
   */
  showTranslate: boolean;
  /**
   * When true the selection geometry was captured and a highlight can be
   * created. False for a selection we couldn't measure.
   */
  canHighlight: boolean;
  onClose: () => void;
  onTranslate: () => void;
  onHighlight: (colorHex: string) => void;
  /** Create a highlight and open its comment card straight into edit mode. */
  onComment: () => void;
};

export function PdfContextMenu({
  x,
  y,
  showTranslate,
  canHighlight,
  onClose,
  onTranslate,
  onHighlight,
  onComment,
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

  return (
    <div
      ref={ref}
      className="pdf-context-menu"
      role="menu"
      style={{ left: x, top: y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {canHighlight ? (
        <>
          <div className="pdf-context-menu-colors" role="group" aria-label="高亮颜色">
            {HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color.hex}
                type="button"
                className="pdf-context-color-swatch"
                style={{ backgroundColor: color.hex }}
                aria-label={`高亮：${color.name}`}
                title={`高亮：${color.name}`}
                onClick={() => {
                  onHighlight(color.hex);
                  onClose();
                }}
              />
            ))}
          </div>
          <button
            type="button"
            role="menuitem"
            className="pdf-context-menu-item"
            onClick={() => {
              onComment();
              onClose();
            }}
          >
            添加评论
          </button>
        </>
      ) : null}
      {showTranslate ? (
        <>
          {canHighlight ? <div className="pdf-context-menu-divider" role="separator" /> : null}
          <button
            type="button"
            role="menuitem"
            className="pdf-context-menu-item"
            onClick={() => {
              onTranslate();
              onClose();
            }}
          >
            翻译
          </button>
        </>
      ) : null}
    </div>
  );
}

export type HighlightContextMenuProps = {
  x: number;
  y: number;
  onClose: () => void;
  /** Open the comment card for this highlight in edit mode. */
  onComment: () => void;
  /** Remove the highlight (and its comment). */
  onRemove: () => void;
};

/** Menu shown when the user right-clicks an existing highlight. */
export function HighlightContextMenu({
  x,
  y,
  onClose,
  onComment,
  onRemove,
}: HighlightContextMenuProps) {
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
        onClick={() => {
          onRemove();
          onClose();
        }}
      >
        取消高亮
      </button>
      <button
        type="button"
        role="menuitem"
        className="pdf-context-menu-item"
        onClick={() => {
          onComment();
          onClose();
        }}
      >
        写批注
      </button>
    </div>
  );
}
