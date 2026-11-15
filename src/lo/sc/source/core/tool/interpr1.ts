// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/core/tool/interpr1.cxx partial
// The jump functions (IF, IFERROR, IFNA, CHOOSE), the logical functions, the information
// functions (IS*, N, TYPE, ERROR.TYPE, NA). Jump matrices are left out: an array condition uses
// its first element. Further function families are added between the section markers below.
import { FormulaError, GetDoubleErrorValue as GetDoubleErrorValueOf } from '../../../../include/formula/errorcodes.ts';
import * as OC from '../../../../include/formula/opcode.ts';
import { svDouble, svDoubleRef, svEmptyCell, svError, svMatrix, svRefList, svSingleRef, svString, svUnknown, type FormulaToken } from '../../../../formula/source/core/api/token.ts';
import { approxFloor } from '../../../../sal/rtl/math.ts';
import { GetType as NFGetType, SvNumFormatType } from '../../../../svl/source/numbers/zforlist.ts';
import { CELLTYPE_EDIT, CELLTYPE_FORMULA, CELLTYPE_NONE, CELLTYPE_STRING, CELLTYPE_VALUE } from '../../../inc/cellvalue.ts';
import { ScComplexRefData } from '../../../inc/refdata.ts';
import { ScValueIterator } from '../data/dociter.ts';
import { ScInterpreter } from './interpr4.ts';
import { ScDoubleRefToken, ScEmptyCellToken, ScRefListToken, ScSingleRefToken, extendRangeReference, type ScRefList } from './token.ts';

declare module './interpr4.ts' {
  interface ScInterpreter {
    ScIfJump(): void;
    ScIfError(bNAonly: boolean): void;
    ScChooseJump(): void;
    ScAnd(): void;
    ScOr(): void;
    ScXor(): void;
    ScNot(): void;
    ScTrue(): void;
    ScFalse(): void;
    ScIsEmpty(): void;
    IsString(): boolean;
    ScIsString(): void;
    ScIsNonString(): void;
    ScIsLogical(): void;
    ScType(): void;
    ScIsValue(): void;
    ScIsFormula(): void;
    ScIsRef(): void;
    ScIsNV(): void;
    ScIsErr(): void;
    ScIsError(): void;
    IsEven(): boolean;
    ScIsEven(): void;
    ScIsOdd(): void;
    ScN(): void;
    GetErrorType(): FormulaError;
    ScErrorType(): void;
    ScErrorType_ODF(): void;
    GetCellNumberFormat(nCol: number, nRow: number, nTab: number): string;
  }
}

/** Upstream reads the jump table as pJump[0] = count, pJump[1..] = targets. */
function jumps(self: ScInterpreter): { pJump: number[]; nJumpCount: number } {
  const pJump = self.pCur.GetJump();
  return { pJump, nJumpCount: pJump[0]! };
}

/** The condition matrix of an IF/CHOOSE in scalar evaluation: its first element (reduced, no
    jump matrix). */
function matrixConditionToScalar(self: ScInterpreter): void {
  if (self.GetStackType() === svMatrix) {
    const pMat = self.PopMatrix();
    if (!pMat) return;
    const v = pMat.Get(0, 0);
    const nErr = v.GetError();
    if (nErr !== 0) {
      if (pMat.IsValue(0, 0)) {
        self.PushError(nErr);
        return;
      }
    }
    if (pMat.IsValue(0, 0)) self.PushDouble(pMat.GetDouble(0, 0));
    else if (pMat.IsEmpty(0, 0)) self.PushTempToken(new ScEmptyCellToken(false, false));
    else self.PushString(pMat.GetString(0, 0));
  }
}

