import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { isAbsolute } from "node:path";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
  type PDFPage,
} from "pdf-lib";

// A highlight rectangle in page-relative fractions (0..1), top-left origin.
// This is the coordinate space the frontend works in — zoom-independent.
export type HighlightRectInput = {
  pageIndex: number;
  left: number;
  top: number;
  width: number;
  height: number;
};

// One highlight to write into the PDF.
export type SyncHighlightInput = {
  id: string;
  color: string; // hex "#RRGGBB"
  text: string;
  rects: HighlightRectInput[];
  // Optional comment / note attached to the highlight ("" = no comment).
  comment: string;
  // Human author name shown in WPS / Adobe and on our comment card.
  author: string;
  // Creation time (epoch ms) — written as the PDF /CreationDate.
  createdAt: number;
};

export type StoredHighlight = {
  id: string;
  color: string;
  text: string;
  rects: HighlightRectInput[];
  comment: string;
  author: string;
  createdAt: number;
  // True when WE authored the annotation (its /NM carries our marker, or it
  // is a legacy annotation whose /T was our old author string). syncHighlights
  // only ever rewrites managed highlights — annotations from WPS / Adobe /
  // Preview are left exactly as they are.
  managed: boolean;
};

// Prefix written into every annotation's /NM (name). Identifies the
// annotations syncHighlights owns and may replace. The human author name now
// lives in /T, so /NM is the marker instead.
const NAME_PREFIX = "zhijiao-";

// Legacy marker: app versions ≤ 0.3.9 wrote this string into /T and used it
// as the ownership marker. Kept so highlights saved by those versions are
// still recognised as ours (and not duplicated on the next save).
const LEGACY_AUTHOR = "知交文献阅读";

/**
 * Make the PDF file's highlight annotations match `highlights` exactly:
 * every Highlight annotation WE previously wrote is removed and the given
 * list is written fresh. Annotations made by other tools (WPS, Adobe, …)
 * are never touched. This is the single write primitive behind the app's
 * explicit "save" (Cmd+S) — adding/undoing/redoing highlights only changes
 * in-memory state; the file changes only here.
 *
 * Writes are atomic: serialise to a temp file, then rename over the
 * original, so a crash mid-write can never corrupt the PDF.
 */
export async function syncHighlights(
  filePath: string,
  highlights: SyncHighlightInput[],
): Promise<void> {
  assertPdfPath(filePath);

  const bytes = new Uint8Array(await readFile(filePath));
  const pdfDoc = await PDFDocument.load(bytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  if (pdfDoc.isEncrypted) {
    throw new Error("This PDF is encrypted; annotations cannot be saved into it.");
  }

  const pages = pdfDoc.getPages();

  // 1. Drop every Highlight annotation we authored previously.
  for (const page of pages) {
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) continue;
    for (let i = annots.size() - 1; i >= 0; i -= 1) {
      const annot = pdfDoc.context.lookupMaybe(annots.get(i), PDFDict);
      if (!annot) continue;
      const subtype = annot.lookupMaybe(PDFName.of("Subtype"), PDFName)?.decodeText();
      // Remove our Highlight annotations AND the Popup annotations we paired
      // with them — otherwise old popups would orphan on every re-save.
      if ((subtype === "Highlight" || subtype === "Popup") && isOwnedAnnotation(annot)) {
        annots.remove(i);
      }
    }
  }

  // 2. Write the current highlight list.
  for (const highlight of highlights) {
    addHighlightAnnotations(pdfDoc, pages, highlight);
  }

  const out = await pdfDoc.save();
  await atomicWrite(filePath, out);
}

