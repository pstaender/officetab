// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/table.hxx reduced
// @upstream sc/source/core/data/table1.cxx reduced
// @upstream sc/source/core/data/table2.cxx reduced
// @upstream sc/source/core/data/table5.cxx reduced
// ScTable: one sheet, its columns (created on demand up to the last used one), name, tab
// colour and visibility, column widths, row heights, hidden and manual-height flags, sheet-local
// named expressions, and merged cells. Kept: cell access, inserting and deleting rows, columns
// and cells, DeleteArea, attribute and style application, merging, the used area, copying for
// clip and undo documents and the reference updates of its formula cells. Optimal row heights
// are estimated from the cells' font heights and line counts (no text layout); the page style
// name and print ranges are kept (table1.cxx's print range functions), and the page breaks of
// table5.cxx: manual breaks, the automatic breaks UpdatePageBreaks distributes over the page
// size ScPrintFunc sets, and the print area functions ScPrintFunc uses (GetPrintArea,
// GetPrintAreaHor/Ver, ExtendPrintArea, which measures the text with a TextMeasurer instead
// of an output device). Outlines, protection details, scenarios and draw objects are left out.
import { EditTextObject } from '../../../../editeng/source/editeng/editobj.ts';
import { FormulaGrammar } from '../../../../include/formula/grammar.ts';
import { ScAddress, ScRange, type SCCOL, type SCROW, type SCTAB } from '../../../inc/address.ts';
import { CELLTYPE_NONE, ScRefCellValue, type CellType, type ScCellData } from '../../../inc/cellvalue.ts';
import { CRFlags, HasAttrFlags, InsertDeleteFlags, STD_COL_WIDTH, ScMoveDirection } from '../../../inc/global.ts';
import { SC_TABSTART_NONE, SCCOL_REPEAT_NONE, SCROW_REPEAT_NONE } from '../../../inc/address.ts';
import { GetPrintOptions } from '../../../inc/printopt.ts';
import type { ScPrintSaverTab } from '../../../inc/prnsave.ts';
import type { TextMeasurer } from '../../../../vcl/source/outdev/text.ts';
import type { ScMarkData } from '../../../inc/markdata.ts';
import type { ScPatternAttr } from '../../../inc/patattr.ts';
import { ScMF, type ScItemId, type ScItems, type ScItemSet } from '../../../inc/scitems.ts';
import type { ScStyleSheet } from '../../../inc/stlsheet.ts';
import type { ScSetStringParam } from '../../../inc/stringutil.ts';
import type { RefUpdateContext, RefUpdateDeleteTabContext, RefUpdateInsertTabContext, RefUpdateMoveTabContext } from '../../../inc/refupdatecontext.ts';
import { ScRangeName } from '../tool/rangenam.ts';
import { ScColumn, type ScPostIt } from './column.ts';
import { ScFormulaCell } from './formulacell.ts';
import type { ScDBData } from '../tool/dbdata.ts';
import { ScConditionalFormatList } from './conditio.ts';
import { ScFlatSegments, SumValues } from './segmenttree.ts';
import type { ScDocument } from './document.ts';

/** ScGlobal::nStdRowHeight: the default row height in twips (0.45 cm for a 10 pt font). */
export const ScStdRowHeight = 256;

/** Equally formatted columns behind the data that end the print area (table1.cxx). */
const SC_COLUMNS_STOP = 30;

export class ScTable {
  private aCol: ScColumn[] = [];
  private aName: string;
  private nTab: SCTAB;
  private readonly rDocument: ScDocument;
  private aTabBgColor: string | null = null;
  private bVisible = true;
  private bLayoutRTL = false;
  private bProtected = false;
  private mpRangeName: ScRangeName | null = null;
  private mpColWidth: ScFlatSegments<number>;
  private mpRowHeights: ScFlatSegments<number>;
  private mpHiddenCols: ScFlatSegments<boolean>;
  private mpHiddenRows: ScFlatSegments<boolean>;
  private mpFilteredRows: ScFlatSegments<boolean>;
  private pDBDataNoName: ScDBData | null = null;
  private mpCondFormatList = new ScConditionalFormatList();
  /** CRFlags per row (ManualSize). */
  private pRowFlags: ScFlatSegments<number>;
  private mnOptimalMinRowHeight = 0;
  private aPageStyle = 'Default';
  private aPrintRanges: ScRange[] = [];
  private moRepeatColRange: ScRange | null = null;
  private moRepeatRowRange: ScRange | null = null;
  private bPrintEntireSheet = true;
  // page breaks (table5.cxx)
  private maRowPageBreaks = new Set<SCROW>();
  private maRowManualBreaks = new Set<SCROW>();
  private maColPageBreaks = new Set<SCCOL>();
  private maColManualBreaks = new Set<SCCOL>();
  private aPageSizeTwips = { Width: 0, Height: 0 };
  private bPageSizeValid = false;
  private mbPageBreaksValid = false;
  private mbForceBreaks = false;
  private nRepeatStartX: SCCOL = SCCOL_REPEAT_NONE;
  private nRepeatEndX: SCCOL = SCCOL_REPEAT_NONE;
  private nRepeatStartY: SCROW = SCROW_REPEAT_NONE;
  private nRepeatEndY: SCROW = SCROW_REPEAT_NONE;

  constructor(rDoc: ScDocument, nNewTab: SCTAB, rNewName: string) {
    this.rDocument = rDoc;
    this.nTab = nNewTab;
    this.aName = rNewName;
    this.mpColWidth = new ScFlatSegments<number>(rDoc.MaxCol(), STD_COL_WIDTH);
    this.mpRowHeights = new ScFlatSegments<number>(rDoc.MaxRow(), ScStdRowHeight);
    this.mpHiddenCols = new ScFlatSegments<boolean>(rDoc.MaxCol(), false);
    this.mpHiddenRows = new ScFlatSegments<boolean>(rDoc.MaxRow(), false);
    this.mpFilteredRows = new ScFlatSegments<boolean>(rDoc.MaxRow(), false);
    this.pRowFlags = new ScFlatSegments<number>(rDoc.MaxRow(), CRFlags.NONE);
  }

  GetDoc(): ScDocument { return this.rDocument; }
  GetTab(): SCTAB { return this.nTab; }
  /** After sheets moved: the new index for the sheet and its cells. */
  SetTab(nNewTab: SCTAB): void {
    this.nTab = nNewTab;
    for (const c of this.aCol) {
      c.SetTab(nNewTab);
      c.UpdatePositions();
    }
  }

  GetName(): string { return this.aName; }
  SetName(rNewName: string): void { this.aName = rNewName; }
  GetTabBgColor(): string | null { return this.aTabBgColor; }
  SetTabBgColor(rColor: string | null): void { this.aTabBgColor = rColor; }
  IsVisible(): boolean { return this.bVisible; }
  SetVisible(bVis: boolean): void { this.bVisible = bVis; }
  IsLayoutRTL(): boolean { return this.bLayoutRTL; }
  SetLayoutRTL(bSet: boolean): void { this.bLayoutRTL = bSet; }
  SetPageStyle(rName: string): void { this.aPageStyle = rName; }
  GetPageStyle(): string { return this.aPageStyle; }

  // print ranges (table1.cxx)
  GetPrintRangeCount(): number { return this.aPrintRanges.length; }
  GetPrintRange(nPos: number): ScRange | null { return this.aPrintRanges[nPos] ?? null; }
  GetRepeatColRange(): ScRange | null { return this.moRepeatColRange; }
  GetRepeatRowRange(): ScRange | null { return this.moRepeatRowRange; }
  SetRepeatColRange(oNew: ScRange | null): void {
    this.moRepeatColRange = oNew;
    this.InvalidatePageBreaks();
  }
  SetRepeatRowRange(oNew: ScRange | null): void {
    this.moRepeatRowRange = oNew;
    this.InvalidatePageBreaks();
  }
  ClearPrintRanges(): void {
    this.aPrintRanges = [];
    this.bPrintEntireSheet = false;
    this.InvalidatePageBreaks(); // #i117952# forget page breaks for an old print range
  }
  AddPrintRange(rNew: ScRange): void {
    this.bPrintEntireSheet = false;
    if (this.aPrintRanges.length < 0xFFFF) this.aPrintRanges.push(rNew);
    this.InvalidatePageBreaks();
  }
  SetPrintEntireSheet(): void {
    if (!this.IsPrintEntireSheet()) {
      this.ClearPrintRanges();
      this.bPrintEntireSheet = true;
    }
  }
  IsPrintEntireSheet(): boolean { return this.bPrintEntireSheet; }

  FillPrintSaver(rSaveTab: ScPrintSaverTab): void {
    rSaveTab.SetAreas([...this.aPrintRanges], this.bPrintEntireSheet);
    rSaveTab.SetRepeat(this.moRepeatColRange, this.moRepeatRowRange);
  }

  RestorePrintRanges(rSaveTab: ScPrintSaverTab): void {
    this.aPrintRanges = rSaveTab.GetPrintRanges().map((r) => r.clone());
    this.bPrintEntireSheet = rSaveTab.IsEntireSheet();
    this.SetRepeatColRange(rSaveTab.GetRepeatCol()?.clone() ?? null);
    this.SetRepeatRowRange(rSaveTab.GetRepeatRow()?.clone() ?? null);

    this.InvalidatePageBreaks(); // #i117952# forget page breaks for an old print range
    this.UpdatePageBreaks(null);
  }

  IsProtected(): boolean { return this.bProtected; }
  SetProtection(b: boolean): void { this.bProtected = b; }

  GetRangeName(): ScRangeName {
    if (!this.mpRangeName) this.mpRangeName = new ScRangeName();
    return this.mpRangeName;
  }
  HasRangeName(): boolean { return !!this.mpRangeName && !this.mpRangeName.empty(); }
  SetRangeName(p: ScRangeName | null): void { this.mpRangeName = p; }

  // --- columns ----------------------------------------------------------------------------------

  GetAllocatedColumnsCount(): number { return this.aCol.length; }

  CreateColumnIfNotExists(nScCol: SCCOL): ScColumn {
    while (this.aCol.length <= nScCol) this.aCol.push(new ScColumn(this.rDocument, this.aCol.length, this.nTab));
    return this.aCol[nScCol]!;
  }

  /** The column if allocated (null otherwise). */
  FetchColumn(nCol: SCCOL): ScColumn | null { return nCol < this.aCol.length ? this.aCol[nCol]! : null; }

  /** The allocated columns (for iterating). */
  GetColumns(): readonly ScColumn[] { return this.aCol; }

  ClampToAllocatedColumns(nCol: SCCOL): SCCOL { return Math.min(nCol, this.aCol.length - 1); }

  ValidCol(nCol: SCCOL): boolean { return this.rDocument.ValidCol(nCol); }
  ValidRow(nRow: SCROW): boolean { return this.rDocument.ValidRow(nRow); }
  ValidColRow(nCol: SCCOL, nRow: SCROW): boolean { return this.rDocument.ValidColRow(nCol, nRow); }

  // --- cells ------------------------------------------------------------------------------------

  SetString(nCol: SCCOL, nRow: SCROW, nTabP: SCTAB, rString: string, pParam?: ScSetStringParam | null): boolean {
    if (!this.ValidColRow(nCol, nRow)) return false;
    return this.CreateColumnIfNotExists(nCol).SetString(nRow, nTabP, rString, this.rDocument.GetAddressConvention(), pParam);
  }

  SetValue(nCol: SCCOL, nRow: SCROW, rVal: number): void {
    if (this.ValidColRow(nCol, nRow)) this.CreateColumnIfNotExists(nCol).SetValue(nRow, rVal);
  }

  SetRawString(nCol: SCCOL, nRow: SCROW, rStr: string): void {
    if (this.ValidColRow(nCol, nRow)) this.CreateColumnIfNotExists(nCol).SetRawString(nRow, rStr);
  }

  SetEditText(nCol: SCCOL, nRow: SCROW, pEditText: EditTextObject): boolean {
    if (!this.ValidColRow(nCol, nRow)) return false;
    this.CreateColumnIfNotExists(nCol).SetEditText(nRow, pEditText);
    return true;
  }

  SetFormulaCell(nCol: SCCOL, nRow: SCROW, pCell: ScFormulaCell): ScFormulaCell | null {
    if (!this.ValidColRow(nCol, nRow)) return null;
    return this.CreateColumnIfNotExists(nCol).SetFormulaCell(nRow, pCell);
  }

  SetFormula(nCol: SCCOL, nRow: SCROW, rFormula: string, eGram: FormulaGrammar.Grammar): void {
    if (!this.ValidColRow(nCol, nRow)) return;
    this.CreateColumnIfNotExists(nCol).SetFormulaCell(nRow, new ScFormulaCell(this.rDocument, new ScAddress(nCol, nRow, this.nTab), rFormula, eGram));
  }

