// The settings modal in the web build: the 公开试用码 box appears only when
// the gateway offers a code, and 一键填入 puts it into the code field.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ConnectionSettingsModal } from "./ConnectionSettingsModal";
import { buildWebConnectionSettings } from "../lib/webApi";

vi.mock("../lib/appMode", () => ({ IS_WEB_BUILD: true }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderModal(activationCode: string, onChange = vi.fn()) {
  const settings = buildWebConnectionSettings({
    activationCode,
    translationTrigger: "selection",
    annotationAuthor: "",
  });
  render(
    <ConnectionSettingsModal
      isOpen
      settings={settings}
      isSaving={false}
      isTesting={false}
      testResult={null}
      onClose={vi.fn()}
      onChange={onChange}
      onSave={vi.fn()}
      onTest={vi.fn()}
    />,
  );
  return onChange;
}

function offerCode(code: string | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code, expiresAt: code ? "2026-10-31T07:00:00.000Z" : null }),
    }),
  );
}

describe("ConnectionSettingsModal (web) public trial code", () => {
  it("shows the offered code and fills it in on click", async () => {
    offerCode("ZJ-PUB-1");
    const onChange = renderModal("");
    expect(await screen.findByText("ZJ-PUB-1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "一键填入" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].cloud.activationCode).toBe("ZJ-PUB-1");
  });

  it("marks the code as filled once it is in the field", async () => {
    offerCode("ZJ-PUB-1");
    renderModal("ZJ-PUB-1");
    expect(await screen.findByRole("button", { name: "已填入" })).toBeDisabled();
  });

  it("keeps the old copy when no code is on offer", async () => {
    offerCode(null);
    renderModal("");
    expect(await screen.findByText(/置顶动态里有可用的订阅码/)).toBeInTheDocument();
    expect(screen.queryByText("今日公开试用码")).not.toBeInTheDocument();
  });
});