/** Build and attach one highlight's annotation objects (one per page). */
function addHighlightAnnotations(
  pdfDoc: PDFDocument,
  pages: PDFPage[],
  highlight: SyncHighlightInput,
): void {
  const [cr, cg, cb] = hexToRgb01(highlight.color);

  // A selection can span multiple visual lines and pages — group its rects
  // by page so each page gets its own annotation, all sharing the same /NM.
  const rectsByPage = new Map<number, HighlightRectInput[]>();
  for (const rect of highlight.rects) {
    if (rect.pageIndex < 0 || rect.pageIndex >= pages.length) continue;
    const list = rectsByPage.get(rect.pageIndex) ?? [];
    list.push(rect);
    rectsByPage.set(rect.pageIndex, list);
  }

  for (const [pageIndex, rects] of Array.from(rectsByPage.entries())) {
    const page = pages[pageIndex];
    const { width: pw, height: ph } = page.getSize();

    const quadPoints: number[] = [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const rect of rects) {
      const x1 = rect.left * pw;
      const x2 = (rect.left + rect.width) * pw;
      // PDF coordinate space has its origin at the bottom-left, so the
      // frontend's top-left-origin fractions need their Y axis flipped.
      const yTop = (1 - rect.top) * ph;
      const yBottom = (1 - rect.top - rect.height) * ph;
      // QuadPoints order used by Adobe and every mainstream viewer:
      // top-left, top-right, bottom-left, bottom-right.
      quadPoints.push(x1, yTop, x2, yTop, x1, yBottom, x2, yBottom);
      minX = Math.min(minX, x1);
      maxX = Math.max(maxX, x2);
      minY = Math.min(minY, yBottom);
      maxY = Math.max(maxY, yTop);
    }

    const createdAt = Number.isFinite(highlight.createdAt) ? highlight.createdAt : Date.now();
    const annotDict = pdfDoc.context.obj({
      Type: "Annot",
      Subtype: "Highlight",
      Rect: [minX, minY, maxX, maxY],
      QuadPoints: quadPoints,
      C: [cr, cg, cb],
      // F = 4 → the Print flag, so the highlight survives "print to PDF".
      F: 4,
      // /NM (annotation name) carries our marker + stable highlight id.
      NM: PDFString.of(NAME_PREFIX + highlight.id),
      // /T is the human author shown by WPS / Adobe and on our comment card.
      T: PDFHexString.fromText(highlight.author || ""),
      // /Contents is the comment text — empty for a plain (uncommented)
      // highlight. WPS / Adobe surface this as the annotation's comment.
      Contents: PDFHexString.fromText(highlight.comment.slice(0, 2000)),
      CreationDate: PDFString.of(toPdfDate(createdAt)),
      M: PDFString.of(toPdfDate(Date.now())),
      // Private key — the highlighted text itself, so it round-trips when the
      // PDF is reopened. Standard viewers ignore unknown annotation keys.
      ZJText: PDFHexString.fromText(highlight.text.slice(0, 4000)),
    });
    const annotRef = pdfDoc.context.register(annotDict);

    const pageNode = page.node;
    let annots = pageNode.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) {
      annots = pdfDoc.context.obj([]);
      pageNode.set(PDFName.of("Annots"), annots);
    }
    annots.push(annotRef);

    // A commented highlight also needs a /Popup annotation. Without it WPS /
    // Adobe only show the comment on hover — their "show all comments" toggle
    // operates on Popup annotations, so a missing Popup makes commented
    // highlights look empty when the user opens the comment view.
    if (highlight.comment.trim() !== "") {
      const popupWidth = 200;
      const popupHeight = 96;
      const popupLeft = Math.max(0, Math.min(maxX + 8, pw - popupWidth));
      const popupTop = Math.min(ph, maxY);
      const popupBottom = Math.max(0, popupTop - popupHeight);
      const popupDict = pdfDoc.context.obj({
        Type: "Annot",
        Subtype: "Popup",
        Rect: [popupLeft, popupBottom, popupLeft + popupWidth, popupTop],
        // Closed by default — the user reveals them with WPS's "打开所有批注".
        Open: false,
        Parent: annotRef,
        NM: PDFString.of(`${NAME_PREFIX}popup-${highlight.id}`),
      });
      const popupRef = pdfDoc.context.register(popupDict);
      // Link the highlight to its popup (both directions, as the spec wants).
      annotDict.set(PDFName.of("Popup"), popupRef);
      annots.push(popupRef);
    }
  }
}

