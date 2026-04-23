import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendNoteToVault,
  formatNoteEntry,
  formatPageRange,
  sanitizeFileName,
} from "./notesWriter";

describe("notesWriter helpers", () => {
  it("formats single page and ranges and handles missing pages", () => {
    expect(formatPageRange(12, 12)).toBe("p.12");
    expect(formatPageRange(12, null)).toBe("p.12");
    expect(formatPageRange(null, 7)).toBe("p.7");
    expect(formatPageRange(12, 13)).toBe("p.12-13");
    expect(formatPageRange(13, 12)).toBe("p.12-13");
    expect(formatPageRange(null, null)).toBe("p.?");
  });

  it("strips .pdf extension and replaces unsafe filename characters", () => {
    expect(sanitizeFileName("paper.pdf")).toBe("paper");
    expect(sanitizeFileName("a/b:c*d?.pdf")).toBe("a_b_c_d_");
    expect(sanitizeFileName("   ")).toBe("untitled");
  });

  it("formats a note entry without translation when omitted", () => {
    const entry = formatNoteEntry({
      vaultPath: "/vault",
      subdir: "知交摘录",
      pdfName: "paper.pdf",
      startPage: 5,
      endPage: 5,
      original: "foo bar",
      includeTimestamp: false,
    });
    expect(entry).toContain("## p.5");
    expect(entry).toContain("> foo bar");
    expect(entry).toContain("---");
    expect(entry).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("includes translation block when provided", () => {
    const entry = formatNoteEntry({
      vaultPath: "/vault",
      subdir: "知交摘录",
      pdfName: "paper.pdf",
      startPage: 5,
      endPage: 6,
      original: "foo",
      translation: "翻译内容",
      includeTimestamp: true,
      now: new Date("2026-04-15T10:30:00"),
    });
    expect(entry).toContain("## p.5-6 · 2026-04-15");
    expect(entry).toContain("翻译内容");
  });
});

describe("appendNoteToVault", () => {
  let vaultDir: string;

  beforeEach(async () => {
    vaultDir = await mkdtemp(join(tmpdir(), "zhijiao-notes-"));
  });

  afterEach(async () => {
    await rm(vaultDir, { recursive: true, force: true });
  });

  it("creates the note file with header on first append, then appends only on subsequent calls", async () => {
    const first = await appendNoteToVault({
      vaultPath: vaultDir,
      subdir: "知交摘录",
      pdfName: "paper.pdf",
      startPage: 1,
      endPage: 1,
      original: "first selection",
      includeTimestamp: false,
    });
    expect(first.created).toBe(true);
    expect(first.filePath).toContain("知交摘录");
    expect(first.filePath).toContain("paper.md");

    const second = await appendNoteToVault({
      vaultPath: vaultDir,
      subdir: "知交摘录",
      pdfName: "paper.pdf",
      startPage: 2,
      endPage: 3,
      original: "second selection",
      translation: "second translation",
      includeTimestamp: false,
    });
    expect(second.created).toBe(false);
    expect(second.filePath).toBe(first.filePath);

    const content = await readFile(first.filePath, "utf8");
    expect(content.match(/^# paper$/m)).not.toBeNull();
    expect(content).toContain("first selection");
    expect(content).toContain("second selection");
    expect(content).toContain("p.2-3");
    expect(content).toContain("second translation");
    const headerCount = content.match(/^# paper$/gm)?.length ?? 0;
    expect(headerCount).toBe(1);
  });

  it("rejects relative vault paths", async () => {
    await expect(
      appendNoteToVault({
        vaultPath: "relative/path",
        subdir: "知交摘录",
        pdfName: "paper.pdf",
        startPage: 1,
        endPage: 1,
        original: "x",
        includeTimestamp: false,
      }),
    ).rejects.toThrow(/absolute/);
  });

  it("rejects empty vault path", async () => {
    await expect(
      appendNoteToVault({
        vaultPath: "",
        subdir: "知交摘录",
        pdfName: "paper.pdf",
        startPage: 1,
        endPage: 1,
        original: "x",
        includeTimestamp: false,
      }),
    ).rejects.toThrow(/configured/);
  });
});
