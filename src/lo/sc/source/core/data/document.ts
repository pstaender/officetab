// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/document.hxx reduced
// @upstream sc/source/core/data/document.cxx reduced
// @upstream sc/source/core/data/documen2.cxx reduced
// @upstream sc/source/core/data/documen3.cxx reduced
// @upstream sc/source/core/data/documen4.cxx reduced
// @upstream sc/source/core/data/documen7.cxx reduced
// @upstream sc/source/core/data/documen8.cxx reduced
// ScDocument: a spreadsheet: sheets (ScTable), named expressions, cell styles, options, and the
// recalculation machinery (the formula track, listeners and broadcasts, AutoCalc, hard recalc).
// A document can be a clipboard or undo document (SCDOCMODE_CLIP / SCDOCMODE_UNDO) holding
// copies of cells. Kept: cells and attributes, sheets (insert, delete, rename, move, copy),
// inserting and deleting rows, columns and cells with reference updates, merges, widths and
// heights, copying to and from clip and undo documents, array formulas. Left out: the draw
// layer, charts, pivot tables, database ranges, conditional formats, validation, change
// tracking, scenarios, external links, DDE, printing ranges, sheet protection passwords, the
// edit engine and the threaded/grouped calculation.
import { EditTextObject } from '../../../../editeng/source/editeng/editobj.ts';
import { FormulaError } from '../../../../include/formula/errorcodes.ts';
import { FormulaGrammar } from '../../../../include/formula/grammar.ts';
import { ocMatRef } from '../../../../include/formula/opcode.ts';
import { GetStandardFormat as NFGetStandardFormat, type SvNumFormatType } from '../../../../svl/source/numbers/zforlist.ts';
import { MAXTAB, SC_TABSTART_NONE, ScAddress, ScRange, ValidTab, type SCCOL, type SCROW, type SCTAB } from '../../../inc/address.ts';
import { CELLTYPE_NONE, ScRefCellValue, type CellType, type ScCellData } from '../../../inc/cellvalue.ts';
import { ScDocOptions } from '../../../inc/docoptio.ts';
import { FillCmd, FillDateCmd, FillDir, HasAttrFlags, InsertDeleteFlags, ScGlobal, type ScDirection } from '../../../inc/global.ts';
import type { ReorderParam, ScSortParam } from '../../../inc/sortparam.ts';
import type { ScMarkData } from '../../../inc/markdata.ts';
import { CellAttributeHelper, ScPatternAttr } from '../../../inc/patattr.ts';
import { ScRangeList } from '../../../inc/rangelst.ts';
import { RefUpdateContext, RefUpdateDeleteTabContext, RefUpdateInsertTabContext, RefUpdateMoveTabContext, UpdateRefMode } from '../../../inc/refupdatecontext.ts';
import { ScMF, type ScItemId, type ScItems, type ScItemSet } from '../../../inc/scitems.ts';
import { ScSheetLimits } from '../../../inc/sheetlimits.ts';
import { ScStyleSheetPool } from '../../../inc/stlpool.ts';
import { SfxStyleFamily, type ScStyleSheet } from '../../../inc/stlsheet.ts';
import type { ScSetStringParam } from '../../../inc/stringutil.ts';
import { ScSingleRefData } from '../../../inc/refdata.ts';
import { ScRangeName } from '../tool/rangenam.ts';
import { ScTokenArray } from '../tool/token.ts';
import { ScBroadcastAreaSlotMachine, type ScListener } from './bcaslot.ts';
import type { ScPostIt } from './column.ts';
import { ScFormulaCell, ScMatrixMode, ScRecursionHelper } from './formulacell.ts';
import { ScTable } from './table.ts';
import './table3.ts';
import './table4.ts';

export const ScDocumentMode = { SCDOCMODE_DOCUMENT: 0, SCDOCMODE_CLIP: 1, SCDOCMODE_UNDO: 2, SCDOCMODE_FUNCTIONACCESS: 3 } as const;
export type ScDocumentMode = (typeof ScDocumentMode)[keyof typeof ScDocumentMode];

/** ScHardRecalcState */
export const HardRecalcState = { OFF: 0, TEMPORARY: 1, ETERNAL: 2 } as const;

/** ScClipParam: what a clipboard document holds. */
export class ScClipParam {
  maRanges = new ScRangeList();
  mbCutMode = false;
  /** The direction of a multi-range clip (none, row or column). */
  meDirection: 'Unspecified' | 'Column' | 'Row' = 'Unspecified';
  constructor(rRange?: ScRange, bCutMode = false) {
    if (rRange) this.maRanges.push_back(rRange.clone());
    this.mbCutMode = bCutMode;
  }
  isMultiRange(): boolean { return this.maRanges.size() > 1; }
  /** The bounding range of the copied ranges. */
  getWholeRange(): ScRange { return this.maRanges.Combine(); }
}

export class ScDocument {
  private mxSheetLimits: ScSheetLimits;
  maTabs: (ScTable | null)[] = [];
  private pRangeName: ScRangeName | null = null;
  private mpDocOptions = new ScDocOptions();
  private mxStylePool = new ScStyleSheetPool();
  private mpCellAttributeHelper: CellAttributeHelper;
  private pBASM = new ScBroadcastAreaSlotMachine();
  private maRecursionHelper = new ScRecursionHelper();
  private readonly bIsClip: boolean;
  private readonly bIsUndo: boolean;
  private bAutoCalc = true;
  private bCalcingAfterLoad = false;
  private bImportingXML = false;
  private bExpandRefs = false;
  private nNoListening = 0;
  private nInterpretLevel = 0;
  private eHardRecalcState: number = HardRecalcState.OFF;
  private mnRecursionIteration = 0;
  private eGrammar: FormulaGrammar.Grammar = FormulaGrammar.GRAM_NATIVE;
  /** Formula cells whose dirty state still has to be broadcast (the formula track). */
  private maFormulaTrack = new Set<ScFormulaCell>();
  private bInTrackFormulas = false;
  private aClipParam = new ScClipParam();
  /** Volatile cells (RAND, NOW, OFFSET) that recalculate on every change. */
  private maVolatile = new Set<ScFormulaCell>();
  /** The modification counter, for views to repaint. */
  private mnModifyCount = 0;
  /** The calculation date (for TODAY() and NOW()), null for the system time. */
  private maCalcNow: Date | null = null;
  private mbUndoEnabled = true;

  constructor(eMode: ScDocumentMode = ScDocumentMode.SCDOCMODE_DOCUMENT, pSheetLimits?: ScSheetLimits) {
    this.mxSheetLimits = pSheetLimits ?? ScSheetLimits.CreateDefault();
    this.bIsClip = eMode === ScDocumentMode.SCDOCMODE_CLIP;
    this.bIsUndo = eMode === ScDocumentMode.SCDOCMODE_UNDO;
    this.mxStylePool.CreateStandardStyles();
    this.mpCellAttributeHelper = new CellAttributeHelper(this.mxStylePool.GetStandardStyle());
    if (this.bIsClip || this.bIsUndo) this.bAutoCalc = false;
  }

  // --- limits -------------------------------------------------------------------------------------

  GetSheetLimits(): ScSheetLimits { return this.mxSheetLimits; }
  MaxCol(): SCCOL { return this.mxSheetLimits.mnMaxCol; }
  MaxRow(): SCROW { return this.mxSheetLimits.mnMaxRow; }
  ValidCol(nCol: SCCOL): boolean { return this.mxSheetLimits.ValidCol(nCol); }
  ValidRow(nRow: SCROW): boolean { return this.mxSheetLimits.ValidRow(nRow); }
  ValidColRow(nCol: SCCOL, nRow: SCROW): boolean { return this.mxSheetLimits.ValidColRow(nCol, nRow); }
  ValidColRowTab(nCol: SCCOL, nRow: SCROW, nTab: SCTAB): boolean { return this.mxSheetLimits.ValidColRowTab(nCol, nRow, nTab); }
  ValidAddress(rAddr: ScAddress): boolean { return this.mxSheetLimits.ValidAddress(rAddr); }
  ValidRange(rRange: ScRange): boolean { return this.mxSheetLimits.ValidRange(rRange); }

  getCellAttributeHelper(): CellAttributeHelper { return this.mpCellAttributeHelper; }
  GetStyleSheetPool(): ScStyleSheetPool { return this.mxStylePool; }
  GetDefPattern(): ScPatternAttr { return this.mpCellAttributeHelper.getDefaultCellAttribute(); }

  IsClipboard(): boolean { return this.bIsClip; }
  IsUndo(): boolean { return this.bIsUndo; }
  IsClipOrUndo(): boolean { return this.bIsClip || this.bIsUndo; }
  IsImportingXML(): boolean { return this.bImportingXML; }
  SetImportingXML(b: boolean): void { this.bImportingXML = b; }
  IsCalcingAfterLoad(): boolean { return this.bCalcingAfterLoad; }
  GetNoListening(): boolean { return this.nNoListening > 0; }
  SetNoListening(b: boolean): void { this.nNoListening += b ? 1 : -1; }
  IsExpandRefs(): boolean { return this.bExpandRefs; }
  SetExpandRefs(bVal: boolean): void { this.bExpandRefs = bVal; }
  GetGrammar(): FormulaGrammar.Grammar { return this.eGrammar; }
  SetGrammar(eGram: FormulaGrammar.Grammar): void { this.eGrammar = eGram; }
  GetAddressConvention(): FormulaGrammar.AddressConvention { return FormulaGrammar.CONV_OOO; }
  GetDocOptions(): ScDocOptions { return this.mpDocOptions; }
  SetDocOptions(rOpt: ScDocOptions): void { this.mpDocOptions = rOpt.clone(); }
  /** The modification counter: increases with every change of cells or attributes. */
  GetModifyCount(): number { return this.mnModifyCount; }
  SetModified(): void { this.mnModifyCount++; }
  SetStreamValid(_nTab: SCTAB, _bSet: boolean): void { this.mnModifyCount++; }

  /** The standard number format code of a type (in the document's language). */
  GetStandardFormat(eType: SvNumFormatType): string { return NFGetStandardFormat(eType, 'en-US'); }

  /** The current date and time for TODAY() and NOW() (a fixed one for tests). */
  GetCalcNow(): Date { return this.maCalcNow ?? new Date(); }
  SetCalcNow(d: Date | null): void { this.maCalcNow = d; }

  // --- sheets -------------------------------------------------------------------------------------

  GetTableCount(): SCTAB { return this.maTabs.length; }
  HasTable(nTab: SCTAB): boolean { return nTab >= 0 && nTab < this.maTabs.length && !!this.maTabs[nTab]; }
  FetchTable(nTab: SCTAB): ScTable | null { return this.HasTable(nTab) ? this.maTabs[nTab]! : null; }

  GetName(nTab: SCTAB): string | undefined { return this.FetchTable(nTab)?.GetName(); }

  /** The index of a sheet by name (case-insensitive), -1 if there is none. */
  GetTable(rName: string): SCTAB {
    const aUpperName = rName.toUpperCase();
    for (let i = 0; i < this.maTabs.length; i++) if (this.maTabs[i] && this.maTabs[i]!.GetName().toUpperCase() === aUpperName) return i;
    return -1;
  }

  GetAllTableNames(): string[] { return this.maTabs.map((t) => (t ? t.GetName() : '')); }

  static ValidTabName(rName: string): boolean {
    if (!rName) return false;
    const nLen = rName.length;
    // Restrict sheet names to what Excel accepts.
    for (let i = 0; i < nLen; ++i) {
      const c = rName[i];
      switch (c) {
        case ':':
        case '\\':
        case '/':
        case '?':
        case '*':
        case '[':
        case ']':
          // these characters are not allowed to match XL's convention.
          return false;
        case '\'':
          if (i === 0 || i === nLen - 1) return false; // single quote is not allowed at the first or last character position.
          break;
      }
    }
    return true;
  }

  ValidNewTabName(rName: string): boolean {
    if (!ScDocument.ValidTabName(rName)) return false;
    return this.GetTable(rName) < 0;
  }

