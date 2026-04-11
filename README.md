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
2. `npm run launch` can start immediately even if no API is configured yet.
3. Complete provider setup inside the app with the `Settings` button in the right panel.
4. `npm run configure` is still available if you prefer terminal setup for the `.env` defaults.

The real `.env` file stays local and is ignored by git. Only `.env.example` should be shared.
Runtime connection settings are stored locally in `config/providers.local.json`, which is also ignored by git.

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
npm run release:zip
npm run electron:dev
npm run electron:pack
```

`npm run launch` will:

- create `.env` from `.env.example` if needed
- check whether local `codex` is available
- install dependencies if `node_modules` is missing
- start the app and open the browser automatically

After launch, the app can open a connection settings dialog automatically when setup is still incomplete.

`npm run release:zip` will create a versioned `.zip` in [`release/`](/Users/yangwentao/Documents/软件开发尝试/release) from the current committed git state.

GitHub publish helper docs:

- [GitHub Distribution](/Users/yangwentao/Documents/软件开发尝试/docs/github-distribution.md)
- [Electron Packaging](/Users/yangwentao/Documents/软件开发尝试/docs/electron-packaging.md)

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
- Use a custom OpenAI-compatible API endpoint with base URL, model name, and API key
- Test provider connectivity from the in-app settings dialog before saving
- Run as an Electron desktop shell during development

## Known limits

- Scanned image PDFs are not supported
- Refreshing the page clears cards
- OpenAI mode needs a valid `OPENAI_API_KEY`
- DeepSeek mode needs a valid `DEEPSEEK_API_KEY`
- Codex mode depends on a working local `codex` CLI session
- Custom API mode expects an OpenAI-compatible `/v1` endpoint
- Local Codex is still not true token-by-token streaming; the app simulates a more readable progressive reveal on the frontend
- Electron packaging is present, but signing and notarization are not configured yet
