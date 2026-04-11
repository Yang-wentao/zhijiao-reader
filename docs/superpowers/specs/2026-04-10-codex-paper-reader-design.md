# ZhiJiao Reader Design

Date: 2026-04-10
Status: Draft approved in conversation, pending user review

## Goal

Build a self-use local web app for reading papers with a Zhiyun-like split layout:

- Left side shows a local PDF for reading.
- Right side shows an AI assistant panel.
- The default action is paragraph-level translation to Chinese.
- The same panel supports follow-up questions about the selected passage.

This is not a full Zhiyun clone. It is a narrower MVP optimized for fast reading and explanation.

## Product Scope

### In scope for MVP

- Upload a local PDF file from the browser.
- Render the PDF in a left reading pane.
- Allow manual text selection in the PDF.
- Show a small action bar after selection.
- Support two primary actions:
  - `Translate`: translate the selected passage into Chinese.
  - `Ask ZhiJiao`: ask questions about the selected passage.
- Show the result in the right assistant pane.
- Support follow-up questions within the current passage context.
- Run as a local web app.
- Use OpenAI first, but keep the AI backend replaceable.

### Explicitly out of scope for MVP

- Automatic full-page translation
- Automatic visible-region sync
- Annotation, highlight, or note persistence
- Whole-paper memory or retrieval
- Multi-document project management
- OCR for scanned-image PDFs
- Native desktop packaging
- Direct dependence on the legacy Zhiyun app internals

## User Experience

### Primary workflow

1. User opens the local web app.
2. User uploads a local PDF.
3. Left pane renders the PDF and supports normal reading.
4. User manually selects a passage.
5. A minimal floating toolbar appears near the selection.
6. User clicks either `Translate` or `Ask ZhiJiao`.
7. Right pane creates a new passage card containing:
   - the original selected text
   - the generated answer
   - input for follow-up questions
8. Follow-up questions stay scoped to that selected passage.
9. Selecting a different passage starts a new card and a new context.

### Interaction model

The app is passage-centric, not document-centric. Each AI interaction is grounded in one selected passage. This reduces prompt ambiguity, keeps UI state simple, and fits the reading workflow better than a global paper chat in the first version.

## Layout

### Split view

- Left pane: about 66% to 75% width by default
- Right pane: about 25% to 34% width by default
- The divider between panes should be draggable so the user can adjust the ratio to fit different PDF layouts

### Left pane

- PDF reader based on `PDF.js`
- Page navigation, zoom, and text selection
- Preserve `PDF.js` built-in search (Ctrl+F / Cmd+F) — do not override or disable it
- No custom heavy editing tools in MVP

### Right pane

- Assistant header showing current mode
- Passage cards stacked vertically
- Each card contains:
  - source passage
  - translation or answer output
  - quick actions: `Copy` (copy the translation/answer text to clipboard), `Retry`
  - follow-up input

### Floating selection toolbar

Minimal actions only:

- `Translate`
- `Ask ZhiJiao`

The toolbar should stay lightweight to avoid interrupting reading.

## Functional Requirements

### PDF handling

- Accept local PDF upload in browser
- Render text-selectable PDFs reliably
- Expose selected text to the app state

### Translation flow

When the user clicks `Translate`:

- Send the selected passage to the AI backend
- Request:
  - faithful Chinese translation
  - short clarification of difficult terms or syntax
- Render the response in the right pane

### Ask flow

When the user clicks `Ask ZhiJiao`:

- Start a scoped assistant session for the selected passage
- Show several quick prompts, for example:
  - "What is this passage saying?"
  - "What is the core claim here?"
  - "Rewrite this in simpler Chinese."
  - "What assumptions are used here?"
- Allow arbitrary follow-up questions

### Context behavior

- Each card is bound to one selected passage
- Follow-up messages only use that passage and the card-local message history
- Selecting a new passage opens a separate card
- Different passage cards must not leak context into each other

## Technical Architecture

### Frontend

- `React + Vite`
- `PDF.js` reader wrapper
- Right-side assistant panel
- Local state for current selection and passage cards

### Backend

- Lightweight local `Node.js + Express` service
- API endpoints for translation and ask flows
- AI provider abstraction layer
- Translation and ask endpoints should return responses via Server-Sent Events (SSE) so the frontend can render tokens incrementally. The frontend reads the SSE stream and appends chunks to the card output in real time. If SSE adds too much complexity during initial development, fall back to a simple JSON response with a visible loading spinner, but SSE is the preferred target for MVP

### AI provider layer

Define a narrow backend interface such as:

- `translate(selectionText)`
- `ask(selectionText, question, history)`

The UI should only talk to this interface, not to a model vendor directly.

### Selection text limits

The selected text sent to the AI backend must be bounded:

- Maximum length: approximately 2000 tokens (roughly 8000 English characters or 4000 Chinese characters).
- If the selection exceeds this limit, reject the request and show a toast: "Selected text is too long. Please select a shorter passage."
- This avoids excessive token cost and keeps translation quality high. Very long selections tend to produce lower-quality translations.

### API key configuration

In MVP, the API key is stored in a `.env` file in the project root (e.g. `OPENAI_API_KEY=sk-...`). The backend reads it via `process.env` at startup.

