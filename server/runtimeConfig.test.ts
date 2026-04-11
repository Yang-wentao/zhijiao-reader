import { afterEach, describe, expect, it, vi } from "vitest";

describe("runtime connection config", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("builds default connection settings from env values", async () => {
    vi.stubEnv("AI_PROVIDER", "deepseek");
    vi.stubEnv("DEEPSEEK_API_KEY", "deepseek-key");
    vi.stubEnv("DEEPSEEK_MODEL", "deepseek-chat");

    const { buildDefaultConnectionSettings } = await import("./runtimeConfig");

    const settings = buildDefaultConnectionSettings(process.env);

    expect(settings.activeProvider).toBe("deepseek");
    expect(settings.deepseek.apiKey).toBe("deepseek-key");
    expect(settings.deepseek.model).toBe("deepseek-chat");
    expect(settings.sjtu.baseUrl).toBe("https://models.sjtu.edu.cn/api/v1");
    expect(settings.custom.baseUrl).toBe("https://api.openai.com/v1");
  });

  it("merges a saved config file over env defaults", async () => {
    const { mergeConnectionSettings, buildDefaultConnectionSettings } = await import("./runtimeConfig");

    const merged = mergeConnectionSettings(
      buildDefaultConnectionSettings({ AI_PROVIDER: "codex" }),
      {
        activeProvider: "custom",
        custom: {
          label: "My Lab API",
          baseUrl: "https://lab.example.com/v1",
          apiKey: "lab-key",
          model: "lab-model",
        },
      },
    );

    expect(merged.activeProvider).toBe("custom");
    expect(merged.custom.label).toBe("My Lab API");
    expect(merged.custom.model).toBe("lab-model");
  });

  it("tests local codex connectivity by invoking the configured binary", async () => {
    vi.resetModules();
    const spawnSync = vi.fn(() => ({ status: 0, stdout: Buffer.from("codex 1.0.0"), stderr: Buffer.from("") }));
    vi.doMock("node:child_process", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:child_process")>();
      return {
        ...actual,
        spawnSync,
      };
    });

    const { testConnectionSettings } = await import("./runtimeConfig");

    const result = await testConnectionSettings({
      provider: "codex",
      codex: {
        bin: "codex",
        model: "gpt-5.4-mini",
        reasoningEffort: "low",
      },
    });

    expect(result.ok).toBe(true);
  });
});