ScInterpreter.prototype.ScIfJump = function (this: ScInterpreter): void {
  const { pJump, nJumpCount } = jumps(this);
  matrixConditionToScalar(this);
  // ScIfJumpNotMatrix
  const bCondition = this.GetBool();
  if (this.nGlobalError !== FormulaError.NONE) {
    // Propagate error, not THEN- or ELSE-path, jump behind.
    this.PushError(this.nGlobalError);
    this.aCode.Jump(pJump[nJumpCount]!, pJump[nJumpCount]!);
  } else if (bCondition) {
    // TRUE
    if (nJumpCount >= 2) {
      // THEN path
      this.aCode.Jump(pJump[1]!, pJump[nJumpCount]!);
    } else {
      // no parameter given for THEN
      this.nFuncFmtType = SvNumFormatType.LOGICAL;
      this.PushInt(1);
      this.aCode.Jump(pJump[nJumpCount]!, pJump[nJumpCount]!);
    }
  } else {
    // FALSE
    if (nJumpCount === 3) {
      // ELSE path
      this.aCode.Jump(pJump[2]!, pJump[nJumpCount]!);
    } else {
      // no parameter given for ELSE
      this.nFuncFmtType = SvNumFormatType.LOGICAL;
      this.PushInt(0);
      this.aCode.Jump(pJump[nJumpCount]!, pJump[nJumpCount]!);
    }
  }
};

ScInterpreter.prototype.ScIfError = function (this: ScInterpreter, bNAonly: boolean): void {
  const { pJump, nJumpCount } = jumps(this);
  if (!this.sp || nJumpCount !== 2) {
    // Reset nGlobalError here to not propagate the old error, if any.
    this.nGlobalError = this.sp ? FormulaError.ParameterExpected : FormulaError.UnknownStackVariable;
    this.PushError(this.nGlobalError);
    this.aCode.Jump(pJump[nJumpCount]!, pJump[nJumpCount]!);
    return;
  }
  const xToken = this.pStack[this.sp - 1]!;
  let bError = false;
  const nOldGlobalError = this.nGlobalError;
  this.nGlobalError = FormulaError.NONE;
  switch (this.GetStackType()) {
    default:
      this.Pop();
      if (nOldGlobalError !== FormulaError.NONE) this.nGlobalError = nOldGlobalError;
      if (this.nGlobalError !== FormulaError.NONE) bError = true;
      break;
    case svError:
      this.PopError();
      bError = true;
      break;
    case svDoubleRef:
    case svSingleRef: {
      const aAdr = this.PopDoubleRefOrSingleRef();
      if (!aAdr) bError = true;
      else {
        const aCell = this.mrDoc.GetRefCellValue(aAdr);
        this.nGlobalError = this.GetCellErrCode(aCell);
        if (this.nGlobalError !== FormulaError.NONE) bError = true;
      }
      break;
    }
    case svMatrix: {
      // reduced: the first element decides
      const pMat = this.PopMatrix();
      if (!pMat) bError = true;
      else {
        const nErr = pMat.GetErrorIfNotString(0, 0);
        if (nErr !== FormulaError.NONE) {
          this.nGlobalError = nErr;
          bError = true;
        }
      }
      break;
    }
  }
  if (bError && (!bNAonly || this.nGlobalError === FormulaError.NotAvailable)) {
    // error, calculate 2nd argument
    this.nGlobalError = FormulaError.NONE;
    this.aCode.Jump(pJump[1]!, pJump[nJumpCount]!);
  } else {
    // no error, push 1st argument and continue
    this.nGlobalError = nOldGlobalError;
    this.PushTokenRef(xToken);
    this.aCode.Jump(pJump[nJumpCount]!, pJump[nJumpCount]!);
  }
};

ScInterpreter.prototype.ScChooseJump = function (this: ScInterpreter): void {
  const { pJump, nJumpCount } = jumps(this);
  let bHaveJump = false;
  matrixConditionToScalar(this);
  const nJumpIndex = this.GetInt16();
  if (this.nGlobalError === FormulaError.NONE && nJumpIndex >= 1 && nJumpIndex < nJumpCount) {
    this.aCode.Jump(pJump[nJumpIndex]!, pJump[nJumpCount]!);
    bHaveJump = true;
  } else this.PushIllegalArgument();
  if (!bHaveJump) this.aCode.Jump(pJump[nJumpCount]!, pJump[nJumpCount]!);
};