  /** A valid and unused sheet name based on rName ("Sheet4" or "Name_2"). */
  CreateValidTabName(rName: string): string {
    if (!ScDocument.ValidTabName(rName)) {
      // Find new one
      const aStrTable = ScGlobal.GetStandardTabName();
      for (let i = this.GetTableCount() + 1; ; i++) {
        const s = aStrTable + String(i);
        if (this.ValidNewTabName(s)) return s;
      }
    }
    // testing the supplied Name
    if (!this.ValidNewTabName(rName)) {
      let i = 1;
      let aName: string;
      do {
        i++;
        aName = `${rName}_${i}`;
      } while (!this.ValidNewTabName(aName) && i < MAXTAB + 1);
      return aName;
    }
    return rName;
  }

  /** Make a sheet (for new and undo/clip documents). */
  MakeTable(nTab: SCTAB, _bNeedsNameCheck = true): void {
    if (nTab < 0 || nTab > MAXTAB || this.HasTable(nTab)) return;
    // Get Custom prefix (ScDefaultsOptions: "Sheet")
    let aString = ScGlobal.GetStandardTabName() + String(nTab + 1);
    if (_bNeedsNameCheck) aString = this.CreateValidTabName(aString); // no doubles
    while (this.maTabs.length <= nTab) this.maTabs.push(null);
    this.maTabs[nTab] = new ScTable(this, nTab, aString);
  }

  /** Insert a sheet at nPos (SC_TAB_APPEND = after the last). */
  InsertTab(nPos: SCTAB, rName: string, bExternalDocument = false, bUndoDeleteTab = false): boolean {
    void bUndoDeleteTab;
    const nTabCount = this.GetTableCount();
    if (nPos === 0x7fff /* SC_TAB_APPEND */ || nPos > nTabCount) nPos = nTabCount;
    let bValid = ValidTab(nTabCount);
    if (!bExternalDocument) bValid = bValid && this.ValidNewTabName(rName);
    if (!bValid) return false;
    if (nPos >= nTabCount) {
      this.maTabs.push(new ScTable(this, nTabCount, rName));
      return true;
    }
    // insert in between: update references first
    const aRange = new ScRange(0, 0, nPos, this.MaxCol(), this.MaxRow(), MAXTAB);
    this.ClearListeners();
    const aCxt = new RefUpdateInsertTabContext(this, nPos, 1);
    if (this.pRangeName) this.pRangeName.UpdateInsertTab(aCxt);
    for (const t of this.maTabs) t?.UpdateInsertTab(aCxt);
    void aRange;
    this.maTabs.splice(nPos, 0, new ScTable(this, nPos, rName));
    for (let i = 0; i < this.maTabs.length; i++) this.maTabs[i]?.SetTab(i);
    this.StartAllListeners();
    this.SetAllFormulasDirty();
    return true;
  }

  /** Insert several sheets (InsertTabs). */
  InsertTabs(nPos: SCTAB, rNames: readonly string[]): boolean {
    let nP = nPos;
    for (const n of rNames) {
      if (!this.InsertTab(nP, n)) return false;
      if (nP !== 0x7fff) nP++;
    }
    return true;
  }

  DeleteTab(nTab: SCTAB): boolean {
    if (!this.HasTable(nTab) || this.GetTableCount() <= 1) return false;
    this.ClearListeners();
    const aCxt = new RefUpdateDeleteTabContext(this, nTab, 1);
    // a formula on the deleted sheet goes away with it
    for (const f of this.maTabs[nTab]!.FormulaCells()) this.RemoveFromFormulaTree(f);
    if (this.pRangeName) this.pRangeName.UpdateDeleteTab(aCxt);
    for (let i = 0; i < this.maTabs.length; i++) if (i !== nTab) this.maTabs[i]?.UpdateDeleteTab(aCxt);
    this.maTabs.splice(nTab, 1);
    for (let i = 0; i < this.maTabs.length; i++) this.maTabs[i]?.SetTab(i);
    this.StartAllListeners();
    this.SetAllFormulasDirty();
    return true;
  }

  DeleteTabs(nTab: SCTAB, nSheets: SCTAB): boolean {
    let b = true;
    for (let i = 0; i < nSheets; i++) b = this.DeleteTab(nTab) && b;
    return b;
  }

  RenameTab(nTab: SCTAB, rName: string, bExternalDocument = false): boolean {
    let bValid = false;
    if (this.HasTable(nTab)) {
      if (bExternalDocument) bValid = true; // composed name
      else bValid = ScDocument.ValidTabName(rName);
      for (let i = 0; i < this.maTabs.length && bValid; i++) {
        if (this.maTabs[i] && i !== nTab && this.maTabs[i]!.GetName().toUpperCase() === rName.toUpperCase()) bValid = false;
      }
      if (bValid) {
        this.maTabs[nTab]!.SetName(rName);
        this.SetModified();
      }
    }
    return bValid;
  }

  /** Move a sheet from nOldPos to nNewPos (MoveTab). */
  MoveTab(nOldPos: SCTAB, nNewPos: SCTAB): boolean {
    if (nOldPos === nNewPos) return false;
    const nTabCount = this.GetTableCount();
    if (nTabCount < 2) return false;
    if (nNewPos === 0x7fff || nNewPos >= nTabCount) nNewPos = nTabCount - 1;
    if (!this.HasTable(nOldPos) || nOldPos === nNewPos) return false;
    this.ClearListeners();
    const aCxt = new RefUpdateMoveTabContext(this, nOldPos, nNewPos);
    if (this.pRangeName) this.pRangeName.UpdateMoveTab(aCxt);
    const aMoved = this.maTabs.splice(nOldPos, 1)[0]!;
    this.maTabs.splice(nNewPos, 0, aMoved);
    for (let i = 0; i < this.maTabs.length; i++) this.maTabs[i]?.UpdateMoveTab(aCxt, i);
    this.StartAllListeners();
    this.SetAllFormulasDirty();
    return true;
  }

  /** Copy a sheet to nNewPos (CopyTab): cells, attributes, widths and heights; formulas keep
      their references, with relative sheet references to the source sheet pointing to the copy. */
  CopyTab(nOldPos: SCTAB, nNewPos: SCTAB, rNewName?: string): boolean {
    if (!this.HasTable(nOldPos)) return false;
    const nTabCount = this.GetTableCount();
    if (nNewPos === 0x7fff || nNewPos >= nTabCount) nNewPos = nTabCount;
    const aName = rNewName && this.ValidNewTabName(rNewName) ? rNewName : this.CreateValidTabName(`${this.maTabs[nOldPos]!.GetName()}_2`);
    if (!this.InsertTab(nNewPos, aName)) return false;
    if (nNewPos <= nOldPos) nOldPos++;
    const pSrc = this.maTabs[nOldPos]!;
    const pDest = this.maTabs[nNewPos]!;
    pSrc.CopyToTable(0, 0, this.MaxCol(), this.MaxRow(), InsertDeleteFlags.ALL, pDest, true);
    pDest.SetTabBgColor(pSrc.GetTabBgColor());
    pDest.SetVisible(pSrc.IsVisible());
    // sheet-local names
    if (pSrc.HasRangeName()) pDest.SetRangeName(pSrc.GetRangeName().clone(this));
    // formulas of the copy: relative sheet references move with the sheet
    for (const f of pDest.FormulaCells()) {
      const aOldPos = new ScAddress(f.aPos.Col(), f.aPos.Row(), nOldPos);
      f.pCode.AdjustReferenceOnMovedOriginIfOtherSheet(aOldPos, f.aPos);
      f.StartListeningTo(this);
      f.SetDirtyVar();
      this.PutInFormulaTree(f);
    }
    if (this.GetAutoCalc()) this.CalcFormulaTree();
    return true;
  }

  IsVisible(nTab: SCTAB): boolean { return this.FetchTable(nTab)?.IsVisible() ?? false; }
  SetVisible(nTab: SCTAB, bVisible: boolean): void { this.FetchTable(nTab)?.SetVisible(bVisible); }
  GetTabBgColor(nTab: SCTAB): string | null { return this.FetchTable(nTab)?.GetTabBgColor() ?? null; }
  SetTabBgColor(nTab: SCTAB, rColor: string | null): void { this.FetchTable(nTab)?.SetTabBgColor(rColor); }
  IsLayoutRTL(nTab: SCTAB): boolean { return this.FetchTable(nTab)?.IsLayoutRTL() ?? false; }
  SetLayoutRTL(nTab: SCTAB, bRTL: boolean): void { this.FetchTable(nTab)?.SetLayoutRTL(bRTL); }
  IsTabProtected(nTab: SCTAB): boolean { return this.FetchTable(nTab)?.IsProtected() ?? false; }
  SetTabProtection(nTab: SCTAB, b: boolean): void { this.FetchTable(nTab)?.SetProtection(b); }

  // --- named expressions -------------------------------------------------------------------------

  /** The global names (nTab undefined or -1) or the names of a sheet. */
  GetRangeName(nTab?: SCTAB): ScRangeName | null {
    if (nTab === undefined || nTab < 0) {
      if (!this.pRangeName) this.pRangeName = new ScRangeName();
      return this.pRangeName;
    }
    const t = this.FetchTable(nTab);
    return t ? t.GetRangeName() : null;
  }

  SetRangeName(pNew: ScRangeName | null, nTab = -1): void {
    if (nTab < 0) this.pRangeName = pNew;
    else this.FetchTable(nTab)?.SetRangeName(pNew);
  }

  // --- cells --------------------------------------------------------------------------------------

  /** SetString(col, row, tab, string) or SetString(address, string): returns whether the number
      format was set. */
  SetString(nCol: SCCOL | ScAddress, nRow: SCROW | string, nTab?: SCTAB | ScSetStringParam | null, rString?: string, pParam?: ScSetStringParam | null): boolean {
    if (nCol instanceof ScAddress) return this.SetString(nCol.Col(), nCol.Row(), nCol.Tab(), nRow as string, nTab as ScSetStringParam | null);
    const t = this.FetchTable(nTab as SCTAB);
    if (!t) return false;
    const b = t.SetString(nCol, nRow as SCROW, nTab as SCTAB, rString!, pParam);
    this.SetModified();
    return b;
  }

  SetValue(nCol: SCCOL | ScAddress, nRow: SCROW | number, nTab?: SCTAB, rVal?: number): void {
    if (nCol instanceof ScAddress) { this.SetValue(nCol.Col(), nCol.Row(), nCol.Tab(), nRow); return; }
    this.FetchTable(nTab!)?.SetValue(nCol, nRow, rVal!);
    this.SetModified();
  }

  /** Set a string without interpreting it. */
  SetRawString(rPos: ScAddress, rStr: string): void {
    this.FetchTable(rPos.Tab())?.SetRawString(rPos.Col(), rPos.Row(), rStr);
    this.SetModified();
  }

  SetEditText(rPos: ScAddress, pEditText: EditTextObject): boolean {
    const t = this.FetchTable(rPos.Tab());
    if (!t) return false;
    this.SetModified();
    return t.SetEditText(rPos.Col(), rPos.Row(), pEditText);
  }

  /** Set a text: plain when it has no line break, else an edit text (SetTextCell). */
  SetTextCell(rPos: ScAddress, rStr: string): void {
    if (rStr.includes('\n')) this.SetEditText(rPos, EditTextObject.FromText(rStr));
    else this.SetRawString(rPos, rStr);
  }

  /** Set a formula from a string in a grammar. */
  SetFormula(rPos: ScAddress, rFormula: string, eGram: FormulaGrammar.Grammar = FormulaGrammar.GRAM_DEFAULT): void {
    this.FetchTable(rPos.Tab())?.SetFormula(rPos.Col(), rPos.Row(), rFormula, eGram);
    this.SetModified();
  }

  /** Set a formula cell (taking ownership). */
  SetFormulaCell(rPos: ScAddress, pCell: ScFormulaCell): ScFormulaCell | null {
    const t = this.FetchTable(rPos.Tab());
    if (!t) return null;
    this.SetModified();
    return t.SetFormulaCell(rPos.Col(), rPos.Row(), pCell);
  }

  /** Set a cell of any kind (a number, string, EditTextObject or ScFormulaCell), undefined deletes. */
  SetCellData(rPos: ScAddress, p: ScCellData | undefined, bBroadcast = true): void {
    this.FetchTable(rPos.Tab())?.SetCell(rPos.Col(), rPos.Row(), p, bBroadcast);
    this.SetModified();
  }

