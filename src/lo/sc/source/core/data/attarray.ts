// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/attarray.hxx reduced
// @upstream sc/source/core/data/attarray.cxx reduced
// ScAttrArray: the patterns of one column as runs of rows (ScAttrEntry: last row and pattern),
// always covering rows 0 to MaxRow. Kept: Search, GetPattern(Range), SetPatternArea with merging
// of equal neighbours, ApplyStyleArea, ApplyCacheArea (put items), ClearItems, ApplyFlags /
// RemoveFlags of the merge flags, InsertRow, DeleteRow, DeleteArea, CopyArea, HasAttrib, and
// GetLastVisibleAttr, HasVisibleAttrIn and IsVisibleEqual for the print area.
// Left out: the borders' line-by-line application (ApplyBlockFrame), conditional formats and
// the per-row optimisations for the default pattern.
import { HasAttrFlags } from '../../../inc/global.ts';
import type { ScPatternAttr } from '../../../inc/patattr.ts';
import { ScMF, type ScItemId, type ScItemSet } from '../../../inc/scitems.ts';
import type { ScStyleSheet } from '../../../inc/stlsheet.ts';
import type { CellAttributeHelper } from '../../../inc/patattr.ts';

/** Rows of equal attributes below the data that end the print area (SC_VISATTR_STOP). */
const SC_VISATTR_STOP = 84;

export interface ScAttrEntry { nEndRow: number; pPattern: ScPatternAttr }

export class ScAttrArray {
  private mvData: ScAttrEntry[];
  private readonly mnMaxRow: number;
  private readonly mrHelper: CellAttributeHelper;

  constructor(nMaxRow: number, rHelper: CellAttributeHelper) {
    this.mnMaxRow = nMaxRow;
    this.mrHelper = rHelper;
    this.mvData = [{ nEndRow: nMaxRow, pPattern: rHelper.getDefaultCellAttribute() }];
  }

  /** The entries (for iterating and copying). */
  GetEntries(): readonly ScAttrEntry[] { return this.mvData; }
  Count(): number { return this.mvData.length; }

  /** The index of the entry containing nRow. */
  Search(nRow: number): number {
    let lo = 0, hi = this.mvData.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.mvData[mid]!.nEndRow < nRow) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  GetPattern(nRow: number): ScPatternAttr { return this.mvData[this.Search(nRow)]!.pPattern; }

  /** The pattern of nRow and the rows it covers. */
  GetPatternRange(nRow: number): { pPattern: ScPatternAttr; nStartRow: number; nEndRow: number } {
    const i = this.Search(nRow);
    return { pPattern: this.mvData[i]!.pPattern, nStartRow: i > 0 ? this.mvData[i - 1]!.nEndRow + 1 : 0, nEndRow: this.mvData[i]!.nEndRow };
  }

  /** Set a (registered) pattern on rows nStartRow..nEndRow. */
  SetPatternArea(nStartRow: number, nEndRow: number, pPattern: ScPatternAttr): void {
    if (nStartRow > nEndRow || nStartRow < 0 || nEndRow > this.mnMaxRow) return;
    pPattern = this.mrHelper.registerAndCheck(pPattern);
    const out: ScAttrEntry[] = [];
    const push = (nEnd: number, p: ScPatternAttr) => {
      const last = out[out.length - 1];
      if (last && last.pPattern === p) last.nEndRow = nEnd;
      else out.push({ nEndRow: nEnd, pPattern: p });
    };
    let nStart = 0;
    let bInserted = false;
    for (const e of this.mvData) {
      // part before the area
      if (nStart < nStartRow) push(Math.min(e.nEndRow, nStartRow - 1), e.pPattern);
      // the area
      if (!bInserted && e.nEndRow >= nStartRow) {
        push(nEndRow, pPattern);
        bInserted = true;
      }
      // part after the area
      if (e.nEndRow > nEndRow) push(e.nEndRow, e.pPattern);
      nStart = e.nEndRow + 1;
    }
    this.mvData = out;
  }

  /** Set the pattern of one row. */
  SetPattern(nRow: number, pPattern: ScPatternAttr): void { this.SetPatternArea(nRow, nRow, pPattern); }

  /** Apply a function to the patterns of rows nStartRow..nEndRow (the pattern of each run is
      replaced by the function's result). */
  ModifyArea(nStartRow: number, nEndRow: number, f: (p: ScPatternAttr) => ScPatternAttr): void {
    if (nStartRow > nEndRow) return;
    let nRow = nStartRow;
    while (nRow <= nEndRow) {
      const { pPattern, nEndRow: nRunEnd } = this.GetPatternRange(nRow);
      const nEnd = Math.min(nRunEnd, nEndRow);
      const pNew = f(pPattern);
      if (pNew !== pPattern && !pNew.equals(pPattern)) this.SetPatternArea(nRow, nEnd, pNew);
      nRow = nEnd + 1;
    }
  }

