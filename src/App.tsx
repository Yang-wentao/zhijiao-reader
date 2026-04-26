import { useEffect, useMemo, useRef, useState } from "react";
import { AssistantPanel } from "./components/AssistantPanel";
import { ConnectionSettingsModal } from "./components/ConnectionSettingsModal";
import { PdfContextMenu } from "./components/PdfContextMenu";
import { PdfPane } from "./components/PdfPane";
import { SplitLayout } from "./components/SplitLayout";
import { splitIntoReadableChunks as splitStreamChunks } from "./lib/streaming";
import {
  appendNote,
  fetchAppConfig,
  fetchConnectionSettings,
  saveConnectionSettings,
  streamAsk,
  streamTranslation,
  testConnectionSettings,
} from "./lib/api";
import { cardsReducer, createCard, getCardHistory, validateSelection } from "./state/cards";
import type {
  AppConfig,
  ConnectionSettings,
  PassageCard,
  PdfContextSelection,
  PdfTab,
} from "./types";

const DEFAULT_CONFIG: AppConfig = {
  hasApiKey: false,
  isReady: false,
  provider: "openai",
  providerOptions: ["codex", "deepseek", "sjtu", "openai", "custom"],
  canSwitchProviders: false,
  model: "gpt-4o",
  modelOptions: ["gpt-4o"],
  canSwitchModels: false,
  reasoningEffort: null,
  reasoningEffortOptions: [],
  canSwitchReasoningEffort: false,
  questionActionLabel: "Ask ZhiJiao",
  maxSelectionChars: 8000,
  setupRequired: false,
  connectionLabel: "Not connected",
  notesReady: false,
  translationTrigger: "selection",
};

type PendingNoteAppend = {
  id: string;
  tabId: string;
  cardId: string;
  pdfName: string;
  startPage: number | null;
  endPage: number | null;
  original: string;
};

type ContextMenuState = {
  tabId: string;
  selection: PdfContextSelection;
  pdfName: string;
};

