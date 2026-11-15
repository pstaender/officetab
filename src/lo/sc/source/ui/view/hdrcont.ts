// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/inc/hdrcont.hxx reduced
// @upstream sc/source/ui/view/hdrcont.cxx reduced
// ScHeaderControl: the column and row headers of a pane: the column letters or row numbers in
// boxes the size of the columns and rows, the selected ones highlighted (the cursor's in bold
// accent), and where the pointer is over an edge that resizes (GetMousePos). Painted on a
// CanvasRenderingContext2D-shaped context in pixels. The mouse handling (selecting, dragging the
// edge with its help text, the context menu) is the web shell's; outline symbols and the
// automatic width of the row header for long numbers are left out (the row header's width
// follows the largest visible row number).
import { ScColToAlpha, type SCCOLROW, type SCTAB } from '../../../inc/address.ts';
import type { ScRenderContext } from './output.ts';
import type { ScViewData, ScHSplitPos, ScVSplitPos } from './viewdata.ts';
import { ScViewData as ScViewDataClass } from './viewdata.ts';

/** The colours of the headers (the style settings and CALCCELLFOCUS of the colour configuration). */
export interface ScHeaderColors {
  face: string;
  text: string;
  line: string;
  /** a selected column or row */
  selFace: string;
  selText: string;
  /** a column or row selected entirely */
  fullFace: string;
  fullText: string;
  /** the line under/right of a selected header */
  selLine: string;
}

export const DEFAULT_HEADER_COLORS: ScHeaderColors = {
  face: '#f8f8f8', text: '#333333', line: '#c8c8c8',
  selFace: '#dde8f5', selText: '#1a1a1a', fullFace: '#a6c3e8', fullText: '#000000', selLine: '#2a6bc9',
};

/** The header font size in pixels at 100% (the application font). */
export const HEADER_FONT_PX = 12;

export class ScHeaderControl {
  readonly bVertical: boolean;
  private readonly pViewData: ScViewData;
  /** The pane the header belongs to. */
  private readonly eWhich: ScHSplitPos | ScVSplitPos;

  constructor(pViewData: ScViewData, bVertical: boolean, eWhich: ScHSplitPos | ScVSplitPos) {
    this.pViewData = pViewData;
    this.bVertical = bVertical;
    this.eWhich = eWhich;
  }

  GetPos(): SCCOLROW { return this.bVertical ? this.pViewData.GetPosY(this.eWhich as ScVSplitPos) : this.pViewData.GetPosX(this.eWhich as ScHSplitPos); }
  GetEntrySize(nEntryNo: SCCOLROW): number {
    const rDoc = this.pViewData.GetDocument();
    const nTab: SCTAB = this.pViewData.CurrentTabForData();
    return this.bVertical
      ? ScViewDataClass.ToPixel(rDoc.GetRowHeight(nEntryNo, nTab), this.pViewData.GetPPTY())
      : ScViewDataClass.ToPixel(rDoc.GetColWidth(nEntryNo, nTab), this.pViewData.GetPPTX());
  }
  GetEntryText(nEntryNo: SCCOLROW): string { return this.bVertical ? String(nEntryNo + 1) : ScColToAlpha(nEntryNo); }
  /** The last column or row. */
  private GetMax(): SCCOLROW { const d = this.pViewData.GetDocument(); return this.bVertical ? d.MaxRow() : d.MaxCol(); }

  /** Whether an entry is selected (in the marked ranges or the cursor's), and whether entirely. */
  private GetMarkState(nEntryNo: SCCOLROW): { bSel: boolean; bFull: boolean } {
    const v = this.pViewData;
    const rMark = v.GetMarkData();
    const d = v.GetDocument();
    let bSel = false, bFull = false;
    for (const r of v.GetMultiArea()) {
      const a = this.bVertical ? r.aStart.Row() : r.aStart.Col(), b = this.bVertical ? r.aEnd.Row() : r.aEnd.Col();
      if (nEntryNo < a || nEntryNo > b) continue;
      bSel = true;
      if (this.bVertical ? r.aStart.Col() === 0 && r.aEnd.Col() === d.MaxCol() : r.aStart.Row() === 0 && r.aEnd.Row() === d.MaxRow()) bFull = true;
    }
    void rMark;
    return { bSel, bFull };
  }

