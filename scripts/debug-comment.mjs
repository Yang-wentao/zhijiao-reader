// End-to-end check for the comment feature:
//   select text → right-click → "添加评论"   → a comment card opens in edit mode
//   type a comment, blur, Cmd+S               → comment + Popup written into the PDF
//   click the highlight                       → its comment card re-opens
//   edit again + Cmd+S                         → no orphan Highlight / Popup annots
//
// The /Popup annotation is what makes WPS / Adobe treat the mark as a real
// comment (their "show all comments" toggles the popup) — so we assert it.
//
// Usage: node scripts/debug-comment.mjs /path/to/sample.pdf

import { chromium } from "playwright";
import { copyFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFString, PDFHexString } from "pdf-lib";

const srcPdf = resolve(process.argv[2] || "");
if (!srcPdf) {
  console.error("Usage: node scripts/debug-comment.mjs <sample.pdf>");
  process.exit(1);
}

const COMMENT = "需要改";
const COMMENT_2 =
  "这段写得不错，但倒数第二句的逻辑要重新组织；另外建议把三个要点串成一段连贯的话，" +
  "不要分点罗列，并在 probit 模型那里补充两句说明，把前因后果讲清楚。";

const dir = await mkdtemp(join(tmpdir(), "zhijiao-comment-"));
const testPdf = join(dir, "comment-test.pdf");
await copyFile(srcPdf, testPdf);
console.log(`→ Test copy: ${testPdf}`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

const errors = [];
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`[console.error] ${m.text()}`);
});

await page.addInitScript((path) => {
  window.desktopShell = { isElectron: true, getPathForFile: () => path };
}, testPdf);

await page.goto("http://localhost:5173/", { waitUntil: "load" });
await page.waitForSelector('input[type="file"][accept="application/pdf"]');
const closeBtn = page.getByRole("button", { name: "关闭" });
if (await closeBtn.isVisible().catch(() => false)) await closeBtn.click();

console.log("→ Upload PDF");
await page.locator('input[type="file"][accept="application/pdf"]').first().setInputFiles(testPdf);
await page.waitForSelector('[data-testid="core__text-layer-0"]', { timeout: 15000 });
await page.waitForTimeout(800);

async function readAnnotations() {
  const pdfDoc = await PDFDocument.load(new Uint8Array(await readFile(testPdf)));
  const highlights = [];
  let popupCount = 0;
  pdfDoc.getPages().forEach((pg) => {
    const annots = pg.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) return;
    for (let i = 0; i < annots.size(); i += 1) {
      const a = pdfDoc.context.lookupMaybe(annots.get(i), PDFDict);
      if (!a) continue;
      const subtype = a.lookupMaybe(PDFName.of("Subtype"), PDFName)?.decodeText() ?? "";
      if (subtype === "Popup") {
        popupCount += 1;
        continue;
      }
      if (subtype !== "Highlight") continue;
      const str = (key) => {
        const v = a.lookup(PDFName.of(key));
        return v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : null;
      };
      highlights.push({
        name: str("NM"),
        author: str("T"),
        contents: str("Contents"),
        creationDate: str("CreationDate"),
        hasPopup: !!a.lookup(PDFName.of("Popup")),
      });
    }
  });
  return { highlights, popupCount };
}

console.log("→ Select text on page 1 and open the context menu");
await page.evaluate(() => {
  const span = Array.from(
    document.querySelectorAll('[data-testid="core__text-layer-0"] span'),
  ).find((s) => (s.textContent ?? "").trim().length > 4);
  const range = document.createRange();
  range.selectNodeContents(span);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  const rect = span.getBoundingClientRect();
  span.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + 2,
      clientY: rect.top + 2,
    }),
  );
});
await page.waitForTimeout(300);

console.log('→ Click "添加评论"');
await page.getByRole("menuitem", { name: "添加评论" }).click();
await page.waitForTimeout(400);

const inputVisible = await page.locator(".zhijiao-comment-input").isVisible().catch(() => false);
console.log(`  comment card opened in edit mode: ${inputVisible}`);

console.log("→ Type the comment, then Cmd+S");
await page.locator(".zhijiao-comment-input").fill(COMMENT);
await page.waitForTimeout(200);
await page.locator(".zhijiao-comment-input").blur();
await page.waitForTimeout(300);

const cardCount = await page.locator(".zhijiao-comment-card").count();

const before = await readAnnotations();
await page.keyboard.press("Meta+s");
await page.waitForTimeout(1400);

const first = await readAnnotations();
console.log(`→ after save: ${first.highlights.length} Highlight, ${first.popupCount} Popup`);
for (const a of first.highlights) {
  console.log(
    `   NM=${a.name}  T=${a.author}  hasPopup=${a.hasPopup}  CreationDate=${a.creationDate}\n` +
      `   Contents=${JSON.stringify(a.contents)}`,
  );
}
// Card height with a SHORT comment — should auto-fit (small).
const shortCardHeight = Math.round(
  (await page.locator(".zhijiao-comment-card").first().boundingBox()).height,
);
console.log(`→ card height with short comment: ${shortCardHeight}px`);

console.log("→ Click the highlight to re-open its card, edit, save again");
await page.locator(".zhijiao-highlight-rect").first().click();
await page.waitForTimeout(400);
const reopened = await page.locator(".zhijiao-comment-input").isVisible().catch(() => false);
await page.locator(".zhijiao-comment-input").fill(COMMENT_2);
await page.waitForTimeout(150);
await page.locator(".zhijiao-comment-input").blur();
await page.waitForTimeout(200);
await page.keyboard.press("Meta+s");
await page.waitForTimeout(1400);