  /** Put the items on rows nStartRow..nEndRow (ApplyCacheArea with an item set). */
  ApplyCacheArea(nStartRow: number, nEndRow: number, rItems: ScItemSet): void {
    this.ModifyArea(nStartRow, nEndRow, (p) => p.PutItems(rItems));
  }

  /** Apply a cell style to rows nStartRow..nEndRow; hard attributes the style sets are cleared. */
  ApplyStyleArea(nStartRow: number, nEndRow: number, rStyle: ScStyleSheet): void {
    this.ModifyArea(nStartRow, nEndRow, (p) => p.SetStyleSheet(rStyle));
  }

  /** Remove hard attributes (ClearItems) on rows nStartRow..nEndRow. */
  ClearItems(nStartRow: number, nEndRow: number, aWhich: readonly ScItemId[]): void {
    this.ModifyArea(nStartRow, nEndRow, (p) => p.ClearItems(aWhich));
  }

  /** Remove all hard attributes on rows nStartRow..nEndRow, keeping the style. */
  DeleteHardAttr(nStartRow: number, nEndRow: number): void {
    this.ModifyArea(nStartRow, nEndRow, (p) => {
      // Merge attributes survive the deletion of hard attributes (ScAttrArray::DeleteHardAttr).
      const keep: ScItemSet = {};
      const s = p.GetItemSet();
      if (s.ATTR_MERGE !== undefined) keep.ATTR_MERGE = s.ATTR_MERGE;
      if (s.ATTR_MERGE_FLAG !== undefined) keep.ATTR_MERGE_FLAG = s.ATTR_MERGE_FLAG;
      return this.mrHelper.getDefaultCellAttribute().SetStyleSheet(p.GetStyleSheet(), false).PutItems(keep);
    });
  }

  /** Set merge flags (ScMF) on rows nStartRow..nEndRow. */
  ApplyFlags(nStartRow: number, nEndRow: number, nFlags: ScMF): boolean {
    let bChanged = false;
    this.ModifyArea(nStartRow, nEndRow, (p) => {
      const nOld = p.GetItem('ATTR_MERGE_FLAG');
      if ((nOld | nFlags) === nOld) return p;
      bChanged = true;
      return p.PutItems({ ATTR_MERGE_FLAG: nOld | nFlags });
    });
    return bChanged;
  }

  /** Remove merge flags (ScMF) on rows nStartRow..nEndRow. */
  RemoveFlags(nStartRow: number, nEndRow: number, nFlags: ScMF): boolean {
    let bChanged = false;
    this.ModifyArea(nStartRow, nEndRow, (p) => {
      const nOld = p.GetItem('ATTR_MERGE_FLAG');
      if ((nOld & ~nFlags) === nOld) return p;
      bChanged = true;
      return p.PutItems({ ATTR_MERGE_FLAG: nOld & ~nFlags });
    });
    return bChanged;
  }

  /** Whether any row of the range has one of the attributes (HasAttrib). */
  HasAttrib(nRow1: number, nRow2: number, nMask: HasAttrFlags): boolean {
    let nRow = nRow1;
    while (nRow <= nRow2) {
      const { pPattern, nEndRow } = this.GetPatternRange(nRow);
      if (nMask & HasAttrFlags.Merged && pPattern.IsMerged()) return true;
      if (nMask & HasAttrFlags.Overlapped && pPattern.IsOverlapped()) return true;
      if (nMask & HasAttrFlags.Lines) {
        const b = pPattern.GetItem('ATTR_BORDER');
        if (b.top || b.bottom || b.left || b.right) return true;
      }
      if (nMask & HasAttrFlags.Protected && pPattern.GetItem('ATTR_PROTECTION').bProtection) return true;
      if (nMask & HasAttrFlags.Rotate && pPattern.GetItem('ATTR_ROTATE_VALUE') !== 0) return true;
      if (nMask & HasAttrFlags.NeedHeight && (pPattern.GetItem('ATTR_LINEBREAK') || pPattern.GetItem('ATTR_ROTATE_VALUE') !== 0 || pPattern.GetItem('ATTR_STACKED'))) return true;
      if (nMask & HasAttrFlags.RightOrCenter) {
        const j = pPattern.GetItem('ATTR_HOR_JUSTIFY');
        if (j === 'Right' || j === 'Center') return true;
      }
      if (nMask & HasAttrFlags.AutoFilter && pPattern.GetItem('ATTR_MERGE_FLAG') & ScMF.Auto) return true;
      nRow = nEndRow + 1;
    }
    return false;
  }