  /** Delete one cell's content (SetEmptyCell). */
  SetEmptyCell(rPos: ScAddress): void {
    this.FetchTable(rPos.Tab())?.SetCell(rPos.Col(), rPos.Row(), undefined);
    this.SetModified();
  }

  GetValue(nCol: SCCOL | ScAddress, nRow?: SCROW, nTab?: SCTAB): number {
    if (nCol instanceof ScAddress) return this.GetValue(nCol.Col(), nCol.Row(), nCol.Tab());
    return this.FetchTable(nTab!)?.GetValue(nCol, nRow!) ?? 0.0;
  }

  /** The display string of a cell. */
  GetString(nCol: SCCOL | ScAddress, nRow?: SCROW, nTab?: SCTAB): string {
    if (nCol instanceof ScAddress) return this.GetString(nCol.Col(), nCol.Row(), nCol.Tab());
    return this.FetchTable(nTab!)?.GetString(nCol, nRow!) ?? '';
  }

  /** The display string and the text colour of the number format (red negatives). */
  GetStringAndColor(rPos: ScAddress): { aString: string; pColor: string | null } {
    const c = this.FetchTable(rPos.Tab())?.FetchColumn(rPos.Col());
    return c ? c.GetStringAndColor(rPos.Row()) : { aString: '', pColor: null };
  }

  /** The string for the input line: the formula of a formula cell, a value in its edit format. */
  GetInputString(nCol: SCCOL | ScAddress, nRow?: SCROW, nTab?: SCTAB): string {
    if (nCol instanceof ScAddress) return this.GetInputString(nCol.Col(), nCol.Row(), nCol.Tab());
    return this.FetchTable(nTab!)?.GetInputString(nCol, nRow!) ?? '';
  }

  GetFormula(nCol: SCCOL | ScAddress, nRow?: SCROW, nTab?: SCTAB): string {
    if (nCol instanceof ScAddress) return this.GetFormula(nCol.Col(), nCol.Row(), nCol.Tab());
    return this.FetchTable(nTab!)?.GetFormula(nCol, nRow!) ?? '';
  }

  GetFormulaCell(rPos: ScAddress): ScFormulaCell | null { return this.FetchTable(rPos.Tab())?.GetFormulaCell(rPos.Col(), rPos.Row()) ?? null; }
  GetEditText(rPos: ScAddress): EditTextObject | null { return this.FetchTable(rPos.Tab())?.GetEditText(rPos.Col(), rPos.Row()) ?? null; }

  GetCellType(nCol: SCCOL | ScAddress, nRow?: SCROW, nTab?: SCTAB): CellType {
    if (nCol instanceof ScAddress) return this.GetCellType(nCol.Col(), nCol.Row(), nCol.Tab());
    return this.FetchTable(nTab!)?.GetCellType(nCol, nRow!) ?? CELLTYPE_NONE;
  }

  /** A view of the cell (ScRefCellValue(rDoc, rPos)). */
  GetRefCellValue(rPos: ScAddress): ScRefCellValue { return this.FetchTable(rPos.Tab())?.GetCellValue(rPos.Col(), rPos.Row()) ?? new ScRefCellValue(); }
  GetCellData(rPos: ScAddress): ScCellData | undefined { return this.FetchTable(rPos.Tab())?.GetCellData(rPos.Col(), rPos.Row()); }

  HasData(nCol: SCCOL, nRow: SCROW, nTab: SCTAB): boolean { return this.FetchTable(nTab)?.HasData(nCol, nRow) ?? false; }
  HasStringData(nCol: SCCOL, nRow: SCROW, nTab: SCTAB): boolean { return this.FetchTable(nTab)?.HasStringData(nCol, nRow) ?? false; }
  HasValueData(nCol: SCCOL | ScAddress, nRow?: SCROW, nTab?: SCTAB): boolean {
    if (nCol instanceof ScAddress) return this.HasValueData(nCol.Col(), nCol.Row(), nCol.Tab());
    return this.FetchTable(nTab!)?.HasValueData(nCol, nRow!) ?? false;
  }

  /** The error of a formula cell (GetErrCode). */
  GetErrCode(rPos: ScAddress): FormulaError {
    const f = this.GetFormulaCell(rPos);
    return f ? f.GetErrCode() : FormulaError.NONE;
  }

  GetNote(rPos: ScAddress): ScPostIt | null { return this.FetchTable(rPos.Tab())?.GetNote(rPos.Col(), rPos.Row()) ?? null; }
  SetNote(rPos: ScAddress, pNote: ScPostIt | null): void { this.FetchTable(rPos.Tab())?.SetNote(rPos.Col(), rPos.Row(), pNote); }

  IsBlockEmpty(nStartCol: SCCOL, nStartRow: SCROW, nEndCol: SCCOL, nEndRow: SCROW, nTab: SCTAB): boolean {
    return this.FetchTable(nTab)?.IsBlockEmpty(nStartCol, nStartRow, nEndCol, nEndRow) ?? true;
  }

  /** Delete content in the marked sheets' block by flags (DeleteArea). */
  DeleteArea(nCol1: SCCOL, nRow1: SCROW, nCol2: SCCOL, nRow2: SCROW, rMark: ScMarkData, nDelFlag: InsertDeleteFlags): void {
    for (const nTab of rMark) this.DeleteAreaTab(nCol1, nRow1, nCol2, nRow2, nTab, nDelFlag);
  }

  DeleteAreaTab(nCol1: SCCOL | ScRange, nRow1: SCROW | InsertDeleteFlags, nCol2?: SCCOL, nRow2?: SCROW, nTab?: SCTAB, nDelFlag?: InsertDeleteFlags): void {
    if (nCol1 instanceof ScRange) {
      for (let t = nCol1.aStart.Tab(); t <= nCol1.aEnd.Tab(); t++) this.DeleteAreaTab(nCol1.aStart.Col(), nCol1.aStart.Row(), nCol1.aEnd.Col(), nCol1.aEnd.Row(), t, nRow1);
      return;
    }
    this.FetchTable(nTab!)?.DeleteArea(nCol1, nRow1, nCol2!, nRow2!, nDelFlag!);
    this.SetModified();
  }

  // --- attributes ---------------------------------------------------------------------------------

  GetPattern(nCol: SCCOL | ScAddress, nRow?: SCROW, nTab?: SCTAB): ScPatternAttr {
    if (nCol instanceof ScAddress) return this.GetPattern(nCol.Col(), nCol.Row(), nCol.Tab());
    return this.FetchTable(nTab!)?.GetPattern(nCol, nRow!) ?? this.GetDefPattern();
  }

  GetAttr<K extends ScItemId>(nCol: SCCOL, nRow: SCROW, nTab: SCTAB, nWhich: K): ScItems[K] { return this.GetPattern(nCol, nRow, nTab).GetItem(nWhich); }

  /** The number format code of a cell. */
  GetNumberFormat(nCol: SCCOL | ScAddress, nRow?: SCROW, nTab?: SCTAB): string {
    if (nCol instanceof ScAddress) return this.GetNumberFormat(nCol.Col(), nCol.Row(), nCol.Tab());
    return this.GetPattern(nCol, nRow!, nTab!).GetNumberFormat();
  }

  SetNumberFormat(rPos: ScAddress, nNumberFormat: string): void {
    this.ApplyAttr(rPos.Col(), rPos.Row(), rPos.Tab(), { ATTR_VALUE_FORMAT: nNumberFormat });
  }

  ApplyAttr(nCol: SCCOL, nRow: SCROW, nTab: SCTAB, rItems: ScItemSet): void {
    this.FetchTable(nTab)?.ApplyAttr(nCol, nRow, rItems);
    this.SetModified();
  }

  ApplyPatternAreaTab(nStartCol: SCCOL, nStartRow: SCROW, nEndCol: SCCOL, nEndRow: SCROW, nTab: SCTAB, rItems: ScItemSet): void {
    this.FetchTable(nTab)?.ApplyPatternArea(nStartCol, nStartRow, nEndCol, nEndRow, rItems);
    this.SetModified();
  }

  ApplyPatternArea(nStartCol: SCCOL, nStartRow: SCROW, nEndCol: SCCOL, nEndRow: SCROW, rMark: ScMarkData, rItems: ScItemSet): void {
    for (const nTab of rMark) this.ApplyPatternAreaTab(nStartCol, nStartRow, nEndCol, nEndRow, nTab, rItems);
  }

  /** Apply items to the marked ranges of the selected sheets (ApplySelectionPattern). */
  ApplySelectionPattern(rItems: ScItemSet, rMark: ScMarkData): void {
    for (const nTab of rMark) for (const r of rMark.GetMarkedRangesForTab(nTab)) this.ApplyPatternAreaTab(r.aStart.Col(), r.aStart.Row(), r.aEnd.Col(), r.aEnd.Row(), nTab, rItems);
  }

  /** Set a whole pattern on a block (SetPatternAreaTab). */
  SetPatternAreaTab(nStartCol: SCCOL, nStartRow: SCROW, nEndCol: SCCOL, nEndRow: SCROW, nTab: SCTAB, pPattern: ScPatternAttr): void {
    this.FetchTable(nTab)?.SetPatternArea(nStartCol, nStartRow, nEndCol, nEndRow, pPattern);
    this.SetModified();
  }

  ApplyStyleAreaTab(nStartCol: SCCOL, nStartRow: SCROW, nEndCol: SCCOL, nEndRow: SCROW, nTab: SCTAB, rStyle: ScStyleSheet): void {
    this.FetchTable(nTab)?.ApplyStyleArea(nStartCol, nStartRow, nEndCol, nEndRow, rStyle);
    this.SetModified();
  }

  ApplySelectionStyle(rStyle: ScStyleSheet, rMark: ScMarkData): void {
    for (const nTab of rMark) for (const r of rMark.GetMarkedRangesForTab(nTab)) this.ApplyStyleAreaTab(r.aStart.Col(), r.aStart.Row(), r.aEnd.Col(), r.aEnd.Row(), nTab, rStyle);
  }

  /** The cell style of a cell. */
  GetStyle(nCol: SCCOL, nRow: SCROW, nTab: SCTAB): ScStyleSheet | null { return this.GetPattern(nCol, nRow, nTab).GetStyleSheet(); }

  /** Whether a cell style is used by any cell (IsStyleSheetUsed). */
  IsStyleSheetUsed(rStyle: ScStyleSheet): boolean {
    for (const t of this.maTabs) {
      if (!t) continue;
      for (const c of t.GetColumns()) for (const e of c.pAttrArray.GetEntries()) if (e.pPattern.GetStyleSheet() === rStyle) return true;
    }
    return false;
  }

  /** After a cell style changed: patterns re-key, the cells show the new attributes. */
  StyleSheetChanged(): void {
    this.mpCellAttributeHelper.CellStyleChanged();
    this.SetModified();
  }

  /** Register a pattern of another document (clip, undo) with this document's styles. */
  ImportPattern(pPattern: ScPatternAttr): ScPatternAttr {
    const pStyle = pPattern.GetStyleSheet();
    const pMyStyle = pStyle ? (this.mxStylePool.Find(pStyle.GetName(), SfxStyleFamily.Para) ?? this.mxStylePool.Make(pStyle.GetName(), SfxStyleFamily.Para, pStyle.GetItemSet(), pStyle.GetParent())) : this.mxStylePool.GetStandardStyle();
    const p = new ScPatternAttr(pMyStyle, pPattern.GetItemSet());
    return this.mpCellAttributeHelper.registerAndCheck(p);
  }

  ClearSelectionItems(aWhich: readonly ScItemId[], rMark: ScMarkData): void {
    for (const nTab of rMark) for (const r of rMark.GetMarkedRangesForTab(nTab)) this.FetchTable(nTab)?.ClearItems(r.aStart.Col(), r.aStart.Row(), r.aEnd.Col(), r.aEnd.Row(), aWhich);
    this.SetModified();
  }

