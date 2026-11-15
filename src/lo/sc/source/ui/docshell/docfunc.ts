// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/inc/docfunc.hxx partial
// @upstream sc/source/ui/docshell/docfunc.cxx partial
// @upstream sc/source/ui/docshell/docfuncutil.cxx reduced
// @upstream sc/source/ui/view/viewfunc.cxx partial
// ScDocFunc: the document operations the UI and the API call, each recording its undo action
// with the document shell's undo manager: cell input (EnterData, from ScViewFunc::EnterData with
// checkFormula and the formula compilation of applyFormulaToCell), setting cells, deleting
// contents, attributes and cell styles, inserting and deleting cells, rows and columns, column
// widths and row heights, merging, sheets, filling and array formulas.
// Left out: the editable test is reduced to sheet protection (cell protection, matrix
// fragments, sheet views and pivot tables are not checked), change tracking, the drawing layer
// and note captions, detective, validation circles, the formula AutoCorrection and its query
// dialog, the list of recent functions, EnterData's automatic formats (TestFormatArea /
// DoAutoAttributes) and matrix expansion, the input handler notifications, paint extension
// flags (UpdatePaintExt), page breaks, outlines, AutoFilter buttons, scenarios, VBA and LOK.
// InsertCells and DeleteCells keep the unmerging and re-merging of merged areas that the
// operation cuts.
import { EditTextObject } from '../../../../editeng/source/editeng/editobj.ts';
import { FormulaError } from '../../../../include/formula/errorcodes.ts';
import { FormulaGrammar } from '../../../../include/formula/grammar.ts';
import { GetType as NFGetType, IsNumberFormat, GetStandardFormat, SvNumFormatType } from '../../../../svl/source/numbers/zforlist.ts';
import { MAXTAB, ScAddress, ScRange, type SCCOL, type SCCOLROW, type SCROW, type SCTAB } from '../../../inc/address.ts';
import { CELLTYPE_EDIT, ScCellValue, type ScCellData } from '../../../inc/cellvalue.ts';
import { DelCellCmd, FillCmd, FillDateCmd, FillDir, HasAttrFlags, InsCellCmd, InsertDeleteFlags, ScDirection, ScSizeMode } from '../../../inc/global.ts';
import { ScMarkData } from '../../../inc/markdata.ts';
import { ScPatternAttr } from '../../../inc/patattr.ts';
import { ScMF, type ScItemSet } from '../../../inc/scitems.ts';
import { SfxStyleFamily } from '../../../inc/stlsheet.ts';
import { ScSetStringParam, ScStringUtil } from '../../../inc/stringutil.ts';
import { ScDocument, ScDocumentMode } from '../../core/data/document.ts';
import { ScFormulaCell, ScMatrixMode } from '../../core/data/formulacell.ts';
import { MAXDOUBLE } from '../../core/data/table4.ts';
import { ExtendedErrorDetection, ScCompiler } from '../../core/tool/compiler.ts';
import type { ScTokenArray } from '../../core/tool/token.ts';
import { ScRefUndoData } from '../undo/refundo.ts';
import { ScUndoDeleteCells, ScUndoEnterMatrix, ScUndoInsertCells, ScUndoRemoveMerge, ScUndoSelectionStyle } from '../undo/undoblk.ts';
import { ScUndoWidthOrHeight } from '../undo/undoblk2.ts';
import { ScUndoAutoFill, ScUndoDeleteContents, ScUndoMerge, ScUndoSelectionAttr } from '../undo/undoblk3.ts';
import { ScUndoEnterData, ScUndoEnterDataValue, ScUndoSetCell } from '../undo/undocell.ts';
import { ScUndoDeleteTab, ScUndoInsertTab, ScUndoRenameTab } from '../undo/undotab.ts';
import { ScCellMergeOption } from '../view/cellmergeoption.ts';
import { PaintPartFlags, SC_PF_LINES, ScDocShellModificator, type ScDocShell } from './docsh.ts';

/** sc::ColRowSpan (columnspanset.hxx): a span of columns or rows. */
export interface ColRowSpan {
  mnStart: SCCOLROW;
  mnEnd: SCCOLROW;
}

// The message ids of ErrorMessage (globstr.hrc).
const STR_PROTECTIONERR = 'Protected cells can not be modified.';
const STR_MSSG_INSERTCELLS_0 = 'Inserting into merged ranges not possible';
const STR_MSSG_DELETECELLS_0 = 'Deleting in merged ranges not possible';
const STR_MSSG_MERGECELLS_0 = 'Cell merge not possible if cells already merged';
const STR_INSERT_FULL = 'Filled cells cannot be shifted beyond the sheet.';
const STR_TABINSERT_ERROR = 'The table could not be inserted.';
const STR_UNDO_INSERTCELLS = 'Insert';
const STR_UNDO_DELETECELLS = 'Delete';
const STR_UNDO_ENTERDATA = 'Input';

/** ScEditableTester, reduced to sheet protection. */
function lcl_TestEditable(rDoc: ScDocument, rMark: ScMarkData | null, nTab?: SCTAB): boolean {
  if (nTab !== undefined) return !rDoc.IsTabProtected(nTab);
  if (rMark) for (const t of rMark) if (rDoc.IsTabProtected(t)) return false;
  return true;
}

/** The format type and language of a cell's number format. */
function lcl_FormatType(rDoc: ScDocument, nCol: SCCOL, nRow: SCROW, nTab: SCTAB): { eType: SvNumFormatType; aLang: string; aFormat: string } {
  const pPattern = rDoc.GetPattern(nCol, nRow, nTab);
  const aLang = pPattern.GetItem('ATTR_LANGUAGE_FORMAT') || 'en-US';
  const aFormat = pPattern.GetNumberFormat();
  return { eType: NFGetType(aFormat, aLang), aLang, aFormat };
}

/** paint row above the range (because of lines after AdjustRowHeight) */
function lcl_PaintAbove(rDocShell: ScDocShell, rRange: ScRange): void {
  let nRow = rRange.aStart.Row();
  if (nRow > 0) {
    const nTab = rRange.aStart.Tab(); //! all of them?
    --nRow;
    const rDoc = rDocShell.GetDocument();
    rDocShell.PostPaint(new ScRange(0, nRow, nTab, rDoc.MaxCol(), nRow, nTab), PaintPartFlags.Grid);
  }
}

/** sc::DocFuncUtil::hasProtectedTab */
function hasProtectedTab(rDoc: ScDocument, rMark: ScMarkData): boolean {
  const nTabCount = rDoc.GetTableCount();
  for (const rTab of rMark) {
    if (rTab >= nTabCount) break;
    if (rDoc.IsTabProtected(rTab)) return true;
  }
  return false;
}

/** sc::DocFuncUtil::createDeleteContentsUndoDoc */
function createDeleteContentsUndoDoc(rDoc: ScDocument, rMark: ScMarkData, rRange: ScRange, nFlags: InsertDeleteFlags, bOnlyMarked: boolean): ScDocument {
  const pUndoDoc = new ScDocument(ScDocumentMode.SCDOCMODE_UNDO);
  const nTab = rRange.aStart.Tab();
  pUndoDoc.InitUndo(rDoc, nTab, nTab);
  const nTabCount = rDoc.GetTableCount();
  for (const rTab of rMark) if (rTab !== nTab) pUndoDoc.AddUndoTab(rTab, rTab);
  const aCopyRange = rRange.clone();
  aCopyRange.aStart.SetTab(0);
  aCopyRange.aEnd.SetTab(nTabCount - 1);

  //  in case of "Format/Standard" copy all attributes, because CopyToDocument
  //  with InsertDeleteFlags::HARDATTR only is too time-consuming:
  let nUndoDocFlags = nFlags;
  if (nFlags & InsertDeleteFlags.ATTRIB) nUndoDocFlags |= InsertDeleteFlags.ATTRIB;
  if (nFlags & InsertDeleteFlags.EDITATTR) nUndoDocFlags |= InsertDeleteFlags.STRING; // Edit-Engine-Attribute -> cells will be changed
  if (nFlags & InsertDeleteFlags.NOTE) nUndoDocFlags |= InsertDeleteFlags.CONTENTS; // copy all cells with their notes
  // do not copy note captions to undo document
  nUndoDocFlags |= InsertDeleteFlags.NOCAPTIONS;
  rDoc.CopyToDocument(aCopyRange, nUndoDocFlags, bOnlyMarked, pUndoDoc, rMark);

  return pUndoDoc;
}

function DirFromFillDir(eDir: FillDir): ScDirection {
  if (eDir === FillDir.FILL_TO_BOTTOM) return ScDirection.DIR_BOTTOM;
  else if (eDir === FillDir.FILL_TO_RIGHT) return ScDirection.DIR_RIGHT;
  else if (eDir === FillDir.FILL_TO_TOP) return ScDirection.DIR_TOP;
  // if (eDir==FILL_TO_LEFT)
  else return ScDirection.DIR_LEFT;
}

/** Expand the fill range as necessary, to allow copying of adjacent cell(s) even when those
    cells are not in the original range. */
function adjustFillRangeForAdjacentCopy(rDoc: ScDocument, rRange: ScRange, eDir: FillDir): void {
  switch (eDir) {
    case FillDir.FILL_TO_BOTTOM: {
      if (rRange.aStart.Row() === 0) return;
      if (rRange.aStart.Row() !== rRange.aEnd.Row()) return;
      // Include the above row.
      const s = rRange.aStart;
      s.SetRow(s.Row() - 1);
      break;
    }
    case FillDir.FILL_TO_TOP: {
      if (rRange.aStart.Row() === rDoc.MaxRow()) return;
      if (rRange.aStart.Row() !== rRange.aEnd.Row()) return;
      // Include the row below.
      const e = rRange.aEnd;
      e.SetRow(e.Row() + 1);
      break;
    }
    case FillDir.FILL_TO_LEFT: {
      if (rRange.aStart.Col() === rDoc.MaxCol()) return;
      if (rRange.aStart.Col() !== rRange.aEnd.Col()) return;
      // Include the column to the right.
      const e = rRange.aEnd;
      e.SetCol(e.Col() + 1);
      break;
    }
    case FillDir.FILL_TO_RIGHT: {
      if (rRange.aStart.Col() === 0) return;
      if (rRange.aStart.Col() !== rRange.aEnd.Col()) return;
      // Include the column to the left.
      const s = rRange.aStart;
      s.SetCol(s.Col() - 1);
      break;
    }
    default:
  }
}

/** checkFormula (viewfunc.cxx): whether typed input is a formula. */
function checkFormula(rDoc: ScDocument, nCol: SCCOL, nRow: SCROW, nTab: SCTAB, rString: string): boolean {
  // do not check formula if it is a text cell
  const { eType, aLang, aFormat } = lcl_FormatType(rDoc, nCol, nRow, nTab);
  // a single '=' character is handled as string (needed for special filters)
  if (eType !== SvNumFormatType.TEXT && rString.length > 1) {
    if (rString[0] === '=') {
      // handle as formula
      return true;
    } else if (rString[0] === '+' || rString[0] === '-') {
      // if there is more than one leading '+' or '-' character, remove the additional ones
      let nIndex = 1;
      const nLen = rString.length;
      while (nIndex < nLen && (rString[nIndex] === '+' || rString[nIndex] === '-')) ++nIndex;
      const aString = rString.substring(0, 1) + rString.substring(nIndex);

      // if the remaining part without the leading '+' or '-' character
      // is non-empty and not a number, handle as formula
      if (aString.length > 1) {
        if (!IsNumberFormat(aString, aLang, aFormat)) return true;
      }
    }
  }
  return false;
}

/** All selected sheets of a mark, or the given sheet. */
function lcl_MarkForTab(rDoc: ScDocument, nTab: SCTAB): ScMarkData {
  const aMark = new ScMarkData(rDoc.GetSheetLimits());
  aMark.SelectTable(nTab, true);
  return aMark;
}

export class ScDocFunc {
  protected rDocShell: ScDocShell;

  constructor(rDocSh: ScDocShell) {
    this.rDocShell = rDocSh;
  }

  GetDocShell(): ScDocShell { return this.rDocShell; }

  /** Group the undo actions of one user action (EnterListAction). */
  EnterListAction(rComment: string): void {
    this.rDocShell.GetUndoManager().EnterListAction(rComment, rComment, 0);
  }

  EndListAction(): void {
    this.rDocShell.GetUndoManager().LeaveListAction();
  }

  AdjustRowHeight(rRange: ScRange, bPaint = true, bApi = false): boolean {
    const rDoc = this.rDocShell.GetDocument();
    if (rDoc.IsImportingXML()) {
      //  for XML import, all row heights are updated together after importing
      return false;
    }

    const nTab = rRange.aStart.Tab();
    const nStartRow = rRange.aStart.Row();
    const nEndRow = rRange.aEnd.Row();

    const bChanged = rDoc.SetOptimalHeight(nStartRow, nEndRow, nTab, bApi);

    if (bPaint && bChanged) this.rDocShell.PostPaint(new ScRange(0, nStartRow, nTab, rDoc.MaxCol(), rDoc.MaxRow(), nTab), PaintPartFlags.Grid | PaintPartFlags.Left);

    return bChanged;
  }

