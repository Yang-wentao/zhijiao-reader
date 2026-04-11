# Runtime Connection Setup and Compact Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shrink the assistant header and add an in-app connection settings modal with provider/API configuration and test actions.

**Architecture:** Keep the reader UI compact by moving provider/model controls out of the main assistant header and into a modal. Add a small runtime config layer on the server backed by a local ignored JSON file so provider settings can be edited, validated, and persisted without exposing secrets in git.

**Tech Stack:** React, Vite, Express, Node.js, Vitest, Testing Library

---

### Task 1: Add server-side runtime connection config support

**Files:**
- Create: `server/runtimeConfig.ts`
- Modify: `server/index.ts`
- Modify: `server/routes/ai.ts`
- Test: `server/config.test.ts`

- [ ] **Step 1: Write failing tests for runtime config read/write and connection validation entry points**
- [ ] **Step 2: Run the targeted server tests and confirm they fail for missing runtime config support**
- [ ] **Step 3: Implement a local ignored config store and expose config/test/save endpoints**
- [ ] **Step 4: Re-run the targeted server tests and confirm they pass**

### Task 2: Add frontend settings modal and compact header

**Files:**
- Create: `src/components/ConnectionSettingsModal.tsx`
- Modify: `src/components/AssistantPanel.tsx`
- Modify: `src/App.tsx`
- Modify: `src/lib/api.ts`
- Modify: `src/types.ts`
- Modify: `src/styles.css`
- Test: `src/App.test.tsx`

- [ ] **Step 1: Write failing UI tests for compact header, opening the settings dialog, saving settings, and testing a provider**
- [ ] **Step 2: Run the targeted frontend tests and confirm they fail for the missing dialog flow**
- [ ] **Step 3: Implement the compact header, modal state flow, API calls, and startup prompt behavior**
- [ ] **Step 4: Re-run the targeted frontend tests and confirm they pass**

### Task 3: Update docs and final verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update documentation for startup configuration, provider testing, and local secret handling**
- [ ] **Step 2: Run `npm test` and `npm run build` and confirm the full suite stays green**
