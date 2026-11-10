// Printing renders each page to an image in a print-only container and opens the browser's dialog.
import { PaintPageContent, TWIPS_PER_CSS_PX } from '@lo/sw/source/core/view/paint.ts';
import type { Controller } from './controller.ts';

const PRINT_DPI = 200;

export async function printDocument(c: Controller): Promise<void> {
  const root = c.sh.m_pRoot;
  await c.graphics.LoadAll(c.sh.m_pDoc);
  const graphic = (k: string) => c.graphics.Get(c.sh.m_pDoc, k);
  const scale = PRINT_DPI / 1440;
  const host = document.createElement('div');
  host.className = 'print-host';
  const urls: string[] = [];
  const style = document.createElement('style');
  // Pages of different page styles may differ in size: one named @page rule per size.
  const sizes = new Map<string, string>();
  for (const page of root.pages) {
    const key = `${page.aFrame.Width()}x${page.aFrame.Height()}`;
    if (!sizes.has(key)) sizes.set(key, `lo-page-${sizes.size}`);
  }
  style.textContent = `@page { margin: 0 } ${[...sizes].map(([k, name]) => { const [w, h] = k.split('x').map(Number); return `@page ${name} { size: ${w! / TWIPS_PER_CSS_PX}px ${h! / TWIPS_PER_CSS_PX}px; margin: 0 }`; }).join(' ')}`;
  for (const page of root.pages) {
    const pw = page.aFrame.Width(), ph = page.aFrame.Height();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(pw * scale);
    canvas.height = Math.round(ph * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, -page.aFrame.Left() * scale, -page.aFrame.Top() * scale);
    ctx.textRendering = 'geometricPrecision';
    PaintPageContent(ctx, page, { autoColor: '#000', fieldShading: null, bounds: null, graphic });
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not render the page'))), 'image/png'));
    const url = URL.createObjectURL(blob);
    urls.push(url);
    const img = document.createElement('img');
    img.src = url;
    img.style.width = `${pw / TWIPS_PER_CSS_PX}px`;
    img.style.height = `${ph / TWIPS_PER_CSS_PX}px`;
    img.style.setProperty('page', sizes.get(`${pw}x${ph}`)!);
    host.append(img);
  }
  document.head.append(style);
  document.body.append(host);
  await Promise.all([...host.querySelectorAll('img')].map((i) => i.decode()));
  const cleanup = () => {
    host.remove(); style.remove();
    urls.forEach((u) => URL.revokeObjectURL(u));
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
}
