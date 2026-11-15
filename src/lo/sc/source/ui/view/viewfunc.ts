// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/inc/viewfunc.hxx reduced
// @upstream sc/source/ui/view/viewfunc.cxx partial
// @upstream sc/source/ui/view/viewfun2.cxx partial
// @upstream sc/source/ui/view/viewfun3.cxx partial
// ScViewFunc: the view's editing functions on the selection, which hand the work to ScDocFunc
// (with undo): entering data, deleting contents, applying attributes and cell styles, number
// formats, inserting and deleting cells, rows and columns, column widths and row heights, and
// the sheets. The selection is the view's ScMarkData, or the cursor's cell when nothing is
// marked (GetSimpleArea). Left out: the input handler's notifications (the web shell's input line
// follows the view), the auto-format of new rows (ExtendFormat), the "replace cells?" queries,
// change tracking, conditional formats and the LibreOfficeKit invalidations. From viewfun3.cxx:
// copying to and pasting from a clipboard document (CopyToClip, CutToClip, PasteFromClip with
// its undo), without drawing objects, links, transposed or skipped-empty pastes of filtered
// rows, and the paste mode's insert/shift options. From viewfun2.cxx also the manual page breaks
// (InsertPageBreak, DeletePageBreak, RemoveManualBreaks) and the print ranges (SetPrintRanges,
// without the print named ranges and the LibreOfficeKit callback).
import { ScAddress, ScAddressDetails, ScRange, ScRefFlags, type SCCOL, type SCROW, type SCTAB } from '../../../inc/address.ts';
import { ScRangeList } from '../../../inc/rangelst.ts';
import { ScUndoRemoveBreaks } from '../undo/undoblk.ts';
import { ScUndoPrintRange } from '../undo/undotab.ts';
import { ScPrintFunc } from './printfun.ts';
import { DelCellCmd, InsCellCmd, InsertDeleteFlags, ScSizeMode, type FillDir } from '../../../inc/global.ts';
import type { ScInputOptions } from '../../../inc/inputopt.ts';
import { ScMarkData } from '../../../inc/markdata.ts';
import type { ScItemSet, SvxBorderLine, SvxBoxItem } from '../../../inc/scitems.ts';
import { GenerateFormat, GetFormatSpecialInfo, GetStandardFormat, GetType, SvNumFormatType } from '../../../../svl/source/numbers/zforlist.ts';
import { ScCellMergeOption } from './cellmergeoption.ts';
import type { ColRowSpan } from '../docshell/docfunc.ts';
import type { ScDocShell } from '../docshell/docsh.ts';
import { ScTabView } from './tabview.ts';
import { ScMarkType, ScFollowMode } from './viewdata.ts';
import { ScClipParam, ScDocument, ScDocumentMode } from '../../core/data/document.ts';
import { ScUndoPaste } from '../undo/undoblk.ts';
import { PaintPartFlags } from '../docshell/docsh.ts';

export class ScViewFunc extends ScTabView {
  constructor(rDocSh: ScDocShell, fnInputOptions: () => ScInputOptions) {
    super(rDocSh, fnInputOptions);
  }

  /** The selection to work on: the view's marks, or the cursor's cell (and its merged area). */
  protected GetFuncMark(): ScMarkData {
    const aFuncMark = this.aViewData.GetMarkData().clone();
    if (!aFuncMark.IsMarked() && !aFuncMark.IsMultiMarked()) {
      aFuncMark.SetMarkArea(this.aViewData.GetSimpleArea().rRange);
    }
    aFuncMark.SelectOneTable(this.aViewData.GetTabNo());
    for (const t of this.aViewData.GetMarkData().GetSelectedTabs()) aFuncMark.SelectTable(t, true);
    return aFuncMark;
  }

  /** EnterData: a cell's input (number, text or formula) through ScDocFunc::EnterData. */
  EnterData(nCol: SCCOL, nRow: SCROW, nTab: SCTAB, rString: string): boolean {
    const rDocFunc = this.aViewData.GetDocFunc();
    const rMark = this.aViewData.GetMarkData().clone();
    rMark.SelectOneTable(nTab);
    for (const t of this.aViewData.GetMarkData().GetSelectedTabs()) rMark.SelectTable(t, true);
    const bOk = rDocFunc.EnterData(new ScAddress(nCol, nRow, nTab), rString, null, rMark);
    this.aViewData.GetDocShell().PostPaintCell(nCol, nRow, nTab);
    this.CellContentChanged();
    return bOk;
  }

