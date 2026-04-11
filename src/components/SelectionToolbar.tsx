import type { SelectionOverlay } from "../types";

type SelectionToolbarProps = {
  selection: SelectionOverlay;
  questionActionLabel: string;
  onTranslate: () => void;
  onAsk: () => void;
};

export function SelectionToolbar({
  selection,
  questionActionLabel,
  onTranslate,
  onAsk,
}: SelectionToolbarProps) {
  return (
    <div
      className="selection-toolbar"
      style={{
        left: selection.x,
        top: selection.y,
      }}
    >
      <button type="button" className="toolbar-button" onClick={onTranslate}>
        Translate
      </button>
      <button type="button" className="toolbar-button toolbar-button-primary" onClick={onAsk}>
        {questionActionLabel}
      </button>
    </div>
  );
}
