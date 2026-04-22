import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PassageCard } from "./PassageCard";
import type { PassageCard as PassageCardType } from "../types";

function buildCard(overrides: Partial<PassageCardType> = {}): PassageCardType {
  return {
    id: "card-1",
    selectionText: "Selected passage",
    pageNumber: 3,
    mode: "translate",
    messages: [],
    status: "done",
    createdAt: Date.now(),
    collapsed: false,
    draftOutput: "",
    error: null,
    lastQuestion: null,
    ...overrides,
  };
}

describe("PassageCard", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders assistant paragraphs separately", () => {
    const card = buildCard({
      messages: [
        {
          id: "msg-1",
          role: "assistant",
          content: "第一段翻译。\n\n术语解释\n\nMTD：最大耐受剂量。",
        },
      ],
    });

    render(
      <PassageCard
        card={card}
        questionActionLabel="Ask ZhiJiao"
        onAsk={() => undefined}
        onDismiss={() => undefined}
        onToggle={() => undefined}
        onRetry={() => undefined}
        onNotice={() => undefined}
      />,
    );

    expect(screen.getByText("第一段翻译。")).toBeInTheDocument();
    expect(screen.getByText("术语解释")).toBeInTheDocument();
    expect(screen.getByText("MTD：最大耐受剂量。")).toBeInTheDocument();
  });

  it("shows a streaming status label while draft output is arriving", () => {
    const card = buildCard({
      status: "streaming",
      draftOutput: "正在一点点出现的译文",
    });

    render(
      <PassageCard
        card={card}
        questionActionLabel="Ask ZhiJiao"
        onAsk={() => undefined}
        onDismiss={() => undefined}
        onToggle={() => undefined}
        onRetry={() => undefined}
        onNotice={() => undefined}
      />,
    );

    expect(screen.getByText("正在生成…")).toBeInTheDocument();
  });

  it("renders the full selected passage in the card header", () => {
    const selectionText =
      "This is a long selected paragraph that should stay fully visible in the right panel without being truncated.";

    render(
      <PassageCard
        card={buildCard({ selectionText })}
        questionActionLabel="Ask ZhiJiao"
        onAsk={() => undefined}
        onDismiss={() => undefined}
        onToggle={() => undefined}
        onRetry={() => undefined}
        onNotice={() => undefined}
      />,
    );

    expect(screen.getByText(selectionText)).toBeInTheDocument();
    expect(screen.getByText(selectionText)).toHaveClass("card-selection-preview");
  });

  it("copies the latest assistant reply and reports success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const onNotice = vi.fn();

    render(
      <PassageCard
        card={buildCard({
          messages: [
            {
              id: "msg-1",
              role: "assistant",
              content: "可复制的译文",
            },
          ],
        })}
        questionActionLabel="Ask ZhiJiao"
        onAsk={() => undefined}
        onDismiss={() => undefined}
        onToggle={() => undefined}
        onRetry={() => undefined}
        onNotice={onNotice}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "复制译文" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("可复制的译文"));
    expect(onNotice).toHaveBeenCalledWith("已复制译文。");
  });

  it("falls back gracefully when clipboard copying fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("clipboard denied"));
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const onNotice = vi.fn();

    render(
      <PassageCard
        card={buildCard({
          messages: [
            {
              id: "msg-1",
              role: "assistant",
              content: "另一段译文",
            },
          ],
        })}
        questionActionLabel="Ask ZhiJiao"
        onAsk={() => undefined}
        onDismiss={() => undefined}
        onToggle={() => undefined}
        onRetry={() => undefined}
        onNotice={onNotice}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "复制译文" }));

    await waitFor(() => expect(onNotice).toHaveBeenCalled());
  });

  it("disables retry while the card is loading", () => {
    render(
      <PassageCard
        card={buildCard({ status: "loading" })}
        questionActionLabel="Ask ZhiJiao"
        onAsk={() => undefined}
        onDismiss={() => undefined}
        onToggle={() => undefined}
        onRetry={() => undefined}
        onNotice={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "重试中…" })).toBeDisabled();
  });

  it("renders assistant formulas with math markup instead of raw latex text", () => {
    const card = buildCard({
      messages: [
        {
          id: "msg-1",
          role: "assistant",
          content: "条件 M2 可写为 $s(t, x, a)= t\\\\frac{\\\\psi'}{\\\\psi}(x,a) + (1-t)\\\\frac{-\\\\psi'}{1-\\\\psi}(x,a)$。",
        },
      ],
    });

    const { container } = render(
      <PassageCard
        card={card}
        questionActionLabel="Ask ZhiJiao"
        onAsk={() => undefined}
        onDismiss={() => undefined}
        onToggle={() => undefined}
        onRetry={() => undefined}
        onNotice={() => undefined}
      />,
    );

    expect(container.querySelector(".katex")).not.toBeNull();
  });

  it("normalizes escaped latex delimiters from codex output before rendering", () => {
    const card = buildCard({
      messages: [
        {
          id: "msg-1",
          role: "assistant",
          content: "这里的公式是 \\\\(R(x_0)=\\theta_0\\\\)。",
        },
      ],
    });

    const { container } = render(
      <PassageCard
        card={card}
        questionActionLabel="Ask ZhiJiao"
        onAsk={() => undefined}
        onDismiss={() => undefined}
        onToggle={() => undefined}
        onRetry={() => undefined}
        onNotice={() => undefined}
      />,
    );

    expect(container.querySelector(".katex")).not.toBeNull();
  });
});
