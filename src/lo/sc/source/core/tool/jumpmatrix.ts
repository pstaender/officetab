// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/core/inc/jumpmatrix.hxx reduced
// @upstream sc/source/core/tool/jumpmatrix.cxx reduced
// ScJumpMatrix: the state of a jump command (IF, CHOOSE, IFERROR, IFNA) or of a function whose
// scalar parameters received arrays, while the interpreter runs the paths once per element and
// collects the results in a matrix. Reduced: the result buffering of large matrices
// (FlushBufferOtherThan and the vectors behind it) is left out, results are put into the matrix
// directly, which upstream does for fewer than 128 rows anyway.
import { CreateDoubleError, FormulaError } from '../../../../include/formula/errorcodes.ts';
import type { OpCode } from '../../../../include/formula/opcode.ts';
import type { FormulaToken } from '../../../../formula/source/core/api/token.ts';
import { ScMatrix } from './scmatrix.ts';
import type { ScRefList } from './token.ts';

const SHRT_MAX = 0x7fff;

export type ScTokenVec = FormulaToken[];

/** One element's jump: the condition's value and the path to run (ScJumpMatrixEntry). */
class ScJumpMatrixEntry {
  fBool = 0; // 0:= false  1:= true   also if no-path
  // other values may contain error conditions like NAN and INF
  nStart = 0; // start of path (actually start-1, see formula::FormulaTokenIterator)
  nNext = 0; // next after path
  // jump path exists if nStart != nNext, else no path
  nStop = 0; // optional stop of path (nPC < nStop)

  SetJump(fBool: number, nStart: number, nNext: number, nStop = SHRT_MAX): void {
    this.fBool = fBool;
    this.nStart = nStart;
    this.nNext = nNext;
    this.nStop = nStop;
  }
}

export class ScJumpMatrix {
  private mvJump: ScJumpMatrixEntry[]; // the jumps
  private pMat: ScMatrix; // the results
  private mvRefList: ScRefList = []; // array of references result, if any
  private mvParams: ScTokenVec = []; // parameter stack
  private nCols: number;
  private nRows: number;
  private nCurCol = 0;
  private nCurRow = 0;
  private nResMatCols: number;
  private nResMatRows: number;
  private meOp: OpCode;
  private bStarted = false;

  constructor(eOp: OpCode, nColsP: number, nRowsP: number) {
    this.mvJump = Array.from({ length: nColsP * nRowsP }, () => new ScJumpMatrixEntry());
    // Initialize result matrix in case of
    // a premature end of the interpreter
    // due to errors.
    this.pMat = new ScMatrix(nColsP, nRowsP, CreateDoubleError(FormulaError.NotAvailable));
    this.nCols = nColsP;
    this.nRows = nRowsP;
    this.nResMatCols = nColsP;
    this.nResMatRows = nRowsP;
    this.meOp = eOp;
    /*! pJump not initialized */
  }

  /** Checks if a jump matrix is in effect for the given opcode. */
  GetOpCode(): OpCode { return this.meOp; }

  GetDimensions(): { nCols: number; nRows: number } { return { nCols: this.nCols, nRows: this.nRows }; }

  SetJump(nCol: number, nRow: number, fBool: number, nStart: number, nNext: number): void {
    this.mvJump[nCol * this.nRows + nRow]!.SetJump(fBool, nStart, nNext, SHRT_MAX);
  }

  GetJump(nCol: number, nRow: number): { fBool: number; nStart: number; nNext: number; nStop: number } {
    if (this.nCols === 1 && this.nRows === 1) {
      nCol = 0;
      nRow = 0;
    } else if (this.nCols === 1 && nRow < this.nRows) nCol = 0;
    else if (this.nRows === 1 && nCol < this.nCols) nRow = 0;
    else if (this.nCols <= nCol || this.nRows <= nRow) {
      // ScJumpMatrix::GetJump: dimension error
      nCol = 0;
      nRow = 0;
    }
    const r = this.mvJump[nCol * this.nRows + nRow]!;
    return { fBool: r.fBool, nStart: r.nStart, nNext: r.nNext, nStop: r.nStop };
  }

  SetAllJumps(fBool: number, nStart: number, nNext: number, nStop = SHRT_MAX): void {
    for (const j of this.mvJump) j.SetJump(fBool, nStart, nNext, nStop);
  }

  SetJumpParameters(p: ScTokenVec): void { this.mvParams = p; }
  GetJumpParameters(): ScTokenVec { return this.mvParams; }

  GetPos(): { nC: number; nR: number } { return { nC: this.nCurCol, nR: this.nCurRow }; }

  /** Advance to the next element; false when all are done. */
  Next(): { bCont: boolean; nC: number; nR: number } {
    if (!this.bStarted) {
      this.bStarted = true;
      this.nCurCol = this.nCurRow = 0;
    } else if (++this.nCurRow >= this.nResMatRows) {
      this.nCurRow = 0;
      ++this.nCurCol;
    }
    return { bCont: this.nCurCol < this.nResMatCols, nC: this.nCurCol, nR: this.nCurRow };
  }

  GetResMatDimensions(): { nCols: number; nRows: number } { return { nCols: this.nResMatCols, nRows: this.nResMatRows }; }

  SetNewResMat(nNewCols: number, nNewRows: number): void {
    if (nNewCols <= this.nResMatCols && nNewRows <= this.nResMatRows) return;

    this.pMat = this.pMat.CloneAndExtend(nNewCols, nNewRows);
    if (this.nResMatCols < nNewCols) this.pMat.FillDouble(CreateDoubleError(FormulaError.NotAvailable), this.nResMatCols, 0, nNewCols - 1, this.nResMatRows - 1);
    if (this.nResMatRows < nNewRows) this.pMat.FillDouble(CreateDoubleError(FormulaError.NotAvailable), 0, this.nResMatRows, nNewCols - 1, nNewRows - 1);
    if (this.nRows === 1 && this.nCurCol !== 0) {
      this.nCurCol = 0;
      this.nCurRow = this.nResMatRows - 1;
    }
    this.nResMatCols = nNewCols;
    this.nResMatRows = nNewRows;
  }

  HasResultMatrix(): boolean {
    // We now always have a matrix but caller logic may still want to check it.
    return !!this.pMat;
  }

  GetResultMatrix(): ScMatrix { return this.pMat; }
  GetRefList(): ScRefList { return this.mvRefList; }

  PutResultDouble(fVal: number, nC: number, nR: number): void { this.pMat.PutDouble(fVal, nC, nR); }
  PutResultString(rStr: string, nC: number, nR: number): void { this.pMat.PutString(rStr, nC, nR); }
  PutResultEmpty(nC: number, nR: number): void { this.pMat.PutEmpty(nC, nR); }
  PutResultEmptyPath(nC: number, nR: number): void { this.pMat.PutEmptyPath(nC, nR); }
}
