// 网页版「自带 key」: the browser calls DeepSeek / 交大 SJTU API directly
// with the reader's own key. Both APIs answer cross-origin requests (checked
// 2026-11-19: DeepSeek echoes the page origin, SJTU allows any), so the key
// never passes through the 知交 gateway and requests skip the tunnel
// entirely. The prompts are the desktop server's own (server/prompts.ts) —
// imported, not copied, so this adds no fourth prompt copy to keep in sync.
import { buildAskMessages, buildTranslationMessages } from "../../server/prompts";
import type { ChatMessage } from "../../server/providers/types";
import type { ConnectionTestResult } from "../types";

export type ByokProvider = "deepseek" | "sjtu";

export type ByokTarget = {
  provider: ByokProvider;
  apiKey: string;
  model: string;
  // DeepSeek only. Its v4 models think by default, which is slower and bills
  // the hidden reasoning as output — so the web build defaults to disabled.
  thinkingMode?: "enabled" | "disabled";
};

type StreamHandlers = {
  onDelta: (chunk: string) => void;
  onDone: () => void;
};

// Fixed endpoints: these are the two origins whose CORS behavior was checked.
export const BYOK_BASE_URLS: Record<ByokProvider, string> = {
  deepseek: "https://api.deepseek.com",
  sjtu: "https://models.sjtu.edu.cn/api/v1",
};

const PROVIDER_LABELS: Record<ByokProvider, string> = {
  deepseek: "DeepSeek",
  sjtu: "交大 SJTU API",
};

// Same idle window as the gateway path in api.ts: no chunk for 45s = give up.
const IDLE_TIMEOUT_MS = 45_000;

export function buildChatBody(
  target: ByokTarget,
  messages: ChatMessage[],
  temperature: number,
  stream: boolean,
): Record<string, unknown> {
  const thinking = target.provider === "deepseek" && target.thinkingMode === "enabled";
  const body: Record<string, unknown> = {
    model: target.model,
    stream,
    messages: messages.map((message) => ({
      role: message.role === "developer" ? "system" : message.role,
      content: message.content,
    })),
  };
  // Reasoning models reject a temperature (mirrors the desktop providers).
  if (!thinking && target.model !== "deepseek-reasoner") {
    body.temperature = temperature;
  }
  if (target.provider === "deepseek") {
    body.thinking = { type: thinking ? "enabled" : "disabled" };
  }
  return body;
}

async function describeHttpError(target: ByokTarget, response: Response): Promise<string> {
  const label = PROVIDER_LABELS[target.provider];
  if (response.status === 401 || response.status === 403) {
    return `${label} 的 API key 无效或没有权限，请在设置里检查。`;
  }
  if (response.status === 402) {
    return `${label} 账户余额不足，请先充值。`;
  }
  if (response.status === 429) {
    return `${label} 提示请求太频繁，请稍后再试。`;
  }
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string } | string;
  } | null;
  const detail = typeof body?.error === "string" ? body.error : body?.error?.message;
  return `${label} 返回错误（${response.status}）${detail ? `：${detail}` : "。"}`;
}

function networkErrorMessage(target: ByokTarget): string {
  return target.provider === "sjtu"
    ? "无法连接交大 SJTU API，请确认当前网络能访问 models.sjtu.edu.cn。"
    : "无法连接 DeepSeek，请检查网络后重试。";
}

export async function streamChatCompletion(
  target: ByokTarget,
  messages: ChatMessage[],
  temperature: number,
  handlers: StreamHandlers,
): Promise<void> {
  const controller = new AbortController();
  let timeoutId: number | null = null;
  let timedOut = false;
  const resetTimeout = () => {
    if (timeoutId != null) {
      window.clearTimeout(timeoutId);
    }
    timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, IDLE_TIMEOUT_MS);
  };

  try {
    resetTimeout();
    let response: Response;
    try {
      response = await fetch(`${BYOK_BASE_URLS[target.provider]}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${target.apiKey.trim()}`,
        },
        body: JSON.stringify(buildChatBody(target, messages, temperature, true)),
        signal: controller.signal,
      });
    } catch (error) {
      if (timedOut) {
        throw error;
      }
      throw new Error(networkErrorMessage(target));
    }
    if (!response.ok) {
      throw new Error(await describeHttpError(target, response));
    }
    if (!response.body) {
      throw new Error("Streaming response body is missing.");
    }

    // OpenAI-style SSE: `data: {json}` lines, `: keep-alive` comments, and a
    // final `data: [DONE]`. Lines can arrive split across network reads.
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finished = false;
    while (!finished) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      resetTimeout();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) {
          continue;
        }
        const data = line.slice("data:".length).trim();
        if (data === "[DONE]") {
          finished = true;
          void reader.cancel().catch(() => undefined);
          break;
        }
        const parsed = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string | null } }>;
        };
        // Reasoning models also stream `reasoning_content`; only the answer
        // itself goes into the card.
        const text = parsed.choices?.[0]?.delta?.content;
        if (text) {
          handlers.onDelta(text);
        }
      }
    }
    handlers.onDone();
  } catch (error) {
    if (timedOut) {
      throw new Error("请求超过 45 秒仍未完成，请重试或更换更快的模型。");
    }
    throw error;
  } finally {
    if (timeoutId != null) {
      window.clearTimeout(timeoutId);
    }
  }
}

export function streamByokTranslation(
  target: ByokTarget,
  selectionText: string,
  pageNumber: number | null,
  handlers: StreamHandlers,
): Promise<void> {
  return streamChatCompletion(target, buildTranslationMessages(selectionText, pageNumber), 0.3, handlers);
}

export function streamByokAsk(
  target: ByokTarget,
  selectionText: string,
  pageNumber: number | null,
  question: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  handlers: StreamHandlers,
): Promise<void> {
  return streamChatCompletion(
    target,
    buildAskMessages(selectionText, pageNumber, question, history),
    0.5,
    handlers,
  );
}

// 「测试连接」: one tiny non-streaming completion. It exercises exactly the
// path translation uses (cross-origin POST, key, model name) for a handful of
// tokens; a /models listing would not catch a wrong model name.
export async function testByokConnection(target: ByokTarget): Promise<ConnectionTestResult> {
  const label = PROVIDER_LABELS[target.provider];
  if (!target.apiKey.trim()) {
    return { ok: false, message: `请填写 ${label} 的 API key。` };
  }
  let response: Response;
  try {
    response = await fetch(`${BYOK_BASE_URLS[target.provider]}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${target.apiKey.trim()}`,
      },
      body: JSON.stringify({
        ...buildChatBody(target, [{ role: "user", content: "ping" }], 0, false),
        max_tokens: 1,
      }),
    });
  } catch {
    return { ok: false, message: networkErrorMessage(target) };
  }
  if (!response.ok) {
    return { ok: false, message: await describeHttpError(target, response) };
  }
  return { ok: true, message: `连接成功：${label} · ${target.model}` };
}
