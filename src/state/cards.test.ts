import { describe, expect, it } from "vitest";
import { cardsReducer, createCard, validateSelection } from "./cards";

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
