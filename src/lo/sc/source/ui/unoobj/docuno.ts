// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/unoobj/docuno.cxx partial
// ScModelObj's XRenderable: getRendererCount, getRenderer and render, through which printing and
// the PDF export get the pages of the sheets being printed. The options are a plain object for the
// property sequence (PrintContent: all sheets, selected sheets or selected cells;
// IsSuppressEmptyPages) and the view's selected sheets and marked range for the selection.
// Left out: page ranges ("PageRange", which the browser's print dialog does), even and odd pages,
// single page sheets, rendering a selection to a graphic, the PDF bookmarks, notes, hyperlinks and
// media shapes, the drawing layer, and the print dialog's paper size.
import { ScRange, type SCTAB } from '../../../inc/address.ts';
import { ScMarkData } from '../../../inc/markdata.ts';
import { ScPrintOptions } from '../../../inc/printopt.ts';
import { ScRangeList } from '../../../inc/rangelst.ts';
import type { ScDocShell } from '../docshell/docsh.ts';
import { ScPrintFuncCache, ScPrintSelectionMode, ScPrintSelectionStatus } from '../view/pfuncache.ts';
import { PageRange, ScPrintFunc, ScPrintState } from '../view/printfun.ts';
import type { ScRenderContext } from '../view/output.ts';

/** The render options (rOptions) and the selection (aSelection) of a print job. */
export interface ScRenderOptions {
  /** PrintContent: 0 all sheets, 1 selected sheets, 2 selected cells */
  nPrintContent: 0 | 1 | 2;
  /** IsSuppressEmptyPages */
  bSuppressEmptyPages: boolean;
  /** The view's selected sheets (XSelectedSheetsSupplier). */
  aSelectedTabs: SCTAB[];
  /** The view's selection for "selected cells": the marked range (null: the cursor only). */
  aSelection: ScRange | null;
}

export class ScModelObj {
  private readonly pDocShell: ScDocShell;
  private pPrintFuncCache: ScPrintFuncCache | null = null;
  private m_pPrintState: ScPrintState | null = null;

  constructor(pDocSh: ScDocShell) { this.pDocShell = pDocSh; }

  private FillRenderMarkData(rOptions: ScRenderOptions, rMark: ScMarkData, rStatus: ScPrintSelectionStatus): boolean {
    let bDone = false;

    // "Print Content" selection wins over "Selected Sheets" option
    const bSelectedSheetsOnly = rOptions.nPrintContent !== 0;
    const bSuppressEmptyPages = rOptions.bSuppressEmptyPages;

    if (rOptions.nPrintContent === 2) {
      // the view's selection (ScCellRangesBase)
      const bCursor = !rOptions.aSelection;
      const aSel = rOptions.aSelection ?? new ScRange();
      for (const nTab of rOptions.aSelectedTabs) rMark.SelectTable(nTab, true);
      if (!bCursor) rMark.SetMarkArea(aSel);
      if (bCursor) {
        rMark.ResetMark(); // doesn't change table selection
        rStatus.SetMode(ScPrintSelectionMode.Cursor);
      } else rStatus.SetMode(ScPrintSelectionMode.Range);
      rStatus.SetRanges(new ScRangeList(aSel));
      bDone = true;
    } else {
      //  render the whole document
      //  -> no selection, all sheets
      const nTabCount = this.pDocShell.GetDocument().GetTableCount();
      for (let nTab = 0; nTab < nTabCount; nTab++) rMark.SelectTable(nTab, true);
      rStatus.SetMode(ScPrintSelectionMode.Document);
      bDone = true;
    }

    // restrict to selected sheets if a view is available
    if (bSelectedSheetsOnly) {
      const nMaxTab = this.pDocShell.GetDocument().GetTableCount() - 1;
      rMark.SetSelectedTabs(new Set(rOptions.aSelectedTabs.filter((n) => n >= 0 && n <= nMaxTab)));
    }

    const aNewOptions = new ScPrintOptions();
    aNewOptions.SetSkipEmpty(bSuppressEmptyPages);
    aNewOptions.SetAllSheets(!bSelectedSheetsOnly);
    rStatus.SetOptions(aNewOptions);

    return bDone;
  }