  /** EnterBlock's simple case (Alt+Enter in the cell: Enter with the selection filled, Alt+Enter). */
  EnterBlock(rString: string): void {
    const rDoc = this.aViewData.GetDocument();
    const nTab = this.aViewData.GetTabNo();
    const rDocFunc = this.aViewData.GetDocFunc();
    const { rRange } = this.aViewData.GetSimpleArea();
    rDocFunc.EnterListAction('Input');
    for (let nRow = rRange.aStart.Row(); nRow <= rRange.aEnd.Row(); nRow++) {
      if (rDoc.RowHidden(nRow, nTab)) continue;
      for (let nCol = rRange.aStart.Col(); nCol <= rRange.aEnd.Col(); nCol++) {
        if (rDoc.ColHidden(nCol, nTab) || rDoc.IsOverlapped(new ScAddress(nCol, nRow, nTab))) continue;
        rDocFunc.EnterData(new ScAddress(nCol, nRow, nTab), rString);
      }
    }
    rDocFunc.EndListAction();
    this.CellContentChanged();
  }

  /** CellContentChanged: the cells changed (the input line, the status bar). */
  CellContentChanged(): void { this.SelectionChanged(); }

  DeleteContents(nFlags: InsertDeleteFlags): void {
    const aFuncMark = this.GetFuncMark();
    aFuncMark.SetMarking(false);
    aFuncMark.MarkToMulti();
    this.aViewData.GetDocFunc().DeleteContents(aFuncMark, nFlags, true, false);
    this.CellContentChanged();
  }

  /** ApplySelectionPattern / ApplyAttributes: items for the selection. */
  ApplyAttributes(rItems: ScItemSet): void {
    const aFuncMark = this.GetFuncMark();
    this.aViewData.GetDocFunc().ApplyAttributes(aFuncMark, rItems, false);
    this.SelectionChanged();
  }

  /** SetStyleSheetToMarked: a cell style for the selection. */
  SetStyleSheetToMarked(rStyleName: string): void {
    const aFuncMark = this.GetFuncMark();
    this.aViewData.GetDocFunc().ApplyStyle(aFuncMark, rStyleName, false);
    this.SelectionChanged();
  }

  /** The pattern at the cursor (GetSelectionPattern, reduced to the cursor's cell). */
  GetSelectionPattern() {
    const v = this.aViewData;
    return v.GetDocument().GetPattern(v.GetCurX(), v.GetCurY(), v.GetTabNo());
  }


  // --- number formats (viewfunc.cxx) ---

  /** SetNumberFormat: the standard format of a type for the selection. */
  SetNumberFormat(nFormatType: SvNumFormatType): void {
    this.SetNumFmtByStr(GetStandardFormat(nFormatType, 'en-US'));
  }

  /** SetNumFmtByStr: a format code for the selection. */
  SetNumFmtByStr(rCode: string): void {
    this.ApplyAttributes({ ATTR_VALUE_FORMAT: rCode });
  }

  /** The cursor's number format code and its type. */
  GetCurNumFormat(): { code: string; type: SvNumFormatType } {
    const code = this.GetSelectionPattern().GetNumberFormat();
    return { code, type: GetType(code, 'en-US') };
  }

  /** ChangeNumFmtDecimals: one decimal place more or less in the cursor's format. */
  ChangeNumFmtDecimals(bIncrement: boolean): void {
    const v = this.aViewData;
    const rDoc = v.GetDocument();
    let { code, type } = this.GetCurNumFormat();
    if (type === SvNumFormatType.DATE || type === SvNumFormatType.TIME || type === SvNumFormatType.DATETIME || type === SvNumFormatType.TEXT || type === SvNumFormatType.LOGICAL) return;
    let nPrecision: number;
    let bThousand: boolean, bNegRed: boolean, nLeadingZeros: number;
    if (/^\s*General\s*$/i.test(code)) {
      // General: the decimals the value shows
      const fVal = rDoc.GetValue(v.GetCurX(), v.GetCurY(), v.GetTabNo());
      const s = String(fVal);
      nPrecision = s.includes('.') && !s.includes('e') ? s.length - s.indexOf('.') - 1 : 0;
      code = '0';
      type = SvNumFormatType.NUMBER;
      bThousand = false; bNegRed = false; nLeadingZeros = 1;
    } else ({ bThousand, bNegRed, nPrecision, nLeadingZeros } = GetFormatSpecialInfo(code, 'en-US'));
    if (bIncrement) nPrecision = Math.min(20, nPrecision + 1);
    else if (nPrecision > 0) nPrecision--;
    else return;
    this.SetNumFmtByStr(GenerateFormat(code, 'en-US', bThousand, bNegRed, nPrecision, Math.max(1, nLeadingZeros)));
  }

  /** The thousands separator on or off in the cursor's number format (.uno:NumberFormatThousands). */
  ToggleThousandsSeparator(): void {
    let { code } = this.GetCurNumFormat();
    if (/^\s*General\s*$/i.test(code)) code = '0';
    const { bThousand, bNegRed, nPrecision, nLeadingZeros } = GetFormatSpecialInfo(code, 'en-US');
    this.SetNumFmtByStr(GenerateFormat(code, 'en-US', !bThousand, bNegRed, nPrecision, Math.max(1, nLeadingZeros)));
  }

