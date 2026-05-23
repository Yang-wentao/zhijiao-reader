import { Router } from "express";
import {
  readHighlights,
  syncHighlights,
  type HighlightRectInput,
  type SyncHighlightInput,
} from "../services/pdfAnnotations.js";

type AnnotationsRouteOptions = {
  isRequestOriginAllowed?: (origin: string | undefined) => boolean;
};

const MAX_HIGHLIGHTS = 2000;
const MAX_RECTS_PER_HIGHLIGHT = 400;
const MAX_TEXT = 4000;
const MAX_COMMENT = 2000;
const MAX_AUTHOR = 200;

/**
 * Routes for reading / writing PDF highlight annotations.
 *
 *  GET  /api/annotations?path=<abs pdf path>   → list existing highlights
 *  POST /api/annotations/sync                  → write the full highlight set
 *
 * Highlights are written into the PDF file itself (standard `Highlight`
 * annotations) so WPS / Adobe / Preview interoperate. The frontend keeps
 * highlights in memory while editing and calls /sync only on an explicit
 * save (Cmd+S). The file path comes from the Electron renderer; in a plain
 * browser there is no path and the frontend never calls these routes.
 */
export function createAnnotationsRouter(options: AnnotationsRouteOptions = {}) {
  const router = Router();

  router.use((req, res, next) => {
    if (options.isRequestOriginAllowed && !options.isRequestOriginAllowed(req.get("origin"))) {
      res.status(403).json({ error: "Annotations can only be accessed from the local ZhiJiao app." });
      return;
    }
    next();
  });

  router.get("/", async (req, res) => {
    const filePath = typeof req.query.path === "string" ? req.query.path : "";
    if (!filePath) {
      res.status(400).json({ error: "A PDF file path is required." });
      return;
    }
    try {
      const highlights = await readHighlights(filePath);
      res.json({ ok: true, highlights });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to read annotations.";
      res.status(400).json({ error: message });
    }
  });

  router.post("/sync", async (req, res) => {
    const body = (req.body ?? {}) as { filePath?: unknown; highlights?: unknown };
    const filePath = typeof body.filePath === "string" ? body.filePath : "";
    if (!filePath) {
      res.status(400).json({ error: "A PDF file path is required." });
      return;
    }

    const highlights = parseHighlights(body.highlights);
    if (highlights === null) {
      res.status(400).json({ error: "Invalid highlight payload." });
      return;
    }

    try {
      await syncHighlights(filePath, highlights);
      res.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save highlights.";
      res.status(400).json({ error: message });
    }
  });

  return router;
}

function parseHighlights(raw: unknown): SyncHighlightInput[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_HIGHLIGHTS) {
    return null;
  }
  const result: SyncHighlightInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const h = item as Record<string, unknown>;
    const id = typeof h.id === "string" ? h.id : "";
    const color = typeof h.color === "string" ? h.color : "";
    const text = typeof h.text === "string" ? h.text.slice(0, MAX_TEXT) : "";
    const comment = typeof h.comment === "string" ? h.comment.slice(0, MAX_COMMENT) : "";
    const author = typeof h.author === "string" ? h.author.slice(0, MAX_AUTHOR) : "";
    const createdAt =
      typeof h.createdAt === "number" && Number.isFinite(h.createdAt) ? h.createdAt : Date.now();
    const rects = parseRects(h.rects);
    if (!id || !/^#[0-9a-fA-F]{6}$/.test(color) || rects.length === 0) {
      return null;
    }
    if (rects.length > MAX_RECTS_PER_HIGHLIGHT) {
      return null;
    }
    result.push({ id, color, text, rects, comment, author, createdAt });
  }
  return result;
}

function parseRects(raw: unknown): HighlightRectInput[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const rects: HighlightRectInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const { pageIndex, left, top, width, height } = r;
    if (
      typeof pageIndex === "number" &&
      Number.isInteger(pageIndex) &&
      pageIndex >= 0 &&
      isFraction(left) &&
      isFraction(top) &&
      isPositiveFraction(width) &&
      isPositiveFraction(height)
    ) {
      rects.push({ pageIndex, left, top, width, height });
    }
  }
  return rects;
}

function isFraction(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= -0.01 && v <= 1.01;
}

function isPositiveFraction(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1.01;
}