  HasAttrib(nCol1: SCCOL | ScRange, nRow1: SCROW | HasAttrFlags, nTab1?: SCTAB, nCol2?: SCCOL, nRow2?: SCROW, nTab2?: SCTAB, nMask?: HasAttrFlags): boolean {
    if (nCol1 instanceof ScRange) return this.HasAttrib(nCol1.aStart.Col(), nCol1.aStart.Row(), nCol1.aStart.Tab(), nCol1.aEnd.Col(), nCol1.aEnd.Row(), nCol1.aEnd.Tab(), nRow1);
    for (let t = nTab1!; t <= nTab2!; t++) if (this.FetchTable(t)?.HasAttrib(nCol1, nRow1, nCol2!, nRow2!, nMask!)) return true;
    return false;
  }

  ApplyFlagsTab(nStartCol: SCCOL, nStartRow: SCROW, nEndCol: SCCOL, nEndRow: SCROW, nTab: SCTAB, nFlags: number): boolean {
    return this.FetchTable(nTab)?.ApplyFlags(nStartCol, nStartRow, nEndCol, nEndRow, nFlags) ?? false;
  }
  RemoveFlagsTab(nStartCol: SCCOL, nStartRow: SCROW, nEndCol: SCCOL, nEndRow: SCROW, nTab: SCTAB, nFlags: number): boolean {
    return this.FetchTable(nTab)?.RemoveFlags(nStartCol, nStartRow, nEndCol, nEndRow, nFlags) ?? false;
  }

  // --- merged cells -------------------------------------------------------------------------------

  /** Merge a block (DoMerge); the contents of the cells other than the origin stay (the caller
      moves or deletes them). */
  DoMerge(nStartCol: SCCOL, nStartRow: SCROW, nEndCol: SCCOL, nEndRow: SCROW, nTab: SCTAB): void {
    this.FetchTable(nTab)?.DoMerge(nStartCol, nStartRow, nEndCol, nEndRow);
    this.SetModified();
  }

  RemoveMerge(nCol: SCCOL, nRow: SCROW, nTab: SCTAB): void {
    this.FetchTable(nTab)?.RemoveMerge(nCol, nRow);
    this.SetModified();
  }

  /** Extend a range to include the merged cells starting in it (ExtendMerge). */
  ExtendMerge(nStartCol: SCCOL | ScRange, nStartRow?: SCROW, nEndCol?: SCCOL, nEndRow?: SCROW, nTab?: SCTAB): { nEndCol: SCCOL; nEndRow: SCROW; bFound: boolean } {
    if (nStartCol instanceof ScRange) {
      const r = nStartCol;
      const res = this.ExtendMerge(r.aStart.Col(), r.aStart.Row(), r.aEnd.Col(), r.aEnd.Row(), r.aStart.Tab());
      r.aEnd.SetCol(res.nEndCol);
      r.aEnd.SetRow(res.nEndRow);
      return res;
    }
    const t = this.FetchTable(nTab!);
    if (!t) return { nEndCol: nEndCol!, nEndRow: nEndRow!, bFound: false };
    return t.ExtendMerge(nStartCol, nStartRow!, nEndCol!, nEndRow!);
  }

  /** Whether a cell is the origin of a merged block. */
  IsMerged(rPos: ScAddress): boolean { return this.GetPattern(rPos).IsMerged(); }
  /** Whether a cell is overlapped by a merged cell. */
  IsOverlapped(rPos: ScAddress): boolean { return this.GetPattern(rPos).IsOverlapped(); }
  /** The origin of the merged cell covering a position. */
  GetMergeOrigin(rPos: ScAddress): ScAddress {
    const t = this.FetchTable(rPos.Tab());
    if (!t) return rPos.clone();
    const o = t.GetMergeOrigin(rPos.Col(), rPos.Row());
    return new ScAddress(o.nCol, o.nRow, rPos.Tab());
  }

  // --- widths and heights -------------------------------------------------------------------------

  SetColWidth(nCol: SCCOL, nTab: SCTAB, nNewWidth: number): void { this.FetchTable(nTab)?.SetColWidth(nCol, nNewWidth); this.SetModified(); }
  GetColWidth(nCol: SCCOL, nTab: SCTAB, bHiddenAsZero = true): number { return this.FetchTable(nTab)?.GetColWidth(nCol, bHiddenAsZero) ?? 0; }
  GetOriginalWidth(nCol: SCCOL, nTab: SCTAB): number { return this.FetchTable(nTab)?.GetOriginalWidth(nCol) ?? 0; }
  SetRowHeight(nRow: SCROW, nTab: SCTAB, nNewHeight: number): void { this.FetchTable(nTab)?.SetRowHeight(nRow, nNewHeight); this.SetModified(); }
  SetRowHeightRange(nStartRow: SCROW, nEndRow: SCROW, nTab: SCTAB, nNewHeight: number): void { this.FetchTable(nTab)?.SetRowHeightRange(nStartRow, nEndRow, nNewHeight); this.SetModified(); }
  SetRowHeightOnly(nStartRow: SCROW, nEndRow: SCROW, nTab: SCTAB, nNewHeight: number): void { this.FetchTable(nTab)?.SetRowHeightOnly(nStartRow, nEndRow, nNewHeight); }
  GetRowHeight(nRow: SCROW, nTab: SCTAB, bHiddenAsZero = true): number { return this.FetchTable(nTab)?.GetRowHeight(nRow, bHiddenAsZero) ?? 0; }
  /** The sum of the heights of rows nStartRow..nEndRow. */
  GetRowHeightRange(nStartRow: SCROW, nEndRow: SCROW, nTab: SCTAB, bHiddenAsZero = true): number { return this.FetchTable(nTab)?.GetRowHeightRange(nStartRow, nEndRow, bHiddenAsZero) ?? 0; }
  /** The sum of the widths of columns nStartCol..nEndCol. */
  GetColWidthRange(nStartCol: SCCOL, nEndCol: SCCOL, nTab: SCTAB, bHiddenAsZero = true): number { return this.FetchTable(nTab)?.GetColWidthRange(nStartCol, nEndCol, bHiddenAsZero) ?? 0; }
  GetColOffset(nCol: SCCOL, nTab: SCTAB, bHiddenAsZero = true): number { return this.FetchTable(nTab)?.GetColOffset(nCol, bHiddenAsZero) ?? 0; }
  GetRowOffset(nRow: SCROW, nTab: SCTAB, bHiddenAsZero = true): number { return this.FetchTable(nTab)?.GetRowOffset(nRow, bHiddenAsZero) ?? 0; }
  GetRowForHeight(nTab: SCTAB, nHeight: number): SCROW { return this.FetchTable(nTab)?.GetRowForHeight(nHeight) ?? 0; }
  GetColForWidth(nTab: SCTAB, nWidth: number): SCCOL { return this.FetchTable(nTab)?.GetColForWidth(nWidth) ?? 0; }
  SetManualHeight(nStartRow: SCROW, nEndRow: SCROW, nTab: SCTAB, bManual: boolean): void { this.FetchTable(nTab)?.SetManualHeight(nStartRow, nEndRow, bManual); }
  IsManualRowHeight(nRow: SCROW, nTab: SCTAB): boolean { return this.FetchTable(nTab)?.IsManualRowHeight(nRow) ?? false; }
  SetOptimalHeight(nStartRow: SCROW, nEndRow: SCROW, nTab: SCTAB, bApi = false): boolean { return this.FetchTable(nTab)?.SetOptimalHeight(nStartRow, nEndRow, bApi) ?? false; }
  GetOptimalColWidth(nCol: SCCOL, nTab: SCTAB, bFormula = false): number { return this.FetchTable(nTab)?.GetOptimalColWidth(nCol, bFormula) ?? 0; }
  ShowCol(nCol: SCCOL, nTab: SCTAB, bShow: boolean): void { this.FetchTable(nTab)?.ShowCol(nCol, bShow); this.SetModified(); }
  ShowRow(nRow: SCROW, nTab: SCTAB, bShow: boolean): void { this.FetchTable(nTab)?.ShowRow(nRow, bShow); this.SetModified(); }
  ShowRows(nRow1: SCROW, nRow2: SCROW, nTab: SCTAB, bShow: boolean): void { this.FetchTable(nTab)?.ShowRows(nRow1, nRow2, bShow); this.SetModified(); }
  RowHidden(nRow: SCROW, nTab: SCTAB): boolean { return this.FetchTable(nTab)?.RowHidden(nRow) ?? false; }
  ColHidden(nCol: SCCOL, nTab: SCTAB): boolean { return this.FetchTable(nTab)?.ColHidden(nCol) ?? false; }
  SetRowHidden(nStartRow: SCROW, nEndRow: SCROW, nTab: SCTAB, bHidden: boolean): void { this.FetchTable(nTab)?.SetRowHidden(nStartRow, nEndRow, bHidden); this.SetModified(); }
  SetColHidden(nStartCol: SCCOL, nEndCol: SCCOL, nTab: SCTAB, bHidden: boolean): void { this.FetchTable(nTab)?.SetColHidden(nStartCol, nEndCol, bHidden); this.SetModified(); }
  RowFiltered(nRow: SCROW, nTab: SCTAB): boolean { return this.FetchTable(nTab)?.RowFiltered(nRow) ?? false; }
  SetRowFiltered(nStartRow: SCROW, nEndRow: SCROW, nTab: SCTAB, bFiltered: boolean): void { this.FetchTable(nTab)?.SetRowFiltered(nStartRow, nEndRow, bFiltered); }

  /** GetRowHeight(nRow, nTab, pStartRow, pEndRow, bHiddenAsZero): the height and its run of rows. */
  GetRowHeightRun(nRow: SCROW, nTab: SCTAB, bHiddenAsZero = true): { nHeight: number; nStartRow: SCROW; nEndRow: SCROW } {
    return this.FetchTable(nTab)?.GetRowHeightRun(nRow, bHiddenAsZero) ?? { nHeight: 0, nStartRow: 0, nEndRow: this.MaxRow() };
  }

  // --- cursor movement ----------------------------------------------------------------------------

  /** FindAreaPos: Ctrl+arrow's target from a cell. */
  FindAreaPos(rCol: SCCOL, rRow: SCROW, nTab: SCTAB, eDirection: number): { rCol: SCCOL; rRow: SCROW } {
    const pTable = this.FetchTable(nTab);
    return pTable ? pTable.FindAreaPos(rCol, rRow, eDirection) : { rCol, rRow };
  }

  /** GetNextPos: the next cell for Enter and Tab. */
  GetNextPos(rCol: SCCOL, rRow: SCROW, nTab: SCTAB, nMovX: SCCOL, nMovY: SCROW, bMarked: boolean, bUnprotected: boolean, rMark: ScMarkData, nTabStartCol: SCCOL = SC_TABSTART_NONE): { rCol: SCCOL; rRow: SCROW } {
    const aCopyMark = rMark.clone();
    aCopyMark.SetMarking(false);
    aCopyMark.MarkToMulti();
    const pTable = this.FetchTable(nTab);
    return pTable ? pTable.GetNextPos(rCol, rRow, nMovX, nMovY, bMarked, bUnprotected, aCopyMark, nTabStartCol) : { rCol, rRow };
  }

  /** SkipOverlapped: moves a position to the origin of the merged cell that covers it. */
  SkipOverlapped(rCol: SCCOL, rRow: SCROW, nTab: SCTAB): { rCol: SCCOL; rRow: SCROW } {
    while (this.IsHorOverlapped(rCol, rRow, nTab)) --rCol;
    while (this.IsVerOverlapped(rCol, rRow, nTab)) --rRow;
    return { rCol, rRow };
  }

  IsHorOverlapped(nCol: SCCOL, nRow: SCROW, nTab: SCTAB): boolean {
    if (!this.ValidColRow(nCol, nRow) || !this.HasTable(nTab)) return false;
    return (this.GetPattern(nCol, nRow, nTab).GetItem('ATTR_MERGE_FLAG') & ScMF.Hor) !== 0;
  }
  IsVerOverlapped(nCol: SCCOL, nRow: SCROW, nTab: SCTAB): boolean {
    if (!this.ValidColRow(nCol, nRow) || !this.HasTable(nTab)) return false;
    return (this.GetPattern(nCol, nRow, nTab).GetItem('ATTR_MERGE_FLAG') & ScMF.Ver) !== 0;
  }

