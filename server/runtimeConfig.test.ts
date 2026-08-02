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

  it("supports 知交云 as a provider with an activation code", async () => {
    const { buildDefaultConnectionSettings, mergeConnectionSettings, buildConnectionLabel } =
      await import("./runtimeConfig");

    const defaults = buildDefaultConnectionSettings({ AI_PROVIDER: "cloud" });
    expect(defaults.activeProvider).toBe("cloud");
    expect(defaults.cloud.activationCode).toBe("");
    expect(defaults.cloud.baseUrl).toBe("https://api.zhijiao-reader.com");

    // A saved activation code survives the merge, and the connection label
    // never leaks the code itself.
    const merged = mergeConnectionSettings(defaults, {
      cloud: { activationCode: "ZJ-AAAA-BBBB-CCCC", baseUrl: "" },
    });
    expect(merged.cloud.activationCode).toBe("ZJ-AAAA-BBBB-CCCC");
    expect(merged.cloud.baseUrl).toBe("https://api.zhijiao-reader.com");
    const label = buildConnectionLabel(merged);
    expect(label).toBe("知交云 · 订阅版");
    expect(label).not.toContain("ZJ-");
  });

  it("rejects a 知交云 connection test with no activation code", async () => {
    const { testConnectionSettings } = await import("./runtimeConfig");

    const result = await testConnectionSettings({
      provider: "cloud",
      cloud: { activationCode: "  ", baseUrl: "" },
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("激活码");
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
    const runner = vi.fn(() => ({
      status: 0,
      stdout: Buffer.from("codex 1.0.0"),
      stderr: Buffer.from(""),
    }));
    const { testCodexBinary } = await import("./runtimeConfig");

    const result = testCodexBinary("codex", runner);

    expect(result.ok).toBe(true);
    expect(runner).toHaveBeenCalledWith(
      "codex",
      ["--version"],
      expect.objectContaining({
        cwd: process.cwd(),
        encoding: "utf8",
      }),
    );
  });

  it("falls back to a generic error when codex returns no stderr output", async () => {
    const runner = vi.fn(() => ({
      status: 1,
      stdout: null,
      stderr: null,
    }));
    const { testCodexBinary } = await import("./runtimeConfig");

    const result = testCodexBinary("codex", runner);

    expect(result).toEqual({
      ok: false,
      message: "Failed to execute codex.",
    });
  });
});
