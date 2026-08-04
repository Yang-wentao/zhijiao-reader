import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { CloudProvider, fetchCloudBalance, formatTokenCount } from "./cloudProvider";

let server: Server | null = null;

function startGateway(handler: (path: string, res: import("node:http").ServerResponse) => void) {
  return new Promise<string>((resolve) => {
    server = createServer((req, res) => handler(req.url ?? "", res));
    server.listen(0, "127.0.0.1", () => {
      const address = server!.address();
      resolve(`http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`);
    });
  });
}

function writeSse(res: import("node:http").ServerResponse, frames: string[]) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  frames.forEach((frame) => res.write(frame));
  res.end();
}

afterEach(() => {
  server?.close();
  server = null;
});

async function collect(iterable: AsyncIterable<string>): Promise<string> {
  let out = "";
  for await (const chunk of iterable) {
    out += chunk;
  }
  return out;
}

describe("CloudProvider", () => {
  it("streams delta events from the gateway as plain text", async () => {
    const baseUrl = await startGateway((_path, res) =>
      writeSse(res, [
        'event: status\ndata: {"message":"Request accepted."}\n\n',
        'event: delta\ndata: {"text":"注意力"}\n\n',
        'event: delta\ndata: {"text":"机制"}\n\n',
        'event: done\ndata: {"ok":true}\n\n',
      ]),
    );
    const provider = new CloudProvider({ activationCode: "ZJ-TEST", baseUrl });

    const text = await collect(
      await provider.streamTranslation({ selectionText: "attention", pageNumber: 1 }),
    );

    expect(text).toBe("注意力机制");
  });

  it("turns a mid-stream error event into a thrown error", async () => {
    const baseUrl = await startGateway((_path, res) =>
      writeSse(res, [
        'event: delta\ndata: {"text":"部分"}\n\n',
        'event: error\ndata: {"error":"上游模型暂时不可用"}\n\n',
      ]),
    );
    const provider = new CloudProvider({ activationCode: "ZJ-TEST", baseUrl });

    await expect(
      collect(await provider.streamTranslation({ selectionText: "x", pageNumber: null })),
    ).rejects.toThrow("上游模型暂时不可用");
  });

  it("surfaces the gateway's quota / auth errors verbatim", async () => {
    const baseUrl = await startGateway((_path, res) => {
      res.writeHead(402, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "本月额度已用完（3000000/3000000 tokens）。" }));
    });
    const provider = new CloudProvider({ activationCode: "ZJ-TEST", baseUrl });

    await expect(
      provider.streamTranslation({ selectionText: "x", pageNumber: null }),
    ).rejects.toThrow("本月额度已用完");
  });

  it("falls back to a friendly message when the gateway sends a bare 401", async () => {
    const baseUrl = await startGateway((_path, res) => {
      res.writeHead(401);
      res.end();
    });
    const provider = new CloudProvider({ activationCode: "bad", baseUrl });

    await expect(provider.streamAnswer({ selectionText: "x", pageNumber: null, question: "?", history: [] })).rejects.toThrow(
      "订阅码无效",
    );
  });

  it("reads the quota for an activation code", async () => {
    const baseUrl = await startGateway((path, res) => {
      expect(path).toBe("/v1/me");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          label: "张三",
          quotaTokens: 3_000_000,
          usedTokens: 1_014,
          remainingTokens: 2_998_986,
          period: "2026-08",
        }),
      );
    });

    const balance = await fetchCloudBalance("ZJ-TEST", baseUrl);

    expect(balance.label).toBe("张三");
    expect(balance.remainingTokens).toBe(2_998_986);
  });
});

describe("formatTokenCount", () => {
  it("compacts large numbers for the header chip", () => {
    expect(formatTokenCount(2_998_986)).toBe("3.00M");
    expect(formatTokenCount(1_500_000)).toBe("1.50M");
    expect(formatTokenCount(42_000)).toBe("42K");
    expect(formatTokenCount(860)).toBe("860");
  });
});
