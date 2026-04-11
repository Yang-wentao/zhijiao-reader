import { afterEach, describe, expect, it, vi } from "vitest";
import { getServerConfig } from "./config";

describe("server config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("parses configured OpenAI model options", () => {
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("OPENAI_MODEL", "gpt-4o-mini");
    vi.stubEnv("OPENAI_MODEL_OPTIONS", "gpt-4o-mini,gpt-4o");

    const config = getServerConfig();

    expect(config.model).toBe("gpt-4o-mini");
    expect(config.modelOptions).toEqual(["gpt-4o-mini", "gpt-4o"]);
    expect(config.canSwitchModels).toBe(true);
  });

  it("uses fast codex defaults for this app", () => {
    vi.stubEnv("AI_PROVIDER", "codex");

    const config = getServerConfig();

    expect(config.model).toBe("gpt-5.4-mini");
    expect(config.reasoningEffort).toBe("low");
    expect(config.modelOptions).toEqual(["gpt-5.4-mini", "gpt-5.4", "gpt-5.3-codex-spark"]);
    expect(config.canSwitchReasoningEffort).toBe(true);
  });

  it("uses DeepSeek model defaults when the provider is deepseek", () => {
    vi.stubEnv("AI_PROVIDER", "deepseek");
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");

    const config = getServerConfig();

    expect(config.provider).toBe("deepseek");
    expect(config.model).toBe("deepseek-chat");
    expect(config.modelOptions).toEqual(["deepseek-chat", "deepseek-reasoner"]);
    expect(config.canSwitchReasoningEffort).toBe(false);
  });
});