- On first launch, if the key is missing or empty, the app should show a setup screen with instructions to create the `.env` file.
- The key is never sent to or stored in the browser. All AI requests go through the local backend.

## Prompt Design

### Translation prompt

The `translate` call should use a system prompt along these lines:

- Role: You are an academic translation assistant.
- Task: Translate the following English passage into Chinese faithfully. After the translation, briefly explain any technical terms, abbreviations, or unusual grammar that a Chinese reader may find unclear.
- Output format: First the full translation, then a "Terms" section listing difficult terms with short explanations. If there are no difficult terms, omit the Terms section.
- Temperature: 0.3 (favor accuracy over creativity).
- Model: `gpt-4o` for quality. Can fall back to `gpt-4o-mini` if cost is a concern.

### Ask prompt

The `ask` call should use a system prompt along these lines:

- Role: You are a research paper reading assistant.
- Context: The user has selected a specific passage from a paper. Your answers should be grounded in this passage. If the question goes beyond what the passage covers, say so.
- The selected passage is injected as a quoted block in the user message, followed by the user's question.
- Follow-up messages include the card-local message history so the model has conversational context, but only within this one passage.
- Temperature: 0.5.
- Model: same as translation.

These prompts are starting points. They should be stored as editable templates in the codebase (not hardcoded inline) so they can be tuned without changing application logic.

## Provider strategy

### Phase 1

Implement `OpenAIProvider` first. This gives the fastest path to a usable MVP.

The UI copy for the question action should be configurable. If the product surface says `Ask ZhiJiao` in MVP, treat that as product language only; the actual backend implementation still goes through `OpenAIProvider` in phase 1.

### Phase 2

Add a `CodexProvider` later. In the first upgrade, this does not need to recreate the full Codex desktop session model. It only needs to behave as another backend processor that accepts selected text plus a question and returns an answer.

This keeps the frontend stable while allowing the right pane to evolve toward a more Codex-like workflow later.

## Data Model

### Selection context

Store only the minimum necessary context:

- selected text
- page number if available
- timestamp
- requested action type

### Passage card

Each card should contain:

- `id`
- `selectionText`
- `pageNumber`
- `mode` (`translate` or `ask`)
- `messages`
- `status` (`idle`, `loading`, `streaming`, `done`, `error`)
- `createdAt`

No long-term persistence is required in MVP. Refreshing the page clears all cards.

### Card lifecycle

- Cards can be manually collapsed (hide output, keep title visible) or dismissed (removed from the panel) by the user.
- There is no hard maximum on card count, but if more than 20 cards accumulate, show a prompt suggesting the user dismiss older ones to keep the UI responsive.
- Collapsed cards can be re-expanded to review earlier translations.

## Error Handling

### Non-selectable PDF text

If text selection fails because the PDF is image-based or lacks a usable text layer, show a clear message that scanned PDFs are not supported in MVP.

### AI request failure

- Keep the source passage visible
- Show the failure state inline
- Provide a `Retry` action

### Slow responses

- Show explicit loading state
- Prefer streaming output if practical
- Never let the panel look frozen

### Missing API key or config

Detect this early and present a setup screen before the user attempts the first request.

## Non-Goals

The MVP is intentionally not trying to solve:

- perfect paragraph alignment between English and Chinese
- whole-paper semantic navigation
- citation extraction workflows
- automatic note organization
- scanned paper OCR recovery

These are valid later extensions, but they should not block the first working version.

## Acceptance Criteria

The MVP is successful when all of the following work end to end:

1. User can upload and display a local PDF.
2. User can select a text passage in the PDF.
3. Clicking `Translate` returns a Chinese translation in the right pane within 5 to 15 seconds。
4. Clicking `Ask ZhiJiao` creates a passage-scoped Q&A flow in the right pane.
5. Follow-up questions stay within the selected passage context.
6. Selecting a new passage creates a new context. The previous card's conversation history must not be injected into the new card's prompt.
7. The user never has to manually copy and paste selected text into the assistant.

## Implementation Direction

Recommended execution order:

1. Build the split layout and PDF upload/rendering flow.
2. Add text selection capture and floating action bar.
3. Add the right-pane passage card model.
4. Implement `OpenAIProvider` for `translate` and `ask`.
5. Add follow-up question handling per card.
6. Harden failure states and configuration setup.
7. Reserve a clean extension point for a future `CodexProvider`.

## Open Decisions Already Resolved

The following product choices were fixed during design:

- Runtime form: local web app
- Source input: local PDF upload only
- Primary interaction: manual text selection
- Default assistant action: translation first
- Follow-up mode: explanation and freeform questions in the same panel
- Persistence: none in MVP
- Architecture direction: provider-based, OpenAI first, Codex-compatible later

## Risks

- `PDF.js` text selection behavior varies across PDFs and can be brittle on complex layouts.
- AI translation quality may be acceptable for reading but inconsistent on formulas or table-heavy passages.
- A later real Codex integration may require process management or transport details that should stay isolated behind the provider layer.

These risks are acceptable for the MVP because they do not invalidate the main reading workflow.
