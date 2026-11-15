// Printing shared by the apps: each page is an SVG (vector graphics, with the text as text in the
// document's fonts) in a print-only container; the browser's print dialog prints them and can also
// save a PDF. Also the paper's CSS size, the text measuring of SVG pages, and a PDF environment
// for the PDF writer.
import type { SVGEnvironment } from '@lo/filter/source/svg/svgwriter.ts';
import type { PDFEnvironment, PDFImage } from '@lo/vcl/source/pdf/pdfwriter_impl.ts';

/** The papers CSS names (mm, portrait), so the print dialog picks the paper and its orientation. */
const PAPERS: [string, number, number][] = [['A5', 148, 210], ['A4', 210, 297], ['A3', 297, 420], ['B5', 176, 250], ['B4', 250, 353], ['letter', 215.9, 279.4], ['legal', 215.9, 355.6], ['ledger', 279.4, 431.8]];

/** A page's CSS paper: a named paper with its orientation where it is one, else millimetres. */
function PagePaper(w: number, h: number): { css: string; heightMm: number } {
  const mm = (t: number) => (t / 1440) * 25.4;
  const [wm, hm] = [mm(w), mm(h)];
  const landscape = wm > hm;
  const [short, long] = landscape ? [hm, wm] : [wm, hm];
  // Within 1 mm: page sizes come rounded from documents (A4 is often 11906 × 16838 twips).
  const paper = PAPERS.find(([, pw, ph]) => Math.abs(pw - short) < 1 && Math.abs(ph - long) < 1);
  if (paper) return { css: `${paper[0]} ${landscape ? 'landscape' : 'portrait'}`, heightMm: landscape ? paper[1] : paper[2] };
  return { css: `${wm.toFixed(2)}mm ${hm.toFixed(2)}mm`, heightMm: Number(hm.toFixed(2)) };
}

/** A page's CSS size (twips): a named paper with its orientation where it is one, else millimetres. */
export function PageSizeCss(w: number, h: number): string {
  return PagePaper(w, h).css;
}

/**
 * The height of a printed sheet: a little less than the paper, which may be shorter than the page
 * (A4 is 297 mm, 16838 twips are 297.04 mm). Firefox breaks a sheet that does not fit, even by a
 * fraction of a pixel, and prints a blank page after each page.
 */
export function SheetHeightCss(w: number, h: number): string {
  return `calc(min(${h / 15}px, ${PagePaper(w, h).heightMm}mm) - 1px)`;
}

/** Measures as the layout's CanvasTextMeasurer does. */
export function SVGPrintEnvironment(): SVGEnvironment {
  const ctx = new OffscreenCanvas(1, 1).getContext('2d')!;
  ctx.textRendering = 'geometricPrecision';
  ctx.fontKerning = 'normal';
  return {
    measure(css, text, letterSpacing) { ctx.font = css; ctx.letterSpacing = letterSpacing; return ctx.measureText(text).width; },
    bounds(css, text) { ctx.font = css; ctx.letterSpacing = '0px'; const m = ctx.measureText(text); return { ascent: m.actualBoundingBoxAscent, descent: m.actualBoundingBoxDescent }; },
  };
}

/**
 * The PDF writer's platform services: measuring as the layout does, and text the standard fonts
 * cannot show rasterised on a canvas.
 */
export function PDFExportEnvironment(): PDFEnvironment {
  const ctx = new OffscreenCanvas(1, 1).getContext('2d')!;
  ctx.textRendering = 'geometricPrecision';
  ctx.fontKerning = 'normal';
  return {
    measure(css, text) { ctx.font = css; return ctx.measureText(text).width; },
    rasterText(css, text, color, scale) {
      ctx.font = css;
      const m = ctx.measureText(text);
      const ascent = Math.max(m.actualBoundingBoxAscent, m.fontBoundingBoxAscent ?? 0), descent = Math.max(m.actualBoundingBoxDescent, m.fontBoundingBoxDescent ?? 0);
      const w = Math.max(1, Math.ceil(m.width * scale)), h = Math.max(1, Math.ceil((ascent + descent) * scale));
      const c = new OffscreenCanvas(w, h).getContext('2d')!;
      c.scale(scale, scale);
      c.font = css;
      c.fillStyle = color;
      c.fillText(text, 0, ascent);
      const data = c.getImageData(0, 0, w, h).data;
      const rgb = new Uint8Array(w * h * 3), alpha = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) { rgb[i * 3] = data[i * 4]!; rgb[i * 3 + 1] = data[i * 4 + 1]!; rgb[i * 3 + 2] = data[i * 4 + 2]!; alpha[i] = data[i * 4 + 3]!; }
      const image: PDFImage = { width: w, height: h, rgb, alpha };
      return { image, width: m.width, ascent, descent };
    },
  };
}

/** A printed page: its size in twips and its SVG. */
export interface PrintPage { width: number; height: number; svg: string }

/**
 * Puts the pages into the print-only container and opens the browser's print dialog. Pages of
 * different sizes get one named @page rule per size; the first page's size is also the default,
 * which the print dialog offers as paper and orientation. `cleanup` runs after printing.
 */
export async function PrintSVGPages(pages: readonly PrintPage[], cleanup?: () => void): Promise<void> {
  const host = document.createElement('div');
  host.className = 'print-host';
  const style = document.createElement('style');
  const sizes = new Map<string, string>();
  for (const page of pages) {
    const key = `${page.width}x${page.height}`;
    if (!sizes.has(key)) sizes.set(key, `lo-page-${sizes.size}`);
  }
  const size = (k: string) => PageSizeCss(...(k.split('x').map(Number) as [number, number]));
  const first = [...sizes.keys()][0];
  style.textContent = `@page { ${first ? `size: ${size(first)}; ` : ''}margin: 0 } ${[...sizes].map(([k, name]) => `@page ${name} { size: ${size(k)}; margin: 0 }`).join(' ')}`;
  for (const page of pages) {
    const sheet = document.createElement('div');
    sheet.className = 'print-page';
    sheet.style.setProperty('page', sizes.get(`${page.width}x${page.height}`)!);
    sheet.style.height = SheetHeightCss(page.width, page.height);
    sheet.innerHTML = page.svg;
    host.append(sheet);
  }
  document.head.append(style);
  document.body.append(host);
  // The images inside the SVGs load before the dialog opens.
  await Promise.all([...host.querySelectorAll('image')].map((i) => new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = img.onerror = () => resolve();
    img.src = i.getAttribute('href') ?? '';
  })));
  const done = () => {
    host.remove(); style.remove();
    cleanup?.();
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}