/** AND, OR and XOR share the parameter loop. */
function logicalIterate(self: ScInterpreter, bInit: boolean, combine: (bRes: boolean, b: boolean) => boolean, matValue: (pMat: import('./scmatrix.ts').ScMatrix) => number): void {
  self.nFuncFmtType = SvNumFormatType.LOGICAL;
  let nParamCount = self.GetByte();
  if (!self.MustHaveParamCountMin(nParamCount, 1)) return;
  let bHaveValue = false;
  let bRes = bInit;
  const refState = { nParam: 0, nRefInList: 0 };
  while (nParamCount-- > 0) {
    if (self.nGlobalError === FormulaError.NONE) {
      switch (self.GetStackType()) {
        case svDouble:
          bHaveValue = true;
          bRes = combine(bRes, self.PopDouble() !== 0.0);
          break;
        case svString:
          self.Pop();
          self.SetError(FormulaError.NoValue);
          break;
        case svSingleRef: {
          const aAdr = self.PopSingleRef();
          if (self.nGlobalError === FormulaError.NONE) {
            const aCell = self.mrDoc.GetRefCellValue(aAdr);
            if (aCell.hasNumeric()) {
              bHaveValue = true;
              bRes = combine(bRes, self.GetCellValue(aAdr, aCell) !== 0.0);
            }
            // else: Xcl raises no error here
          }
          break;
        }
        case svDoubleRef:
        case svRefList: {
          refState.nParam = nParamCount;
          const aRange = self.PopDoubleRef(refState);
          nParamCount = refState.nParam;
          if (self.nGlobalError === FormulaError.NONE) {
            let nErr: FormulaError = FormulaError.NONE;
            const aValIter = new ScValueIterator(self.mrDoc, aRange);
            for (const v of aValIter.values()) {
              if (v.nErr !== FormulaError.NONE) {
                nErr = v.nErr;
                break;
              }
              bHaveValue = true;
              bRes = combine(bRes, v.fVal !== 0.0);
            }
            self.SetError(nErr);
          }
          break;
        }
        case svMatrix: {
          const pMat = self.GetMatrix();
          if (pMat) {
            bHaveValue = true;
            const fVal = matValue(pMat);
            const nErr = GetDoubleErrorValueOf(fVal);
            if (nErr !== FormulaError.NONE) {
              self.SetError(nErr);
              bRes = false;
            } else bRes = combine(bRes, fVal !== 0.0);
          }
          // else: GetMatrix did set FormulaError::IllegalParameter
          break;
        }
        default:
          self.PopError();
          self.SetError(FormulaError.IllegalParameter);
      }
    } else self.Pop();
  }
  if (bHaveValue) self.PushInt(bRes ? 1 : 0);
  else self.PushNoValue();
}

ScInterpreter.prototype.ScAnd = function (this: ScInterpreter): void { logicalIterate(this, true, (a, b) => a && b, (m) => m.And()); };
ScInterpreter.prototype.ScOr = function (this: ScInterpreter): void { logicalIterate(this, false, (a, b) => a || b, (m) => m.Or()); };
ScInterpreter.prototype.ScXor = function (this: ScInterpreter): void { logicalIterate(this, false, (a, b) => a !== b, (m) => m.Xor()); };

ScInterpreter.prototype.ScNot = function (this: ScInterpreter): void {
  this.nFuncFmtType = SvNumFormatType.LOGICAL;
  switch (this.GetStackType()) {
    case svMatrix: {
      const pMat = this.GetMatrix();
      if (!pMat) this.PushIllegalParameter();
      else {
        const { nC, nR } = pMat.GetDimensions();
        const pResMat = this.GetNewMat(nC, nR, true);
        pMat.NotOp(pResMat);
        this.PushMatrix(pResMat);
      }
      break;
    }
    default:
      this.PushInt(this.GetDouble() === 0.0 ? 1 : 0);
  }
};

ScInterpreter.prototype.ScTrue = function (this: ScInterpreter): void {
  this.nFuncFmtType = SvNumFormatType.LOGICAL;
  this.PushInt(1);
};

ScInterpreter.prototype.ScFalse = function (this: ScInterpreter): void {
  this.nFuncFmtType = SvNumFormatType.LOGICAL;
  this.PushInt(0);
};

ScInterpreter.prototype.GetCellNumberFormat = function (this: ScInterpreter, nCol: number, nRow: number, nTab: number): string {
  return this.mrDoc.GetNumberFormat(nCol, nRow, nTab);
};

