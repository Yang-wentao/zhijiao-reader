import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { PdfTabSummary } from "./types";

const {
  appendNote,
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
  appendNote: vi.fn(),
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
  appendNote,
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
    tabs,
    activeTabId,
    onFileSelected,
    onSelectionCaptured,
    onContextSelection,
    onTabSelected,
  }: {
    tabs: PdfTabSummary[];
    activeTabId: string | null;
    onFileSelected: (file: File) => void;
    onSelectionCaptured: (text: string, pageNumber: number | null) => void;
    onContextSelection: (selection: {
      text: string;
      startPage: number | null;
      endPage: number | null;
      x: number;
      y: number;
    }) => void;
    onTabSelected: (tabId: string) => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          onFileSelected(new File(["pdf"], `paper-${tabs.length + 1}.pdf`, { type: "application/pdf" }))
        }
      >
        Open PDF
      </button>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          aria-pressed={tab.id === activeTabId}
          onClick={() => onTabSelected(tab.id)}
        >
          {tab.fileName}
        </button>
      ))}
      <button
        type="button"
        onClick={() => onSelectionCaptured("Selected paragraph", 3)}
      >
        Mouseup selection
      </button>
      <button
        type="button"
        onClick={() =>
          onContextSelection({
            text: "Selected paragraph",
            startPage: 3,
            endPage: 3,
            x: 40,
            y: 80,
          })
        }
      >
        Right-click selection
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
      providerOptions: ["codex", "deepseek", "sjtu", "openai", "custom"],
      canSwitchProviders: true,
      model: "gpt-5.4-mini",
      modelOptions: ["gpt-5.4-mini", "gpt-5.4", "gpt-5.3-codex-spark"],
      canSwitchModels: true,
      reasoningEffort: "low",
      reasoningEffortOptions: ["low", "medium", "high"],
      canSwitchReasoningEffort: true,
      questionActionLabel: "Ask ZhiJiao",
      maxSelectionChars: 8000,
      setupRequired: false,
      connectionLabel: "Local Codex · gpt-5.4-mini · low",
      notesReady: false,
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
      sjtu: {
        apiKey: "",
        model: "deepseek-chat",
        baseUrl: "https://models.sjtu.edu.cn/api/v1",
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
      notes: {
        enabled: false,
        vaultPath: "",
        subdir: "知交摘录",
        includeTimestamp: true,
      },
    });
    saveConnectionSettings.mockImplementation(async (settings) => ({
      hasApiKey: false,
      isReady: true,
      provider: settings.activeProvider,
      providerOptions: ["codex", "deepseek", "sjtu", "openai", "custom"],
      canSwitchProviders: true,
      model:
        settings.activeProvider === "deepseek"
          ? settings.deepseek.model
          : settings.activeProvider === "sjtu"
            ? settings.sjtu.model
            : "gpt-5.4-mini",
      modelOptions: ["gpt-5.4-mini", "gpt-5.4", "gpt-5.3-codex-spark"],
      canSwitchModels: true,
      reasoningEffort: "low",
      reasoningEffortOptions: ["low", "medium", "high"],
      canSwitchReasoningEffort: true,
      questionActionLabel: "Ask ZhiJiao",
      maxSelectionChars: 8000,
      setupRequired: false,
      connectionLabel:
        settings.activeProvider === "deepseek"
          ? `DeepSeek · ${settings.deepseek.model}`
          : settings.activeProvider === "sjtu"
            ? `SJTU API · ${settings.sjtu.model}`
          : "Local Codex · gpt-5.4-mini · low",
      notesReady: false,
    }));
    testConnectionSettings.mockResolvedValue({
      ok: true,
      message: "Connection succeeded.",
    });
    appendNote.mockReset();
    streamTranslation.mockReset();
    streamTranslation.mockImplementation(async (_card, handlers) => {
      handlers.onDelta("译文");
      handlers.onDone();
    });
    streamAsk.mockReset();
  });

  it("auto-translates the selection as soon as PdfPane reports a mouseup", async () => {
    render(<App />);

    expect(await screen.findByText("知交文献阅读")).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Open PDF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Mouseup selection" }));

    await waitFor(() => expect(streamTranslation).toHaveBeenCalledTimes(1));
  });

  it("right-clicking opens the notes menu without firing translation", async () => {
    render(<App />);

    expect(await screen.findByText("知交文献阅读")).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Open PDF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Right-click selection" }));

    // The right-click menu shows note actions only — no translate item anymore.
    expect(await screen.findByRole("menuitem", { name: "加入笔记（原文）" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "翻译" })).not.toBeInTheDocument();
    expect(streamTranslation).not.toHaveBeenCalled();
  });

  it("keeps pending note appends when the user switches PDF tabs before translation finishes", async () => {
    fetchAppConfig.mockResolvedValueOnce({
      hasApiKey: false,
      isReady: true,
      provider: "codex",
      providerOptions: ["codex", "deepseek", "sjtu", "openai", "custom"],
      canSwitchProviders: true,
      model: "gpt-5.4-mini",
      modelOptions: ["gpt-5.4-mini", "gpt-5.4", "gpt-5.3-codex-spark"],
      canSwitchModels: true,
      reasoningEffort: "low",
      reasoningEffortOptions: ["low", "medium", "high"],
      canSwitchReasoningEffort: true,
      questionActionLabel: "Ask ZhiJiao",
      maxSelectionChars: 8000,
      setupRequired: false,
      connectionLabel: "Local Codex · gpt-5.4-mini · low",
      notesReady: true,
    });
    let capturedHandlers: { onDelta: (chunk: string) => void; onDone: () => void } | null = null;
    streamTranslation.mockImplementationOnce(async (_card, handlers) => {
      capturedHandlers = handlers;
    });

    render(<App />);

    expect(await screen.findByText("知交文献阅读")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "设置" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Provider" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Default flow:/)).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Open PDF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open PDF" }));
    fireEvent.click(await screen.findByRole("button", { name: "paper-1.pdf" }));
    fireEvent.click(await screen.findByRole("button", { name: "Right-click selection" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "加入笔记（原文 + 译文）" }));

    await waitFor(() => expect(streamTranslation).toHaveBeenCalledTimes(1));

    fireEvent.click(await screen.findByRole("button", { name: "paper-2.pdf" }));
    expect(appendNote).not.toHaveBeenCalled();

    await act(async () => {
      capturedHandlers?.onDelta("译文");
      capturedHandlers?.onDone();
    });

    await waitFor(() =>
      expect(appendNote).toHaveBeenCalledWith({
        pdfName: "paper-1.pdf",
        startPage: 3,
        endPage: 3,
        original: "Selected paragraph",
        translation: "译文",
      }),
    );
  });

  it("opens the setup dialog automatically when configuration is required", async () => {
    fetchAppConfig.mockResolvedValueOnce({
      hasApiKey: false,
      isReady: false,
      provider: "codex",
      providerOptions: ["codex", "deepseek", "sjtu", "openai", "custom"],
      canSwitchProviders: true,
      model: "gpt-5.4-mini",
      modelOptions: ["gpt-5.4-mini"],
      canSwitchModels: true,
      reasoningEffort: "low",
      reasoningEffortOptions: ["low", "medium", "high"],
      canSwitchReasoningEffort: true,
      questionActionLabel: "Ask ZhiJiao",
      maxSelectionChars: 8000,
      setupRequired: true,
      connectionLabel: "Not connected",
      notesReady: false,
    });

    render(<App />);

    expect(await screen.findByRole("dialog", { name: "连接设置" })).toBeInTheDocument();
  });

  it("tests and saves provider settings from the modal", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "设置" }));

    const providerSelect = await screen.findByRole("combobox", { name: "Connection provider" });
    fireEvent.change(providerSelect, { target: { value: "deepseek" } });

    fireEvent.change(screen.getByLabelText("Model name"), { target: { value: "deepseek-chat" } });
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "deepseek-key" } });

    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
    await waitFor(() => expect(testConnectionSettings).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() => expect(saveConnectionSettings).toHaveBeenCalledTimes(1));
    // The header chip now shows "DeepSeek" + the shortened model name "chat".
    expect(screen.getByText("DeepSeek")).toBeInTheDocument();
    expect(screen.getByText("chat")).toBeInTheDocument();
  });

  it("shows DeepSeek model as a fixed select with recommended chat default", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "设置" }));

    const providerSelect = await screen.findByRole("combobox", { name: "Connection provider" });
    fireEvent.change(providerSelect, { target: { value: "deepseek" } });

    expect(await screen.findByRole("combobox", { name: "Model name" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "deepseek-chat（推荐）" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "deepseek-reasoner" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Model name" })).not.toBeInTheDocument();
  });

  it("shows codex model as a fixed select with three options", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "设置" }));

    expect(await screen.findByRole("combobox", { name: "Codex model" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "gpt-5.4-mini" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "gpt-5.4" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "gpt-5.3-codex-spark" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Codex model" })).not.toBeInTheDocument();
  });

  it("shows SJTU API as a first-class provider option", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "设置" }));

    const providerSelect = await screen.findByRole("combobox", { name: "Connection provider" });
    expect(screen.getByRole("option", { name: "SJTU API" })).toBeInTheDocument();

    fireEvent.change(providerSelect, { target: { value: "sjtu" } });
    expect(await screen.findByDisplayValue("https://models.sjtu.edu.cn/api/v1")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "deepseek-chat（推荐）" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "deepseek-reasoner" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "glm-5" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "minimax" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "minimax-m2.5" })).toBeInTheDocument();
  });
});
