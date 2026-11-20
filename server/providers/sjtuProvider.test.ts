import { beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();

vi.mock("openai", () => {
  return {
    default: class OpenAI {
      chat = {
        completions: {
          create: createMock,
        },
      };
    },
  };
});

describe("SjtuProvider", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("uses streaming chat completions so long passages can start rendering early", async () => {
    createMock.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield {
          choices: [
            {
              delta: {
                content: "首段",
              },
            },
          ],
        };
      },
    });

    const { SjtuProvider } = await import("./sjtuProvider.js");
    const provider = new SjtuProvider({
      apiKey: "test-key",
      model: "deepseek-chat",
      baseURL: "https://models.sjtu.edu.cn/api/v1",
    });

    const stream = await provider.streamTranslation({
      selectionText: "Long passage",
      pageNumber: 2,
    });

    const chunks: string[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["首段"]);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "deepseek-chat",
        stream: true,
      }),
    );
    expect(createMock.mock.calls[0][0]).not.toHaveProperty("chat_template_kwargs");
  });

  it("switches Qwen's silent thinking off", async () => {
    createMock.mockResolvedValue({ async *[Symbol.asyncIterator]() {} });
    const { SjtuProvider } = await import("./sjtuProvider.js");
    const provider = new SjtuProvider({
      apiKey: "test-key",
      model: "qwen3.8-27b",
      baseURL: "https://models.sjtu.edu.cn/api/v1",
    });
    await provider.streamTranslation({ selectionText: "Passage", pageNumber: 1 });
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ chat_template_kwargs: { enable_thinking: false } }),
    );
  });
});
