import OpenAI from "openai";
import type { ResponseStreamEvent } from "openai/resources/responses/responses";
import { buildAskMessages, buildTranslationMessages } from "../prompts";
import type { AIProvider, AskInput, ChatMessage, TranslationInput } from "./types";

type ProviderOptions = {
  apiKey: string;
  model: string;
};

export class OpenAIProvider implements AIProvider {
  private client: OpenAI;
  private model: string;

  constructor(options: ProviderOptions) {
    this.client = new OpenAI({ apiKey: options.apiKey });
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

  private async streamMessages(messages: ChatMessage[], temperature: number): Promise<AsyncIterable<string>> {
    const stream = await this.client.responses.create({
      model: this.model,
      temperature,
      stream: true,
      input: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    });

    return this.extractTextStream(stream);
  }

  private async *extractTextStream(stream: AsyncIterable<ResponseStreamEvent>): AsyncIterable<string> {
    for await (const event of stream) {
      if (event.type === "response.output_text.delta" && event.delta) {
        yield event.delta;
      }
    }
  }

  setModel(model: string) {
    this.model = model;
  }
}