  // --- deleting contents -----------------------------------------------------------------------

  DeleteContents(rMark: ScMarkData, nFlags: InsertDeleteFlags, bRecord = true, bApi = false): boolean {
    const aModificator = new ScDocShellModificator(this.rDocShell);

    if (!rMark.IsMarked() && !rMark.IsMultiMarked()) return false; // ScDocFunc::DeleteContents without markings

    const rDoc = this.rDocShell.GetDocument();

    if (bRecord && !rDoc.IsUndoEnabled()) bRecord = false;

    if (!lcl_TestEditable(rDoc, rMark)) {
      if (!bApi) this.rDocShell.ErrorMessage(STR_PROTECTIONERR);
      return false;
    }

    const aMultiMark = rMark.clone();
    aMultiMark.SetMarking(false); // for MarkToMulti

    let pUndoDoc: ScDocument | null = null;
    let bMulti = aMultiMark.IsMultiMarked();
    aMultiMark.MarkToMulti();
    const aMarkRange = aMultiMark.GetMultiMarkArea().clone();
    const aExtendedRange = aMarkRange.clone();
    if (rDoc.ExtendMerge(aExtendedRange).bFound) bMulti = false;

    // no objects on protected tabs
    const bObjects = (nFlags & InsertDeleteFlags.OBJECTS) !== 0 && !hasProtectedTab(rDoc, rMark);

    //  order of operations:
    //  1) BeginDrawUndo
    //  2) Delete objects (DrawUndo will be filled)
    //  3) Copy content for undo and set up undo actions
    //  4) Delete content

    const bDrawUndo = bObjects || (nFlags & InsertDeleteFlags.NOTE) !== 0;

    if (bRecord) pUndoDoc = createDeleteContentsUndoDoc(rDoc, aMultiMark, aMarkRange, nFlags, bMulti);

    rDoc.DeleteSelection(nFlags, aMultiMark);

    // add undo action after drawing undo is complete (objects and note captions)
    if (bRecord) {
      // sc::DocFuncUtil::addDeleteContentsUndo
      this.rDocShell.GetUndoManager().AddUndoAction(new ScUndoDeleteContents(this.rDocShell, aMultiMark, aExtendedRange, pUndoDoc!, bMulti, nFlags, bDrawUndo));
    }

    if (!this.AdjustRowHeight(aExtendedRange, true, bApi)) this.rDocShell.PostPaint(aExtendedRange, PaintPartFlags.Grid, SC_PF_LINES);
    else lcl_PaintAbove(this.rDocShell, aExtendedRange); // for lines above the range

    aModificator.SetDocumentModified();

    return true;
  }

  DeleteCell(rPos: ScAddress, rMark: ScMarkData, nFlags: InsertDeleteFlags, bRecord = true, bApi = false): boolean {
    const aModificator = new ScDocShellModificator(this.rDocShell);

    const rDoc = this.rDocShell.GetDocument();

    if (bRecord && !rDoc.IsUndoEnabled()) bRecord = false;

    if (!lcl_TestEditable(rDoc, rMark)) {
      this.rDocShell.ErrorMessage(STR_PROTECTIONERR);
      return false;
    }

    // no objects on protected tabs
    const bObjects = (nFlags & InsertDeleteFlags.OBJECTS) !== 0 && !hasProtectedTab(rDoc, rMark);

    //  order of operations:
    //  1) BeginDrawUndo
    //  2) delete objects (DrawUndo is filled)
    //  3) copy contents for undo
    //  4) delete contents
    //  5) add undo-action

    const bDrawUndo = bObjects || (nFlags & InsertDeleteFlags.NOTE) !== 0; // needed for shown notes

    let pUndoDoc: ScDocument | null = null;
    if (bRecord) pUndoDoc = createDeleteContentsUndoDoc(rDoc, rMark, new ScRange(rPos), nFlags, false);

    rDoc.DeleteArea(rPos.Col(), rPos.Row(), rPos.Col(), rPos.Row(), rMark, nFlags);

    if (bRecord) this.rDocShell.GetUndoManager().AddUndoAction(new ScUndoDeleteContents(this.rDocShell, rMark, new ScRange(rPos), pUndoDoc!, false, nFlags, bDrawUndo));

    if (!this.AdjustRowHeight(new ScRange(rPos), true, bApi)) this.rDocShell.PostPaint(rPos.Col(), rPos.Row(), rPos.Tab(), rPos.Col(), rPos.Row(), rPos.Tab(), PaintPartFlags.Grid);

    aModificator.SetDocumentModified();

    return true;
  }

  // --- cell content ----------------------------------------------------------------------------

  /** Set a string as typed, detecting numbers (SetNormalString); returns whether it succeeded
      and whether the number format was set (o_rbNumFmtSet). */
  SetNormalString(rPos: ScAddress, rText: string, bApi = false): { bSuccess: boolean; o_rbNumFmtSet: boolean } {
    const aModificator = new ScDocShellModificator(this.rDocShell);
    const rDoc = this.rDocShell.GetDocument();

    const bUndo = rDoc.IsUndoEnabled();

    if (!lcl_TestEditable(rDoc, null, rPos.Tab())) {
      if (!bApi) this.rDocShell.ErrorMessage(STR_PROTECTIONERR);
      return { bSuccess: false, o_rbNumFmtSet: false };
    }

    const bEditDeleted = rDoc.GetCellType(rPos) === CELLTYPE_EDIT;
    const aOldValues: ScUndoEnterDataValue[] = [];

    if (bUndo) {
      const aOldValue = new ScUndoEnterDataValue();

      aOldValue.mnTab = rPos.Tab();
      aOldValue.maCell = new ScCellValue(rDoc.GetRefCellValue(rPos));

      const pPattern = rDoc.GetPattern(rPos.Col(), rPos.Row(), rPos.Tab());
      const pItem = pPattern.GetItemSet().ATTR_VALUE_FORMAT;
      if (pItem !== undefined) {
        aOldValue.mbHasFormat = true;
        aOldValue.mnFormat = pItem;
      } else aOldValue.mbHasFormat = false;

      aOldValues.push(aOldValue);
    }

    const o_rbNumFmtSet = rDoc.SetString(rPos.Col(), rPos.Row(), rPos.Tab(), rText);

    if (bUndo) {
      //  because of ChangeTracking, UndoAction can be created only after SetString was called
      this.rDocShell.GetUndoManager().AddUndoAction(new ScUndoEnterData(this.rDocShell, rPos, aOldValues, rText, null));
    }

    if (bEditDeleted || rDoc.HasAttrib(new ScRange(rPos), HasAttrFlags.NeedHeight)) this.AdjustRowHeight(new ScRange(rPos), true, bApi);

    this.rDocShell.PostPaintCell(rPos);
    aModificator.SetDocumentModified();

    return { bSuccess: true, o_rbNumFmtSet };
  }

  SetValueCell(rPos: ScAddress, fVal: number, bInteraction = true): boolean {
    const aModificator = new ScDocShellModificator(this.rDocShell);
    const rDoc = this.rDocShell.GetDocument();
    const bUndo = rDoc.IsUndoEnabled();

    const bHeight = rDoc.HasAttrib(new ScRange(rPos), HasAttrFlags.NeedHeight);

    let aOldVal = new ScCellValue();
    if (bUndo) aOldVal = new ScCellValue(rDoc.GetRefCellValue(rPos));

    rDoc.SetValue(rPos, fVal);

    if (bUndo) {
      const pUndoMgr = this.rDocShell.GetUndoManager();
      const aNewVal = new ScCellValue(rDoc.GetRefCellValue(rPos));
      pUndoMgr.AddUndoAction(new ScUndoSetCell(this.rDocShell, rPos, aOldVal, aNewVal));
    }

    if (bHeight) this.AdjustRowHeight(new ScRange(rPos), true, !bInteraction);

    this.rDocShell.PostPaintCell(rPos);
    aModificator.SetDocumentModified();

    return true;
  }

  SetStringCell(rPos: ScAddress, rStr: string, bInteraction = true): boolean {
    const aModificator = new ScDocShellModificator(this.rDocShell);
    const rDoc = this.rDocShell.GetDocument();
    const bUndo = rDoc.IsUndoEnabled();

    const bHeight = rDoc.HasAttrib(new ScRange(rPos), HasAttrFlags.NeedHeight);

    let aOldVal = new ScCellValue();
    if (bUndo) aOldVal = new ScCellValue(rDoc.GetRefCellValue(rPos));

    const aParam = new ScSetStringParam();
    aParam.setTextInput();
    rDoc.SetString(rPos, rStr, aParam);

    if (bUndo) {
      const pUndoMgr = this.rDocShell.GetUndoManager();
      const aNewVal = new ScCellValue(rDoc.GetRefCellValue(rPos));
      pUndoMgr.AddUndoAction(new ScUndoSetCell(this.rDocShell, rPos, aOldVal, aNewVal));
    }

    if (bHeight) this.AdjustRowHeight(new ScRange(rPos), true, !bInteraction);

    this.rDocShell.PostPaintCell(rPos);
    aModificator.SetDocumentModified();

    return true;
  }

  SetEditCell(rPos: ScAddress, rStr: EditTextObject, bInteraction = true): boolean {
    const aModificator = new ScDocShellModificator(this.rDocShell);
    const rDoc = this.rDocShell.GetDocument();
    const bUndo = rDoc.IsUndoEnabled();

    const bHeight = rDoc.HasAttrib(new ScRange(rPos), HasAttrFlags.NeedHeight);

    let aOldVal = new ScCellValue();
    if (bUndo) aOldVal = new ScCellValue(rDoc.GetRefCellValue(rPos));

    rDoc.SetEditText(rPos, rStr.Clone());

    if (bUndo) {
      const pUndoMgr = this.rDocShell.GetUndoManager();
      const aNewVal = new ScCellValue(rDoc.GetRefCellValue(rPos));
      pUndoMgr.AddUndoAction(new ScUndoSetCell(this.rDocShell, rPos, aOldVal, aNewVal));
    }

    if (bHeight) this.AdjustRowHeight(new ScRange(rPos), true, !bInteraction);

    this.rDocShell.PostPaintCell(rPos);
    aModificator.SetDocumentModified();

    return true;
  }

  SetStringOrEditCell(rPos: ScAddress, rStr: string, bInteraction = true): boolean {
    if (ScStringUtil.isMultiline(rStr)) return this.SetEditCell(rPos, EditTextObject.FromText(rStr), bInteraction);
    else return this.SetStringCell(rPos, rStr, bInteraction);
  }

  /** Takes ownership of pCell. */
  SetFormulaCell(rPos: ScAddress, pCell: ScFormulaCell, bInteraction = true): boolean {
    const aModificator = new ScDocShellModificator(this.rDocShell);
    const rDoc = this.rDocShell.GetDocument();
    const bUndo = rDoc.IsUndoEnabled();

    const bHeight = rDoc.HasAttrib(new ScRange(rPos), HasAttrFlags.NeedHeight);

    let aOldVal = new ScCellValue();
    if (bUndo) aOldVal = new ScCellValue(rDoc.GetRefCellValue(rPos));

    const pSet = rDoc.SetFormulaCell(rPos, pCell);

    // For performance reasons API calls may disable calculation while
    // operating and recalculate once when done. If through user interaction
    // and AutoCalc is disabled, calculate the formula (without its
    // dependencies) once so the result matches the current document's content.
    if (bInteraction && !rDoc.GetAutoCalc() && pSet) {
      // calculate just the cell once and set Dirty again
      pSet.Interpret();
      pSet.SetDirtyVar();
      rDoc.PutInFormulaTree(pSet);
    }

    if (bUndo) {
      const pUndoMgr = this.rDocShell.GetUndoManager();
      const aNewVal = new ScCellValue(rDoc.GetRefCellValue(rPos));
      pUndoMgr.AddUndoAction(new ScUndoSetCell(this.rDocShell, rPos, aOldVal, aNewVal));
    }

    if (bHeight) this.AdjustRowHeight(new ScRange(rPos), true, !bInteraction);

    this.rDocShell.PostPaintCell(rPos);
    aModificator.SetDocumentModified();

    return true;
  }