  /** The number of columns allocated in a sheet (GetAllocatedColumnsCount). */
  GetAllocatedColumnsCount(nTab: SCTAB): SCCOL { return this.FetchTable(nTab)?.GetAllocatedColumnsCount() ?? 0; }

  // --- used area ----------------------------------------------------------------------------------

  GetCellArea(nTab: SCTAB): { nEndCol: SCCOL; nEndRow: SCROW; bFound: boolean } { return this.FetchTable(nTab)?.GetCellArea() ?? { nEndCol: 0, nEndRow: 0, bFound: false }; }
  GetDataStart(nTab: SCTAB): { nStartCol: SCCOL; nStartRow: SCROW; bFound: boolean } { return this.FetchTable(nTab)?.GetDataStart() ?? { nStartCol: 0, nStartRow: 0, bFound: false }; }
  GetPrintArea(nTab: SCTAB, bNotes = true): { nEndCol: SCCOL; nEndRow: SCROW; bFound: boolean } { return this.FetchTable(nTab)?.GetPrintArea(bNotes) ?? { nEndCol: 0, nEndRow: 0, bFound: false }; }
  GetLastDataRow(nTab: SCTAB, nCol1: SCCOL, nCol2: SCCOL, nLastRow: SCROW): SCROW { return this.FetchTable(nTab)?.GetLastDataRow(nCol1, nCol2, nLastRow) ?? -1; }
  /** The contiguous data area around a block (for sort and autofill). */
  GetDataArea(nTab: SCTAB, nStartCol: SCCOL, nStartRow: SCROW, nEndCol: SCCOL, nEndRow: SCROW, bIncludeOld: boolean, bOnlyDown: boolean): { nStartCol: SCCOL; nStartRow: SCROW; nEndCol: SCCOL; nEndRow: SCROW } {
    const t = this.FetchTable(nTab);
    if (!t) return { nStartCol, nStartRow, nEndCol, nEndRow };
    return t.GetDataArea(nStartCol, nStartRow, nEndCol, nEndRow, bIncludeOld, bOnlyDown);
  }

  // --- inserting and deleting cells ---------------------------------------------------------------

  CanInsertRow(rRange: ScRange): boolean {
    const nSize = rRange.aEnd.Row() - rRange.aStart.Row() + 1;
    for (let t = rRange.aStart.Tab(); t <= rRange.aEnd.Tab(); t++) if (this.HasTable(t) && !this.maTabs[t]!.TestInsertRow(rRange.aStart.Col(), rRange.aEnd.Col(), rRange.aStart.Row(), nSize)) return false;
    return true;
  }

  CanInsertCol(rRange: ScRange): boolean {
    const nSize = rRange.aEnd.Col() - rRange.aStart.Col() + 1;
    for (let t = rRange.aStart.Tab(); t <= rRange.aEnd.Tab(); t++) if (this.HasTable(t) && !this.maTabs[t]!.TestInsertCol(rRange.aStart.Row(), rRange.aEnd.Row(), nSize)) return false;
    return true;
  }

  /**
   * Insert nSize rows at nStartRow in columns nStartCol..nEndCol of sheets nStartTab..nEndTab (or
   * the marked sheets): references to cells below are updated (InsertRow).
   */
  InsertRow(nStartCol: SCCOL, nStartTab: SCTAB, nEndCol: SCCOL, nEndTab: SCTAB, nStartRow: SCROW, nSize: number, pRefUndoDoc?: ScDocument | null, pTabMark?: ScMarkData | null): boolean {
    if (nStartRow + nSize > this.MaxRow()) return false;
    const aTabs = this.TabsOf(nStartTab, nEndTab, pTabMark);
    for (const t of aTabs) if (!this.maTabs[t]!.TestInsertRow(nStartCol, nEndCol, nStartRow, nSize)) return false;
    this.ClearListeners();
    for (const t of aTabs) {
      const aCxt = new RefUpdateContext(this);
      aCxt.meMode = UpdateRefMode.URM_INSDEL;
      aCxt.maRange = new ScRange(nStartCol, nStartRow, t, nEndCol, this.MaxRow(), t);
      aCxt.mnRowDelta = nSize;
      this.UpdateReference(aCxt, pRefUndoDoc);
      this.maTabs[t]!.InsertRow(nStartCol, nEndCol, nStartRow, nSize);
    }
    this.StartAllListeners();
    this.SetDirtyAfterStructureChange();
    this.SetModified();
    return true;
  }

  DeleteRow(nStartCol: SCCOL, nStartTab: SCTAB, nEndCol: SCCOL, nEndTab: SCTAB, nStartRow: SCROW, nSize: number, pRefUndoDoc?: ScDocument | null, pTabMark?: ScMarkData | null): void {
    const aTabs = this.TabsOf(nStartTab, nEndTab, pTabMark);
    this.ClearListeners();
    for (const t of aTabs) {
      // Formulas in the deleted block go away; dependents of them get #REF!.
      this.maTabs[t]!.DeleteArea(nStartCol, nStartRow, nEndCol, nStartRow + nSize - 1, InsertDeleteFlags.FORMULA, false);
      if (nStartRow + nSize <= this.MaxRow()) {
        const aCxt = new RefUpdateContext(this);
        aCxt.meMode = UpdateRefMode.URM_INSDEL;
        aCxt.maRange = new ScRange(nStartCol, nStartRow + nSize, t, nEndCol, this.MaxRow(), t);
        aCxt.mnRowDelta = -nSize;
        this.UpdateReference(aCxt, pRefUndoDoc);
      } else {
        // deleting up to the last row: references into the block become #REF!
        const aCxt = new RefUpdateContext(this);
        aCxt.meMode = UpdateRefMode.URM_INSDEL;
        aCxt.maRange = new ScRange(nStartCol, this.MaxRow() + 1 - 0, t, nEndCol, this.MaxRow(), t);
        aCxt.maRange.aStart.SetRow(nStartRow + nSize);
        aCxt.mnRowDelta = -nSize;
        this.UpdateReference(aCxt, pRefUndoDoc);
      }
      this.maTabs[t]!.DeleteRow(nStartCol, nEndCol, nStartRow, nSize);
    }
    this.StartAllListeners();
    this.SetDirtyAfterStructureChange();
    this.SetModified();
  }

  InsertCol(nStartRow: SCROW, nStartTab: SCTAB, nEndRow: SCROW, nEndTab: SCTAB, nStartCol: SCCOL, nSize: number, pRefUndoDoc?: ScDocument | null, pTabMark?: ScMarkData | null): boolean {
    if (nStartCol + nSize > this.MaxCol()) return false;
    const aTabs = this.TabsOf(nStartTab, nEndTab, pTabMark);
    for (const t of aTabs) if (!this.maTabs[t]!.TestInsertCol(nStartRow, nEndRow, nSize)) return false;
    this.ClearListeners();
    for (const t of aTabs) {
      const aCxt = new RefUpdateContext(this);
      aCxt.meMode = UpdateRefMode.URM_INSDEL;
      aCxt.maRange = new ScRange(nStartCol, nStartRow, t, this.MaxCol(), nEndRow, t);
      aCxt.mnColDelta = nSize;
      this.UpdateReference(aCxt, pRefUndoDoc);
      this.maTabs[t]!.InsertCol(nStartRow, nEndRow, nStartCol, nSize);
    }
    this.StartAllListeners();
    this.SetDirtyAfterStructureChange();
    this.SetModified();
    return true;
  }

  DeleteCol(nStartRow: SCROW, nStartTab: SCTAB, nEndRow: SCROW, nEndTab: SCTAB, nStartCol: SCCOL, nSize: number, pRefUndoDoc?: ScDocument | null, pTabMark?: ScMarkData | null): void {
    const aTabs = this.TabsOf(nStartTab, nEndTab, pTabMark);
    this.ClearListeners();
    for (const t of aTabs) {
      this.maTabs[t]!.DeleteArea(nStartCol, nStartRow, nStartCol + nSize - 1, nEndRow, InsertDeleteFlags.FORMULA, false);
      const aCxt = new RefUpdateContext(this);
      aCxt.meMode = UpdateRefMode.URM_INSDEL;
      aCxt.maRange = new ScRange(nStartCol + nSize, nStartRow, t, this.MaxCol(), nEndRow, t);
      aCxt.mnColDelta = -nSize;
      this.UpdateReference(aCxt, pRefUndoDoc);
      this.maTabs[t]!.DeleteCol(nStartRow, nEndRow, nStartCol, nSize);
    }
    this.StartAllListeners();
    this.SetDirtyAfterStructureChange();
    this.SetModified();
  }

  private TabsOf(nStartTab: SCTAB, nEndTab: SCTAB, pTabMark?: ScMarkData | null): SCTAB[] {
    const a: SCTAB[] = [];
    for (let t = nStartTab; t <= nEndTab; t++) if (this.HasTable(t) && (!pTabMark || pTabMark.GetTableSelect(t))) a.push(t);
    return a;
  }

  /** Update the references of all formula cells and names (UpdateReference). */
  UpdateReference(rCxt: RefUpdateContext, pUndoDoc?: ScDocument | null): void {
    if (this.pRangeName) this.pRangeName.UpdateReference(rCxt, -1);
    for (const t of this.maTabs) t?.UpdateReference(rCxt, pUndoDoc);
  }

  /**
   * Move a block of cells by an offset (cut and paste, drag and drop): the cells are moved and
   * references to them follow (UpdateReference with URM_MOVE). rSource is the original block.
   */
  MoveBlock(rSource: ScRange, nDx: SCCOL, nDy: SCROW, nDz: SCTAB): void {
    const aDest = rSource.clone();
    aDest.Move(nDx, nDy, nDz, ScRange.Invalid(), this);
    this.ClearListeners();
    // take the cells out
    const aCells: { pos: ScAddress; p: ScCellData }[] = [];
    const aAttrs: { nCol: number; nRow1: number; nRow2: number; p: ScPatternAttr; nTab: number }[] = [];
    for (let t = rSource.aStart.Tab(); t <= rSource.aEnd.Tab(); t++) {
      const pTab = this.FetchTable(t);
      if (!pTab) continue;
      for (let c = rSource.aStart.Col(); c <= rSource.aEnd.Col(); c++) {
        const pCol = pTab.FetchColumn(c);
        if (!pCol) continue;
        const { aRows, aCells: a } = pCol.GetCellsInRange(rSource.aStart.Row(), rSource.aEnd.Row());
        for (let i = 0; i < aRows.length; i++) {
          aCells.push({ pos: new ScAddress(c, aRows[i]!, t), p: a[i]! });
          pCol.RemoveCellRaw(aRows[i]!);
        }
        for (const e of pCol.pAttrArray.CopyArea(rSource.aStart.Row(), rSource.aEnd.Row())) aAttrs.push({ nCol: c, nRow1: rSource.aStart.Row() + e.nStart, nRow2: rSource.aStart.Row() + e.nEnd, p: e.pPattern, nTab: t });
        pCol.pAttrArray.DeleteArea(rSource.aStart.Row(), rSource.aEnd.Row());
      }
    }
    // update the references of all formulas, including the moved ones
    const aCxt = new RefUpdateContext(this);
    aCxt.meMode = UpdateRefMode.URM_MOVE;
    aCxt.maRange = aDest;
    aCxt.mnColDelta = nDx;
    aCxt.mnRowDelta = nDy;
    aCxt.mnTabDelta = nDz;
    const aMoved = new Set<ScFormulaCell>();
    for (const { pos, p } of aCells) {
      if (p instanceof ScFormulaCell) {
        p.UpdateReferenceOnMove(aCxt, pos);
        aMoved.add(p);
      }
    }
    for (const t of this.maTabs) {
      if (!t) continue;
      for (const f of t.FormulaCells()) {
        if (aMoved.has(f)) continue;
        if (f.UpdateReferenceOnMove(aCxt)) f.SetDirtyVar();
      }
    }
    // overwrite the destination
    for (let t = aDest.aStart.Tab(); t <= aDest.aEnd.Tab(); t++) this.FetchTable(t)?.DeleteArea(aDest.aStart.Col(), aDest.aStart.Row(), aDest.aEnd.Col(), aDest.aEnd.Row(), InsertDeleteFlags.ALL, false);
    for (const { pos, p } of aCells) {
      const d = pos.clone();
      d.Move(nDx, nDy, nDz, ScAddress.Invalid(), this);
      const pTab = this.FetchTable(d.Tab());
      if (!pTab) continue;
      pTab.CreateColumnIfNotExists(d.Col()).SetCellRaw(d.Row(), p);
      if (p instanceof ScFormulaCell) p.SetDirtyVar();
    }
    for (const a of aAttrs) this.FetchTable(a.nTab + nDz)?.SetPatternArea(a.nCol + nDx, a.nRow1 + nDy, a.nCol + nDx, a.nRow2 + nDy, a.p);
    this.StartAllListeners();
    this.SetDirtyAfterStructureChange();
    this.SetModified();
  }

