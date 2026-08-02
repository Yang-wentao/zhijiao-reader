import { useEffect, useMemo, useRef, useState } from "react";
import { AssistantPanel } from "./components/AssistantPanel";
import { ConnectionSettingsModal } from "./components/ConnectionSettingsModal";
import { HighlightContextMenu, PdfContextMenu } from "./components/PdfContextMenu";
import { PdfPane } from "./components/PdfPane";
import { SplitLayout } from "./components/SplitLayout";
import { IS_WEB_BUILD } from "./lib/appMode";
import { splitIntoReadableChunks as splitStreamChunks } from "./lib/streaming";
import {
  appendNote,
  fetchAppConfig,
  fetchCloudBalance,
  fetchConnectionSettings,
  fetchHighlights,
  saveConnectionSettings,
  streamAsk,
  streamTranslation,
  syncHighlights,
  testConnectionSettings,
} from "./lib/api";
import { cardsReducer, createCard, getCardHistory, validateSelection } from "./state/cards";
import type {
  AppConfig,
  CloudBalance,
  ConnectionSettings,
  PassageCard,
  PdfContextSelection,
  PdfHighlight,
  PdfTab,
} from "./types";

const DEFAULT_CONFIG: AppConfig = {
  hasApiKey: false,
  isReady: false,
  provider: "cloud",
  providerOptions: ["cloud", "deepseek", "sjtu", "openai", "custom", "codex"],
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
  annotationAuthor: "",
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
  // Gateway info for 知交订阅 — fetched once when the provider becomes active
  // so the header chip can name the model the gateway actually runs. Quota is
  // deliberately NOT surfaced here; it lives in Settings → 测试连接.
  const [cloudBalance, setCloudBalance] = useState<CloudBalance | null>(null);
  const [tabs, setTabs] = useState<PdfTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [ratio, setRatio] = useState(0.68);
  const [toast, setToast] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [pendingAppends, setPendingAppends] = useState<PendingNoteAppend[]>([]);
  // Highlight undo / redo stacks. Each entry is a full highlight plus the tab
  // it belongs to; undo/redo pop the newest entry for the ACTIVE tab. These
  // only ever touch in-memory state — the PDF file changes only on save.
  const [undoStack, setUndoStack] = useState<{ tabId: string; highlight: PdfHighlight }[]>([]);
  const [redoStack, setRedoStack] = useState<{ tabId: string; highlight: PdfHighlight }[]>([]);
  // The highlight whose comment card is currently open in edit mode (textarea
  // focused). null = no card being edited. Lives here, not in PdfPane, so the
  // right-click "添加评论" action can open a card straight into edit mode.
  const [editingHighlightId, setEditingHighlightId] = useState<string | null>(null);
  // Position + target of the right-click menu shown on an existing highlight.
  const [highlightMenu, setHighlightMenu] = useState<
    { highlightId: string; x: number; y: number } | null
  >(null);
  const tabsRef = useRef<PdfTab[]>([]);
  // Always points at the latest highlight shortcut handlers so the global
  // keyboard listener (attached once) calls versions with fresh closures.
  const shortcutsRef = useRef<{ undo: () => void; redo: () => void; save: () => void }>({
    undo: () => {},
    redo: () => {},
    save: () => {},
  });

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

  // Ask the gateway which model it runs when 知交订阅 becomes active (and clear
  // it when switching away, so a stale name never lingers in the chip).
  // connectionLabel is a dependency so saving new settings — e.g. pasting an
  // activation code into the web build — refreshes the chip too.
  useEffect(() => {
    if (config.provider !== "cloud") {
      setCloudBalance(null);
      return;
    }
    void fetchCloudBalance().then(setCloudBalance);
  }, [config.provider, config.connectionLabel]);

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

  // Keep the shortcut ref current so the global keyboard listener always
  // runs the latest closures.
  useEffect(() => {
    shortcutsRef.current = {
      undo: handleUndo,
      redo: handleRedo,
      save: handleSaveHighlights,
    };
  });

  // Global highlight shortcuts:
  //   Cmd/Ctrl+Z        → undo highlight
  //   Cmd/Ctrl+Shift+Z  → redo highlight
  //   Cmd/Ctrl+S        → save highlights into the PDF file
  // Skipped while the user is typing in a text field so they never steal the
  // browser's native text editing shortcuts.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "s") return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) {
          return;
        }
      }
      if (key === "s") {
        event.preventDefault();
        shortcutsRef.current.save();
        return;
      }
      // key === "z"
      event.preventDefault();
      if (event.shiftKey) {
        shortcutsRef.current.redo();
      } else {
        shortcutsRef.current.undo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
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
      setToast(error instanceof Error ? error.message : "无法加载连接设置。");
    }
  }

  function handleFileSelected(file: File) {
    // Resolve the real disk path via the Electron bridge so the backend can
    // write highlight annotations back into this PDF. null in a plain
    // browser — highlights then render in-app but can't be persisted.
    const filePath = window.desktopShell?.getPathForFile?.(file) ?? null;
    const nextTab: PdfTab = {
      id: crypto.randomUUID(),
      fileName: file.name,
      fileUrl: URL.createObjectURL(file),
      filePath,
      cards: [],
      lastPageIndex: 0,
      lastScrollTop: 0,
      highlights: [],
      highlightsDirty: false,
    };
    setTabs((current) => [...current, nextTab]);
    setActiveTabId(nextTab.id);

    // Load highlight annotations already in the file (incl. ones made by WPS
    // / Adobe). Best-effort: failures leave the tab with no highlights.
    if (filePath) {
      void fetchHighlights(filePath).then((highlights) => {
        if (highlights.length === 0) {
          return;
        }
        setTabs((current) =>
          current.map((tab) => (tab.id === nextTab.id ? { ...tab, highlights } : tab)),
        );
      });
    }
  }

  function handleTabPageIndexChange(tabId: string, pageIndex: number) {
    setTabs((current) =>
      current.map((tab) =>
        tab.id === tabId && tab.lastPageIndex !== pageIndex
          ? { ...tab, lastPageIndex: pageIndex }
          : tab,
      ),
    );
  }

  function handleTabScrollTopChange(tabId: string, scrollTop: number) {
    setTabs((current) =>
      current.map((tab) =>
        tab.id === tabId && tab.lastScrollTop !== scrollTop
          ? { ...tab, lastScrollTop: scrollTop }
          : tab,
      ),
    );
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
        error: error instanceof Error ? error.message : "翻译失败，请重试。",
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
        error: error instanceof Error ? error.message : "提问失败，请重试。",
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
    setToast("这张卡片还没有可重试的内容。");
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
      setConnectionNotice(error instanceof Error ? error.message : "连接测试失败。");
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
      setToast(`已切换到 ${nextConfig.connectionLabel}`);
    } catch (error) {
      setConnectionNotice(error instanceof Error ? error.message : "保存设置失败。");
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

  function buildHighlight(
    colorHex: string,
    selection: PdfContextSelection,
    comment: string,
  ): PdfHighlight {
    return {
      id: crypto.randomUUID(),
      color: colorHex,
      rects: selection.rects,
      text: selection.text,
      comment,
      author: config.annotationAuthor,
      createdAt: Date.now(),
      managed: true,
    };
  }

  // Append a freshly created highlight to a tab. The overlay shows
  // immediately; the PDF file isn't touched until the user saves (Cmd+S),
  // so the tab is marked dirty to light up the save button.
  function addHighlightToTab(tabId: string, highlight: PdfHighlight) {
    setTabs((current) =>
      current.map((entry) =>
        entry.id === tabId
          ? { ...entry, highlights: [...entry.highlights, highlight], highlightsDirty: true }
          : entry,
      ),
    );
    setUndoStack((current) => [...current, { tabId, highlight }]);
    // A fresh highlight invalidates the redo stack.
    setRedoStack([]);
  }

  function handleMenuHighlight(colorHex: string) {
    if (!contextMenu) {
      return;
    }
    const { tabId, selection } = contextMenu;
    if (selection.rects.length === 0) {
      return;
    }
    addHighlightToTab(tabId, buildHighlight(colorHex, selection, ""));
  }

  // Right-click "添加评论": create a highlight (default yellow) and open its
  // comment card straight into edit mode so the user can type immediately.
  function handleMenuComment() {
    if (!contextMenu) {
      return;
    }
    const { tabId, selection } = contextMenu;
    if (selection.rects.length === 0) {
      return;
    }
    const highlight = buildHighlight("#FFE920", selection, "");
    addHighlightToTab(tabId, highlight);
    setEditingHighlightId(highlight.id);
  }

  // Update a highlight's comment text (in-memory; saved to the file on Cmd+S).
  // Writing a comment also (re)stamps the author with the name currently set
  // in Settings, so changing the name there applies to every new edit.
  function handleCommentChange(highlightId: string, comment: string) {
    if (!activeTabId) {
      return;
    }
    const author = config.annotationAuthor;
    setTabs((current) =>
      current.map((tab) =>
        tab.id === activeTabId
          ? {
              ...tab,
              highlights: tab.highlights.map((h) =>
                h.id === highlightId ? { ...h, comment, author } : h,
              ),
              highlightsDirty: true,
            }
          : tab,
      ),
    );
    // Keep undo/redo snapshots current so a later redo restores the comment.
    const syncSnapshot = (entry: { tabId: string; highlight: PdfHighlight }) =>
      entry.highlight.id === highlightId
        ? { ...entry, highlight: { ...entry.highlight, comment, author } }
        : entry;
    setUndoStack((current) => current.map(syncSnapshot));
    setRedoStack((current) => current.map(syncSnapshot));
  }

  // Delete a comment (the card's × button). The highlight itself stays.
  function handleCommentDelete(highlightId: string) {
    handleCommentChange(highlightId, "");
    setEditingHighlightId((current) => (current === highlightId ? null : current));
  }

  // Right-click on a highlight opens a menu (取消高亮 / 写批注).
  function handleHighlightContextMenu(highlightId: string, x: number, y: number) {
    setHighlightMenu({ highlightId, x, y });
  }

  // 取消高亮: drop the highlight (and its comment). Takes effect in the file
  // on the next save, like every other highlight edit.
  function handleRemoveHighlight(highlightId: string) {
    if (!activeTabId) {
      return;
    }
    setTabs((current) =>
      current.map((tab) =>
        tab.id === activeTabId
          ? {
              ...tab,
              highlights: tab.highlights.filter((h) => h.id !== highlightId),
              highlightsDirty: true,
            }
          : tab,
      ),
    );
    setUndoStack((current) => current.filter((entry) => entry.highlight.id !== highlightId));
    setRedoStack((current) => current.filter((entry) => entry.highlight.id !== highlightId));
    setEditingHighlightId((current) => (current === highlightId ? null : current));
    setToast("已取消高亮（保存后写入文件）");
  }

  // Undo the most recent highlight in the ACTIVE tab — purely an in-memory
  // operation (the file changes only on save). Only highlights created in
  // this session are on the undo stack; imported ones (incl. WPS's) aren't.
  function handleUndo() {
    if (!activeTabId) {
      return;
    }
    let index = -1;
    for (let i = undoStack.length - 1; i >= 0; i -= 1) {
      if (undoStack[i].tabId === activeTabId) {
        index = i;
        break;
      }
    }
    if (index === -1) {
      return;
    }
    const entry = undoStack[index];
    setTabs((current) =>
      current.map((t) =>
        t.id === entry.tabId
          ? {
              ...t,
              highlights: t.highlights.filter((h) => h.id !== entry.highlight.id),
              highlightsDirty: true,
            }
          : t,
      ),
    );
    setUndoStack((current) => current.filter((_, i) => i !== index));
    setRedoStack((current) => [...current, entry]);
    setToast("已撤销高亮（保存后写入文件）");
  }

  // Redo: re-apply the most recently undone highlight in the active tab.
  function handleRedo() {
    if (!activeTabId) {
      return;
    }
    let index = -1;
    for (let i = redoStack.length - 1; i >= 0; i -= 1) {
      if (redoStack[i].tabId === activeTabId) {
        index = i;
        break;
      }
    }
    if (index === -1) {
      return;
    }
    const entry = redoStack[index];
    setTabs((current) =>
      current.map((t) =>
        t.id === entry.tabId
          ? { ...t, highlights: [...t.highlights, entry.highlight], highlightsDirty: true }
          : t,
      ),
    );
    setRedoStack((current) => current.filter((_, i) => i !== index));
    setUndoStack((current) => [...current, entry]);
    setToast("已重做高亮（保存后写入文件）");
  }

  // Save: write the active tab's managed highlights into the PDF file. This
  // is the only operation that touches the file on disk — borrowing the
  // explicit-save model from 知云文献阅读.
  function handleSaveHighlights() {
    if (!activeTabId) {
      return;
    }
    const tab = tabsRef.current.find((t) => t.id === activeTabId);
    if (!tab) {
      return;
    }
    if (!tab.filePath) {
      setToast(
        IS_WEB_BUILD
          ? "网页版的划线仅本次会话有效，暂不支持写回 PDF 文件；需要保存请使用桌面版"
          : "无法获取 PDF 文件路径，无法保存高亮（请确认在桌面端打开）",
      );
      return;
    }
    if (!tab.highlightsDirty) {
      setToast("高亮已是最新，无需保存");
      return;
    }
    const managed = tab.highlights.filter((h) => h.managed);
    void syncHighlights(tab.filePath, managed)
      .then(() => {
        setTabs((current) =>
          current.map((t) => (t.id === tab.id ? { ...t, highlightsDirty: false } : t)),
        );
        setToast("已保存高亮到 PDF 文件");
      })
      .catch((error) => {
        setToast(error instanceof Error ? error.message : "保存高亮失败");
      });
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
            tabs={tabs.map((tab) => ({
              id: tab.id,
              fileName: tab.fileName,
              fileUrl: tab.fileUrl,
              lastPageIndex: tab.lastPageIndex,
              lastScrollTop: tab.lastScrollTop,
              highlights: tab.highlights,
            }))}
            activeTabId={activeTabId}
            canUndo={undoStack.some((entry) => entry.tabId === activeTabId)}
            canSave={activeTab?.highlightsDirty ?? false}
            onUndo={handleUndo}
            onSaveHighlights={handleSaveHighlights}
            editingHighlightId={editingHighlightId}
            commentAuthor={config.annotationAuthor}
            onStartEditComment={setEditingHighlightId}
            onStopEditComment={() => setEditingHighlightId(null)}
            onCommentChange={handleCommentChange}
            onCommentDelete={handleCommentDelete}
            onHighlightContextMenu={handleHighlightContextMenu}
            onFileSelected={handleFileSelected}
            onSelectionCaptured={handleSelectionCaptured}
            onContextSelection={handleContextSelection}
            onTabSelected={setActiveTabId}
            onTabClosed={handleTabClosed}
            onTabPageIndexChange={handleTabPageIndexChange}
            onTabScrollTopChange={handleTabScrollTopChange}
          />
        }
        right={
          <AssistantPanel
            cards={cards}
            provider={config.provider}
            connectionLabel={config.connectionLabel}
            model={config.model}
            cloudBalance={cloudBalance}
            isUpdatingModel={isSavingConnection || isTestingConnection}
            questionActionLabel={config.questionActionLabel}
            translationTrigger={config.translationTrigger}
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
          showTranslate={config.translationTrigger === "menu"}
          canHighlight={contextMenu.selection.rects.length > 0}
          onClose={() => setContextMenu(null)}
          onTranslate={handleMenuTranslate}
          onHighlight={handleMenuHighlight}
          onComment={handleMenuComment}
        />
      ) : null}
      {highlightMenu ? (
        <HighlightContextMenu
          x={highlightMenu.x}
          y={highlightMenu.y}
          onClose={() => setHighlightMenu(null)}
          onComment={() => setEditingHighlightId(highlightMenu.highlightId)}
          onRemove={() => handleRemoveHighlight(highlightMenu.highlightId)}
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