  /** Put a cell of any kind (the former ScDocFunc::PutCell): dispatches to the Set*Cell
      functions; undefined deletes the content. */
  PutCell(rPos: ScAddress, pCell: ScCellData | undefined, bApi = false): boolean {
    if (pCell === undefined) return this.DeleteCell(rPos, lcl_MarkForTab(this.rDocShell.GetDocument(), rPos.Tab()), InsertDeleteFlags.CONTENTS, true, bApi);
    if (typeof pCell === 'number') return this.SetValueCell(rPos, pCell, !bApi);
    if (typeof pCell === 'string') return this.SetStringCell(rPos, pCell, !bApi);
    if (pCell instanceof EditTextObject) return this.SetEditCell(rPos, pCell, !bApi);
    return this.SetFormulaCell(rPos, pCell, !bApi);
  }

  /**
   * Enter typed input into a cell on the marked sheets (ScViewFunc::EnterData): input starting
   * with '=' is a formula; input starting with '+' or '-' is a formula when the rest (after
   * collapsing more leading signs) is not a number, and is set as text when it does not compile
   * (extended name-break error detection); anything else is SetNormalString (numbers, dates,
   * apostrophe text). Returns false if the cell is protected.
   */
  EnterData(rPos: ScAddress, rString: string, pData: EditTextObject | null = null, pMark: ScMarkData | null = null): boolean {
    const rDoc = this.rDocShell.GetDocument();
    const nCol = rPos.Col();
    const nRow = rPos.Row();
    const nTab = rPos.Tab();
    const aMark = pMark ? pMark.clone() : lcl_MarkForTab(rDoc, nTab);
    const bRecord = rDoc.IsUndoEnabled();
    const aModificator = new ScDocShellModificator(this.rDocShell);

    if (!lcl_TestEditable(rDoc, aMark)) {
      this.rDocShell.ErrorMessage(STR_PROTECTIONERR);
      this.rDocShell.PostPaint(nCol, nRow, nTab, nCol, nRow, nTab, PaintPartFlags.Grid); // possibly the edit-engine is still painted there
      return false;
    }

    if (bRecord) this.EnterListAction(STR_UNDO_ENTERDATA);

    const bFormula = checkFormula(rDoc, nCol, nRow, nTab, rString);

    if (bFormula) {
      // applyFormulaToCell: formula, compile with autoCorrection
      const aPos = new ScAddress(nCol, nRow, nTab);
      const aComp = new ScCompiler(rDoc, aPos, null, rDoc.GetGrammar());
      //2do: enable/disable autoCorrection via calcoptions (AutoCorrection is not ported)
      if (rString[0] === '+' || rString[0] === '-') aComp.SetExtendedErrorDetection(ExtendedErrorDetection.EXTENDED_ERROR_DETECTION_NAME_BREAK);

      const aFormula = rString;
      // parseAndCorrectFormula
      const pArr = aComp.CompileString(aFormula);
      if (pArr.GetCodeError() === FormulaError.NONE) aComp.CompileTokenArray();

      // finalizeFormulaProcessing
      // to be used in multiple tabs, the formula must be compiled anew
      // via ScFormulaCell copy-ctor because of RangeNames,
      // the same code-array for all cells is not possible.
      // If the array has an error, (it) must be RPN-erased in the newly generated
      // cells and the error be set explicitly, so that
      // via FormulaCell copy-ctor and Interpreter it will be, when possible,
      // ironed out again, too intelligent... e.g.: =1))
      const nError = pArr.GetCodeError();

      const aCell = new ScFormulaCell(rDoc, aPos, pArr, FormulaGrammar.GRAM_DEFAULT, ScMatrixMode.NONE);

      for (const i of aMark) {
        aPos.SetTab(i);
        const { eType: nType, aLang } = lcl_FormatType(rDoc, nCol, nRow, i);
        if (nType === SvNumFormatType.TEXT || ((rString[0] === '+' || rString[0] === '-') && nError !== FormulaError.NONE && rString === aFormula)) {
          if (pData) {
            // A clone of pData will be stored in the cell.
            this.SetEditCell(aPos, pData, true);
          } else this.SetStringCell(aPos, aFormula, true);
        } else {
          const pCell = aCell.Clone(aPos.clone());
          if (nError !== FormulaError.NONE) {
            pCell.GetCode().DelRPN();
            pCell.SetErrCode(nError);
          }
          if (nType === SvNumFormatType.LOGICAL) {
            // Reset to General so the actual format can be determined
            // after the cell has been interpreted. A sticky boolean
            // number format is highly likely unwanted... see tdf#75650.
            // General of same locale as current number format.
            const nFormat = GetStandardFormat(SvNumFormatType.NUMBER, aLang);
            const aApplyMark = new ScMarkData(rDoc.GetSheetLimits());
            aApplyMark.SelectTable(i, true);
            aApplyMark.SetMarkArea(new ScRange(aPos));
            this.ApplyAttributes(aApplyMark, { ATTR_VALUE_FORMAT: nFormat }, false);
          }
          this.SetFormulaCell(aPos.clone(), pCell, true);
        }
      }
    } else {
      for (const rTab of aMark) {
        // applyText
        const aAddress = new ScAddress(nCol, nRow, rTab);
        // tdf#104902 - handle embedded newline
        if (ScStringUtil.isMultiline(rString)) {
          // (as upstream, without undo of its own: the edit text is set directly)
          rDoc.SetEditText(aAddress, EditTextObject.FromText(rString));
          this.rDocShell.AdjustRowHeight(nRow, nRow, rTab);
        } else this.SetNormalString(aAddress, rString, false);
      }
    }

    // performAutoFormatAndUpdate
    if (bRecord) this.EndListAction();
    aModificator.SetDocumentModified();
    return true;
  }

  // --- attributes ------------------------------------------------------------------------------

  ApplyAttributes(rMark: ScMarkData, rPattern: ScPatternAttr | ScItemSet, bApi = false): boolean {
    const rDoc = this.rDocShell.GetDocument();
    let bRecord = true;
    if (!rDoc.IsUndoEnabled()) bRecord = false;

    const pPattern = rPattern instanceof ScPatternAttr ? rPattern : new ScPatternAttr(null, rPattern);

    const bImportingXML = rDoc.IsImportingXML();
    // Cell formats can still be set if the range isn't editable only because of matrix formulas.
    // #i62483# When loading XML, the check can be skipped altogether.
    if (!bImportingXML && !lcl_TestEditable(rDoc, rMark)) {
      if (!bApi) this.rDocShell.ErrorMessage(STR_PROTECTIONERR);
      return false;
    }

    const aModificator = new ScDocShellModificator(this.rDocShell);

    //! Border

    const bMulti = rMark.IsMultiMarked();
    const aMultiRange = (bMulti ? rMark.GetMultiMarkArea() : rMark.GetMarkArea()).clone();

    if (bRecord) {
      const pUndoDoc = new ScDocument(ScDocumentMode.SCDOCMODE_UNDO);
      pUndoDoc.InitUndo(rDoc, aMultiRange.aStart.Tab(), aMultiRange.aEnd.Tab());
      rDoc.CopyToDocument(aMultiRange, InsertDeleteFlags.ATTRIB, bMulti, pUndoDoc, rMark);

      this.rDocShell.GetUndoManager().AddUndoAction(new ScUndoSelectionAttr(this.rDocShell, rMark, aMultiRange.aStart.Col(), aMultiRange.aStart.Row(), aMultiRange.aStart.Tab(), aMultiRange.aEnd.Col(), aMultiRange.aEnd.Row(), aMultiRange.aEnd.Tab(), pUndoDoc, bMulti, pPattern));
    }

    rDoc.ApplySelectionPattern(pPattern.GetItemSet(), rMark);

    if (!this.AdjustRowHeight(aMultiRange, true, bApi)) this.rDocShell.PostPaint(aMultiRange, PaintPartFlags.Grid, SC_PF_LINES);
    else lcl_PaintAbove(this.rDocShell, aMultiRange); // because of lines above the range

    aModificator.SetDocumentModified();

    return true;
  }

  ApplyStyle(rMark: ScMarkData, rStyleName: string, bApi = false): boolean {
    const rDoc = this.rDocShell.GetDocument();
    let bRecord = true;
    if (!rDoc.IsUndoEnabled()) bRecord = false;

    const bImportingXML = rDoc.IsImportingXML();
    if (!bImportingXML && !lcl_TestEditable(rDoc, rMark)) {
      if (!bApi) this.rDocShell.ErrorMessage(STR_PROTECTIONERR);
      return false;
    }

    const pStyleSheet = rDoc.GetStyleSheetPool().Find(rStyleName, SfxStyleFamily.Para);
    if (!pStyleSheet) return false;

    const aModificator = new ScDocShellModificator(this.rDocShell);

    const bMulti = rMark.IsMultiMarked();
    const aMultiRange = (bMulti ? rMark.GetMultiMarkArea() : rMark.GetMarkArea()).clone();

    if (bRecord) {
      const pUndoDoc = new ScDocument(ScDocumentMode.SCDOCMODE_UNDO);
      const nStartTab = aMultiRange.aStart.Tab();
      const nTabCount = rDoc.GetTableCount();
      pUndoDoc.InitUndo(rDoc, nStartTab, nStartTab);
      for (const rTab of rMark) {
        if (rTab >= nTabCount) break;

        if (rTab !== nStartTab) pUndoDoc.AddUndoTab(rTab, rTab);
      }

      const aCopyRange = aMultiRange.clone();
      aCopyRange.aStart.SetTab(0);
      aCopyRange.aEnd.SetTab(nTabCount - 1);
      rDoc.CopyToDocument(aCopyRange, InsertDeleteFlags.ATTRIB, bMulti, pUndoDoc, rMark);

      this.rDocShell.GetUndoManager().AddUndoAction(new ScUndoSelectionStyle(this.rDocShell, rMark, aMultiRange, rStyleName, pUndoDoc));
    }

    rDoc.ApplySelectionStyle(pStyleSheet, rMark);

    if (!this.AdjustRowHeight(aMultiRange, true, bApi)) this.rDocShell.PostPaint(aMultiRange, PaintPartFlags.Grid);

    aModificator.SetDocumentModified();

    return true;
  }

  // --- inserting and deleting cells ------------------------------------------------------------

  /** The merged areas of a block (the ScDocAttrIterator loop of InsertCells/DeleteCells) that
      reach out of rExtendRange, extended to their whole merged area. */
  private lcl_CollectCutMerges(rDoc: ScDocument, nTab: SCTAB, nCol1: SCCOL, nRow1: SCROW, nCol2: SCCOL, nRow2: SCROW): { aRanges: ScRange[]; bFound: boolean } {
    const aExtendRange = new ScRange(nCol1, nRow1, nTab, nCol2, nRow2, nTab);
    const aRanges: ScRange[] = [];
    let bFound = false;
    const pTab = rDoc.FetchTable(nTab);
    if (!pTab) return { aRanges, bFound };
    const aSeen = new Set<string>();
    for (let nTestCol = nCol1; nTestCol <= Math.min(nCol2, pTab.GetAllocatedColumnsCount() - 1); nTestCol++) {
      for (const e of pTab.FetchColumn(nTestCol)!.pAttrArray.CopyArea(nRow1, nRow2)) {
        const nTestRow1 = nRow1 + e.nStart;
        const nTestRow2 = nRow1 + e.nEnd;
        const pPattern = e.pPattern;
        const nNewFlags = pPattern.GetItem('ATTR_MERGE_FLAG') & (ScMF.Hor | ScMF.Ver);
        if (pPattern.IsMerged() || nNewFlags === ScMF.Hor || nNewFlags === ScMF.Ver || nNewFlags === (ScMF.Hor | ScMF.Ver)) {
          bFound = true;
          for (let nTestRow = nTestRow1; nTestRow <= nTestRow2; nTestRow++) {
            const aTestRange = new ScRange(nTestCol, nTestRow, nTab);
            rDoc.ExtendOverlapped(aTestRange);
            rDoc.ExtendMerge(aTestRange);
            const aMergeRange = new ScRange(aTestRange.aStart.Col(), aTestRange.aStart.Row(), nTab);
            const k = `${aTestRange.aStart.Col()},${aTestRange.aStart.Row()}`;
            if (!aExtendRange.Contains(aMergeRange) && !aSeen.has(k)) {
              aSeen.add(k);
              aRanges.push(aTestRange);
            }
          }
        }
      }
    }
    return { aRanges, bFound };
  }

  /** The marked sheets, or the sheet of the range's end (InsertCells/DeleteCells without a mark). */
  private lcl_TabMark(rDoc: ScDocument, pTabMark: ScMarkData | null | undefined, nEndTab: SCTAB): ScMarkData {
    if (pTabMark) return pTabMark.clone();
    const aMark = new ScMarkData(rDoc.GetSheetLimits());
    if (nEndTab < rDoc.GetTableCount()) aMark.SelectTable(nEndTab, true);
    return aMark;
  }

