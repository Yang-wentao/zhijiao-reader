const sample = `The conditions are satisfied by many dose-toxicity functions, including the power model F(d, b) = d^b and the logistic model F(d, b) = exp(b + d)/{1 + exp(b + d)}, for -2<d<2. These are the commonly used examples in the continual reassessment method literature. Condition 1(a) is required also for the consistency of the method; see Condition M1(b) in Shen & O'Quigley (1996). Condition 1(b) is equivalent to |F∞(d_i, b)| >= |F∞(d_j, b)| (1-F(d_i, b))/(1-F(d_j, b)) (i>j), which puts a lower bound on |F∞(d_i, b)| relative to |F∞(d_j, b)|. Using the fact that log{1-F(d, b)} = ∫_{-2}^{β} [-F∞(d, w)/{1-F(d, w)}] dw when F∞(d, β)>0, one can show that Condition 1(b) implies monotonicity of F(d, b) in d. More importantly, whether or not the conditions are satisfied can be verified in practice for any given model F.`;

const question = "请总结这段的核心结论，并解释 Condition 1(b) 的不等式在说什么。";

const configs = [
  { provider: "deepseek", model: "deepseek-chat", reasoningEffort: null, label: "deepseek-chat" },
  { provider: "deepseek", model: "deepseek-reasoner", reasoningEffort: null, label: "deepseek-reasoner" },
  { provider: "codex", model: "gpt-5.4-mini", reasoningEffort: "low", label: "gpt-5.4-mini/low" },
  { provider: "codex", model: "gpt-5.4-mini", reasoningEffort: "medium", label: "gpt-5.4-mini/medium" },
  { provider: "codex", model: "gpt-5.4-mini", reasoningEffort: "high", label: "gpt-5.4-mini/high" },
  { provider: "codex", model: "gpt-5.4", reasoningEffort: "low", label: "gpt-5.4/low" },
  { provider: "codex", model: "gpt-5.4", reasoningEffort: "medium", label: "gpt-5.4/medium" },
  { provider: "codex", model: "gpt-5.4", reasoningEffort: "high", label: "gpt-5.4/high" },
  { provider: "codex", model: "gpt-5.3-codex-spark", reasoningEffort: "high", label: "gpt-5.3-codex-spark/high" },
];

for (const config of configs) {
  await switchModel(config);
  const translation = await readSse("http://localhost:8787/api/translate/stream", {
    selectionText: sample,
    pageNumber: 5,
  });
  const answer = await readSse("http://localhost:8787/api/ask/stream", {
    selectionText: sample,
    pageNumber: 5,
    question,
    history: [],
  });
  console.log(
    JSON.stringify({
      label: config.label,
      translation: {
        firstDeltaMs: translation.firstDeltaMs,
        totalMs: translation.totalMs,
        ...summarize(translation.text),
      },
      answer: {
        firstDeltaMs: answer.firstDeltaMs,
        totalMs: answer.totalMs,
        ...summarize(answer.text),
      },
    }),
  );
}

async function switchModel(config) {
  const response = await fetch("http://localhost:8787/api/model", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: config.provider,
      model: config.model,
      reasoningEffort: config.reasoningEffort,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to switch config for ${config.label}: ${await response.text()}`);
  }
}

async function readSse(url, payload) {
  const start = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok || !response.body) {
    return {
      firstDeltaMs: null,
      totalMs: Date.now() - start,
      text: await response.text(),
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let firstDeltaMs = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const eventChunk of events) {
      const event = /event: (.+)/.exec(eventChunk)?.[1]?.trim();
      const dataLine = /data: (.+)/.exec(eventChunk)?.[1];
      if (!event || !dataLine) {
        continue;
      }
      const data = JSON.parse(dataLine);
      if (event === "delta" && typeof data.text === "string") {
        if (firstDeltaMs == null) {
          firstDeltaMs = Date.now() - start;
        }
        text += data.text;
      }
      if (event === "error") {
        throw new Error(data.error || "Unknown SSE error");
      }
    }
  }

  return {
    firstDeltaMs,
    totalMs: Date.now() - start,
    text,
  };
}

function summarize(text) {
  return {
    hasInlineMath: /\$[^$]+\$|\\\([^)]*\\\)/.test(text),
    hasDisplayMath: /\$\$[\s\S]+\$\$|\\\[[\s\S]+\\\]/.test(text),
    mentionsIntegral: /∫|\\int|dw/.test(text),
    preview: text.replace(/\s+/g, " ").slice(0, 220),
  };
}
