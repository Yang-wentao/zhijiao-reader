import { Router } from "express";
import type { ConnectionSettings } from "../runtimeConfig.js";
import { appendNoteToVault } from "../services/notesWriter.js";

type NotesRouteOptions = {
  getNotesSettings: () => ConnectionSettings["notes"];
  isRequestOriginAllowed?: (origin: string | undefined) => boolean;
};

const MAX_NOTE_TEXT = 16000;

export function createNotesRouter(options: NotesRouteOptions) {
  const router = Router();

  router.use((req, res, next) => {
    if (options.isRequestOriginAllowed && !options.isRequestOriginAllowed(req.get("origin"))) {
      res.status(403).json({ error: "Notes can only be written from the local ZhiJiao app." });
      return;
    }
    next();
  });

  router.post("/append", async (req, res) => {
    const settings = options.getNotesSettings();
    if (!settings.vaultPath) {
      res.status(400).json({ error: "Obsidian vault path is not configured." });
      return;
    }

    const body = (req.body ?? {}) as {
      pdfName?: unknown;
      startPage?: unknown;
      endPage?: unknown;
      original?: unknown;
      translation?: unknown;
    };

    const pdfName = typeof body.pdfName === "string" ? body.pdfName.trim() : "";
    const original = typeof body.original === "string" ? body.original.trim() : "";
    const translation = typeof body.translation === "string" ? body.translation.trim() : "";
    const startPage = toPageNumber(body.startPage);
    const endPage = toPageNumber(body.endPage);

    if (!pdfName) {
      res.status(400).json({ error: "PDF name is required." });
      return;
    }
    if (!original) {
      res.status(400).json({ error: "Original text is required." });
      return;
    }
    if (original.length > MAX_NOTE_TEXT || translation.length > MAX_NOTE_TEXT) {
      res.status(400).json({ error: "Note content is too long." });
      return;
    }

    try {
      const result = await appendNoteToVault({
        vaultPath: settings.vaultPath,
        subdir: settings.subdir,
        pdfName,
        startPage,
        endPage,
        original,
        translation: translation || null,
        includeTimestamp: settings.includeTimestamp,
      });
      res.json({ ok: true, filePath: result.filePath, created: result.created });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to append note.";
      res.status(500).json({ error: message });
    }
  });

  return router;
}

function toPageNumber(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return null;
  }
  return Math.max(1, Math.floor(raw));
}
