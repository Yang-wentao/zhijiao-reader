# ZhiJiao Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local web MVP that opens a local PDF, lets the user select a passage, and sends that passage to an AI assistant panel for translation or Q&A.

**Architecture:** Use a Vite + React frontend for the split reader UI and a local Express backend for AI requests. Keep AI integration behind a provider interface, stream model output over SSE when available, and scope each assistant card to a single PDF selection.

**Tech Stack:** React, TypeScript, Vite, Express, PDF.js via `react-pdf`, OpenAI JavaScript SDK, SSE, Vitest

---

### Task 1: Scaffold the app shell

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `index.html`
- Create: `server/index.ts`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/styles.css`

- [ ] **Step 1: Create package and scripts**

```json
{
  "name": "zhijiao-reader",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "concurrently \"npm:dev:server\" \"npm:dev:client\"",
    "dev:client": "vite",
    "dev:server": "tsx watch server/index.ts",
    "build": "tsc -b && vite build",
    "test": "vitest run"
  }
}
```

- [ ] **Step 2: Add frontend entrypoint**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 3: Add initial backend heartbeat**

```ts
import express from "express";

const app = express();
app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.listen(8787, () => {
  console.log("Server listening on http://localhost:8787");
});
```

- [ ] **Step 4: Verify the scaffold**

Run: `npm install && npm run build`  
Expected: frontend build completes and TypeScript succeeds

### Task 2: Build backend AI layer and setup checks

**Files:**
- Modify: `server/index.ts`
- Create: `server/config.ts`
- Create: `server/prompts.ts`
- Create: `server/providers/types.ts`
- Create: `server/providers/openaiProvider.ts`
- Create: `server/routes/ai.ts`
- Test: `server/providers/openaiProvider.test.ts`

- [ ] **Step 1: Add configuration loader**

```ts
export function getServerConfig() {
  return {
    openAIApiKey: process.env.OPENAI_API_KEY ?? "",
    model: process.env.OPENAI_MODEL ?? "gpt-4o",
    port: Number(process.env.PORT ?? 8787),
  };
}
```

- [ ] **Step 2: Add prompt templates**

```ts
export const TRANSLATE_SYSTEM_PROMPT = `You are an academic translation assistant...`;
export const ASK_SYSTEM_PROMPT = `You are a research paper reading assistant...`;
```

- [ ] **Step 3: Add provider interface and OpenAI implementation**

```ts
export interface AIProvider {
  streamTranslation(input: TranslationInput): Promise<AsyncIterable<string>>;
  streamAnswer(input: AskInput): Promise<AsyncIterable<string>>;
}
```

- [ ] **Step 4: Add SSE routes**

```ts
router.post("/translate/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
});
```

- [ ] **Step 5: Add failing provider/config tests**

```ts
it("throws when OPENAI_API_KEY is missing", () => {
  expect(() => requireKey("")).toThrow("OPENAI_API_KEY");
});
```

- [ ] **Step 6: Run backend tests**

Run: `npm test -- server/providers/openaiProvider.test.ts`  
Expected: PASS

### Task 3: Build the PDF reader and split layout

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Create: `src/components/SplitLayout.tsx`
- Create: `src/components/PdfPane.tsx`
- Create: `src/components/ResizableDivider.tsx`
- Create: `src/types.ts`
- Test: `src/components/SplitLayout.test.tsx`

- [ ] **Step 1: Add a split layout with draggable divider**

```tsx
<div className="layout">
  <section className="pane pane-left">{left}</section>
  <ResizableDivider />
  <aside className="pane pane-right">{right}</aside>
</div>
```

- [ ] **Step 2: Add PDF upload and rendering**

```tsx
<input type="file" accept="application/pdf" onChange={handleFileChange} />
<Document file={file} onLoadSuccess={handleLoadSuccess}>
  <Page pageNumber={pageNumber} renderTextLayer />
</Document>
```

- [ ] **Step 3: Preserve PDF search and normal text selection**

```tsx
<div className="pdf-pane" onMouseUp={handleSelectionCapture}>
  {/* react-pdf document here */}
</div>
```

- [ ] **Step 4: Add layout tests**

Run: `npm test -- src/components/SplitLayout.test.tsx`  
Expected: PASS

### Task 4: Add selection capture and assistant cards

**Files:**
- Modify: `src/App.tsx`
- Create: `src/components/SelectionToolbar.tsx`
- Create: `src/components/AssistantPanel.tsx`
- Create: `src/components/PassageCard.tsx`
- Create: `src/state/cards.ts`
- Test: `src/state/cards.test.ts`

- [ ] **Step 1: Add selection state and limits**

```ts
export function validateSelection(text: string) {
  if (!text.trim()) return { ok: false, reason: "empty" };
  if (text.length > 8000) return { ok: false, reason: "too_long" };
  return { ok: true };
}
```

- [ ] **Step 2: Show a floating toolbar on valid selection**

```tsx
<SelectionToolbar
  selection={selection}
  onTranslate={() => createCard("translate")}
  onAsk={() => createCard("ask")}
/>
```

- [ ] **Step 3: Add passage cards and local history**

```ts
type PassageCard = {
  id: string;
  selectionText: string;
  mode: "translate" | "ask";
  messages: Message[];
  status: "idle" | "loading" | "streaming" | "done" | "error";
};
```

- [ ] **Step 4: Test card state isolation**

Run: `npm test -- src/state/cards.test.ts`  
Expected: PASS and confirms one card history does not leak into another

### Task 5: Wire frontend-backend streaming and UX polish

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/AssistantPanel.tsx`
- Modify: `src/components/PassageCard.tsx`
- Create: `src/lib/api.ts`
- Create: `src/lib/sse.ts`
- Test: `src/lib/api.test.ts`

- [ ] **Step 1: Add client SSE helpers**

```ts
export async function streamCardResponse(...) {
  const response = await fetch(endpoint, { method: "POST", body: JSON.stringify(payload) });
  // parse SSE chunks and append text
}
```

- [ ] **Step 2: Render incremental output and retry/copy actions**

```tsx
<button onClick={onCopy}>Copy</button>
<button onClick={onRetry}>Retry</button>
```

- [ ] **Step 3: Add empty/setup/error states**

```tsx
if (!hasApiKey) return <SetupScreen />;
if (!file) return <EmptyReaderState />;
```

- [ ] **Step 4: Run focused tests and full build**

Run: `npm test && npm run build`  
Expected: PASS

### Task 6: Manual verification

**Files:**
- Modify: `.env.example`
- Create: `README.md`

- [ ] **Step 1: Document local setup**

```md
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o
```

- [ ] **Step 2: Verify end-to-end manually**

Run: `npm run dev`  
Expected:
- app opens in browser
- local PDF loads
- selecting text shows toolbar
- translate streams text into a new card
- ask mode supports follow-up questions without cross-card context leakage

- [ ] **Step 3: Note environment caveats**

Document that scanned PDFs are out of scope and page refresh clears cards.
