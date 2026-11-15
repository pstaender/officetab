// Printing and PDF export of spreadsheets: ScModelObj's renderer (docuno) paints each page of
// the sheets being printed through ScPrintFunc onto an SVG page, which the shell's print container
// shows to the browser's print dialog, or onto a page of the PDF writer.
import { DateTimeNow } from '@lo/sfx2/source/doc/SfxDocumentMetaData.ts';
import { SVGContext } from '@lo/filter/source/svg/svgwriter.ts';
import { PDFWriterImpl } from '@lo/vcl/source/pdf/pdfwriter_impl.ts';
import { ScModelObj, type ScRenderOptions } from '@lo/sc/source/ui/unoobj/docuno.ts';
import type { ScRenderContext } from '@lo/sc/source/ui/view/output.ts';
import { ScMarkType } from '@lo/sc/source/ui/view/viewdata.ts';
import { PDFExportEnvironment, PrintSVGPages, SVGPrintEnvironment, type PrintPage } from '@shell/print.ts';
import type { Controller } from './controller.ts';

/** What to print: Calc's print options of the print dialog (ScPrintUIOptions). */
export interface CalcPrintChoice {
  /** 0 all sheets, 1 selected sheets, 2 selected cells */
  content: 0 | 1 | 2;
  /** Suppress output of empty pages */
  suppressEmpty: boolean;
}

/** The render options for the view: its selected sheets and, for selected cells, its marked range. */
export function RenderOptions(c: Controller, choice: CalcPrintChoice): ScRenderOptions {
  const vd = c.view.GetViewData();
  const rMark = vd.GetMarkData();
  const aSelectedTabs = rMark.GetSelectCount() ? [...rMark.GetSelectedTabs()] : [vd.GetTabNo()];
  const { eMarkType, rRange } = vd.GetSimpleArea();
  const bMarked = eMarkType !== ScMarkType.SC_MARK_NONE;
  return { nPrintContent: choice.content, bSuppressEmptyPages: choice.suppressEmpty, aSelectedTabs, aSelection: bMarked ? rRange.clone() : null };
}

/** The page's file name fields show the document's file name; printing refreshes the document info. */
function PreparePrint(c: Controller): void {
  c.sh.SetTitle(c.handle?.name ?? c.name);
  c.sh.GetDocument().SetRefDevice(c.measurer);
  // SfxPrinterController: refresh document info (PrintingModifiesDocument is off: not modified).
  c.sh.m_xDocProps.setPrintedBy(c.sh.m_bUseUserData ? c.userFullName : '');
  c.sh.m_xDocProps.setPrintDate(DateTimeNow());
}

/** The pages as SVG documents, each of its size in twips. */
export function RenderSVGPages(c: Controller, options: ScRenderOptions): PrintPage[] {
  const model = new ScModelObj(c.sh);
  const env = SVGPrintEnvironment();
  const n = model.getRendererCount(options);
  const pages: PrintPage[] = [];
  for (let k = 0; k < n; k++) {
    const { Width: w, Height: h } = model.getRenderer(k, options);
    const ctx = new SVGContext(env, `p${k}`);
    model.render(k, options, ctx as unknown as ScRenderContext);
    pages.push({ width: w, height: h, svg: ctx.Emit([0, 0, w, h], `${w / 15}px`, `${h / 15}px`) });
  }
  return pages;
}

/** File > Print: the pages in the browser's print dialog. */
export async function PrintDocument(c: Controller, choice: CalcPrintChoice): Promise<void> {
  if (c.edit) c.commitEdit('none');
  await document.fonts.ready;
  PreparePrint(c);
  const pages = RenderSVGPages(c, RenderOptions(c, choice));
  if (!pages.length) { c.setMessage('There is nothing to print.'); return; }
  await PrintSVGPages(pages);
}

/** File > Export as PDF: the pages through the PDF writer. */
export async function ExportPDF(c: Controller, choice: CalcPrintChoice): Promise<Uint8Array> {
  if (c.edit) c.commitEdit('none');
  await document.fonts.ready;
  PreparePrint(c);
  const options = RenderOptions(c, choice);
  const model = new ScModelObj(c.sh);
  const writer = new PDFWriterImpl(PDFExportEnvironment(), c.sh.m_xDocProps.getTitle() || c.name);
  const n = model.getRendererCount(options);
  for (let k = 0; k < n; k++) {
    const { Width: w, Height: h } = model.getRenderer(k, options);
    const ctx = writer.NewPage(w, h, 0, 0);
    model.render(k, options, ctx as unknown as ScRenderContext);
  }
  return writer.Emit();
}