  SetCell(nCol: SCCOL, nRow: SCROW, p: ScCellData | undefined, bBroadcast = true): void {
    if (this.ValidColRow(nCol, nRow)) this.CreateColumnIfNotExists(nCol).SetCell(nRow, p, bBroadcast);
  }

  GetCellData(nCol: SCCOL, nRow: SCROW): ScCellData | undefined {
    const c = this.FetchColumn(nCol);
    return c ? c.GetCellData(nRow) : undefined;
  }

  GetCellValue(nCol: SCCOL, nRow: SCROW): ScRefCellValue {
    const c = this.FetchColumn(nCol);
    return c ? c.GetCellValue(nRow) : new ScRefCellValue();
  }

  GetCellType(nCol: SCCOL, nRow: SCROW): CellType {
    const c = this.FetchColumn(nCol);
    return c ? c.GetCellType(nRow) : CELLTYPE_NONE;
  }

  GetValue(nCol: SCCOL, nRow: SCROW): number {
    const c = this.FetchColumn(nCol);
    return c ? c.GetValue(nRow) : 0.0;
  }

  GetString(nCol: SCCOL, nRow: SCROW): string {
    const c = this.FetchColumn(nCol);
    return c ? c.GetString(nRow) : '';
  }

  GetInputString(nCol: SCCOL, nRow: SCROW): string {
    const c = this.FetchColumn(nCol);
    return c ? c.GetInputString(nRow) : '';
  }

  GetFormula(nCol: SCCOL, nRow: SCROW): string {
    const c = this.FetchColumn(nCol);
    return c ? c.GetFormula(nRow) : '';
  }

  GetFormulaCell(nCol: SCCOL, nRow: SCROW): ScFormulaCell | null {
    const c = this.FetchColumn(nCol);
    return c ? c.GetFormulaCell(nRow) : null;
  }

  GetEditText(nCol: SCCOL, nRow: SCROW): EditTextObject | null {
    const c = this.FetchColumn(nCol);
    return c ? c.GetEditText(nRow) : null;
  }

  HasData(nCol: SCCOL, nRow: SCROW): boolean {
    const c = this.FetchColumn(nCol);
    return !!c && c.HasDataAt(nRow);
  }
  HasStringData(nCol: SCCOL, nRow: SCROW): boolean {
    const c = this.FetchColumn(nCol);
    return !!c && c.HasStringData(nRow);
  }
  HasValueData(nCol: SCCOL, nRow: SCROW): boolean {
    const c = this.FetchColumn(nCol);
    return !!c && c.HasValueData(nRow);
  }

  GetNote(nCol: SCCOL, nRow: SCROW): ScPostIt | null {
    const c = this.FetchColumn(nCol);
    return c ? c.GetCellNote(nRow) : null;
  }
  SetNote(nCol: SCCOL, nRow: SCROW, pNote: ScPostIt | null): void {
    if (this.ValidColRow(nCol, nRow)) this.CreateColumnIfNotExists(nCol).SetCellNote(nRow, pNote);
  }

  /** Whether the block has no cells (IsBlockEmpty). */
  IsBlockEmpty(nCol1: SCCOL, nRow1: SCROW, nCol2: SCCOL, nRow2: SCROW): boolean {
    for (let i = nCol1; i <= Math.min(nCol2, this.aCol.length - 1); i++) if (!this.aCol[i]!.IsEmptyBlock(nRow1, nRow2)) return false;
    return true;
  }

  DeleteArea(nCol1: SCCOL, nRow1: SCROW, nCol2: SCCOL, nRow2: SCROW, nDelFlag: InsertDeleteFlags, bBroadcast = true): void {
    if (nCol2 > this.rDocument.MaxCol()) nCol2 = this.rDocument.MaxCol();
    if (nRow2 > this.rDocument.MaxRow()) nRow2 = this.rDocument.MaxRow();
    if (!this.ValidColRow(nCol1, nRow1) || !this.ValidColRow(nCol2, nRow2)) return;
    const nLast = this.ClampToAllocatedColumns(nCol2);
    for (let i = nCol1; i <= nLast; i++) this.aCol[i]!.DeleteArea(nRow1, nRow2, nDelFlag, bBroadcast);
    // Delete merge flags of the deleted attributes: merged cells keep their merge on content deletion.
  }

  // --- structure ---------------------------------------------------------------------------------

  /** Whether nSize rows can be inserted (no data would be pushed beyond the last row). */
  TestInsertRow(nStartCol: SCCOL, nEndCol: SCCOL, nStartRow: SCROW, nSize: number): boolean {
    if (nStartRow + nSize > this.rDocument.MaxRow()) return false;
    const nLast = this.rDocument.MaxRow() - nSize + 1;
    for (let i = nStartCol; i <= Math.min(nEndCol, this.aCol.length - 1); i++) if (!this.aCol[i]!.IsEmptyBlock(nLast, this.rDocument.MaxRow())) return false;
    return true;
  }

  InsertRow(nStartCol: SCCOL, nEndCol: SCCOL, nStartRow: SCROW, nSize: number): void {
    if (nStartCol === 0 && nEndCol === this.rDocument.MaxCol()) {
      this.mpRowHeights.insertSegment(nStartRow, nSize);
      this.pRowFlags.insertSegment(nStartRow, nSize, nStartRow > 0 ? this.pRowFlags.getValue(nStartRow - 1) & ~CRFlags.ManualBreak : CRFlags.NONE);
      // only copy hidden flag when inserting rows (not filtered)
      this.mpHiddenRows.insertSegment(nStartRow, nSize);
      this.mpFilteredRows.insertSegment(nStartRow, nSize, false);

      if (this.maRowManualBreaks.size) {
        // Copy all breaks up to nStartRow (non-inclusive), and shift the rest by nSize.
        this.maRowManualBreaks = new Set([...this.maRowManualBreaks].map((r) => (r < nStartRow ? r : r + nSize)).filter((r) => r <= this.rDocument.MaxRow()));
      }
    }
    for (let j = nStartCol; j <= nEndCol; j++) this.CreateColumnIfNotExists(j).InsertRow(nStartRow, nSize);
    this.InvalidatePageBreaks();
  }

  DeleteRow(nStartCol: SCCOL, nEndCol: SCCOL, nStartRow: SCROW, nSize: number): void {
    if (nStartCol === 0 && nEndCol === this.rDocument.MaxCol()) {
      this.mpRowHeights.removeSegment(nStartRow, nStartRow + nSize - 1);
      this.pRowFlags.removeSegment(nStartRow, nStartRow + nSize - 1);
      this.mpHiddenRows.removeSegment(nStartRow, nStartRow + nSize - 1);
      this.mpFilteredRows.removeSegment(nStartRow, nStartRow + nSize - 1);

      if (this.maRowManualBreaks.size) {
        // Erase all manual breaks between nStartRow and nStartRow + nSize - 1 (inclusive),
        // and shift the ones below up by nSize.
        this.maRowManualBreaks = new Set([...this.maRowManualBreaks].filter((r) => r < nStartRow || r > nStartRow + nSize - 1).map((r) => (r < nStartRow ? r : r - nSize)));
      }
    }
    for (let j = nStartCol; j <= Math.min(nEndCol, this.aCol.length - 1); j++) this.aCol[j]!.DeleteRow(nStartRow, nSize);
    this.InvalidatePageBreaks();
  }

  /** Whether nSize columns can be inserted. */
  TestInsertCol(nStartRow: SCROW, nEndRow: SCROW, nSize: number): boolean {
    if (nSize > this.rDocument.MaxCol()) return false;
    for (let i = this.rDocument.MaxCol() - nSize + 1; i < this.aCol.length; i++) if (!this.aCol[i]!.IsEmptyBlock(nStartRow, nEndRow)) return false;
    return true;
  }

  InsertCol(nStartRow: SCROW, nEndRow: SCROW, nStartCol: SCCOL, nSize: number): void {
    const nMaxCol = this.rDocument.MaxCol();
    if (nStartRow === 0 && nEndRow === this.rDocument.MaxRow()) {
      this.mpColWidth.insertSegment(nStartCol, nSize);
      this.mpHiddenCols.insertSegment(nStartCol, nSize);
      if (this.maColManualBreaks.size) {
        this.maColManualBreaks = new Set([...this.maColManualBreaks].map((c) => (c < nStartCol ? c : c + nSize)).filter((c) => c <= nMaxCol));
      }
      this.InvalidatePageBreaks();
      // whole columns: move the column objects
      this.CreateColumnIfNotExists(Math.min(nMaxCol, Math.max(this.aCol.length - 1, nStartCol) + nSize));
      for (let i = 0; i < nSize; i++) {
        const pNew = new ScColumn(this.rDocument, 0, this.nTab);
        // the inserted columns take the attributes of the column on the left
        if (nStartCol > 0) {
          const pLeft = this.aCol[nStartCol - 1]!;
          for (const e of pLeft.pAttrArray.CopyArea(0, this.rDocument.MaxRow())) {
            const p = e.pPattern.IsMerged() || e.pPattern.IsOverlapped() ? e.pPattern.ClearItems(['ATTR_MERGE', 'ATTR_MERGE_FLAG']) : e.pPattern;
            pNew.pAttrArray.SetPatternArea(e.nStart, e.nEnd, p);
          }
        }
        this.aCol.splice(nStartCol, 0, pNew);
      }
      const pRemoved = this.aCol.splice(nMaxCol + 1);
      for (const c of pRemoved) for (const f of c.FormulaCells()) f.EndListeningTo(this.rDocument);
      for (let i = 0; i < this.aCol.length; i++) { this.aCol[i]!.SetCol(i); this.aCol[i]!.UpdatePositions(); }
      return;
    }
    // part of the rows: move the cells of the rows to the right, column by column
    this.CreateColumnIfNotExists(Math.min(nMaxCol, this.aCol.length - 1 + nSize));
    for (let nCol = Math.min(nMaxCol, this.aCol.length - 1); nCol >= nStartCol; nCol--) {
      const nDest = nCol + nSize;
      if (nDest > nMaxCol) { this.aCol[nCol]!.DeleteArea(nStartRow, nEndRow, InsertDeleteFlags.ALL, false); continue; }
      this.MoveColumnBlock(nCol, nDest, nStartRow, nEndRow);
    }
  }

  /** Move the cells and attributes of rows nStartRow..nEndRow from one column to another. */
  private MoveColumnBlock(nSrcCol: SCCOL, nDestCol: SCCOL, nStartRow: SCROW, nEndRow: SCROW): void {
    const pSrc = this.CreateColumnIfNotExists(nSrcCol);
    const pDest = this.CreateColumnIfNotExists(nDestCol);
    pDest.DeleteArea(nStartRow, nEndRow, InsertDeleteFlags.ALL, false);
    const { aRows, aCells } = pSrc.GetCellsInRange(nStartRow, nEndRow);
    for (const e of pSrc.pAttrArray.CopyArea(nStartRow, nEndRow)) pDest.pAttrArray.SetPatternArea(nStartRow + e.nStart, nStartRow + e.nEnd, e.pPattern);
    for (let i = 0; i < aRows.length; i++) {
      pSrc.RemoveCellRaw(aRows[i]!);
      pDest.SetCellRaw(aRows[i]!, aCells[i]!);
    }
    pSrc.pAttrArray.SetPatternArea(nStartRow, nEndRow, this.rDocument.getCellAttributeHelper().getDefaultCellAttribute());
  }

  DeleteCol(nStartRow: SCROW, nEndRow: SCROW, nStartCol: SCCOL, nSize: number): void {
    const nMaxCol = this.rDocument.MaxCol();
    if (nStartRow === 0 && nEndRow === this.rDocument.MaxRow()) {
      this.mpColWidth.removeSegment(nStartCol, nStartCol + nSize - 1);
      this.mpHiddenCols.removeSegment(nStartCol, nStartCol + nSize - 1);
      if (this.maColManualBreaks.size) {
        this.maColManualBreaks = new Set([...this.maColManualBreaks].filter((c) => c < nStartCol || c > nStartCol + nSize - 1).map((c) => (c < nStartCol ? c : c - nSize)));
      }
      this.InvalidatePageBreaks();
      if (nStartCol < this.aCol.length) {
        const pRemoved = this.aCol.splice(nStartCol, Math.min(nSize, this.aCol.length - nStartCol));
        for (const c of pRemoved) for (const f of c.FormulaCells()) {
          f.EndListeningTo(this.rDocument);
          this.rDocument.RemoveFromFormulaTree(f);
        }
        for (let i = 0; i < this.aCol.length; i++) { this.aCol[i]!.SetCol(i); this.aCol[i]!.UpdatePositions(); }
      }
      return;
    }
    for (let nCol = nStartCol; nCol < nStartCol + nSize && nCol < this.aCol.length; nCol++) this.aCol[nCol]!.DeleteArea(nStartRow, nEndRow, InsertDeleteFlags.ALL, false);
    for (let nCol = nStartCol + nSize; nCol < this.aCol.length; nCol++) this.MoveColumnBlock(nCol, nCol - nSize, nStartRow, nEndRow);
    void nMaxCol;
  }