  /** Insert nSize rows at nStartRow; they get the pattern of the row above (without merge). */
  InsertRow(nStartRow: number, nSize: number): void {
    if (nSize <= 0) return;
    const pAbove = nStartRow > 0 ? this.GetPattern(nStartRow - 1) : this.GetPattern(nStartRow);
    // shift entries
    for (const e of this.mvData) if (e.nEndRow >= nStartRow) e.nEndRow = Math.min(e.nEndRow + nSize, this.mnMaxRow);
    // Remove entries that start after MaxRow now.
    this.Compact();
    // The inserted rows take the attributes of the row above, without merge attributes.
    let pNew = pAbove;
    if (pAbove.IsMerged() || pAbove.IsOverlapped()) pNew = pAbove.ClearItems(['ATTR_MERGE', 'ATTR_MERGE_FLAG']);
    this.SetPatternArea(nStartRow, Math.min(nStartRow + nSize - 1, this.mnMaxRow), pNew);
  }

  /** Delete nSize rows at nStartRow; the last rows get the default pattern. */
  DeleteRow(nStartRow: number, nSize: number): void {
    if (nSize <= 0) return;
    const nEndRow = nStartRow + nSize - 1;
    const out: ScAttrEntry[] = [];
    let nStart = 0;
    for (const e of this.mvData) {
      const s = nStart, en = e.nEndRow;
      nStart = en + 1;
      // the part before the deleted rows
      if (s < nStartRow) out.push({ nEndRow: Math.min(en, nStartRow - 1), pPattern: e.pPattern });
      // the part after the deleted rows, shifted up
      if (en > nEndRow) out.push({ nEndRow: en - nSize, pPattern: e.pPattern });
    }
    this.mvData = out;
    this.Compact();
    const nLast = this.mvData[this.mvData.length - 1]!.nEndRow;
    if (nLast < this.mnMaxRow) this.mvData.push({ nEndRow: this.mnMaxRow, pPattern: this.mrHelper.getDefaultCellAttribute() });
    this.Compact();
  }

  /** Set the default pattern on rows nStartRow..nEndRow. */
  DeleteArea(nStartRow: number, nEndRow: number): void {
    this.SetPatternArea(nStartRow, nEndRow, this.mrHelper.getDefaultCellAttribute());
  }

  /** Merge equal neighbours and drop entries beyond MaxRow. */
  private Compact(): void {
    const out: ScAttrEntry[] = [];
    let nPrevEnd = -1;
    for (const e of this.mvData) {
      if (e.nEndRow <= nPrevEnd) continue;
      const last = out[out.length - 1];
      if (last && last.pPattern === e.pPattern) last.nEndRow = e.nEndRow;
      else out.push({ nEndRow: e.nEndRow, pPattern: e.pPattern });
      nPrevEnd = e.nEndRow;
    }
    if (!out.length || out[out.length - 1]!.nEndRow < this.mnMaxRow) {
      const last = out[out.length - 1];
      if (last) last.nEndRow = this.mnMaxRow;
    }
    this.mvData = out;
  }

  /** The patterns of rows nStartRow..nEndRow as runs relative to nStartRow (for copying). */
  CopyArea(nStartRow: number, nEndRow: number): { nStart: number; nEnd: number; pPattern: ScPatternAttr }[] {
    const out: { nStart: number; nEnd: number; pPattern: ScPatternAttr }[] = [];
    let nRow = nStartRow;
    while (nRow <= nEndRow) {
      const { pPattern, nEndRow: nRunEnd } = this.GetPatternRange(nRow);
      const nEnd = Math.min(nRunEnd, nEndRow);
      out.push({ nStart: nRow - nStartRow, nEnd: nEnd - nStartRow, pPattern });
      nRow = nEnd + 1;
    }
    return out;
  }

  /** The last row whose pattern differs from the default (GetLastVisibleAttr, reduced). */
  GetLastAttrRow(): number {
    const pDef = this.mrHelper.getDefaultCellAttribute();
    for (let i = this.mvData.length - 1; i >= 0; i--) {
      if (this.mvData[i]!.pPattern !== pDef) return this.mvData[i]!.nEndRow === this.mnMaxRow && i > 0 ? this.mnMaxRow : this.mvData[i]!.nEndRow;
    }
    return -1;
  }

