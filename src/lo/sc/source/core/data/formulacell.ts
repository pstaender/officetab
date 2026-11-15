// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/formulacell.hxx reduced
// @upstream sc/source/core/data/formulacell.cxx reduced
// @upstream sc/inc/recursionhelper.hxx reduced
// @upstream sc/source/core/tool/recursionhelper.cxx reduced
// ScFormulaCell: a formula's token array, position, result and dirty state, interpreted on demand
// (MaybeInterpret when AutoCalc is on, or by a recalculation). Kept: compiling from a string in a
// grammar, GetFormula, Interpret with upstream's recursion limit (MAXRECURSION: deeper
// dependencies are postponed and interpreted bottom-up from the top level), circular reference
// detection (Err:522) and iteration with the document's count and epsilon (Err:523 when it does
// not converge), the number format the result implies (mbNeedsNumberFormat), array (matrix)
// formulas with their origin and ocMatRef cells, listening to the referenced cells and areas, and
// the reference updates. Left out: formula groups (shared formulas, threading, OpenCL), table
// operations (TableOpDirty), change tracking and the import's hybrid formulas compile.
import { FormulaError, GetDoubleErrorValue } from '../../../../include/formula/errorcodes.ts';
import { FormulaGrammar } from '../../../../include/formula/grammar.ts';
import { ocMatRef } from '../../../../include/formula/opcode.ts';
import { FormulaTokenArrayPlainIterator, svDoubleRef, svSingleRef, type FormulaToken } from '../../../../formula/source/core/api/token.ts';
import { SvNumFormatType } from '../../../../svl/source/numbers/zforlist.ts';
import { ScAddress, ScRange, BCA_LISTEN_ALWAYS } from '../../../inc/address.ts';
import { ScFormulaResult, type FormulaResultValue } from '../../../inc/formularesult.ts';
import type { ScComplexRefData, ScSingleRefData } from '../../../inc/refdata.ts';
import type { RefUpdateContext, RefUpdateDeleteTabContext, RefUpdateInsertTabContext, RefUpdateMoveTabContext } from '../../../inc/refupdatecontext.ts';
import { UpdateRefMode } from '../../../inc/refupdatecontext.ts';
import { ScCompiler } from '../tool/compiler.ts';
import { ScInterpreter } from '../tool/interpr4.ts';
// The opcode implementations register themselves with ScInterpreter.
import '../tool/interpr1.ts';
import '../tool/interpr2.ts';
import '../tool/interpr3.ts';
import '../tool/interpr5.ts';
import '../tool/interpr6.ts';
import '../tool/interpr8.ts';
import type { ScMatrix } from '../tool/scmatrix.ts';
import { ScTokenArray } from '../tool/token.ts';
import type { ScDocument } from './document.ts';

export const ScMatrixMode = { NONE: 0, Formula: 1, Reference: 2 } as const;
export type ScMatrixMode = (typeof ScMatrixMode)[keyof typeof ScMatrixMode];

/** The deepest nesting of interpreted cells before the remaining ones are postponed. */
export const MAXRECURSION = 400;

/** ScRecursionHelper: the state of the recursive interpretation of a document. */
export class ScRecursionHelper {
  nRecursionCount = 0;
  bInRecursionReturn = false;
  bDoingRecursion = false;
  /** Cells left dirty because the recursion limit was reached, deepest first. */
  aRecursionList: ScFormulaCell[] = [];
  /** Where returning cells are inserted (upstream's maInsertPoint): before the cells of the
      previous pass, so a pass starts with the deepest cells. */
  nInsertPoint = 0;
  /** The cells being interpreted, outermost first. */
  aStack: ScFormulaCell[] = [];
  bInIterationReturn = false;
  /** The cells of the circular chain to iterate, from the first one entered. */
  aIterationCells: ScFormulaCell[] = [];
  bDoingIteration = false;

  IsInReturn(): boolean { return this.bInRecursionReturn || this.bInIterationReturn; }
  IsInRecursionReturn(): boolean { return this.bInRecursionReturn; }
  IsInIterationReturn(): boolean { return this.bInIterationReturn; }
  GetRecursionCount(): number { return this.nRecursionCount; }
  Clear(): void {
    this.aRecursionList = [];
    this.nInsertPoint = 0;
    this.bInRecursionReturn = false;
    this.bInIterationReturn = false;
    this.aIterationCells = [];
  }
}

