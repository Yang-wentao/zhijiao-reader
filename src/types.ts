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
  provider: "openai" | "codex" | "deepseek" | "sjtu" | "custom";
  providerOptions: Array<"openai" | "codex" | "deepseek" | "sjtu" | "custom">;
  canSwitchProviders: boolean;
  model: string;
  modelOptions: string[];
  canSwitchModels: boolean;
  reasoningEffort: "low" | "medium" | "high" | null;
  reasoningEffortOptions: Array<"low" | "medium" | "high">;
  canSwitchReasoningEffort: boolean;
  questionActionLabel: string;
  maxSelectionChars: number;
  setupRequired: boolean;
  connectionLabel: string;
};

export type ConnectionSettings = {
  activeProvider: "openai" | "codex" | "deepseek" | "sjtu" | "custom";
  codex: {
    bin: string;
    model: string;
    reasoningEffort: "low" | "medium" | "high";
  };
  deepseek: {
    apiKey: string;
    model: string;
    baseUrl: string;
  };
  sjtu: {
    apiKey: string;
    model: string;
    baseUrl: string;
  };
  openai: {
    apiKey: string;
    model: string;
    baseUrl: string;
  };
  custom: {
    label: string;
    apiKey: string;
    model: string;
    baseUrl: string;
  };
};

export type ConnectionTestResult = {
  ok: boolean;
  message: string;
};