ScInterpreter.prototype.ScIsEmpty = function (this: ScInterpreter): void {
  let nRes = 0;
  this.nFuncFmtType = SvNumFormatType.LOGICAL;
  switch (this.GetRawStackType()) {
    case svEmptyCell: {
      const p = this.PopToken() as ScEmptyCellToken;
      if (!p.IsInherited()) nRes = 1;
      break;
    }
    case svDoubleRef:
    case svSingleRef: {
      const aAdr = this.PopDoubleRefOrSingleRef();
      if (!aAdr) break;
      // NOTE: this differs from COUNTBLANK() ScCountEmptyCells() that
      // may treat ="" in the referenced cell as blank for Excel
      // interoperability.
      const aCell = this.mrDoc.GetRefCellValue(aAdr);
      if (aCell.getType() === CELLTYPE_NONE) nRes = 1;
      break;
    }
    case svMatrix: {
      const pMat = this.GetMatrix();
      if (pMat) nRes = pMat.IsEmptyCell(0, 0) ? 1 : 0;
      break;
    }
    default:
      this.Pop();
  }
  this.nGlobalError = FormulaError.NONE;
  this.PushInt(nRes);
};

ScInterpreter.prototype.IsString = function (this: ScInterpreter): boolean {
  this.nFuncFmtType = SvNumFormatType.LOGICAL;
  let bRes = false;
  switch (this.GetRawStackType()) {
    case svString:
      this.Pop();
      bRes = true;
      break;
    case svDoubleRef:
    case svSingleRef: {
      const aAdr = this.PopDoubleRefOrSingleRef();
      if (!aAdr) break;
      const aCell = this.mrDoc.GetRefCellValue(aAdr);
      if (this.GetCellErrCode(aCell) === FormulaError.NONE) {
        switch (aCell.getType()) {
          case CELLTYPE_STRING:
          case CELLTYPE_EDIT:
            bRes = true;
            break;
          case CELLTYPE_FORMULA:
            bRes = !aCell.getFormula()!.IsValue() && !aCell.getFormula()!.IsEmpty();
            break;
          default:
          // nothing
        }
      }
      break;
    }
    case svMatrix: {
      const pMat = this.GetMatrix();
      if (pMat) bRes = pMat.IsStringOrEmpty(0, 0) && !pMat.IsEmpty(0, 0);
      break;
    }
    default:
      this.Pop();
  }
  this.nGlobalError = FormulaError.NONE;
  return bRes;
};

ScInterpreter.prototype.ScIsString = function (this: ScInterpreter): void { this.PushInt(this.IsString() ? 1 : 0); };
ScInterpreter.prototype.ScIsNonString = function (this: ScInterpreter): void { this.PushInt(this.IsString() ? 0 : 1); };

ScInterpreter.prototype.ScIsLogical = function (this: ScInterpreter): void {
  let bRes = false;
  switch (this.GetStackType()) {
    case svDoubleRef:
    case svSingleRef: {
      const aAdr = this.PopDoubleRefOrSingleRef();
      if (!aAdr) break;
      const aCell = this.mrDoc.GetRefCellValue(aAdr);
      if (this.GetCellErrCode(aCell) === FormulaError.NONE) {
        if (aCell.hasNumeric()) {
          this.GetNumberFormatInfo(aAdr);
          bRes = this.nCurFmtType === SvNumFormatType.LOGICAL;
        }
      }
      break;
    }
    case svMatrix: {
      const r = this.GetDoubleOrStringFromMatrix();
      bRes = r.nType === 0x01; // ScMatValType::Boolean
      break;
    }
    default:
      this.PopError();
      if (this.nGlobalError === FormulaError.NONE) bRes = this.nCurFmtType === SvNumFormatType.LOGICAL;
  }
  this.nCurFmtType = this.nFuncFmtType = SvNumFormatType.LOGICAL;
  this.nGlobalError = FormulaError.NONE;
  this.PushInt(bRes ? 1 : 0);
};

