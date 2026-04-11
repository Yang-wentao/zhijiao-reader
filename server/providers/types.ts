export type ChatMessage = {
  role: "developer" | "user" | "assistant";
  content: string;
};

export type TranslationInput = {
  selectionText: string;
  pageNumber: number | null;
};

export type AskInput = TranslationInput & {
  question: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
};

export interface AIProvider {
  streamTranslation(input: TranslationInput): Promise<AsyncIterable<string>>;
  streamAnswer(input: AskInput): Promise<AsyncIterable<string>>;
}
