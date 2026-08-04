import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildWebAppConfig,
  buildWebConnectionSettings,
  formatTokenCount,
  loadWebSettings,
  saveWebSettings,
  webFetchCloudBalance,
  webSaveConnectionSettings,
  webTestConnectionSettings,
} from "./webApi";
import type { CloudBalance } from "../types";

const SAMPLE_BALANCE: CloudBalance = {
  model: "deepseek-v4-flash",
  label: "张三",
  quotaTokens: 3_000_000,
  usedTokens: 500_000,
  remainingTokens: 2_500_000,
  period: "2026-08",
};

// The jsdom test environment lacks a working localStorage — install a plain
// in-memory stand-in per test.
function createStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", createStorageMock());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("web settings storage", () => {
  it("returns defaults on a fresh visit", () => {
    expect(loadWebSettings()).toEqual({
      activationCode: "",
      translationTrigger: "selection",
      annotationAuthor: "",
    });
  });

  it("round-trips saved settings", () => {
    saveWebSettings({
      activationCode: "ZJ-TEST-CODE-0001",
      translationTrigger: "menu",
      annotationAuthor: "阿远",
    });
    expect(loadWebSettings()).toEqual({
      activationCode: "ZJ-TEST-CODE-0001",
      translationTrigger: "menu",
      annotationAuthor: "阿远",
    });
  });

  it("falls back to defaults when stored JSON is corrupted", () => {
    localStorage.setItem("zhijiao-web-settings", "{not json");
    expect(loadWebSettings()).toEqual({
      activationCode: "",
      translationTrigger: "selection",
      annotationAuthor: "",
    });
  });
});

describe("buildWebAppConfig", () => {
  it("requires setup when no activation code is stored", () => {
    const config = buildWebAppConfig(
      { activationCode: "", translationTrigger: "selection", annotationAuthor: "" },
      null,
    );
    expect(config.setupRequired).toBe(true);
    expect(config.isReady).toBe(false);
    expect(config.provider).toBe("cloud");
    expect(config.notesReady).toBe(false);
    expect(config.connectionLabel).toBe("知交订阅 · deepseek-v4-flash");
  });

  it("uses the gateway-reported model in the label once known", () => {
    const config = buildWebAppConfig(
      {
        activationCode: "ZJ-TEST-CODE-0001",
        translationTrigger: "menu",
        annotationAuthor: "阿远",
      },
      { ...SAMPLE_BALANCE, model: "deepseek-v5" },
    );
    expect(config.setupRequired).toBe(false);
    expect(config.isReady).toBe(true);
    expect(config.model).toBe("deepseek-v5");
    expect(config.connectionLabel).toBe("知交订阅 · deepseek-v5");
    expect(config.translationTrigger).toBe("menu");
    expect(config.annotationAuthor).toBe("阿远");
  });
});

describe("webFetchCloudBalance", () => {
  it("skips the network entirely without a code", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await webFetchCloudBalance("  ")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the activation code as a bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => SAMPLE_BALANCE,
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await webFetchCloudBalance(" ZJ-TEST-CODE-0001 ")).toEqual(SAMPLE_BALANCE);
    expect(fetchMock).toHaveBeenCalledWith("/v1/me", {
      headers: { Authorization: "Bearer ZJ-TEST-CODE-0001" },
    });
  });

  it("returns null instead of throwing on gateway errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(await webFetchCloudBalance("ZJ-TEST-CODE-0001")).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await webFetchCloudBalance("ZJ-TEST-CODE-0001")).toBeNull();
  });
});

describe("webTestConnectionSettings", () => {
  function settingsWithCode(code: string) {
    return buildWebConnectionSettings({
      activationCode: code,
      translationTrigger: "selection",
      annotationAuthor: "",
    });
  }

  it("asks for a code before testing", async () => {
    const result = await webTestConnectionSettings(settingsWithCode("  "));
    expect(result).toEqual({ ok: false, message: "请填写订阅码。" });
  });

  it("surfaces the gateway's own error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "订阅码无效或已停用。" }),
      }),
    );
    const result = await webTestConnectionSettings(settingsWithCode("ZJ-BAD"));
    expect(result).toEqual({ ok: false, message: "订阅码无效或已停用。" });
  });

  it("reports remaining quota in the desktop wording", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => SAMPLE_BALANCE }),
    );
    const result = await webTestConnectionSettings(settingsWithCode("ZJ-TEST-CODE-0001"));
    expect(result.ok).toBe(true);
    expect(result.message).toBe(
      "连接成功：张三 · 本月剩余 2.50M tokens（共 3.00M）",
    );
  });
});

describe("webSaveConnectionSettings", () => {
  it("persists the trimmed subset and returns a ready config", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => SAMPLE_BALANCE }),
    );
    const settings = buildWebConnectionSettings({
      activationCode: "",
      translationTrigger: "selection",
      annotationAuthor: "",
    });
    settings.cloud.activationCode = " ZJ-TEST-CODE-0001 ";
    settings.preferences.translationTrigger = "menu";
    settings.annotations.author = "阿远";

    const config = await webSaveConnectionSettings(settings);

    expect(loadWebSettings()).toEqual({
      activationCode: "ZJ-TEST-CODE-0001",
      translationTrigger: "menu",
      annotationAuthor: "阿远",
    });
    expect(config.isReady).toBe(true);
    expect(config.connectionLabel).toBe("知交订阅 · deepseek-v4-flash");
  });
});

describe("formatTokenCount", () => {
  it("matches the server's rounding", () => {
    expect(formatTokenCount(999)).toBe("999");
    expect(formatTokenCount(2_500)).toBe("3K");
    expect(formatTokenCount(2_500_000)).toBe("2.50M");
  });
});