  /** Copy one column to another position on this sheet (for moving column blocks). */
  SwapColumns(nCol1: SCCOL, nCol2: SCCOL): void {
    this.CreateColumnIfNotExists(Math.max(nCol1, nCol2));
    this.aCol[nCol1]!.SwapCol(this.aCol[nCol2]!);
  }

  // --- formula cells ------------------------------------------------------------------------------

  *FormulaCells(): Generator<ScFormulaCell> {
    for (const c of this.aCol) yield* c.FormulaCells();
  }

  UpdateReference(rCxt: RefUpdateContext, pUndoDoc?: ScDocument | null): boolean {
    let bUpdated = false;
    for (const f of [...this.FormulaCells()]) {
      // setOldCodeToUndo (formulacell.cxx): a changed cell goes to the undo document with its
      // old code at its position before the update (the first, oldest copy wins).
      const aUndoPos = pUndoDoc ? f.aPos.clone() : null;
      const pOldCode = pUndoDoc ? f.GetCode().Clone() : null;
      if (f.UpdateReference(rCxt)) {
        if (pUndoDoc && aUndoPos && pOldCode && pUndoDoc.GetCellType(aUndoPos) !== 3 /* CELLTYPE_FORMULA */) {
          pUndoDoc.AddUndoTab(aUndoPos.Tab(), aUndoPos.Tab());
          pUndoDoc.FetchTable(aUndoPos.Tab())!.CreateColumnIfNotExists(aUndoPos.Col()).SetCellRaw(aUndoPos.Row(), new ScFormulaCell(pUndoDoc, aUndoPos, pOldCode, FormulaGrammar.GRAM_DEFAULT, f.GetMatrixFlag()));
        }
        bUpdated = true;
        f.SetDirtyVar();
        this.rDocument.AppendToFormulaTrack(f);
      }
    }
    if (this.mpRangeName) this.mpRangeName.UpdateReference(rCxt, this.nTab);
    return bUpdated;
  }

  UpdateInsertTab(rCxt: RefUpdateInsertTabContext): void {
    if (this.nTab >= rCxt.mnInsertPos) {
      this.nTab += rCxt.mnSheets;
      for (const c of this.aCol) c.SetTab(this.nTab);
    }
    for (const f of this.FormulaCells()) {
      f.UpdateInsertTab(rCxt);
      f.SetDirtyVar();
    }
    if (this.mpRangeName) this.mpRangeName.UpdateInsertTab(rCxt, this.nTab);
  }

  UpdateDeleteTab(rCxt: RefUpdateDeleteTabContext): void {
    if (this.nTab > rCxt.mnDeletePos) {
      this.nTab -= rCxt.mnSheets;
      for (const c of this.aCol) c.SetTab(this.nTab);
    }
    for (const f of this.FormulaCells()) {
      f.UpdateDeleteTab(rCxt);
      f.SetDirtyVar();
    }
    if (this.mpRangeName) this.mpRangeName.UpdateDeleteTab(rCxt, this.nTab);
  }

  UpdateMoveTab(rCxt: RefUpdateMoveTabContext, nTabNo: SCTAB): void {
    this.nTab = nTabNo;
    for (const c of this.aCol) c.SetTab(nTabNo);
    for (const f of this.FormulaCells()) {
      f.UpdateMoveTab(rCxt, nTabNo);
      f.SetDirtyVar();
    }
    if (this.mpRangeName) this.mpRangeName.UpdateMoveTab(rCxt, this.nTab);
  }

  // --- widths and heights -----------------------------------------------------------------------

  SetColWidth(nCol: SCCOL, nNewWidth: number): void {
    if (this.ValidCol(nCol)) this.mpColWidth.setValue(nCol, nCol, nNewWidth);
  }
  SetColWidthOnly(nCol: SCCOL, nNewWidth: number): void { this.SetColWidth(nCol, nNewWidth); }

  GetColWidth(nCol: SCCOL, bHiddenAsZero = true): number {
    if (!this.ValidCol(nCol)) return STD_COL_WIDTH;
    if (bHiddenAsZero && this.ColHidden(nCol)) return 0;
    return this.mpColWidth.getValue(nCol);
  }

  /** The sum of the widths of columns nStartCol..nEndCol. */
  GetColWidthRange(nStartCol: SCCOL, nEndCol: SCCOL, bHiddenAsZero = true): number {
    if (nEndCol < nStartCol) return 0;
    return SumValues(this.mpColWidth, nStartCol, nEndCol, bHiddenAsZero ? this.mpHiddenCols : undefined);
  }

  /** The x position of a column's left edge in twips (GetColOffset). */
  GetColOffset(nCol: SCCOL, bHiddenAsZero = true): number { return this.GetColWidthRange(0, nCol - 1, bHiddenAsZero); }

  GetOriginalWidth(nCol: SCCOL): number { return this.mpColWidth.getValue(nCol); }

  SetRowHeight(nRow: SCROW, nNewHeight: number): void { this.SetRowHeightRange(nRow, nRow, nNewHeight); }

  SetRowHeightRange(nStartRow: SCROW, nEndRow: SCROW, nNewHeight: number): void {
    if (!this.ValidRow(nStartRow) || !this.ValidRow(nEndRow)) return;
    this.mpRowHeights.setValue(nStartRow, nEndRow, nNewHeight);
  }

  /** Set heights of rows that were not set manually, keeping them automatic (SetRowHeightOnly). */
  SetRowHeightOnly(nStartRow: SCROW, nEndRow: SCROW, nNewHeight: number): void { this.mpRowHeights.setValue(nStartRow, nEndRow, nNewHeight); }

  /** The height of a row; rRange (pStartRow, pEndRow upstream) receives the rows of the same height. */
  GetRowHeight(nRow: SCROW, bHiddenAsZero = true, rRange?: { nStartRow: SCROW; nEndRow: SCROW }): number {
    if (rRange) {
      const r = this.mpRowHeights.getRangeData(nRow);
      rRange.nStartRow = r.mnPos1;
      rRange.nEndRow = r.mnPos2;
    }
    if (!this.ValidRow(nRow)) return ScStdRowHeight;
    if (bHiddenAsZero && this.RowHidden(nRow)) return 0;
    return this.mpRowHeights.getValue(nRow);
  }

  /** The sum of the heights of rows nStartRow..nEndRow. */
  GetRowHeightRange(nStartRow: SCROW, nEndRow: SCROW, bHiddenAsZero = true): number {
    if (nEndRow < nStartRow) return 0;
    return SumValues(this.mpRowHeights, nStartRow, nEndRow, bHiddenAsZero ? this.mpHiddenRows : undefined);
  }

  /** The y position of a row's top edge in twips. */
  GetRowOffset(nRow: SCROW, bHiddenAsZero = true): number { return this.GetRowHeightRange(0, nRow - 1, bHiddenAsZero); }

  /** The row at a y position in twips (GetRowForHeight). */
  GetRowForHeight(nHeight: number): SCROW {
    let nSum = 0;
    for (const s of this.mpRowHeights.runs(0, this.rDocument.MaxRow())) {
      for (const h of this.mpHiddenRows.runs(s.mnPos1, s.mnPos2)) {
        if (h.mnValue) continue;
        const n = h.mnPos2 - h.mnPos1 + 1;
        if (nSum + n * s.mnValue > nHeight) return h.mnPos1 + Math.floor((nHeight - nSum) / s.mnValue);
        nSum += n * s.mnValue;
      }
    }
    return this.rDocument.MaxRow();
  }

  /** The column at an x position in twips. */
  GetColForWidth(nWidth: number): SCCOL {
    let nSum = 0;
    for (let nCol = 0; nCol <= this.rDocument.MaxCol(); nCol++) {
      nSum += this.GetColWidth(nCol);
      if (nSum > nWidth) return nCol;
    }
    return this.rDocument.MaxCol();
  }

  SetManualHeight(nStartRow: SCROW, nEndRow: SCROW, bManual: boolean): void {
    for (const r of [...this.pRowFlags.runs(nStartRow, nEndRow)]) {
      this.pRowFlags.setValue(r.mnPos1, r.mnPos2, bManual ? r.mnValue | CRFlags.ManualSize : r.mnValue & ~CRFlags.ManualSize);
    }
  }

  IsManualRowHeight(nRow: SCROW): boolean { return (this.pRowFlags.getValue(nRow) & CRFlags.ManualSize) !== 0; }
  /** The flags of a row; rRange receives the rows of the same flags. */
  GetRowFlags(nRow: SCROW, rRange?: { nStartRow: SCROW; nEndRow: SCROW }): CRFlags {
    if (rRange) {
      const r = this.pRowFlags.getRangeData(nRow);
      rRange.nStartRow = r.mnPos1;
      rRange.nEndRow = r.mnPos2;
    }
    return this.pRowFlags.getValue(nRow);
  }

