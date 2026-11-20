import { describe, expect, it } from "vitest";
import { cardsReducer, createCard, formatTiming, startRequestTimer, validateSelection } from "./cards";

describe("cardsReducer", () => {
  it("keeps card histories isolated", () => {
    const first = createCard("first passage", 1, "ask");
    const second = createCard("second passage", 2, "ask");

    let state = cardsReducer([], { type: "add_card", card: first });
    state = cardsReducer(state, { type: "add_card", card: second });
    state = cardsReducer(state, { type: "start_request", cardId: first.id, userMessage: "Question one" });
    state = cardsReducer(state, { type: "finish_request", cardId: first.id, assistantMessage: "Answer one" });

    const updatedFirst = state.find((card) => card.id === first.id);
    const updatedSecond = state.find((card) => card.id === second.id);

    expect(updatedFirst?.messages).toHaveLength(2);
    expect(updatedSecond?.messages).toHaveLength(0);
  });

  it("rejects overly long selections", () => {
    const validation = validateSelection("a".repeat(8001), 8000);
    expect(validation).toEqual({ ok: false, reason: "too_long" });
  });
});

describe("request timing", () => {
  it("measures the first chunk and the end from when the request was sent", () => {
    let clock = 1000;
    const timer = startRequestTimer(() => clock);
    clock = 3300;
    timer.markChunk();
    clock = 4000;
    timer.markChunk(); // later chunks don't move the first-token mark
    clock = 7100;
    expect(timer.finish()).toEqual({ firstTokenMs: 2300, totalMs: 6100 });
  });

  it("reports no first token when nothing arrived", () => {
    let clock = 0;
    const timer = startRequestTimer(() => clock);
    clock = 1500;
    expect(timer.finish()).toEqual({ firstTokenMs: null, totalMs: 1500 });
  });

  it("formats in seconds, the way the card shows it", () => {
    expect(formatTiming({ firstTokenMs: 2300, totalMs: 6100 })).toBe("首字 2.3 秒 · 完成 6.1 秒");
    expect(formatTiming({ firstTokenMs: null, totalMs: 1500 })).toBe("完成 1.5 秒");
  });

  it("keeps the timing on the finished answer", () => {
    const card = createCard("passage", 1, "translate");
    let state = cardsReducer([], { type: "add_card", card });
    state = cardsReducer(state, { type: "start_request", cardId: card.id });
    state = cardsReducer(state, {
      type: "finish_request",
      cardId: card.id,
      assistantMessage: "译文",
      timing: { firstTokenMs: 800, totalMs: 2000 },
    });
    expect(state[0].messages[0].timing).toEqual({ firstTokenMs: 800, totalMs: 2000 });
  });
});
