type ResizableDividerProps = {
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
};

export function ResizableDivider({ onPointerDown }: ResizableDividerProps) {
  return (
    <button
      type="button"
      className="divider"
      aria-label="Resize panels"
      onPointerDown={onPointerDown}
    />
  );
}
