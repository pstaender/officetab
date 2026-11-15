// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/inc/undocell.hxx partial
// @upstream sc/source/ui/undo/undocell.cxx partial
// The undo actions of single-cell input: ScUndoEnterData (typed input on the selected sheets),
// ScUndoEnterValue (a value from the API), ScUndoSetCell (any cell content) and ScUndoPageBreak
// (a manual page break inserted or deleted). Change tracking, the cursor movement of the view,
// Repeat and the LOK notifications are left out; the other actions of undocell.cxx (cursor
// attributes, print zoom, thesaurus, notes, detective, range names) are not ported.
import { EditTextObject } from '../../../../editeng/source/editeng/editobj.ts';
import { ScAddress, ScRange } from '../../../inc/address.ts';
import { CELLTYPE_EDIT, CELLTYPE_FORMULA, CELLTYPE_NONE, CELLTYPE_STRING, CELLTYPE_VALUE, ScCellValue } from '../../../inc/cellvalue.ts';
import { ScSetStringParam, TextFormatPolicy } from '../../../inc/stringutil.ts';
import { ScFormulaCell } from '../../core/data/formulacell.ts';
import type { ScDocShell } from '../docshell/docsh.ts';
import { ScSimpleUndo } from './undobase.ts';

/** STR_UNDO_ENTERDATA */
const STR_UNDO_ENTERDATA = 'Input';

/** ScUndoEnterData::Value: a sheet's old cell and number format. */
export class ScUndoEnterDataValue {
  mnTab = -1;
  mbHasFormat = false;
  /** The number format code (sal_uInt32 format index upstream). */
  mnFormat = '';
  maCell = new ScCellValue();
}

/** Put a copy of a cell value into the document (ScCellValue::assign + release). */
function lcl_ReleaseCell(rDoc: ReturnType<ScDocShell['GetDocument']>, rCell: ScCellValue, rPos: ScAddress): void {
  const p = rCell.getData();
  if (p === undefined) rDoc.SetEmptyCell(rPos);
  else if (p instanceof ScFormulaCell) rDoc.SetFormulaCell(rPos, p.Clone(rPos, rDoc));
  else if (p instanceof EditTextObject) rDoc.SetEditText(rPos, p.Clone());
  else rDoc.SetCellData(rPos, p);
}

export class ScUndoEnterData extends ScSimpleUndo {
  private maOldValues: ScUndoEnterDataValue[];
  private maNewString: string;
  private mpNewEditData: EditTextObject | null;
  private maPos: ScAddress;

  constructor(rNewDocShell: ScDocShell, rPos: ScAddress, rOldValues: ScUndoEnterDataValue[], aNewStr: string, pObj: EditTextObject | null) {
    super(rNewDocShell);
    this.maNewString = aNewStr;
    this.mpNewEditData = pObj;
    this.maPos = rPos.clone();
    this.maOldValues = rOldValues.splice(0); // maOldValues.swap(rOldValues)
  }

  override GetComment(): string { return STR_UNDO_ENTERDATA; } // "Input"

  override getAffectedRange(): ScRange | null { return new ScRange(this.maPos); }

  private DoChange(): void {
    // only when needed (old or new Edit cell, or Attribute)?
    for (const i of this.maOldValues) this.rDocShell.AdjustRowHeight(this.maPos.Row(), this.maPos.Row(), i.mnTab);

    this.rDocShell.PostDataChanged();
  }

  override Undo(): void {
    this.BeginUndo();

    const rDoc = this.rDocShell.GetDocument();
    for (const rVal of this.maOldValues) {
      const aPos = this.maPos.clone();
      aPos.SetTab(rVal.mnTab);
      lcl_ReleaseCell(rDoc, rVal.maCell, aPos);

      if (rVal.mbHasFormat) rDoc.ApplyAttr(this.maPos.Col(), this.maPos.Row(), rVal.mnTab, { ATTR_VALUE_FORMAT: rVal.mnFormat });
      else {
        const pPattern = rDoc.GetPattern(this.maPos.Col(), this.maPos.Row(), rVal.mnTab).ClearItems(['ATTR_VALUE_FORMAT']);
        rDoc.SetPatternAreaTab(this.maPos.Col(), this.maPos.Row(), this.maPos.Col(), this.maPos.Row(), rVal.mnTab, rDoc.getCellAttributeHelper().registerAndCheck(pPattern));
      }
      this.rDocShell.PostPaintCell(this.maPos.Col(), this.maPos.Row(), rVal.mnTab);
    }

    this.DoChange();
    this.EndUndo();
  }

  override Redo(): void {
    this.BeginRedo();

    const rDoc = this.rDocShell.GetDocument();
    for (const rOldValue of this.maOldValues) {
      const nTab = rOldValue.mnTab;
      if (this.mpNewEditData) {
        const aPos = this.maPos.clone();
        aPos.SetTab(nTab);
        // edit text will be cloned.
        rDoc.SetEditText(aPos, this.mpNewEditData.Clone());
      } else rDoc.SetString(this.maPos.Col(), this.maPos.Row(), nTab, this.maNewString);

      this.rDocShell.PostPaintCell(this.maPos.Col(), this.maPos.Row(), nTab);
    }

    this.DoChange();
    this.EndRedo();
  }
}