  InsertCells(rRange: ScRange, pTabMark: ScMarkData | null, eCmd: InsCellCmd, bRecord = true, bApi = false, bPartOfPaste = false, nInsertCount = 0): boolean {
    const aModificator = new ScDocShellModificator(this.rDocShell);
    const rDoc = this.rDocShell.GetDocument();

    const aTargetRange = rRange.clone();

    // If insertion is for full cols/rows and after the current
    // selection, then shift the range accordingly
    if (eCmd === InsCellCmd.INS_INSROWS_AFTER) {
      if (!aTargetRange.Move(0, rRange.aEnd.Row() - rRange.aStart.Row() + 1, 0, ScRange.Invalid(), rDoc)) return false;
    }
    if (eCmd === InsCellCmd.INS_INSCOLS_AFTER) {
      if (!aTargetRange.Move(rRange.aEnd.Col() - rRange.aStart.Col() + 1, 0, 0, ScRange.Invalid(), rDoc)) return false;
    }

    let nStartCol = aTargetRange.aStart.Col();
    let nStartRow = aTargetRange.aStart.Row();
    const nStartTab = aTargetRange.aStart.Tab();
    let nEndCol = aTargetRange.aEnd.Col() + nInsertCount;
    let nEndRow = aTargetRange.aEnd.Row() + nInsertCount;
    const nEndTab = aTargetRange.aEnd.Tab();

    if (!rDoc.ValidRow(nStartRow) || !rDoc.ValidRow(nEndRow)) return false; // invalid row in InsertCells

    const nTabCount = rDoc.GetTableCount();
    let nPaintStartCol = nStartCol;
    let nPaintStartRow = nStartRow;
    let nPaintEndCol = nEndCol;
    let nPaintEndRow = nEndRow;
    let nPaintFlags: number = PaintPartFlags.Grid;
    let bSuccess: boolean;

    if (bRecord && !rDoc.IsUndoEnabled()) bRecord = false;

    const aMark = this.lcl_TabMark(rDoc, pTabMark, nEndTab);
    const aFullMark = aMark.clone(); // including scenario sheets (no scenarios here)

    const nSelCount = aMark.GetSelectCount();

    // Adjust also related scenarios

    let nMergeTestStartCol = nStartCol;
    let nMergeTestStartRow = nStartRow;
    let nMergeTestEndCol = nEndCol;
    let nMergeTestEndRow = nEndRow;

    const aExtendMergeRange = aTargetRange.clone();

    if (aTargetRange.aStart.equals(aTargetRange.aEnd) && rDoc.HasAttrib(aTargetRange, HasAttrFlags.Merged)) {
      rDoc.ExtendMerge(aExtendMergeRange);
      rDoc.ExtendOverlapped(aExtendMergeRange);
      nMergeTestEndCol = aExtendMergeRange.aEnd.Col();
      nMergeTestEndRow = aExtendMergeRange.aEnd.Row();
      nPaintEndCol = nMergeTestEndCol;
      nPaintEndRow = nMergeTestEndRow;
    }

    if (eCmd === InsCellCmd.INS_INSROWS_BEFORE || eCmd === InsCellCmd.INS_INSROWS_AFTER) {
      nMergeTestStartCol = 0;
      nMergeTestEndCol = rDoc.MaxCol();
    }
    if (eCmd === InsCellCmd.INS_INSCOLS_BEFORE || eCmd === InsCellCmd.INS_INSCOLS_AFTER) {
      nMergeTestStartRow = 0;
      nMergeTestEndRow = rDoc.MaxRow();
    }
    if (eCmd === InsCellCmd.INS_CELLSDOWN) nMergeTestEndRow = rDoc.MaxRow();
    if (eCmd === InsCellCmd.INS_CELLSRIGHT) nMergeTestEndCol = rDoc.MaxCol();

    if (!lcl_TestEditable(rDoc, aMark)) {
      if (!bApi) this.rDocShell.ErrorMessage(STR_PROTECTIONERR);
      return false;
    }

    let pRefUndoDoc: ScDocument | null = null;
    let pUndoData: ScRefUndoData | null = null;
    if (bRecord) {
      pRefUndoDoc = new ScDocument(ScDocumentMode.SCDOCMODE_UNDO);
      pRefUndoDoc.InitUndo(rDoc, 0, nTabCount - 1);

      // pRefUndoDoc is filled in InsertCol / InsertRow

      pUndoData = new ScRefUndoData(rDoc);
    }

    // #i8302 : we unmerge overwhelming ranges, before insertion all the actions are put in the same ListAction
    // the patch comes from mloiseleur and maoyg
    let bInsertMerge = false;
    const qIncreaseRange: ScRange[] = [];
    const aUndo = STR_UNDO_INSERTCELLS;
    if (bRecord) this.rDocShell.GetUndoManager().EnterListAction(aUndo, aUndo, 0);
    let pUndoRemoveMerge: ScUndoRemoveMerge | null = null;

    for (const i of aMark) {
      if (i >= nTabCount) break;

      if (rDoc.HasAttrib(nMergeTestStartCol, nMergeTestStartRow, i, nMergeTestEndCol, nMergeTestEndRow, i, HasAttrFlags.Merged | HasAttrFlags.Overlapped)) {
        const aMergeRange = new ScRange(nMergeTestStartCol, nMergeTestStartRow, i, nMergeTestEndCol, nMergeTestEndRow, i);
        rDoc.ExtendMerge(aMergeRange);
        rDoc.ExtendOverlapped(aMergeRange);

        if ((eCmd === InsCellCmd.INS_CELLSDOWN && (aMergeRange.aStart.Col() !== nMergeTestStartCol || aMergeRange.aEnd.Col() !== nMergeTestEndCol)) || (eCmd === InsCellCmd.INS_CELLSRIGHT && (aMergeRange.aStart.Row() !== nMergeTestStartRow || aMergeRange.aEnd.Row() !== nMergeTestEndRow))) {
          if (!bApi) this.rDocShell.ErrorMessage(STR_MSSG_INSERTCELLS_0);
          this.rDocShell.GetUndoManager().LeaveListAction();
          return false;
        }

        const r = this.lcl_CollectCutMerges(rDoc, i, nMergeTestStartCol, nMergeTestStartRow, nMergeTestEndCol, nMergeTestEndRow);
        qIncreaseRange.push(...r.aRanges);
        if (r.bFound) bInsertMerge = true;

        if (bInsertMerge) {
          if (eCmd === InsCellCmd.INS_INSROWS_BEFORE || eCmd === InsCellCmd.INS_INSROWS_AFTER || eCmd === InsCellCmd.INS_CELLSDOWN) {
            nStartRow = aExtendMergeRange.aStart.Row();
            nEndRow = aExtendMergeRange.aEnd.Row();

            if (eCmd === InsCellCmd.INS_CELLSDOWN) nEndCol = nMergeTestEndCol;
            else {
              nStartCol = 0;
              nEndCol = rDoc.MaxCol();
            }
          } else if (eCmd === InsCellCmd.INS_CELLSRIGHT || eCmd === InsCellCmd.INS_INSCOLS_BEFORE || eCmd === InsCellCmd.INS_INSCOLS_AFTER) {
            nStartCol = aExtendMergeRange.aStart.Col();
            nEndCol = aExtendMergeRange.aEnd.Col();
            if (eCmd === InsCellCmd.INS_CELLSRIGHT) {
              nEndRow = nMergeTestEndRow;
            } else {
              nStartRow = 0;
              nEndRow = rDoc.MaxRow();
            }
          }

          if (qIncreaseRange.length) {
            if (bRecord && !pUndoRemoveMerge) {
              const pUndoDoc = new ScDocument(ScDocumentMode.SCDOCMODE_UNDO);
              pUndoDoc.InitUndo(rDoc, aMark.GetFirstSelected(), aMark.GetLastSelected());
              pUndoRemoveMerge = new ScUndoRemoveMerge(this.rDocShell, rRange, pUndoDoc);
            }

            for (const aRange of qIncreaseRange) {
              if (rDoc.HasAttrib(aRange, HasAttrFlags.Overlapped | HasAttrFlags.Merged)) this.UnmergeCells(aRange, bRecord, pUndoRemoveMerge);
            }
          }
        } else {
          if (!bApi) this.rDocShell.ErrorMessage(STR_MSSG_INSERTCELLS_0);
          this.rDocShell.GetUndoManager().LeaveListAction();
          return false;
        }
      }
    }

    if (bRecord && pUndoRemoveMerge) this.rDocShell.GetUndoManager().AddUndoAction(pUndoRemoveMerge);

    switch (eCmd) {
      case InsCellCmd.INS_CELLSDOWN:
        bSuccess = rDoc.InsertRow(nStartCol, 0, nEndCol, MAXTAB, nStartRow, nEndRow - nStartRow + 1, pRefUndoDoc, aFullMark);
        nPaintEndRow = rDoc.MaxRow();
        break;
      case InsCellCmd.INS_INSROWS_BEFORE:
      case InsCellCmd.INS_INSROWS_AFTER:
        bSuccess = rDoc.InsertRow(0, 0, rDoc.MaxCol(), MAXTAB, nStartRow, nEndRow - nStartRow + 1, pRefUndoDoc, aFullMark);
        nPaintStartCol = 0;
        nPaintEndCol = rDoc.MaxCol();
        nPaintEndRow = rDoc.MaxRow();
        nPaintFlags |= PaintPartFlags.Left;
        break;
      case InsCellCmd.INS_CELLSRIGHT:
        bSuccess = rDoc.InsertCol(nStartRow, 0, nEndRow, MAXTAB, nStartCol, nEndCol - nStartCol + 1, pRefUndoDoc, aFullMark);
        nPaintEndCol = rDoc.MaxCol();
        break;
      case InsCellCmd.INS_INSCOLS_BEFORE:
      case InsCellCmd.INS_INSCOLS_AFTER:
        bSuccess = rDoc.InsertCol(0, 0, rDoc.MaxRow(), MAXTAB, nStartCol, nEndCol - nStartCol + 1, pRefUndoDoc, aFullMark);
        nPaintStartRow = 0;
        nPaintEndRow = rDoc.MaxRow();
        nPaintEndCol = rDoc.MaxCol();
        nPaintFlags |= PaintPartFlags.Top;
        break;
      default:
        // Wrong code at inserting
        bSuccess = false;
        break;
    }

    if (bSuccess) {
      if (bRecord) {
        const pTabs: SCTAB[] = [];
        const pScenarios: SCTAB[] = [];
        for (const rTab of aMark) {
          if (rTab >= nTabCount) break;
          pScenarios.push(0);
          pTabs.push(rTab);
        }

        if (!bInsertMerge) this.rDocShell.GetUndoManager().LeaveListAction();

        this.rDocShell.GetUndoManager().AddUndoAction(new ScUndoInsertCells(this.rDocShell, new ScRange(nStartCol, nStartRow, nStartTab, nEndCol, nEndRow, nEndTab), pTabs.length, pTabs, pScenarios, eCmd, pRefUndoDoc, pUndoData, bPartOfPaste));
      }

      // #i8302 : we remerge growing ranges, with the new part inserted

      while (qIncreaseRange.length) {
        const aRange = qIncreaseRange[qIncreaseRange.length - 1]!.clone();
        if (!rDoc.HasAttrib(aRange, HasAttrFlags.Overlapped | HasAttrFlags.Merged)) {
          switch (eCmd) {
            case InsCellCmd.INS_CELLSDOWN:
            case InsCellCmd.INS_INSROWS_BEFORE:
            case InsCellCmd.INS_INSROWS_AFTER:
              aRange.aEnd.IncRow(nEndRow - nStartRow + 1);
              break;
            case InsCellCmd.INS_CELLSRIGHT:
            case InsCellCmd.INS_INSCOLS_BEFORE:
            case InsCellCmd.INS_INSCOLS_AFTER:
              aRange.aEnd.IncCol(nEndCol - nStartCol + 1);
              break;
            default:
          }
          const aMergeOption = new ScCellMergeOption(aRange.aStart.Col(), aRange.aStart.Row(), aRange.aEnd.Col(), aRange.aEnd.Row());
          aMergeOption.maTabs.add(aRange.aStart.Tab());
          this.MergeCells(aMergeOption, false, true, true);
        }
        qIncreaseRange.pop();
      }

      if (bInsertMerge) this.rDocShell.GetUndoManager().LeaveListAction();

      for (const i of aMark) {
        if (i >= nTabCount) break;

        const bAdjusted = eCmd === InsCellCmd.INS_INSROWS_BEFORE || eCmd === InsCellCmd.INS_INSROWS_AFTER
          ? this.AdjustRowHeight(new ScRange(0, nStartRow, i, rDoc.MaxCol(), nEndRow, i), true, bApi)
          : this.AdjustRowHeight(new ScRange(0, nPaintStartRow, i, rDoc.MaxCol(), nPaintEndRow, i), true, bApi);
        if (bAdjusted) {
          //  paint only what is not done by AdjustRowHeight
          if (nPaintFlags & PaintPartFlags.Top) this.rDocShell.PostPaint(nPaintStartCol, nPaintStartRow, i, nPaintEndCol, nPaintEndRow, i, PaintPartFlags.Top);
        } else this.rDocShell.PostPaint(nPaintStartCol, nPaintStartRow, i, nPaintEndCol, nPaintEndRow, i, nPaintFlags);
      }
    } else {
      if (bInsertMerge) {
        while (qIncreaseRange.length) {
          const aRange = qIncreaseRange[qIncreaseRange.length - 1]!;
          const aMergeOption = new ScCellMergeOption(aRange.aStart.Col(), aRange.aStart.Row(), aRange.aEnd.Col(), aRange.aEnd.Row());
          aMergeOption.maTabs.add(aRange.aStart.Tab());
          this.MergeCells(aMergeOption, false, true, true);
          qIncreaseRange.pop();
        }
      }

      if (bRecord) {
        this.rDocShell.GetUndoManager().LeaveListAction();
        this.rDocShell.GetUndoManager().RemoveLastUndoAction();
      }

      if (!bApi) this.rDocShell.ErrorMessage(STR_INSERT_FULL); // column/row full
    }

    void nSelCount;
    aModificator.SetDocumentModified();

    return bSuccess;
  }