  // --- borders (ApplyPatternLines, reduced to the toolbar's arrangements) ---

  /**
   * The border arrangements of the toolbar's frame control (SvxFrameWindow_Impl): the outer lines
   * of the selection and, optionally, its inner lines, each cell getting the lines on its edges.
   */
  ApplyFrameLines(rLine: SvxBorderLine | null, bLeft: boolean, bRight: boolean, bTop: boolean, bBottom: boolean, bInnerH: boolean, bInnerV: boolean, bClear = false): void {
    const v = this.aViewData;
    const rDocFunc = v.GetDocFunc();
    const nTab = v.GetTabNo();
    const rDoc = v.GetDocument();
    const { rRange } = v.GetSimpleArea();
    const c1 = rRange.aStart.Col(), r1 = rRange.aStart.Row(), c2 = rRange.aEnd.Col(), r2 = rRange.aEnd.Row();
    rDocFunc.EnterListAction('Borders');
    // Cells are set in blocks of equal lines: the corners, edges and inside.
    const cols = c1 === c2 ? [[c1, c1]] : c2 - c1 === 1 ? [[c1, c1], [c2, c2]] : [[c1, c1], [c1 + 1, c2 - 1], [c2, c2]];
    const rows = r1 === r2 ? [[r1, r1]] : r2 - r1 === 1 ? [[r1, r1], [r2, r2]] : [[r1, r1], [r1 + 1, r2 - 1], [r2, r2]];
    for (const [ca, cb] of cols) {
      for (const [ra, rb] of rows) {
        const old: SvxBoxItem = rDoc.GetPattern(ca!, ra!, nTab).GetItem('ATTR_BORDER');
        const isL = ca === c1, isR = cb === c2, isT = ra === r1, isB = rb === r2;
        const pick = (outer: boolean, inner: boolean, edge: boolean, prev: SvxBorderLine | null) => (bClear ? null : edge ? (outer ? rLine : prev) : inner ? rLine : prev);
        const box: SvxBoxItem = {
          left: pick(bLeft, bInnerV, isL, bClear ? null : old.left),
          right: pick(bRight, bInnerV, isR, bClear ? null : old.right),
          top: pick(bTop, bInnerH, isT, bClear ? null : old.top),
          bottom: pick(bBottom, bInnerH, isB, bClear ? null : old.bottom),
        };
        const aMark = new ScMarkData(rDoc.GetSheetLimits());
        aMark.SelectOneTable(nTab);
        aMark.SetMarkArea(new ScRange(ca!, ra!, nTab, cb!, rb!, nTab));
        rDocFunc.ApplyAttributes(aMark, { ATTR_BORDER: box }, false);
      }
    }
    rDocFunc.EndListAction();
    this.SelectionChanged();
  }

  // --- merging (viewfun2.cxx) ---

  /** Whether the selection can be merged (a simple range of more than one cell). */
  TestMergeCells(): boolean {
    const { eMarkType, rRange } = this.aViewData.GetSimpleArea();
    return eMarkType === ScMarkType.SC_MARK_SIMPLE && !rRange.aStart.equals(rRange.aEnd);
  }

  /** MergeCells: the selection merged; bDoContents moves the hidden cells' contents into the first. */
  MergeCells(bDoContents: boolean, bCenter = false): boolean {
    const v = this.aViewData;
    const { eMarkType, rRange } = v.GetSimpleArea();
    if (eMarkType !== ScMarkType.SC_MARK_SIMPLE) {
      v.GetDocShell().ErrorMessage('This function cannot be used with multiple selections.');
      return false;
    }
    const aMergeOption = new ScCellMergeOption(rRange.aStart.Col(), rRange.aStart.Row(), rRange.aEnd.Col(), rRange.aEnd.Row(), bCenter);
    for (const t of this.GetFuncMark().GetSelectedTabs()) aMergeOption.maTabs.add(t);
    const bOk = v.GetDocFunc().MergeCells(aMergeOption, bDoContents, true, false);
    if (bOk) {
      this.SetCursor(rRange.aStart.Col(), rRange.aStart.Row());
      this.CellContentChanged();
    }
    return bOk;
  }

  /** Whether the selection or the cursor's cell has merged cells (SID_DEL_MERGE's state). */
  IsMerged(): boolean {
    const v = this.aViewData;
    const { rRange } = v.GetSimpleArea();
    return v.GetDocument().HasAttrib(rRange.aStart.Col(), rRange.aStart.Row(), v.GetTabNo(), rRange.aEnd.Col(), rRange.aEnd.Row(), v.GetTabNo(), 0x0002);
  }