  /**
   * Paint: the header from a pixel position of the canvas, nSize pixels long (the pane's width or
   * height) and nBreadth across.
   */
  Paint(ctx: ScRenderContext, nX: number, nY: number, nSize: number, nBreadth: number, c: ScHeaderColors = DEFAULT_HEADER_COLORS, nZoom = 1): void {
    ctx.save();
    ctx.beginPath();
    if (this.bVertical) ctx.rect(nX, nY, nBreadth, nSize);
    else ctx.rect(nX, nY, nSize, nBreadth);
    ctx.clip();
    ctx.fillStyle = c.face;
    if (this.bVertical) ctx.fillRect(nX, nY, nBreadth, nSize);
    else ctx.fillRect(nX, nY, nSize, nBreadth);

    const nFontPx = Math.max(8, Math.round(HEADER_FONT_PX * Math.min(1.6, Math.max(0.6, nZoom))));
    ctx.font = `${nFontPx}px system-ui, sans-serif`;
    let nPos = 0;
    const nMax = this.GetMax();
    for (let nEntry = this.GetPos(); nEntry <= nMax && nPos < nSize; nEntry++) {
      const nEntrySize = this.GetEntrySize(nEntry);
      if (!nEntrySize) continue;
      const { bSel, bFull } = this.GetMarkState(nEntry);
      const x = this.bVertical ? nX : nX + nPos, y = this.bVertical ? nY + nPos : nY;
      const w = this.bVertical ? nBreadth : nEntrySize, h = this.bVertical ? nEntrySize : nBreadth;
      if (bSel) {
        ctx.fillStyle = bFull ? c.fullFace : c.selFace;
        ctx.fillRect(x, y, w, h);
      }
      // the separating line at the end of the entry
      ctx.fillStyle = c.line;
      if (this.bVertical) ctx.fillRect(x, y + h - 1, w, 1);
      else ctx.fillRect(x + w - 1, y, 1, h);
      if (bSel) {
        ctx.fillStyle = c.selLine;
        if (this.bVertical) ctx.fillRect(x + w - 2, y, 2, h);
        else ctx.fillRect(x, y + h - 2, w, 2);
      }
      const aText = this.GetEntryText(nEntry);
      ctx.fillStyle = bFull ? c.fullText : bSel ? c.selText : c.text;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w - 1, h - 1);
      ctx.clip();
      // centred: the canvas's measure is not available on every context, so estimate the width
      const nTextW = aText.length * nFontPx * 0.58;
      ctx.fillText(aText, x + (w - nTextW) / 2, y + h / 2 + nFontPx * 0.36);
      ctx.restore();
      nPos += nEntrySize;
    }
    // the line between header and cells
    ctx.fillStyle = c.line;
    if (this.bVertical) ctx.fillRect(nX + nBreadth - 1, nY, 1, nSize);
    else ctx.fillRect(nX, nY + nBreadth - 1, nSize, 1);
    ctx.restore();
  }

  /**
   * GetMousePos: the entry at a pixel position along the header (0 = the pane's start), and
   * whether it is on the entry's end edge (within 2 pixels, bBorder) to resize it.
   */
  GetMousePos(nMouse: number): { nEntry: SCCOLROW; bBorder: boolean } {
    let nPos = 0;
    const nMax = this.GetMax();
    let nHitNo = this.GetPos();
    for (let nEntry = this.GetPos(); nEntry <= nMax; nEntry++) {
      const nSize = this.GetEntrySize(nEntry);
      if (nSize) {
        const nEnd = nPos + nSize - 1;
        if (Math.abs(nMouse - nEnd) <= 2) return { nEntry, bBorder: true };
        if (nMouse <= nEnd) return { nEntry, bBorder: false };
        nPos += nSize;
        nHitNo = nEntry;
      } else if (Math.abs(nMouse - (nPos - 1)) <= 2 && nEntry > 0) {
        // a hidden entry right after the visible one: the edge shows it again
        return { nEntry: nHitNo, bBorder: true };
      }
      if (nPos > nMouse + 10) break;
    }
    return { nEntry: nHitNo, bBorder: false };
  }

  /** The pixel position of an entry's start along the header. */
  GetScrPos(nEntryNo: SCCOLROW): number {
    let nPos = 0;
    for (let n = this.GetPos(); n < nEntryNo; n++) nPos += this.GetEntrySize(n);
    return nPos;
  }
}