export class ScUndoEnterValue extends ScSimpleUndo {
  private aPos: ScAddress;
  private maOldCell: ScCellValue;
  private nValue: number;

  constructor(rNewDocShell: ScDocShell, rNewPos: ScAddress, aUndoCell: ScCellValue, nVal: number) {
    super(rNewDocShell);
    this.aPos = rNewPos.clone();
    this.maOldCell = aUndoCell;
    this.nValue = nVal;
  }

  override GetComment(): string { return STR_UNDO_ENTERDATA; } // "Input"

  override getAffectedRange(): ScRange | null { return new ScRange(this.aPos); }

  override Undo(): void {
    this.BeginUndo();

    const rDoc = this.rDocShell.GetDocument();
    lcl_ReleaseCell(rDoc, this.maOldCell, this.aPos);

    this.rDocShell.PostPaintCell(this.aPos);

    this.EndUndo();
  }

  override Redo(): void {
    this.BeginRedo();

    const rDoc = this.rDocShell.GetDocument();
    rDoc.SetValue(this.aPos.Col(), this.aPos.Row(), this.aPos.Tab(), this.nValue);
    this.rDocShell.PostPaintCell(this.aPos);

    this.EndRedo();
  }
}

export class ScUndoSetCell extends ScSimpleUndo {
  private maPos: ScAddress;
  private maOldValue: ScCellValue;
  private maNewValue: ScCellValue;

  constructor(rDocSh: ScDocShell, rPos: ScAddress, aOldVal: ScCellValue, aNewVal: ScCellValue) {
    super(rDocSh);
    this.maPos = rPos.clone();
    this.maOldValue = aOldVal;
    this.maNewValue = aNewVal;
  }

  override GetComment(): string { return STR_UNDO_ENTERDATA; } // "Input"

  override getAffectedRange(): ScRange | null { return new ScRange(this.maPos); }

  override Undo(): void {
    this.BeginUndo();
    this.SetValue(this.maOldValue);
    this.rDocShell.PostPaintCell(this.maPos);
    this.EndUndo();
  }

  override Redo(): void {
    this.BeginRedo();
    this.SetValue(this.maNewValue);
    this.rDocShell.PostPaintCell(this.maPos);
    this.EndRedo();
  }

  private SetValue(rVal: ScCellValue): void {
    const rDoc = this.rDocShell.GetDocument();

    switch (rVal.getType()) {
      case CELLTYPE_NONE:
        // empty cell
        rDoc.SetEmptyCell(this.maPos);
        break;
      case CELLTYPE_VALUE:
        rDoc.SetValue(this.maPos, rVal.getDouble());
        break;
      case CELLTYPE_STRING: {
        const aParam = new ScSetStringParam();
        aParam.setTextInput();
        // Undo only cell content, without setting any number format.
        aParam.meSetTextNumFormat = TextFormatPolicy.Keep;
        rDoc.SetString(this.maPos, rVal.getString(), aParam);
        break;
      }
      case CELLTYPE_EDIT:
        rDoc.SetEditText(this.maPos, rVal.getEditText()!.Clone());
        break;
      case CELLTYPE_FORMULA:
        rDoc.SetFormulaCell(this.maPos, rVal.getFormula()!.Clone(this.maPos.clone(), rDoc));
        break;
      default:
    }
  }
}

const STR_UNDO_INSCOLBREAK = 'Insert Column Break';
const STR_UNDO_DELCOLBREAK = 'Delete column break';
const STR_UNDO_INSROWBREAK = 'Insert Row Break';
const STR_UNDO_DELROWBREAK = 'Delete row break';

/** A manual page break inserted or deleted. The view's cursor does not move to it (no active view shell). */
export class ScUndoPageBreak extends ScSimpleUndo {
  private readonly nCol: number;
  private readonly nRow: number;
  private readonly nTab: number;
  private readonly bColumn: boolean; // Column or row break
  private readonly bInsert: boolean; // Insert or Delete

  constructor(rNewDocShell: ScDocShell, nNewCol: number, nNewRow: number, nNewTab: number, bNewColumn: boolean, bNewInsert: boolean) {
    super(rNewDocShell);
    this.nCol = nNewCol;
    this.nRow = nNewRow;
    this.nTab = nNewTab;
    this.bColumn = bNewColumn;
    this.bInsert = bNewInsert;
  }

  override GetComment(): string {
    //"Column break" | "Row break"  "insert" | "delete"
    return this.bColumn ? (this.bInsert ? STR_UNDO_INSCOLBREAK : STR_UNDO_DELCOLBREAK) : (this.bInsert ? STR_UNDO_INSROWBREAK : STR_UNDO_DELROWBREAK);
  }

  private DoChange(bInsertP: boolean): void {
    const aPos = new ScAddress(this.nCol, this.nRow, this.nTab);
    if (bInsertP) this.rDocShell.GetDocFunc().InsertPageBreak(this.bColumn, aPos, false, true);
    else this.rDocShell.GetDocFunc().RemovePageBreak(this.bColumn, aPos, false, true);

    this.rDocShell.GetDocument().InvalidatePageBreaks(this.nTab);
  }

  override Undo(): void {
    this.BeginUndo();
    this.DoChange(!this.bInsert);
    this.EndUndo();
  }

  override Redo(): void {
    this.BeginRedo();
    this.DoChange(this.bInsert);
    this.EndRedo();
  }
}