ScInterpreter.prototype.ScType = function (this: ScInterpreter): void {
  let nType = 0;
  switch (this.GetStackType()) {
    case svDoubleRef:
    case svSingleRef: {
      const aAdr = this.PopDoubleRefOrSingleRef();
      if (!aAdr) break;
      const aCell = this.mrDoc.GetRefCellValue(aAdr);
      if (this.GetCellErrCode(aCell) === FormulaError.NONE) {
        switch (aCell.getType()) {
          // NOTE: this is Xcl nonsense!
          case CELLTYPE_STRING:
          case CELLTYPE_EDIT:
            nType = 2;
            break;
          case CELLTYPE_VALUE: {
            const aFormat = this.GetCellNumberFormat(aAdr.Col(), aAdr.Row(), aAdr.Tab());
            if (NFGetType(aFormat, 'en-US') === SvNumFormatType.LOGICAL) nType = 4;
            else nType = 1;
            break;
          }
          case CELLTYPE_NONE:
            // always 1, s. tdf#73078
            nType = 1;
            break;
          case CELLTYPE_FORMULA:
            nType = 8;
            break;
          default:
            this.PushIllegalArgument();
        }
      } else nType = 16;
      break;
    }
    case svString:
      this.PopError();
      if (this.nGlobalError !== FormulaError.NONE) {
        nType = 16;
        this.nGlobalError = FormulaError.NONE;
      } else nType = 2;
      break;
    case svMatrix:
      this.PopMatrix();
      if (this.nGlobalError !== FormulaError.NONE) {
        nType = 16;
        this.nGlobalError = FormulaError.NONE;
      } else nType = 64;
      // we could return the type of one element if in JumpMatrix or
      // ForceArray mode, but Xcl doesn't ...
      break;
    default:
      this.PopError();
      if (this.nGlobalError !== FormulaError.NONE) {
        nType = 16;
        this.nGlobalError = FormulaError.NONE;
      } else nType = 1;
  }
  this.PushInt(nType);
};

ScInterpreter.prototype.ScIsValue = function (this: ScInterpreter): void {
  this.nFuncFmtType = SvNumFormatType.LOGICAL;
  let bRes = false;
  switch (this.GetRawStackType()) {
    case svDouble:
      this.Pop();
      bRes = true;
      break;
    case svDoubleRef:
    case svSingleRef: {
      const aAdr = this.PopDoubleRefOrSingleRef();
      if (!aAdr) break;
      const aCell = this.mrDoc.GetRefCellValue(aAdr);
      if (this.GetCellErrCode(aCell) === FormulaError.NONE) {
        switch (aCell.getType()) {
          case CELLTYPE_VALUE:
            bRes = true;
            break;
          case CELLTYPE_FORMULA:
            bRes = aCell.getFormula()!.IsValue() && !aCell.getFormula()!.IsEmpty();
            break;
          default:
          // nothing
        }
      }
      break;
    }
    case svMatrix: {
      const pMat = this.GetMatrix();
      if (pMat && pMat.GetErrorIfNotString(0, 0) === FormulaError.NONE) bRes = pMat.IsValue(0, 0);
      break;
    }
    default:
      this.Pop();
  }
  this.nGlobalError = FormulaError.NONE;
  this.PushInt(bRes ? 1 : 0);
};

ScInterpreter.prototype.ScIsFormula = function (this: ScInterpreter): void {
  this.nFuncFmtType = SvNumFormatType.LOGICAL;
  let bRes = false;
  switch (this.GetStackType()) {
    case svDoubleRef:
    case svSingleRef: {
      const aAdr = this.PopDoubleRefOrSingleRef();
      if (!aAdr) break;
      bRes = this.mrDoc.GetCellType(aAdr) === CELLTYPE_FORMULA;
      break;
    }
    default:
      this.Pop();
  }
  this.nGlobalError = FormulaError.NONE;
  this.PushInt(bRes ? 1 : 0);
};

ScInterpreter.prototype.ScIsRef = function (this: ScInterpreter): void {
  this.nFuncFmtType = SvNumFormatType.LOGICAL;
  let bRes = false;
  switch (this.GetStackType()) {
    case svSingleRef: {
      this.PopSingleRef();
      if (this.nGlobalError === FormulaError.NONE) bRes = true;
      break;
    }
    case svDoubleRef: {
      this.PopDoubleRef();
      if (this.nGlobalError === FormulaError.NONE) bRes = true;
      break;
    }
    case svRefList: {
      const x = this.PopToken();
      if (this.nGlobalError === FormulaError.NONE) bRes = !!x && (x.GetRefList() as ScRefList).length > 0;
      break;
    }
    default:
      this.Pop();
  }
  this.nGlobalError = FormulaError.NONE;
  this.PushInt(bRes ? 1 : 0);
};