/**
 * Read every `Highlight` annotation already present in a PDF — including
 * ones made by WPS / Adobe / Preview — in the frontend's page-relative
 * coordinate space. Each highlight is flagged `managed` if we authored it.
 */
export async function readHighlights(filePath: string): Promise<StoredHighlight[]> {
  assertPdfPath(filePath);
  const bytes = new Uint8Array(await readFile(filePath));
  const pdfDoc = await PDFDocument.load(bytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const pages = pdfDoc.getPages();
  const highlights: StoredHighlight[] = [];

  pages.forEach((page, pageIndex) => {
    const { width: pw, height: ph } = page.getSize();
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) return;

    for (let i = 0; i < annots.size(); i += 1) {
      const annot = pdfDoc.context.lookupMaybe(annots.get(i), PDFDict);
      if (!annot) continue;

      const subtype = annot.lookupMaybe(PDFName.of("Subtype"), PDFName);
      if (!subtype || subtype.decodeText() !== "Highlight") continue;

      const quadPointsArr = annot.lookupMaybe(PDFName.of("QuadPoints"), PDFArray);
      if (!quadPointsArr || quadPointsArr.size() < 8) continue;

      const qp: number[] = [];
      for (let j = 0; j < quadPointsArr.size(); j += 1) {
        const num = quadPointsArr.lookupMaybe(j, PDFNumber);
        qp.push(num ? num.asNumber() : 0);
      }

      const rects: HighlightRectInput[] = [];
      for (let j = 0; j + 7 < qp.length; j += 8) {
        const xs = [qp[j], qp[j + 2], qp[j + 4], qp[j + 6]];
        const ys = [qp[j + 1], qp[j + 3], qp[j + 5], qp[j + 7]];
        const qMinX = Math.min(...xs);
        const qMaxX = Math.max(...xs);
        const qMinY = Math.min(...ys);
        const qMaxY = Math.max(...ys);
        rects.push({
          pageIndex,
          left: qMinX / pw,
          top: 1 - qMaxY / ph,
          width: (qMaxX - qMinX) / pw,
          height: (qMaxY - qMinY) / ph,
        });
      }
      if (rects.length === 0) continue;

      const name = readName(annot);
      const author = readAuthor(annot);
      const isNew = name.startsWith(NAME_PREFIX);
      const isLegacy = !isNew && author === LEGACY_AUTHOR;
      const contents = readContents(annot);
      const fallbackId = `pdf-${pageIndex}-${i}-${Math.random().toString(36).slice(2, 8)}`;
      highlights.push({
        id: isNew ? name.slice(NAME_PREFIX.length) || fallbackId : name || fallbackId,
        color: readColor(annot),
        // Legacy annotations (app ≤ 0.3.9) stored the highlighted text in
        // /Contents; new annotations keep it in the private /ZJText key and
        // use /Contents for the comment.
        text: isLegacy ? contents : readZJText(annot),
        comment: isLegacy ? "" : contents,
        author: isLegacy ? "" : author,
        createdAt: readCreatedAt(annot),
        rects,
        managed: isNew || isLegacy,
      });
    }
  });

  return highlights;
}

function readName(annot: PDFDict): string {
  const nm = annot.lookup(PDFName.of("NM"));
  if (nm instanceof PDFString || nm instanceof PDFHexString) {
    return nm.decodeText();
  }
  return "";
}

function readAuthor(annot: PDFDict): string {
  const t = annot.lookup(PDFName.of("T"));
  if (t instanceof PDFString || t instanceof PDFHexString) {
    return t.decodeText();
  }
  return "";
}