  /** RemoveMerge: the merged cells of the selection split again. */
  RemoveMerge(): boolean {
    const v = this.aViewData;
    const { rRange } = v.GetSimpleArea();
    const r = rRange.clone();
    r.aStart.SetTab(v.GetTabNo()); r.aEnd.SetTab(v.GetTabNo());
    const aOption = new ScCellMergeOption(r);
    for (const t of this.GetFuncMark().GetSelectedTabs()) aOption.maTabs.add(t);
    const bOk = v.GetDocFunc().UnmergeCells(aOption, true);
    if (bOk) this.CellContentChanged();
    return bOk;
  }

  // --- inserting and deleting ---

  InsertCells(eCmd: InsCellCmd, bRecord = true): boolean {
    const { eMarkType, rRange: aRange } = this.aViewData.GetSimpleArea();
    if (eMarkType !== ScMarkType.SC_MARK_SIMPLE && eMarkType !== ScMarkType.SC_MARK_SIMPLE_FILTERED) {
      this.aViewData.GetDocShell().ErrorMessage('This function cannot be used with multiple selections.');
      return false;
    }
    const rDoc = this.aViewData.GetDocument();
    const aMark = this.aViewData.GetMarkData().clone();
    aMark.SelectOneTable(this.aViewData.GetTabNo());
    const bSuccess = this.aViewData.GetDocFunc().InsertCells(aRange, aMark, eCmd, bRecord, false);
    if (bSuccess) {
      void rDoc;
      this.CellContentChanged();
    }
    return bSuccess;
  }

  DeleteCells(eCmd: DelCellCmd): boolean {
    const { eMarkType, rRange: aRange } = this.aViewData.GetSimpleArea();
    if (eMarkType !== ScMarkType.SC_MARK_SIMPLE && eMarkType !== ScMarkType.SC_MARK_SIMPLE_FILTERED) {
      this.aViewData.GetDocShell().ErrorMessage('This function cannot be used with multiple selections.');
      return false;
    }
    const aMark = this.aViewData.GetMarkData().clone();
    aMark.SelectOneTable(this.aViewData.GetTabNo());
    const bSuccess = this.aViewData.GetDocFunc().DeleteCells(aRange, aMark, eCmd, false);
    if (bSuccess) {
      // the cursor stays at the range's start
      const nCurX = this.aViewData.GetCurX(), nCurY = this.aViewData.GetCurY();
      if (eCmd === DelCellCmd.Cols || eCmd === DelCellCmd.CellsLeft) {
        if (nCurX > aRange.aStart.Col()) this.SetCursor(aRange.aStart.Col(), nCurY);
      } else if (nCurY > aRange.aStart.Row()) this.SetCursor(nCurX, aRange.aStart.Row());
      this.CellContentChanged();
    }
    return bSuccess;
  }

  /** The columns or rows the selection covers, as spans (for widths and heights). */
  GetMarkedColRowSpans(bColumns: boolean): ColRowSpan[] {
    const aRanges = this.aViewData.GetMultiArea();
    const out: ColRowSpan[] = [];
    for (const r of aRanges) out.push(bColumns ? { mnStart: r.aStart.Col(), mnEnd: r.aEnd.Col() } : { mnStart: r.aStart.Row(), mnEnd: r.aEnd.Row() });
    out.sort((a, b) => a.mnStart - b.mnStart);
    const merged: ColRowSpan[] = [];
    for (const s of out) {
      const last = merged[merged.length - 1];
      if (last && s.mnStart <= last.mnEnd + 1) last.mnEnd = Math.max(last.mnEnd, s.mnEnd);
      else merged.push({ ...s });
    }
    return merged;
  }

  SetWidthOrHeight(bWidth: boolean, rRanges: readonly ColRowSpan[], eMode: ScSizeMode, nSizeTwips: number, bRecord = true): void {
    if (!rRanges.length) return;
    this.aViewData.GetDocFunc().SetWidthOrHeight(bWidth, rRanges, this.aViewData.GetTabNo(), eMode, nSizeTwips, bRecord, false);
    this.aViewData.RecalcPixPos();
    this.VisAreaChanged();
    this.SelectionChanged();
  }

  /** SetMarkedWidthOrHeight: the widths or heights of the selected columns or rows. */
  SetMarkedWidthOrHeight(bWidth: boolean, eMode: ScSizeMode, nSizeTwips: number): void {
    this.SetWidthOrHeight(bWidth, this.GetMarkedColRowSpans(bWidth), eMode, nSizeTwips);
  }

  // --- fill ---

  FillSimple(eDir: FillDir): void {
    const { rRange } = this.aViewData.GetSimpleArea();
    const aMark = this.GetFuncMark();
    if (this.aViewData.GetDocFunc().FillSimple(rRange, aMark, eDir, false)) this.CellContentChanged();
  }

