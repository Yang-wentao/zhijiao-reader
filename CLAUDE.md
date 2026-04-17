# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` in the repo root is the authoritative handbook (in Chinese) for agents working here — read it for full module-by-module guidance, provider design, and common-task checklists. This file is a quick-reference summary; when in doubt, defer to `AGENTS.md`.

## Commands

- `npm run launch` — one-shot bootstrap: copies `.env.example` → `.env` if missing, checks for a local Codex CLI, runs `npm install` if needed, starts dev servers, opens `http://localhost:5173`. This is the normal way to start developing.
- `npm run dev` — parallel `dev:server` (`tsx watch server/index.ts`, port 8787) and `dev:client` (Vite, port 5173). Use this if you don't want `launch.mjs`'s checks.
- `npm run electron:dev` — same dev servers plus an Electron window once both ports are up.
- `npm test` — Vitest run (non-watch). Single file: `npx vitest run path/to/file.test.ts`. Single test: `npx vitest run -t "test name"`.
- `npm run build` — frontend (`tsc -b && vite build`).
- `npm run build:server` — backend only (`tsc -p tsconfig.server.json`).
- `npm run electron:pack` — builds frontend + backend, then `electron-builder --publish never`. **Do not remove `--publish never`** — under a git tag, electron-builder would otherwise attempt an implicit GitHub release and break CI.
- `npm run check` / `npm run configure` — env/Codex diagnostics without launching the full dev stack.

## Architecture (big picture)

The product is a local-first **two-pane PDF reader**: left pane reads a PDF, right pane shows streaming translation / Q&A cards for selected passages. It is *not* a generic chat app — keep that framing when making UX changes.

**Core flow to hold in your head (PDF selection → card):**
1. `src/components/PdfPane.tsx` captures selected text on right-click/contextmenu and reports text plus page range.
2. `src/App.tsx` `handleContextSelection()` validates length and opens `PdfContextMenu`.
3. The user chooses `翻译`, `加入笔记（原文）`, or `加入笔记（原文 + 译文）`. Selecting text alone does not create a card or call the backend.
4. Translation actions call `src/lib/api.ts` (`POST /api/translate/stream`); `src/lib/sse.ts` parses the SSE stream and `src/lib/streaming.ts` paces chunks into the UI.
5. Notes actions call `POST /api/notes/append`, writing markdown into the configured Obsidian vault.
6. `src/state/cards.ts` (`cardsReducer`) drives card state: `idle -> loading -> streaming -> done | error`. Card state machine edits belong here, not in `App.tsx`.

**Backend runtime (`server/index.ts`):** builds a `RuntimeState` holding `settings`, an `activeProviderName`, and a `runtimes` map produced by `createProviderRuntimeMap(settings)`. Each runtime entry carries not just a provider instance but also `isReady`, `model`, `modelOptions`, `canSwitchModels`, `reasoningEffort`, `setModel`, `setReasoningEffort`. Routes live in `server/routes/ai.ts` (`/api/config`, `/api/connection`, `/api/model`, `/api/translate/stream`, `/api/ask/stream`). SSE streams send a 10s `status` heartbeat; selection text is capped at 8000 chars; `ask` includes prior card history.

**Providers (`server/providers/*.ts`)** all satisfy the same interface (`streamTranslation`, `streamAnswer` returning `AsyncIterable<string>`):
- `deepseek`, `openai`, `sjtu`, `custom` are OpenAI-compatible HTTP clients. **SJTU is a first-class provider**, not a "custom" variant — it has its own UI options and model list in both frontend and backend.
- `codex` shells out to the local `codex exec` CLI, writes the last message to a temp file, and returns it as a single chunk. **Local Codex is not token-level streaming** — the streaming feel is simulated by `src/lib/streaming.ts` on the frontend. Don't assume real streaming when debugging Codex.
- Prompts live in **two places**: `server/prompts.ts` (OpenAI-compatible) and `server/providers/codexPrompts.ts` (Codex CLI). When changing prompts, keep math-formula delimiters stable and keep "term explanation" as its own section.

**Adding a provider touches many layers** — don't stop at the provider class. You must also update: `ProviderName` type, `ConnectionSettings` and defaults in `server/runtimeConfig.ts`, the runtime map in `server/index.ts`, `/api/config` response shape, `src/types.ts`, `src/components/ConnectionSettingsModal.tsx`, and the provider-aware bits of `AssistantPanel.tsx` / `App.tsx`.

## Non-obvious facts and pitfalls

- **Runtime config lives outside the repo**: `.env` (env defaults) and `config/providers.local.json` (written by the in-app Settings modal). Both are gitignored and must never be committed, and real API keys must not go into `.env.example`, README, or tests.
- **`dist/` and `build/` are outputs** — never hand-edit them. When release behavior misfires, fix sources/scripts/workflows, not build artifacts.
- **README is Chinese-first.** `README.md` is the GitHub-visible page; `README_en.md` is a backup — do not reverse that. README is also frequently edited on the remote, so `git fetch` before pushing README changes.
- **Frontend has a 45s timeout** on streaming requests; backend sends SSE heartbeats every 10s. Debug "stuck on thinking" by walking both sides: provider readiness → route emitting SSE → real streaming from provider → `readSseStream` on the client → client timeout.
- PDFs in scope are **text-selectable**; scanned/image PDFs are out of the MVP.
- Electron packaging is sensitive — `npm run electron:pack`'s `--publish never` flag is load-bearing for the release workflow.

## Testing guidance

Covered by Vitest today: `App` main flow, `PdfPane`, `PassageCard`, `SplitLayout`, `cardsReducer`, SSE parsing, `src/lib/api.ts`, `runtimeConfig`, SJTU provider, Codex prompts. If you touch any of these, update or extend the matching test rather than relying on manual clicking. Minimal manual smoke when a change hits the real user flow: `npm run launch` → open a selectable PDF → select text → confirm a translation card streams in the right pane → if math is involved, confirm KaTeX renders → if providers changed, confirm `/api/config` reports the currently selected model.
