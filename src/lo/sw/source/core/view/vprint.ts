// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/core/view/vprint.cxx reduced
// SwViewShell::PrintOrPDFExport: every page is painted, without screen decorations, into the output.
import { PDFWriterImpl, type PDFEnvironment, type PDFImage } from '../../../../vcl/source/pdf/pdfwriter_impl.ts';
import { PaintPageContent } from './paint.ts';
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
