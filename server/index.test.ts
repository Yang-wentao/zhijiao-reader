import { describe, expect, it } from "vitest";
import { createAllowedAppOrigins, isAllowedAppOrigin } from "./index";

describe("app origin allowlist", () => {
  it("allows same-app local origins and requests without an Origin header", () => {
    const origins = createAllowedAppOrigins(8787);

    expect(isAllowedAppOrigin(undefined, origins)).toBe(true);
    expect(isAllowedAppOrigin("http://localhost:5173", origins)).toBe(true);
    expect(isAllowedAppOrigin("http://127.0.0.1:5173", origins)).toBe(true);
    expect(isAllowedAppOrigin("http://127.0.0.1:8787", origins)).toBe(true);
  });

  it("rejects arbitrary website origins", () => {
    const origins = createAllowedAppOrigins(8787);

    expect(isAllowedAppOrigin("https://example.com", origins)).toBe(false);
  });
});
