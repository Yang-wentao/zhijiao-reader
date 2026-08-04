import type { AIProvider, AskInput, TranslationInput } from "./types.js";

// 知交订阅 provider — unlike every other provider, this one does NOT talk to a
// model API directly. It forwards to the 知交订阅 gateway (cloud/ in this repo),
// which holds the real API key, checks the activation code's quota, and relays
// the model stream back. So there is no API key, no model choice, and no
// prompt building on this side: the gateway owns all of that.
export const DEFAULT_CLOUD_BASE_URL = "https://api.zhijiao-reader.com";

type ProviderOptions = {
  activationCode: string;
  baseUrl?: string;
};

// Model the gateway is expected to run. Used as the header-chip label until
// /v1/me reports the deployment's real model (older gateways omit it).
export const DEFAULT_CLOUD_MODEL = "deepseek-v4-flash";

export type CloudBalance = {
  // Absent on gateways older than v1.1.1.
  model?: string;
  label: string;
  quotaTokens: number;
  usedTokens: number;
  remainingTokens: number;
  period: string;
};

export class CloudProvider implements AIProvider {
  private activationCode: string;
  private baseUrl: string;

  constructor(options: ProviderOptions) {
    this.activationCode = options.activationCode;
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
  }

  async streamTranslation(input: TranslationInput): Promise<AsyncIterable<string>> {
    return this.streamFromGateway("/v1/translate/stream", {
      selectionText: input.selectionText,
      pageNumber: input.pageNumber,
    });
  }

  async streamAnswer(input: AskInput): Promise<AsyncIterable<string>> {
    return this.streamFromGateway("/v1/ask/stream", {
      selectionText: input.selectionText,
      pageNumber: input.pageNumber,
      question: input.question,
      history: input.history,
    });
  }

  private async streamFromGateway(path: string, payload: unknown): Promise<AsyncIterable<string>> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.activationCode}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok || !response.body) {
      throw new Error(await readGatewayError(response));
    }
    return readGatewayStream(response.body);
  }
}

// Parse the gateway's SSE stream back into a plain text iterable. The gateway
// speaks the same event vocabulary as this app's own routes (status / delta /
// done / error), so an `error` event mid-stream becomes a thrown Error here
// and surfaces on the card exactly like a local provider failure.
async function* readGatewayStream(body: NodeJS.ReadableStream | ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let event = "message";
      let data = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          data += line.slice(5).trim();
        }
      }
      if (!data) continue;
      let parsed: { text?: string; error?: string };
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      if (event === "delta" && typeof parsed.text === "string") {
        yield parsed.text;
      } else if (event === "error") {
        throw new Error(parsed.error || "知交订阅返回了错误。");
      } else if (event === "done") {
        return;
      }
    }
  }
}

async function readGatewayError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  if (body?.error) {
    return body.error;
  }
  if (response.status === 401) {
    return "订阅码无效或已停用，请检查设置中的订阅码。";
  }
  if (response.status === 402) {
    return "本月额度已用完，请联系开发者续费。";
  }
  return `知交订阅暂时不可用（HTTP ${response.status}）。`;
}

// Fetch quota/usage for an activation code. Used by the Settings "test
// connection" button and by the header balance chip.
export async function fetchCloudBalance(
  activationCode: string,
  baseUrl?: string,
): Promise<CloudBalance> {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/v1/me`, {
    headers: { Authorization: `Bearer ${activationCode}` },
  });
  if (!response.ok) {
    throw new Error(await readGatewayError(response));
  }
  return (await response.json()) as CloudBalance;
}

function normalizeBaseUrl(baseUrl?: string): string {
  return (baseUrl?.trim() || DEFAULT_CLOUD_BASE_URL).replace(/\/$/, "");
}

// "2,998,986" → "2.99M"; keeps the header chip narrow.
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(2)}M`;
  }
  if (tokens >= 1_000) {
    return `${Math.round(tokens / 1_000)}K`;
  }
  return String(tokens);
}