ScInterpreter.prototype.ScIsNV = function (this: ScInterpreter): void {
  this.nFuncFmtType = SvNumFormatType.LOGICAL;
  let bRes = false;
  switch (this.GetStackType()) {
    case svDoubleRef:
    case svSingleRef: {
      const aAdr = this.PopDoubleRefOrSingleRef();
      if (this.nGlobalError === FormulaError.NotAvailable) bRes = true;
      else if (aAdr) {
        const aCell = this.mrDoc.GetRefCellValue(aAdr);
        const nErr = this.GetCellErrCode(aCell);
        bRes = nErr === FormulaError.NotAvailable;
      }
      break;
    }
    case svMatrix: {
      const pMat = this.GetMatrix();
      if (pMat) bRes = pMat.GetErrorIfNotString(0, 0) === FormulaError.NotAvailable;
      break;
    }
    default:
      this.PopError();
      if (this.nGlobalError === FormulaError.NotAvailable) bRes = true;
  }
  this.nGlobalError = FormulaError.NONE;
  this.PushInt(bRes ? 1 : 0);
};

ScInterpreter.prototype.ScIsErr = function (this: ScInterpreter): void {
  this.nFuncFmtType = SvNumFormatType.LOGICAL;
  let bRes = false;
  switch (this.GetStackType()) {
    case svDoubleRef:
    case svSingleRef: {
      const aAdr = this.PopDoubleRefOrSingleRef();
      if (!aAdr || (this.nGlobalError !== FormulaError.NONE && this.nGlobalError !== FormulaError.NotAvailable)) bRes = true;
      else {
        const aCell = this.mrDoc.GetRefCellValue(aAdr);
        const nErr = this.GetCellErrCode(aCell);
        bRes = nErr !== FormulaError.NONE && nErr !== FormulaError.NotAvailable;
      }
      break;
    }
    case svMatrix: {
      const pMat = this.GetMatrix();
      if (this.nGlobalError !== FormulaError.NONE || !pMat) bRes = (this.nGlobalError !== FormulaError.NONE && this.nGlobalError !== FormulaError.NotAvailable) || !pMat;
      else {
        const nErr = pMat.GetErrorIfNotString(0, 0);
        bRes = nErr !== FormulaError.NONE && nErr !== FormulaError.NotAvailable;
      }
      break;
    }
    default:
      this.PopError();
      if (this.nGlobalError !== FormulaError.NONE && this.nGlobalError !== FormulaError.NotAvailable) bRes = true;
  }
  this.nGlobalError = FormulaError.NONE;
  this.PushInt(bRes ? 1 : 0);
};

ScInterpreter.prototype.ScIsError = function (this: ScInterpreter): void {
  this.nFuncFmtType = SvNumFormatType.LOGICAL;
  let bRes = false;
  switch (this.GetStackType()) {
    case svDoubleRef:
    case svSingleRef: {
      const aAdr = this.PopDoubleRefOrSingleRef();
      if (!aAdr) {
        bRes = true;
        break;
      }
      if (this.nGlobalError !== FormulaError.NONE) bRes = true;
      else {
        const aCell = this.mrDoc.GetRefCellValue(aAdr);
        bRes = this.GetCellErrCode(aCell) !== FormulaError.NONE;
      }
      break;
    }
    case svMatrix: {
      const pMat = this.GetMatrix();
      if (this.nGlobalError !== FormulaError.NONE || !pMat) bRes = true;
      else bRes = pMat.GetErrorIfNotString(0, 0) !== FormulaError.NONE;
      break;
    }
    default:
      this.PopError();
      if (this.nGlobalError !== FormulaError.NONE) bRes = true;
  }
  this.nGlobalError = FormulaError.NONE;
  this.PushInt(bRes ? 1 : 0);
};

