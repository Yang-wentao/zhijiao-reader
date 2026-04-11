export function splitIntoReadableChunks(text: string) {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }

  const blocks = normalized.split(/(\n\s*\n)/).filter(Boolean);
  const chunks: string[] = [];

  for (const block of blocks) {
    if (/^\n\s*\n$/.test(block)) {
      chunks.push(block);
      continue;
    }

    const lines = block.split("\n");
    for (const line of lines) {
      if (!line.trim()) {
        chunks.push("\n");
        continue;
      }

      const sentences = line.match(/[^。！？；;:：]+[。！？；;:：]?|.+$/g) ?? [line];
      for (const sentence of sentences) {
        const trimmed = sentence.trim();
        if (!trimmed) {
          continue;
        }
        if (trimmed.length <= 40) {
          chunks.push(trimmed);
          continue;
        }
        for (let cursor = 0; cursor < trimmed.length; cursor += 28) {
          chunks.push(trimmed.slice(cursor, cursor + 28));
        }
      }
      chunks.push("\n");
    }
  }

  return chunks.filter((chunk, index, array) => {
    if (chunk !== "\n") {
      return true;
    }
    return index < array.length - 1;
  });
}