export class ScFormulaCell {
  aResult = new ScFormulaResult();
  pCode: ScTokenArray;
  rDocument: ScDocument;
  aPos: ScAddress;
  /** The array formula mode of the cell. */
  cMatrixFlag: ScMatrixMode;
  nFormatType: SvNumFormatType = SvNumFormatType.NUMBER;
  /** The number format code the result implies (for a date or currency result). */
  maFormatCode = '';
  bDirty = false; // Must be (re)calculated
  bChanged = false; // Whether something changed regarding display/representation
  bRunning = false; // Already interpreting right now
  bCompile = false; // Must be (re)compiled
  bSubTotal = false;
  bIsIterCell = false; // If this cell is in a cyclic list of cells
  mbNeedsNumberFormat = false;
  mbPostponedDirty = false;
  nSeenInIteration = 0;
  /** The matrix size of an array formula origin. */
  private mnMatCols = 0;
  private mnMatRows = 0;
  /** The cells and areas this cell listens to (as registered). */
  mvListened: ScRange[] = [];
  mbListensAlways = false;

  constructor(rDoc: ScDocument, rPos: ScAddress, rFormula?: string | ScTokenArray, eGrammar: FormulaGrammar.Grammar = FormulaGrammar.GRAM_DEFAULT, cMatInd: ScMatrixMode = ScMatrixMode.NONE) {
    this.rDocument = rDoc;
    this.aPos = rPos.clone();
    this.cMatrixFlag = cMatInd;
    if (rFormula instanceof ScTokenArray) {
      this.pCode = rFormula.Clone();
      // Generate RPN token array.
      if (this.pCode.GetLen() && this.pCode.GetCodeError() === FormulaError.NONE && !this.pCode.GetCodeLen()) {
        const aComp = new ScCompiler(rDoc, this.aPos, this.pCode, rDoc.GetGrammar(), this.cMatrixFlag !== ScMatrixMode.NONE);
        this.bSubTotal = aComp.CompileTokenArray();
      } else if (this.pCode.HasOpCodeRPN(OC_SUBTOTAL) || this.pCode.HasOpCodeRPN(OC_AGGREGATE)) this.bSubTotal = true;
      this.bDirty = true;
    } else if (rFormula !== undefined) {
      this.pCode = new ScTokenArray(rDoc.GetSheetLimits());
      this.Compile(rFormula, true, eGrammar); // bNoListening, Insert does that
      this.bDirty = true;
    } else {
      this.pCode = new ScTokenArray(rDoc.GetSheetLimits());
    }
  }

  /** Copy for a new position (ScFormulaCell copy constructor with ScCloneFlags::Default): the
      references stay relative. */
  Clone(rPos?: ScAddress, rDoc?: ScDocument): ScFormulaCell {
    const p = new ScFormulaCell(rDoc ?? this.rDocument, rPos ?? this.aPos);
    p.pCode = this.pCode.Clone();
    p.aResult = this.aResult.clone();
    p.cMatrixFlag = this.cMatrixFlag;
    p.nFormatType = this.nFormatType;
    p.maFormatCode = this.maFormatCode;
    p.bSubTotal = this.bSubTotal;
    p.mnMatCols = this.mnMatCols;
    p.mnMatRows = this.mnMatRows;
    p.mbNeedsNumberFormat = this.mbNeedsNumberFormat;
    // A copy is dirty if the source was, or if it moved (its references point elsewhere).
    p.bDirty = this.bDirty || (rPos !== undefined && !rPos.equals(this.aPos)) || rDoc !== undefined;
    if (rPos && !rPos.equals(this.aPos)) {
      // The relative references keep their offsets; the RPN token objects are shared with the
      // code, so nothing more to do (ScTokenArray::AdjustReferenceOnCopy puts ranges in order).
      p.pCode.AdjustReferenceOnCopy(rPos);
    }
    return p;
  }

  GetDocument(): ScDocument { return this.rDocument; }
  GetCode(): ScTokenArray { return this.pCode; }
  SetCode(pNew: ScTokenArray): void {
    this.pCode = pNew;
    this.bCompile = false;
    this.bDirty = true;
  }

  GetMatrixFlag(): ScMatrixMode { return this.cMatrixFlag; }
  SetMatColsRows(nCols: number, nRows: number): void { this.mnMatCols = nCols; this.mnMatRows = nRows; }
  GetMatColsRows(): { nCols: number; nRows: number } { return { nCols: this.mnMatCols, nRows: this.mnMatRows }; }

  Compile(rFormula: string, bNoListening = false, eGrammar: FormulaGrammar.Grammar = FormulaGrammar.GRAM_DEFAULT): void {
    if (!bNoListening && this.pCode.GetCodeLen()) this.EndListeningTo(this.rDocument);
    const aComp = new ScCompiler(this.rDocument, this.aPos, null, eGrammar, this.cMatrixFlag !== ScMatrixMode.NONE);
    this.pCode = aComp.CompileString(rFormula);
    if (this.pCode.GetCodeError() === FormulaError.NONE) {
      if (!this.pCode.GetLen() && this.aResult.GetHybridFormula() && rFormula === this.aResult.GetHybridFormula()) {
        // not recursive CompileTokenArray/Compile/CompileTokenArray
        if (rFormula[0] === '=') this.pCode.AddBad(rFormula.slice(1));
        else this.pCode.AddBad(rFormula);
      }
      aComp.SetTokenArray(this.pCode);
      this.bSubTotal = aComp.CompileTokenArray();
      this.bCompile = false;
      this.bChanged = true;
      this.aResult.SetToken(null);
      this.SetTextWidth();
      if (!bNoListening) this.StartListeningTo(this.rDocument);
    } else this.bChanged = true;
  }

