import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendNote, streamTranslation } from "./api";
import type { PassageCard } from "../types";

const { readSseStream } = vi.hoisted(() => ({
  readSseStream: vi.fn(),
}));

vi.mock("./sse", () => ({
  readSseStream,
}));

describe("stream request timeout", () => {
  beforeEach(() => {
    readSseStream.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("aborts stalled translation requests instead of waiting forever", async () => {
    vi.useFakeTimers();
    const abortSpy = vi.spyOn(AbortController.prototype, "abort");
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
      ),
    );

    const card: PassageCard = {
      id: "card-1",
      selectionText: "Selected text",
      pageNumber: 1,
      mode: "translate",
      messages: [],
      status: "idle",
      createdAt: Date.now(),
      collapsed: false,
      draftOutput: "",
      error: null,
      lastQuestion: null,
    };

    const pending = streamTranslation(card, {
      onDelta: () => undefined,
      onDone: () => undefined,
    });
    const assertion = expect(pending).rejects.toThrow("timed out");

    await vi.advanceTimersByTimeAsync(46_000);

    await assertion;
    expect(abortSpy).toHaveBeenCalledTimes(1);
  });

  it("posts the note payload and returns the resulting file path", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, filePath: "/vault/paper.md", created: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await appendNote({
      pdfName: "paper.pdf",
      startPage: 1,
      endPage: 2,
      original: "snippet",
      translation: "翻译",
    });

    expect(result).toEqual({ filePath: "/vault/paper.md", created: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/notes/append",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pdfName: "paper.pdf",
          startPage: 1,
          endPage: 2,
          original: "snippet",
          translation: "翻译",
        }),
      }),
    );
  });

  it("throws with the server error message when the append call fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "vault path not configured" }),
      }),
    );
    await expect(
      appendNote({
        pdfName: "paper.pdf",
        startPage: 1,
        endPage: 1,
        original: "snippet",
      }),
    ).rejects.toThrow("vault path not configured");
  });

  it("keeps waiting when status events arrive before the response finishes", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        body: {
          getReader: vi.fn(),
        },
      }),
    );
    readSseStream.mockImplementation(async (_response, onEvent) => {
      await vi.advanceTimersByTimeAsync(30_000);
      onEvent("status", { message: "Still working" });
      await vi.advanceTimersByTimeAsync(30_000);
      onEvent("done", { ok: true });
    });

    const card: PassageCard = {
      id: "card-2",
      selectionText: "Selected text",
      pageNumber: 2,
      mode: "translate",
      messages: [],
      status: "idle",
      createdAt: Date.now(),
      collapsed: false,
      draftOutput: "",
      error: null,
      lastQuestion: null,
    };

    const pending = streamTranslation(card, {
      onDelta: () => undefined,
      onDone: () => undefined,
    });

    await expect(pending).resolves.toBeUndefined();
  });
});
