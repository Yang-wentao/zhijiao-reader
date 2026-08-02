// api.ts behavior with the web-build flag forced on: every call must go to
// the gateway's /v1/* on the same origin with the activation code attached,
// and the desktop-only endpoints must degrade cleanly.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendNote,
  fetchAppConfig,
  streamAsk,
  streamTranslation,
  syncHighlights,
} from "./api";
import { saveWebSettings } from "./webApi";
import type { PassageCard } from "../types";

vi.mock("./appMode", () => ({ IS_WEB_BUILD: true }));

const { readSseStream } = vi.hoisted(() => ({
  readSseStream: vi.fn(),
}));

vi.mock("./sse", () => ({
  readSseStream,
}));

const CARD: PassageCard = {
  id: "card-1",
  selectionText: "Selected text",
  pageNumber: 3,
  mode: "translate",
  messages: [],
  status: "idle",
  createdAt: Date.now(),
  collapsed: false,
  draftOutput: "",
  error: null,
  lastQuestion: null,
};

// The jsdom test environment lacks a working localStorage — install a plain
// in-memory stand-in per test.
function createStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", createStorageMock());
  readSseStream.mockReset();
  saveWebSettings({
    activationCode: "ZJ-TEST-CODE-0001",
    translationTrigger: "selection",
    annotationAuthor: "",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("api.ts in the web build", () => {
  it("streams translations from /v1 with the activation code", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, body: {} });
    vi.stubGlobal("fetch", fetchMock);
    readSseStream.mockImplementation(async (_response, onEvent) => {
      onEvent("delta", { text: "你好" });
      onEvent("done", { ok: true });
    });

    const chunks: string[] = [];
    let done = false;
    await streamTranslation(CARD, {
      onDelta: (chunk) => chunks.push(chunk),
      onDone: () => {
        done = true;
      },
    });

    expect(chunks).toEqual(["你好"]);
    expect(done).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/translate/stream",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer ZJ-TEST-CODE-0001",
        },
        body: JSON.stringify({ selectionText: "Selected text", pageNumber: 3 }),
      }),
    );
  });

  it("streams follow-up questions from /v1/ask/stream", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, body: {} });
    vi.stubGlobal("fetch", fetchMock);
    readSseStream.mockImplementation(async (_response, onEvent) => {
      onEvent("done", { ok: true });
    });

    await streamAsk(CARD, "为什么？", [{ role: "user", content: "hi" }], {
      onDelta: () => undefined,
      onDone: () => undefined,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/v1/ask/stream");
    expect(init.headers.Authorization).toBe("Bearer ZJ-TEST-CODE-0001");
    expect(JSON.parse(init.body)).toEqual({
      selectionText: "Selected text",
      pageNumber: 3,
      question: "为什么？",
      history: [{ role: "user", content: "hi" }],
    });
  });

  it("builds the app config locally instead of calling /api/config", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "deepseek-v4-flash",
        label: "张三",
        quotaTokens: 3_000_000,
        usedTokens: 0,
        remainingTokens: 3_000_000,
        period: "2026-08",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const config = await fetchAppConfig();

    expect(config.provider).toBe("cloud");
    expect(config.isReady).toBe(true);
    expect(config.connectionLabel).toBe("知交订阅 · deepseek-v4-flash");
    // The only network call is the gateway's /v1/me, never /api/config.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/v1/me");
  });

  it("rejects desktop-only persistence endpoints with a clear message", async () => {
    await expect(
      appendNote({ pdfName: "a.pdf", startPage: 1, endPage: 1, original: "x" }),
    ).rejects.toThrow("网页版不支持 Obsidian 笔记");
    await expect(syncHighlights("/tmp/a.pdf", [])).rejects.toThrow(
      "网页版暂不支持把划线写回 PDF 文件",
    );
  });
});