  /** Compile the code into RPN when it has not been compiled. */
  CompileTokenArray(bNoListening = false): void {
    // Not already compiled?
    if (!this.pCode.GetLen() && this.aResult.GetHybridFormula()) {
      this.Compile(this.aResult.GetHybridFormula(), bNoListening, this.rDocument.GetGrammar());
    } else if (this.bCompile && !this.rDocument.IsClipOrUndo() && this.pCode.GetCodeError() === FormulaError.NONE) {
      // RPN length may get changed
      if (!bNoListening && this.pCode.GetCodeLen()) this.EndListeningTo(this.rDocument);
      const aComp = new ScCompiler(this.rDocument, this.aPos, this.pCode, this.rDocument.GetGrammar(), this.cMatrixFlag !== ScMatrixMode.NONE);
      this.bSubTotal = aComp.CompileTokenArray();
      if (this.pCode.GetCodeError() === FormulaError.NONE) {
        this.nFormatType = SvNumFormatType.NUMBER;
        this.bChanged = true;
        this.aResult.SetToken(null);
        this.bCompile = false;
        if (!bNoListening) this.StartListeningTo(this.rDocument);
      }
      this.SetTextWidth();
    }
  }

  private SetTextWidth(): void {}

  /** The formula string in a grammar, with the leading '=' (and '{=...}' for an array formula). */
  GetFormula(eGrammar: FormulaGrammar.Grammar = FormulaGrammar.GRAM_DEFAULT): string {
    if (this.pCode.GetCodeError() !== FormulaError.NONE && !this.pCode.GetLen()) {
      return this.aResult.GetHybridFormula() || ''; // the original
    }
    let buffer = '';
    if (this.cMatrixFlag === ScMatrixMode.Reference) {
      // Reference to another cell that contains a matrix formula.
      const it = new FormulaTokenArrayPlainIterator(this.pCode);
      const p = it.GetNextReferenceRPN() ?? it.GetNextReference();
      if (p) {
        /* FIXME: original GetFormula() code obtained
         * pCell only if (!IsInChangeTrack()),
         * GetEnglishFormula() omitted that test.
         * Can we live without in all cases? */
        const rRef = p.GetSingleRef() as ScSingleRefData;
        const aAbs = rRef.toAbs(this.rDocument.GetSheetLimits(), this.aPos);
        const pCell = this.rDocument.GetFormulaCell(aAbs);
        if (pCell) return pCell.GetFormula(eGrammar);
        const aComp = new ScCompiler(this.rDocument, this.aPos, this.pCode, eGrammar);
        buffer = aComp.CreateStringFromTokenArray();
      } else {
        return '';
      }
    } else {
      const aComp = new ScCompiler(this.rDocument, this.aPos, this.pCode, eGrammar);
      buffer = aComp.CreateStringFromTokenArray();
    }

    buffer = `=${buffer}`;
    if (this.cMatrixFlag !== ScMatrixMode.NONE) buffer = `{${buffer}}`;
    return buffer;
  }

  /** The dimensions of an array result. */
  GetResultDimensions(): { nCols: number; nRows: number } {
    this.MaybeInterpret();
    const pMat = this.aResult.GetMatrix();
    if (pMat) {
      const d = pMat.GetDimensions();
      return { nCols: d.nC, nRows: d.nR };
    }
    return { nCols: 0, nRows: 0 };
  }

  ResetDirty(): void { this.bDirty = this.mbPostponedDirty = false; }
  SetNeedNumberFormat(bVal: boolean): void { this.mbNeedsNumberFormat = bVal; }
  NeedsNumberFormat(): boolean { return this.mbNeedsNumberFormat; }
  GetFormatType(): SvNumFormatType { return this.nFormatType; }
  GetDirty(): boolean { return this.bDirty; }
  IsDirtyOrInTableOpDirty(): boolean { return this.bDirty; }
  IsRunning(): boolean { return this.bRunning; }
  SetRunning(bVal: boolean): void { this.bRunning = bVal; }
  IsIterCell(): boolean { return this.bIsIterCell; }
  IsSubTotal(): boolean { return this.bSubTotal; }
  IsChanged(): boolean { return this.bChanged; }
  SetChanged(b: boolean): void { this.bChanged = b; }
  GetSeenInIteration(): number { return this.nSeenInIteration; }

