// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/inc/pfuncache.hxx reduced
// @upstream sc/source/ui/view/pfuncache.cxx reduced
// ScPrintFuncCache: the page counts of the sheets being printed (and the first page numbers),
// counted once with ScPrintFunc and kept while every page is rendered. The page locations used
// for hyperlink targets in PDF (InitLocations, FindLocation) are left out.
import type { ScRange, SCTAB } from '../../../inc/address.ts';
import type { ScMarkData } from '../../../inc/markdata.ts';
import { ScPrintOptions } from '../../../inc/printopt.ts';
import { ScRangeList } from '../../../inc/rangelst.ts';
import type { ScDocShell } from '../docshell/docsh.ts';
import { ScPrintFunc } from './printfun.ts';

export const ScPrintSelectionMode = { Invalid: 0, Document: 1, Cursor: 2, Range: 3, RangeExclusivelyOleAndDrawObjects: 4 } as const;
export type ScPrintSelectionMode = (typeof ScPrintSelectionMode)[keyof typeof ScPrintSelectionMode];

/** Stores the selection in the ScPrintFuncCache so it is only used for the same selection again. */
export class ScPrintSelectionStatus {
  private eMode: ScPrintSelectionMode = ScPrintSelectionMode.Invalid;
  private aRanges = new ScRangeList();
  private aOptions = new ScPrintOptions();

  SetMode(eNew: ScPrintSelectionMode): void { this.eMode = eNew; }
  SetRanges(rNew: ScRangeList): void { this.aRanges = rNew; }
  SetOptions(rNew: ScPrintOptions): void { this.aOptions = rNew.clone(); }
  equals(rOther: ScPrintSelectionStatus): boolean { return this.eMode === rOther.eMode && this.aRanges.equals(rOther.aRanges) && this.aOptions.equals(rOther.aOptions); }
  GetMode(): ScPrintSelectionMode { return this.eMode; }
  GetOptions(): ScPrintOptions { return this.aOptions; }
}

/** Stores the data for printing that is needed from several sheets, so it doesn't have to be calculated for rendering each page. */
export class ScPrintFuncCache {
  private readonly aSelection: ScPrintSelectionStatus;
  private readonly rDocSh: ScDocShell;
  private nTotalPages = 0;
  private readonly nPages: number[] = [];
  private readonly nFirstAttr: number[] = [];

  constructor(rShell: ScDocShell, rMark: ScMarkData, aStatus: ScPrintSelectionStatus) {
    this.aSelection = aStatus;
    this.rDocSh = rShell;

    let pSelRange: ScRange | null = null;
    if (rMark.IsMarked()) pSelRange = rMark.GetMarkArea();

    const rDoc = this.rDocSh.GetDocument();
    const nTabCount = rDoc.GetTableCount();

    for (let nTab = 0; nTab < nTabCount; nTab++) {
      const nAttrPage = nTab > 0 ? this.nFirstAttr[nTab - 1]! : 1;

      let nThisTab = 0;
      if (rMark.GetTableSelect(nTab)) {
        const aFunc = new ScPrintFunc(null, this.rDocSh, nTab, nAttrPage, 0, pSelRange, this.aSelection.GetOptions());
        nThisTab = aFunc.GetTotalPages();
        this.nFirstAttr.push(aFunc.GetFirstPageNo()); // from page style or previous sheet
      } else this.nFirstAttr.push(nAttrPage);

      this.nPages.push(nThisTab);
      this.nTotalPages += nThisTab;
    }
  }

  IsSameSelection(rStatus: ScPrintSelectionStatus): boolean { return this.aSelection.equals(rStatus); }

  GetPageCount(): number { return this.nTotalPages; }
  GetFirstAttr(nTab: SCTAB): number { return this.nFirstAttr[nTab]!; }

  GetTabForPage(nPage: number): SCTAB {
    const rDoc = this.rDocSh.GetDocument();
    const nTabCount = rDoc.GetTableCount();
    let nTab = 0;
    while (nTab < nTabCount && nPage >= this.nPages[nTab]!) nPage -= this.nPages[nTab++]!;
    if (nTab >= nTabCount) nTab = nTabCount - 1;
    return nTab;
  }

  GetTabStart(nTab: SCTAB): number {
    let nRet = 0;
    const maxIndex = Math.min(nTab, this.nPages.length);
    for (let i = 0; i < maxIndex; i++) nRet += this.nPages[i]!;
    return nRet;
  }

  GetDisplayStart(nTab: SCTAB): number {
    //! merge with lcl_GetDisplayStart in preview?

    let nDisplayStart = 0;
    const rDoc = this.rDocSh.GetDocument();
    for (let i = 0; i < nTab; i++) {
      if (rDoc.NeedPageResetAfterTab(i)) nDisplayStart = 0;
      else if (i < this.nPages.length) nDisplayStart += this.nPages[i]!;
    }
    return nDisplayStart;
  }
}
