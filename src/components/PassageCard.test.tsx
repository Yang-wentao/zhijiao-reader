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

  it("promotes an inline $...\\tag{}...$ span into a display block", () => {
    // Observed in the wild (deepseek v4-flash, Stein-Encoder paper): the model
    // put a numbered equation in SINGLE-dollar inline math. \tag is display-only,
    // so KaTeX threw and painted the source red. Promoting the span to $$..$$
    // is always safe — the inline form could never have rendered.
    const card = buildCard({
      messages: [
        {
          id: "msg-1",
          role: "assistant",
          content: "一阶矩：$E\\left[ T(Y)\\Sigma^{-1}(Z - AX) \\right] \\tag{5}$",
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

    // Display mode + no error, and the equation number rendered as a real
    // KaTeX tag rather than falling out as literal text.
    expect(container.querySelector(".katex-display")).not.toBeNull();
    expect(container.querySelector(".katex-error")).toBeNull();
    expect(container.querySelector(".tag")).not.toBeNull();
  });

  it("turns a \\tag{} that trails an inline formula into a plain (n) number", () => {
    // Captured from a live deepseek v4-flash translation: the number landed
    // just outside the inline math, so KaTeX never saw it and the reader got a
    // literal "\tag{5}". It belongs to the formula it follows, so render it
    // the way the source PDF does — inline, without breaking the sentence.
    const card = buildCard({
      messages: [
        {
          id: "msg-1",
          role: "assistant",
          content: "一阶：$E[T(Y)\\Sigma^{-1}(Z - AX)]$ \\tag{5}。二阶：$E[T(Y)]$。",
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

    const body = container.querySelector(".message-content")?.textContent ?? "";
    expect(body).not.toContain("\\tag{5}");
    expect(body).toContain("(5)");
    // The sentence stays in one paragraph — no display block splitting it.
    expect(container.querySelector(".katex-display")).toBeNull();
    expect(container.querySelector(".katex-error")).toBeNull();
  });

  it("repairs a prime followed by a superscript (double-superscript error)", () => {
    // Also from the Stein-Encoder paper: `\hat{Z}'_i^\top` — the prime IS a
    // superscript, so the following ^\top is a second one and KaTeX rejects
    // the whole formula. An empty group between them is the canonical fix.
    const card = buildCard({
      messages: [
        {
          id: "msg-1",
          role: "assistant",
          content:
            "计算 Stein 矩阵 $\\hat{K} = \\hat{\\Omega}^{1/2} \\left[ \\frac{1}{n} \\sum_i T(Y_i)(\\hat{Z}'_i \\hat{Z}'_i^\\top - \\hat{\\Sigma}) \\right] \\hat{\\Omega}^{1/2}$ 。",
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
    expect(container.querySelector(".katex-error")).toBeNull();
    // The TeX that reaches KaTeX (visible in its MathML annotation) carries
    // the inserted empty group — proof the repair ran, not just that KaTeX
    // happened to tolerate the input.
    expect(container.textContent).toContain("{}^\\top");
  });

  it("renders a real deepseek v4-flash translation that hits several math pitfalls at once", () => {
    // Verbatim capture from a live translation of the Stein-Encoder paper —
    // the passage that rendered as red LaTeX in v1.1.0. It contains, in one
    // paragraph: inline math with \tag inside, a prime immediately followed by
    // a superscript, and ordinary inline formulas that must stay untouched.
    const card = buildCard({
      messages: [
        {
          id: "msg-1",
          role: "assistant",
          content:
            "在假设 3.1 下，得分函数变为显式形式：$H_1(Z|X) = -\\Sigma^{-1}(Z-AX)$。将其代入一般定义，可得到闭式残差 Stein 矩张量：一阶：$E[T(Y)\\Sigma^{-1}(Z-AX)] \\tag{5}$；二阶：$E[T(Y)\\{\\Sigma^{-1}(Z-AX)(Z-AX)^T \\Sigma^{-1} - \\Sigma^{-1}\\}]$。计算 Stein 矩阵 $K = \\Omega^{1/2}[(1/n) \\sum_i T(Y_i)(\\hat{Z}_i' \\hat{Z}_i'^T - \\Sigma)] \\Omega^{1/2}$。",
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

    // Nothing may fall back to red source text, and the tagged equation
    // becomes a numbered display block.
    expect(container.querySelector(".katex-error")).toBeNull();
    expect(container.querySelector(".katex-display")).not.toBeNull();
    expect(container.querySelector(".tag")).not.toBeNull();
    // The surrounding prose survives intact — the dollar-pairing scan must not
    // swallow the Chinese text between two separate formulas.
    const body = container.querySelector(".message-content")?.textContent ?? "";
    expect(body).toContain("将其代入一般定义");
    expect(body).toContain("二阶");
    expect(body).toContain("计算 Stein 矩阵");
  });

  it("leaves prose and well-formed math untouched", () => {
    // Guard rail for the two new rewrites: an apostrophe in prose and a
    // correctly-written transpose must survive unchanged.
    const card = buildCard({
      messages: [
        {
          id: "msg-1",
          role: "assistant",
          content: "The model's output is fine. 转置写法正确时：$ {X'_i}^\\top = Y $ 。",
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

    expect(container.textContent).toContain("The model's output is fine.");
    expect(container.querySelector(".katex")).not.toBeNull();
    expect(container.querySelector(".katex-error")).toBeNull();
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