  /**
   * GetLastVisibleAttr: the last row of visible attributes below the last data row nLastData,
   * ignoring everything from the first run of SC_VISATTR_STOP visually equal rows (#i30830#).
   */
  GetLastVisibleAttr(nLastData: number, bSkipEmpty: boolean): { bFound: boolean; rLastRow: number } {
    const mvData = this.mvData;
    if (!mvData.length) return { bFound: false, rLastRow: nLastData };

    //  #i30830# changed behavior:
    //  ignore all attributes starting with the first run of SC_VISATTR_STOP equal rows
    //  below the last content cell

    if (nLastData === this.mnMaxRow) return { bFound: true, rLastRow: this.mnMaxRow }; // can't look for attributes below MaxRow()

    // Quick check: last data row in or immediately preceding a run that is the
    // last attribution down to the end, e.g. default style or column style.
    let nPos = mvData.length - 1;
    const nStartRow = nPos ? mvData[nPos - 1]!.nEndRow + 1 : 0;
    if (nStartRow <= nLastData + 1) {
      // Ignore here a few rows if data happens to end within
      // SC_VISATTR_STOP rows before MaxRow().
      return { bFound: false, rLastRow: nLastData };
    }
    // tdf#93315: If "Suppress output of empty pages" in Calc Options is not checked, show empty
    // (containing only empty data cells) page in the document
    let bFound = false;
    let rLastRow = nLastData;
    if (bSkipEmpty) {
      nPos = this.Search(nLastData);
      while (nPos < mvData.length) {
        // find range of visually equal formats
        let nEndPos = nPos;
        while (nEndPos < mvData.length - 1 && mvData[nEndPos]!.pPattern.IsVisibleEqual(mvData[nEndPos + 1]!.pPattern)) ++nEndPos;
        let nAttrStartRow = nPos > 0 ? mvData[nPos - 1]!.nEndRow + 1 : 0;
        if (nAttrStartRow <= nLastData) nAttrStartRow = nLastData + 1;
        const nAttrSize = mvData[nEndPos]!.nEndRow + 1 - nAttrStartRow;
        if (nAttrSize >= SC_VISATTR_STOP) break; // while, ignore this range and below
        else if (mvData[nEndPos]!.pPattern.IsVisible()) {
          rLastRow = mvData[nEndPos]!.nEndRow;
          bFound = true;
        }
        nPos = nEndPos + 1;
      }
    } else {
      if ((nPos > 0 && mvData[nPos - 1]!.pPattern.IsVisible()) || (nPos > 1 && !mvData[nPos - 1]!.pPattern.IsVisibleEqual(mvData[nPos - 2]!.pPattern))) {
        return { bFound: true, rLastRow: mvData[nPos - 1]!.nEndRow };
      }
      rLastRow = nLastData;
    }
    return { bFound, rLastRow };
  }

  /** HasVisibleAttrIn: whether a row of nStartRow..nEndRow has a visible attribute. */
  HasVisibleAttrIn(nStartRow: number, nEndRow: number): boolean {
    let nIndex = this.Search(nStartRow);
    let nThisStart = nStartRow;
    let bFound = false;
    while (nIndex < this.mvData.length && nThisStart <= nEndRow && !bFound) {
      if (this.mvData[nIndex]!.pPattern.IsVisible()) bFound = true;
      nThisStart = this.mvData[nIndex]!.nEndRow + 1;
      ++nIndex;
    }
    return bFound;
  }

  /** IsVisibleEqual: whether the rows nStartRow..nEndRow look the same in both columns. */
  IsVisibleEqual(rOther: ScAttrArray, nStartRow: number, nEndRow: number): boolean {
    let nThisPos = this.Search(nStartRow), nOtherPos = rOther.Search(nStartRow);
    let bEqual = true;
    while (nThisPos < this.mvData.length && nOtherPos < rOther.mvData.length && bEqual) {
      const nThisRow = this.mvData[nThisPos]!.nEndRow, nOtherRow = rOther.mvData[nOtherPos]!.nEndRow;
      bEqual = this.mvData[nThisPos]!.pPattern.IsVisibleEqual(rOther.mvData[nOtherPos]!.pPattern);
      if (nThisRow >= nOtherRow) {
        if (nOtherRow >= nEndRow) break;
        ++nOtherPos;
      }
      if (nThisRow <= nOtherRow) {
        if (nThisRow >= nEndRow) break;
        ++nThisPos;
      }
    }
    return bEqual;
  }

  /** Whether the column has only the default pattern. */
  IsDefault(): boolean { return this.mvData.length === 1 && this.mvData[0]!.pPattern === this.mrHelper.getDefaultCellAttribute(); }
}