ScInterpreter.prototype.IsEven = function (this: ScInterpreter): boolean {
  this.nFuncFmtType = SvNumFormatType.LOGICAL;
  let bRes = false;
  let fVal = 0.0;
  switch (this.GetStackType()) {
    case svDoubleRef:
    case svSingleRef: {
      const aAdr = this.PopDoubleRefOrSingleRef();
      if (!aAdr) break;
      const aCell = this.mrDoc.GetRefCellValue(aAdr);
      const nErr = this.GetCellErrCode(aCell);
      if (nErr !== FormulaError.NONE) this.SetError(nErr);
      else {
        switch (aCell.getType()) {
          case CELLTYPE_VALUE:
            fVal = this.GetCellValue(aAdr, aCell);
            bRes = true;
            break;
          case CELLTYPE_FORMULA:
            if (aCell.getFormula()!.IsValue()) {
              fVal = this.GetCellValue(aAdr, aCell);
              bRes = true;
            }
            break;
          default:
          // nothing
        }
      }
      break;
    }
    case svDouble:
      fVal = this.PopDouble();
      bRes = true;
      break;
    case svMatrix: {
      const pMat = this.GetMatrix();
      if (pMat) {
        bRes = pMat.IsValue(0, 0);
        if (bRes) fVal = pMat.GetDouble(0, 0);
      }
      break;
    }
    default:
    // nothing
  }
  if (!bRes) this.SetError(FormulaError.IllegalParameter);
  else bRes = approxFloor(Math.abs(fVal)) % 2.0 < 0.5;
  return bRes;
};

ScInterpreter.prototype.ScIsEven = function (this: ScInterpreter): void { this.PushInt(this.IsEven() ? 1 : 0); };
ScInterpreter.prototype.ScIsOdd = function (this: ScInterpreter): void { this.PushInt(this.IsEven() ? 0 : 1); };

ScInterpreter.prototype.ScN = function (this: ScInterpreter): void {
  const nErr = this.nGlobalError;
  this.nGlobalError = FormulaError.NONE;
  // Temporarily override the ConvertStringToValue() error for
  // GetCellValue() / GetCellValueOrZero()
  const nSErr = this.mnStringNoValueError;
  this.mnStringNoValueError = FormulaError.CellNoValue;
  const fVal = this.GetDouble();
  this.mnStringNoValueError = nSErr;
  if (nErr !== FormulaError.NONE) this.nGlobalError = nErr; // preserve previous error if any
  else if ((this.nGlobalError as FormulaError) === FormulaError.CellNoValue) this.nGlobalError = FormulaError.NONE; // reset temporary detection error
  this.PushDouble(fVal);
};

ScInterpreter.prototype.GetErrorType = function (this: ScInterpreter): FormulaError {
  let nErr: FormulaError;
  const nOldError = this.nGlobalError;
  this.nGlobalError = FormulaError.NONE;
  switch (this.GetStackType()) {
    case svRefList: {
      const x = this.PopToken();
      if (this.nGlobalError !== FormulaError.NONE) nErr = this.nGlobalError;
      else {
        const pRefList = x!.GetRefList() as ScRefList;
        const n = pRefList.length;
        if (!n) nErr = FormulaError.NoRef;
        else if (n > 1) nErr = FormulaError.NoValue;
        else {
          const aRange = this.DoubleRefToRange(pRefList[0]!);
          if (this.nGlobalError !== FormulaError.NONE) nErr = this.nGlobalError;
          else {
            const aAdr = this.DoubleRefToPosSingleRef(aRange);
            nErr = aAdr ? this.mrDoc.GetErrCode(aAdr) : this.nGlobalError;
          }
        }
      }
      break;
    }
    case svDoubleRef: {
      const aRange = this.PopDoubleRef();
      if (this.nGlobalError !== FormulaError.NONE) nErr = this.nGlobalError;
      else {
        const aAdr = this.DoubleRefToPosSingleRef(aRange);
        nErr = aAdr ? this.mrDoc.GetErrCode(aAdr) : this.nGlobalError;
      }
      break;
    }
    case svSingleRef: {
      const aAdr = this.PopSingleRef();
      if (this.nGlobalError !== FormulaError.NONE) nErr = this.nGlobalError;
      else nErr = this.mrDoc.GetErrCode(aAdr);
      break;
    }
    default:
      this.PopError();
      nErr = this.nGlobalError;
  }
  // Return previous error if any, or 0 if none.
  this.nGlobalError = nOldError;
  return nErr;
};

ScInterpreter.prototype.ScErrorType = function (this: ScInterpreter): void {
  const nErr = this.GetErrorType();
  if (nErr !== FormulaError.NONE) {
    this.nGlobalError = FormulaError.NONE;
    this.PushDouble(nErr);
  } else this.PushNA();
};

