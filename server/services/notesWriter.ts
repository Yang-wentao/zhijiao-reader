import { mkdir, appendFile, writeFile, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export type AppendNoteInput = {
  vaultPath: string;
  subdir: string;
  pdfName: string;
  startPage: number | null;
  endPage: number | null;
  original: string;
  translation?: string | null;
  includeTimestamp: boolean;
  now?: Date;
};

export type AppendNoteResult = {
  filePath: string;
  created: boolean;
};

export async function appendNoteToVault(input: AppendNoteInput): Promise<AppendNoteResult> {
  const vaultPath = input.vaultPath.trim();
  if (!vaultPath) {
    throw new Error("Obsidian vault path is not configured.");
  }
  if (!isAbsolute(vaultPath)) {
    throw new Error("Obsidian vault path must be an absolute path.");
  }

  const subdir = input.subdir.trim() || "知交摘录";
  const targetDir = resolve(vaultPath, subdir);
  const fileName = `${sanitizeFileName(input.pdfName)}.md`;
  const filePath = join(targetDir, fileName);

  await mkdir(targetDir, { recursive: true });

  const created = !(await fileExists(filePath));
  if (created) {
    const header = `# ${stripExtension(input.pdfName)}\n\n来源：知交文献阅读\n\n`;
    await writeFile(filePath, header, "utf8");
  }

  const entry = formatNoteEntry(input);
  await appendFile(filePath, entry, "utf8");

  return { filePath, created };
}

export function formatNoteEntry(input: AppendNoteInput): string {
  const pageLabel = formatPageRange(input.startPage, input.endPage);
  const timestamp = input.includeTimestamp ? ` · ${formatTimestamp(input.now ?? new Date())}` : "";
  const heading = `## ${pageLabel}${timestamp}`;
  const quoted = quoteBlock(input.original.trim());
  const translation = (input.translation ?? "").trim();

  const parts = [heading, "", quoted];
  if (translation) {
    parts.push("", translation);
  }
  parts.push("", "---", "", "");
  return `${parts.join("\n")}`;
}

export function sanitizeFileName(name: string): string {
  const stripped = stripExtension(name).normalize("NFC");
  const cleaned = stripped
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    return "untitled";
  }
  return cleaned.length > 120 ? cleaned.slice(0, 120) : cleaned;
}

export function formatPageRange(startPage: number | null, endPage: number | null): string {
  if (startPage == null && endPage == null) {
    return "p.?";
  }
  if (startPage == null) {
    return `p.${endPage}`;
  }
  if (endPage == null || endPage === startPage) {
    return `p.${startPage}`;
  }
  if (endPage < startPage) {
    return `p.${endPage}-${startPage}`;
  }
  return `p.${startPage}-${endPage}`;
}

function quoteBlock(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

function formatTimestamp(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function stripExtension(name: string): string {
  return name.replace(/\.pdf$/i, "");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveNoteFilePath(vaultPath: string, subdir: string, pdfName: string): string {
  return join(resolve(vaultPath, subdir.trim() || "知交摘录"), `${sanitizeFileName(pdfName)}.md`);
}

export function ensureParentDir(path: string): Promise<void> {
  return mkdir(dirname(path), { recursive: true }).then(() => undefined);
}
