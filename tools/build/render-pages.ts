// Renders every page of a document as the app lays it out, for comparing against a reference PDF.
// Usage: node tools/build/render-pages.ts <file> <outdir>   (needs `npm run build` and the preview server)
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const [file, out] = process.argv.slice(2);
if (!file || !out) throw new Error('usage: render-pages.ts <file> <outdir>');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.addInitScript(() => { window.print = () => {}; delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker; });
await page.goto(process.env.BASE ?? 'http://localhost:4173/');
await page.waitForFunction(() => !!(globalThis as { __writer?: unknown }).__writer);
const data = readFileSync(file).toString('base64');
const name = basename(file);
await page.evaluate(async ({ data, name }) => {
  const c = (globalThis as unknown as { __writer: { openFile(f: File, h: null): Promise<void> } }).__writer;
  const bytes = Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0));
  await c.openFile(new File([bytes], name), null);
}, { data, name });
// Trigger printing through the keyboard shortcut, then collect the rendered page images.
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+p' : 'Control+p');
await page.waitForSelector('.print-host img', { state: 'attached' });
const images = await page.$$eval('.print-host img', async (imgs) => Promise.all((imgs as HTMLImageElement[]).map(async (i) => {
  const b = await (await fetch(i.src)).blob();
  return new Promise<string>((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]!); fr.readAsDataURL(b); });
})));
images.forEach((b64, k) => writeFileSync(`${out}/page-${k + 1}.png`, Buffer.from(b64, 'base64')));
// Also export the PDF (vector text, for comparing positions with pdftotext -bbox).
await page.keyboard.press('Escape');
const download = page.waitForEvent('download');
await page.evaluate(() => (globalThis as unknown as { __dispatch(c: string): boolean }).__dispatch('.uno:ExportDirectToPDF'));
await (await download).saveAs(`${out}/doc.pdf`);
const lost = await page.getByRole('alert').allTextContents().catch(() => []);
console.log(`${images.length} pages`, lost.join(' | '));
await browser.close();