  // --- formula calculation ------------------------------------------------------------------------

  GetAutoCalc(): boolean { return this.bAutoCalc; }
  SetAutoCalc(bNewAutoCalc: boolean): void {
    const bOld = this.bAutoCalc;
    this.bAutoCalc = bNewAutoCalc;
    if (!bOld && bNewAutoCalc && !this.IsClipOrUndo()) this.CalcFormulaTree();
  }

  GetHardRecalcState(): number { return this.eHardRecalcState; }
  SetHardRecalcState(e: number): void { this.eHardRecalcState = e; }
  GetRecursionHelper(): ScRecursionHelper { return this.maRecursionHelper; }
  GetRecursionIteration(): number { return this.mnRecursionIteration; }
  SetRecursionIteration(n: number): void { this.mnRecursionIteration = n; }
  IncInterpretLevel(): void { this.nInterpretLevel++; }
  DecInterpretLevel(): void { this.nInterpretLevel--; }
  IsInInterpreter(): boolean { return this.nInterpretLevel > 0; }

  /** Formula cells are not kept in a tree; dirty cells are found by their flag. */
  IsInFormulaTree(_pCell: ScFormulaCell): boolean { return false; }
  PutInFormulaTree(_pCell: ScFormulaCell): void {}
  RemoveFromFormulaTree(pCell: ScFormulaCell): void {
    this.maFormulaTrack.delete(pCell);
    this.maVolatile.delete(pCell);
  }

  AppendToFormulaTrack(pCell: ScFormulaCell): void { this.maFormulaTrack.add(pCell); }

  /** Broadcast the dirty state of the tracked formula cells to their dependents, which become
      dirty and are tracked in turn (TrackFormulas). */
  TrackFormulas(): void {
    if (this.bInTrackFormulas) return;
    this.bInTrackFormulas = true;
    try {
      while (this.maFormulaTrack.size) {
        const it = this.maFormulaTrack.values().next();
        const pCell = it.value as ScFormulaCell;
        this.maFormulaTrack.delete(pCell);
        this.pBASM.CollectListeners(pCell.aPos.Tab(), pCell.aPos.Col(), pCell.aPos.Row(), (p) => {
          const f = p as ScFormulaCell;
          if (f === pCell || f.GetDirty()) return;
          f.SetDirtyVar();
          this.maFormulaTrack.add(f);
        });
      }
    } finally {
      this.bInTrackFormulas = false;
    }
  }

  /** A cell changed: its dependents become dirty (Broadcast with ScHint DataChanged). */
  Broadcast(rAddr: ScAddress): void {
    if (this.IsClipOrUndo()) return;
    this.mnModifyCount++;
    this.pBASM.CollectListeners(rAddr.Tab(), rAddr.Col(), rAddr.Row(), (p) => {
      const f = p as ScFormulaCell;
      if (f.GetDirty()) return;
      f.SetDirtyVar();
      this.maFormulaTrack.add(f);
    });
    this.TrackFormulas();
  }

  /** A block changed (BroadcastCells). */
  BroadcastRange(nTab: SCTAB, nCol1: SCCOL, nRow1: SCROW, nCol2: SCCOL, nRow2: SCROW): void {
    if (this.IsClipOrUndo()) return;
    this.mnModifyCount++;
    this.pBASM.CollectRangeListeners(new ScRange(nCol1, nRow1, nTab, nCol2, nRow2, nTab), (p) => {
      const f = p as ScFormulaCell;
      if (f.GetDirty()) return;
      f.SetDirtyVar();
      this.maFormulaTrack.add(f);
    });
    this.TrackFormulas();
  }

  StartListeningCell(rAddress: ScAddress, pListener: ScListener): void { this.pBASM.StartListeningCell(rAddress, pListener); }
  EndListeningCell(rAddress: ScAddress, pListener: ScListener): void { this.pBASM.EndListeningCell(rAddress, pListener); }
  StartListeningArea(rRange: ScRange, pListener: ScListener): void {
    this.pBASM.StartListeningArea(rRange, pListener);
    if (rRange.aStart.Row() === 0x7fffffff) this.maVolatile.add(pListener as ScFormulaCell);
  }
  EndListeningArea(rRange: ScRange, pListener: ScListener): void {
    this.pBASM.EndListeningArea(rRange, pListener);
    if (rRange.aStart.Row() === 0x7fffffff) this.maVolatile.delete(pListener as ScFormulaCell);
  }
  GetBASM(): ScBroadcastAreaSlotMachine { return this.pBASM; }

  /** Drop all listeners (before a structural change). */
  ClearListeners(): void {
    this.pBASM.Clear();
    this.maVolatile.clear();
    for (const t of this.maTabs) if (t) for (const f of t.FormulaCells()) { f.mvListened = []; f.mbListensAlways = false; }
  }

  /** Let all formula cells listen to their references (StartAllListeners). */
  StartAllListeners(): void {
    if (this.IsClipOrUndo()) return;
    for (const t of this.maTabs) if (t) for (const f of t.FormulaCells()) f.StartListeningTo(this);
  }

  /** Mark all formula cells dirty (SetAllFormulasDirty), calculating them if AutoCalc is on. */
  SetAllFormulasDirty(): void {
    for (const t of this.maTabs) if (t) for (const f of t.FormulaCells()) f.SetDirtyVar();
  }

  private SetDirtyAfterStructureChange(): void {
    // Structural changes may change any result (positions, deleted references).
    this.SetAllFormulasDirty();
  }

  /** Interpret all dirty formula cells (CalcFormulaTree; "Recalculate" when AutoCalc is off). */
  CalcFormulaTree(bOnlyForced = false, bProgressBar = false, bSetAllDirty = true): void {
    void bOnlyForced; void bProgressBar; void bSetAllDirty;
    const bOldAutoCalc = this.bAutoCalc;
    this.bAutoCalc = true;
    try {
      for (const t of this.maTabs) if (t) for (const f of t.FormulaCells()) if (f.GetDirty()) f.Interpret();
    } finally {
      this.bAutoCalc = bOldAutoCalc;
    }
  }

  /** Recalculate everything (CalcAll, "Hard Recalc"): all formulas dirty and interpreted. */
  CalcAll(): void {
    this.SetAllFormulasDirty();
    this.CalcFormulaTree();
  }

  /** Recalculate volatile cells (RAND, NOW): they are dirty after every change. */
  CalcVolatile(): void {
    for (const f of this.maVolatile) f.SetDirtyVar();
  }

  /** After loading: listen and calculate (CalcAfterLoad). */
  CalcAfterLoad(): void {
    this.bCalcingAfterLoad = true;
    try {
      this.ClearListeners();
      this.StartAllListeners();
      this.SetAllFormulasDirty();
    } finally {
      this.bCalcingAfterLoad = false;
    }
    if (this.bAutoCalc) this.CalcFormulaTree();
  }

  /** Insert an array formula over a block (InsertMatrixFormula): the origin holds the formula,
      the other cells refer to it (ocMatRef). */
  InsertMatrixFormula(nCol1: SCCOL, nRow1: SCROW, nCol2: SCCOL, nRow2: SCROW, rMark: ScMarkData, rFormula: string, pArr: ScTokenArray | null = null, eGram: FormulaGrammar.Grammar = FormulaGrammar.GRAM_DEFAULT): void {
    const nTab1 = rMark.GetFirstSelected();
    const aPos = new ScAddress(nCol1, nRow1, nTab1);
    const pCell = pArr ? new ScFormulaCell(this, aPos, pArr, eGram, ScMatrixMode.Formula) : new ScFormulaCell(this, aPos, rFormula, eGram, ScMatrixMode.Formula);
    pCell.SetMatColsRows(nCol2 - nCol1 + 1, nRow2 - nRow1 + 1);
    for (const nTab of rMark) {
      const p = nTab === nTab1 ? pCell : pCell.Clone(new ScAddress(nCol1, nRow1, nTab));
      this.FetchTable(nTab)?.SetFormulaCell(nCol1, nRow1, p);
    }
    const aRefData = new ScSingleRefData();
    aRefData.InitFlags();
    aRefData.SetRelCol(0);
    aRefData.SetRelRow(0);
    aRefData.SetRelTab(0); // 2D matrix, always same sheet
    for (const nTab of rMark) {
      for (let j = nCol1; j <= nCol2; j++) {
        for (let k = nRow1; k <= nRow2; k++) {
          if (j === nCol1 && k === nRow1) continue;
          const aPosK = new ScAddress(j, k, nTab);
          const r = aRefData.clone();
          r.SetAddress(this.GetSheetLimits(), new ScAddress(nCol1, nRow1, nTab), aPosK);
          const aArr = new ScTokenArray(this);
          aArr.AddMatrixSingleReference(r);
          const pRef = new ScFormulaCell(this, aPosK, aArr, eGram, ScMatrixMode.Reference);
          this.FetchTable(nTab)?.SetFormulaCell(j, k, pRef);
        }
      }
    }
    void ocMatRef;
    this.SetModified();
  }

  // --- document functions (documen3.cxx, document.cxx): fill, sort, selection, merge contents ----

  /** Whether undo actions are recorded for this document (IsUndoEnabled). */
  IsUndoEnabled(): boolean { return this.mbUndoEnabled; }
  EnableUndo(bVal: boolean): void { this.mbUndoEnabled = bVal; }

  /** Fill the marked sheets from a source block (ScDocument::Fill). */
  Fill(nCol1: SCCOL, nRow1: SCROW, nCol2: SCCOL, nRow2: SCROW, rMark: ScMarkData, nFillCount: number, eFillDir: FillDir = FillDir.FILL_TO_BOTTOM, eFillCmd: FillCmd = FillCmd.FILL_LINEAR, eFillDateCmd: FillDateCmd = FillDateCmd.FILL_DAY, nStepValue = 1.0, nMaxValue = 1e307): void {
    if (nCol2 < nCol1) [nCol1, nCol2] = [nCol2, nCol1];
    if (nRow2 < nRow1) [nRow1, nRow2] = [nRow2, nRow1];
    for (const nTab of rMark) {
      if (nTab >= this.maTabs.length) break;
      this.maTabs[nTab]?.Fill(nCol1, nRow1, nCol2, nRow2, nFillCount, eFillDir, eFillCmd, eFillDateCmd, nStepValue, 0, nMaxValue);
    }
    this.SetModified();
  }

  /** The count of empty rows or columns at an edge of a block (GetEmptyLinesInBlock). */
  GetEmptyLinesInBlock(nStartCol: SCCOL, nStartRow: SCROW, nStartTab: SCTAB, nEndCol: SCCOL, nEndRow: SCROW, nEndTab: SCTAB, eDir: ScDirection): number {
    if (nEndCol < nStartCol) [nStartCol, nEndCol] = [nEndCol, nStartCol];
    if (nEndRow < nStartRow) [nStartRow, nEndRow] = [nEndRow, nStartRow];
    void nEndTab;
    return this.FetchTable(nStartTab)?.GetEmptyLinesInBlock(nStartCol, nStartRow, nEndCol, nEndRow, eDir) ?? 0;
  }

  Sort(nTab: SCTAB, rSortParam: ScSortParam, bKeepQuery: boolean, bUpdateRefs: boolean, pUndo?: ReorderParam | null): void {
    this.FetchTable(nTab)?.Sort(rSortParam, bKeepQuery, bUpdateRefs, pUndo);
    this.SetModified();
  }

  Reorder(rParam: ReorderParam): void {
    this.FetchTable(rParam.maSortRange.aStart.Tab())?.Reorder(rParam);
    this.SetModified();
  }