  /** FillAuto: the AutoFill handle dragged from the source range by nCount cells. */
  FillAuto(eDir: FillDir, nStartCol: SCCOL, nStartRow: SCROW, nEndCol: SCCOL, nEndRow: SCROW, nCount: number): void {
    const nTab = this.aViewData.GetTabNo();
    const aRange = new ScRange(nStartCol, nStartRow, nTab, nEndCol, nEndRow, nTab);
    const aMark = new ScMarkData(this.aViewData.GetDocument().GetSheetLimits());
    aMark.SelectOneTable(nTab);
    if (this.aViewData.GetDocFunc().FillAuto(aRange, aMark, eDir, nCount)) {
      // the selection covers the filled cells
      const aDest = aRange.clone();
      switch (eDir) {
        case 0: aDest.aEnd.SetRow(nEndRow + nCount); break; // FILL_TO_BOTTOM
        case 1: aDest.aEnd.SetCol(nEndCol + nCount); break; // FILL_TO_RIGHT
        case 2: aDest.aStart.SetRow(nStartRow - nCount); break; // FILL_TO_TOP
        case 3: aDest.aStart.SetCol(nStartCol - nCount); break; // FILL_TO_LEFT
      }
      this.MarkRange(aDest, false);
      this.CellContentChanged();
    }
  }

  // --- sheets ---

  InsertTable(rName: string, nTab: SCTAB, bRecord = true): boolean {
    const bSuccess = this.aViewData.GetDocFunc().InsertTable(nTab, rName, bRecord, false);
    if (bSuccess) {
      this.aViewData.InsertTab(nTab);
      this.SetTabNo(nTab, true);
    }
    return bSuccess;
  }

  DeleteTable(nTab: SCTAB, bRecord = true): boolean {
    const rDoc = this.aViewData.GetDocument();
    if (rDoc.GetTableCount() <= 1) return false;
    const bSuccess = this.aViewData.GetDocFunc().DeleteTable(nTab, bRecord);
    if (bSuccess) {
      this.aViewData.DeleteTab(nTab);
      let nNewTab = nTab;
      if (nNewTab >= rDoc.GetTableCount()) nNewTab = rDoc.GetTableCount() - 1;
      this.SetTabNo(nNewTab, true);
    }
    return bSuccess;
  }

  RenameTable(rName: string, nTabNr: SCTAB): boolean {
    return this.aViewData.GetDocFunc().RenameTable(nTabNr, rName, true, false);
  }

  /** MoveTable within the document: the sheet moved or copied before nDestTab. */
  MoveTable(nDestTab: SCTAB, bCopy: boolean, nSrcTab = this.aViewData.GetTabNo()): boolean {
    const rDocSh = this.aViewData.GetDocShell();
    if (!rDocSh.MoveTable(nSrcTab, nDestTab, bCopy, true)) return false;
    // the sheet's new position
    let nNewTab = nDestTab;
    if (!bCopy && nDestTab > nSrcTab) nNewTab--;
    if (nNewTab >= this.aViewData.GetDocument().GetTableCount()) nNewTab = this.aViewData.GetDocument().GetTableCount() - 1;
    if (bCopy) this.aViewData.CopyTab(nSrcTab, nNewTab);
    else this.aViewData.MoveTab(nSrcTab, nNewTab);
    this.SetTabNo(nNewTab, true);
    return true;
  }

  /** SetTabBgColor: the sheet tab's colour (null: automatic). */
  SetTabBgColor(rColor: string | null, nTab: SCTAB): void {
    const rDocSh = this.aViewData.GetDocShell();
    rDocSh.GetDocument().SetTabBgColor(nTab, rColor);
    rDocSh.PostPaintExtras();
    rDocSh.SetDocumentModified();
    this.VisAreaChanged();
  }


  // --- viewfun3.cxx ---

  /** CopyToClip: the selection into a clipboard document (null when the selection cannot be copied). */
  CopyToClip(bCut = false): ScDocument | null {
    const v = this.aViewData;
    const rDoc = v.GetDocument();
    const { eMarkType, rRange } = v.GetSimpleArea();
    if (eMarkType !== ScMarkType.SC_MARK_SIMPLE && eMarkType !== ScMarkType.SC_MARK_SIMPLE_FILTERED) {
      v.GetDocShell().ErrorMessage('This function cannot be used with multiple selections.');
      return null;
    }
    const pClipDoc = new ScDocument(ScDocumentMode.SCDOCMODE_CLIP);
    const aClipParam = new ScClipParam(rRange, bCut);
    const aMark = this.GetFuncMark();
    aMark.SelectOneTable(v.GetTabNo());
    rDoc.CopyToClip(aClipParam, pClipDoc, aMark);
    return pClipDoc;
  }

  /** CutToClip: copied, then deleted (with undo). */
  CutToClip(): ScDocument | null {
    const pClip = this.CopyToClip(true);
    if (!pClip) return null;
    this.DeleteContents(InsertDeleteFlags.ALL & ~InsertDeleteFlags.OBJECTS);
    return pClip;
  }

