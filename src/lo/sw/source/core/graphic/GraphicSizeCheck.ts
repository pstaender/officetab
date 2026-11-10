// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/core/graphic/GraphicSizeCheck.cxx reduced
// @upstream sw/source/core/inc/GraphicSizeCheck.hxx reduced
// Images whose pixels are too few or too many for their size at the document's preferred
// resolution. The ModelTraverser is the document's list of flys, and an image's pixel size comes
// from its header (GraphicFormatDetector), so vector images (SVG), whose pixel size upstream takes
// at the screen's resolution, are not checked. The dialog's texts come from the shell (SwResId).
import type { SwDoc } from '../../../inc/doc.ts';
import { DetectGraphic } from '../../../../vcl/source/filter/GraphicFormatDetector.ts';

export class GraphicSizeViolation {
  private m_nLowDPILimit = 0;
  private m_nHighDPILimit = 0;
  private m_nDPIX = 0;
  private m_nDPIY = 0;
  private readonly m_sName: string;
  private readonly m_aSizePixel: { width: number; height: number };
  private readonly m_aFrameSize: { width: number; height: number };

  constructor(nDPI: number, sName: string, aSizePixel: { width: number; height: number }, aFrameSize: { width: number; height: number }) {
    this.m_sName = sName;
    this.m_aSizePixel = aSizePixel;
    this.m_aFrameSize = aFrameSize;
    const fLowPercentage = 110;
    const fHighPercentage = 50;
    this.m_nLowDPILimit = Math.trunc((100.0 / fLowPercentage) * nDPI);
    this.m_nHighDPILimit = Math.trunc((100.0 / fHighPercentage) * nDPI);
  }

  check(): boolean {
    const nSizeXInch = this.m_aFrameSize.width / 1440;
    const nSizeYInch = this.m_aFrameSize.height / 1440;
    this.m_nDPIX = Math.trunc(this.m_aSizePixel.width / nSizeXInch);
    this.m_nDPIY = Math.trunc(this.m_aSizePixel.height / nSizeYInch);
    return this.isDPITooLow() || this.isDPITooHigh();
  }

  getGraphicName(): string { return this.m_sName; }
  isDPITooLow(): boolean { return this.m_nDPIX < this.m_nLowDPILimit || this.m_nDPIY < this.m_nLowDPILimit; }
  isDPITooHigh(): boolean { return this.m_nDPIX > this.m_nHighDPILimit || this.m_nDPIY > this.m_nHighDPILimit; }
  getDPIX(): number { return this.m_nDPIX; }
  getDPIY(): number { return this.m_nDPIY; }
}

export class GraphicSizeCheck {
  private m_aGraphicSizeViolationList: GraphicSizeViolation[] = [];
  private readonly m_pDocument: SwDoc;

  constructor(pDocument: SwDoc) { this.m_pDocument = pDocument; }

  check(): void {
    const nDPI = this.m_pDocument.m_nImagePreferredDPI;
    if (nDPI === 0) return;
    // GraphicSizeCheckHandler::handleNode: each graphic node.
    for (const f of this.m_pDocument.GetFlyFormats()) {
      const key = f.asChar?.graphic ?? f.fmt?.graphic;
      const g = key !== undefined ? this.m_pDocument.m_aGraphics.get(key) : undefined;
      const m = g ? DetectGraphic(g.data) : null;
      if (!m || !m.mnPixWidth || !m.mnPixHeight) continue;
      const aFrameSize = f.asChar ? { width: f.asChar.width, height: f.asChar.height } : { width: f.fmt!.m_nWidth, height: f.fmt!.m_nHeight };
      if (!aFrameSize.width || !aFrameSize.height) continue;
      const pEntry = new GraphicSizeViolation(nDPI, f.name, { width: m.mnPixWidth, height: m.mnPixHeight }, aFrameSize);
      if (pEntry.check()) this.m_aGraphicSizeViolationList.push(pEntry);
    }
  }

  getViolationList(): GraphicSizeViolation[] { return this.m_aGraphicSizeViolationList; }
}

/** GraphicSizeCheckGUIEntry::getText, with the low and high texts (STR_WARNING_GRAPHIC_PIXEL_COUNT_*). */
export function GraphicSizeCheckGUIEntryText(v: GraphicSizeViolation, sLow: string, sHigh: string): string {
  let sText = '';
  if (v.isDPITooLow()) sText = sLow;
  else if (v.isDPITooHigh()) sText = sHigh;
  return sText.replaceAll('%NAME%', v.getGraphicName()).replaceAll('%DPIX%', String(v.getDPIX())).replaceAll('%DPIY%', String(v.getDPIY()));
}

/** GraphicSizeCheckGUIResult: the violations of the document. */
export function GraphicSizeCheckGUIResult(pDocument: SwDoc): GraphicSizeViolation[] {
  const aCheck = new GraphicSizeCheck(pDocument);
  aCheck.check();
  return aCheck.getViolationList();
}
