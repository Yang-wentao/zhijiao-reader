import { readSseStream } from "./sse";
import type {
  AppConfig,
  CloudBalance,
  ConnectionSettings,
  ConnectionTestResult,
  PassageCard,
  PdfHighlight,
  ProviderName,
} from "../types";

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

export async function updateAppProvider(provider: ProviderName): Promise<AppConfig> {
  return updateAppSettings({ provider });
}

// 知交云 quota for the saved activation code. Returns null when no code is
// configured or the gateway is unreachable — the balance chip is a nicety and
// must never break the reader.
export async function fetchCloudBalance(): Promise<CloudBalance | null> {
  try {
    const response = await fetch("/api/cloud/balance");
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as CloudBalance;
  } catch {
    return null;
  }
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
      cloud: settings.cloud,
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
    provider?: ProviderName;
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

// ── PDF highlight annotations ────────────────────────────────────────────

// Read existing Highlight annotations from a PDF on disk (includes ones made
// by WPS / Adobe / Preview). Returns [] for any failure — highlights are a
// best-effort enhancement and must never block opening a PDF.
export async function fetchHighlights(filePath: string): Promise<PdfHighlight[]> {
  try {
    const response = await fetch(`/api/annotations?path=${encodeURIComponent(filePath)}`);
    if (!response.ok) {
      return [];
    }
    const body = (await response.json()) as { ok?: boolean; highlights?: PdfHighlight[] };
    return body.ok && Array.isArray(body.highlights) ? body.highlights : [];
  } catch {
    return [];
  }
}

// Write the full set of managed highlights into the PDF file (the explicit
// "save" — Cmd+S). The backend removes the highlights it previously wrote
// and replaces them with this list; foreign annotations are left alone.
// Throws on failure so the caller can surface a toast.
export async function syncHighlights(
  filePath: string,
  highlights: PdfHighlight[],
): Promise<void> {
  const response = await fetch("/api/annotations/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filePath,
      highlights: highlights.map((h) => ({
        id: h.id,
        color: h.color,
        text: h.text,
        rects: h.rects,
        comment: h.comment,
        author: h.author,
        createdAt: h.createdAt,
      })),
    }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Failed to save highlights.");
  }
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
      throw new Error("请求超过 45 秒仍未完成，请重试或更换更快的模型。");
    }
    throw error;
  } finally {
    if (timeoutId != null) {
      window.clearTimeout(timeoutId);
    }
  }
}
