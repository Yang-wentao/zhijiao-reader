# Codex Paper Reader

Local web MVP for reading a PDF on the left and using an AI assistant on the right.

## What It Is

- Frontend: React + Vite
- Backend: Express + Node.js
- PDF viewer: `@react-pdf-viewer/core`
- Math rendering: `react-markdown` + `remark-math` + `rehype-katex`
- AI backends: local Codex CLI, DeepSeek API, OpenAI API

It runs as a local web app in your browser. It is not yet a native macOS or Windows desktop app.

## Setup

1. Copy `.env.example` to `.env`.
2. Pick a provider with `AI_PROVIDER=openai`, `AI_PROVIDER=codex`, or `AI_PROVIDER=deepseek`.
3. If using `openai`, set `OPENAI_API_KEY`.
4. If using `deepseek`, set `DEEPSEEK_API_KEY`.
5. Optionally change `OPENAI_MODEL` or `DEEPSEEK_MODEL`.
6. If using `codex`, make sure the local `codex` CLI works in your shell. Override `CODEX_BIN` only if needed.

The real `.env` file stays local and is ignored by git. Only `.env.example` should be shared.

## Run

```bash
npm install
npm run dev
```

## One-Click Start

You can also use the packaged startup entry points:

- macOS: double-click [Launch Codex Paper Reader.command](/Users/yangwentao/Documents/软件开发尝试/Launch%20Codex%20Paper%20Reader.command)
- Windows: double-click [Launch Codex Paper Reader.bat](/Users/yangwentao/Documents/软件开发尝试/Launch%20Codex%20Paper%20Reader.bat)
- Terminal:

```bash
npm run launch
```

Useful helper commands:

```bash
npm run configure
npm run check
```

`npm run launch` will:

- create `.env` from `.env.example` if needed
- prompt for provider/API setup when config is missing
- check whether local `codex` is available
- install dependencies if `node_modules` is missing
- start the app and open the browser automatically

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8787`

## Current MVP

- Upload a local PDF
- Open multiple local PDFs with tabs
- Select a passage in the PDF
- Translate the passage into Chinese
- Ask follow-up questions in a card scoped to that passage
- Copy or retry responses
- Resize the split panes
- Switch backend provider between OpenAI, DeepSeek, and local Codex CLI

## Known limits

- Scanned image PDFs are not supported
- Refreshing the page clears cards
- OpenAI mode needs a valid `OPENAI_API_KEY`
- DeepSeek mode needs a valid `DEEPSEEK_API_KEY`
- Codex mode depends on a working local `codex` CLI session
- Local Codex is still not true token-by-token streaming; the app simulates a more readable progressive reveal on the frontend
