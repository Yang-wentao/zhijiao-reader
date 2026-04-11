# Electron Packaging

## Scope

This repository now includes an Electron shell that wraps the current reader.

## Commands

```bash
npm run electron:dev
npm run electron:pack
```

## Architecture

- Development:
  - Vite frontend runs on `5173`
  - Express backend runs on `8787`
  - Electron loads the Vite URL directly
- Production package:
  - Vite frontend is built into `dist/`
  - Server is compiled into `build/server/`
  - Electron starts the compiled server in-process and loads `http://127.0.0.1:8787`

## Current limits

- Packaging targets are zip/AppImage level right now, not installer-polished releases
- Auto-update is not included
- Signing and notarization are not configured
