export type CardMode = "translate" | "ask";
export type CardStatus = "idle" | "loading" | "streaming" | "done" | "error";

export type CardMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type PassageCard = {
  id: string;
  selectionText: string;
  pageNumber: number | null;
  mode: CardMode;
  messages: CardMessage[];
  status: CardStatus;
  createdAt: number;
  collapsed: boolean;
  draftOutput: string;
  error: string | null;
  lastQuestion: string | null;
};

export type PdfTab = {
  id: string;
  fileName: string;
  fileUrl: string;
  cards: PassageCard[];
};

export type PdfTabSummary = Pick<PdfTab, "id" | "fileName">;

export type SelectionOverlay = {
  text: string;
  pageNumber: number | null;
  x: number;
  y: number;
};

export type AppConfig = {
  hasApiKey: boolean;
  isReady: boolean;
  provider: "openai" | "codex" | "deepseek";
  providerOptions: Array<"openai" | "codex" | "deepseek">;
  canSwitchProviders: boolean;
  model: string;
  modelOptions: string[];
  canSwitchModels: boolean;
  reasoningEffort: "low" | "medium" | "high" | null;
  reasoningEffortOptions: Array<"low" | "medium" | "high">;
  canSwitchReasoningEffort: boolean;
  questionActionLabel: string;
  maxSelectionChars: number;
};
