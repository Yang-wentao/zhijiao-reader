import OpenAI from "openai";
import { buildAskMessages, buildTranslationMessages } from "../prompts.js";
import type { AIProvider, AskInput, ChatMessage, TranslationInput } from "./types.js";

type ProviderOptions = {
  apiKey: string;
  model: string;
  baseURL: string;
};

export class CustomProvider implements AIProvider {
  private client: OpenAI;
  private model: string;

  constructor(options: ProviderOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      timeout: 45_000,
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
    const stream = await this.client.chat.completions.create({
      model: this.model,
      temperature,
      stream: true,
      messages: messages.map((message) => ({
        role: message.role === "developer" ? "system" : message.role,
        content: message.content,
      })),
    });

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
