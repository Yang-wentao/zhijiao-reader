import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const {
  fetchAppConfig,
  fetchConnectionSettings,
  saveConnectionSettings,
  streamTranslation,
  streamAsk,
  testConnectionSettings,
  updateAppModel,
  updateAppProvider,
  updateAppReasoningEffort,
} = vi.hoisted(() => ({
  fetchAppConfig: vi.fn(),
  fetchConnectionSettings: vi.fn(),
  saveConnectionSettings: vi.fn(),
  streamTranslation: vi.fn(),
  streamAsk: vi.fn(),
  testConnectionSettings: vi.fn(),
  updateAppModel: vi.fn(),
  updateAppProvider: vi.fn(),
  updateAppReasoningEffort: vi.fn(),
}));

vi.mock("./lib/api", () => ({
  fetchAppConfig,
  fetchConnectionSettings,
  saveConnectionSettings,
  streamTranslation,
  streamAsk,
  testConnectionSettings,
  updateAppModel,
  updateAppProvider,
  updateAppReasoningEffort,
}));

vi.mock("./components/SplitLayout", () => ({
  SplitLayout: ({ left, right }: { left: ReactNode; right: ReactNode }) => (
    <div>
      <div>{left}</div>
      <div>{right}</div>
    </div>
  ),
}));

vi.mock("./components/PdfPane", () => ({
  PdfPane: ({
    onFileSelected,
    onSelectionCaptured,
  }: {
    onFileSelected: (file: File) => void;
    onSelectionCaptured: (selection: {
      text: string;
      pageNumber: number | null;
      x: number;
      y: number;
    }) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onFileSelected(new File(["pdf"], "paper.pdf", { type: "application/pdf" }))}>
        Open PDF
      </button>
      <button
        type="button"
        onClick={() =>
          onSelectionCaptured({
            text: "Selected paragraph",
            pageNumber: 3,
            x: 40,
            y: 80,
          })
        }
      >
        Select passage
      </button>
    </div>
  ),
}));

vi.mock("./components/SelectionToolbar", () => ({
  SelectionToolbar: () => <div>SelectionToolbar</div>,
}));

describe("App selection flow", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:paper"),
      revokeObjectURL: vi.fn(),
    });
    fetchAppConfig.mockResolvedValue({
      hasApiKey: false,
      isReady: true,
      provider: "codex",
      providerOptions: ["codex", "deepseek", "openai", "custom"],
      canSwitchProviders: true,
      model: "gpt-5.4-mini",
      modelOptions: ["gpt-5.4-mini", "gpt-5.4", "gpt-5.3-codex-spark"],
      canSwitchModels: true,
      reasoningEffort: "low",
      reasoningEffortOptions: ["low", "medium", "high"],
      canSwitchReasoningEffort: true,
      questionActionLabel: "Ask Codex",
      maxSelectionChars: 8000,
      setupRequired: false,
      connectionLabel: "Local Codex · gpt-5.4-mini · low",
    });
    fetchConnectionSettings.mockResolvedValue({
      activeProvider: "codex",
      codex: {
        bin: "codex",
        model: "gpt-5.4-mini",
        reasoningEffort: "low",
      },
      deepseek: {
        apiKey: "",
        model: "deepseek-chat",
        baseUrl: "https://api.deepseek.com",
      },
      openai: {
        apiKey: "",
        model: "gpt-4o",
        baseUrl: "https://api.openai.com/v1",
      },
      custom: {
        label: "Custom API",
        apiKey: "",
        model: "custom-model",
        baseUrl: "https://example.com/v1",
      },
    });
    saveConnectionSettings.mockImplementation(async (settings) => ({
      hasApiKey: false,
      isReady: true,
      provider: settings.activeProvider,
      providerOptions: ["codex", "deepseek", "openai", "custom"],
      canSwitchProviders: true,
      model: settings.activeProvider === "deepseek" ? settings.deepseek.model : "gpt-5.4-mini",
      modelOptions: ["gpt-5.4-mini", "gpt-5.4", "gpt-5.3-codex-spark"],
      canSwitchModels: true,
      reasoningEffort: "low",
      reasoningEffortOptions: ["low", "medium", "high"],
      canSwitchReasoningEffort: true,
      questionActionLabel: "Ask Codex",
      maxSelectionChars: 8000,
      setupRequired: false,
      connectionLabel:
        settings.activeProvider === "deepseek"
          ? `DeepSeek · ${settings.deepseek.model}`
          : "Local Codex · gpt-5.4-mini · low",
    }));
    testConnectionSettings.mockResolvedValue({
      ok: true,
      message: "Connection succeeded.",
    });
    streamTranslation.mockImplementation(async (_card, handlers) => {
      handlers.onDelta("译文");
      handlers.onDone();
    });
    streamAsk.mockReset();
  });

  it("starts translation immediately after a passage is selected", async () => {
    const removeAllRanges = vi.fn();
    vi.spyOn(window, "getSelection").mockReturnValue({
      removeAllRanges,
    } as unknown as Selection);

    render(<App />);

    expect(await screen.findByText("Codex Panel")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Provider" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Default flow:/)).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Open PDF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Select passage" }));

    await waitFor(() => expect(streamTranslation).toHaveBeenCalledTimes(1));
    expect(removeAllRanges).not.toHaveBeenCalled();
    expect(screen.queryByText("SelectionToolbar")).not.toBeInTheDocument();
  });

  it("opens the setup dialog automatically when configuration is required", async () => {
    fetchAppConfig.mockResolvedValueOnce({
      hasApiKey: false,
      isReady: false,
      provider: "codex",
      providerOptions: ["codex", "deepseek", "openai", "custom"],
      canSwitchProviders: true,
      model: "gpt-5.4-mini",
      modelOptions: ["gpt-5.4-mini"],
      canSwitchModels: true,
      reasoningEffort: "low",
      reasoningEffortOptions: ["low", "medium", "high"],
      canSwitchReasoningEffort: true,
      questionActionLabel: "Ask Codex",
      maxSelectionChars: 8000,
      setupRequired: true,
      connectionLabel: "Not connected",
    });

    render(<App />);

    expect(await screen.findByRole("dialog", { name: "Connection settings" })).toBeInTheDocument();
  });

  it("tests and saves provider settings from the modal", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));

    const providerSelect = await screen.findByRole("combobox", { name: "Connection provider" });
    fireEvent.change(providerSelect, { target: { value: "deepseek" } });

    fireEvent.change(screen.getByLabelText("Model name"), { target: { value: "deepseek-chat" } });
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "deepseek-key" } });

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(testConnectionSettings).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => expect(saveConnectionSettings).toHaveBeenCalledTimes(1));
    expect(screen.getByText("DeepSeek · deepseek-chat")).toBeInTheDocument();
  });
});