ScInterpreter.prototype.ScErrorType_ODF = function (this: ScInterpreter): void {
  const nErr = this.GetErrorType();
  let nErrType: number;
  switch (nErr) {
    case FormulaError.NoCode: // #NULL!
      nErrType = 1;
      break;
    case FormulaError.DivisionByZero: // #DIV/0!
      nErrType = 2;
      break;
    case FormulaError.NoValue: // #VALUE!
      nErrType = 3;
      break;
    case FormulaError.NoRef: // #REF!
      nErrType = 4;
      break;
    case FormulaError.NoName: // #NAME?
      nErrType = 5;
      break;
    case FormulaError.IllegalFPOperation: // #NUM!
      nErrType = 6;
      break;
    case FormulaError.NotAvailable: // #N/A
      nErrType = 7;
      break;
    default:
      nErrType = 0;
      break;
  }
  if (nErrType) {
    this.nGlobalError = FormulaError.NONE;
    this.PushDouble(nErrType);
  } else this.PushNA();
};

// @@ MATH (trigonometry, logarithms, PI, RAND, ...) @@

// @@ TEXT @@

// @@ LOOKUP (lookup and reference functions) @@

// @@ CRITERIA (COUNTIF/SUMIF/AVERAGEIF(S), MINIFS/MAXIFS, COUNTBLANK) @@

// @@ MINMAX (MIN, MAX, MINA, MAXA, SUBTOTAL, AGGREGATE) @@

// @@ STATISTICS (VAR, STDEV and friends kept in interpr1.cxx) @@

ScInterpreter.Register(OC.ocIf, ScInterpreter.prototype.ScIfJump);
ScInterpreter.Register(OC.ocIfError, function (this: ScInterpreter) { this.ScIfError(false); });
ScInterpreter.Register(OC.ocIfNA, function (this: ScInterpreter) { this.ScIfError(true); });
ScInterpreter.Register(OC.ocChoose, ScInterpreter.prototype.ScChooseJump);
ScInterpreter.Register(OC.ocAnd, ScInterpreter.prototype.ScAnd);
ScInterpreter.Register(OC.ocOr, ScInterpreter.prototype.ScOr);
ScInterpreter.Register(OC.ocXor, ScInterpreter.prototype.ScXor);
ScInterpreter.Register(OC.ocNot, ScInterpreter.prototype.ScNot);
ScInterpreter.Register(OC.ocTrue, ScInterpreter.prototype.ScTrue);
ScInterpreter.Register(OC.ocFalse, ScInterpreter.prototype.ScFalse);
ScInterpreter.Register(OC.ocIsEmpty, ScInterpreter.prototype.ScIsEmpty);
ScInterpreter.Register(OC.ocIsString, ScInterpreter.prototype.ScIsString);
ScInterpreter.Register(OC.ocIsNonString, ScInterpreter.prototype.ScIsNonString);
ScInterpreter.Register(OC.ocIsLogical, ScInterpreter.prototype.ScIsLogical);
ScInterpreter.Register(OC.ocType, ScInterpreter.prototype.ScType);
ScInterpreter.Register(OC.ocIsValue, ScInterpreter.prototype.ScIsValue);
ScInterpreter.Register(OC.ocIsFormula, ScInterpreter.prototype.ScIsFormula);
ScInterpreter.Register(OC.ocIsRef, ScInterpreter.prototype.ScIsRef);
ScInterpreter.Register(OC.ocIsNA, ScInterpreter.prototype.ScIsNV);
ScInterpreter.Register(OC.ocIsErr, ScInterpreter.prototype.ScIsErr);
ScInterpreter.Register(OC.ocIsError, ScInterpreter.prototype.ScIsError);
ScInterpreter.Register(OC.ocIsEven, ScInterpreter.prototype.ScIsEven);
ScInterpreter.Register(OC.ocIsOdd, ScInterpreter.prototype.ScIsOdd);
ScInterpreter.Register(OC.ocN, ScInterpreter.prototype.ScN);
ScInterpreter.Register(OC.ocErrorType, ScInterpreter.prototype.ScErrorType);
ScInterpreter.Register(OC.ocErrorType_ODF, ScInterpreter.prototype.ScErrorType_ODF);
ScInterpreter.Register(OC.ocNotAvail, function (this: ScInterpreter) { this.PushError(FormulaError.NotAvailable); });
ScInterpreter.Register(OC.ocMissing, ScInterpreter.prototype.ScMissing);
