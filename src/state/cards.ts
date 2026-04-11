import type { CardMessage, CardMode, PassageCard } from "../types";

type CardsAction =
  | { type: "add_card"; card: PassageCard }
  | { type: "dismiss_card"; cardId: string }
  | { type: "toggle_card"; cardId: string }
  | { type: "start_request"; cardId: string; userMessage?: string; mode?: CardMode }
  | { type: "append_draft"; cardId: string; chunk: string }
  | { type: "finish_request"; cardId: string; assistantMessage: string }
  | { type: "fail_request"; cardId: string; error: string };

export function cardsReducer(state: PassageCard[], action: CardsAction): PassageCard[] {
  switch (action.type) {
    case "add_card":
      return [action.card, ...state];
    case "dismiss_card":
      return state.filter((card) => card.id !== action.cardId);
    case "toggle_card":
      return state.map((card) =>
        card.id === action.cardId ? { ...card, collapsed: !card.collapsed } : card,
      );
    case "start_request":
      return state.map((card) => {
        if (card.id !== action.cardId) {
          return card;
        }
        const nextMessages = action.userMessage
          ? [...card.messages, createMessage("user", action.userMessage)]
          : card.messages;
        return {
          ...card,
          mode: action.mode ?? card.mode,
          messages: nextMessages,
          status: "loading",
          draftOutput: "",
          error: null,
          lastQuestion: action.userMessage ?? card.lastQuestion,
        };
      });
    case "append_draft":
      return state.map((card) =>
        card.id === action.cardId
          ? {
              ...card,
              status: "streaming",
              draftOutput: `${card.draftOutput}${action.chunk}`,
            }
          : card,
      );
    case "finish_request":
      return state.map((card) =>
        card.id === action.cardId
          ? {
              ...card,
              status: "done",
              draftOutput: "",
              error: null,
              messages: [...card.messages, createMessage("assistant", action.assistantMessage)],
            }
          : card,
      );
    case "fail_request":
      return state.map((card) =>
        card.id === action.cardId
          ? {
              ...card,
              status: "error",
              draftOutput: "",
              error: action.error,
            }
          : card,
      );
    default:
      return state;
  }
}

export function createCard(selectionText: string, pageNumber: number | null, mode: CardMode): PassageCard {
  return {
    id: crypto.randomUUID(),
    selectionText,
    pageNumber,
    mode,
    messages: [],
    status: "idle",
    createdAt: Date.now(),
    collapsed: false,
    draftOutput: "",
    error: null,
    lastQuestion: null,
  };
}

export function validateSelection(text: string, maxSelectionChars: number) {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false as const, reason: "empty" };
  }
  if (trimmed.length > maxSelectionChars) {
    return { ok: false as const, reason: "too_long" };
  }
  return { ok: true as const };
}

export function getCardHistory(card: PassageCard): Array<{ role: "user" | "assistant"; content: string }> {
  return card.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function createMessage(role: CardMessage["role"], content: string): CardMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
  };
}
