import { useRef } from "react";
import { ResizableDivider } from "./ResizableDivider";

type SplitLayoutProps = {
  ratio: number;
  onRatioChange: (nextRatio: number) => void;
  left: React.ReactNode;
  right: React.ReactNode;
};

const MIN_RATIO = 0.5;
const MAX_RATIO = 0.8;

export function clampRatio(nextRatio: number) {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, nextRatio));
}

export function SplitLayout({ ratio, onRatioChange, left, right }: SplitLayoutProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const pointerId = event.pointerId;
    event.currentTarget.setPointerCapture(pointerId);

    const handleMove = (moveEvent: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const nextRatio = clampRatio((moveEvent.clientX - rect.left) / rect.width);
      onRatioChange(nextRatio);
    };

    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  return (
    <div ref={containerRef} className="split-layout" style={{ gridTemplateColumns: `${ratio}fr 12px ${1 - ratio}fr` }}>
      <section className="pane pane-left">{left}</section>
      <ResizableDivider onPointerDown={handlePointerDown} />
      <aside className="pane pane-right">{right}</aside>
    </div>
  );
}
