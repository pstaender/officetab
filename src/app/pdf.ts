// Browser services for PDF export: measuring and rasterising with the same fonts the layout used,
// decoding graphics, and saving the file.
import { ExportPDF } from '@lo/sw/source/core/view/vprint.ts';
import type { PDFEnvironment, PDFImage } from '@lo/vcl/source/pdf/pdfwriter_impl.ts';
import type { Controller } from './controller.ts';

function environment(): PDFEnvironment {
  const ctx = new OffscreenCanvas(1, 1).getContext('2d')!;
  ctx.textRendering = 'geometricPrecision';
  ctx.fontKerning = 'normal';
  return {
    measure(css, text) { ctx.font = css; return ctx.measureText(text).width; },
    rasterText(css, text, color, scale) {
      ctx.font = css;
      const m = ctx.measureText(text);
      const ascent = Math.ceil(m.fontBoundingBoxAscent), descent = Math.ceil(m.fontBoundingBoxDescent);
      const w = Math.max(1, Math.ceil(m.width * scale)), h = Math.max(1, Math.ceil((ascent + descent) * scale));
      const c = new OffscreenCanvas(w, h).getContext('2d')!;
      c.scale(scale, scale);
      c.font = css;
      c.fillStyle = color;
      c.textBaseline = 'alphabetic';
      c.fillText(text, 0, ascent);
      return { image: toPDFImage(c.getImageData(0, 0, w, h)), width: m.width, ascent, descent };
    },
  };
}

function toPDFImage(d: ImageData): PDFImage {
  const n = d.width * d.height;
  const rgb = new Uint8Array(n * 3), alpha = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = d.data[i * 4 + 3]!;
    // Canvas pixel data is not premultiplied; transparent pixels keep their colour for the soft mask.
    rgb[i * 3] = d.data[i * 4]!; rgb[i * 3 + 1] = d.data[i * 4 + 1]!; rgb[i * 3 + 2] = d.data[i * 4 + 2]!;
    alpha[i] = a;
  }
  return { width: d.width, height: d.height, rgb, alpha };
}

/** JPEG data goes into the PDF as it is; everything else is decoded to pixels. */
async function decodeGraphics(c: Controller): Promise<Map<string, PDFImage>> {
  const out = new Map<string, PDFImage>();
  for (const [key, g] of c.sh.m_pDoc.m_aGraphics) {
    try {
      const bmp = await createImageBitmap(new Blob([g.data as BlobPart], { type: g.mime }));
      if (g.mime === 'image/jpeg') out.set(key, { width: bmp.width, height: bmp.height, jpeg: g.data });
      else {
        const ctx = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d')!;
        ctx.drawImage(bmp, 0, 0);
        out.set(key, toPDFImage(ctx.getImageData(0, 0, bmp.width, bmp.height)));
      }
      bmp.close();
    } catch { /* an undecodable graphic is left out, as on screen */ }
  }
  return out;
}

type SaveWindow = typeof window & { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle & { createWritable(): Promise<FileSystemWritableFileStream> }> };

export async function exportPDF(c: Controller): Promise<Blob> {
  const bytes = await ExportPDF(c.sh, environment(), await decodeGraphics(c), c.name);
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

/** FN_EXPORT_DIRECT_TO_PDF: writes the PDF to a file the user picks, or downloads it. */
export async function exportPDFToFile(c: Controller): Promise<void> {
  const suggestedName = `${c.name}.pdf`;
  const w = window as SaveWindow;
  try {
    if (w.showSaveFilePicker) {
      const h = await w.showSaveFilePicker({ suggestedName, types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }] });
      const blob = await exportPDF(c);
      const s = await h.createWritable();
      await s.write(blob);
      await s.close();
      return;
    }
    const url = URL.createObjectURL(await exportPDF(c));
    const a = document.createElement('a');
    a.href = url; a.download = suggestedName; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (e) {
    if ((e as DOMException).name !== 'AbortError') c.setMessage(`PDF export failed: ${(e as Error).message}`);
  }
}
