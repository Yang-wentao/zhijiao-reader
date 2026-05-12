import OpenAI from "openai";
import type { ResponseStreamEvent } from "openai/resources/responses/responses";
import type { ReasoningEffort } from "../config.js";
import { buildAskMessages, buildTranslationMessages } from "../prompts.js";
import { openAIModelSupportsReasoning } from "../runtimeConfig.js";
import type { AIProvider, AskInput, ChatMessage, TranslationInput } from "./types.js";

type ProviderOptions = {
  apiKey: string;
  model: string;
  baseURL?: string;
  reasoningEffort?: ReasoningEffort;
};

export class OpenAIProvider implements AIProvider {
  private client: OpenAI;
  private model: string;
  private reasoningEffort: ReasoningEffort;

  constructor(options: ProviderOptions) {
    this.client = new OpenAI({ apiKey: options.apiKey, baseURL: options.baseURL, timeout: 45_000 });
    this.model = options.model;
    this.reasoningEffort = options.reasoningEffort ?? "medium";
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
    // Reasoning models (gpt-5*, o-series) reject `temperature` and instead
    // accept `reasoning.effort`. Older chat models accept the inverse.
    const useReasoning = openAIModelSupportsReasoning(this.model);
    const stream = await this.client.responses.create({
      model: this.model,
      stream: true,
      input: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      ...(useReasoning
        ? { reasoning: { effort: this.reasoningEffort } }
        : { temperature }),
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

  setReasoningEffort(reasoningEffort: ReasoningEffort) {
    this.reasoningEffort = reasoningEffort;
  }
}
