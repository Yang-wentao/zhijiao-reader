// "cloud" = 知交云, the hosted subscription gateway (activation code only).
// The rest are bring-your-own-key providers.
export type ProviderName = "cloud" | "openai" | "codex" | "deepseek" | "sjtu" | "custom";

export type CardMode = "translate" | "ask";
export type CardStatus = "idle" | "loading" | "streaming" | "done" | "error";

// Bridge exposed by the Electron preload script. Absent in a plain browser.
declare global {
  interface Window {
    desktopShell?: {
      isElectron: boolean;
      // Resolves a File (from <input>/drag-drop) to its real disk path so the
      // backend can write annotations back into the original PDF. Returns
      // null when the path can't be determined.
      getPathForFile?: (file: File) => string | null;
    };
  }
}

// ── PDF highlight annotations ────────────────────────────────────────────
// Highlights are written into the PDF file itself as standard `Highlight`
// annotations (so WPS / Adobe / Preview see the same marks), and mirrored
// in app state for instant overlay rendering.

// A single rectangle of a highlight, in page-relative fractions (0..1) with
// a top-left origin. Zoom-independent: both the rect and the page element it
// was measured against scale together. One text selection usually produces
// several rects (one per visual line) and may span multiple pages.
export type HighlightRect = {
  pageIndex: number;
  left: number;
  top: number;
  width: number;
  height: number;
};

export type PdfHighlight = {
  id: string;
  // Hex color string, e.g. "#FFE920". Stored as hex (not a named enum) so
  // that highlights imported from WPS / other tools keep their exact color.
  color: string;
  rects: HighlightRect[];
  // The highlighted text — kept for context. Not strictly needed to render
  // the highlight; empty for highlights re-loaded from the PDF file.
  text: string;
  // Comment / note attached to this highlight. "" means no comment — the
  // highlight is then a plain color mark with no floating card.
  comment: string;
  // Who wrote the comment (shown on the card and written to the PDF /T).
  author: string;
  // Creation time (epoch ms) — shown as the timestamp on the comment card.
  createdAt: number;
  // True when WE own this highlight (added in-app, or written by us in a
  // past session). Only managed highlights are rewritten on save; ones
  // imported from WPS / Adobe (managed: false) are displayed but left
  // untouched in the file.
  managed: boolean;
};

export type CardMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type PassageCard = {
  id: string;
  selectionText: string;
  pageNumber: number | null;
  mode: CardMode;
  messages: CardMessage[];
  status: CardStatus;
  createdAt: number;
  collapsed: boolean;
  draftOutput: string;
  error: string | null;
  lastQuestion: string | null;
};

export type PdfTab = {
  id: string;
  fileName: string;
  fileUrl: string;
  // Real on-disk path of the PDF, resolved via the Electron bridge. null in
  // a plain browser or when it couldn't be determined — highlight writing is
  // disabled in that case.
  filePath: string | null;
  cards: PassageCard[];
  // Zero-based page index the user was last on. Restored as the Viewer's
  // `initialPage`, gets the document roughly to the right page on remount.
  lastPageIndex: number;
  // Exact pixel scrollTop within the Viewer's scroll container. Applied
  // AFTER `initialPage` jumps so the user lands at the same vertical
  // position within the page they were reading — not just the page top.
  lastScrollTop: number;
  // Highlight annotations for this PDF — loaded from the file on open and
  // appended to as the user marks text.
  highlights: PdfHighlight[];
  // True when the managed highlights differ from what's saved in the PDF
  // file (the user added/undid/redid since the last Cmd+S). Drives the
  // save button's enabled state.
  highlightsDirty: boolean;
};

// PdfPane keeps a per-tab Viewer alive in memory (one Viewer per open PDF,
// hidden via CSS when inactive). Each Viewer needs its file URL, the saved
// scroll position, and the highlight list to render the overlay.
export type PdfTabSummary = Pick<
  PdfTab,
  "id" | "fileName" | "fileUrl" | "lastPageIndex" | "lastScrollTop" | "highlights"
>;

export type SelectionOverlay = {
  text: string;
  pageNumber: number | null;
  x: number;
  y: number;
};

export type PdfContextSelection = {
  text: string;
  startPage: number | null;
  endPage: number | null;
  x: number;
  y: number;
  // Page-relative rectangles of the selected text, used to create a
  // highlight. Empty when geometry couldn't be measured.
  rects: HighlightRect[];
};

export type AppConfig = {
  hasApiKey: boolean;
  isReady: boolean;
  provider: ProviderName;
  providerOptions: ProviderName[];
  canSwitchProviders: boolean;
  model: string;
  modelOptions: string[];
  canSwitchModels: boolean;
  reasoningEffort: "low" | "medium" | "high" | null;
  reasoningEffortOptions: Array<"low" | "medium" | "high">;
  canSwitchReasoningEffort: boolean;
  questionActionLabel: string;
  maxSelectionChars: number;
  setupRequired: boolean;
  connectionLabel: string;
  notesReady: boolean;
  translationTrigger: "selection" | "menu";
  // Author name stamped on new highlight comments (from Settings; defaults
  // to the OS account name).
  annotationAuthor: string;
};

export type ConnectionSettings = {
  activeProvider: ProviderName;
  // 知交云：only an activation code — the API key and model live on the server.
  cloud: {
    activationCode: string;
    baseUrl: string;
  };
  codex: {
    bin: string;
    model: string;
    reasoningEffort: "low" | "medium" | "high";
  };
  deepseek: {
    apiKey: string;
    model: string;
    baseUrl: string;
    thinkingMode: "enabled" | "disabled";
  };
  sjtu: {
    apiKey: string;
    model: string;
    baseUrl: string;
  };
  openai: {
    apiKey: string;
    model: string;
    baseUrl: string;
    reasoningEffort: "low" | "medium" | "high";
  };
  custom: {
    label: string;
    apiKey: string;
    model: string;
    baseUrl: string;
  };
  notes: {
    enabled: boolean;
    vaultPath: string;
    subdir: string;
    includeTimestamp: boolean;
  };
  preferences: {
    translationTrigger: "selection" | "menu";
  };
  annotations: {
    author: string;
  };
};

export type ConnectionTestResult = {
  ok: boolean;
  message: string;
};

// Quota snapshot for the active 知交云 activation code (GET /api/cloud/balance).
export type CloudBalance = {
  label: string;
  quotaTokens: number;
  usedTokens: number;
  remainingTokens: number;
  period: string;
};