function readColor(annot: PDFDict): string {
  const colorArr = annot.lookupMaybe(PDFName.of("C"), PDFArray);
  if (!colorArr || colorArr.size() < 3) {
    return "#FFE920";
  }
  const r = colorArr.lookupMaybe(0, PDFNumber)?.asNumber() ?? 1;
  const g = colorArr.lookupMaybe(1, PDFNumber)?.asNumber() ?? 0.91;
  const b = colorArr.lookupMaybe(2, PDFNumber)?.asNumber() ?? 0.13;
  return rgb01ToHex(r, g, b);
}

function readContents(annot: PDFDict): string {
  const contents = annot.lookup(PDFName.of("Contents"));
  if (contents instanceof PDFString || contents instanceof PDFHexString) {
    return contents.decodeText();
  }
  return "";
}

// The highlighted text, stored by us in the private /ZJText key.
function readZJText(annot: PDFDict): string {
  const value = annot.lookup(PDFName.of("ZJText"));
  if (value instanceof PDFString || value instanceof PDFHexString) {
    return value.decodeText();
  }
  return "";
}

/** True when this annotation is one syncHighlights owns (and may replace). */
function isOwnedAnnotation(annot: PDFDict): boolean {
  return readName(annot).startsWith(NAME_PREFIX) || readAuthor(annot) === LEGACY_AUTHOR;
}

function readCreatedAt(annot: PDFDict): number {
  return readDateField(annot, "CreationDate") ?? readDateField(annot, "M") ?? Date.now();
}

function readDateField(annot: PDFDict, key: string): number | null {
  const value = annot.lookup(PDFName.of(key));
  if (value instanceof PDFString || value instanceof PDFHexString) {
    return fromPdfDate(value.decodeText());
  }
  return null;
}

// PDF date string, e.g. "D:20260510150519+08'00'" (PDF 1.7 §7.9.4).
function toPdfDate(ms: number): string {
  const d = new Date(Number.isFinite(ms) ? ms : Date.now());
  const p = (n: number) => String(n).padStart(2, "0");
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const oh = p(Math.floor(Math.abs(offsetMin) / 60));
  const om = p(Math.abs(offsetMin) % 60);
  return (
    `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${sign}${oh}'${om}'`
  );
}

// Parse a PDF date string back to epoch ms. Tolerant of missing time parts
// and of the optional timezone suffix (which we ignore — local time is fine).
function fromPdfDate(raw: string): number | null {
  const m = /D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/.exec(raw);
  if (!m) return null;
  const [, y, mo, da, h = "00", mi = "00", s = "00"] = m;
  const t = new Date(
    Number(y),
    Number(mo) - 1,
    Number(da),
    Number(h),
    Number(mi),
    Number(s),
  ).getTime();
  return Number.isFinite(t) ? t : null;
}

function assertPdfPath(filePath: string): void {
  if (!filePath || !isAbsolute(filePath)) {
    throw new Error("A PDF file path (absolute) is required.");
  }
  if (!filePath.toLowerCase().endsWith(".pdf")) {
    throw new Error("Annotation target must be a .pdf file.");
  }
}

async function atomicWrite(filePath: string, data: Uint8Array): Promise<void> {
  const tmpPath = `${filePath}.zhijiao-tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(tmpPath, data);
    await rename(tmpPath, filePath);
  } catch (error) {
    await unlink(tmpPath).catch(() => undefined);
    throw error;
  }
}

export function hexToRgb01(hex: string): [number, number, number] {
  const normalized = hex.replace(/^#/, "").trim();
  if (normalized.length !== 6) {
    // Fallback: highlighter yellow.
    return [1, 0.91, 0.13];
  }
  const r = parseInt(normalized.slice(0, 2), 16) / 255;
  const g = parseInt(normalized.slice(2, 4), 16) / 255;
  const b = parseInt(normalized.slice(4, 6), 16) / 255;
  return [clamp01(r), clamp01(g), clamp01(b)];
}

export function rgb01ToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) =>
    Math.round(clamp01(v) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.min(1, Math.max(0, v));
}