  /**
   * The optimal height of a row (ScTable::GetOptimalHeight, reduced): the tallest cell's font
   * height times its line count plus the margins, at least the default row height.
   */
  GetOptimalRowHeight(nRow: SCROW): number {
    let nHeight = ScStdRowHeight;
    for (const c of this.aCol) {
      const nCol = c.GetCol();
      if (!c.HasDataAt(nRow)) {
        // An empty cell still contributes its font size.
        const p = c.GetPattern(nRow);
        const h = p.GetItem('ATTR_FONT_HEIGHT');
        if (h !== 200) nHeight = Math.max(nHeight, Math.round(h * 1.28));
        continue;
      }
      const p = c.GetPattern(nRow);
      const nFontHeight = p.GetItem('ATTR_FONT_HEIGHT');
      let nLines = 1;
      const aCell = c.GetCellValue(nRow);
      const text = aCell.getType() === 4 /* EDIT */ ? aCell.getEditText()!.GetString() : '';
      if (text) nLines = text.split('\n').length;
      if (p.GetItem('ATTR_LINEBREAK')) {
        // wrapped text: estimate the line count from the column width
        const s = c.GetString(nRow);
        const nWidth = Math.max(1, this.GetColWidth(nCol, false) - 40);
        const nPerLine = Math.max(1, Math.floor(nWidth / (nFontHeight * 0.5)));
        nLines = Math.max(nLines, s.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / nPerLine)), 0));
      }
      const m = p.GetItem('ATTR_MARGIN');
      const nCellHeight = Math.round(nFontHeight * 1.18) * nLines + m.top + m.bottom;
      nHeight = Math.max(nHeight, nCellHeight);
    }
    return Math.max(nHeight, this.mnOptimalMinRowHeight);
  }

  /** Set the optimal height of rows without a manual height (SetOptimalHeight). */
  SetOptimalHeight(nStartRow: SCROW, nEndRow: SCROW, bApi = false): boolean {
    void bApi;
    let bChanged = false;
    // Only rows with cells or a font height of their own need measuring; the others get the
    // default height in runs (a large range, such as down to the last row, stays fast).
    const aRows = new Set<number>();
    for (const c of this.aCol) {
      c.ForEachCell(nStartRow, nEndRow, (nRow) => aRows.add(nRow));
      for (const e of c.pAttrArray.CopyArea(nStartRow, nEndRow))
        if (e.pPattern.GetItem('ATTR_FONT_HEIGHT') !== 200) for (let r = nStartRow + e.nStart; r <= nStartRow + e.nEnd; r++) aRows.add(r);
    }
    const nDefault = Math.max(ScStdRowHeight, this.mnOptimalMinRowHeight);
    for (const f of [...this.pRowFlags.runs(nStartRow, nEndRow)]) {
      if (f.mnValue & CRFlags.ManualSize) continue;
      for (const h of [...this.mpRowHeights.runs(f.mnPos1, f.mnPos2)]) {
        if (h.mnValue !== nDefault) {
          this.mpRowHeights.setValue(h.mnPos1, h.mnPos2, nDefault);
          bChanged = true;
        }
      }
    }
    for (const nRow of aRows) {
      if (this.IsManualRowHeight(nRow)) continue;
      const h = this.GetOptimalRowHeight(nRow);
      if (h !== this.mpRowHeights.getValue(nRow)) {
        this.mpRowHeights.setValue(nRow, nRow, h);
        bChanged = true;
      }
    }
    return bChanged;
  }

  /** The optimal width of a column: the widest display string (estimated) plus margins. */
  GetOptimalColWidth(nCol: SCCOL, bFormula = false): number {
    const c = this.FetchColumn(nCol);
    if (!c) return STD_COL_WIDTH;
    let nWidth = 0;
    c.ForEachCell(0, this.rDocument.MaxRow(), (nRow) => {
      const p = c.GetPattern(nRow);
      const s = bFormula ? c.GetInputString(nRow) : c.GetString(nRow);
      const nFont = p.GetItem('ATTR_FONT_HEIGHT');
      const w = Math.max(...s.split('\n').map((l) => l.length)) * nFont * 0.55 + p.GetItem('ATTR_MARGIN').left + p.GetItem('ATTR_MARGIN').right + p.GetItem('ATTR_INDENT');
      nWidth = Math.max(nWidth, Math.ceil(w));
    });
    return nWidth ? nWidth + 113 /* STD_EXTRA_WIDTH */ : STD_COL_WIDTH;
  }

  // --- hidden rows and columns ------------------------------------------------------------------

  RowHidden(nRow: SCROW): boolean { return this.mpHiddenRows.getValue(nRow); }
  /** Whether the row is hidden, with the range of rows of the same state. */
  RowHiddenRange(nRow: SCROW): { bHidden: boolean; nFirstRow: SCROW; nLastRow: SCROW } {
    const r = this.mpHiddenRows.getRangeData(nRow);
    return { bHidden: r.mnValue, nFirstRow: r.mnPos1, nLastRow: r.mnPos2 };
  }
  ColHidden(nCol: SCCOL): boolean { return this.mpHiddenCols.getValue(nCol); }
  SetRowHidden(nStartRow: SCROW, nEndRow: SCROW, bHidden: boolean): boolean {
    const bChanged = [...this.mpHiddenRows.runs(nStartRow, nEndRow)].some((r) => r.mnValue !== bHidden);
    this.mpHiddenRows.setValue(nStartRow, nEndRow, bHidden);
    return bChanged;
  }
  SetColHidden(nStartCol: SCCOL, nEndCol: SCCOL, bHidden: boolean): boolean {
    const bChanged = [...this.mpHiddenCols.runs(nStartCol, nEndCol)].some((r) => r.mnValue !== bHidden);
    this.mpHiddenCols.setValue(nStartCol, nEndCol, bHidden);
    return bChanged;
  }
  ShowRow(nRow: SCROW, bShow: boolean): void { this.SetRowHidden(nRow, nRow, !bShow); }
  ShowRows(nRow1: SCROW, nRow2: SCROW, bShow: boolean): void { this.SetRowHidden(nRow1, nRow2, !bShow); }
  ShowCol(nCol: SCCOL, bShow: boolean): void { this.SetColHidden(nCol, nCol, !bShow); }
  RowFiltered(nRow: SCROW): boolean { return this.mpFilteredRows.getValue(nRow); }
  /** Whether the row is filtered, with the range of rows of the same state. */
  RowFilteredRange(nRow: SCROW): { bFiltered: boolean; nFirstRow: SCROW; nLastRow: SCROW } {
    const r = this.mpFilteredRows.getRangeData(nRow);
    return { bFiltered: r.mnValue, nFirstRow: r.mnPos1, nLastRow: r.mnPos2 };
  }
  /** The filtered state of the rows (for undo of a filter). */
  GetFilteredRowsState(): ScFlatSegments<boolean> { return this.mpFilteredRows.clone(); }
  SetFilteredRowsState(s: ScFlatSegments<boolean>): void { this.mpFilteredRows = s.clone(); }

  /** Show or hide rows for a filter: hidden and filtered (DBShowRows, table2.cxx). */
  DBShowRows(nRow1: SCROW, nRow2: SCROW, bShow: boolean): void {
    let nStartRow = nRow1;
    while (nStartRow <= nRow2) {
      let nEndRow = this.RowHiddenRange(nStartRow).nLastRow;
      if (nEndRow > nRow2) nEndRow = nRow2;

      this.SetRowHidden(nStartRow, nEndRow, !bShow);
      this.SetRowFiltered(nStartRow, nEndRow, !bShow);

      nStartRow = nEndRow + 1;
    }
  }

  /** The conditional formats of the sheet (mpCondFormatList). */
  GetCondFormList(): ScConditionalFormatList { return this.mpCondFormatList; }
  SetCondFormList(pList: ScConditionalFormatList): void { this.mpCondFormatList = pList; }

  /** The sheet-local anonymous database range (pDBDataNoName). */
  GetAnonymousDBData(): ScDBData | null { return this.pDBDataNoName; }
  SetAnonymousDBData(pDBData: ScDBData | null): void { this.pDBDataNoName = pDBData; }
  SetRowFiltered(nStartRow: SCROW, nEndRow: SCROW, bFiltered: boolean): void { this.mpFilteredRows.setValue(nStartRow, nEndRow, bFiltered); }
  /** The count of visible rows in a range. */
  CountVisibleRows(nStartRow: SCROW, nEndRow: SCROW): number {
    let n = 0;
    for (const r of this.mpHiddenRows.runs(nStartRow, nEndRow)) if (!r.mnValue) n += r.mnPos2 - r.mnPos1 + 1;
    return n;
  }
  /** The last hidden row of the run starting at nRow, -1 if nRow is visible. */
  LastHiddenRow(nRow: SCROW): SCROW {
    const r = this.mpHiddenRows.getRangeData(nRow);
    return r.mnValue ? r.mnPos2 : -1;
  }
  FirstVisibleRow(nStartRow: SCROW, nEndRow: SCROW): SCROW {
    for (const r of this.mpHiddenRows.runs(nStartRow, nEndRow)) if (!r.mnValue) return r.mnPos1;
    return -1;
  }

  // --- page breaks (table5.cxx) ------------------------------------------------------------------

  InvalidatePageBreaks(): void { this.mbPageBreaksValid = false; }

  /**
   * UpdatePageBreaks: the automatic page breaks of the print area (or of pUserArea) for the page
   * size ScPrintFunc set (SetPageSize), with the manual breaks and the repeated rows and columns.
   */
  UpdatePageBreaks(pUserArea: ScRange | null = null): void {
    if (this.rDocument.IsImportingXML()) return;

    // pUserArea != NULL -> print area is specified.  We need to force-update
    // the page breaks.

    if (!pUserArea) {
      if (!this.bPageSizeValid) return;

      // Always update breaks if force breaks option has changed
      if (this.mbPageBreaksValid && this.mbForceBreaks === GetPrintOptions().GetForceBreaks()) return;
    }

    const pStyle = this.rDocument.GetStyleSheetPool().Find(this.aPageStyle, 'Page');
    if (!pStyle) return; // OSL_FAIL("UpdatePageBreaks: Style not found")
    const pStyleSet = pStyle.GetItemSet();

    let nStartCol: SCCOL = 0;
    let nStartRow: SCROW = 0;
    let nEndCol: SCCOL = this.rDocument.MaxCol();
    let nEndRow: SCROW = this.rDocument.MaxRow();
    if (pUserArea) {
      nStartCol = pUserArea.aStart.Col();
      nStartRow = pUserArea.aStart.Row();
      nEndCol = pUserArea.aEnd.Col();
      nEndRow = pUserArea.aEnd.Row();
    } else {
      const nAreaCount = this.GetPrintRangeCount();
      if (nAreaCount > 1) {
        // Show nothing, when multiple ranges

        for (const nX of [...this.maColPageBreaks]) this.RemoveColBreak(nX, true, false);

        this.RemoveRowPageBreaks(0, this.rDocument.MaxRow() - 1);

        return;
      } else if (nAreaCount === 1) {
        const pArea = this.GetPrintRange(0);
        if (pArea) {
          nStartCol = pArea.aStart.Col();
          nStartRow = pArea.aStart.Row();
          nEndCol = pArea.aEnd.Col();
          nEndRow = pArea.aEnd.Row();
        }
      } // otherwise show everything
    }

    // get bSkipColBreaks/bSkipRowBreaks flags:
    // fdo#40788 - print range scale settings can cause manual breaks to be
    // ignored (see below). This behaviour may now be set by the user.
    this.mbForceBreaks = GetPrintOptions().GetForceBreaks();
    let bSkipColBreaks = false;
    let bSkipRowBreaks = false;

    if (!this.mbForceBreaks) {
      if (pStyleSet.ATTR_PAGE_SCALETOPAGES !== undefined) bSkipColBreaks = bSkipRowBreaks = pStyleSet.ATTR_PAGE_SCALETOPAGES > 0;

      const pScaleToItem = pStyleSet.ATTR_PAGE_SCALETO;
      if (!bSkipColBreaks && pScaleToItem) {
        // #i54993# when fitting to width or height, ignore only manual breaks in that direction
        if (pScaleToItem.nWidth > 0) bSkipColBreaks = true;
        if (pScaleToItem.nHeight > 0) bSkipRowBreaks = true;
      }
    }

    let nPageSizeX = this.aPageSizeTwips.Width;
    let nPageSizeY = this.aPageSizeTwips.Height;

    //  Beginning: Remove breaks

    for (const nX of [...this.maColPageBreaks]) if (nX <= nStartCol - 1) this.RemoveColBreak(nX, true, false);
    this.RemoveRowPageBreaks(0, nStartRow - 1);

    if (nStartCol > 0) this.SetColBreak(nStartCol, true, false); // AREABREAK
    if (nStartRow > 0) this.SetRowBreak(nStartRow, true, false); // AREABREAK

    //  Middle part: Distribute breaks

    const bRepeatCol = this.nRepeatStartX !== SCCOL_REPEAT_NONE;
    let bColFound = false;
    let nSizeX = 0;
    for (let nX = nStartCol; nX <= nEndCol; nX++) {
      let bStartOfPage = false;
      const nThisX = this.ColHidden(nX) ? 0 : this.mpColWidth.getValue(nX);
      const bManualBreak = this.HasColManualBreak(nX);
      if (nSizeX + nThisX > nPageSizeX || (bManualBreak && !bSkipColBreaks)) {
        this.SetColBreak(nX, true, false);
        nSizeX = 0;
        bStartOfPage = true;
      } else if (nX !== nStartCol) this.RemoveColBreak(nX, true, false);
      else bStartOfPage = true;

      if (bStartOfPage && bRepeatCol && nX > this.nRepeatStartX && !bColFound) {
        // subtract size of repeat columns from page size
        for (let i = this.nRepeatStartX; i <= this.nRepeatEndX; i++) nPageSizeX -= this.ColHidden(i) ? 0 : this.mpColWidth.getValue(i);
        while (nX <= this.nRepeatEndX) this.RemoveColBreak(++nX, true, false);
        bColFound = true;
      }

      nSizeX += nThisX;
    }

    // Remove all page breaks in range.
    this.RemoveRowPageBreaks(nStartRow + 1, nEndRow);

    // And set new page breaks.
    const bRepeatRow = this.nRepeatStartY !== SCROW_REPEAT_NONE;
    let bRowFound = false;
    let nSizeY = 0;
    let nNextManualBreak = this.GetNextManualBreak(nStartRow); // -1 => no more manual breaks
    for (let nY = nStartRow; nY <= nEndRow; ++nY) {
      let bStartOfPage = false;
      const aHidden = this.mpHiddenRows.getRangeData(nY);
      const bThisRowHidden = aHidden.mnValue;
      const aHeight = this.mpRowHeights.getRangeData(nY);
      let nThisY = 0;
      if (!bThisRowHidden) nThisY = aHeight.mnValue;

      let bManualBreak = false;
      if (nNextManualBreak >= 0) {
        bManualBreak = nY === nNextManualBreak;
        if (nY >= nNextManualBreak)
          // Query the next manual break position.
          nNextManualBreak = this.GetNextManualBreak(nY + 1);
      }

      if (nSizeY + nThisY > nPageSizeY || (bManualBreak && !bSkipRowBreaks)) {
        this.SetRowBreak(nY, true, false);
        nSizeY = 0;
        bStartOfPage = true;
      } else if (nY !== nStartRow) {
        // page break already removed
      } else bStartOfPage = true;

      if (bStartOfPage && bRepeatRow && nY > this.nRepeatStartY && !bRowFound) {
        // subtract size of repeat rows from page size
        const nHeights = this.GetRowHeightRange(this.nRepeatStartY, this.nRepeatEndY);
        nPageSizeY -= nHeights;
        if (nY <= this.nRepeatEndY) this.RemoveRowPageBreaks(nY, this.nRepeatEndY);
        bRowFound = true;
      }

      if (bThisRowHidden) {
        // Hidden row range.  Skip them unless there is a manual break.
        let nLastCommon = aHidden.mnPos2;
        if (nNextManualBreak >= 0) nLastCommon = Math.min(nLastCommon, nNextManualBreak - 1);
        nY = nLastCommon;
      } else {
        // Visible row range.

        const nLastHidden = aHidden.mnPos2;
        const nLastHeight = aHeight.mnPos2;
        let nLastCommon = Math.min(nLastHidden, nLastHeight);
        if (nNextManualBreak >= 0) nLastCommon = Math.min(nLastCommon, nNextManualBreak - 1);

        if (nLastCommon > nY && nThisY > 0) {
          const nMaxMultiple = nLastCommon - nY;
          let nMultiple = Math.trunc((nPageSizeY - nSizeY) / nThisY);
          if (nMultiple > nMaxMultiple) nMultiple = nMaxMultiple;
          if (nMultiple > 1) {
            nSizeY += nThisY * (nMultiple - 1);
            nY += nMultiple - 1;
          }
        }
      }

      nSizeY += nThisY;
    }

    //  End: Remove Break

    if (nEndCol < this.rDocument.MaxCol()) {
      this.SetColBreak(nEndCol + 1, true, false); // AREABREAK
      for (const nCol of [...this.maColPageBreaks]) if (nCol >= nEndCol + 2) this.RemoveColBreak(nCol, true, false);
    }
    if (nEndRow < this.rDocument.MaxRow()) {
      this.SetRowBreak(nEndRow + 1, true, false); // AREABREAK
      if (nEndRow + 2 <= this.rDocument.MaxRow()) this.RemoveRowPageBreaks(nEndRow + 2, this.rDocument.MaxRow());
    }
    this.mbPageBreaksValid = !pUserArea; // #i116881# the valid flag can only apply to the "no user area" case
  }

  RemoveManualBreaks(): void {
    this.maRowManualBreaks.clear();
    this.maColManualBreaks.clear();
    this.InvalidatePageBreaks();
  }

  HasManualBreaks(): boolean { return this.maRowManualBreaks.size > 0 || this.maColManualBreaks.size > 0; }

  SetRowManualBreaks(rBreaks: Iterable<SCROW>): void {
    this.maRowManualBreaks = new Set(rBreaks);
    this.InvalidatePageBreaks();
  }

  SetColManualBreaks(rBreaks: Iterable<SCCOL>): void {
    this.maColManualBreaks = new Set(rBreaks);
    this.InvalidatePageBreaks();
  }

  /** The row breaks, sorted: the automatic (bPage) and the manual ones (bManual). */
  GetAllRowBreaks(bPage: boolean, bManual: boolean): SCROW[] {
    const rBreaks = new Set<SCROW>(bPage ? this.maRowPageBreaks : []);
    if (bManual) for (const r of this.maRowManualBreaks) rBreaks.add(r);
    return [...rBreaks].sort((a, b) => a - b);
  }

  GetAllColBreaks(bPage: boolean, bManual: boolean): SCCOL[] {
    const rBreaks = new Set<SCCOL>(bPage ? this.maColPageBreaks : []);
    if (bManual) for (const c of this.maColManualBreaks) rBreaks.add(c);
    return [...rBreaks].sort((a, b) => a - b);
  }

  HasRowPageBreak(nRow: SCROW): boolean { return this.ValidRow(nRow) && this.maRowPageBreaks.has(nRow); }
  HasColPageBreak(nCol: SCCOL): boolean { return this.ValidCol(nCol) && this.maColPageBreaks.has(nCol); }
  HasRowManualBreak(nRow: SCROW): boolean { return this.ValidRow(nRow) && this.maRowManualBreaks.has(nRow); }
  HasColManualBreak(nCol: SCCOL): boolean { return this.ValidCol(nCol) && this.maColManualBreaks.has(nCol); }

  /** The first manual row break at or after nRow, -1 if none. */
  GetNextManualBreak(nRow: SCROW): SCROW {
    let n = -1;
    for (const r of this.maRowManualBreaks) if (r >= nRow && (n < 0 || r < n)) n = r;
    return n;
  }

  RemoveRowPageBreaks(nStartRow: SCROW, nEndRow: SCROW): void {
    if (!this.ValidRow(nStartRow) || !this.ValidRow(nEndRow)) return;
    for (const r of [...this.maRowPageBreaks]) if (r >= nStartRow && r <= nEndRow) this.maRowPageBreaks.delete(r);
  }

  RemoveRowBreak(nRow: SCROW, bPage: boolean, bManual: boolean): void {
    if (!this.ValidRow(nRow)) return;
    if (bPage) this.maRowPageBreaks.delete(nRow);
    if (bManual) {
      this.maRowManualBreaks.delete(nRow);
      this.InvalidatePageBreaks();
    }
  }

  RemoveColBreak(nCol: SCCOL, bPage: boolean, bManual: boolean): void {
    if (!this.ValidCol(nCol)) return;
    if (bPage) this.maColPageBreaks.delete(nCol);
    if (bManual) {
      this.maColManualBreaks.delete(nCol);
      this.InvalidatePageBreaks();
    }
  }

  SetRowBreak(nRow: SCROW, bPage: boolean, bManual: boolean): void {
    if (!this.ValidRow(nRow)) return;
    if (bPage) this.maRowPageBreaks.add(nRow);
    if (bManual) {
      this.maRowManualBreaks.add(nRow);
      this.InvalidatePageBreaks();
    }
  }

  SetColBreak(nCol: SCCOL, bPage: boolean, bManual: boolean): void {
    if (!this.ValidCol(nCol)) return;
    if (bPage) this.maColPageBreaks.add(nCol);
    if (bManual) {
      this.maColManualBreaks.add(nCol);
      this.InvalidatePageBreaks();
    }
  }

  SetPageSize(rSize: { Width: number; Height: number }): void {
    if (rSize.Width > 0 && rSize.Height > 0) {
      if (this.aPageSizeTwips.Width !== rSize.Width || this.aPageSizeTwips.Height !== rSize.Height) this.InvalidatePageBreaks();
      this.bPageSizeValid = true;
      this.aPageSizeTwips = { Width: rSize.Width, Height: rSize.Height };
    } else this.bPageSizeValid = false;
  }

  GetPageSize(): { Width: number; Height: number } {
    if (this.bPageSizeValid) return { ...this.aPageSizeTwips };
    return { Width: 0, Height: 0 }; // blank
  }

  SetRepeatArea(nStartCol: SCCOL, nEndCol: SCCOL, nStartRow: SCROW, nEndRow: SCROW): void {
    // #i117952# page break calculation uses these values (set from ScPrintFunc), not pRepeatColRange/pRepeatRowRange
    if (nStartCol !== this.nRepeatStartX || nEndCol !== this.nRepeatEndX || nStartRow !== this.nRepeatStartY || nEndRow !== this.nRepeatEndY) this.InvalidatePageBreaks();

    this.nRepeatStartX = nStartCol;
    this.nRepeatEndX = nEndCol;
    this.nRepeatStartY = nStartRow;
    this.nRepeatEndY = nEndRow;
  }

  /** The manual breaks (ODS import and export, the undo of breaks). */
  GetRowManualBreaks(): SCROW[] { return [...this.maRowManualBreaks].sort((a, b) => a - b); }
  GetColManualBreaks(): SCCOL[] { return [...this.maColManualBreaks].sort((a, b) => a - b); }

  // --- print area (table1.cxx) -------------------------------------------------------------------

  /** GetPrintAreaHor: the last column with visible attributes or data in rows nStartRow..nEndRow. */
  GetPrintAreaHor(nStartRow: SCROW, nEndRow: SCROW): { bFound: boolean; rEndCol: SCCOL } {
    let bFound = false;
    let nMaxX = 0;
    let i: SCCOL;

    for (i = 0; i < this.aCol.length; i++) { // Test attribute
      if (this.aCol[i]!.pAttrArray.HasVisibleAttrIn(nStartRow, nEndRow)) {
        bFound = true;
        nMaxX = i;
      }
    }

    if (nMaxX === this.rDocument.MaxCol()) { // omit attribute at the right
      --nMaxX;
      while (nMaxX > 0 && this.aCol[nMaxX]!.pAttrArray.IsVisibleEqual(this.aCol[nMaxX + 1]!.pAttrArray, nStartRow, nEndRow)) --nMaxX;
    }

    for (i = 0; i < this.aCol.length; i++) { // test the data
      if (!this.aCol[i]!.IsEmptyBlock(nStartRow, nEndRow)) {
        bFound = true;
        if (i > nMaxX) nMaxX = i;
      }
    }

    return { bFound, rEndCol: nMaxX };
  }

  /** GetPrintAreaVer: the last row with visible attributes or data in columns nStartCol..nEndCol. */
  GetPrintAreaVer(nStartCol: SCCOL, nEndCol: SCCOL, bNotes: boolean): { bFound: boolean; rEndRow: SCROW } {
    let bFound = false;
    let nMaxY = 0;
    let i: SCCOL;

    const bSkipEmpty = GetPrintOptions().GetSkipEmpty();

    for (i = nStartCol; i <= nEndCol && i < this.aCol.length; i++) { // Test attribute
      const c = this.aCol[i]!;
      const r = c.pAttrArray.GetLastVisibleAttr(c.GetLastDataPos(), bSkipEmpty);
      if (r.bFound) {
        bFound = true;
        if (r.rLastRow > nMaxY) nMaxY = r.rLastRow;
      }
    }

    for (i = nStartCol; i <= nEndCol && i < this.aCol.length; i++) { // Test data
      const c = this.aCol[i]!;
      if (!c.IsEmptyData()) {
        bFound = true;
        const nColY = c.GetLastDataPos();
        if (nColY > nMaxY) nMaxY = nColY;
      }
      if (bNotes && c.HasCellNotes()) {
        const aRows = c.GetNoteRows();
        const maxNoteRow = aRows[aRows.length - 1]!;
        if (maxNoteRow > nMaxY) {
          bFound = true;
          nMaxY = maxNoteRow;
        }
      }
    }

    return { bFound, rEndRow: nMaxY };
  }

  /**
   * ExtendPrintArea: rEndCol grows to the columns that texts overflowing their cells reach
   * (MaybeAddExtraColumn); the text widths come from pMeasurer, in twips.
   */
  ExtendPrintArea(pMeasurer: TextMeasurer | null, nStartRow: SCROW, rEndCol: SCCOL, nEndRow: SCROW): SCCOL {
    if (!pMeasurer) return rEndCol;
    for (let nDataCol = Math.min(rEndCol, this.aCol.length - 1); nDataCol >= 0; --nDataCol) {
      if (this.ColHidden(nDataCol)) continue;
      const c = this.aCol[nDataCol]!;
      if (c.IsEmptyBlock(nStartRow, nEndRow)) continue;
      let nPrintCol = nDataCol;
      c.ForEachCell(nStartRow, nEndRow, (nRow) => {
        if (this.RowHidden(nRow)) return;
        const nNewCol = this.MaybeAddExtraColumn(nDataCol, nRow, pMeasurer);
        if (nNewCol > nPrintCol) nPrintCol = nNewCol;
      });
      if (nPrintCol > rEndCol)
        // Make sure we don't shrink the print area.
        rEndCol = nPrintCol;
    }
    return rEndCol;
  }

  private MaybeAddExtraColumn(rCol: SCCOL, nRow: SCROW, pMeasurer: TextMeasurer): SCCOL {
    // tdf#128873 we do not need to calculate text width (heavy operation)
    // when we for sure know that an additional column will not be added
    if (this.GetAllocatedColumnsCount() > rCol + 1) {
      if (this.aCol[rCol + 1]!.HasDataAt(nRow)) return rCol; // return rCol as is
    }

    const rColumn = this.aCol[rCol]!;
    const aCell = rColumn.GetCellValue(nRow);
    if (!aCell.hasString()) return rCol;

    const pPattern = this.GetPattern(rCol, nRow);
    if (pPattern.GetItem('ATTR_LINEBREAK')) return rCol;
    const aFont = { family: pPattern.GetItem('ATTR_FONT'), size: pPattern.GetItem('ATTR_FONT_HEIGHT'), bold: pPattern.GetItem('ATTR_FONT_WEIGHT'), italic: pPattern.GetItem('ATTR_FONT_POSTURE') };
    const aMargin = pPattern.GetItem('ATTR_MARGIN');
    const nTwips = Math.max(...rColumn.GetString(nRow).split('\n').map((l) => pMeasurer.GetTextWidth(aFont, l))) + aMargin.left + aMargin.right + pPattern.GetItem('ATTR_INDENT');
    const nDocW = this.GetColWidth(rCol);

    let nMissing = nTwips - nDocW;
    if (nMissing > 0) {
      //  look at alignment

      const eHorJust = pPattern.GetItem('ATTR_HOR_JUSTIFY');
      if (eHorJust === 'Center') nMissing /= 2; // distributed into both directions
      else {
        // STANDARD is LEFT (only text is handled here)
        let bRight = eHorJust === 'Right';
        if (this.IsLayoutRTL()) bRight = !bRight;
        if (bRight) nMissing = 0; // extended only to the left (logical)
      }
    }

    let nNewCol = rCol;
    while (nMissing > 0 && nNewCol < this.rDocument.MaxCol()) {
      const nNextCol = nNewCol + 1;
      let bNextEmpty = true;
      if (this.GetAllocatedColumnsCount() > nNextCol) bNextEmpty = !this.aCol[nNextCol]!.HasDataAt(nRow);
      if (!bNextEmpty)
        // Cell content in a next column ends display of this string.
        nMissing = 0;
      else nMissing -= this.GetColWidth(++nNewCol);
    }
    return nNewCol;
  }

  // --- attributes -------------------------------------------------------------------------------

  GetPattern(nCol: SCCOL, nRow: SCROW): ScPatternAttr {
    const c = this.FetchColumn(nCol);
    if (c) return c.GetPattern(nRow);
    return this.rDocument.getCellAttributeHelper().getDefaultCellAttribute();
  }

  GetAttr<K extends ScItemId>(nCol: SCCOL, nRow: SCROW, nWhich: K): ScItems[K] { return this.GetPattern(nCol, nRow).GetItem(nWhich); }

  GetNumberFormat(nCol: SCCOL, nRow: SCROW): string { return this.GetPattern(nCol, nRow).GetNumberFormat(); }

  ApplyAttr(nCol: SCCOL, nRow: SCROW, rItems: ScItemSet): void {
    if (this.ValidColRow(nCol, nRow)) this.CreateColumnIfNotExists(nCol).ApplyAttr(nRow, rItems);
  }

  ApplyPatternArea(nStartCol: SCCOL, nStartRow: SCROW, nEndCol: SCCOL, nEndRow: SCROW, rItems: ScItemSet): void {
    if (!this.ValidColRow(nStartCol, nStartRow) || !this.ValidColRow(nEndCol, nEndRow)) return;
    for (let i = nStartCol; i <= nEndCol; i++) this.CreateColumnIfNotExists(i).ApplyPatternArea(nStartRow, nEndRow, rItems);
  }

  SetPatternArea(nStartCol: SCCOL, nStartRow: SCROW, nEndCol: SCCOL, nEndRow: SCROW, pPattern: ScPatternAttr): void {
    for (let i = nStartCol; i <= nEndCol; i++) this.CreateColumnIfNotExists(i).SetPatternArea(nStartRow, nEndRow, pPattern);
  }

  ApplyStyleArea(nStartCol: SCCOL, nStartRow: SCROW, nEndCol: SCCOL, nEndRow: SCROW, rStyle: ScStyleSheet): void {
    for (let i = nStartCol; i <= nEndCol; i++) this.CreateColumnIfNotExists(i).ApplyStyleArea(nStartRow, nEndRow, rStyle);
  }

  ClearItems(nStartCol: SCCOL, nStartRow: SCROW, nEndCol: SCCOL, nEndRow: SCROW, aWhich: readonly ScItemId[]): void {
    for (let i = nStartCol; i <= this.ClampToAllocatedColumns(nEndCol); i++) this.aCol[i]!.ClearItems(nStartRow, nEndRow, aWhich);
  }

  HasAttrib(nCol1: SCCOL, nRow1: SCROW, nCol2: SCCOL, nRow2: SCROW, nMask: HasAttrFlags): boolean {
    for (let i = nCol1; i <= this.ClampToAllocatedColumns(nCol2); i++) if (this.aCol[i]!.HasAttrib(nRow1, nRow2, nMask)) return true;
    return false;
  }

  ApplyFlags(nStartCol: SCCOL, nStartRow: SCROW, nEndCol: SCCOL, nEndRow: SCROW, nFlags: number): boolean {
    let bChanged = false;
    for (let i = nStartCol; i <= nEndCol; i++) bChanged = this.CreateColumnIfNotExists(i).ApplyFlags(nStartRow, nEndRow, nFlags) || bChanged;
    return bChanged;
  }

  RemoveFlags(nStartCol: SCCOL, nStartRow: SCROW, nEndCol: SCCOL, nEndRow: SCROW, nFlags: number): boolean {
    let bChanged = false;
    for (let i = nStartCol; i <= this.ClampToAllocatedColumns(nEndCol); i++) bChanged = this.aCol[i]!.RemoveFlags(nStartRow, nEndRow, nFlags) || bChanged;
    return bChanged;
  }

  // --- merged cells -----------------------------------------------------------------------------

  /** Merge a block: the origin gets ATTR_MERGE, the rest the overlap flags (ScDocument::DoMerge). */
  DoMerge(nStartCol: SCCOL, nStartRow: SCROW, nEndCol: SCCOL, nEndRow: SCROW): void {
    this.ApplyAttr(nStartCol, nStartRow, { ATTR_MERGE: { nColMerge: nEndCol - nStartCol + 1, nRowMerge: nEndRow - nStartRow + 1 } });
    if (nEndCol > nStartCol) this.ApplyFlags(nStartCol + 1, nStartRow, nEndCol, nStartRow, ScMF.Hor);
    if (nEndRow > nStartRow) this.ApplyFlags(nStartCol, nStartRow + 1, nStartCol, nEndRow, ScMF.Ver);
    if (nEndCol > nStartCol && nEndRow > nStartRow) this.ApplyFlags(nStartCol + 1, nStartRow + 1, nEndCol, nEndRow, ScMF.Hor | ScMF.Ver);
  }

  /** Remove the merge of the cell at the origin (ScDocument::RemoveMerge). */
  RemoveMerge(nCol: SCCOL, nRow: SCROW): void {
    const rAttr = this.GetAttr(nCol, nRow, 'ATTR_MERGE');
    if (rAttr.nColMerge <= 1 && rAttr.nRowMerge <= 1) return;
    const nEndCol = nCol + Math.max(1, rAttr.nColMerge) - 1;
    const nEndRow = nRow + Math.max(1, rAttr.nRowMerge) - 1;
    this.RemoveFlags(nCol, nRow, nEndCol, nEndRow, ScMF.Hor | ScMF.Ver);
    this.ApplyAttr(nCol, nRow, { ATTR_MERGE: { nColMerge: 0, nRowMerge: 0 } });
  }

  /** Extend a position to the end of the merged cell starting there (ExtendMerge). */
  ExtendMerge(nStartCol: SCCOL, nStartRow: SCROW, nEndCol: SCCOL, nEndRow: SCROW): { nEndCol: SCCOL; nEndRow: SCROW; bFound: boolean } {
    let bFound = false;
    for (let nCol = nStartCol; nCol <= this.ClampToAllocatedColumns(nEndCol); nCol++) {
      const c = this.aCol[nCol]!;
      for (const e of c.pAttrArray.CopyArea(nStartRow, nEndRow)) {
        if (!e.pPattern.IsMerged()) continue;
        const m = e.pPattern.GetItem('ATTR_MERGE');
        for (let nRow = nStartRow + e.nStart; nRow <= nStartRow + e.nEnd; nRow++) {
          const nMergeEndCol = nCol + m.nColMerge - 1;
          const nMergeEndRow = nRow + m.nRowMerge - 1;
          if (nMergeEndCol > nEndCol) { nEndCol = nMergeEndCol; bFound = true; }
          if (nMergeEndRow > nEndRow) { nEndRow = nMergeEndRow; bFound = true; }
          bFound = true;
        }
      }
    }
    return { nEndCol, nEndRow, bFound };
  }

  /** The origin of the merged cell covering a position (overlapped cells search back). */
  GetMergeOrigin(nCol: SCCOL, nRow: SCROW): { nCol: SCCOL; nRow: SCROW } {
    let nFlag = this.GetAttr(nCol, nRow, 'ATTR_MERGE_FLAG');
    while (nFlag & ScMF.Hor && nCol > 0) { nCol--; nFlag = this.GetAttr(nCol, nRow, 'ATTR_MERGE_FLAG'); }
    while (nFlag & ScMF.Ver && nRow > 0) { nRow--; nFlag = this.GetAttr(nCol, nRow, 'ATTR_MERGE_FLAG'); }
    return { nCol, nRow };
  }

  // --- used area --------------------------------------------------------------------------------

  /** The last column and row with data (GetCellArea); false if the sheet has no cells. */
  GetCellArea(): { nEndCol: SCCOL; nEndRow: SCROW; bFound: boolean } {
    let nMaxX = 0, nMaxY = 0, bFound = false;
    for (let i = 0; i < this.aCol.length; i++) {
      const c = this.aCol[i]!;
      if (!c.IsEmptyData()) {
        bFound = true;
        nMaxX = i;
        nMaxY = Math.max(nMaxY, c.GetLastDataPos());
      }
      if (c.HasCellNotes()) {
        const r = c.GetNoteRows();
        bFound = true;
        nMaxX = Math.max(nMaxX, i);
        nMaxY = Math.max(nMaxY, r[r.length - 1]!);
      }
    }
    return { nEndCol: nMaxX, nEndRow: nMaxY, bFound };
  }

  /** The first column and row with data (GetDataStart). */
  GetDataStart(): { nStartCol: SCCOL; nStartRow: SCROW; bFound: boolean } {
    let nMinX = this.rDocument.MaxCol(), nMinY = this.rDocument.MaxRow(), bFound = false;
    for (let i = 0; i < this.aCol.length; i++) {
      const c = this.aCol[i]!;
      if (!c.IsEmptyData()) {
        bFound = true;
        nMinX = Math.min(nMinX, i);
        nMinY = Math.min(nMinY, c.GetFirstDataPos());
      }
    }
    return { nStartCol: bFound ? nMinX : 0, nStartRow: bFound ? nMinY : 0, bFound };
  }

  /** The area with data or visible attributes (GetPrintArea). */
  GetPrintArea(bNotes = true, bCalcHiddens = false): { nEndCol: SCCOL; nEndRow: SCROW; bFound: boolean } {
    let bFound = false;
    let nMaxX = 0;
    let nMaxY = 0;
    let i: SCCOL;

    const bSkipEmpty = GetPrintOptions().GetSkipEmpty();

    for (i = 0; i < this.aCol.length; i++) { // Test data
      if (bCalcHiddens || !this.ColHidden(i)) {
        const c = this.aCol[i]!;
        if (!c.IsEmptyData()) {
          bFound = true;
          if (i > nMaxX) nMaxX = i;
          const nColY = c.GetLastDataPos();
          if (nColY > nMaxY) nMaxY = nColY;
        }
        if (bNotes && c.HasCellNotes()) {
          const aRows = c.GetNoteRows();
          const maxNoteRow = aRows[aRows.length - 1]!;
          if (maxNoteRow >= nMaxY) {
            bFound = true;
            nMaxY = maxNoteRow;
          }
          if (i > nMaxX) {
            bFound = true;
            nMaxX = i;
          }
        }
      }
    }

    const nMaxDataX = nMaxX;

    for (i = 0; i < this.aCol.length; i++) { // Test attribute
      if (bCalcHiddens || !this.ColHidden(i)) {
        const c = this.aCol[i]!;
        const r = c.pAttrArray.GetLastVisibleAttr(c.GetLastDataPos(), bSkipEmpty);
        if (r.bFound) {
          bFound = true;
          nMaxX = i;
          if (r.rLastRow > nMaxY) nMaxY = r.rLastRow;
        }
      }
    }

    if (nMaxX === this.rDocument.MaxCol()) { // omit attribute at the right
      --nMaxX;
      while (nMaxX > 0 && this.aCol[nMaxX]!.pAttrArray.IsVisibleEqual(this.aCol[nMaxX + 1]!.pAttrArray, 0, this.rDocument.MaxRow())) --nMaxX;
    }

    if (nMaxX < nMaxDataX) {
      nMaxX = nMaxDataX;
    } else if (nMaxX > nMaxDataX) {
      let nAttrStartX = nMaxDataX + 1;
      while (nAttrStartX < this.aCol.length - 1) {
        let nAttrEndX = nAttrStartX;
        while (nAttrEndX < this.aCol.length - 1 && this.aCol[nAttrStartX]!.pAttrArray.IsVisibleEqual(this.aCol[nAttrEndX + 1]!.pAttrArray, 0, this.rDocument.MaxRow())) ++nAttrEndX;
        if (nAttrEndX + 1 - nAttrStartX >= SC_COLUMNS_STOP) {
          // found equally-formatted columns behind data -> stop before these columns
          nMaxX = nAttrStartX - 1;

          // also don't include default-formatted columns before that
          while (nMaxX > nMaxDataX && !this.aCol[nMaxX]!.pAttrArray.GetLastVisibleAttr(this.aCol[nMaxX]!.GetLastDataPos(), bSkipEmpty).bFound) --nMaxX;
          break;
        }
        nAttrStartX = nAttrEndX + 1;
      }
    }

    return { nEndCol: nMaxX, nEndRow: nMaxY, bFound };
  }

  /** The last row with data in a column range (GetLastDataRow). */
  GetLastDataRow(nCol1: SCCOL, nCol2: SCCOL, nLastRow: SCROW): SCROW {
    let n = -1;
    for (let i = nCol1; i <= this.ClampToAllocatedColumns(nCol2); i++) n = Math.max(n, this.aCol[i]!.GetLastDataPos(nLastRow));
    return n;
  }

  /** The count of empty rows (from the top or bottom) or columns (from the left or right) of a
      block (GetEmptyLinesInBlock, table1.cxx; ScColumn::GetEmptyLinesInBlock inlined). */
  GetEmptyLinesInBlock(nStartCol: SCCOL, nStartRow: SCROW, nEndCol: SCCOL, nEndRow: SCROW, eDir: number): number {
    const nStartColOrig = nStartCol;
    const nEndColOrig = nEndCol;
    nStartCol = Math.min(nStartCol, this.aCol.length - 1);
    nEndCol = Math.min(nEndCol, this.aCol.length - 1);
    const bVertical = eDir === 0 /* DIR_BOTTOM */ || eDir === 2; /* DIR_TOP */
    // The region is not allocated and does not contain any data.
    if (nStartColOrig !== nStartCol) return bVertical ? nEndRow - nStartRow + 1 : nEndColOrig - nStartColOrig + 1;
    const nGapRight = nEndColOrig - nEndCol;
    let nCount = 0;
    let nCol: SCCOL;
    if (bVertical) {
      nCount = nEndRow - nStartRow + 1;
      for (nCol = nStartCol; nCol <= nEndCol; nCol++) {
        const c = this.aCol[nCol]!;
        let n: number;
        if (eDir === 2) {
          // Determine the length of empty head segment.
          const nFirst = c.GetNextDataPos(nStartRow - 1);
          n = nFirst < 0 || nFirst > nEndRow ? nEndRow - nStartRow + 1 : nFirst - nStartRow;
        } else {
          // Determine the length of empty tail segment.
          const nLast = c.GetLastDataPos(nEndRow);
          n = nLast < nStartRow ? nEndRow - nStartRow + 1 : nEndRow - nLast;
        }
        nCount = Math.min(nCount, n);
      }
    } else if (eDir === 1 /* DIR_RIGHT */) {
      nCol = nEndCol;
      while (nCol >= nStartCol && this.aCol[nCol]!.IsEmptyBlock(nStartRow, nEndRow)) {
        nCount++;
        nCol--;
      }
      nCount += nGapRight;
    } else {
      nCol = nStartCol;
      while (nCol <= nEndCol && this.aCol[nCol]!.IsEmptyBlock(nStartRow, nEndRow)) {
        nCount++;
        nCol++;
      }
      // If the area between nStartCol and nEndCol are empty,
      // add the count of unallocated columns on the right.
      if (nCol > nEndCol) nCount += nGapRight;
    }
    return nCount;
  }

  /**
   * The contiguous data area around a block (GetDataArea): extend while the next row or column
   * next to the area has data in the area's span.
   */
  GetDataArea(nStartCol: SCCOL, nStartRow: SCROW, nEndCol: SCCOL, nEndRow: SCROW, bIncludeOld: boolean, bOnlyDown: boolean): { nStartCol: SCCOL; nStartRow: SCROW; nEndCol: SCCOL; nEndRow: SCROW } {
    const lim = this.rDocument;
    let bChanged: boolean;
    let s = { nStartCol, nStartRow, nEndCol, nEndRow };
    do {
      bChanged = false;
      if (!bOnlyDown && s.nStartRow > 0 && !this.IsBlockEmpty(Math.max(0, s.nStartCol - 1), s.nStartRow - 1, Math.min(lim.MaxCol(), s.nEndCol + 1), s.nStartRow - 1)) { s.nStartRow--; bChanged = true; }
      if (s.nEndRow < lim.MaxRow() && !this.IsBlockEmpty(Math.max(0, s.nStartCol - 1), s.nEndRow + 1, Math.min(lim.MaxCol(), s.nEndCol + 1), s.nEndRow + 1)) { s.nEndRow++; bChanged = true; }
      if (!bOnlyDown && s.nStartCol > 0 && !this.IsBlockEmpty(s.nStartCol - 1, Math.max(0, s.nStartRow - 1), s.nStartCol - 1, Math.min(lim.MaxRow(), s.nEndRow + 1))) { s.nStartCol--; bChanged = true; }
      if (!bOnlyDown && s.nEndCol < lim.MaxCol() && !this.IsBlockEmpty(s.nEndCol + 1, Math.max(0, s.nStartRow - 1), s.nEndCol + 1, Math.min(lim.MaxRow(), s.nEndRow + 1))) { s.nEndCol++; bChanged = true; }
    } while (bChanged);
    if (!bIncludeOld) {
      // shrink empty borders
      while (s.nStartRow < s.nEndRow && this.IsBlockEmpty(s.nStartCol, s.nStartRow, s.nEndCol, s.nStartRow)) s.nStartRow++;
      while (s.nEndRow > s.nStartRow && this.IsBlockEmpty(s.nStartCol, s.nEndRow, s.nEndCol, s.nEndRow)) s.nEndRow--;
      while (s.nStartCol < s.nEndCol && this.IsBlockEmpty(s.nStartCol, s.nStartRow, s.nStartCol, s.nEndRow)) s.nStartCol++;
      while (s.nEndCol > s.nStartCol && this.IsBlockEmpty(s.nEndCol, s.nStartRow, s.nEndCol, s.nEndRow)) s.nEndCol--;
    }
    return s;
  }

  // --- copying ------------------------------------------------------------------------------------

  /** Copy a block by flags into another table (of the same or another document) at the same
      position (CopyToTable). */
  CopyToTable(nCol1: SCCOL, nRow1: SCROW, nCol2: SCCOL, nRow2: SCROW, nFlags: InsertDeleteFlags, pDestTab: ScTable, bColRowFlags = true): void {
    if (!this.ValidColRow(nCol1, nRow1) || !this.ValidColRow(nCol2, nRow2)) return;
    for (let i = nCol1; i <= nCol2; i++) {
      const c = this.FetchColumn(i);
      // Columns that are not allocated on either side have nothing to copy.
      if (c) c.CopyToColumn(nRow1, nRow2, nFlags, pDestTab.CreateColumnIfNotExists(i));
      else if (nFlags & InsertDeleteFlags.ATTRIB) pDestTab.FetchColumn(i)?.pAttrArray.DeleteArea(nRow1, nRow2);
    }
    if (bColRowFlags) this.CopyColRowFlags(nCol1, nRow1, nCol2, nRow2, pDestTab);
  }

  /** Copy column widths, row heights and hidden states (for whole columns/rows of the block). */
  CopyColRowFlags(nCol1: SCCOL, nRow1: SCROW, nCol2: SCCOL, nRow2: SCROW, pDestTab: ScTable): void {
    if (nRow1 === 0 && nRow2 === this.rDocument.MaxRow()) {
      for (let i = nCol1; i <= nCol2; i++) {
        pDestTab.SetColWidth(i, this.GetOriginalWidth(i));
        pDestTab.SetColHidden(i, i, this.ColHidden(i));
      }
    }
    if (nCol1 === 0 && nCol2 === this.rDocument.MaxCol()) {
      for (const r of this.mpRowHeights.runs(nRow1, nRow2)) pDestTab.mpRowHeights.setValue(r.mnPos1, r.mnPos2, r.mnValue);
      for (const r of this.mpHiddenRows.runs(nRow1, nRow2)) pDestTab.mpHiddenRows.setValue(r.mnPos1, r.mnPos2, r.mnValue);
      for (const r of this.pRowFlags.runs(nRow1, nRow2)) pDestTab.pRowFlags.setValue(r.mnPos1, r.mnPos2, r.mnValue);
    }
  }

  /** The full row height and hidden state data (for undo of SetWidthOrHeight). */
  GetRowHeightsState(): { heights: ScFlatSegments<number>; hidden: ScFlatSegments<boolean>; flags: ScFlatSegments<number> } {
    return { heights: this.mpRowHeights.clone(), hidden: this.mpHiddenRows.clone(), flags: this.pRowFlags.clone() };
  }
  SetRowHeightsState(s: { heights: ScFlatSegments<number>; hidden: ScFlatSegments<boolean>; flags: ScFlatSegments<number> }): void {
    this.mpRowHeights = s.heights.clone();
    this.mpHiddenRows = s.hidden.clone();
    this.pRowFlags = s.flags.clone();
  }
  GetColWidthsState(): { widths: ScFlatSegments<number>; hidden: ScFlatSegments<boolean> } {
    return { widths: this.mpColWidth.clone(), hidden: this.mpHiddenCols.clone() };
  }
  SetColWidthsState(s: { widths: ScFlatSegments<number>; hidden: ScFlatSegments<boolean> }): void {
    this.mpColWidth = s.widths.clone();
    this.mpHiddenCols = s.hidden.clone();
  }

  /**
   * GetRowHeight(nRow, pStartRow, pEndRow, bHiddenAsZero): a row's height and the rows around it
   * that have the same height and visibility.
   */
  GetRowHeightRun(nRow: SCROW, bHiddenAsZero = true): { nHeight: number; nStartRow: SCROW; nEndRow: SCROW } {
    const h = this.mpRowHeights.getRangeData(nRow);
    const hid = this.mpHiddenRows.getRangeData(nRow);
    if (bHiddenAsZero && hid.mnValue) return { nHeight: 0, nStartRow: hid.mnPos1, nEndRow: hid.mnPos2 };
    if (!bHiddenAsZero) return { nHeight: h.mnValue, nStartRow: h.mnPos1, nEndRow: h.mnPos2 };
    return { nHeight: h.mnValue, nStartRow: Math.max(h.mnPos1, hid.mnPos1), nEndRow: Math.min(h.mnPos2, hid.mnPos2) };
  }

  /** ColHidden(nCol, pFirstCol, pLastCol): whether hidden, and the columns of the same state. */
  ColHiddenRange(nCol: SCCOL): { bHidden: boolean; nFirstCol: SCCOL; nLastCol: SCCOL } {
    const r = this.mpHiddenCols.getRangeData(nCol);
    return { bHidden: r.mnValue, nFirstCol: r.mnPos1, nLastCol: r.mnPos2 };
  }

  FindNextVisibleCol(nCol: SCCOL, bRight: boolean): SCCOL {
    if (bRight) {
      nCol++;
      const r = this.ColHiddenRange(Math.min(nCol, this.rDocument.MaxCol()));
      if (r.bHidden) nCol = r.nLastCol + 1;

      return Math.min(this.rDocument.MaxCol(), nCol);
    }
    nCol--;
    const r = this.ColHiddenRange(Math.max(nCol, 0));
    if (r.bHidden) nCol = r.nFirstCol - 1;

    return Math.max(0, nCol);
  }

  FindNextVisibleColWithContent(nCol: SCCOL, bRight: boolean, nRow: SCROW): SCCOL {
    const nLastCol = this.aCol.length - 1;
    if (bRight) {
      // If nCol is the last allocated column index, there won't be any content to its right.
      // To maintain the original return behaviour, return rDocument.MaxCol().
      if (nCol >= nLastCol) return this.rDocument.MaxCol();

      do {
        nCol++;
        const r = this.ColHiddenRange(nCol);
        if (r.bHidden) {
          nCol = r.nLastCol + 1;
          // Can end search early as there is no data after nLastCol.
          // For nCol == nLastCol, it may still have data so don't want to return rDocument.MaxCol().
          if (nCol > nLastCol) return this.rDocument.MaxCol();
        }

        if (this.aCol[nCol]!.HasVisibleDataAt(nRow)) return nCol;
      } while (nCol < nLastCol); // Stop search as soon as the last allocated column is searched.

      return this.rDocument.MaxCol();
    }
    if (nCol === 0) return 0;

    // If nCol is in the unallocated range [nLastCol+1, rDocument.MaxCol()], then move it directly after nLastCol
    // as there is no data in the unallocated range. This also makes the search faster and avoids
    // the need for more range checks in the loop below.
    if (nCol > nLastCol) nCol = nLastCol + 1;

    do {
      nCol--;
      const r = this.ColHiddenRange(Math.max(nCol, 0));
      if (r.bHidden) {
        nCol = r.nFirstCol - 1;
        if (nCol <= 0) return 0;
      }

      if (this.aCol[nCol]!.HasVisibleDataAt(nRow)) return nCol;
    } while (nCol > 0);

    return 0;
  }

  /** FindAreaPos: Ctrl+arrow's target, the edge of the data block or the next data. */
  FindAreaPos(rCol: SCCOL, rRow: SCROW, eDirection: number): { rCol: SCCOL; rRow: SCROW } {
    const nLastCol = this.aCol.length - 1;

    if (eDirection === ScMoveDirection.SC_MOVE_LEFT || eDirection === ScMoveDirection.SC_MOVE_RIGHT) {
      let nNewCol = rCol;
      const bThere = nNewCol <= nLastCol && this.aCol[nNewCol]!.HasVisibleDataAt(rRow);
      const bRight = eDirection === ScMoveDirection.SC_MOVE_RIGHT;
      if (bThere) {
        if (nNewCol >= this.rDocument.MaxCol() && eDirection === ScMoveDirection.SC_MOVE_RIGHT) return { rCol, rRow };
        else if (nNewCol === 0 && eDirection === ScMoveDirection.SC_MOVE_LEFT) return { rCol, rRow };

        let nNextCol = this.FindNextVisibleCol(nNewCol, bRight);

        if (nNextCol <= nLastCol && this.aCol[nNextCol]!.HasVisibleDataAt(rRow)) {
          let bFound = false;
          nNewCol = nNextCol;
          do {
            nNextCol = this.FindNextVisibleCol(nNewCol, bRight);
            if (nNextCol <= nLastCol && this.aCol[nNextCol]!.HasVisibleDataAt(rRow)) nNewCol = nNextCol;
            else bFound = true;
          } while (!bFound && nNextCol > 0 && nNextCol < this.rDocument.MaxCol());
        } else {
          nNewCol = this.FindNextVisibleColWithContent(nNewCol, bRight, rRow);
        }
      } else {
        nNewCol = this.FindNextVisibleColWithContent(nNewCol, bRight, rRow);
      }

      if (nNewCol < 0) nNewCol = 0;
      if (nNewCol > this.rDocument.MaxCol()) nNewCol = this.rDocument.MaxCol();
      return { rCol: nNewCol, rRow };
    }
    if (rCol <= nLastCol) return { rCol, rRow: this.aCol[rCol]!.FindDataAreaPos(rRow, eDirection === ScMoveDirection.SC_MOVE_DOWN) };
    // The cell (rCol, rRow) is equivalent to an empty cell (although not allocated).
    // Set rRow to 0 or rDocument.MaxRow() depending on eDirection to maintain the behaviour of
    // ScColumn::FindDataAreaPos() when the given column is empty.
    return { rCol, rRow: eDirection === ScMoveDirection.SC_MOVE_DOWN ? this.rDocument.MaxRow() : 0 };
  }

  ValidNextPos(nCol: SCCOL, nRow: SCROW, rMark: ScMarkData, bMarked: boolean, bUnprotected: boolean): boolean {
    if (!this.ValidCol(nCol) || !this.ValidRow(nRow)) return false;

    if (this.rDocument.HasAttrib(nCol, nRow, this.nTab, nCol, nRow, this.nTab, HasAttrFlags.Overlapped))
      // Skip an overlapped cell.
      return false;

    if (bMarked && !rMark.IsCellMarked(nCol, nRow)) return false;

    if (bUnprotected && this.rDocument.HasAttrib(nCol, nRow, this.nTab, nCol, nRow, this.nTab, HasAttrFlags.Protected)) return false;

    if (bMarked || bUnprotected) {
      // Hidden cells must be skipped, as the cursor would end up on the next cell
      // even if it is protected or not marked.
      if (this.RowHidden(nRow)) return false;
      if (this.ColHidden(nCol)) return false;
    }

    return true;
  }

  /** Skips the current cell if it is Hidden, Overlapped or Protected and Sheet is Protected */
  SkipRow(nCol: SCCOL, rRow: { v: SCROW }, nMovY: SCROW, rMark: ScMarkData, bUp: boolean, nUsedY: SCROW, bMarked: boolean, bSheetProtected: boolean): boolean {
    if (!this.ValidRow(rRow.v)) return false;

    if (bSheetProtected && this.rDocument.HasAttrib(nCol, rRow.v, this.nTab, nCol, rRow.v, this.nTab, HasAttrFlags.Protected)) {
      if (rRow.v > nUsedY) rRow.v = bUp ? nUsedY : this.rDocument.MaxRow() + nMovY;
      else rRow.v += nMovY;

      if (bMarked) rRow.v = rMark.GetNextMarked(nCol, rRow.v, bUp);

      return true;
    }
    const bRowHidden = this.RowHidden(rRow.v);
    const bOverlapped = this.rDocument.HasAttrib(nCol, rRow.v, this.nTab, nCol, rRow.v, this.nTab, HasAttrFlags.Overlapped);

    if (bRowHidden || bOverlapped) {
      rRow.v += nMovY;
      if (bMarked) rRow.v = rMark.GetNextMarked(nCol, rRow.v, bUp);

      return true;
    }

    return false;
  }

  /**
   * GetNextPos: Enter's and Tab's next cell, within the selection (bMarked), or past protected
   * cells (bUnprotected), or back to the column where Tab started (nTabStartCol).
   */
  GetNextPos(rCol: SCCOL, rRow: SCROW, nMovX: SCCOL, nMovY: SCROW, bMarked: boolean, bUnprotected: boolean, rMark: ScMarkData, nTabStartCol: SCCOL = SC_TABSTART_NONE): { rCol: SCCOL; rRow: SCROW } {
    const bSheetProtected = this.IsProtected();

    if (bUnprotected && !bSheetProtected) bUnprotected = false; // Is sheet really protected?

    let nCol = rCol + nMovX;
    let nRow = rRow + nMovY;

    let nStartCol: SCCOL, nEndCol: SCCOL;
    let nStartRow: SCROW, nEndRow: SCROW;
    if (bMarked) {
      let aRange: ScRange;
      if (rMark.IsMarked()) aRange = rMark.GetMarkArea();
      else if (rMark.IsMultiMarked()) aRange = rMark.GetMultiMarkArea();
      else {
        if (this.ValidColRow(nCol, nRow)) return { rCol: nCol, rRow: nRow };
        return { rCol, rRow };
      }
      nStartCol = aRange.aStart.Col();
      nStartRow = aRange.aStart.Row();
      nEndCol = aRange.aEnd.Col();
      nEndRow = aRange.aEnd.Row();
    } else if (bUnprotected) {
      nStartCol = 0;
      nStartRow = 0;
      const a = this.rDocument.GetPrintArea(this.nTab, true);
      // Add some cols/rows to the print area (which is "content or
      // visually different from empty") to enable travelling through
      // protected forms with empty cells and no visual indicator.
      // 42 might be good enough and not too much...
      nEndCol = Math.min(Math.max(a.nEndCol, rCol) + 42, this.rDocument.MaxCol());
      nEndRow = Math.min(Math.max(a.nEndRow, rRow) + 42, this.rDocument.MaxRow());
    } else {
      // Invalid values show up for instance for Tab, when nothing is
      // selected and not protected (left / right edge), then leave values
      // unchanged.
      if (this.ValidColRow(nCol, nRow)) {
        rCol = nCol;
        rRow = nRow;
      }

      // Caller ensures actually moving nMovY to jump to prev/next row's
      // start col.
      if (nTabStartCol !== SC_TABSTART_NONE) rCol = nTabStartCol;

      return { rCol, rRow };
    }

    if (nMovY && (bMarked || bUnprotected)) {
      do {
        const bUp = nMovY < 0;
        const nColAdd = bUp ? -1 : 1;

        if (bMarked) nRow = rMark.GetNextMarked(nCol, nRow, bUp);

        if (nTabStartCol !== SC_TABSTART_NONE) {
          // Continue moving horizontally.
          nMovX = nColAdd;
          nCol = nTabStartCol;
          break; // do
        }

        const r = { v: nRow };
        while (this.SkipRow(nCol, r, nMovY, rMark, bUp, nEndRow, bMarked, bSheetProtected));
        nRow = r.v;

        let nWrap = 0;
        while (nRow < nStartRow || nRow > nEndRow) {
          nCol += nColAdd;

          while (nStartCol <= nCol && nCol <= nEndCol && this.ValidCol(nCol) && this.ColHidden(nCol)) nCol += nColAdd; //  skip hidden cols

          if (nCol < nStartCol) {
            nCol = nEndCol;
            if (++nWrap >= 2) return { rCol, rRow };
          } else if (nCol > nEndCol) {
            nCol = nStartCol;
            if (++nWrap >= 2) return { rCol, rRow };
          }
          if (nRow < nStartRow) nRow = nEndRow;
          else if (nRow > nEndRow) nRow = nStartRow;

          if (bMarked) nRow = rMark.GetNextMarked(nCol, nRow, bUp);

          r.v = nRow;
          while (this.SkipRow(nCol, r, nMovY, rMark, bUp, nEndRow, bMarked, bSheetProtected));
          nRow = r.v;
        }
      } while (false);
    }

    if (nMovX && (bMarked || bUnprotected)) {
      // wrap initial skip counting:
      if (nCol < nStartCol) {
        nCol = nEndCol;
        --nRow;
        if (nRow < nStartRow) nRow = nEndRow;
      }
      if (nCol > nEndCol) {
        nCol = nStartCol;
        ++nRow;
        if (nRow > nEndRow) nRow = nStartRow;
      }

      if (!this.ValidNextPos(nCol, nRow, rMark, bMarked, bUnprotected)) {
        const nColCount = nEndCol - nStartCol + 1;
        const pNextRows: SCROW[] = new Array<SCROW>(nColCount);
        const bUp = nMovX < 0; // Moving left also means moving up in rows.
        const nRowAdd = bUp ? -1 : 1;
        let nWrap = 0;

        if (bUp) {
          for (let i = 0; i < nColCount; ++i) pNextRows[i] = i + nStartCol > nCol ? nRow + nRowAdd : nRow;
        } else {
          for (let i = 0; i < nColCount; ++i) pNextRows[i] = i + nStartCol < nCol ? nRow + nRowAdd : nRow;
        }
        do {
          let nNextRow = pNextRows[nCol - nStartCol]! + nRowAdd;
          if (bMarked) nNextRow = rMark.GetNextMarked(nCol, nNextRow, bUp);
          // bUnprotected's GetNextUnprotected (the next row without the Protected attribute) is
          // left out: protected cells are skipped by ValidNextPos.
          pNextRows[nCol - nStartCol] = nNextRow;

          if (bUp) {
            let nMaxRow = nStartRow - 1;
            for (let i = 0; i < nColCount; ++i) {
              if (pNextRows[i]! >= nMaxRow) {
                // when two equal the right one
                nMaxRow = pNextRows[i]!;
                nCol = i + nStartCol;
              }
            }
            nRow = nMaxRow;

            if (nRow < nStartRow) {
              if (++nWrap >= 2) return { rCol, rRow };
              nCol = nEndCol;
              nRow = nEndRow;
              for (let i = 0; i < nColCount; ++i) pNextRows[i] = nEndRow; // do it all over again
            }
          } else {
            let nMinRow = nEndRow + 1;
            for (let i = 0; i < nColCount; ++i) {
              if (pNextRows[i]! < nMinRow) {
                // when two equal the left one
                nMinRow = pNextRows[i]!;
                nCol = i + nStartCol;
              }
            }
            nRow = nMinRow;

            if (nRow > nEndRow) {
              if (++nWrap >= 2) return { rCol, rRow };
              nCol = nStartCol;
              nRow = nStartRow;
              for (let i = 0; i < nColCount; ++i) pNextRows[i] = nStartRow; // do it all over again
            }
          }
        } while (!this.ValidNextPos(nCol, nRow, rMark, bMarked, bUnprotected));
      }
    }

    if (this.ValidColRow(nCol, nRow)) {
      rCol = nCol;
      rRow = nRow;
    }
    return { rCol, rRow };
  }

  /** Remove all cells and attributes (for reusing a table). */
  Clear(): void {
    for (const c of this.aCol) for (const f of c.FormulaCells()) f.EndListeningTo(this.rDocument);
    this.aCol = [];
  }

  /** The table's cell range as a ScRange. */
  GetRange(): ScRange { return new ScRange(0, 0, this.nTab, this.rDocument.MaxCol(), this.rDocument.MaxRow(), this.nTab); }
}
