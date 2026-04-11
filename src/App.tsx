import { useEffect, useMemo, useRef, useState } from "react";
import { AssistantPanel } from "./components/AssistantPanel";
import { PdfPane } from "./components/PdfPane";
import { SplitLayout } from "./components/SplitLayout";
import { splitIntoReadableChunks as splitStreamChunks } from "./lib/streaming";
import {
  fetchAppConfig,
  streamAsk,
  streamTranslation,
  updateAppModel,
  updateAppProvider,
  updateAppReasoningEffort,
} from "./lib/api";
import { cardsReducer, createCard, getCardHistory, validateSelection } from "./state/cards";
import type { AppConfig, PassageCard, PdfTab, SelectionOverlay } from "./types";

const DEFAULT_CONFIG: AppConfig = {
  hasApiKey: false,
  isReady: false,
  provider: "openai",
  providerOptions: ["openai"],
  canSwitchProviders: false,
  model: "gpt-4o",
  modelOptions: ["gpt-4o"],
  canSwitchModels: false,
  reasoningEffort: null,
  reasoningEffortOptions: [],
  canSwitchReasoningEffort: false,
  questionActionLabel: "Ask Codex",
  maxSelectionChars: 8000,
};

export default function App() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [configError, setConfigError] = useState<string | null>(null);
  const [tabs, setTabs] = useState<PdfTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [ratio, setRatio] = useState(0.68);
  const [toast, setToast] = useState<string | null>(null);
  const [isUpdatingModel, setIsUpdatingModel] = useState(false);
  const tabsRef = useRef<PdfTab[]>([]);

  useEffect(() => {
    void fetchAppConfig()
      .then((nextConfig) => {
        setConfig(nextConfig);
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

  function handleSelectionCaptured(nextSelection: SelectionOverlay | null) {
    if (!nextSelection || !activeTab) {
      return;
    }
    const validation = validateSelection(nextSelection.text, config.maxSelectionChars);
    if (!validation.ok) {
      if (validation.reason === "too_long") {
        setToast("Selected text is too long. Please select a shorter passage.");
      }
      return;
    }
    void handleTranslate(nextSelection);
  }

  function dispatchCardAction(action: Parameters<typeof cardsReducer>[1]) {
    if (!activeTabId) {
      return;
    }
    setTabs((current) =>
      current.map((tab) =>
        tab.id === activeTabId
          ? {
              ...tab,
              cards: cardsReducer(tab.cards, action),
            }
          : tab,
      ),
    );
  }

  function createSelectionCard(selection: SelectionOverlay, mode: "translate" | "ask") {
    const card = createCard(selection.text, selection.pageNumber, mode);
    dispatchCardAction({ type: "add_card", card });
    return card;
  }

  async function runTranslation(card: PassageCard) {
    dispatchCardAction({ type: "start_request", cardId: card.id });
    let result = "";
    let queue = Promise.resolve();
    try {
      await streamTranslation(card, {
        onDelta: (chunk) => {
          result += chunk;
          queue = queue.then(() => appendChunkWithCadence(dispatchCardAction, card.id, chunk));
        },
        onDone: () => {
          void queue.then(() => {
            dispatchCardAction({ type: "finish_request", cardId: card.id, assistantMessage: result.trim() });
          });
        },
      });
    } catch (error) {
      dispatchCardAction({
        type: "fail_request",
        cardId: card.id,
        error: error instanceof Error ? error.message : "Translation failed.",
      });
    }
  }

  async function handleTranslate(selection: SelectionOverlay) {
    const card = createSelectionCard(selection, "translate");
    await runTranslation(card);
  }

  async function handleAsk(cardId: string, question: string) {
    const card = selectedCardById.get(cardId);
    if (!card) {
      return;
    }
    dispatchCardAction({ type: "start_request", cardId, userMessage: question, mode: "ask" });
    let result = "";
    let queue = Promise.resolve();
    try {
      await streamAsk(card, question, getCardHistory(card), {
        onDelta: (chunk) => {
          result += chunk;
          queue = queue.then(() => appendChunkWithCadence(dispatchCardAction, cardId, chunk));
        },
        onDone: () => {
          void queue.then(() => {
            dispatchCardAction({ type: "finish_request", cardId, assistantMessage: result.trim() });
          });
        },
      });
    } catch (error) {
      dispatchCardAction({
        type: "fail_request",
        cardId,
        error: error instanceof Error ? error.message : "Question failed.",
      });
    }
  }

  async function handleRetry(cardId: string) {
    const card = selectedCardById.get(cardId);
    if (!card) {
      return;
    }
    if (card.mode === "translate" && card.messages.length === 0 && !card.lastQuestion) {
      await runTranslation(card);
      return;
    }
    if (card.lastQuestion) {
      await handleAsk(cardId, card.lastQuestion);
      return;
    }
    setToast("Nothing to retry yet in this card.");
  }

  async function handleModelChange(model: string) {
    if (model === config.model || isUpdatingModel) {
      return;
    }
    setIsUpdatingModel(true);
    try {
      const nextConfig = await updateAppModel(model);
      setConfig(nextConfig);
      setToast(`Now using ${nextConfig.model}.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Failed to switch model.");
    } finally {
      setIsUpdatingModel(false);
    }
  }

  async function handleProviderChange(provider: "openai" | "codex" | "deepseek") {
    if (provider === config.provider || isUpdatingModel) {
      return;
    }
    setIsUpdatingModel(true);
    try {
      const nextConfig = await updateAppProvider(provider);
      setConfig(nextConfig);
      setToast(`Now using ${formatProviderLabel(nextConfig.provider)} / ${nextConfig.model}.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Failed to switch provider.");
    } finally {
      setIsUpdatingModel(false);
    }
  }

  async function handleReasoningEffortChange(reasoningEffort: "low" | "medium" | "high") {
    if (reasoningEffort === config.reasoningEffort || isUpdatingModel) {
      return;
    }
    setIsUpdatingModel(true);
    try {
      const nextConfig = await updateAppReasoningEffort(reasoningEffort);
      setConfig(nextConfig);
      setToast(`Now using ${nextConfig.model} / ${nextConfig.reasoningEffort}.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Failed to switch reasoning effort.");
    } finally {
      setIsUpdatingModel(false);
    }
  }

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

  if (!config.isReady) {
    return (
      <main className="app-shell">
        <section className="setup-screen">
          <p className="panel-kicker">Setup required</p>
          {config.provider === "openai" || config.provider === "deepseek" ? (
            <>
              <h1>Create a local `.env` file before using the AI panel</h1>
              <pre className="setup-code">
                {config.provider === "openai"
                  ? `OPENAI_API_KEY=sk-...\nOPENAI_MODEL=${config.model}`
                  : `DEEPSEEK_API_KEY=sk-...\nDEEPSEEK_MODEL=${config.model}`}
              </pre>
              <p>
                The backend reads the API key from the project root. The browser never stores or receives the key.
              </p>
            </>
          ) : (
            <>
              <h1>The selected provider is not ready</h1>
              <p>Check the local Codex CLI installation and restart the backend.</p>
            </>
          )}
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
            onTabSelected={setActiveTabId}
            onTabClosed={handleTabClosed}
          />
        }
        right={
          <AssistantPanel
            cards={cards}
            provider={config.provider}
            providerOptions={config.providerOptions}
            canSwitchProviders={config.canSwitchProviders}
            model={config.model}
            modelOptions={config.modelOptions}
            canSwitchModels={config.canSwitchModels}
            reasoningEffort={config.reasoningEffort}
            reasoningEffortOptions={config.reasoningEffortOptions}
            canSwitchReasoningEffort={config.canSwitchReasoningEffort}
            isUpdatingModel={isUpdatingModel}
            questionActionLabel={config.questionActionLabel}
            onProviderChange={handleProviderChange}
            onModelChange={handleModelChange}
            onReasoningEffortChange={handleReasoningEffortChange}
            onAsk={handleAsk}
            onDismiss={(cardId) => dispatchCardAction({ type: "dismiss_card", cardId })}
            onToggle={(cardId) => dispatchCardAction({ type: "toggle_card", cardId })}
            onRetry={handleRetry}
            onNotice={setToast}
          />
        }
      />
      {toast ? <div className="toast">{toast}</div> : null}
    </main>
  );
}

function formatProviderLabel(provider: AppConfig["provider"]) {
  if (provider === "deepseek") {
    return "DeepSeek";
  }
  if (provider === "codex") {
    return "Local Codex";
  }
  return "OpenAI";
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