  /** Whether the cell needs interpreting before its result is used (NeedsInterpret). */
  NeedsInterpret(): boolean {
    if (this.bIsIterCell)
      // Shortcut to force return of current value and not enter Interpret()
      // as we're looping over all iteration cells.
      return false;
    if (!this.IsDirtyOrInTableOpDirty()) return false;
    return this.rDocument.GetAutoCalc() || this.cMatrixFlag !== ScMatrixMode.NONE || this.pCode.IsRecalcModeOnLoad();
  }

  MaybeInterpret(): void {
    if (this.NeedsInterpret()) this.Interpret();
  }

  /** Mark the cell (and through the broadcast, its dependents) for recalculation. */
  SetDirty(bDirtyFlag = true): void {
    if (this.IsInChangeTrack()) return;
    if (this.rDocument.GetHardRecalcState() !== 0) {
      this.SetDirtyVar();
      this.rDocument.SetStreamValid(this.aPos.Tab(), false);
      return;
    }
    // Avoid multiple formula tracking in Load() and in CompileAll()
    // after CopyScenario() and CopyBlockFromClip().
    // If unconditional formula tracking is needed, set bDirty=false
    // before calling SetDirty(), for example in CompileTokenArray().
    if (!this.bDirty || this.mbPostponedDirty || !this.rDocument.IsInFormulaTree(this)) {
      if (bDirtyFlag) this.SetDirtyVar();
      this.rDocument.AppendToFormulaTrack(this);
      // While loading a document listeners have not been established yet.
      // Tracking would remove this cell from the FormulaTrack and add it to
      // the FormulaTree, once in there it would be assumed that its
      // dependents already had been tracked and it would be skipped on a
      // subsequent notify. Postpone tracking until all listeners are set.
      if (!this.rDocument.IsImportingXML()) this.rDocument.TrackFormulas();
    }
    this.rDocument.SetStreamValid(this.aPos.Tab(), false);
  }

  SetDirtyVar(): void {
    this.bDirty = true;
    this.mbPostponedDirty = false;
    // mark the sheet of this cell to be calculated
    //#FIXME do we need to revert this remnant of old fake vba events? rDocument.AddCalcDocumentTab( aPos.Tab() );
  }

  SetDirtyAfterLoad(): void {
    this.bDirty = true;
    if (this.rDocument.GetHardRecalcState() === 0) this.rDocument.PutInFormulaTree(this);
  }

  private IsInChangeTrack(): boolean { return false; }

  // --- Interpret --------------------------------------------------------------------------------

  Interpret(): boolean {
    const rRecursionHelper = this.rDocument.GetRecursionHelper();

    if (!this.IsDirtyOrInTableOpDirty() || rRecursionHelper.IsInReturn()) return false; // no double/triple processing

    if (this.bRunning) {
      if (!this.rDocument.GetDocOptions().IsIter()) {
        this.aResult.SetResultError(FormulaError.CircularReference);
        return false;
      }
      if (this.aResult.GetResultError() === FormulaError.CircularReference) this.aResult.SetResultError(FormulaError.NONE);

      // Start or add to iteration list.
      if (!rRecursionHelper.bDoingIteration) {
        const i = rRecursionHelper.aStack.indexOf(this);
        rRecursionHelper.aIterationCells = rRecursionHelper.aStack.slice(i);
        rRecursionHelper.bInIterationReturn = true;
      }
      return false;
    }

    // no multiple interprets for GetErrCode, IsValue, GetValue and
    // different entry point recursions. Would also lead to premature
    // convergence in iterations.
    if (rRecursionHelper.bDoingIteration && this.nSeenInIteration === this.rDocument.GetRecursionIteration()) return false;

    const bOldRunning = this.bRunning;
    if (rRecursionHelper.GetRecursionCount() > MAXRECURSION) {
      this.bRunning = true;
      rRecursionHelper.bInRecursionReturn = true;
    } else {
      this.rDocument.IncInterpretLevel();
      this.InterpretTail();
      this.rDocument.DecInterpretLevel();
    }

    // While leaving a recursion or iteration stack, insert its cells to the
    // recursion list in reverse order.
    if (rRecursionHelper.IsInRecursionReturn()) {
      rRecursionHelper.aRecursionList.splice(rRecursionHelper.nInsertPoint++, 0, this);
      this.bRunning = bOldRunning;
      if (rRecursionHelper.GetRecursionCount() === 0 && !rRecursionHelper.bDoingRecursion) {
        rRecursionHelper.bDoingRecursion = true;
        do {
          rRecursionHelper.bInRecursionReturn = false;
          rRecursionHelper.nInsertPoint = 0;
          for (const pCell of [...rRecursionHelper.aRecursionList]) {
            if (rRecursionHelper.IsInReturn()) break;
            if (pCell.IsDirtyOrInTableOpDirty()) {
              this.rDocument.IncInterpretLevel();
              pCell.bRunning = false;
              pCell.InterpretTail();
              this.rDocument.DecInterpretLevel();
            }
          }
        } while (rRecursionHelper.IsInRecursionReturn());
        rRecursionHelper.bDoingRecursion = false;
        rRecursionHelper.aRecursionList = [];
        rRecursionHelper.nInsertPoint = 0;
      }
    }

    if (rRecursionHelper.IsInIterationReturn() && rRecursionHelper.aIterationCells[0] === this && rRecursionHelper.GetRecursionCount() === 0) {
      this.Iterate(rRecursionHelper);
    } else if (rRecursionHelper.IsInIterationReturn() && rRecursionHelper.aIterationCells[0] === this) {
      // The cycle was entered from a deeper level: iterate here as well.
      this.Iterate(rRecursionHelper);
    }
    return false;
  }