  DeleteCells(rRange: ScRange, pTabMark: ScMarkData | null, eCmd: DelCellCmd, bApi = false): boolean {
    const aModificator = new ScDocShellModificator(this.rDocShell);
    const rDoc = this.rDocShell.GetDocument();

    let nStartCol = rRange.aStart.Col();
    let nStartRow = rRange.aStart.Row();
    const nStartTab = rRange.aStart.Tab();
    let nEndCol = rRange.aEnd.Col();
    let nEndRow = rRange.aEnd.Row();
    const nEndTab = rRange.aEnd.Tab();

    if (!rDoc.ValidRow(nStartRow) || !rDoc.ValidRow(nEndRow)) return false; // invalid row in DeleteCells

    const nTabCount = rDoc.GetTableCount();
    let nPaintStartCol = nStartCol;
    let nPaintStartRow = nStartRow;
    let nPaintEndCol = nEndCol;
    let nPaintEndRow = nEndRow;
    let nPaintFlags: number = PaintPartFlags.Grid;

    let bRecord = true;
    if (!rDoc.IsUndoEnabled()) bRecord = false;

    const aMark = this.lcl_TabMark(rDoc, pTabMark, nEndTab);
    const aFullMark = aMark.clone(); // including scenario sheets

    let nUndoStartCol = nStartCol;
    let nUndoStartRow = nStartRow;
    let nUndoEndCol = nEndCol;
    let nUndoEndRow = nEndRow;

    const aExtendMergeRange = rRange.clone();

    if (rRange.aStart.equals(rRange.aEnd) && rDoc.HasAttrib(rRange, HasAttrFlags.Merged)) {
      rDoc.ExtendMerge(aExtendMergeRange);
      rDoc.ExtendOverlapped(aExtendMergeRange);
      nUndoEndCol = aExtendMergeRange.aEnd.Col();
      nUndoEndRow = aExtendMergeRange.aEnd.Row();
      nPaintEndCol = nUndoEndCol;
      nPaintEndRow = nUndoEndRow;
    }

    if (eCmd === DelCellCmd.Rows) {
      nUndoStartCol = 0;
      nUndoEndCol = rDoc.MaxCol();
    }
    if (eCmd === DelCellCmd.Cols) {
      nUndoStartRow = 0;
      nUndoEndRow = rDoc.MaxRow();
    }
    // Test for cell protection

    if (!lcl_TestEditable(rDoc, aMark)) {
      if (!bApi) this.rDocShell.ErrorMessage(STR_PROTECTIONERR);
      return false;
    }
    // Test for merged cells

    let nMergeTestEndCol = eCmd === DelCellCmd.CellsLeft ? rDoc.MaxCol() : nUndoEndCol;
    let nMergeTestEndRow = eCmd === DelCellCmd.CellsUp ? rDoc.MaxRow() : nUndoEndRow;
    let nExtendStartCol = nUndoStartCol;
    let nExtendStartRow = nUndoStartRow;
    let bNeedRefresh = false;

    //Issue 8302 want to be able to insert into the middle of merged cells
    //the patch comes from maoyg
    const qDecreaseRange: ScRange[] = [];
    let bDeletingMerge = false;
    const aUndo = STR_UNDO_DELETECELLS;
    if (bRecord) this.rDocShell.GetUndoManager().EnterListAction(aUndo, aUndo, 0);
    let pUndoRemoveMerge: ScUndoRemoveMerge | null = null;

    for (const i of aMark) {
      if (i >= nTabCount) break;

      if (rDoc.HasAttrib(nUndoStartCol, nUndoStartRow, i, nMergeTestEndCol, nMergeTestEndRow, i, HasAttrFlags.Merged | HasAttrFlags.Overlapped)) {
        const aMergeRange = new ScRange(nUndoStartCol, nUndoStartRow, i, nMergeTestEndCol, nMergeTestEndRow, i);
        rDoc.ExtendMerge(aMergeRange);
        rDoc.ExtendOverlapped(aMergeRange);
        if ((eCmd === DelCellCmd.CellsUp && (aMergeRange.aStart.Col() !== nUndoStartCol || aMergeRange.aEnd.Col() !== nMergeTestEndCol)) || (eCmd === DelCellCmd.CellsLeft && (aMergeRange.aStart.Row() !== nUndoStartRow || aMergeRange.aEnd.Row() !== nMergeTestEndRow))) {
          if (!bApi) this.rDocShell.ErrorMessage(STR_MSSG_DELETECELLS_0);
          this.rDocShell.GetUndoManager().LeaveListAction();
          return false;
        }

        nExtendStartCol = aMergeRange.aStart.Col();
        nExtendStartRow = aMergeRange.aStart.Row();

        const r = this.lcl_CollectCutMerges(rDoc, i, nUndoStartCol, nUndoStartRow, nMergeTestEndCol, nMergeTestEndRow);
        qDecreaseRange.push(...r.aRanges);
        if (r.bFound) bDeletingMerge = true;

        if (bDeletingMerge) {
          if (eCmd === DelCellCmd.Rows || eCmd === DelCellCmd.CellsUp) {
            nStartRow = aExtendMergeRange.aStart.Row();
            nEndRow = aExtendMergeRange.aEnd.Row();
            bNeedRefresh = true;

            if (eCmd === DelCellCmd.CellsUp) {
              nEndCol = aExtendMergeRange.aEnd.Col();
            } else {
              nStartCol = 0;
              nEndCol = rDoc.MaxCol();
            }
          } else if (eCmd === DelCellCmd.CellsLeft || eCmd === DelCellCmd.Cols) {
            nStartCol = aExtendMergeRange.aStart.Col();
            nEndCol = aExtendMergeRange.aEnd.Col();
            if (eCmd === DelCellCmd.CellsLeft) {
              nEndRow = aExtendMergeRange.aEnd.Row();
              bNeedRefresh = true;
            } else {
              nStartRow = 0;
              nEndRow = rDoc.MaxRow();
            }
          }

          if (qDecreaseRange.length) {
            if (bRecord && !pUndoRemoveMerge) {
              const pUndoDoc = new ScDocument(ScDocumentMode.SCDOCMODE_UNDO);
              pUndoDoc.InitUndo(rDoc, aMark.GetFirstSelected(), aMark.GetLastSelected());
              pUndoRemoveMerge = new ScUndoRemoveMerge(this.rDocShell, rRange, pUndoDoc);
            }

            for (const aRange of qDecreaseRange) {
              if (rDoc.HasAttrib(aRange, HasAttrFlags.Overlapped | HasAttrFlags.Merged)) this.UnmergeCells(aRange, bRecord, pUndoRemoveMerge);
            }
          }
        } else {
          if (!bApi) this.rDocShell.ErrorMessage(STR_MSSG_DELETECELLS_0);
          this.rDocShell.GetUndoManager().LeaveListAction();
          return false;
        }
      }
    }

    if (bRecord && pUndoRemoveMerge) this.rDocShell.GetUndoManager().AddUndoAction(pUndoRemoveMerge);

    //     do it

    let pUndoDoc: ScDocument | null = null;
    let pRefUndoDoc: ScDocument | null = null;
    let pUndoData: ScRefUndoData | null = null;
    if (bRecord) {
      // With the fix for #101329#, UpdateRef always puts cells into pRefUndoDoc at their old position,
      // so it's no longer necessary to copy more than the deleted range into pUndoDoc.

      pUndoDoc = new ScDocument(ScDocumentMode.SCDOCMODE_UNDO);
      pUndoDoc.InitUndo(rDoc, 0, nTabCount - 1, eCmd === DelCellCmd.Cols, eCmd === DelCellCmd.Rows);
      for (const rTab of aMark) {
        if (rTab >= nTabCount) break;

        rDoc.CopyToDocument(new ScRange(nUndoStartCol, nUndoStartRow, rTab, nUndoEndCol, nUndoEndRow, rTab), InsertDeleteFlags.ALL | InsertDeleteFlags.NOCAPTIONS, false, pUndoDoc);
      }

      pRefUndoDoc = new ScDocument(ScDocumentMode.SCDOCMODE_UNDO);
      pRefUndoDoc.InitUndo(rDoc, 0, nTabCount - 1);

      pUndoData = new ScRefUndoData(rDoc);
    }

    switch (eCmd) {
      case DelCellCmd.CellsUp:
        rDoc.DeleteRow(nStartCol, 0, nEndCol, MAXTAB, nStartRow, nEndRow - nStartRow + 1, pRefUndoDoc, aFullMark);
        nPaintEndRow = rDoc.MaxRow();
        break;
      case DelCellCmd.Rows:
        rDoc.DeleteRow(0, 0, rDoc.MaxCol(), MAXTAB, nStartRow, nEndRow - nStartRow + 1, pRefUndoDoc, aFullMark);
        nPaintStartCol = 0;
        nPaintEndCol = rDoc.MaxCol();
        nPaintEndRow = rDoc.MaxRow();
        nPaintFlags |= PaintPartFlags.Left;
        break;
      case DelCellCmd.CellsLeft:
        rDoc.DeleteCol(nStartRow, 0, nEndRow, MAXTAB, nStartCol, nEndCol - nStartCol + 1, pRefUndoDoc, aFullMark);
        nPaintEndCol = rDoc.MaxCol();
        break;
      case DelCellCmd.Cols:
        rDoc.DeleteCol(0, 0, rDoc.MaxRow(), MAXTAB, nStartCol, nEndCol - nStartCol + 1, pRefUndoDoc, aFullMark);
        nPaintStartRow = 0;
        nPaintEndRow = rDoc.MaxRow();
        nPaintEndCol = rDoc.MaxCol();
        nPaintFlags |= PaintPartFlags.Top;
        break;
      default:
      // Wrong code at deleting
    }

    //! Test if the size of outline has changed

    if (bRecord) {
      for (const rTab of aFullMark) {
        if (rTab >= nTabCount) break;

        pRefUndoDoc!.DeleteAreaTab(nUndoStartCol, nUndoStartRow, nUndoEndCol, nUndoEndRow, rTab, InsertDeleteFlags.ALL);
      }

      //  for all sheets, so that formulas can be copied
      pUndoDoc!.AddUndoTab(0, nTabCount - 1);

      //  copy with bColRowFlags=false (#54194#)
      pRefUndoDoc!.CopyToDocument(new ScRange(0, 0, 0, rDoc.MaxCol(), rDoc.MaxRow(), MAXTAB), InsertDeleteFlags.FORMULA, false, pUndoDoc!, null, false);
      pRefUndoDoc = null;

      const pTabs: SCTAB[] = [];
      const pScenarios: SCTAB[] = [];
      for (const rTab of aMark) {
        if (rTab >= nTabCount) break;
        pScenarios.push(0);
        pTabs.push(rTab);
      }

      if (!bDeletingMerge) this.rDocShell.GetUndoManager().LeaveListAction();

      this.rDocShell.GetUndoManager().AddUndoAction(new ScUndoDeleteCells(this.rDocShell, new ScRange(nStartCol, nStartRow, nStartTab, nEndCol, nEndRow, nEndTab), pTabs.length, pTabs, pScenarios, eCmd, pUndoDoc, pUndoData));
    }

    // #i8302 want to be able to insert into the middle of merged cells
    // the patch comes from maoyg

    while (qDecreaseRange.length) {
      const aRange = qDecreaseRange[qDecreaseRange.length - 1]!.clone();

      let nDecreaseRowCount = 0;
      let nDecreaseColCount = 0;
      if (eCmd === DelCellCmd.CellsUp || eCmd === DelCellCmd.Rows) {
        if (nStartRow >= aRange.aStart.Row() && nStartRow <= aRange.aEnd.Row() && nEndRow >= aRange.aStart.Row() && nEndRow <= aRange.aEnd.Row()) nDecreaseRowCount = nEndRow - nStartRow + 1;
        else if (nStartRow >= aRange.aStart.Row() && nStartRow <= aRange.aEnd.Row() && nEndRow >= aRange.aStart.Row() && nEndRow >= aRange.aEnd.Row()) nDecreaseRowCount = aRange.aEnd.Row() - nStartRow + 1;
        else if (nStartRow >= aRange.aStart.Row() && nStartRow >= aRange.aEnd.Row() && nEndRow >= aRange.aStart.Row() && nEndRow <= aRange.aEnd.Row()) nDecreaseRowCount = aRange.aEnd.Row() - nEndRow + 1;
      } else if (eCmd === DelCellCmd.CellsLeft || eCmd === DelCellCmd.Cols) {
        if (nStartCol >= aRange.aStart.Col() && nStartCol <= aRange.aEnd.Col() && nEndCol >= aRange.aStart.Col() && nEndCol <= aRange.aEnd.Col()) nDecreaseColCount = nEndCol - nStartCol + 1;
        else if (nStartCol >= aRange.aStart.Col() && nStartCol <= aRange.aEnd.Col() && nEndCol >= aRange.aStart.Col() && nEndCol >= aRange.aEnd.Col()) nDecreaseColCount = aRange.aEnd.Col() - nStartCol + 1;
        else if (nStartCol >= aRange.aStart.Col() && nStartCol >= aRange.aEnd.Col() && nEndCol >= aRange.aStart.Col() && nEndCol <= aRange.aEnd.Col()) nDecreaseColCount = aRange.aEnd.Col() - nEndCol + 1;
      }

      switch (eCmd) {
        case DelCellCmd.CellsUp:
        case DelCellCmd.Rows:
          aRange.aEnd.SetRow(aRange.aEnd.Row() - nDecreaseRowCount);
          break;
        case DelCellCmd.CellsLeft:
        case DelCellCmd.Cols:
          aRange.aEnd.SetCol(aRange.aEnd.Col() - nDecreaseColCount);
          break;
        default:
      }

      if (!rDoc.HasAttrib(aRange, HasAttrFlags.Overlapped | HasAttrFlags.Merged)) {
        const aMergeOption = new ScCellMergeOption(aRange);
        this.MergeCells(aMergeOption, false, true, true);
      }
      qDecreaseRange.pop();
    }

    if (bDeletingMerge) this.rDocShell.GetUndoManager().LeaveListAction();

    if (eCmd === DelCellCmd.Cols || eCmd === DelCellCmd.CellsLeft) nMergeTestEndCol = rDoc.MaxCol();
    if (eCmd === DelCellCmd.Rows || eCmd === DelCellCmd.CellsUp) nMergeTestEndRow = rDoc.MaxRow();
    if (bNeedRefresh) {
      // #i51445# old merge flag attributes must be deleted also for single cells,
      // not only for whole columns/rows
      for (const rTab of aMark) {
        if (rTab >= nTabCount) break;
        rDoc.RemoveFlagsTab(nExtendStartCol, nExtendStartRow, nMergeTestEndCol, nMergeTestEndRow, rTab, ScMF.Hor | ScMF.Ver);
        rDoc.ExtendMerge(nExtendStartCol, nExtendStartRow, nMergeTestEndCol, nMergeTestEndRow, rTab);
        // restore the overlap flags of the merged cells that remain
        const pTab = rDoc.FetchTable(rTab)!;
        for (let nCol = nExtendStartCol; nCol <= Math.min(nMergeTestEndCol, pTab.GetAllocatedColumnsCount() - 1); nCol++)
          for (const e of pTab.FetchColumn(nCol)!.pAttrArray.CopyArea(nExtendStartRow, nMergeTestEndRow))
            if (e.pPattern.IsMerged()) {
              const m = e.pPattern.GetItem('ATTR_MERGE');
              for (let nRow = nExtendStartRow + e.nStart; nRow <= nExtendStartRow + e.nEnd; nRow++) rDoc.DoMerge(nCol, nRow, nCol + m.nColMerge - 1, nRow + m.nRowMerge - 1, rTab);
            }
      }
    }

    for (const rTab of aMark) {
      if (rTab >= nTabCount) break;

      //  delete entire rows: do not adjust
      if (eCmd === DelCellCmd.Rows || !this.AdjustRowHeight(new ScRange(0, nPaintStartRow, rTab, rDoc.MaxCol(), nPaintEndRow, rTab), true, bApi))
        this.rDocShell.PostPaint(nPaintStartCol, nPaintStartRow, rTab, nPaintEndCol, nPaintEndRow, rTab, nPaintFlags);
      else {
        //  paint only what is not done by AdjustRowHeight
        lcl_PaintAbove(this.rDocShell, new ScRange(nPaintStartCol, nPaintStartRow, rTab, nPaintEndCol, nPaintEndRow, rTab));
        if (nPaintFlags & PaintPartFlags.Top) this.rDocShell.PostPaint(nPaintStartCol, nPaintStartRow, rTab, nPaintEndCol, nPaintEndRow, rTab, PaintPartFlags.Top);
      }
    }

    aModificator.SetDocumentModified();

    return true;
  }

