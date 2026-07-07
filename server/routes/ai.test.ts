import { EventEmitter } from "node:events";
import type { Response } from "express";
import { describe, expect, it } from "vitest";
import { streamSse } from "./ai";

function createFakeSseResponse() {
  const emitter = new EventEmitter();
  const fake = {
    chunks: [] as string[],
    ended: false,
    setHeader() {},
    flushHeaders() {},
    write(data: string) {
      fake.chunks.push(data);
      return true;
    },
    end() {
      fake.ended = true;
    },
    on(event: string, listener: () => void) {
      emitter.on(event, listener);
      return fake;
    },
    emitClose() {
      emitter.emit("close");
    },
  };
  return fake;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

describe("streamSse", () => {
  it("streams all chunks and finishes with a done event", async () => {
    const res = createFakeSseResponse();
    async function* chunks() {
      yield "你好";
      yield "，世界";
    }

    await streamSse(res as unknown as Response, Promise.resolve(chunks()));

    const payload = res.chunks.join("");
    expect(payload).toContain("event: delta");
    expect(payload).toContain("你好");
    expect(payload).toContain("event: done");
    expect(res.ended).toBe(true);
  });

  it("stops consuming the provider stream when the client disconnects", async () => {
    const res = createFakeSseResponse();
    let providerReleased = false;
    let yielded = 0;
    async function* endlessChunks() {
      try {
        while (true) {
          yield `chunk-${yielded++}`;
          await sleep(5);
        }
      } finally {
        // for-await break must call iterator.return() so the underlying
        // provider request gets aborted instead of billing to completion.
        providerReleased = true;
      }
    }

    const pending = streamSse(res as unknown as Response, Promise.resolve(endlessChunks()));
    await sleep(1); // let the first chunk flow
    res.emitClose();
    await pending;

    expect(providerReleased).toBe(true);
    expect(yielded).toBeLessThan(5);
    expect(res.chunks.join("")).not.toContain("event: done");
  });
});
