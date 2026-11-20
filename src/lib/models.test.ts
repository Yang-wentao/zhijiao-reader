import { describe, expect, it } from "vitest";
import { displayModelName } from "./models";

describe("displayModelName", () => {
  it("names DeepSeek's flash model by what it now is, for 知交订阅 and DeepSeek alike", () => {
    expect(displayModelName("cloud", "deepseek-v4-flash")).toBe("V4.1 Flash");
    expect(displayModelName("deepseek", "deepseek-v4-flash")).toBe("V4.1 Flash");
    expect(displayModelName("deepseek", "deepseek-flash")).toBe("V4.1 Flash");
    expect(displayModelName("deepseek", "deepseek-v4-pro")).toBe("V4 Pro");
  });

  it("names what the SJTU API actually runs", () => {
    expect(displayModelName("sjtu", "deepseek-chat")).toBe("V4 Flash");
    expect(displayModelName("sjtu", "deepseek-reasoner")).toBe("V4 Flash 思考");
    expect(displayModelName("sjtu", "qwen3.8-27b")).toBe("Qwen3.8（27B）");
    expect(displayModelName("sjtu", "qwen")).toBe("Qwen3.8（27B）");
  });

  it("falls back to a shortened id for models it doesn't know", () => {
    expect(displayModelName("cloud", "deepseek-v9-ultra")).toBe("v9-ultra");
    expect(displayModelName("openai", "gpt-5.4")).toBe("gpt-5.4");
  });
});
