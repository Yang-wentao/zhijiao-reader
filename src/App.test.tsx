import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const { fetchAppConfig, streamTranslation, streamAsk, updateAppModel, updateAppProvider, updateAppReasoningEffort } = vi.hoisted(() => ({
  fetchAppConfig: vi.fn(),
  streamTranslation: vi.fn(),
  streamAsk: vi.fn(),
  updateAppModel: vi.fn(),
  updateAppProvider: vi.fn(),
  updateAppReasoningEffort: vi.fn(),
}));

vi.mock("./lib/api", () => ({
  fetchAppConfig,
  streamTranslation,
  streamAsk,
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
      providerOptions: ["codex", "deepseek"],
      canSwitchProviders: true,
      model: "gpt-5.4-mini",
      modelOptions: ["gpt-5.4-mini", "gpt-5.4", "gpt-5.3-codex-spark"],
      canSwitchModels: true,
      reasoningEffort: "low",
      reasoningEffortOptions: ["low", "medium", "high"],
      canSwitchReasoningEffort: true,
      questionActionLabel: "Ask Codex",
      maxSelectionChars: 8000,
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
    expect(screen.getByRole("combobox", { name: "Provider" })).toBeInTheDocument();
    expect(screen.getAllByText("gpt-5.4-mini").length).toBeGreaterThan(0);
    expect(screen.getByRole("combobox", { name: "Model" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Reasoning" })).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Open PDF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Select passage" }));

    await waitFor(() => expect(streamTranslation).toHaveBeenCalledTimes(1));
    expect(removeAllRanges).not.toHaveBeenCalled();
    expect(screen.queryByText("SelectionToolbar")).not.toBeInTheDocument();
  });
});
