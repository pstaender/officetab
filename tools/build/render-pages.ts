// Renders every page of a document as the app prints it (PDF, and PNG pages with poppler), for
// comparing against a reference PDF. Spreadsheets (.ods, .ots, .fods, .csv) print in Calc (all
// sheets, empty pages suppressed, as LibreOffice's PDF export does), other documents in Writer.
// Usage: node tools/build/render-pages.ts <file> <outdir>   (needs `npm run build` and the preview server)
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const [file, out] = process.argv.slice(2);
if (!file || !out) throw new Error('usage: render-pages.ts <file> <outdir>');
mkdirSync(out, { recursive: true });
const app = /\.(ods|ots|fods|csv)$/i.test(file) ? 'calc' : 'writer';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.addInitScript(() => { window.print = () => {}; delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker; });
const base = process.env.BASE ?? 'http://localhost:4173/';
await page.goto(`${base.replace(/\/(writer|calc)\/?$/, '/')}${app}/`);
await page.waitForFunction((app) => !!(globalThis as Record<string, unknown>)[`__${app}`], app);
const data = readFileSync(file).toString('base64');
const name = basename(file);
await page.evaluate(async ({ data, name, app }) => {
  const c = (globalThis as unknown as Record<string, { openFile(f: File, h: null): Promise<void> }>)[`__${app}`]!;
  const bytes = Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0));
  await c.openFile(new File([bytes], name), null);
}, { data, name, app });
// The document's web fonts load lazily: wait for them (and the relayout they cause).
await page.waitForLoadState('networkidle');
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
// Print through the keyboard shortcut: the print view's pages are SVG, and Chromium's PDF of the
// print view is what "Save as PDF" in the print dialog gives (vector text in the document's fonts).
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+p' : 'Control+p');
if (app === 'calc') {
  // Calc's print options first: all sheets, as LibreOffice's PDF export prints them.
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('All sheets').check();
  await dialog.getByRole('button', { name: 'Print', exact: true }).click();
}
await page.waitForSelector('.print-host svg', { state: 'attached' });
const pages = await page.locator('.print-host .print-page').count();
writeFileSync(`${out}/doc.pdf`, await page.pdf({ preferCSSPageSize: true, printBackground: true }));
// Page images from the PDF, where poppler is installed.
try {
  execFileSync('pdftoppm', ['-r', '150', '-png', `${out}/doc.pdf`, `${out}/page`]);
  for (const f of readdirSync(out)) { const m = /^page-0*(\d+)\.png$/.exec(f); if (m) renameSync(`${out}/${f}`, `${out}/page-${m[1]}.png`); }
} catch { console.log('pdftoppm not found: no page images'); }
const lost = await page.getByRole('alert').allTextContents().catch(() => []);
console.log(`${pages} pages`, lost.join(' | '));
await browser.close();