export default function App() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [configError, setConfigError] = useState<string | null>(null);
  const [connectionSettings, setConnectionSettings] = useState<ConnectionSettings | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isSavingConnection, setIsSavingConnection] = useState(false);
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);
  const [tabs, setTabs] = useState<PdfTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [ratio, setRatio] = useState(0.68);
  const [toast, setToast] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [pendingAppends, setPendingAppends] = useState<PendingNoteAppend[]>([]);
  const tabsRef = useRef<PdfTab[]>([]);

  useEffect(() => {
    void fetchAppConfig()
      .then((nextConfig) => {
        setConfig(nextConfig);
        if (nextConfig.setupRequired) {
          void openSettingsModal(true);
        }
      })
      .catch((error: Error) => {
        setConfigError(error.message);
      });
  }, []);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timeout = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    return () => {
      tabsRef.current.forEach((tab) => URL.revokeObjectURL(tab.fileUrl));
    };
  }, []);


  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? null,
    [activeTabId, tabs],
  );
  const cards = activeTab?.cards ?? [];

  const selectedCardById = useMemo(() => {
    const entries = new Map<string, PassageCard>();
    cards.forEach((card) => entries.set(card.id, card));
    return entries;
  }, [cards]);

  async function openSettingsModal(forceOpen = false) {
    try {
      const settings = await fetchConnectionSettings();
      setConnectionSettings(settings);
      setConnectionNotice(null);
      if (forceOpen || !isSettingsOpen) {
        setIsSettingsOpen(true);
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Failed to load connection settings.");
    }
  }

  function handleFileSelected(file: File) {
    const nextTab: PdfTab = {
      id: crypto.randomUUID(),
      fileName: file.name,
      fileUrl: URL.createObjectURL(file),
      cards: [],
    };
    setTabs((current) => [...current, nextTab]);
    setActiveTabId(nextTab.id);
  }

  function dispatchCardActionForTab(tabId: string, action: Parameters<typeof cardsReducer>[1]) {
    setTabs((current) =>
      current.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              cards: cardsReducer(tab.cards, action),
            }
          : tab,
      ),
    );
  }

  function dispatchCardAction(action: Parameters<typeof cardsReducer>[1]) {
    if (!activeTabId) {
      return;
    }
    dispatchCardActionForTab(activeTabId, action);
  }

  function createSelectionCardForTab(
    tabId: string,
    text: string,
    pageNumber: number | null,
    mode: "translate" | "ask",
  ) {
    const card = createCard(text, pageNumber, mode);
    dispatchCardActionForTab(tabId, { type: "add_card", card });
    return card;
  }

  async function runTranslation(card: PassageCard, tabId: string) {
    const dispatchForSourceTab = (action: Parameters<typeof cardsReducer>[1]) =>
      dispatchCardActionForTab(tabId, action);
    dispatchForSourceTab({ type: "start_request", cardId: card.id });
    let result = "";
    let queue = Promise.resolve();
    try {
      await streamTranslation(card, {
        onDelta: (chunk) => {
          result += chunk;
          queue = queue.then(() => appendChunkWithCadence(dispatchForSourceTab, card.id, chunk));
        },
        onDone: () => {
          void queue.then(() => {
            dispatchForSourceTab({ type: "finish_request", cardId: card.id, assistantMessage: result.trim() });
          });
        },
      });
    } catch (error) {
      dispatchForSourceTab({
        type: "fail_request",
        cardId: card.id,
        error: error instanceof Error ? error.message : "Translation failed.",
      });
    }
  }

  async function handleTranslate(text: string, pageNumber: number | null) {
    if (!activeTabId) {
      return;
    }
    const card = createSelectionCardForTab(activeTabId, text, pageNumber, "translate");
    await runTranslation(card, activeTabId);
  }

  async function handleAsk(cardId: string, question: string) {
    if (!activeTabId) {
      return;
    }
    const tabId = activeTabId;
    const card = selectedCardById.get(cardId);
    if (!card) {
      return;
    }
    const dispatchForSourceTab = (action: Parameters<typeof cardsReducer>[1]) =>
      dispatchCardActionForTab(tabId, action);
    dispatchForSourceTab({ type: "start_request", cardId, userMessage: question, mode: "ask" });
    let result = "";
    let queue = Promise.resolve();
    try {
      await streamAsk(card, question, getCardHistory(card), {
        onDelta: (chunk) => {
          result += chunk;
          queue = queue.then(() => appendChunkWithCadence(dispatchForSourceTab, cardId, chunk));
        },
        onDone: () => {
          void queue.then(() => {
            dispatchForSourceTab({ type: "finish_request", cardId, assistantMessage: result.trim() });
          });
        },
      });
    } catch (error) {
      dispatchForSourceTab({
        type: "fail_request",
        cardId,
        error: error instanceof Error ? error.message : "Question failed.",
      });
    }
  }

  async function handleRetry(cardId: string) {
    if (!activeTabId) {
      return;
    }
    const card = selectedCardById.get(cardId);
    if (!card) {
      return;
    }
    if (card.mode === "translate" && card.messages.length === 0 && !card.lastQuestion) {
      await runTranslation(card, activeTabId);
      return;
    }
    if (card.lastQuestion) {
      await handleAsk(cardId, card.lastQuestion);
      return;
    }
    setToast("Nothing to retry yet in this card.");
  }

  async function handleConnectionTest() {
    if (!connectionSettings) {
      return;
    }
    setIsTestingConnection(true);
    try {
      const result = await testConnectionSettings(connectionSettings);
      setConnectionNotice(result.message);
    } catch (error) {
      setConnectionNotice(error instanceof Error ? error.message : "Connection test failed.");
    } finally {
      setIsTestingConnection(false);
    }
  }

  async function handleConnectionSave() {
    if (!connectionSettings) {
      return;
    }
    setIsSavingConnection(true);
    try {
      const nextConfig = await saveConnectionSettings(connectionSettings);
      setConfig(nextConfig);
      setIsSettingsOpen(false);
      setToast(`Now using ${nextConfig.connectionLabel}.`);
    } catch (error) {
      setConnectionNotice(error instanceof Error ? error.message : "Failed to save settings.");
    } finally {
      setIsSavingConnection(false);
    }
  }

  function findLatestTranslateCardForText(tabId: string, text: string): PassageCard | null {
    const trimmed = text.trim();
    const sourceCards = tabs.find((tab) => tab.id === tabId)?.cards ?? [];
    for (let index = sourceCards.length - 1; index >= 0; index -= 1) {
      const card = sourceCards[index];
      if (card.mode === "translate" && card.selectionText.trim() === trimmed) {
        return card;
      }
    }
    return null;
  }

  function getAssistantText(card: PassageCard): string {
    for (let i = card.messages.length - 1; i >= 0; i -= 1) {
      const message = card.messages[i];
      if (message.role === "assistant") {
        return message.content;
      }
    }
    return "";
  }

  async function fireAppendNote(payload: {
    pdfName: string;
    startPage: number | null;
    endPage: number | null;
    original: string;
    translation?: string | null;
  }) {
    try {
      await appendNote(payload);
      setToast("已加入 Obsidian 笔记");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "加入笔记失败");
    }
  }

  function handleSelectionCaptured(text: string, pageNumber: number | null) {
    // When the user has switched to "menu" trigger mode, raw selections never
    // fire translation — only the right-click menu does. This keeps users who
    // rely on right-click for the Obsidian flow from burning API calls on
    // every drag-select.
    if (config.translationTrigger === "menu") {
      return;
    }
    const validation = validateSelection(text, config.maxSelectionChars);
    if (!validation.ok) {
      if (validation.reason === "too_long") {
        setToast("选中的文字太长了，请缩短再试。");
      }
      return;
    }
    void handleTranslate(text, pageNumber);
  }

  function handleContextSelection(selection: PdfContextSelection) {
    if (!activeTab) {
      return;
    }
    const validation = validateSelection(selection.text, config.maxSelectionChars);
    if (!validation.ok) {
      if (validation.reason === "too_long") {
        setToast("选中的文字太长了，请缩短再试。");
      }
      return;
    }
    setContextMenu({
      tabId: activeTab.id,
      selection,
      pdfName: activeTab.fileName,
    });
  }

  function handleMenuTranslate() {
    if (!contextMenu) {
      return;
    }
    const card = createSelectionCardForTab(
      contextMenu.tabId,
      contextMenu.selection.text,
      contextMenu.selection.startPage,
      "translate",
    );
    void runTranslation(card, contextMenu.tabId);
  }

  function handleAppendOriginal() {
    if (!contextMenu) {
      return;
    }
    if (!config.notesReady) {
      setToast("请先在 Settings 配置 Obsidian vault 路径");
      return;
    }
    void fireAppendNote({
      pdfName: contextMenu.pdfName,
      startPage: contextMenu.selection.startPage,
      endPage: contextMenu.selection.endPage,
      original: contextMenu.selection.text,
    });
  }

  function handleAppendWithTranslation() {
    if (!contextMenu) {
      return;
    }
    if (!config.notesReady) {
      setToast("请先在 Settings 配置 Obsidian vault 路径");
      return;
    }
    const matched = findLatestTranslateCardForText(contextMenu.tabId, contextMenu.selection.text);
    if (matched?.status === "done") {
      void fireAppendNote({
        pdfName: contextMenu.pdfName,
        startPage: contextMenu.selection.startPage,
        endPage: contextMenu.selection.endPage,
        original: contextMenu.selection.text,
        translation: getAssistantText(matched),
      });
      return;
    }
    let cardId: string;
    if (matched && matched.status !== "error") {
      cardId = matched.id;
    } else {
      const card = createSelectionCardForTab(
        contextMenu.tabId,
        contextMenu.selection.text,
        contextMenu.selection.startPage,
        "translate",
      );
      cardId = card.id;
      void runTranslation(card, contextMenu.tabId);
    }
    setPendingAppends((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        tabId: contextMenu.tabId,
        cardId,
        pdfName: contextMenu.pdfName,
        startPage: contextMenu.selection.startPage,
        endPage: contextMenu.selection.endPage,
        original: contextMenu.selection.text,
      },
    ]);
    setToast("翻译完成后将自动写入笔记");
  }

  useEffect(() => {
    if (pendingAppends.length === 0) {
      return;
    }
    const ready: Array<{ pending: PendingNoteAppend; card: PassageCard }> = [];
    const remaining: PendingNoteAppend[] = [];
    let droppedError = false;
    pendingAppends.forEach((pending) => {
      const tab = tabs.find((entry) => entry.id === pending.tabId);
      if (!tab) {
        droppedError = true;
        return;
      }
      const card = tab.cards.find((entry) => entry.id === pending.cardId);
      if (!card) {
        remaining.push(pending);
        return;
      }
      if (card.status === "done") {
        ready.push({ pending, card });
        return;
      }
      if (card.status === "error") {
        droppedError = true;
        return;
      }
      remaining.push(pending);
    });
    if (ready.length === 0 && remaining.length === pendingAppends.length && !droppedError) {
      return;
    }
    setPendingAppends(remaining);
    if (droppedError) {
      setToast("翻译失败，未加入笔记");
    }
    ready.forEach(({ pending, card }) => {
      void fireAppendNote({
        pdfName: pending.pdfName,
        startPage: pending.startPage,
        endPage: pending.endPage,
        original: pending.original,
        translation: getAssistantText(card),
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, pendingAppends]);

  function handleTabClosed(tabId: string) {
    setTabs((current) => {
      const closingIndex = current.findIndex((tab) => tab.id === tabId);
      if (closingIndex === -1) {
        return current;
      }
      URL.revokeObjectURL(current[closingIndex].fileUrl);
      const nextTabs = current.filter((tab) => tab.id !== tabId);
      if (activeTabId === tabId) {
        const fallbackTab = nextTabs[Math.max(0, closingIndex - 1)] ?? nextTabs[0] ?? null;
        setActiveTabId(fallbackTab?.id ?? null);
      }
      return nextTabs;
    });
  }

  if (configError) {
    return (
      <main className="app-shell">
        <section className="setup-screen">
          <h1>App configuration failed</h1>
          <p>{configError}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <SplitLayout
        ratio={ratio}
        onRatioChange={setRatio}
        left={
          <PdfPane
            tabs={tabs.map((tab) => ({ id: tab.id, fileName: tab.fileName }))}
            activeTabId={activeTabId}
            activeFileUrl={activeTab?.fileUrl ?? null}
            activeFileName={activeTab?.fileName ?? null}
            onFileSelected={handleFileSelected}
            onSelectionCaptured={handleSelectionCaptured}
            onContextSelection={handleContextSelection}
            onTabSelected={setActiveTabId}
            onTabClosed={handleTabClosed}
          />
        }
        right={
          <AssistantPanel
            cards={cards}
            provider={config.provider}
            connectionLabel={config.connectionLabel}
            model={config.model}
            reasoningEffort={config.reasoningEffort}
            isUpdatingModel={isSavingConnection || isTestingConnection}
            questionActionLabel={config.questionActionLabel}
            onOpenSettings={() => void openSettingsModal()}
            onAsk={handleAsk}
            onDismiss={(cardId) => dispatchCardAction({ type: "dismiss_card", cardId })}
            onToggle={(cardId) => dispatchCardAction({ type: "toggle_card", cardId })}
            onRetry={handleRetry}
            onNotice={setToast}
          />
        }
      />
      <ConnectionSettingsModal
        isOpen={isSettingsOpen}
        settings={connectionSettings}
        isSaving={isSavingConnection}
        isTesting={isTestingConnection}
        testResult={connectionNotice}
        onClose={() => setIsSettingsOpen(false)}
        onChange={setConnectionSettings}
        onSave={() => void handleConnectionSave()}
        onTest={() => void handleConnectionTest()}
      />
      {contextMenu ? (
        <PdfContextMenu
          x={contextMenu.selection.x}
          y={contextMenu.selection.y}
          notesReady={config.notesReady}
          showTranslate={config.translationTrigger === "menu"}
          onClose={() => setContextMenu(null)}
          onTranslate={handleMenuTranslate}
          onAppendOriginal={handleAppendOriginal}
          onAppendWithTranslation={handleAppendWithTranslation}
        />
      ) : null}
      {toast ? <div className="toast">{toast}</div> : null}
    </main>
  );
}

async function appendChunkWithCadence(
  dispatch: (action: Parameters<typeof cardsReducer>[1]) => void,
  cardId: string,
  chunk: string,
) {
  const slices = chunk.length > 140 ? splitIntoReadableChunks(chunk) : [chunk];
  for (const slice of slices) {
    dispatch({ type: "append_draft", cardId, chunk: slice });
    if (slices.length > 1) {
      await sleep(42);
    }
  }
}

function splitIntoReadableChunks(text: string) {
  return splitStreamChunks(text);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
