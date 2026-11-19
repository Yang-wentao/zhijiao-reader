import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildChatBody,
  streamChatCompletion,
  testByokConnection,
  type ByokTarget,
} from "./byok";

const DEEPSEEK: ByokTarget = {
  provider: "deepseek",
  apiKey: " sk-test ",
  model: "deepseek-v4-flash",
  thinkingMode: "disabled",
};
const SJTU: ByokTarget = { provider: "sjtu", apiKey: "sjtu-test", model: "deepseek-chat" };

// A minimal streaming Response: each string is one network read, so lines
// can be split across reads exactly like a real connection.
function streamingResponse(reads: string[]) {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          index < reads.length
            ? { value: encoder.encode(reads[index++]), done: false }
            : { value: undefined, done: true },
        cancel: async () => undefined,
      }),
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("buildChatBody", () => {
  const messages = [
    { role: "developer" as const, content: "rules" },
    { role: "user" as const, content: "text" },
  ];

  it("maps developer to system and switches DeepSeek thinking off", () => {
    const body = buildChatBody(DEEPSEEK, messages, 0.3, true);
    expect(body.messages).toEqual([
      { role: "system", content: "rules" },
      { role: "user", content: "text" },
    ]);
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.temperature).toBe(0.3);
    expect(body.stream).toBe(true);
  });

  it("drops temperature for reasoning, and sends no thinking field to SJTU", () => {
    expect(buildChatBody({ ...DEEPSEEK, thinkingMode: "enabled" }, messages, 0.3, true)).toMatchObject({
      thinking: { type: "enabled" },
    });
    expect(buildChatBody({ ...DEEPSEEK, thinkingMode: "enabled" }, messages, 0.3, true)).not.toHaveProperty(
      "temperature",
    );
    const sjtu = buildChatBody({ ...SJTU, model: "deepseek-reasoner" }, messages, 0.3, true);
    expect(sjtu).not.toHaveProperty("temperature");
    expect(sjtu).not.toHaveProperty("thinking");
  });
});

describe("streamChatCompletion", () => {
  it("calls the provider directly and streams only the answer text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      streamingResponse([
        ": keep-alive\n\n",
        'data: {"choices":[{"delta":{"reasoning_content":"thinking…"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"你"}}]}\n\ndata: {"choices":[{"del',
        'ta":{"content":"好"}}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const deltas: string[] = [];
    const onDone = vi.fn();

    await streamChatCompletion(DEEPSEEK, [{ role: "user", content: "hi" }], 0.3, {
      onDelta: (text) => deltas.push(text),
      onDone,
    });

    expect(deltas.join("")).toBe("你好");
    expect(onDone).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer sk-test");
  });

  it("explains the common failures in Chinese", async () => {
    const handlers = { onDelta: vi.fn(), onDone: vi.fn() };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
    await expect(streamChatCompletion(DEEPSEEK, [], 0.3, handlers)).rejects.toThrow("API key 无效");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 402, json: async () => ({}) }));
    await expect(streamChatCompletion(DEEPSEEK, [], 0.3, handlers)).rejects.toThrow("余额不足");

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(streamChatCompletion(SJTU, [], 0.3, handlers)).rejects.toThrow("models.sjtu.edu.cn");
    expect(handlers.onDone).not.toHaveBeenCalled();
  });
});

describe("testByokConnection", () => {
  it("asks for a key before calling anything", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await testByokConnection({ ...SJTU, apiKey: "  " });
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends one tiny non-streaming request to the selected model", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const result = await testByokConnection(SJTU);
    expect(result).toEqual({ ok: true, message: "连接成功：交大 SJTU API · deepseek-chat" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://models.sjtu.edu.cn/api/v1/chat/completions");
    expect(JSON.parse(init.body)).toMatchObject({ model: "deepseek-chat", stream: false, max_tokens: 1 });
  });
});