  /**
   * PasteFromClip: a clipboard document into the selection (or at the cursor, the clip's size),
   * repeated over a larger selection, with undo. nFlags chooses what is pasted (Paste Special).
   */
  PasteFromClip(nFlags: InsertDeleteFlags, pClipDoc: ScDocument, bSkipEmpty = false): boolean {
    const v = this.aViewData;
    const rDoc = v.GetDocument();
    const rDocSh = v.GetDocShell();
    const nTab = v.GetTabNo();
    const { nClipX, nClipY } = pClipDoc.GetClipArea();
    let aDest: ScRange;
    const { eMarkType, rRange } = v.GetSimpleArea();
    const rMark = v.GetMarkData();
    if (eMarkType === ScMarkType.SC_MARK_MULTI) {
      rDocSh.ErrorMessage('This function cannot be used with multiple selections.');
      return false;
    }
    if (rMark.IsMarked() && (rRange.aEnd.Col() - rRange.aStart.Col() + 1) % (nClipX + 1) === 0 && (rRange.aEnd.Row() - rRange.aStart.Row() + 1) % (nClipY + 1) === 0) aDest = rRange.clone();
    else aDest = new ScRange(v.GetCurX(), v.GetCurY(), nTab, Math.min(rDoc.MaxCol(), v.GetCurX() + nClipX), Math.min(rDoc.MaxRow(), v.GetCurY() + nClipY), nTab);

    const aMark = new ScMarkData(rDoc.GetSheetLimits());
    aMark.SelectOneTable(nTab);
    aMark.SetMarkArea(aDest);

    const pUndoDoc = new ScDocument(ScDocumentMode.SCDOCMODE_UNDO);
    pUndoDoc.InitUndo(rDoc, nTab, nTab, true, true);
    rDoc.CopyToDocument(aDest, InsertDeleteFlags.ALL & ~InsertDeleteFlags.OBJECTS, false, pUndoDoc);

    rDoc.CopyFromClip(aDest, aMark, nFlags, null, pClipDoc, true, false, true, bSkipEmpty);

    const pRedoDoc = new ScDocument(ScDocumentMode.SCDOCMODE_UNDO);
    pRedoDoc.InitUndo(rDoc, nTab, nTab, true, true);
    rDoc.CopyToDocument(aDest, InsertDeleteFlags.ALL & ~InsertDeleteFlags.OBJECTS, false, pRedoDoc);
    if (rDoc.IsUndoEnabled()) rDocSh.GetUndoManager().AddUndoAction(new ScUndoPaste(rDocSh, [aDest], aMark, pUndoDoc, pRedoDoc, InsertDeleteFlags.ALL & ~InsertDeleteFlags.OBJECTS));

    if (!rDocSh.AdjustRowHeight(aDest.aStart.Row(), aDest.aEnd.Row(), nTab)) rDocSh.PostPaint(aDest, PaintPartFlags.Grid);
    rDocSh.SetDocumentModified();
    this.MarkRange(aDest, false);
    this.CellContentChanged();
    return true;
  }


  // --- search and replace (viewfun2.cxx) ---

