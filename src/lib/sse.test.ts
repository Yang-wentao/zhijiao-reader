import { describe, expect, it, vi } from "vitest";
import { parseSseChunk, readSseStream } from "./sse";

describe("parseSseChunk", () => {
  it("parses event and JSON payload", () => {
    const parsed = parseSseChunk('event: delta\ndata: {"text":"hello"}');

    expect(parsed).toEqual({
      event: "delta",
      data: { text: "hello" },
    });
  });

  it("returns null when data is missing", () => {
    expect(parseSseChunk("event: done")).toBeNull();
  });
});

describe("readSseStream", () => {
  it("flushes the final buffered event when the stream closes", async () => {
    const encoder = new TextEncoder();
    const onEvent = vi.fn();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('event: done\ndata: {"ok":true}\n\n'));
          controller.close();
        },
      }),
      { status: 200 },
    );

    await readSseStream(response, onEvent);

    expect(onEvent).toHaveBeenCalledWith("done", { ok: true });
  });
});