  /** Delete content of the marked cells by flags (DeleteSelection). */
  DeleteSelection(nDelFlag: InsertDeleteFlags, rMark: ScMarkData, bBroadcast = true): void {
    for (const nTab of rMark) this.DeleteSelectionTab(nTab, nDelFlag, rMark, bBroadcast);
  }

  DeleteSelectionTab(nTab: SCTAB, nDelFlag: InsertDeleteFlags, rMark: ScMarkData, bBroadcast = true): void {
    const t = this.FetchTable(nTab);
    if (!t) return;
    for (const r of rMark.GetMarkedRangesForTab(nTab)) t.DeleteArea(r.aStart.Col(), r.aStart.Row(), r.aEnd.Col(), r.aEnd.Row(), nDelFlag, bBroadcast);
    this.SetModified();
  }

  /** Join the strings of a block into its first cell, emptying the others (DoMergeContents). */
  DoMergeContents(nStartCol: SCCOL, nStartRow: SCROW, nEndCol: SCCOL, nEndRow: SCROW, nTab: SCTAB): void {
    let aTotal = '';
    let aCell: ScCellData | undefined;
    for (let nRow = nStartRow; nRow <= nEndRow; nRow++)
      for (let nCol = nStartCol; nCol <= nEndCol; nCol++) {
        const aCellStr = this.GetString(nCol, nRow, nTab);
        if (aCellStr) {
          if (aTotal) aTotal += ' ';
          aTotal += aCellStr;
          const aPos = new ScAddress(nCol, nRow, nTab);
          if (this.GetCellType(aPos) === 4 /* CELLTYPE_EDIT */ && aCell === undefined) aCell = this.GetEditText(aPos)!.Clone();
        }
        if (nCol !== nStartCol || nRow !== nStartRow) this.SetString(nCol, nRow, nTab, '');
      }
    if (aCell === undefined || this.GetString(nStartCol, nStartRow, nTab)) this.SetString(nStartCol, nStartRow, nTab, aTotal);
    else this.SetCellData(new ScAddress(nStartCol, nStartRow, nTab), aCell);
  }

  /** Empty a block except its first cell (DoEmptyBlock). */
  DoEmptyBlock(nStartCol: SCCOL, nStartRow: SCROW, nEndCol: SCCOL, nEndRow: SCROW, nTab: SCTAB): void {
    for (let nRow = nStartRow; nRow <= nEndRow; nRow++)
      for (let nCol = nStartCol; nCol <= nEndCol; nCol++) if (nCol !== nStartCol || nRow !== nStartRow) this.SetString(nCol, nRow, nTab, '');
  }

  /** Extend the start of a range to the origins of the merged cells overlapping it
      (ExtendOverlapped). */
  ExtendOverlapped(rRange: ScRange): void {
    for (let nTab = rRange.aStart.Tab(); nTab <= rRange.aEnd.Tab(); nTab++) {
      const t = this.FetchTable(nTab);
      if (!t) continue;
      for (let nCol = rRange.aStart.Col(); nCol <= Math.min(rRange.aEnd.Col(), t.GetAllocatedColumnsCount() - 1); nCol++) {
        for (const e of t.FetchColumn(nCol)!.pAttrArray.CopyArea(rRange.aStart.Row(), rRange.aEnd.Row())) {
          if (!e.pPattern.IsOverlapped()) continue;
          const o = t.GetMergeOrigin(nCol, rRange.aStart.Row() + e.nStart);
          if (o.nCol < rRange.aStart.Col()) rRange.aStart.SetCol(o.nCol);
          if (o.nRow < rRange.aStart.Row()) rRange.aStart.SetRow(o.nRow);
        }
      }
    }
  }

  /** Mark the formula cells of a range dirty and broadcast the change (SetDirty). */
  SetDirty(rRange: ScRange, bIncludeEmptyCells = true): void {
    for (let nTab = rRange.aStart.Tab(); nTab <= rRange.aEnd.Tab(); nTab++) {
      const t = this.FetchTable(nTab);
      if (!t) continue;
      for (let nCol = rRange.aStart.Col(); nCol <= Math.min(rRange.aEnd.Col(), t.GetAllocatedColumnsCount() - 1); nCol++)
        t.FetchColumn(nCol)!.ForEachCell(rRange.aStart.Row(), rRange.aEnd.Row(), (_r, p) => { if (p instanceof ScFormulaCell) p.SetDirtyVar(); });
      if (bIncludeEmptyCells) this.BroadcastRange(nTab, rRange.aStart.Col(), rRange.aStart.Row(), rRange.aEnd.Col(), rRange.aEnd.Row());
    }
  }

  /** Whether a block has no cells (IsEmptyData). */
  IsEmptyData(nStartCol: SCCOL, nStartRow: SCROW, nEndCol: SCCOL, nEndRow: SCROW, nTab: SCTAB): boolean { return this.IsBlockEmpty(nStartCol, nStartRow, nEndCol, nEndRow, nTab); }

  /** Whether a block has cell notes (HasNote). */
  HasNote(nTab: SCTAB, nStartCol: SCCOL, nStartRow: SCROW, nEndCol: SCCOL, nEndRow: SCROW): boolean {
    const t = this.FetchTable(nTab);
    if (!t) return false;
    for (let nCol = nStartCol; nCol <= Math.min(nEndCol, t.GetAllocatedColumnsCount() - 1); nCol++)
      if (t.FetchColumn(nCol)!.GetNoteRows().some((r) => r >= nStartRow && r <= nEndRow)) return true;
    return false;
  }

  /**
   * Shrink a range to the part with data (ShrinkToUsedDataArea, reduced: the data area extras
   * are not considered): empty trailing rows and columns go, leading ones too unless sticky.
   */
  ShrinkToUsedDataArea(nTab: SCTAB, nStartCol: SCCOL, nStartRow: SCROW, nEndCol: SCCOL, nEndRow: SCROW, bColumnsOnly: boolean, bStickyTopRow = false, bStickyLeftCol = false): { bShrunk: boolean; nStartCol: SCCOL; nStartRow: SCROW; nEndCol: SCCOL; nEndRow: SCROW; bFound: boolean } {
    const t = this.FetchTable(nTab);
    const r = { bShrunk: false, nStartCol, nStartRow, nEndCol, nEndRow, bFound: false };
    if (!t) return r;
    if (t.IsBlockEmpty(nStartCol, nStartRow, nEndCol, nEndRow)) return r;
    r.bFound = true;
    while (r.nEndCol > r.nStartCol && t.IsBlockEmpty(r.nEndCol, r.nStartRow, r.nEndCol, r.nEndRow)) { r.nEndCol--; r.bShrunk = true; }
    if (!bStickyLeftCol) while (r.nStartCol < r.nEndCol && t.IsBlockEmpty(r.nStartCol, r.nStartRow, r.nStartCol, r.nEndRow)) { r.nStartCol++; r.bShrunk = true; }
    if (!bColumnsOnly) {
      const nLast = t.GetLastDataRow(r.nStartCol, r.nEndCol, r.nEndRow);
      if (nLast >= r.nStartRow && nLast < r.nEndRow) { r.nEndRow = nLast; r.bShrunk = true; }
      if (!bStickyTopRow) while (r.nStartRow < r.nEndRow && t.IsBlockEmpty(r.nStartCol, r.nStartRow, r.nEndCol, r.nStartRow)) { r.nStartRow++; r.bShrunk = true; }
    }
    return r;
  }

  // --- clip and undo documents ---------------------------------------------------------------------

  /** Make this (undo) document hold sheets nTab1..nTab2 of rSrcDoc with its styles (InitUndo). */
  InitUndo(rSrcDoc: ScDocument, nTab1: SCTAB, nTab2: SCTAB, bColInfo = false, bRowInfo = false): void {
    void bColInfo; void bRowInfo;
    this.mxStylePool.CopyStylesFrom(rSrcDoc.mxStylePool);
    this.mpCellAttributeHelper = new CellAttributeHelper(this.mxStylePool.GetStandardStyle());
    this.maTabs = [];
    for (let i = 0; i <= nTab2; i++) this.maTabs.push(null);
    for (let n = nTab1; n <= nTab2; n++) {
      const t = new ScTable(this, n, rSrcDoc.GetName(n) ?? '');
      this.maTabs[n] = t;
    }
  }

  /** Add sheets to an undo document (AddUndoTab). */
  AddUndoTab(nTab1: SCTAB, nTab2: SCTAB, bColInfo = false, bRowInfo = false): void {
    void bColInfo; void bRowInfo;
    while (this.maTabs.length <= nTab2) this.maTabs.push(null);
    for (let n = nTab1; n <= nTab2; n++) if (!this.maTabs[n]) this.maTabs[n] = new ScTable(this, n, `temp${n}`);
  }

  /** Copy a block by flags into another document at the same position (CopyToDocument). */
  CopyToDocument(rRange: ScRange, nFlags: InsertDeleteFlags, bOnlyMarked: boolean, rDestDoc: ScDocument, pMarks?: ScMarkData | null, bColRowFlags = true): void {
    void bOnlyMarked;
    for (let t = rRange.aStart.Tab(); t <= rRange.aEnd.Tab(); t++) {
      if (pMarks && !pMarks.GetTableSelect(t)) continue;
      const pSrc = this.FetchTable(t);
      if (!pSrc) continue;
      if (rDestDoc.IsUndo()) {
        rDestDoc.AddUndoTab(t, t);
        rDestDoc.maTabs[t]!.SetName(pSrc.GetName());
      }
      const pDest = rDestDoc.FetchTable(t);
      if (!pDest) continue;
      pSrc.CopyToTable(rRange.aStart.Col(), rRange.aStart.Row(), rRange.aEnd.Col(), rRange.aEnd.Row(), nFlags, pDest, bColRowFlags);
    }
  }

  /** Copy a block back from an undo document (UndoToDocument): the destination block is deleted
      by the flags first. */
  UndoToDocument(rRange: ScRange, nFlags: InsertDeleteFlags, bOnlyMarked: boolean, rDestDoc: ScDocument): void {
    void bOnlyMarked;
    for (let t = rRange.aStart.Tab(); t <= rRange.aEnd.Tab(); t++) {
      const pSrc = this.FetchTable(t);
      const pDest = rDestDoc.FetchTable(t);
      if (!pSrc || !pDest) continue;
      pDest.DeleteArea(rRange.aStart.Col(), rRange.aStart.Row(), rRange.aEnd.Col(), rRange.aEnd.Row(), nFlags, false);
      pSrc.CopyToTable(rRange.aStart.Col(), rRange.aStart.Row(), rRange.aEnd.Col(), rRange.aEnd.Row(), nFlags, pDest);
    }
    rDestDoc.ClearListeners();
    rDestDoc.StartAllListeners();
    rDestDoc.BroadcastRange(rRange.aStart.Tab(), rRange.aStart.Col(), rRange.aStart.Row(), rRange.aEnd.Col(), rRange.aEnd.Row());
    for (let t = rRange.aStart.Tab(); t <= rRange.aEnd.Tab(); t++) {
      const pDest = rDestDoc.FetchTable(t);
      if (!pDest) continue;
      for (let c = rRange.aStart.Col(); c <= rRange.aEnd.Col(); c++) pDest.FetchColumn(c)?.ForEachCell(rRange.aStart.Row(), rRange.aEnd.Row(), (_r, p) => { if (p instanceof ScFormulaCell) p.SetDirty(); });
    }
    rDestDoc.SetModified();
  }

  GetClipParam(): ScClipParam { return this.aClipParam; }
  SetClipParam(r: ScClipParam): void { this.aClipParam = r; }

