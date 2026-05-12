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

  it("re-attaches \\tag{} when the model emits it as a separate paragraph after the $$ block", () => {
    const card = buildCard({
      messages: [
        {
          id: "msg-1",
          role: "assistant",
          // The exact shape we saw in the wild from gpt-5.4: display math
          // wrapped in $$..$$, then the equation number on its own paragraph.
          content:
            "前面是文字。\n\n$$\nX = Y + Z\n$$\n\n\\tag{2.4}\n\n后面继续是文字。",
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

    // The math block should be rendered by KaTeX in display mode.
    expect(container.querySelector(".katex-display")).not.toBeNull();
    // Crucially the tag must NOT survive as its own paragraph — that's the
    // exact regression we're guarding against. (KaTeX leaves the LaTeX source
    // inside an annotation node for accessibility, so we can't rely on a
    // full-page textContent check; we look at the prose paragraphs instead.)
    const orphanTagParagraph = Array.from(container.querySelectorAll("p")).find(
      (p) => (p.textContent ?? "").trim() === "\\tag{2.4}",
    );
    expect(orphanTagParagraph).toBeUndefined();
  });

  it("wraps a tagged equation when weaker models emit it without $$ delimiters", () => {
    // Reproduces what gpt-5.4-mini / deepseek v4-flash actually emit: a
    // single-line raw LaTeX expression with \tag{...} at the end and no $$
    // anywhere. The whole paragraph should be promoted into display math.
    const card = buildCard({
      messages: [
        {
          id: "msg-1",
          role: "assistant",
          content:
            "前文。\n\n\\sigma^2 \\sim \\text{IG}(0.001, 0.001), \\quad \\mu_1 \\sim N(0, 10^3) \\tag{2.5}\n\n后文。",
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

    expect(container.querySelector(".katex-display")).not.toBeNull();
    // The raw LaTeX must not survive as a plain prose paragraph.
    const rawParagraph = Array.from(container.querySelectorAll("p")).find((p) =>
      (p.textContent ?? "").includes("\\sigma^2 \\sim"),
    );
    expect(rawParagraph).toBeUndefined();
  });

  it("wraps a multi-line tagged equation emitted as raw LaTeX (matrix-style)", () => {
    // Multi-line variant: the equation body spans several physical lines
    // inside a single paragraph. A per-line wrap would only catch the last
    // line, leaving \begin{pmatrix} stranded outside math mode.
    const card = buildCard({
      messages: [
        {
          id: "msg-1",
          role: "assistant",
          content:
            "前文。\n\n\\begin{pmatrix} \\psi_i \\\\ \\delta_i \\end{pmatrix} \\sim N\\left(\n\\begin{pmatrix} \\mu_1 \\\\ \\mu_2 \\end{pmatrix}, \\Sigma\n\\right) \\tag{2.4}\n\n后文。",
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

    expect(container.querySelector(".katex-display")).not.toBeNull();
    const rawParagraph = Array.from(container.querySelectorAll("p")).find((p) =>
      (p.textContent ?? "").includes("\\begin{pmatrix}"),
    );
    expect(rawParagraph).toBeUndefined();
  });

  it("does not wrap prose that just mentions \\tag without enough math context", () => {
    // Prose talking about \tag{} in plain language should remain prose.
    // The paragraph has only one LaTeX command (\tag), which sits below the
    // BARE_MATH_COMMAND_THRESHOLD, so wrapBareMathParagraph stays out.
    const card = buildCard({
      messages: [
        {
          id: "msg-1",
          role: "assistant",
          content: "We label equations using the \\tag{label} macro inside display math.",
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

    // No KaTeX rendering — the paragraph stayed as prose.
    expect(container.querySelector(".katex-display")).toBeNull();
  });

  it("leaves a truly orphan \\tag{} as plain text instead of producing a KaTeX error", () => {
    const card = buildCard({
      messages: [
        {
          id: "msg-1",
          role: "assistant",
          // No preceding $$..$$ block — there is nothing the tag could
          // belong to. Wrapping it in $$..$$ on its own would crash KaTeX,
          // so we leave it visible as raw text and move on.
          content: "纯文字段落。\n\n\\tag{lost}\n\n纯文字段落 2。",
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

    // No math block produced — the orphan tag is intentionally not wrapped.
    expect(container.querySelector(".katex")).toBeNull();
    // It should show up as plain text rather than a KaTeX error annotation.
    expect(container.textContent ?? "").toContain("\\tag{lost}");
  });
});