  /** Iterate the cells of a circular chain until the results change less than the document's
      epsilon or the iteration count is reached (Err:523). */
  private Iterate(rRecursionHelper: ScRecursionHelper): void {
    const aCells = rRecursionHelper.aIterationCells;
    rRecursionHelper.bInIterationReturn = false;
    rRecursionHelper.bDoingIteration = true;
    for (const p of aCells) { p.bIsIterCell = true; p.bDirty = true; }
    const rOpt = this.rDocument.GetDocOptions();
    const nIterMax = rOpt.GetIterCount();
    const fEps = rOpt.GetIterEps();
    let bDone = false;
    for (let nIteration = 1; nIteration <= nIterMax && !bDone; nIteration++) {
      this.rDocument.SetRecursionIteration(nIteration);
      bDone = true;
      for (const pIterCell of aCells) {
        const fOld = pIterCell.aResult.IsValue() ? pIterCell.aResult.GetDouble() : NaN;
        const sOld = pIterCell.aResult.GetString();
        pIterCell.bDirty = true;
        this.rDocument.IncInterpretLevel();
        pIterCell.InterpretTail();
        this.rDocument.DecInterpretLevel();
        pIterCell.nSeenInIteration = nIteration;
        const bSame = pIterCell.aResult.IsValue() ? Math.abs(pIterCell.aResult.GetDouble() - fOld) <= fEps : pIterCell.aResult.GetString() === sOld;
        if (!bSame || nIteration === 1 && nIterMax > 1) bDone = false;
      }
    }
    for (const pIterCell of aCells) {
      pIterCell.bIsIterCell = false;
      pIterCell.nSeenInIteration = 0;
      pIterCell.bRunning = false;
      pIterCell.ResetDirty();
      if (!bDone) {
        pIterCell.aResult.SetResultError(FormulaError.NoConvergence);
        pIterCell.bChanged = true;
      }
    }
    this.rDocument.SetRecursionIteration(0);
    rRecursionHelper.bDoingIteration = false;
    rRecursionHelper.aIterationCells = [];
  }

