import OpenAI from "openai";
import { buildAskMessages, buildTranslationMessages } from "../prompts.js";
import type { AIProvider, AskInput, ChatMessage, TranslationInput } from "./types.js";

export type DeepSeekThinkingMode = "enabled" | "disabled";

type ProviderOptions = {
  apiKey: string;
  model: string;
  baseURL?: string;
  thinkingMode?: DeepSeekThinkingMode;
};

export class DeepSeekProvider implements AIProvider {
  private client: OpenAI;
  private model: string;
  private thinkingMode: DeepSeekThinkingMode;

  constructor(options: ProviderOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL || "https://api.deepseek.com",
      timeout: 45_000,
    });
    this.model = options.model;
    this.thinkingMode = options.thinkingMode ?? "disabled";
  }

  async streamTranslation(input: TranslationInput): Promise<AsyncIterable<string>> {
    return this.streamMessages(buildTranslationMessages(input.selectionText, input.pageNumber), 0.3);
  }

  async streamAnswer(input: AskInput): Promise<AsyncIterable<string>> {
    return this.streamMessages(
      buildAskMessages(input.selectionText, input.pageNumber, input.question, input.history),
      0.5,
    );
  }

  setModel(model: string) {
    this.model = model;
  }

  setThinkingMode(mode: DeepSeekThinkingMode) {
    this.thinkingMode = mode;
  }

  private async streamMessages(messages: ChatMessage[], temperature: number): Promise<AsyncIterable<string>> {
    // DeepSeek v4 series: thinking mode is toggled via a top-level `thinking` field
    // in the request body, not the model name. The OpenAI Node SDK passes any
    // unknown body fields through to the upstream API verbatim, so we just include
    // it on the create() params (cast through unknown for the strict type check).
    // When thinking is enabled the model emits chain-of-thought into
    // reasoning_content; we ignore that and only stream choices[0].delta.content.
    const isThinking = this.thinkingMode === "enabled";
    const params = {
      model: this.model,
      temperature: isThinking ? undefined : temperature,
      stream: true,
      messages: messages.map((message) => ({
        role: message.role === "developer" ? "system" : message.role,
        content: message.content,
      })),
      thinking: { type: this.thinkingMode },
    };
    const stream = await this.client.chat.completions.create(
      params as unknown as Parameters<typeof this.client.chat.completions.create>[0],
    );

    return this.extractTextStream(stream as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>);
  }

  private async *extractTextStream(
    stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
  ): AsyncIterable<string> {
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        yield delta;
      }
    }
  }
}
