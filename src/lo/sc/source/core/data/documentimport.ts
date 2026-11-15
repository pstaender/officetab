// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/documentimport.hxx reduced
// @upstream sc/source/core/data/documentimport.cxx reduced
// ScDocumentImport: puts cells into a document as a file import does, without listening,
// broadcasting or recalculation; finalize() lets the formula cells listen and calculates those
// without a loaded result (ScDocument::CalcAfterLoad). Left out: the column block position
// caches, shared formula groups, the attribute entry vectors (attributes go through the
// document's pattern functions) and the broadcaster setup of the real class.
import type { FormulaGrammar } from '../../../../include/formula/grammar.ts';
import type { EditTextObject } from '../../../../editeng/source/editeng/editobj.ts';
import { ScAddress, ScRange } from '../../../inc/address.ts';
import { ScMarkData } from '../../../inc/markdata.ts';
import type { ScDocument } from './document.ts';
import { ScFormulaCell } from './formulacell.ts';

export class ScDocumentImport {
  private readonly mrDoc: ScDocument;
  private readonly mbOldAutoCalc: boolean;

  constructor(rDoc: ScDocument) {
    this.mrDoc = rDoc;
    this.mbOldAutoCalc = rDoc.GetAutoCalc();
    rDoc.SetAutoCalc(false);
    rDoc.SetImportingXML(true);
  }

  getDoc(): ScDocument { return this.mrDoc; }

  private column(rPos: ScAddress) {
    const t = this.mrDoc.FetchTable(rPos.Tab());
    if (!t || !this.mrDoc.ValidColRow(rPos.Col(), rPos.Row())) return null;
    return t.CreateColumnIfNotExists(rPos.Col());
  }

  setNumericCell(rPos: ScAddress, fVal: number): void { this.column(rPos)?.SetCellRaw(rPos.Row(), fVal); }

  /** A plain text cell (no input interpretation). */
  setStringCell(rPos: ScAddress, rStr: string): void { this.column(rPos)?.SetCellRaw(rPos.Row(), rStr); }

  setEditCell(rPos: ScAddress, pEditText: EditTextObject): void { this.column(rPos)?.SetCellRaw(rPos.Row(), pEditText); }

  /** A formula cell from a string in a grammar; with a loaded result the cell is clean. */
  setFormulaCell(rPos: ScAddress, rFormula: string, eGrammar: FormulaGrammar.Grammar, pResult?: number | string | null): ScFormulaCell | null {
    const pCol = this.column(rPos);
    if (!pCol) return null;
    const pCell = new ScFormulaCell(this.mrDoc, rPos, rFormula, eGrammar);
    if (typeof pResult === 'number') { pCell.SetHybridDouble(pResult); pCell.ResetDirty(); }
    else if (typeof pResult === 'string') { pCell.SetHybridString(pResult); pCell.ResetDirty(); }
    pCol.SetCellRaw(rPos.Row(), pCell);
    return pCell;
  }

  /** An array formula over rRange (setMatrixCells): the cells are calculated after loading. */
  setMatrixCells(rRange: ScRange, rFormula: string, eGrammar: FormulaGrammar.Grammar): void {
    const aMark = new ScMarkData(this.mrDoc.GetSheetLimits());
    aMark.SelectOneTable(rRange.aStart.Tab());
    this.mrDoc.InsertMatrixFormula(rRange.aStart.Col(), rRange.aStart.Row(), rRange.aEnd.Col(), rRange.aEnd.Row(), aMark, rFormula, null, eGrammar);
  }

  /** The import is complete: listening and the calculation of what has no result. */
  finalize(bHardRecalc = false): void {
    this.mrDoc.SetImportingXML(false);
    this.mrDoc.SetAutoCalc(this.mbOldAutoCalc);
    this.mrDoc.CalcAfterLoad(true, bHardRecalc);
  }
}
