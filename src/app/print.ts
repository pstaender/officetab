// Printing renders each page to an image in a print-only container and opens the browser's dialog.
import { PaintFrame, TWIPS_PER_CSS_PX } from '@lo/sw/source/core/view/paint.ts';
import type { Controller } from './controller.ts';

const PRINT_DPI = 200;

export async function printDocument(c: Controller): Promise<void> {
  const root = c.sh.m_pRoot;
  const pd = c.sh.m_pDoc.m_aPageDesc;
  const scale = PRINT_DPI / 1440;
  const host = document.createElement('div');
  host.className = 'print-host';
  const urls: string[] = [];
  const style = document.createElement('style');
  style.textContent = `@page { size: ${pd.nWidth / TWIPS_PER_CSS_PX}px ${pd.nHeight / TWIPS_PER_CSS_PX}px; margin: 0 }`;
  for (const page of root.pages) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(pd.nWidth * scale);
    canvas.height = Math.round(pd.nHeight * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, -page.aFrame.Left() * scale, -page.aFrame.Top() * scale);
    ctx.textRendering = 'geometricPrecision';
    for (const f of page.frames) PaintFrame(ctx, f, '#000');
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not render the page'))), 'image/png'));
    const url = URL.createObjectURL(blob);
    urls.push(url);
    const img = document.createElement('img');
    img.src = url;
    img.style.width = `${pd.nWidth / TWIPS_PER_CSS_PX}px`;
    img.style.height = `${pd.nHeight / TWIPS_PER_CSS_PX}px`;
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