  // --- sheets ----------------------------------------------------------------------------------

  InsertTable(nTab: SCTAB, rName: string, bRecord = true, bApi = false): boolean {
    let bSuccess = false;

    const aModificator = new ScDocShellModificator(this.rDocShell);

    const rDoc = this.rDocShell.GetDocument();

    if (bRecord && !rDoc.IsUndoEnabled()) bRecord = false;

    const nTabCount = rDoc.GetTableCount();
    const bAppend = nTab >= nTabCount;
    if (bAppend) nTab = nTabCount; // important for Undo

    if (rDoc.InsertTab(nTab, rName)) {
      if (bRecord) this.rDocShell.GetUndoManager().AddUndoAction(new ScUndoInsertTab(this.rDocShell, nTab, bAppend, rName));
      //  Update views:
      this.rDocShell.PostPaintExtras();
      aModificator.SetDocumentModified();
      bSuccess = true;
    } else if (!bApi) this.rDocShell.ErrorMessage(STR_TABINSERT_ERROR);

    return bSuccess;
  }

  DeleteTable(nTab: SCTAB, bRecord = true): boolean {
    const aModificator = new ScDocShellModificator(this.rDocShell);

    let bSuccess = false;
    const rDoc = this.rDocShell.GetDocument();
    if (bRecord && !rDoc.IsUndoEnabled()) bRecord = false;
    let pUndoDoc: ScDocument | null = null;
    let pUndoData: ScRefUndoData | null = null;
    if (bRecord) {
      pUndoDoc = new ScDocument(ScDocumentMode.SCDOCMODE_UNDO);
      const nCount = rDoc.GetTableCount();

      pUndoDoc.InitUndo(rDoc, nTab, nTab, true, true); // only nTab with Flags
      pUndoDoc.AddUndoTab(0, nCount - 1); // all sheets for references

      rDoc.CopyToDocument(new ScRange(0, 0, nTab, rDoc.MaxCol(), rDoc.MaxRow(), nTab), InsertDeleteFlags.ALL, false, pUndoDoc);
      const aOldName = rDoc.GetName(nTab) ?? '';
      pUndoDoc.RenameTab(nTab, aOldName);
      // The formulas of the other sheets, whose references to the deleted sheet become #REF!:
      // ScMoveUndo::UndoRef restores them (upstream InsertTab clears the deleted-sheet flags).
      for (let i = 0; i < nCount; i++) if (i !== nTab) rDoc.CopyToDocument(new ScRange(0, 0, i, rDoc.MaxCol(), rDoc.MaxRow(), i), InsertDeleteFlags.FORMULA, false, pUndoDoc, null, false);

      pUndoDoc.SetVisible(nTab, rDoc.IsVisible(nTab));
      pUndoDoc.SetTabBgColor(nTab, rDoc.GetTabBgColor(nTab));
      pUndoDoc.SetLayoutRTL(nTab, rDoc.IsLayoutRTL(nTab));
      pUndoDoc.SetTabProtection(nTab, rDoc.IsTabProtected(nTab));

      pUndoData = new ScRefUndoData(rDoc);
    }

    if (rDoc.DeleteTab(nTab)) {
      if (bRecord) this.rDocShell.GetUndoManager().AddUndoAction(new ScUndoDeleteTab(this.rDocShell, [nTab], pUndoDoc!, pUndoData));
      //  Update views:
      this.rDocShell.PostPaintExtras();
      aModificator.SetDocumentModified();

      bSuccess = true;
    }
    return bSuccess;
  }

  RenameTable(nTab: SCTAB, rName: string, bRecord = true, bApi = false): boolean {
    const rDoc = this.rDocShell.GetDocument();
    if (bRecord && !rDoc.IsUndoEnabled()) bRecord = false;
    void bApi;

    const aModificator = new ScDocShellModificator(this.rDocShell);

    let bSuccess = false;
    const sOldName = rDoc.GetName(nTab) ?? '';
    if (rDoc.RenameTab(nTab, rName)) {
      if (bRecord) this.rDocShell.GetUndoManager().AddUndoAction(new ScUndoRenameTab(this.rDocShell, nTab, sOldName, rName));
      this.rDocShell.PostPaintExtras();
      aModificator.SetDocumentModified();

      bSuccess = true;
    }
    return bSuccess;
  }

  // --- column widths and row heights -----------------------------------------------------------

  SetWidthOrHeight(bWidth: boolean, rRanges: readonly ColRowSpan[], nTab: SCTAB, eMode: ScSizeMode, nSizeTwips: number, bRecord = true, bApi = false): boolean {
    const aModificator = new ScDocShellModificator(this.rDocShell);

    if (!rRanges.length) return true;

    const rDoc = this.rDocShell.GetDocument();
    if (bRecord && !rDoc.IsUndoEnabled()) bRecord = false;

    // import into read-only document is possible
    if (!this.rDocShell.IsEditable()) {
      if (!bApi) this.rDocShell.ErrorMessage(STR_PROTECTIONERR); //! separate error message?
      return false;
    }

    const nStart = rRanges[0]!.mnStart;
    const nEnd = rRanges[0]!.mnEnd;

    let pUndoDoc: ScDocument | null = null;
    let aUndoRanges: ColRowSpan[] = [];

    if (bRecord) {
      pUndoDoc = new ScDocument(ScDocumentMode.SCDOCMODE_UNDO);
      if (bWidth) {
        pUndoDoc.InitUndo(rDoc, nTab, nTab, true);
        rDoc.CopyToDocument(new ScRange(nStart, 0, nTab, nEnd, rDoc.MaxRow(), nTab), InsertDeleteFlags.NONE, false, pUndoDoc);
      } else {
        pUndoDoc.InitUndo(rDoc, nTab, nTab, false, true);
        rDoc.CopyToDocument(new ScRange(0, nStart, nTab, rDoc.MaxCol(), nEnd, nTab), InsertDeleteFlags.NONE, false, pUndoDoc);
      }

      aUndoRanges = rRanges.map((r) => ({ ...r }));
    }

    const bShow = nSizeTwips > 0 || eMode !== ScSizeMode.SC_SIZE_DIRECT;

    for (const rRange of rRanges) {
      const nStartNo = rRange.mnStart;
      const nEndNo = rRange.mnEnd;

      if (!bWidth) {
        // deal with heights always in blocks
        if (eMode === ScSizeMode.SC_SIZE_OPTIMAL || eMode === ScSizeMode.SC_SIZE_VISOPT) {
          const bAll = eMode === ScSizeMode.SC_SIZE_OPTIMAL;
          //  delete for all that have CRFlags::ManualSize enabled
          //  (bAll: SetOptimalHeight forces the automatic size)
          for (let nRow = nStartNo; nRow <= nEndNo; nRow++) {
            const bHidden = rDoc.RowHidden(nRow, nTab);
            if ((bAll || !bHidden) && rDoc.IsManualRowHeight(nRow, nTab)) rDoc.SetManualHeight(nRow, nRow, nTab, false);
          }

          rDoc.SetOptimalHeight(nStartNo, nEndNo, nTab, bApi);

          if (bAll) rDoc.ShowRows(nStartNo, nEndNo, nTab, true);

          //  Manual flag will be set already in SetOptimalHeight if bAll=true
          //  (it is on when Extra-Height, otherwise off).
        } else if (eMode === ScSizeMode.SC_SIZE_DIRECT || eMode === ScSizeMode.SC_SIZE_ORIGINAL) {
          if (nSizeTwips) {
            rDoc.SetRowHeightRange(nStartNo, nEndNo, nTab, nSizeTwips);
            rDoc.SetManualHeight(nStartNo, nEndNo, nTab, true); // height was set manually
          }
          if (eMode !== ScSizeMode.SC_SIZE_ORIGINAL) rDoc.ShowRows(nStartNo, nEndNo, nTab, nSizeTwips !== 0);
        } else if (eMode === ScSizeMode.SC_SIZE_SHOW) {
          rDoc.ShowRows(nStartNo, nEndNo, nTab, true);
        }
      } else {
        // Column widths
        for (let nCol = nStartNo; nCol <= nEndNo; nCol++) {
          if (eMode !== ScSizeMode.SC_SIZE_VISOPT || !rDoc.ColHidden(nCol, nTab)) {
            let nThisSize = nSizeTwips;

            if (eMode === ScSizeMode.SC_SIZE_OPTIMAL || eMode === ScSizeMode.SC_SIZE_VISOPT) nThisSize = nSizeTwips + rDoc.GetOptimalColWidth(nCol, nTab, false);
            if (nThisSize) rDoc.SetColWidth(nCol, nTab, nThisSize);

            if (eMode !== ScSizeMode.SC_SIZE_ORIGINAL) rDoc.ShowCol(nCol, nTab, bShow);
          }
        }
      }
    }

    if (bRecord) {
      const aMark = new ScMarkData(rDoc.GetSheetLimits());
      aMark.SelectOneTable(nTab);
      this.rDocShell.GetUndoManager().AddUndoAction(new ScUndoWidthOrHeight(this.rDocShell, aMark, nStart, nTab, nEnd, nTab, pUndoDoc!, aUndoRanges, eMode, nSizeTwips, bWidth));
    }

    this.rDocShell.PostPaint(0, 0, nTab, rDoc.MaxCol(), rDoc.MaxRow(), nTab, PaintPartFlags.All);
    aModificator.SetDocumentModified();

    return false;
  }