  /**
   * Copy the marked block into a clipboard document (CopyToClip): the cells with all attributes,
   * the column widths and row heights, the styles and the named expressions.
   */
  CopyToClip(rClipParam: ScClipParam, pClipDoc: ScDocument, pMarks: ScMarkData, bKeepScenarioFlags = false, bIncludeObjects = false): void {
    void bKeepScenarioFlags; void bIncludeObjects;
    if (!pClipDoc.bIsClip) return;
    pClipDoc.aClipParam = rClipParam;
    pClipDoc.mxStylePool.CopyStylesFrom(this.mxStylePool);
    pClipDoc.mpCellAttributeHelper = new CellAttributeHelper(pClipDoc.mxStylePool.GetStandardStyle());
    pClipDoc.pRangeName = this.pRangeName ? this.pRangeName.clone(pClipDoc) : null;
    pClipDoc.maTabs = [];
    const aClipRange = rClipParam.getWholeRange();
    for (let i = 0; i < this.maTabs.length; i++) {
      pClipDoc.maTabs.push(null);
      if (!this.maTabs[i] || !pMarks.GetTableSelect(i)) continue;
      const pDest = new ScTable(pClipDoc, i, this.maTabs[i]!.GetName());
      pClipDoc.maTabs[i] = pDest;
      for (const r of rClipParam.maRanges) this.maTabs[i]!.CopyToTable(r.aStart.Col(), r.aStart.Row(), r.aEnd.Col(), r.aEnd.Row(), InsertDeleteFlags.ALL, pDest, false);
      // widths and heights of the clip range
      for (let c = aClipRange.aStart.Col(); c <= aClipRange.aEnd.Col(); c++) {
        pDest.SetColWidth(c, this.maTabs[i]!.GetOriginalWidth(c));
        pDest.SetColHidden(c, c, this.maTabs[i]!.ColHidden(c));
      }
      for (let r = aClipRange.aStart.Row(); r <= aClipRange.aEnd.Row(); r++) {
        pDest.SetRowHeight(r, this.maTabs[i]!.GetRowHeight(r, false));
        if (this.maTabs[i]!.RowHidden(r)) pDest.SetRowHidden(r, r, true);
      }
    }
  }

  /** The first sheet of a clip document and its used block. */
  GetClipStart(): { nClipX: SCCOL; nClipY: SCROW } {
    const r = this.aClipParam.getWholeRange();
    return { nClipX: r.aStart.Col(), nClipY: r.aStart.Row() };
  }

  /** The size of the clip's content (GetClipArea): columns and rows - 1. */
  GetClipArea(bIncludeFiltered = true): { nClipX: SCCOL; nClipY: SCROW } {
    void bIncludeFiltered;
    const r = this.aClipParam.getWholeRange();
    return { nClipX: r.aEnd.Col() - r.aStart.Col(), nClipY: r.aEnd.Row() - r.aStart.Row() };
  }

  /**
   * Paste a clipboard document into the marked block (CopyFromClip): the clip is repeated over
   * the destination; formulas are copied with their relative references moved, absolute ones
   * kept. Content is deleted first by nInsFlag (unless bSkipEmptyCells).
   */
  CopyFromClip(rDestRange: ScRange, rMark: ScMarkData, nInsFlag: InsertDeleteFlags, pRefUndoDoc: ScDocument | null, pClipDoc: ScDocument, bResetCut = true, bAsLink = false, bIncludeFiltered = true, bSkipEmptyCells = false): void {
    void pRefUndoDoc; void bResetCut; void bAsLink; void bIncludeFiltered;
    if (!pClipDoc.bIsClip) return;
    const aClipRange = pClipDoc.aClipParam.getWholeRange();
    const nClipTab = pClipDoc.maTabs.findIndex((t) => !!t);
    if (nClipTab < 0) return;
    const pClipTab = pClipDoc.maTabs[nClipTab]!;
    const nClipCols = aClipRange.aEnd.Col() - aClipRange.aStart.Col() + 1;
    const nClipRows = aClipRange.aEnd.Row() - aClipRange.aStart.Row() + 1;
    // the destination block: a single cell takes the clip's size
    let nDestEndCol = rDestRange.aEnd.Col(), nDestEndRow = rDestRange.aEnd.Row();
    if (rDestRange.aStart.equals(rDestRange.aEnd)) {
      nDestEndCol = Math.min(this.MaxCol(), rDestRange.aStart.Col() + nClipCols - 1);
      nDestEndRow = Math.min(this.MaxRow(), rDestRange.aStart.Row() + nClipRows - 1);
    }
    const bCut = pClipDoc.aClipParam.mbCutMode;
    for (const nTab of rMark) {
      const pDest = this.FetchTable(nTab);
      if (!pDest) continue;
      if (!bSkipEmptyCells) pDest.DeleteArea(rDestRange.aStart.Col(), rDestRange.aStart.Row(), nDestEndCol, nDestEndRow, nInsFlag & InsertDeleteFlags.CONTENTS, false);
      for (let nCol = rDestRange.aStart.Col(); nCol <= nDestEndCol; nCol += nClipCols) {
        for (let nRow = rDestRange.aStart.Row(); nRow <= nDestEndRow; nRow += nClipRows) {
          const nDx = nCol - aClipRange.aStart.Col();
          const nDy = nRow - aClipRange.aStart.Row();
          for (let c = 0; c < nClipCols && nCol + c <= nDestEndCol; c++) {
            const pSrcCol = pClipTab.FetchColumn(aClipRange.aStart.Col() + c);
            const pDestCol = pDest.CreateColumnIfNotExists(nCol + c);
            const nRowEnd = Math.min(nClipRows - 1, nDestEndRow - nRow);
            if (nInsFlag & InsertDeleteFlags.ATTRIB) {
              if (pSrcCol) {
                for (const e of pSrcCol.pAttrArray.CopyArea(aClipRange.aStart.Row(), aClipRange.aStart.Row() + nRowEnd)) {
                  const p = this.ImportPattern(e.pPattern);
                  if ((nInsFlag & InsertDeleteFlags.ATTRIB) === InsertDeleteFlags.ATTRIB) pDestCol.SetPatternArea(nRow + e.nStart, nRow + e.nEnd, p);
                  else if (p.GetStyleSheet()) pDestCol.ApplyStyleArea(nRow + e.nStart, nRow + e.nEnd, p.GetStyleSheet()!);
                }
              } else pDestCol.SetPatternArea(nRow, nRow + nRowEnd, this.GetDefPattern());
            }
            if (!pSrcCol) continue;
            pSrcCol.ForEachCell(aClipRange.aStart.Row(), aClipRange.aStart.Row() + nRowEnd, (nSrcRow, p) => {
              const nDestRow = nSrcRow + nDy;
              const aDestPos = new ScAddress(nCol + c, nDestRow, nTab);
              let pNew: ScCellData | undefined;
              if (p instanceof ScFormulaCell) {
                if (nInsFlag & InsertDeleteFlags.FORMULA) {
                  pNew = p.Clone(aDestPos, this);
                  if (bCut) {
                    // cut and paste: the references are absolute targets (moved block)
                    const aSrcPos = new ScAddress(aClipRange.aStart.Col() + c, nSrcRow, nClipTab);
                    (pNew as ScFormulaCell).pCode.AdjustReferenceOnMovedOrigin(aSrcPos, aDestPos);
                  }
                } else if (nInsFlag & (InsertDeleteFlags.VALUE | InsertDeleteFlags.STRING)) {
                  if (p.IsValue()) pNew = nInsFlag & InsertDeleteFlags.VALUE ? p.GetValue() : undefined;
                  else pNew = nInsFlag & InsertDeleteFlags.STRING ? p.GetString() : undefined;
                }
              } else if (typeof p === 'number') {
                if (nInsFlag & (InsertDeleteFlags.VALUE | InsertDeleteFlags.DATETIME)) pNew = p;
              } else if (nInsFlag & InsertDeleteFlags.STRING) pNew = p instanceof EditTextObject ? p.Clone() : p;
              if (pNew === undefined) return;
              pDestCol.SetCellRaw(nDestRow, pNew);
            });
            if (nInsFlag & InsertDeleteFlags.NOTE) {
              for (const r of pSrcCol.GetNoteRows()) if (r >= aClipRange.aStart.Row() && r <= aClipRange.aStart.Row() + nRowEnd) pDestCol.SetCellNote(r + nDy, { ...pSrcCol.GetCellNote(r)! });
            }
          }
          void nDx;
        }
      }
    }
    // listening and recalculation
    this.ClearListeners();
    this.StartAllListeners();
    for (const nTab of rMark) {
      const pDest = this.FetchTable(nTab);
      if (!pDest) continue;
      for (let c = rDestRange.aStart.Col(); c <= nDestEndCol; c++) pDest.FetchColumn(c)?.ForEachCell(rDestRange.aStart.Row(), nDestEndRow, (_r, p) => { if (p instanceof ScFormulaCell) p.SetDirtyVar(); });
      this.BroadcastRange(nTab, rDestRange.aStart.Col(), rDestRange.aStart.Row(), nDestEndCol, nDestEndRow);
    }
    this.SetModified();
  }

  /**
   * Transpose the content of a clip document into another clip document (TransposeClip): rows
   * become columns; formulas keep their references relative to the transposed positions.
   */
  TransposeClip(pTransClip: ScDocument, nFlags: InsertDeleteFlags, bAsLink = false): void {
    void bAsLink;
    const aClipRange = this.aClipParam.getWholeRange();
    pTransClip.mxStylePool.CopyStylesFrom(this.mxStylePool);
    pTransClip.mpCellAttributeHelper = new CellAttributeHelper(pTransClip.mxStylePool.GetStandardStyle());
    pTransClip.maTabs = [];
    const nCols = aClipRange.aEnd.Col() - aClipRange.aStart.Col() + 1;
    const nRows = aClipRange.aEnd.Row() - aClipRange.aStart.Row() + 1;
    for (let i = 0; i < this.maTabs.length; i++) {
      pTransClip.maTabs.push(null);
      const pSrc = this.maTabs[i];
      if (!pSrc) continue;
      const pDest = new ScTable(pTransClip, i, pSrc.GetName());
      pTransClip.maTabs[i] = pDest;
      for (let c = 0; c < nCols; c++) {
        for (let r = 0; r < nRows; r++) {
          const nSrcCol = aClipRange.aStart.Col() + c, nSrcRow = aClipRange.aStart.Row() + r;
          const nDestCol = aClipRange.aStart.Col() + r, nDestRow = aClipRange.aStart.Row() + c;
          if (nFlags & InsertDeleteFlags.ATTRIB) pDest.CreateColumnIfNotExists(nDestCol).SetPatternArea(nDestRow, nDestRow, pTransClip.ImportPattern(pSrc.GetPattern(nSrcCol, nSrcRow)));
          const p = pSrc.GetCellData(nSrcCol, nSrcRow);
          if (p === undefined) continue;
          let pNew: ScCellData = p;
          if (p instanceof ScFormulaCell) {
            const f = p.Clone(new ScAddress(nDestCol, nDestRow, i), pTransClip);
            // transposed references (UpdateTranspose, reduced): relative offsets swap
            for (const t of f.pCode.GetArray()) {
              const swap = (rr: ScSingleRefData) => {
                const aAbs = rr.toAbs(this.GetSheetLimits(), new ScAddress(nSrcCol, nSrcRow, i));
                if (aClipRange.Contains(aAbs)) {
                  const aNew = new ScAddress(aClipRange.aStart.Col() + aAbs.Row() - aClipRange.aStart.Row(), aClipRange.aStart.Row() + aAbs.Col() - aClipRange.aStart.Col(), aAbs.Tab());
                  rr.SetAddress(this.GetSheetLimits(), aNew, f.aPos);
                } else rr.SetAddress(this.GetSheetLimits(), aAbs, f.aPos);
              };
              if (t.GetType() === 4 /* svSingleRef */) swap(t.GetSingleRef());
              else if (t.GetType() === 5 /* svDoubleRef */) { swap(t.GetDoubleRef().Ref1); swap(t.GetDoubleRef().Ref2); }
            }
            pNew = f;
          } else if (p instanceof EditTextObject) pNew = p.Clone();
          pDest.CreateColumnIfNotExists(nDestCol).SetCellRaw(nDestRow, pNew);
        }
      }
    }
    const aTransRange = new ScRange(aClipRange.aStart.Col(), aClipRange.aStart.Row(), aClipRange.aStart.Tab(), aClipRange.aStart.Col() + nRows - 1, aClipRange.aStart.Row() + nCols - 1, aClipRange.aEnd.Tab());
    pTransClip.aClipParam = new ScClipParam(aTransRange, this.aClipParam.mbCutMode);
  }
}
