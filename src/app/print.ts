// Printing paints each page as SVG (vector graphics, with the text as text in the document's
// fonts) into a print-only container and opens the browser's dialog, which can also save a PDF.
import { DateTimeNow } from '@lo/sfx2/source/doc/SfxDocumentMetaData.ts';
import { PrintImageKey, PrintSVG } from '@lo/sw/source/core/view/vprint.ts';
import type { SVGEnvironment } from '@lo/filter/source/svg/svgwriter.ts';
import type { Controller } from './controller.ts';

/** The papers CSS names (mm, portrait), so the print dialog picks the paper and its orientation. */
const PAPERS: [string, number, number][] = [['A5', 148, 210], ['A4', 210, 297], ['A3', 297, 420], ['B5', 176, 250], ['B4', 250, 353], ['letter', 215.9, 279.4], ['legal', 215.9, 355.6], ['ledger', 279.4, 431.8]];

/** A page's CSS size: a named paper with its orientation where it is one, else millimetres. */
export function PageSizeCss(w: number, h: number): string {
  const mm = (t: number) => (t / 1440) * 25.4;
  const [wm, hm] = [mm(w), mm(h)];
  const landscape = wm > hm;
  const [short, long] = landscape ? [hm, wm] : [wm, hm];
  // Within 1 mm: page sizes come rounded from documents (A4 is often 11906 × 16838 twips).
  const paper = PAPERS.find(([, pw, ph]) => Math.abs(pw - short) < 1 && Math.abs(ph - long) < 1);
  if (paper) return `${paper[0]} ${landscape ? 'landscape' : 'portrait'}`;
  return `${wm.toFixed(2)}mm ${hm.toFixed(2)}mm`;
}

/** Measures as the layout's CanvasTextMeasurer does. */
function environment(): SVGEnvironment {
  const ctx = new OffscreenCanvas(1, 1).getContext('2d')!;
  ctx.textRendering = 'geometricPrecision';
  ctx.fontKerning = 'normal';
  return {
    measure(css, text, letterSpacing) { ctx.font = css; ctx.letterSpacing = letterSpacing; return ctx.measureText(text).width; },
    bounds(css, text) { ctx.font = css; ctx.letterSpacing = '0px'; const m = ctx.measureText(text); return { ascent: m.actualBoundingBoxAscent, descent: m.actualBoundingBoxDescent }; },
  };
}

export async function printDocument(c: Controller): Promise<void> {
  const root = c.sh.m_pRoot;
  const doc = c.sh.m_pDoc;
  await document.fonts.ready;
  // SfxPrinterController: refresh document info (PrintingModifiesDocument is off: not modified).
  doc.m_xDocProps.setPrintedBy(doc.m_bUseUserData ? c.userFullName : '');
  doc.m_xDocProps.setPrintDate(DateTimeNow());
  // The graphics as blob: URLs for the SVG images.
  const urls = new Map<string, string>();
  for (const [key, g] of doc.m_aGraphics) urls.set(key, URL.createObjectURL(new Blob([g.data as BlobPart], { type: g.mime })));
  // Graphics with colour attributes print as their modified bitmaps.
  for (const f of doc.GetFlyFormats()) {
    const key = f.asChar?.graphic ?? f.fmt?.graphic, attr = f.asChar?.m_aGrfAttr ?? f.fmt?.m_aGrfAttr;
    const id = key !== undefined ? PrintImageKey(key, attr) : '';
    if (key === undefined || urls.has(id)) continue;
    const blob = await c.graphics.GetPrintBlob(doc, key, attr);
    if (blob) urls.set(id, URL.createObjectURL(blob));
  }
  const host = document.createElement('div');
  host.className = 'print-host';
  const style = document.createElement('style');
  // Pages of different page styles may differ in size: one named @page rule per size. The first
  // page's size is also the default, which the print dialog offers as paper and orientation.
  const sizes = new Map<string, string>();
  for (const page of root.pages) {
    const key = `${page.aFrame.Width()}x${page.aFrame.Height()}`;
    if (!sizes.has(key)) sizes.set(key, `lo-page-${sizes.size}`);
  }
  const size = (k: string) => PageSizeCss(...(k.split('x').map(Number) as [number, number]));
  const first = [...sizes.keys()][0];
  style.textContent = `@page { ${first ? `size: ${size(first)}; ` : ''}margin: 0 } ${[...sizes].map(([k, name]) => `@page ${name} { size: ${size(k)}; margin: 0 }`).join(' ')}`;
  const svgs = PrintSVG(c.sh, environment(), urls);
  root.pages.forEach((page, k) => {
    const sheet = document.createElement('div');
    sheet.className = 'print-page';
    sheet.style.setProperty('page', sizes.get(`${page.aFrame.Width()}x${page.aFrame.Height()}`)!);
    sheet.innerHTML = svgs[k]!;
    host.append(sheet);
  });
  document.head.append(style);
  document.body.append(host);
  // The images inside the SVGs load before the dialog opens.
  await Promise.all([...host.querySelectorAll('image')].map((i) => new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = img.onerror = () => resolve();
    img.src = i.getAttribute('href') ?? '';
  })));
  const cleanup = () => {
    host.remove(); style.remove();
    urls.forEach((u) => URL.revokeObjectURL(u));
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
}