const second = await readAnnotations();
console.log(`→ after re-save: ${second.highlights.length} Highlight, ${second.popupCount} Popup`);
// Card height with the LONG comment — should auto-fit taller than the short one.
const longCardHeight = Math.round(
  (await page.locator(".zhijiao-comment-card").first().boundingBox()).height,
);
console.log(`→ card height with long comment: ${longCardHeight}px (was ${shortCardHeight}px)`);

console.log("→ Drag the card header to move it");
const cardA = await page.locator(".zhijiao-comment-card").first().boundingBox();
const head = await page.locator(".zhijiao-comment-head").first().boundingBox();
await page.mouse.move(head.x + 30, head.y + head.height / 2);
await page.mouse.down();
await page.mouse.move(head.x + 30 + 60, head.y + head.height / 2 + 45, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(250);
const cardB = await page.locator(".zhijiao-comment-card").first().boundingBox();
const movedDx = Math.round(cardB.x - cardA.x);
const movedDy = Math.round(cardB.y - cardA.y);
console.log(`  moved: dx=${movedDx} dy=${movedDy} (expect ~60, ~45)`);

// The native CSS resize handle can't be driven by synthetic mouse events,
// so assert the affordance is enabled instead of simulating the drag.
const resizeStyle = await page
  .locator(".zhijiao-comment-card")
  .first()
  .evaluate((el) => getComputedStyle(el).resize);
console.log(`→ card resize affordance: ${resizeStyle} (expect "both")`);

console.log("→ Re-open the saved PDF in a new tab");
await page.locator('input[type="file"][accept="application/pdf"]').first().setInputFiles(testPdf);
await page.waitForSelector(".zhijiao-comment-card", { timeout: 15000 });
await page.waitForTimeout(1000);
// react-pdf-viewer renders the saved /Popup annotation as its own yellow
// box; our CSS must hide it (we show our own card instead).
const popupBoxesVisible = await page.locator(".rpv-core__annotation-popup-wrapper:visible").count();
const reloadedCardText = await page
  .locator(".zhijiao-comment-card .zhijiao-comment-body")
  .first()
  .textContent()
  .catch(() => "");
console.log(`  react-pdf-viewer popup boxes visible: ${popupBoxesVisible} (expect 0)`);
console.log(`  our card after reload shows: "${reloadedCardText}"`);

console.log("→ Right-click the highlight for the 取消高亮 / 写批注 menu");
// Two tabs are open now; target the highlight in the visible (active) tab.
await page.locator(".zhijiao-highlight-rect:visible").first().click({ button: "right" });
await page.waitForTimeout(300);
const hasRemoveItem = await page
  .getByRole("menuitem", { name: "取消高亮" })
  .isVisible()
  .catch(() => false);
const hasCommentItem = await page
  .getByRole("menuitem", { name: "写批注" })
  .isVisible()
  .catch(() => false);
console.log(`  menu items — 取消高亮:${hasRemoveItem}  写批注:${hasCommentItem}`);

console.log("→ Click 取消高亮");
await page.getByRole("menuitem", { name: "取消高亮" }).click();
await page.waitForTimeout(400);
const highlightsAfterRemove = await page.locator(".zhijiao-highlight-rect:visible").count();
const cardsAfterRemove = await page.locator(".zhijiao-comment-card:visible").count();
console.log(`  after 取消高亮 — highlight rects:${highlightsAfterRemove}  cards:${cardsAfterRemove}`);

const saved = first.highlights[0];
const checks = {
  "card opened in edit mode after 添加评论": inputVisible === true,
  "one comment card shown in app": cardCount === 1,
  "file untouched before save": before.highlights.length === 0,
  "highlight written to PDF": first.highlights.length === 1,
  "comment written to /Contents": saved?.contents === COMMENT,
  "author written to /T": saved?.author === "yangwentao",
  "managed marker on /NM": (saved?.name ?? "").startsWith("zhijiao-"),
  "creation date written": !!saved?.creationDate,
  "Popup annotation written": first.popupCount === 1,
  "highlight links to its Popup": saved?.hasPopup === true,
  "highlight click re-opens card": reopened === true,
  "comment edit re-saved": second.highlights[0]?.contents === COMMENT_2,
  "no orphan Highlight on re-save": second.highlights.length === 1,
  "no orphan Popup on re-save": second.popupCount === 1,
  "card moved by header drag": Math.abs(movedDx - 60) < 14 && Math.abs(movedDy - 45) < 14,
  "card resize affordance enabled": resizeStyle === "both",
  "card height auto-fits content (long > short)": longCardHeight > shortCardHeight + 24,
  "no react-pdf-viewer popup box on reload": popupBoxesVisible === 0,
  "comment survives reload (shown in our card)": (reloadedCardText ?? "").includes(COMMENT_2),
  "highlight right-click menu has 取消高亮": hasRemoveItem === true,
  "highlight right-click menu has 写批注": hasCommentItem === true,
  "取消高亮 removes the highlight": highlightsAfterRemove === 0,
  "取消高亮 removes the comment card": cardsAfterRemove === 0,
};

console.log("\n=== RESULT ===");
let allPass = true;
for (const [name, ok] of Object.entries(checks)) {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) allPass = false;
}
const realErrors = errors.filter((e) => !e.includes("503"));
console.log(`console errors: ${realErrors.length === 0 ? "none" : realErrors.join("; ")}`);

await browser.close();
process.exit(allPass ? 0 : 1);