  /** FillRenderMarkData and the cache for the selection; bEmptyFallback: render's printing of empty pages when there are none. */
  private Prepare(rOptions: ScRenderOptions, bEmptyFallback = false): { aMark: ScMarkData; aStatus: ScPrintSelectionStatus } | null {
    const aMark = new ScMarkData(this.pDocShell.GetDocument().GetSheetLimits());
    const aStatus = new ScPrintSelectionStatus();
    if (!this.FillRenderMarkData(rOptions, aMark, aStatus)) return null;
    if (!this.pPrintFuncCache || !this.pPrintFuncCache.IsSameSelection(aStatus)) {
      this.pPrintFuncCache = new ScPrintFuncCache(this.pDocShell, aMark, aStatus);
      this.m_pPrintState = null;
    }
    // if no pages counted then user must be trying to print sheet/selection without any content (i.e empty)
    if (bEmptyFallback && this.pPrintFuncCache.GetPageCount() === 0 && aStatus.GetOptions().GetSkipEmpty()) {
      const aNewOptions = aStatus.GetOptions().clone();
      aNewOptions.SetSkipEmpty(false);
      aStatus.SetOptions(aNewOptions);
      this.pPrintFuncCache = new ScPrintFuncCache(this.pDocShell, aMark, aStatus);
      this.m_pPrintState = null;
    }
    return { aMark, aStatus };
  }

  /** Forgets the counted pages (the document changed). */
  Invalidate(): void {
    this.pPrintFuncCache = null;
    this.m_pPrintState = null;
  }

  getRendererCount(rOptions: ScRenderOptions): number {
    if (!this.Prepare(rOptions)) return 0;
    const nSelectCount = this.pPrintFuncCache!.GetPageCount();
    // an empty selection prints one empty page (render prints empty pages then)
    return nSelectCount > 0 ? nSelectCount : 1;
  }

  /** getRenderer: the page's size in twips (upstream in 1/100 mm). */
  getRenderer(nRenderer: number, rOptions: ScRenderOptions): { Width: number; Height: number } {
    const p = this.Prepare(rOptions, true);
    const nTotalPages = p ? this.pPrintFuncCache!.GetPageCount() : 0;
    if (!p || nRenderer < 0 || nRenderer >= nTotalPages) {
      // getRenderer(0) is used to query the settings, so it must always return something
      const nCurTab = 0; //! use current sheet from view?
      return new ScPrintFunc(null, this.pDocShell, nCurTab).GetPageSize();
    }
    const nTab = this.pPrintFuncCache!.GetTabForPage(nRenderer);
    const pFunc = this.MakeFunc(null, nTab, p.aMark, p.aStatus, nTotalPages);
    const nTabStart = this.pPrintFuncCache!.GetTabStart(nTab);
    pFunc.DoPrint(PageRange(nRenderer + 1), nTabStart, this.pPrintFuncCache!.GetDisplayStart(nTab), false);
    if (!this.m_pPrintState || nRenderer === nTabStart) this.m_pPrintState = pFunc.GetPrintState();
    return pFunc.GetPageSize();
  }

  private MakeFunc(pDev: ScRenderContext | null, nTab: SCTAB, aMark: ScMarkData, aStatus: ScPrintSelectionStatus, nTotalPages: number): ScPrintFunc {
    const pSelRange = aMark.IsMarked() ? aMark.GetMarkArea() : null;
    //  to increase performance, ScPrintState might be used here for subsequent
    //  pages of the same sheet
    let pPrintFunc: ScPrintFunc;
    if (this.m_pPrintState && this.m_pPrintState.nPrintTab === nTab && !pSelRange) // tdf#120161 use selection to set required printed area
      pPrintFunc = new ScPrintFunc(pDev, this.pDocShell, this.m_pPrintState, 0, 0, null, aStatus.GetOptions());
    else pPrintFunc = new ScPrintFunc(pDev, this.pDocShell, nTab, this.pPrintFuncCache!.GetFirstAttr(nTab), nTotalPages, pSelRange, aStatus.GetOptions());
    pPrintFunc.SetRenderFlag(true);
    return pPrintFunc;
  }

  /** render: paints page nRenderer (0-based) on pDev, a device of the page's size in twips. */
  render(nRenderer: number, rOptions: ScRenderOptions, pDev: ScRenderContext): void {
    const p = this.Prepare(rOptions, true);
    if (!p) throw new Error('IllegalArgumentException');
    const nTotalPages = this.pPrintFuncCache!.GetPageCount();
    if (nRenderer < 0 || nRenderer >= nTotalPages) throw new Error('IllegalArgumentException');

    const nTab = this.pPrintFuncCache!.GetTabForPage(nRenderer);
    const nTabStart = this.pPrintFuncCache!.GetTabStart(nTab);

    const pPrintFunc = this.MakeFunc(pDev, nTab, p.aMark, p.aStatus, nTotalPages);
    const nDisplayStart = this.pPrintFuncCache!.GetDisplayStart(nTab);
    pPrintFunc.DoPrint(PageRange(nRenderer + 1), nTabStart, nDisplayStart, true);
    if (!this.m_pPrintState || this.m_pPrintState.nPrintTab !== nTab || nRenderer === nTabStart) this.m_pPrintState = pPrintFunc.GetPrintState();
  }
}
