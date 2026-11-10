// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/core/view/vprint.cxx reduced
// SwViewShell::PrintOrPDFExport: every page is painted, without screen decorations, into the output
// (a PDF, or SVG pages for the browser's print).
import { PDFWriterImpl, type PDFEnvironment, type PDFImage } from '../../../../vcl/source/pdf/pdfwriter_impl.ts';
import { SVGContext, type SVGEnvironment } from '../../../../filter/source/svg/svgwriter.ts';
import { PaintPageContent, TWIPS_PER_CSS_PX } from './paint.ts';
import type { SwWrtShell } from '../../uibase/wrtsh/wrtsh.ts';

/** Exports the laid-out document as PDF. `images` holds the decoded graphics by key. */
export async function ExportPDF(sh: SwWrtShell, env: PDFEnvironment, images: Map<string, PDFImage>, title = ''): Promise<Uint8Array> {
  const writer = new PDFWriterImpl(env, title);
  const refs = new Map([...images].map(([k, v]) => [k, { pdfImage: v }]));
  for (const page of sh.m_pRoot.pages) {
    const r = page.aFrame;
    const ctx = writer.NewPage(r.Width(), r.Height(), r.Left(), r.Top());
    PaintPageContent(ctx as unknown as CanvasRenderingContext2D, page, {
      autoColor: '#000000', fieldShading: null, bounds: null,
      graphic: (k) => (refs.get(k) as unknown as CanvasImageSource) ?? null,
    });
  }
  return writer.Emit();
}

/**
 * Printing: every page as an SVG of its size in CSS pixels, painted as for the PDF. `images`
 * holds the graphics' URLs by key.
 */
export function PrintSVG(sh: SwWrtShell, env: SVGEnvironment, images: Map<string, string>): string[] {
  return sh.m_pRoot.pages.map((page, k) => {
    const r = page.aFrame;
    const ctx = new SVGContext(env, `p${k}`);
    PaintPageContent(ctx as unknown as CanvasRenderingContext2D, page, {
      autoColor: '#000000', fieldShading: null, bounds: null,
      graphic: (key) => { const href = images.get(key); return href ? ({ svgHref: href } as unknown as CanvasImageSource) : null; },
    });
    return ctx.Emit([r.Left(), r.Top(), r.Width(), r.Height()], `${r.Width() / TWIPS_PER_CSS_PX}px`, `${r.Height() / TWIPS_PER_CSS_PX}px`);
  });
}