  InterpretTail(): void {
    const rRecursionHelper = this.rDocument.GetRecursionHelper();
    rRecursionHelper.nRecursionCount++;
    rRecursionHelper.aStack.push(this);
    try {
      if (!this.pCode.GetCodeLen() && this.pCode.GetCodeError() === FormulaError.NONE) {
        if (!this.pCode.GetLen() && this.aResult.GetHybridFormula()) {
          this.CompileTokenArray(true);
        } else if (this.pCode.GetLen()) {
          this.bCompile = true;
          this.CompileTokenArray(true);
        }
      }

      if (this.pCode.GetCodeLen()) {
        const pInterpreter = new ScInterpreter(this, this.rDocument, this.aPos, this.pCode);

        const nOldErrCode = this.aResult.GetResultError();
        if (this.nSeenInIteration === 0) {
          // Only the first time
          // With bChanged=false, if a newly compiled cell has a result of
          // 0.0, no change is detected and the cell will not be repainted.
          this.aResult.SetResultError(FormulaError.NONE);
        }

        if (this.aResult.GetResultError() === FormulaError.CircularReference) this.aResult.SetResultError(FormulaError.NONE); // will be determined again if so

        const bOldRunning = this.bRunning;
        this.bRunning = true;
        pInterpreter.Interpret();
        if (rRecursionHelper.IsInRecursionReturn()) {
          // The result is incomplete; the cell stays dirty and is interpreted again.
          return;
        }
        this.bRunning = bOldRunning;

        // A circular reference found while interpreting: the result is the error, the
        // dependents get it too (Err:522).
        // (Only when the interpreter itself ended with it: a reference read after another error,
        // e.g. #REF!, may have touched the cell itself, upstream keeps the interpreter's error.)
        if (pInterpreter.GetError() === FormulaError.CircularReference && this.aResult.GetResultError() === FormulaError.CircularReference && !this.rDocument.GetDocOptions().IsIter()) {
          this.ResetDirty();
          this.bChanged = true;
          return;
        }
        if (rRecursionHelper.IsInIterationReturn() && rRecursionHelper.aIterationCells.includes(this) && rRecursionHelper.aIterationCells[0] !== this) {
          // part of a cycle being set up for iteration: keep the result of this round
          const xTok = pInterpreter.GetResultToken();
          this.aResult.SetToken(xTok);
          return;
        }

        if (pInterpreter.GetError() !== FormulaError.NONE && pInterpreter.GetError() !== FormulaError.CircularReference) {
          this.bChanged = true;
          if (pInterpreter.GetError() === FormulaError.RetryCircular) {
            // Array formula matrix calculation corner case. Keep dirty
            // state, do not remove from formula tree or anything else, but
            // store FormulaError::CircularReference in case this cell does not get
            // recalculated.
            this.aResult.SetResultError(FormulaError.CircularReference);
            return;
          }
          this.ResetDirty();
        }

        if (pInterpreter.GetError() !== nOldErrCode) this.bChanged = true;

        const xResult = pInterpreter.GetResultToken();
        if (pInterpreter.GetError() === FormulaError.CircularReference) {
          // A dependency is circular: this cell shows the error as well.
          this.aResult.SetResultError(FormulaError.CircularReference);
        } else this.aResult.SetToken(xResult);

        // Determine the number format the result implies.
        if (this.mbNeedsNumberFormat) {
          let bSetFormat = true;
          const nFormatType = pInterpreter.GetRetFormatType();
          const aFormatCode = pInterpreter.GetRetFormatIndex();
          if (nFormatType === SvNumFormatType.TEXT) bSetFormat = false;
          this.nFormatType = nFormatType;
          if (bSetFormat && nFormatType !== SvNumFormatType.NUMBER) {
            const aCode = aFormatCode || this.rDocument.GetStandardFormat(nFormatType);
            this.maFormatCode = aCode;
            this.rDocument.SetNumberFormat(this.aPos, aCode);
          }
          this.mbNeedsNumberFormat = false;
        } else this.nFormatType = pInterpreter.GetRetFormatType();

        this.bChanged = true;
        this.ResetDirty();
        // The result of a matrix origin determines its cells' display.
      } else {
        // Cells with compiler errors should not be marked dirty forever
        this.aResult.SetResultError(this.pCode.GetCodeError());
        this.ResetDirty();
      }
    } finally {
      rRecursionHelper.nRecursionCount--;
      rRecursionHelper.aStack.pop();
    }
  }

  // --- results -----------------------------------------------------------------------------------

  /** The error code of the result (after interpreting). */
  GetErrCode(): FormulaError {
    this.MaybeInterpret();
    /* FIXME: If ScTokenArray::SetCodeError() was really only for code
     * and not also abused for signaling other error conditions we could bail
     * out even before attempting to interpret broken code. */
    const nErr = this.pCode.GetCodeError();
    if (nErr !== FormulaError.NONE) return nErr;
    return this.aResult.GetResultError();
  }

  GetRawError(): FormulaError {
    const nErr = this.pCode.GetCodeError();
    if (nErr !== FormulaError.NONE) return nErr;
    return this.aResult.GetResultError();
  }

  /** The error and value of the result. */
  GetErrorOrValue(): { nErr: FormulaError; fVal: number } {
    this.MaybeInterpret();
    let nErr = this.pCode.GetCodeError();
    if (nErr !== FormulaError.NONE) return { nErr, fVal: 0 };
    nErr = this.aResult.GetResultError();
    if (nErr !== FormulaError.NONE) return { nErr, fVal: 0 };
    return { nErr: FormulaError.NONE, fVal: this.aResult.GetDouble() };
  }

  GetResult(): FormulaResultValue {
    this.MaybeInterpret();
    const nErr = this.pCode.GetCodeError();
    if (nErr !== FormulaError.NONE) return { meType: 'Error', mfValue: 0, maString: '', mnError: nErr };
    return this.aResult.GetResult();
  }

