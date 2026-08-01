// Streaming chat against DeepSeek's OpenAI-compatible API using Node's built-in
// fetch — no SDK dependency. Yields { type: "delta", text } events followed by
// one { type: "usage", inputTokens, outputTokens } event when the upstream
// reports usage (stream_options.include_usage).
const DEFAULT_BASE_URL = "https://api.deepseek.com";

export class DeepSeekError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function* streamChat(messages, options) {
  const {
    apiKey,
    model,
    baseUrl = DEFAULT_BASE_URL,
    temperature,
    thinkingMode = "disabled",
    signal,
  } = options;

  const isThinking = thinkingMode === "enabled";
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      temperature: isThinking ? undefined : temperature,
      thinking: { type: thinkingMode },
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => "");
    throw new DeepSeekError(
      `上游模型请求失败（HTTP ${response.status}）${body ? `: ${body.slice(0, 300)}` : ""}`,
      response.status,
    );
  }

  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    // Upstream frames are separated by a blank line ("data: {...}\n\n").
    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let parsed;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }
        // Thinking models put chain-of-thought in reasoning_content; only the
        // final answer (delta.content) is forwarded to the reader.
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          yield { type: "delta", text: delta };
        }
        if (parsed.usage) {
          yield {
            type: "usage",
            inputTokens: parsed.usage.prompt_tokens ?? 0,
            outputTokens: parsed.usage.completion_tokens ?? 0,
          };
        }
      }
    }
  }
}

// Fallback token estimate when the upstream omits usage (network cut mid-way):
// ~3 chars per token is a conservative blend for zh/en academic text.
export function estimateTokens(text) {
  return Math.max(1, Math.ceil(text.length / 3));
}
