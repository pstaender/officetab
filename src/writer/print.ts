// Printing paints each page as SVG (vector graphics, with the text as text in the document's
// fonts) into the shell's print-only container and opens the browser's dialog, which can also save a PDF.
import { BrowserBlob } from '@lo/vcl/source/graphic/Manager.ts';
import { DateTimeNow } from '@lo/sfx2/source/doc/SfxDocumentMetaData.ts';
import { PrintImageKey, PrintSVG } from '@lo/sw/source/core/view/vprint.ts';
import { PrintSVGPages, SVGPrintEnvironment } from '@shell/print.ts';
import type { Controller } from './controller.ts';

export { PageSizeCss, SheetHeightCss } from '@shell/print.ts';

export async function printDocument(c: Controller): Promise<void> {
  const root = c.sh.m_pRoot;
  const doc = c.sh.m_pDoc;
  await document.fonts.ready;
  // SfxPrinterController: refresh document info (PrintingModifiesDocument is off: not modified).
  doc.m_xDocProps.setPrintedBy(doc.m_bUseUserData ? c.userFullName : '');
  doc.m_xDocProps.setPrintDate(DateTimeNow());
  // The graphics as blob: URLs for the SVG images.
  const urls = new Map<string, string>();
  for (const [key, g] of doc.m_aGraphics) urls.set(key, URL.createObjectURL(await BrowserBlob(g.data, g.mime)));
  // Graphics with colour attributes print as their modified bitmaps.
  for (const f of doc.GetFlyFormats()) {
    const key = f.asChar?.graphic ?? f.fmt?.graphic, attr = f.asChar?.m_aGrfAttr ?? f.fmt?.m_aGrfAttr;
    const id = key !== undefined ? PrintImageKey(key, attr) : '';
    if (key === undefined || urls.has(id)) continue;
    const blob = await c.graphics.GetPrintBlob(doc, key, attr);
    if (blob) urls.set(id, URL.createObjectURL(blob));
  }
  const svgs = PrintSVG(c.sh, SVGPrintEnvironment(), urls);
  const pages = root.pages.map((page, k) => ({ width: page.aFrame.Width(), height: page.aFrame.Height(), svg: svgs[k]! }));
  await PrintSVGPages(pages, () => urls.forEach((u) => URL.revokeObjectURL(u)));
}
