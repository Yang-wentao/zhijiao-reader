import { readSseStream } from "./sse";
import type { AppConfig, ConnectionSettings, ConnectionTestResult, PassageCard } from "../types";

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

export async function updateAppProvider(
  provider: "openai" | "codex" | "deepseek" | "sjtu" | "custom",
): Promise<AppConfig> {
  return updateAppSettings({ provider });
}

export async function fetchConnectionSettings(): Promise<ConnectionSettings> {
  const response = await fetch("/api/connection");
  if (!response.ok) {
    throw new Error("Failed to load connection settings.");
  }
  return (await response.json()) as ConnectionSettings;
}

export async function testConnectionSettings(settings: ConnectionSettings): Promise<ConnectionTestResult> {
  const response = await fetch("/api/connection/test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      provider: settings.activeProvider,
      codex: settings.codex,
      deepseek: settings.deepseek,
      sjtu: settings.sjtu,
      openai: settings.openai,
      custom: settings.custom,
    }),
  });
  const body = (await response.json()) as ConnectionTestResult;
  if (!response.ok) {
    throw new Error(body.message || "Connection test failed.");
  }
  return body;
}

export async function saveConnectionSettings(settings: ConnectionSettings): Promise<AppConfig> {
  const response = await fetch("/api/connection", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Failed to save connection settings.");
  }
  return (await response.json()) as AppConfig;
}

export async function updateAppReasoningEffort(reasoningEffort: "low" | "medium" | "high"): Promise<AppConfig> {
  return updateAppSettings({ reasoningEffort });
}

async function updateAppSettings(
  payload: {
    provider?: "openai" | "codex" | "deepseek" | "sjtu" | "custom";
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

export type AppendNotePayload = {
  pdfName: string;
  startPage: number | null;
  endPage: number | null;
  original: string;
  translation?: string | null;
};

export async function appendNote(payload: AppendNotePayload): Promise<{ filePath: string; created: boolean }> {
  const response = await fetch("/api/notes/append", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => null)) as
    | { ok?: boolean; filePath?: string; created?: boolean; error?: string }
    | null;
  if (!response.ok || !body?.ok) {
    throw new Error(body?.error ?? "Failed to append note.");
  }
  return { filePath: body.filePath ?? "", created: body.created ?? false };
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
  const controller = new AbortController();
  let timeoutId: number | null = null;
  let timedOut = false;
  const resetTimeout = () => {
    if (timeoutId != null) {
      window.clearTimeout(timeoutId);
    }
    timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 45_000);
  };

  try {
    resetTimeout();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    await readSseStream(response, (event, data) => {
      resetTimeout();
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
  } catch (error) {
    if (timedOut || controller.signal.aborted) {
      throw new Error("The request timed out after 45 seconds. Please retry or switch models.");
    }
    throw error;
  } finally {
    if (timeoutId != null) {
      window.clearTimeout(timeoutId);
    }
  }
}