  // --- array formulas --------------------------------------------------------------------------

  EnterMatrix(rRange: ScRange, pTabMark: ScMarkData | null, pTokenArray: ScTokenArray | null, rString: string, bApi = false, bEnglish = false, rFormulaNmsp = '', eGrammar: FormulaGrammar.Grammar = FormulaGrammar.GRAM_DEFAULT): boolean {
    void rFormulaNmsp;
    const aModificator = new ScDocShellModificator(this.rDocShell);

    let bSuccess = false;
    const rDoc = this.rDocShell.GetDocument();
    const nStartCol = rRange.aStart.Col();
    const nStartRow = rRange.aStart.Row();
    const nStartTab = rRange.aStart.Tab();
    const nEndCol = rRange.aEnd.Col();
    const nEndRow = rRange.aEnd.Row();
    const nEndTab = rRange.aEnd.Tab();

    let aMark: ScMarkData;
    if (pTabMark) aMark = pTabMark.clone();
    else {
      aMark = new ScMarkData(rDoc.GetSheetLimits());
      for (let nTab = nStartTab; nTab <= nEndTab; nTab++) aMark.SelectTable(nTab, true);
    }

    if (lcl_TestEditable(rDoc, aMark)) {
      let pUndoDoc: ScDocument | null = null;

      const bUndo = rDoc.IsUndoEnabled();
      if (bUndo) {
        //! take selected sheets into account also when undoing
        pUndoDoc = new ScDocument(ScDocumentMode.SCDOCMODE_UNDO);
        pUndoDoc.InitUndo(rDoc, nStartTab, nEndTab);
        rDoc.CopyToDocument(rRange, InsertDeleteFlags.ALL & ~InsertDeleteFlags.NOTE, false, pUndoDoc);
      }

      // use TokenArray if given, string (and flags) otherwise
      if (pTokenArray) rDoc.InsertMatrixFormula(nStartCol, nStartRow, nEndCol, nEndRow, aMark, '', pTokenArray, eGrammar);
      else if (bEnglish) {
        const aComp = new ScCompiler(rDoc, rRange.aStart, null, eGrammar);
        const pCode = aComp.CompileString(rString);
        rDoc.InsertMatrixFormula(nStartCol, nStartRow, nEndCol, nEndRow, aMark, '', pCode, eGrammar);
      } else rDoc.InsertMatrixFormula(nStartCol, nStartRow, nEndCol, nEndRow, aMark, rString, null, eGrammar);

      if (bUndo) {
        //! take selected sheets into account also when undoing
        this.rDocShell.GetUndoManager().AddUndoAction(new ScUndoEnterMatrix(this.rDocShell, rRange, pUndoDoc!, rString));
      }

      //  Err522 painting of DDE-Formulas will be intercepted during interpreting
      this.rDocShell.PostPaint(nStartCol, nStartRow, nStartTab, nEndCol, nEndRow, nEndTab, PaintPartFlags.Grid);
      aModificator.SetDocumentModified();

      bSuccess = true;
    } else if (!bApi) this.rDocShell.ErrorMessage(STR_PROTECTIONERR);

    return bSuccess;
  }

  // --- filling ---------------------------------------------------------------------------------

  /** The undo document of a fill: the destination block on the marked sheets. */
  private lcl_FillUndoDoc(rDoc: ScDocument, aDestArea: ScRange, aMark: ScMarkData): ScDocument {
    const nTabCount = rDoc.GetTableCount();
    const nDestStartTab = aDestArea.aStart.Tab();

    const pUndoDoc = new ScDocument(ScDocumentMode.SCDOCMODE_UNDO);
    pUndoDoc.InitUndo(rDoc, nDestStartTab, nDestStartTab);
    for (const rTab of aMark) {
      if (rTab >= nTabCount) break;

      if (rTab !== nDestStartTab) pUndoDoc.AddUndoTab(rTab, rTab);
    }

    // do not clone note captions in undo document
    rDoc.CopyToDocument(new ScRange(aDestArea.aStart.Col(), aDestArea.aStart.Row(), 0, aDestArea.aEnd.Col(), aDestArea.aEnd.Row(), nTabCount - 1), InsertDeleteFlags.AUTOFILL, false, pUndoDoc, aMark);
    return pUndoDoc;
  }

  /** Fill Down/Right/Up/Left: copy the first row/column of the range over the rest. */
  FillSimple(rRange: ScRange, pTabMark: ScMarkData | null, eDir: FillDir, bApi = false): boolean {
    const aModificator = new ScDocShellModificator(this.rDocShell);
    const rDoc = this.rDocShell.GetDocument();

    let bSuccess = false;
    const aRange = rRange.clone();
    adjustFillRangeForAdjacentCopy(rDoc, aRange, eDir);

    const nStartTab = aRange.aStart.Tab();
    const nEndTab = aRange.aEnd.Tab();

    let bRecord = true;
    if (!rDoc.IsUndoEnabled()) bRecord = false;

    let aMark: ScMarkData;
    if (pTabMark) aMark = pTabMark.clone();
    else {
      aMark = new ScMarkData(rDoc.GetSheetLimits());
      for (let nTab = nStartTab; nTab <= nEndTab; nTab++) aMark.SelectTable(nTab, true);
    }

    if (lcl_TestEditable(rDoc, aMark)) {
      const aSourceArea = aRange.clone();
      const aDestArea = aRange.clone();

      let nCount = 0;
      switch (eDir) {
        case FillDir.FILL_TO_BOTTOM:
          nCount = aSourceArea.aEnd.Row() - aSourceArea.aStart.Row();
          aSourceArea.aEnd.SetRow(aSourceArea.aStart.Row());
          break;
        case FillDir.FILL_TO_RIGHT:
          nCount = aSourceArea.aEnd.Col() - aSourceArea.aStart.Col();
          aSourceArea.aEnd.SetCol(aSourceArea.aStart.Col());
          break;
        case FillDir.FILL_TO_TOP:
          nCount = aSourceArea.aEnd.Row() - aSourceArea.aStart.Row();
          aSourceArea.aStart.SetRow(aSourceArea.aEnd.Row());
          break;
        case FillDir.FILL_TO_LEFT:
          nCount = aSourceArea.aEnd.Col() - aSourceArea.aStart.Col();
          aSourceArea.aStart.SetCol(aSourceArea.aEnd.Col());
          break;
      }

      let pUndoDoc: ScDocument | null = null;
      if (bRecord) {
        const nTabCount = rDoc.GetTableCount();
        const nDestStartTab = aDestArea.aStart.Tab();

        pUndoDoc = new ScDocument(ScDocumentMode.SCDOCMODE_UNDO);
        pUndoDoc.InitUndo(rDoc, nDestStartTab, nDestStartTab);
        for (const rTab of aMark) {
          if (rTab >= nTabCount) break;

          if (rTab !== nDestStartTab) pUndoDoc.AddUndoTab(rTab, rTab);
        }

        const aCopyRange = aDestArea.clone();
        aCopyRange.aStart.SetTab(0);
        aCopyRange.aEnd.SetTab(nTabCount - 1);
        rDoc.CopyToDocument(aCopyRange, InsertDeleteFlags.AUTOFILL, false, pUndoDoc, aMark);
      }

      rDoc.Fill(aSourceArea.aStart.Col(), aSourceArea.aStart.Row(), aSourceArea.aEnd.Col(), aSourceArea.aEnd.Row(), aMark, nCount, eDir, FillCmd.FILL_SIMPLE);
      this.AdjustRowHeight(aRange, true, bApi);

      if (bRecord) {
        // only now is Draw-Undo available
        this.rDocShell.GetUndoManager().AddUndoAction(new ScUndoAutoFill(this.rDocShell, aDestArea, aSourceArea, pUndoDoc!, aMark, eDir, FillCmd.FILL_SIMPLE, FillDateCmd.FILL_DAY, MAXDOUBLE, 1.0, 1e307));
      }

      this.rDocShell.PostPaintGridAll();
      aModificator.SetDocumentModified();

      bSuccess = true;
    } else if (!bApi) this.rDocShell.ErrorMessage(STR_PROTECTIONERR);

    return bSuccess;
  }

  /** Sheet - Fill Cells - Fill Series: a series from the first filled cells over the range. */
  FillSeries(rRange: ScRange, pTabMark: ScMarkData | null, eDir: FillDir, eCmd: FillCmd, eDateCmd: FillDateCmd, fStart: number, fStep: number, fMax: number, bApi = false): boolean {
    const aModificator = new ScDocShellModificator(this.rDocShell);

    let bSuccess = false;
    const rDoc = this.rDocShell.GetDocument();
    const nStartTab = rRange.aStart.Tab();
    const nEndTab = rRange.aEnd.Tab();

    let bRecord = true;
    if (!rDoc.IsUndoEnabled()) bRecord = false;

    let aMark: ScMarkData;
    if (pTabMark) aMark = pTabMark.clone();
    else {
      aMark = new ScMarkData(rDoc.GetSheetLimits());
      for (let nTab = nStartTab; nTab <= nEndTab; nTab++) aMark.SelectTable(nTab, true);
    }

    if (lcl_TestEditable(rDoc, aMark)) {
      const aSourceArea = rRange.clone();
      const aDestArea = rRange.clone();

      let nCount = rDoc.GetEmptyLinesInBlock(aSourceArea.aStart.Col(), aSourceArea.aStart.Row(), aSourceArea.aStart.Tab(), aSourceArea.aEnd.Col(), aSourceArea.aEnd.Row(), aSourceArea.aEnd.Tab(), DirFromFillDir(eDir));

      //  keep at least one row/column as source range
      const nTotLines = eDir === FillDir.FILL_TO_BOTTOM || eDir === FillDir.FILL_TO_TOP ? aSourceArea.aEnd.Row() - aSourceArea.aStart.Row() + 1 : aSourceArea.aEnd.Col() - aSourceArea.aStart.Col() + 1;
      if (nCount >= nTotLines) nCount = nTotLines - 1;

      switch (eDir) {
        case FillDir.FILL_TO_BOTTOM:
          aSourceArea.aEnd.SetRow(aSourceArea.aEnd.Row() - nCount);
          break;
        case FillDir.FILL_TO_RIGHT:
          aSourceArea.aEnd.SetCol(aSourceArea.aEnd.Col() - nCount);
          break;
        case FillDir.FILL_TO_TOP:
          aSourceArea.aStart.SetRow(aSourceArea.aStart.Row() + nCount);
          break;
        case FillDir.FILL_TO_LEFT:
          aSourceArea.aStart.SetCol(aSourceArea.aStart.Col() + nCount);
          break;
      }

      let pUndoDoc: ScDocument | null = null;
      if (bRecord) pUndoDoc = this.lcl_FillUndoDoc(rDoc, aDestArea, aMark);

      if (aDestArea.aStart.Col() <= aDestArea.aEnd.Col() && aDestArea.aStart.Row() <= aDestArea.aEnd.Row()) {
        if (fStart !== MAXDOUBLE) {
          const nValX = eDir === FillDir.FILL_TO_LEFT ? aDestArea.aEnd.Col() : aDestArea.aStart.Col();
          const nValY = eDir === FillDir.FILL_TO_TOP ? aDestArea.aEnd.Row() : aDestArea.aStart.Row();
          const nTab = aDestArea.aStart.Tab();
          rDoc.SetValue(nValX, nValY, nTab, fStart);
        }

        rDoc.Fill(aSourceArea.aStart.Col(), aSourceArea.aStart.Row(), aSourceArea.aEnd.Col(), aSourceArea.aEnd.Row(), aMark, nCount, eDir, eCmd, eDateCmd, fStep, fMax);
        this.AdjustRowHeight(rRange, true, bApi);

        this.rDocShell.PostPaintGridAll();
        aModificator.SetDocumentModified();
      }

      if (bRecord) {
        // only now is Draw-Undo available
        this.rDocShell.GetUndoManager().AddUndoAction(new ScUndoAutoFill(this.rDocShell, aDestArea, aSourceArea, pUndoDoc!, aMark, eDir, eCmd, eDateCmd, fStart, fStep, fMax));
      }

      bSuccess = true;
    } else if (!bApi) this.rDocShell.ErrorMessage(STR_PROTECTIONERR);

    return bSuccess;
  }

