import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hexToRgb01,
  readHighlights,
  rgb01ToHex,
  syncHighlights,
  type SyncHighlightInput,
} from "./pdfAnnotations";

// Build a SyncHighlightInput with sensible defaults so each test only spells
// out the fields it cares about.
function hl(partial: Partial<SyncHighlightInput> & { id: string }): SyncHighlightInput {
  return {
    color: "#FFE920",
    text: "",
    comment: "",
    author: "测试作者",
    createdAt: Date.UTC(2026, 4, 10, 7, 5, 19),
    rects: [{ pageIndex: 0, left: 0.1, top: 0.1, width: 0.2, height: 0.04 }],
    ...partial,
  };
}

describe("pdfAnnotations color helpers", () => {
  it("round-trips a hex color through rgb 0..1 and back", () => {
    const [r, g, b] = hexToRgb01("#FFE920");
    expect(r).toBeCloseTo(1, 2);
    expect(g).toBeCloseTo(0.913, 2);
    expect(b).toBeCloseTo(0.125, 2);
    expect(rgb01ToHex(r, g, b)).toBe("#FFE920");
  });

  it("falls back to highlighter yellow for a malformed hex", () => {
    const [r, g, b] = hexToRgb01("not-a-color");
    expect(rgb01ToHex(r, g, b)).toBe("#FFE821");
  });
});