  IsEmpty(): boolean { this.MaybeInterpret(); return this.aResult.GetCellResultType() === 13; /* svEmptyCell */ }
  IsEmptyDisplayedAsString(): boolean { this.MaybeInterpret(); return this.aResult.IsEmptyDisplayedAsString(); }
  IsValue(): boolean { this.MaybeInterpret(); return this.aResult.IsValue(); }
  IsValueNoError(): boolean {
    this.MaybeInterpret();
    if (this.pCode.GetCodeError() !== FormulaError.NONE) return false;
    return this.aResult.IsValueNoError();
  }
  GetValue(): number {
    this.MaybeInterpret();
    return this.GetRawValue();
  }
  GetString(): string {
    this.MaybeInterpret();
    return this.GetRawString();
  }
  /** The value without interpreting; 0 with an error. */
  GetRawValue(): number {
    if ((this.pCode.GetCodeError() === FormulaError.NONE) && this.aResult.GetResultError() === FormulaError.NONE) return this.aResult.GetDouble();
    return 0.0;
  }
  GetRawString(): string {
    if ((this.pCode.GetCodeError() === FormulaError.NONE) && this.aResult.GetResultError() === FormulaError.NONE) return this.aResult.GetString();
    return '';
  }
  GetMatrix(): ScMatrix | null {
    if (this.rDocument.GetAutoCalc()) {
      if (this.IsDirtyOrInTableOpDirty()
        // Was stored !bDirty but an accompanying matrix cell was bDirty?
        || (!this.bDirty && this.cMatrixFlag === ScMatrixMode.Formula && !this.aResult.GetMatrix())) this.Interpret();
    }
    return this.aResult.GetMatrix();
  }

  SetResultDouble(n: number): void { this.aResult.SetDouble(n); }
  SetResultToken(pToken: FormulaToken | null): void { this.aResult.SetToken(pToken); }
  SetResultError(n: FormulaError): void { this.aResult.SetResultError(n); }
  SetErrCode(n: FormulaError): void {
    /* FIXME: check the numerous places where ScTokenArray::GetCodeError() is
     * used whether it is solely for transport of a simple result error and get
     * rid of that abuse. */
    this.pCode.SetCodeError(n);
    // Hard set errors are transported as result type value per convention,
    // e.g. via clipboard. ScFormulaResult::IsValue() and
    // ScFormulaResult::GetDouble() handle that.
    this.aResult.SetResultError(n);
  }
  /** A result to show until the formula is calculated (from an import). */
  SetHybridDouble(n: number): void { this.aResult.SetHybridDouble(n); }
  SetHybridString(r: string): void { this.aResult.SetHybridString(r); }
  SetHybridFormula(r: string): void { this.aResult.SetHybridFormula(r); }

  /** Whether the cell's result is a coded double error (for compatibility). */
  static IsErrorDouble(f: number): boolean { return GetDoubleErrorValue(f) !== FormulaError.NONE; }

  /** The origin of the array formula this cell belongs to. */
  GetMatrixOrigin(): ScAddress | null {
    switch (this.cMatrixFlag) {
      case ScMatrixMode.Formula:
        return this.aPos.clone();
      case ScMatrixMode.Reference: {
        const it = new FormulaTokenArrayPlainIterator(this.pCode);
        const t = it.GetNextReferenceRPN() ?? it.GetNextReference();
        if (t) {
          const rRef = t.GetSingleRef() as ScSingleRefData;
          const aAbs = rRef.toAbs(this.rDocument.GetSheetLimits(), this.aPos);
          if (this.rDocument.ValidAddress(aAbs)) return aAbs;
        }
        return null;
      }
      default:
        return null;
    }
  }

  /** The one reference of a formula that is only a reference (=A1 or =A1:B2). */
  HasOneReference(): ScRange | null {
    return this.pCode.IsReference(this.aPos);
  }

  // --- listening ---------------------------------------------------------------------------------

  /** Register with the document's broadcasters for every cell and area referenced. */
  StartListeningTo(rDoc: ScDocument): void {
    if (this.mvListened.length || this.mbListensAlways) this.EndListeningTo(rDoc);
    if (rDoc.IsClipOrUndo() || rDoc.GetNoListening() || this.IsInChangeTrack()) return;

    const pArr = this.pCode;
    if (pArr.IsRecalcModeAlways()) {
      rDoc.StartListeningArea(BCA_LISTEN_ALWAYS(), this);
      this.mbListensAlways = true;
    }

    const it = new FormulaTokenArrayPlainIterator(pArr);
    const lim = rDoc.GetSheetLimits();
    for (let t = it.GetNextReferenceRPN(); t; t = it.GetNextReferenceRPN()) {
      switch (t.GetType()) {
        case svSingleRef: {
          const aCell = (t.GetSingleRef() as ScSingleRefData).toAbs(lim, this.aPos);
          if (aCell.IsValid()) {
            const r = new ScRange(aCell);
            rDoc.StartListeningCell(aCell, this);
            this.mvListened.push(r);
          }
          break;
        }
        case svDoubleRef: {
          const aRange = (t.GetDoubleRef() as ScComplexRefData).toAbs(lim, this.aPos);
          if (aRange.IsValid()) {
            if (aRange.aStart.equals(aRange.aEnd)) rDoc.StartListeningCell(aRange.aStart, this);
            else rDoc.StartListeningArea(aRange, this);
            this.mvListened.push(aRange);
          }
          break;
        }
        default:
      }
    }
  }