  /**
   * AutoFill (the fill handle): fill nCount rows/columns beyond rRange in direction eDir from
   * rRange as the source. rRange is set to the destination range (for marking).
   */
  FillAuto(rRange: ScRange, pTabMark: ScMarkData | null, eDir: FillDir, eCmd: FillCmd | number, eDateCmd?: FillDateCmd, nCount?: number, fStep = 1.0, fMax = MAXDOUBLE, bRecord = true, bApi = false): boolean {
    if (nCount === undefined) {
      // FillAuto(rRange, pTabMark, eDir, nCount, bApi)
      bApi = (eDateCmd as unknown as boolean | undefined) ?? false;
      nCount = eCmd;
      eCmd = FillCmd.FILL_AUTO;
      eDateCmd = FillDateCmd.FILL_DAY;
      fStep = 1.0;
      fMax = MAXDOUBLE;
      bRecord = true;
    }
    const aModificator = new ScDocShellModificator(this.rDocShell);

    const rDoc = this.rDocShell.GetDocument();
    const nStartTab = rRange.aStart.Tab();
    const nEndTab = rRange.aEnd.Tab();

    if (bRecord && !rDoc.IsUndoEnabled()) bRecord = false;

    let aMark: ScMarkData;
    if (pTabMark) aMark = pTabMark.clone();
    else {
      aMark = new ScMarkData(rDoc.GetSheetLimits());
      for (let nTab = nStartTab; nTab <= nEndTab; nTab++) aMark.SelectTable(nTab, true);
    }

    const aSourceArea = rRange.clone();
    const aDestArea = rRange.clone();

    switch (eDir) {
      case FillDir.FILL_TO_BOTTOM:
        aDestArea.aEnd.SetRow(aSourceArea.aEnd.Row() + nCount);
        break;
      case FillDir.FILL_TO_TOP:
        if (nCount > aSourceArea.aStart.Row()) nCount = aSourceArea.aStart.Row(); // FillAuto: Row < 0
        aDestArea.aStart.SetRow(aSourceArea.aStart.Row() - nCount);
        break;
      case FillDir.FILL_TO_RIGHT:
        aDestArea.aEnd.SetCol(aSourceArea.aEnd.Col() + nCount);
        break;
      case FillDir.FILL_TO_LEFT:
        if (nCount > aSourceArea.aStart.Col()) nCount = aSourceArea.aStart.Col(); // FillAuto: Col < 0
        aDestArea.aStart.SetCol(aSourceArea.aStart.Col() - nCount);
        break;
      default:
      // Wrong direction with FillAuto
    }

    //      Test for cell protection
    //!     Source range can be protected !!!
    //!     but can't contain matrix fragments !!!

    if (!lcl_TestEditable(rDoc, aMark)) {
      if (!bApi) this.rDocShell.ErrorMessage(STR_PROTECTIONERR);
      return false;
    }

    let pUndoDoc: ScDocument | null = null;
    if (bRecord) pUndoDoc = this.lcl_FillUndoDoc(rDoc, aDestArea, aMark);

    rDoc.Fill(aSourceArea.aStart.Col(), aSourceArea.aStart.Row(), aSourceArea.aEnd.Col(), aSourceArea.aEnd.Row(), aMark, nCount, eDir, eCmd as FillCmd, eDateCmd ?? FillDateCmd.FILL_DAY, fStep, fMax);

    this.AdjustRowHeight(aDestArea, true, bApi);

    if (bRecord) {
      // only now is Draw-Undo available
      this.rDocShell.GetUndoManager().AddUndoAction(new ScUndoAutoFill(this.rDocShell, aDestArea, aSourceArea, pUndoDoc!, aMark, eDir, eCmd as FillCmd, eDateCmd ?? FillDateCmd.FILL_DAY, MAXDOUBLE, fStep, fMax));
    }

    this.rDocShell.PostPaintGridAll();
    aModificator.SetDocumentModified();

    rRange.assign(aDestArea); // return destination range (for marking)
    return true;
  }

  // --- merging ---------------------------------------------------------------------------------

  MergeCells(rOption: ScCellMergeOption, bContents: boolean, bRecord = true, bApi = false, bEmptyMergedCells = false): boolean {
    const aModificator = new ScDocShellModificator(this.rDocShell);

    const nStartCol = rOption.mnStartCol;
    const nStartRow = rOption.mnStartRow;
    const nEndCol = rOption.mnEndCol;
    const nEndRow = rOption.mnEndRow;
    if ((nStartCol === nEndCol && nStartRow === nEndRow) || !rOption.maTabs.size) {
      // Nothing to do.  Bail out quickly
      return true;
    }

    const rDoc = this.rDocShell.GetDocument();
    const aTabs = rOption.tabs();
    const nTab1 = aTabs[0]!;
    const nTab2 = aTabs[aTabs.length - 1]!;

    if (bRecord && !rDoc.IsUndoEnabled()) bRecord = false;

    for (const rTab of aTabs) {
      if (!lcl_TestEditable(rDoc, null, rTab)) {
        if (!bApi) this.rDocShell.ErrorMessage(STR_PROTECTIONERR);
        return false;
      }

      if (rDoc.HasAttrib(nStartCol, nStartRow, rTab, nEndCol, nEndRow, rTab, HasAttrFlags.Merged | HasAttrFlags.Overlapped)) {
        // "Merge of already merged cells not possible"
        if (!bApi) this.rDocShell.ErrorMessage(STR_MSSG_MERGECELLS_0);
        return false;
      }
    }

    let pUndoDoc: ScDocument | null = null;
    let bNeedContentsUndo = false;
    for (const nTab of aTabs) {
      const bIsBlockEmpty = nStartRow === nEndRow
        ? rDoc.IsEmptyData(nStartCol + 1, nStartRow, nEndCol, nEndRow, nTab)
        : rDoc.IsEmptyData(nStartCol, nStartRow + 1, nStartCol, nEndRow, nTab) && rDoc.IsEmptyData(nStartCol + 1, nStartRow, nEndCol, nEndRow, nTab);
      const bNeedContents = bContents && !bIsBlockEmpty;
      const bNeedEmpty = bEmptyMergedCells && !bIsBlockEmpty && !bNeedContents; // if DoMergeContents then cells are emptied

      if (bRecord) {
        if (!pUndoDoc) {
          pUndoDoc = new ScDocument(ScDocumentMode.SCDOCMODE_UNDO);
          pUndoDoc.InitUndo(rDoc, nTab1, nTab2);
        }
        // note captions are collected by drawing undo
        rDoc.CopyToDocument(new ScRange(nStartCol, nStartRow, nTab, nEndCol, nEndRow, nTab), InsertDeleteFlags.ALL | InsertDeleteFlags.NOCAPTIONS, false, pUndoDoc);
      }

      if (bNeedContents) rDoc.DoMergeContents(nStartCol, nStartRow, nEndCol, nEndRow, nTab);
      else if (bNeedEmpty) rDoc.DoEmptyBlock(nStartCol, nStartRow, nEndCol, nEndRow, nTab);
      rDoc.DoMerge(nStartCol, nStartRow, nEndCol, nEndRow, nTab);
      // Remove all covered notes (DoMerge upstream)
      if (nStartCol < nEndCol) rDoc.DeleteAreaTab(nStartCol + 1, nStartRow, nEndCol, nStartRow, nTab, InsertDeleteFlags.NOTE);
      if (nStartRow < nEndRow) rDoc.DeleteAreaTab(nStartCol, nStartRow + 1, nEndCol, nEndRow, nTab, InsertDeleteFlags.NOTE);

      if (rOption.mbCenter) rDoc.ApplyAttr(nStartCol, nStartRow, nTab, { ATTR_HOR_JUSTIFY: 'Center', ATTR_VER_JUSTIFY: 'Center' });

      if (!this.AdjustRowHeight(new ScRange(0, nStartRow, nTab, rDoc.MaxCol(), nEndRow, nTab), true, bApi)) this.rDocShell.PostPaint(nStartCol, nStartRow, nTab, nEndCol, nEndRow, nTab, PaintPartFlags.Grid);
      if (bNeedContents || rOption.mbCenter) {
        const aRange = new ScRange(nStartCol, nStartRow, nTab, nEndCol, nEndRow, nTab);
        rDoc.SetDirty(aRange, true);
      }

      bNeedContentsUndo = bNeedContentsUndo || bNeedContents;
    }

    if (pUndoDoc) this.rDocShell.GetUndoManager().AddUndoAction(new ScUndoMerge(this.rDocShell, rOption, bNeedContentsUndo, pUndoDoc));

    aModificator.SetDocumentModified();

    return true;
  }

  /** UnmergeCells(rRange | rOption, bRecord, pUndoRemoveMerge) */
  UnmergeCells(rRange: ScRange | ScCellMergeOption, bRecord = true, pUndoRemoveMerge: ScUndoRemoveMerge | null = null): boolean {
    if (rRange instanceof ScRange) {
      const aOption = new ScCellMergeOption(rRange.aStart.Col(), rRange.aStart.Row(), rRange.aEnd.Col(), rRange.aEnd.Row());
      const nTab1 = rRange.aStart.Tab();
      const nTab2 = rRange.aEnd.Tab();
      for (let i = nTab1; i <= nTab2; ++i) aOption.maTabs.add(i);

      return this.UnmergeCells(aOption, bRecord, pUndoRemoveMerge);
    }
    const rOption = rRange;

    if (!rOption.maTabs.size)
      // Nothing to unmerge.
      return true;

    const aModificator = new ScDocShellModificator(this.rDocShell);
    const rDoc = this.rDocShell.GetDocument();

    if (bRecord && !rDoc.IsUndoEnabled()) bRecord = false;

    let pUndoDoc = pUndoRemoveMerge ? pUndoRemoveMerge.GetUndoDoc() : null;
    const aTabs = rOption.tabs();
    for (const nTab of aTabs) {
      const aRange = rOption.getSingleRange(nTab);
      if (!rDoc.HasAttrib(aRange, HasAttrFlags.Merged)) continue;

      const aExtended = aRange.clone();
      rDoc.ExtendMerge(aExtended);
      const aRefresh = aExtended.clone();
      rDoc.ExtendOverlapped(aRefresh);

      if (bRecord) {
        if (!pUndoDoc) {
          pUndoDoc = new ScDocument(ScDocumentMode.SCDOCMODE_UNDO);
          pUndoDoc.InitUndo(rDoc, aTabs[0]!, aTabs[aTabs.length - 1]!);
        }
        rDoc.CopyToDocument(aExtended, InsertDeleteFlags.ATTRIB, false, pUndoDoc);
      }

      rDoc.ApplyPatternAreaTab(aRange.aStart.Col(), aRange.aStart.Row(), aRange.aEnd.Col(), aRange.aEnd.Row(), nTab, { ATTR_MERGE: { nColMerge: 0, nRowMerge: 0 } });

      rDoc.RemoveFlagsTab(aExtended.aStart.Col(), aExtended.aStart.Row(), aExtended.aEnd.Col(), aExtended.aEnd.Row(), nTab, ScMF.Hor | ScMF.Ver);

      if (!this.AdjustRowHeight(aExtended, true, true)) this.rDocShell.PostPaint(aExtended, PaintPartFlags.Grid);
    }

    if (bRecord) {
      if (pUndoRemoveMerge) {
        // If pUndoRemoveMerge was passed, the caller is responsible for
        // adding it to Undo. Just add the current option.
        pUndoRemoveMerge.AddCellMergeOption(rOption);
      } else if (pUndoDoc) {
        this.rDocShell.GetUndoManager().AddUndoAction(new ScUndoRemoveMerge(this.rDocShell, rOption, pUndoDoc));
      }
    }
    aModificator.SetDocumentModified();

    return true;
  }
}