describe("pdfAnnotations syncHighlights", () => {
  let dir = "";
  let pdfPath = "";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zhijiao-annot-"));
    pdfPath = join(dir, "sample.pdf");
    // A minimal 2-page PDF, 600×800 pt per page.
    const doc = await PDFDocument.create();
    doc.addPage([600, 800]);
    doc.addPage([600, 800]);
    await writeFile(pdfPath, await doc.save());
  });

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("writes a highlight and reads it back at the same page-relative position", async () => {
    await syncHighlights(pdfPath, [
      hl({
        id: "hl-roundtrip",
        color: "#7FD0FF",
        text: "选中的一段文字",
        rects: [{ pageIndex: 1, left: 0.1, top: 0.2, width: 0.4, height: 0.05 }],
      }),
    ]);

    const highlights = await readHighlights(pdfPath);
    expect(highlights).toHaveLength(1);

    const [highlight] = highlights;
    expect(highlight.id).toBe("hl-roundtrip");
    expect(highlight.color).toBe("#7FD0FF");
    expect(highlight.text).toBe("选中的一段文字");
    expect(highlight.managed).toBe(true);
    expect(highlight.rects).toHaveLength(1);

    const rect = highlight.rects[0];
    expect(rect.pageIndex).toBe(1);
    // Coordinates survive the round-trip (frontend fraction → PDF points with
    // the Y axis flipped → QuadPoints → back to a fraction).
    expect(rect.left).toBeCloseTo(0.1, 3);
    expect(rect.top).toBeCloseTo(0.2, 3);
    expect(rect.width).toBeCloseTo(0.4, 3);
    expect(rect.height).toBeCloseTo(0.05, 3);
  });

  it("round-trips a comment, author and creation time", async () => {
    const createdAt = new Date(2026, 4, 10, 15, 5, 19).getTime();
    await syncHighlights(pdfPath, [
      hl({
        id: "hl-comment",
        text: "被批注的原文",
        comment: "倒数第一句很重要，需要改",
        author: "杨文涛",
        createdAt,
        rects: [{ pageIndex: 0, left: 0.1, top: 0.2, width: 0.4, height: 0.05 }],
      }),
    ]);

    const [highlight] = await readHighlights(pdfPath);
    expect(highlight.comment).toBe("倒数第一句很重要，需要改");
    expect(highlight.author).toBe("杨文涛");
    expect(highlight.text).toBe("被批注的原文");
    // /CreationDate keeps second precision.
    expect(highlight.createdAt).toBe(createdAt);
  });

  it("leaves a plain highlight's comment empty", async () => {
    await syncHighlights(pdfPath, [hl({ id: "plain", text: "no comment here" })]);
    const [highlight] = await readHighlights(pdfPath);
    expect(highlight.comment).toBe("");
    expect(highlight.text).toBe("no comment here");
  });

  it("replaces the previous highlight set on each sync (supports undo)", async () => {
    await syncHighlights(pdfPath, [
      hl({ id: "a", rects: [{ pageIndex: 0, left: 0.1, top: 0.1, width: 0.2, height: 0.04 }] }),
      hl({
        id: "b",
        color: "#A8E66C",
        rects: [{ pageIndex: 0, left: 0.1, top: 0.3, width: 0.2, height: 0.04 }],
      }),
    ]);
    expect(await readHighlights(pdfPath)).toHaveLength(2);

    // A later sync with only "a" — as if the user undid "b" then saved.
    await syncHighlights(pdfPath, [
      hl({ id: "a", rects: [{ pageIndex: 0, left: 0.1, top: 0.1, width: 0.2, height: 0.04 }] }),
    ]);
    const after = await readHighlights(pdfPath);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe("a");
  });

  it("leaves foreign (non-ZhiJiao) highlight annotations untouched", async () => {
    // Inject a highlight that looks like it came from another tool (WPS):
    // a /Highlight annotation with a foreign /T author and no /NM marker.
    const doc = await PDFDocument.load(new Uint8Array(await readFile(pdfPath)));
    const page = doc.getPage(0);
    const foreign = doc.context.obj({
      Type: "Annot",
      Subtype: "Highlight",
      Rect: [60, 700, 300, 730],
      QuadPoints: [60, 730, 300, 730, 60, 700, 300, 700],
      C: [1, 0.9, 0.1],
      T: PDFString.of("WPS"),
      Contents: PDFHexString.fromText("外部工具写的批注"),
    });
    const ref = doc.context.register(foreign);
    page.node.set(PDFName.of("Annots"), doc.context.obj([ref]));
    await writeFile(pdfPath, await doc.save());

    // Sync our own highlight.
    await syncHighlights(pdfPath, [
      hl({
        id: "ours",
        color: "#7FD0FF",
        rects: [{ pageIndex: 1, left: 0.2, top: 0.2, width: 0.3, height: 0.05 }],
      }),
    ]);

    const highlights = await readHighlights(pdfPath);
    // Both survive: the foreign one and ours.
    expect(highlights).toHaveLength(2);
    const foreignRead = highlights.find((h) => !h.managed);
    expect(foreignRead).toBeDefined();
    // A foreign comment is still surfaced from /Contents.
    expect(foreignRead?.comment).toBe("外部工具写的批注");
    expect(highlights.some((h) => h.managed && h.id === "ours")).toBe(true);

    // Syncing again with an empty list removes ONLY ours, foreign stays.
    await syncHighlights(pdfPath, []);
    const remaining = await readHighlights(pdfPath);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].managed).toBe(false);
  });

  it("recognises legacy highlights (≤ 0.3.9, /T marker) as managed", async () => {
    // A highlight as the old code wrote it: /T = the app name, /NM a plain id,
    // /Contents holding the highlighted text (there was no comment feature).
    const doc = await PDFDocument.load(new Uint8Array(await readFile(pdfPath)));
    const page = doc.getPage(0);
    const legacy = doc.context.obj({
      Type: "Annot",
      Subtype: "Highlight",
      Rect: [60, 700, 300, 730],
      QuadPoints: [60, 730, 300, 730, 60, 700, 300, 700],
      C: [1, 0.9, 0.1],
      NM: PDFString.of("legacy-id"),
      T: PDFHexString.fromText("知交文献阅读"),
      Contents: PDFHexString.fromText("旧版高亮的原文"),
    });
    page.node.set(PDFName.of("Annots"), doc.context.obj([doc.context.register(legacy)]));
    await writeFile(pdfPath, await doc.save());

    const [highlight] = await readHighlights(pdfPath);
    expect(highlight.managed).toBe(true);
    // Legacy /Contents was the highlighted text, not a comment.
    expect(highlight.text).toBe("旧版高亮的原文");
    expect(highlight.comment).toBe("");

    // The next sync removes the legacy highlight (it is recognised as ours).
    await syncHighlights(pdfPath, []);
    expect(await readHighlights(pdfPath)).toHaveLength(0);
  });

  it("writes a /Popup for a commented highlight and never orphans it", async () => {
    const countAnnots = async () => {
      const doc = await PDFDocument.load(new Uint8Array(await readFile(pdfPath)));
      let highlight = 0;
      let popup = 0;
      doc.getPages().forEach((pg) => {
        const annots = pg.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
        if (!annots) return;
        for (let i = 0; i < annots.size(); i += 1) {
          const a = doc.context.lookupMaybe(annots.get(i), PDFDict);
          const sub = a?.lookupMaybe(PDFName.of("Subtype"), PDFName)?.decodeText();
          if (sub === "Highlight") highlight += 1;
          if (sub === "Popup") popup += 1;
        }
      });
      return { highlight, popup };
    };

    // A commented highlight gets a paired Popup annotation.
    await syncHighlights(pdfPath, [hl({ id: "c1", comment: "有评论" })]);
    expect(await countAnnots()).toEqual({ highlight: 1, popup: 1 });

    // A plain (uncommented) highlight gets no Popup.
    await syncHighlights(pdfPath, [hl({ id: "c1", comment: "" })]);
    expect(await countAnnots()).toEqual({ highlight: 1, popup: 0 });

    // Re-saving a commented highlight must not accumulate orphan popups.
    await syncHighlights(pdfPath, [hl({ id: "c1", comment: "再评论" })]);
    await syncHighlights(pdfPath, [hl({ id: "c1", comment: "三评论" })]);
    expect(await countAnnots()).toEqual({ highlight: 1, popup: 1 });
  });

  it("writes one annotation per page for a highlight spanning pages", async () => {
    await syncHighlights(pdfPath, [
      hl({
        id: "multi-page",
        color: "#C9A8FF",
        text: "spans two pages",
        rects: [
          { pageIndex: 0, left: 0.1, top: 0.9, width: 0.8, height: 0.04 },
          { pageIndex: 1, left: 0.1, top: 0.05, width: 0.8, height: 0.04 },
        ],
      }),
    ]);
    // One annotation per page, both readable.
    expect(await readHighlights(pdfPath)).toHaveLength(2);
  });

  it("keeps the file a valid PDF after writing (atomic overwrite)", async () => {
    await syncHighlights(pdfPath, [
      hl({
        id: "v",
        color: "#C9A8FF",
        rects: [{ pageIndex: 0, left: 0.2, top: 0.2, width: 0.3, height: 0.06 }],
      }),
    ]);
    const reloaded = await PDFDocument.load(new Uint8Array(await readFile(pdfPath)));
    expect(reloaded.getPageCount()).toBe(2);
  });

  it("rejects a non-absolute or non-pdf path", async () => {
    await expect(syncHighlights("relative/path.pdf", [hl({ id: "x" })])).rejects.toThrow();
    await expect(readHighlights(join(dir, "not-a-pdf.txt"))).rejects.toThrow();
  });
});