  EndListeningTo(rDoc: ScDocument): void {
    if (this.mbListensAlways) {
      rDoc.EndListeningArea(BCA_LISTEN_ALWAYS(), this);
      this.mbListensAlways = false;
    }
    for (const r of this.mvListened) {
      if (r.aStart.equals(r.aEnd)) rDoc.EndListeningCell(r.aStart, this);
      else rDoc.EndListeningArea(r, this);
    }
    this.mvListened = [];
  }

  // --- reference updates -------------------------------------------------------------------------

  /** Update the references and the position on inserted/deleted cells; returns whether the cell
      needs recalculation. The caller re-establishes the listening. */
  UpdateReference(rCxt: RefUpdateContext, pUndoDoc?: ScDocument | null): boolean {
    void pUndoDoc;
    if (rCxt.meMode === UpdateRefMode.URM_INSDEL) return this.UpdateReferenceOnShift(rCxt);
    if (rCxt.meMode === UpdateRefMode.URM_MOVE) return this.UpdateReferenceOnMove(rCxt);
    return false;
  }

  UpdateReferenceOnShift(rCxt: RefUpdateContext): boolean {
    // Adjust tokens only when it's not grouped or grouped top cell.
    const aOldPos = this.aPos.clone();
    const aRes = this.pCode.AdjustReferenceOnShift(rCxt, aOldPos);
    // Cell itself is shifted?
    if (rCxt.maRange.Contains(aOldPos)) this.aPos.Move(rCxt.mnColDelta, rCxt.mnRowDelta, rCxt.mnTabDelta, ScAddress.Invalid(), rCxt.mrDoc);
    const bValChanged = aRes.mbValueChanged || aRes.mbReferenceModified || aRes.mbNameModified;
    if (bValChanged || this.pCode.IsRecalcModeOnRefMove()) {
      this.bCompile = false;
      return true;
    }
    return false;
  }

  /** Update for a moved range (cut and paste). The context range is the destination. */
  UpdateReferenceOnMove(rCxt: RefUpdateContext, rOldPos?: ScAddress): boolean {
    const aOldRange = rCxt.maRange.clone();
    aOldRange.Move(-rCxt.mnColDelta, -rCxt.mnRowDelta, -rCxt.mnTabDelta, ScRange.Invalid(), rCxt.mrDoc);
    const aOldPos = rOldPos ?? this.aPos.clone();
    let bCellInMoveTarget = false;
    if (aOldRange.Contains(aOldPos)) {
      // The cell is being moved: its position changes.
      this.aPos.Move(rCxt.mnColDelta, rCxt.mnRowDelta, rCxt.mnTabDelta, ScAddress.Invalid(), rCxt.mrDoc);
      bCellInMoveTarget = true;
    }
    const aRes = this.pCode.AdjustReferenceOnMove(rCxt, aOldPos, this.aPos);
    return aRes.mbValueChanged || aRes.mbReferenceModified || bCellInMoveTarget;
  }

  UpdateInsertTab(rCxt: RefUpdateInsertTabContext): void {
    const aRes = this.pCode.AdjustReferenceOnInsertedTab(rCxt, this.aPos);
    // Adjust the position of the cell itself.
    if (rCxt.mnInsertPos <= this.aPos.Tab()) this.aPos.IncTab(rCxt.mnSheets);
    if (aRes.mbNameModified) this.bCompile = true;
  }

  UpdateDeleteTab(rCxt: RefUpdateDeleteTabContext): boolean {
    const aRes = this.pCode.AdjustReferenceOnDeletedTab(rCxt, this.aPos);
    if (rCxt.mnDeletePos < this.aPos.Tab()) this.aPos.IncTab(-1 * rCxt.mnSheets);
    return aRes.mbReferenceModified;
  }

  UpdateMoveTab(rCxt: RefUpdateMoveTabContext, nTabNo: number): void {
    const aRes = this.pCode.AdjustReferenceOnMovedTab(rCxt, this.aPos);
    this.aPos.SetTab(nTabNo);
    void aRes;
  }

  /** Whether the code references a deleted cell (#REF!). */
  HasRefDeleted(): boolean { return this.pCode.HasDeletedRefs(); }

  /** ocMatRef cells: the referenced origin's position. */
  static IsMatRef(t: FormulaToken): boolean { return t.GetOpCode() === ocMatRef; }
}

import * as OC from '../../../../include/formula/opcode.ts';
const OC_SUBTOTAL = OC.ocSubTotal;
const OC_AGGREGATE = OC.ocAggregate;
