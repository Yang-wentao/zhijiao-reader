type SseHandler = (event: string, payload: Record<string, unknown>) => void;

export async function readSseStream(response: Response, onEvent: SseHandler) {
  if (!response.ok) {
    let errorMessage = `Request failed with status ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) {
        errorMessage = body.error;
      }
    } catch {
      // Keep default message when the response is not JSON.
    }
    throw new Error(errorMessage);
  }

  if (!response.body) {
    throw new Error("Streaming response body is missing.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const parsed = parseSseChunk(part);
      if (parsed) {
        onEvent(parsed.event, parsed.data);
      }
    }
  }
}

export function parseSseChunk(chunk: string) {
  const lines = chunk.split("\n");
  let event = "message";
  let data = "";
  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    }
    if (line.startsWith("data:")) {
      data += line.slice("data:".length).trim();
    }
  }
  if (!data) {
    return null;
  }
  return {
    event,
    data: JSON.parse(data) as Record<string, unknown>,
  };
}
