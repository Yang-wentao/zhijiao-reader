import OpenAI from "openai";
import { buildAskMessages, buildTranslationMessages } from "../prompts.js";
import type { AIProvider, AskInput, ChatMessage, TranslationInput } from "./types.js";

type ProviderOptions = {
  apiKey: string;
  model: string;
  baseURL: string;
};

export class SjtuProvider implements AIProvider {
  private client: OpenAI;
  private model: string;

  constructor(options: ProviderOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      timeout: 180_000,
    });
    this.model = options.model;
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

  private async streamMessages(messages: ChatMessage[], temperature: number): Promise<AsyncIterable<string>> {
    // Qwen3 on the SJTU API thinks silently unless told not to — ~30s of
    // nothing before the first word, versus ~6s with thinking off. Same
    // switch as the web build (src/lib/models.ts disablesQwenThinking).
    const params = {
      model: this.model,
      temperature: this.model === "deepseek-reasoner" ? undefined : temperature,
      stream: true,
      messages: messages.map((message) => ({
        role: message.role === "developer" ? "system" : message.role,
        content: message.content,
      })),
      ...(this.model.toLowerCase().startsWith("qwen")
        ? { chat_template_kwargs: { enable_thinking: false } }
        : {}),
    };
    const stream = await this.client.chat.completions.create(
      params as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
    );

    return this.extractTextStream(stream);
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