  /**
   * SearchAndReplace: finds the next cell (or all) whose formula or shown value contains the text,
   * from the cursor, by rows, wrapping around the sheet; replaces in the found cell or in all. Returns
   * the number of cells found or replaced (0: nothing).
   */
  SearchAndReplace(rSearch: ScSearchItem): number {
    const v = this.aViewData;
    const rDoc = v.GetDocument();
    const nTab = v.GetTabNo();
    const pTab = rDoc.FetchTable(nTab);
    if (!pTab || !rSearch.aSearch) return 0;
    const norm = (s: string) => (rSearch.bMatchCase ? s : s.toLowerCase());
    const needle = norm(rSearch.aSearch);
    const textOf = (nCol: number, nRow: number) => {
      const aPos = new ScAddress(nCol, nRow, nTab);
      return rSearch.eCellType === 'formulas' ? rDoc.GetInputString(aPos) || (rDoc.GetFormulaCell(aPos)?.GetFormula() ?? '') : rDoc.GetString(aPos);
    };
    const hit = (nCol: number, nRow: number) => {
      const aPos = new ScAddress(nCol, nRow, nTab);
      const text = rSearch.eCellType === 'formulas' && rDoc.GetFormulaCell(aPos) ? rDoc.GetFormula(aPos) : textOf(nCol, nRow);
      return rSearch.bWholeCell ? norm(text) === needle : norm(text).includes(needle);
    };
    // the cells with content, by rows
    const cells: [number, number][] = [];
    for (let nCol = 0; nCol < pTab.GetAllocatedColumnsCount(); nCol++) pTab.FetchColumn(nCol)?.ForEachCell(0, rDoc.MaxRow(), (nRow) => { cells.push([nCol, nRow]); });
    cells.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const found = cells.filter(([c, r]) => hit(c, r));
    if (!found.length) return 0;
    const replaceIn = (nCol: number, nRow: number) => {
      const aPos = new ScAddress(nCol, nRow, nTab);
      const src = rDoc.GetFormulaCell(aPos) ? rDoc.GetFormula(aPos) : rDoc.GetInputString(aPos);
      let out: string;
      if (rSearch.bWholeCell) out = rSearch.aReplace;
      else {
        const re = new RegExp(rSearch.aSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), rSearch.bMatchCase ? 'g' : 'gi');
        out = src.replace(re, () => rSearch.aReplace);
      }
      v.GetDocFunc().EnterData(aPos, out);
    };
    if (rSearch.nCommand === 'FIND_ALL' || rSearch.nCommand === 'REPLACE_ALL') {
      if (rSearch.nCommand === 'REPLACE_ALL') {
        v.GetDocFunc().EnterListAction('Replace');
        for (const [c, r] of found) replaceIn(c, r);
        v.GetDocFunc().EndListAction();
      }
      // the found cells selected
      const aMark = v.GetMarkData();
      this.DoneBlockMode();
      aMark.ResetMark();
      for (const [c, r] of found) aMark.SetMultiMarkArea(new ScRange(c, r, nTab), true);
      aMark.MarkToSimple();
      this.SetCursor(found[0]![0], found[0]![1]);
      this.AlignToCursor(found[0]![0], found[0]![1], ScFollowMode.SC_FOLLOW_JUMP);
      this.SelectionChanged();
      return found.length;
    }
    const nCurX = v.GetCurX(), nCurY = v.GetCurY();
    // REPLACE: the cursor's cell if it is a match, then the next one
    if (rSearch.nCommand === 'REPLACE' && hit(nCurX, nCurY)) replaceIn(nCurX, nCurY);
    const after = (a: [number, number]) => (rSearch.bBackward ? a[1] < nCurY || (a[1] === nCurY && a[0] < nCurX) : a[1] > nCurY || (a[1] === nCurY && a[0] > nCurX));
    const list = rSearch.bBackward ? [...found].reverse() : found;
    const next = list.find(after) ?? list[0]!;
    this.DoneBlockMode();
    v.GetMarkData().ResetMark();
    this.MoveCursorAbs(next[0], next[1], ScFollowMode.SC_FOLLOW_JUMP, false, false);
    this.SelectionChanged();
    return found.length;
  }

  // --- page breaks and print ranges (viewfun2.cxx) ----------------------------------------------

  InsertPageBreak(bColumn: boolean, bRecord = true, pPos: ScAddress | null = null, bSetModified = true): void {
    const nTab = this.aViewData.CurrentTabForData();
    const aCursor = pPos ?? new ScAddress(this.aViewData.GetCurX(), this.aViewData.GetCurY(), nTab);

    const bSuccess = this.aViewData.GetDocShell().GetDocFunc().InsertPageBreak(bColumn, aCursor, bRecord, bSetModified);

    if (bSuccess && bSetModified) this.UpdatePageBreakData(true); // for PageBreak-Mode
  }

  DeletePageBreak(bColumn: boolean, bRecord = true, pPos: ScAddress | null = null, bSetModified = true): void {
    const nTab = this.aViewData.CurrentTabForData();
    const aCursor = pPos ?? new ScAddress(this.aViewData.GetCurX(), this.aViewData.GetCurY(), nTab);

    const bSuccess = this.aViewData.GetDocShell().GetDocFunc().RemovePageBreak(bColumn, aCursor, bRecord, bSetModified);

    if (bSuccess && bSetModified) this.UpdatePageBreakData(true); // for PageBreak-Mode
  }

  RemoveManualBreaks(): void {
    const pDocSh = this.aViewData.GetDocShell();
    const rDoc = pDocSh.GetDocument();
    const nTab = this.aViewData.CurrentTabForData();
    const bUndo = rDoc.IsUndoEnabled();

    if (bUndo) pDocSh.GetUndoManager().AddUndoAction(new ScUndoRemoveBreaks(pDocSh, nTab, rDoc.GetRowManualBreaks(nTab), rDoc.GetColManualBreaks(nTab)));

    rDoc.RemoveManualBreaks(nTab);
    rDoc.UpdatePageBreaks(nTab);

    this.UpdatePageBreakData(true);
    pDocSh.SetDocumentModified();
    pDocSh.PostPaint(0, 0, nTab, rDoc.MaxCol(), rDoc.MaxRow(), nTab, PaintPartFlags.Grid);
  }

  /**
   * SetPrintRanges: on all selected sheets, the print ranges (pPrint: ranges separated by ";",
   * null: the selection), or the entire sheet, and the repeated columns and rows (null: unchanged,
   * empty: none), with undo.
   */
  SetPrintRanges(bEntireSheet: boolean, pPrint: string | null, pRepCol: string | null, pRepRow: string | null, bAddPrint: boolean): void {
    //  on all selected tables

    const pDocSh = this.aViewData.GetDocShell();
    const rDoc = pDocSh.GetDocument();
    const rMark = this.aViewData.GetMarkData();
    const bUndo = rDoc.IsUndoEnabled();

    const pOldRanges = rDoc.CreatePrintRangeSaver();

    const aDetails = ScAddressDetails(rDoc.GetAddressConvention(), 0, 0);

    const aTabs = rMark.GetSelectCount() ? [...rMark.GetSelectedTabs()] : [this.aViewData.GetTabNo()];
    for (const nTab of aTabs) {
      const aRange = new ScRange(0, 0, nTab);

      //  print ranges

      if (!bAddPrint) rDoc.ClearPrintRanges(nTab);

      if (bEntireSheet) {
        rDoc.SetPrintEntireSheet(nTab);
      } else if (pPrint !== null) {
        if (pPrint.length) {
          const sep = ';'; // ScCompiler::GetNativeSymbolChar(ocSep)
          for (const aToken of pPrint.split(sep)) {
            const r = new ScRange(0, 0, nTab);
            if (r.ParseAny(aToken.trim(), rDoc, aDetails) & ScRefFlags.VALID) rDoc.AddPrintRange(nTab, r);
          }
        }
      } else { // NULL = use selection (print range is always set), use empty string to delete all ranges
        const { eMarkType, rRange } = this.aViewData.GetSimpleArea();
        if (eMarkType === ScMarkType.SC_MARK_SIMPLE) {
          const r = rRange.clone();
          r.aStart.SetTab(nTab); r.aEnd.SetTab(nTab);
          rDoc.AddPrintRange(nTab, r);
        } else if (rMark.IsMultiMarked()) {
          rMark.MarkToMulti();
          const pList = new ScRangeList();
          rMark.FillRangeListWithMarks(pList, false);
          for (let i = 0, n = pList.size(); i < n; ++i) {
            const rR = pList.at(i).clone();
            rR.aStart.SetTab(nTab); rR.aEnd.SetTab(nTab);
            rDoc.AddPrintRange(nTab, rR);
          }
        }
      }

      //  repeat columns

      if (pRepCol !== null) {
        if (!pRepCol.length) rDoc.SetRepeatColRange(nTab, null);
        else if (aRange.ParseAny(pRepCol, rDoc, aDetails) & ScRefFlags.VALID) rDoc.SetRepeatColRange(nTab, aRange.clone());
      }

      //  repeat rows

      if (pRepRow !== null) {
        if (!pRepRow.length) rDoc.SetRepeatRowRange(nTab, null);
        else if (aRange.ParseAny(pRepRow, rDoc, aDetails) & ScRefFlags.VALID) rDoc.SetRepeatRowRange(nTab, aRange.clone());
      }
    }

    //  undo (for all tables)
    if (bUndo) {
      const nCurTab = this.aViewData.CurrentTabForData();
      const pNewRanges = rDoc.CreatePrintRangeSaver();
      pDocSh.GetUndoManager().AddUndoAction(new ScUndoPrintRange(pDocSh, nCurTab, pOldRanges, pNewRanges));
    }

    //  update page breaks

    for (const rTab of aTabs) new ScPrintFunc(null, pDocSh, rTab).UpdatePages();

    this.UpdatePageBreakData(true);
    pDocSh.SetDocumentModified();
    pDocSh.PostPaint(0, 0, 0, rDoc.MaxCol(), rDoc.MaxRow(), Math.max(0, rDoc.GetTableCount() - 1), PaintPartFlags.Grid);
  }

  /** After undo or redo: the view follows the document's sheets and keeps the cursor inside. */
  UpdateAfterUndo(): void {
    const v = this.aViewData;
    const rDoc = v.GetDocument();
    const nCount = rDoc.GetTableCount();
    if (v.GetTabNo() >= nCount) this.SetTabNo(nCount - 1, true);
    v.RecalcPixPos();
    this.AlignToCursor(v.GetCurX(), v.GetCurY(), ScFollowMode.SC_FOLLOW_NONE);
    this.VisAreaChanged();
    this.SelectionChanged();
  }
}

/** SvxSearchItem, reduced: what Find & Replace looks for and does. */
export interface ScSearchItem {
  aSearch: string;
  aReplace: string;
  nCommand: 'FIND' | 'FIND_ALL' | 'REPLACE' | 'REPLACE_ALL';
  bMatchCase: boolean;
  bWholeCell: boolean;
  bBackward: boolean;
  /** SvxSearchCellType: in formulas (the input) or values (the shown text). */
  eCellType: 'formulas' | 'values';
}
