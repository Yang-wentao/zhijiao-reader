import { readSseStream } from "./sse";
import type { AppConfig, PassageCard } from "../types";

type StreamHandlers = {
  onDelta: (chunk: string) => void;
  onDone: () => void;
};

export async function fetchAppConfig(): Promise<AppConfig> {
  const response = await fetch("/api/config");
  if (!response.ok) {
    throw new Error("Failed to load app configuration.");
  }
  return (await response.json()) as AppConfig;
}

export async function updateAppModel(model: string): Promise<AppConfig> {
  return updateAppSettings({ model });
}

export async function updateAppProvider(provider: "openai" | "codex" | "deepseek"): Promise<AppConfig> {
  return updateAppSettings({ provider });
}

export async function updateAppReasoningEffort(reasoningEffort: "low" | "medium" | "high"): Promise<AppConfig> {
  return updateAppSettings({ reasoningEffort });
}

async function updateAppSettings(
  payload: {
    provider?: "openai" | "codex" | "deepseek";
    model?: string;
    reasoningEffort?: "low" | "medium" | "high";
  },
) {
  const response = await fetch("/api/model", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Failed to update model.");
  }
  return (await response.json()) as AppConfig;
}

export async function streamTranslation(
  card: PassageCard,
  handlers: StreamHandlers,
) {
  return streamRequest("/api/translate/stream", {
    selectionText: card.selectionText,
    pageNumber: card.pageNumber,
  }, handlers);
}

export async function streamAsk(
  card: PassageCard,
  question: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  handlers: StreamHandlers,
) {
  return streamRequest(
    "/api/ask/stream",
    {
      selectionText: card.selectionText,
      pageNumber: card.pageNumber,
      question,
      history,
    },
    handlers,
  );
}

async function streamRequest(endpoint: string, payload: unknown, handlers: StreamHandlers) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  await readSseStream(response, (event, data) => {
    if (event === "delta" && typeof data.text === "string") {
      handlers.onDelta(data.text);
    }
    if (event === "error" && typeof data.error === "string") {
      throw new Error(data.error);
    }
    if (event === "done") {
      handlers.onDone();
    }
  });
}
