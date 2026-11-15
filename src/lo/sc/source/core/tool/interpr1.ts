// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/core/tool/interpr1.cxx partial
// The jump functions (IF, IFERROR, IFNA, CHOOSE), the logical functions, the information
// functions (IS*, N, TYPE, ERROR.TYPE, NA). Jump matrices are left out: an array condition uses
// its first element. Further function families are added between the section markers below.
import { FormulaError, GetDoubleErrorValue as GetDoubleErrorValueOf } from '../../../../include/formula/errorcodes.ts';
import * as OC from '../../../../include/formula/opcode.ts';
import { svDouble, svDoubleRef, svEmptyCell, svError, svMatrix, svRefList, svSingleRef, svString, svUnknown, type FormulaToken } from '../../../../formula/source/core/api/token.ts';
import { approxFloor } from '../../../../sal/rtl/math.ts';
import { acosh as rtl_math_acosh, asinh as rtl_math_asinh, cos as rtl_math_cos, round as rtl_math_round, rtl_math_RoundingMode as eMathRoundingMode, sin as rtl_math_sin, tan as rtl_math_tan } from '../../../../sal/rtl/math.ts';
import { GetType as NFGetType, SvNumFormatType } from '../../../../svl/source/numbers/zforlist.ts';
import { CELLTYPE_EDIT, CELLTYPE_FORMULA, CELLTYPE_NONE, CELLTYPE_STRING, CELLTYPE_VALUE } from '../../../inc/cellvalue.ts';
import { ScComplexRefData } from '../../../inc/refdata.ts';
import { ScValueIterator } from '../data/dociter.ts';
import { SubtotalFlags } from '../../../inc/global.ts';
import type { OpCode } from '../../../../include/formula/opcode.ts';
import { ScInterpreter } from './interpr4.ts';
import { CreateDoubleError } from '../../../../include/formula/errorcodes.ts';
import { svExternalDoubleRef, svExternalSingleRef } from '../../../../formula/source/core/api/token.ts';
import { approxSub } from '../../../../sal/rtl/math.ts';
import { svMissing } from '../../../../formula/source/core/api/token.ts';
import { stringToDouble, rtl_math_ConversionStatus } from '../../../../sal/rtl/math.ts';
import { GenerateFormat, GetFormatSpecialInfo, GetOutputString, GetStandardFormat, IsNumberFormat as NFIsNumberFormat, GetFormat as NFGetFormat } from '../../../../svl/source/numbers/zforlist.ts';
import { SearchParam, TextSearch, SearchType as utlSearchType } from '../../../../unotools/source/i18n/textsearch.ts';
import type { ScDocument } from '../data/document.ts';
import { ScMatValType, ScMatrix } from './scmatrix.ts';
import { ScDoubleRefToken, ScEmptyCellToken, ScRefListToken, ScSingleRefToken, extendRangeReference, type ScRefList } from './token.ts';
// LOOKUP and CRITERIA sections:
import { FormulaGrammar } from '../../../../include/formula/grammar.ts';
import { ConvertDoubleRef, ConvertSingleRef, FindUnquoted, ScAddress, ScAddressDetails, ScRange, ScRefAddress, ScRefFlags, SCSIZE_MAX, type SCCOL, type SCROW, type SCTAB } from '../../../inc/address.ts';
import { ScQueryOp } from '../../../inc/global.ts';
import { ScQueryEntry, type ScQueryEntryItem } from '../../../inc/queryentry.ts';
import { ScQueryParam } from '../../../inc/queryparam.ts';
import { div as sc_div } from '../../../inc/math.ts';
import { GetCollator, getDataIgnoreCase } from '../data/queryevaluator.ts';
import { LookupSearchMode, ScCountIfCellIterator, ScQueryCellIterator } from '../data/queryiter.ts';
import { CheckTabQuotes, GetDocTabPos } from './compiler.ts';
import { KahanSum } from './kahan.ts';
import { ScRangeStringConverter } from './rangeutl.ts';
import { approxEqual as rtl_math_approxEqual } from '../../../../sal/rtl/math.ts';
import { CreateDoubleError as CreateDoubleErrorOf } from '../../../../include/formula/errorcodes.ts';
import { ScCellIterator as ScCellIteratorOf } from '../data/dociter.ts';
import { ScSingleRefData as ScSingleRefDataOf } from '../../../inc/refdata.ts';

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

// --- math (trigonometry, logarithms, PI, RAND, bit operations) ----------------------------------
// The random generator is Math.random() (upstream: the interpreter context's std::mt19937); a
// jump matrix never gives RAND its dimensions (there are none in this port).

declare module './interpr4.ts' {
  interface ScInterpreter {
    ScBitAnd(): void;
    ScBitOr(): void;
    ScBitXor(): void;
    ScBitLshift(): void;
    ScBitRshift(): void;
    ScPi(): void;
    ScRandomImpl(RandomFunc: (fFirst: number, fLast: number) => number, fFirst: number, fLast: number): void;
    ScRandom(): void;
    ScRandArray(): void;
    ScRandbetween(): void;
    ScDeg(): void;
    ScRad(): void;
    ScSin(): void;
    ScCos(): void;
    ScTan(): void;
    ScCot(): void;
    ScArcSin(): void;
    ScArcCos(): void;
    ScArcTan(): void;
    ScArcCot(): void;
    ScSinHyp(): void;
    ScCosHyp(): void;
    ScTanHyp(): void;
    ScCotHyp(): void;
    ScArcSinHyp(): void;
    ScArcCosHyp(): void;
    ScArcTanHyp(): void;
    ScArcCotHyp(): void;
    ScCosecant(): void;
    ScSecant(): void;
    ScCosecantHyp(): void;
    ScSecantHyp(): void;
    ScExp(): void;
    ScSqrt(): void;
  }
}

const n2power48 = 281474976710656; // 2^48
const M_PI_2 = Math.PI / 2;

/** basegfx::deg2rad: divide first, to get exact values for v being a multiple of 90 degrees. */
function deg2rad(v: number): number { return (v / 90.0) * M_PI_2; }
/** basegfx::rad2deg: divide first, to get exact values for v being a multiple of pi/2. */
function rad2deg(v: number): number { return (v / M_PI_2) * 90.0; }

/** std::nextafter */
function nextafter(x: number, y: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  if (x === y) return y;
  if (x === 0) return y > 0 ? Number.MIN_VALUE : -Number.MIN_VALUE;
  const b = new DataView(new ArrayBuffer(8));
  b.setFloat64(0, x);
  let n = b.getBigUint64(0);
  if (y > x === x > 0) n += 1n;
  else n -= 1n;
  b.setBigUint64(0, n);
  return b.getFloat64(0);
}

/** std::uniform_real_distribution<double>(fFirst, fLast) of the interpreter's generator. */
function uniform_real_distribution(fFirst: number, fLast: number): number {
  return fFirst + (fLast - fFirst) * Math.random();
}

ScInterpreter.prototype.ScBitAnd = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 2)) return;

  const num1 = approxFloor(this.GetDouble());
  const num2 = approxFloor(this.GetDouble());
  if (num1 >= n2power48 || num1 < 0 || num2 >= n2power48 || num2 < 0) this.PushIllegalArgument();
  else this.PushDouble(Number(BigInt(num1) & BigInt(num2)));
};

ScInterpreter.prototype.ScBitOr = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 2)) return;

  const num1 = approxFloor(this.GetDouble());
  const num2 = approxFloor(this.GetDouble());
  if (num1 >= n2power48 || num1 < 0 || num2 >= n2power48 || num2 < 0) this.PushIllegalArgument();
  else this.PushDouble(Number(BigInt(num1) | BigInt(num2)));
};

ScInterpreter.prototype.ScBitXor = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 2)) return;

  const num1 = approxFloor(this.GetDouble());
  const num2 = approxFloor(this.GetDouble());
  if (num1 >= n2power48 || num1 < 0 || num2 >= n2power48 || num2 < 0) this.PushIllegalArgument();
  else this.PushDouble(Number(BigInt(num1) ^ BigInt(num2)));
};

ScInterpreter.prototype.ScBitLshift = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 2)) return;

  const fShift = approxFloor(this.GetDouble());
  const num = approxFloor(this.GetDouble());
  if (num >= n2power48 || num < 0) this.PushIllegalArgument();
  else {
    let fRes: number;
    if (fShift < 0) fRes = approxFloor(num / Math.pow(2.0, -fShift));
    else if (fShift === 0) fRes = num;
    else fRes = num * Math.pow(2.0, fShift);
    this.PushDouble(fRes);
  }
};

ScInterpreter.prototype.ScBitRshift = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 2)) return;

  const fShift = approxFloor(this.GetDouble());
  const num = approxFloor(this.GetDouble());
  if (num >= n2power48 || num < 0) this.PushIllegalArgument();
  else {
    let fRes: number;
    if (fShift < 0) fRes = num * Math.pow(2.0, -fShift);
    else if (fShift === 0) fRes = num;
    else fRes = approxFloor(num / Math.pow(2.0, fShift));
    this.PushDouble(fRes);
  }
};

ScInterpreter.prototype.ScPi = function (this: ScInterpreter): void {
  this.PushDouble(Math.PI);
};

ScInterpreter.prototype.ScRandomImpl = function (this: ScInterpreter, RandomFunc: (fFirst: number, fLast: number) => number, fFirst: number, fLast: number): void {
  if (this.bMatrixFormula) {
    let nCols = 0;
    let nRows = 0;
    // In JumpMatrix context use its dimensions for the return matrix; the
    // formula cell range selected may differ, for example if the result is
    // to be transposed. (No jump matrices in this port.)
    if (this.pMyFormulaCell) ({ nCols, nRows } = this.pMyFormulaCell.GetMatColsRows());

    if (nCols === 1 && nRows === 1) {
      // For compatibility with existing
      // com.sun.star.sheet.FunctionAccess.callFunction() calls that per
      // default are executed in array context unless
      // FA.setPropertyValue("IsArrayFunction",False) was set, return a
      // scalar double instead of a 1x1 matrix object. tdf#128218
      this.PushDouble(RandomFunc(fFirst, fLast));
      return;
    }

    // ScViewFunc::EnterMatrix() might be asking for
    // ScFormulaCell::GetResultDimensions(), which here are none so create
    // a 1x1 matrix at least which exactly is the case when EnterMatrix()
    // asks for a not selected range.
    if (nCols === 0) nCols = 1;
    if (nRows === 0) nRows = 1;
    const pResMat = this.GetNewMat(nCols, nRows, /*bEmpty*/ true);
    for (let i = 0; i < nCols; ++i) {
      for (let j = 0; j < nRows; ++j) pResMat.PutDouble(RandomFunc(fFirst, fLast), i, j);
    }
    this.PushMatrix(pResMat);
  } else this.PushDouble(RandomFunc(fFirst, fLast));
};

ScInterpreter.prototype.ScRandom = function (this: ScInterpreter): void {
  const RandomFunc = (): number => uniform_real_distribution(0.0, 1.0);
  this.ScRandomImpl(RandomFunc, 0.0, 0.0);
};

ScInterpreter.prototype.ScRandArray = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  // optional 5th para:
  // TRUE for a whole number
  // FALSE for a decimal number - default.
  let bWholeNumber = false;
  if (nParamCount === 5) bWholeNumber = this.GetBoolWithDefault(false);

  // optional 4th para: The maximum value of the random numbers
  let fMax = 1.0;
  if (nParamCount >= 4) fMax = this.GetDoubleWithDefault(1.0);

  // optional 3rd para: The minimum value of the random numbers
  let fMin = 0.0;
  if (nParamCount >= 3) fMin = this.GetDoubleWithDefault(0.0);

  // optional 2nd para: The number of columns of the return array
  let nCols = 1;
  if (nParamCount >= 2) nCols = this.GetInt32WithDefault(1);

  // optional 1st para: The number of rows of the return array
  let nRows = 1;
  if (nParamCount >= 1) nRows = this.GetInt32WithDefault(1);

  if (bWholeNumber) {
    fMax = rtl_math_round(fMax, 0, eMathRoundingMode.Up);
    fMin = rtl_math_round(fMin, 0, eMathRoundingMode.Up);
  }

  if (this.nGlobalError !== FormulaError.NONE || fMin > fMax || nCols <= 0 || nRows <= 0) {
    this.PushIllegalArgument();
    return;
  }

  if (bWholeNumber) fMax = nextafter(fMax + 1, -Number.MAX_VALUE);
  else fMax = nextafter(fMax, Number.MAX_VALUE);

  const RandomFunc = (fFirst: number, fLast: number, bWholeNum: boolean): number => {
    if (bWholeNum) return Math.floor(uniform_real_distribution(fFirst, fLast));
    return uniform_real_distribution(fFirst, fLast);
  };

  if (nCols === 1 && nRows === 1) {
    this.PushDouble(RandomFunc(fMin, fMax, bWholeNumber));
    return;
  }

  if (nCols * nRows > 64 * 1024 * 1024) {
    this.PushError(FormulaError.MatrixSize);
    return;
  }
  const pResMat = this.GetNewMat(nCols, nRows, /*bEmpty*/ true);
  for (let i = 0; i < nCols; ++i) {
    for (let j = 0; j < nRows; ++j) pResMat.PutDouble(RandomFunc(fMin, fMax, bWholeNumber), i, j);
  }
  this.PushMatrix(pResMat);
};

ScInterpreter.prototype.ScRandbetween = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 2)) return;

  // Same like scaddins/source/analysis/analysis.cxx
  // AnalysisAddIn::getRandbetween()
  let fMax = rtl_math_round(this.GetDouble(), 0, eMathRoundingMode.Up);
  const fMin = rtl_math_round(this.GetDouble(), 0, eMathRoundingMode.Up);
  if (this.nGlobalError !== FormulaError.NONE || fMin > fMax) {
    this.PushIllegalArgument();
    return;
  }
  fMax = nextafter(fMax + 1, -Number.MAX_VALUE);
  const RandomFunc = (fFirst: number, fLast: number): number => Math.floor(uniform_real_distribution(fFirst, fLast));
  this.ScRandomImpl(RandomFunc, fMin, fMax);
};

ScInterpreter.prototype.ScDeg = function (this: ScInterpreter): void {
  this.PushDouble(rad2deg(this.GetDouble()));
};

ScInterpreter.prototype.ScRad = function (this: ScInterpreter): void {
  this.PushDouble(deg2rad(this.GetDouble()));
};

ScInterpreter.prototype.ScSin = function (this: ScInterpreter): void {
  this.PushDouble(rtl_math_sin(this.GetDouble()));
};

ScInterpreter.prototype.ScCos = function (this: ScInterpreter): void {
  this.PushDouble(rtl_math_cos(this.GetDouble()));
};

ScInterpreter.prototype.ScTan = function (this: ScInterpreter): void {
  this.PushDouble(rtl_math_tan(this.GetDouble()));
};

ScInterpreter.prototype.ScCot = function (this: ScInterpreter): void {
  this.PushDouble(1.0 / rtl_math_tan(this.GetDouble()));
};

ScInterpreter.prototype.ScArcSin = function (this: ScInterpreter): void {
  this.PushDouble(Math.asin(this.GetDouble()));
};

ScInterpreter.prototype.ScArcCos = function (this: ScInterpreter): void {
  this.PushDouble(Math.acos(this.GetDouble()));
};

ScInterpreter.prototype.ScArcTan = function (this: ScInterpreter): void {
  this.PushDouble(Math.atan(this.GetDouble()));
};

ScInterpreter.prototype.ScArcCot = function (this: ScInterpreter): void {
  this.PushDouble(M_PI_2 - Math.atan(this.GetDouble()));
};

ScInterpreter.prototype.ScSinHyp = function (this: ScInterpreter): void {
  this.PushDouble(Math.sinh(this.GetDouble()));
};

ScInterpreter.prototype.ScCosHyp = function (this: ScInterpreter): void {
  this.PushDouble(Math.cosh(this.GetDouble()));
};

ScInterpreter.prototype.ScTanHyp = function (this: ScInterpreter): void {
  this.PushDouble(Math.tanh(this.GetDouble()));
};

ScInterpreter.prototype.ScCotHyp = function (this: ScInterpreter): void {
  this.PushDouble(1.0 / Math.tanh(this.GetDouble()));
};

ScInterpreter.prototype.ScArcSinHyp = function (this: ScInterpreter): void {
  this.PushDouble(rtl_math_asinh(this.GetDouble()));
};

ScInterpreter.prototype.ScArcCosHyp = function (this: ScInterpreter): void {
  const fVal = this.GetDouble();
  if (fVal < 1.0) this.PushIllegalArgument();
  else this.PushDouble(rtl_math_acosh(fVal));
};

ScInterpreter.prototype.ScArcTanHyp = function (this: ScInterpreter): void {
  const fVal = this.GetDouble();
  if (Math.abs(fVal) >= 1.0) this.PushIllegalArgument();
  else this.PushDouble(Math.atanh(fVal));
};

ScInterpreter.prototype.ScArcCotHyp = function (this: ScInterpreter): void {
  const nVal = this.GetDouble();
  if (Math.abs(nVal) <= 1.0) this.PushIllegalArgument();
  else this.PushDouble(0.5 * Math.log((nVal + 1.0) / (nVal - 1.0)));
};

ScInterpreter.prototype.ScCosecant = function (this: ScInterpreter): void {
  this.PushDouble(1.0 / rtl_math_sin(this.GetDouble()));
};

ScInterpreter.prototype.ScSecant = function (this: ScInterpreter): void {
  this.PushDouble(1.0 / rtl_math_cos(this.GetDouble()));
};

ScInterpreter.prototype.ScCosecantHyp = function (this: ScInterpreter): void {
  this.PushDouble(1.0 / Math.sinh(this.GetDouble()));
};

ScInterpreter.prototype.ScSecantHyp = function (this: ScInterpreter): void {
  this.PushDouble(1.0 / Math.cosh(this.GetDouble()));
};

ScInterpreter.prototype.ScExp = function (this: ScInterpreter): void {
  this.PushDouble(Math.exp(this.GetDouble()));
};

ScInterpreter.prototype.ScSqrt = function (this: ScInterpreter): void {
  const fVal = this.GetDouble();
  if (fVal >= 0.0) this.PushDouble(Math.sqrt(fVal));
  else this.PushIllegalArgument();
};

ScInterpreter.Register(OC.ocBitAnd, ScInterpreter.prototype.ScBitAnd);
ScInterpreter.Register(OC.ocBitOr, ScInterpreter.prototype.ScBitOr);
ScInterpreter.Register(OC.ocBitXor, ScInterpreter.prototype.ScBitXor);
ScInterpreter.Register(OC.ocBitLshift, ScInterpreter.prototype.ScBitLshift);
ScInterpreter.Register(OC.ocBitRshift, ScInterpreter.prototype.ScBitRshift);
ScInterpreter.Register(OC.ocPi, ScInterpreter.prototype.ScPi);
ScInterpreter.Register(OC.ocRandom, ScInterpreter.prototype.ScRandom);
ScInterpreter.Register(OC.ocRandArray, ScInterpreter.prototype.ScRandArray);
ScInterpreter.Register(OC.ocRandomNV, ScInterpreter.prototype.ScRandom);
ScInterpreter.Register(OC.ocRandbetweenNV, ScInterpreter.prototype.ScRandbetween);
ScInterpreter.Register(OC.ocDeg, ScInterpreter.prototype.ScDeg);
ScInterpreter.Register(OC.ocRad, ScInterpreter.prototype.ScRad);
ScInterpreter.Register(OC.ocSin, ScInterpreter.prototype.ScSin);
ScInterpreter.Register(OC.ocCos, ScInterpreter.prototype.ScCos);
ScInterpreter.Register(OC.ocTan, ScInterpreter.prototype.ScTan);
ScInterpreter.Register(OC.ocCot, ScInterpreter.prototype.ScCot);
ScInterpreter.Register(OC.ocArcSin, ScInterpreter.prototype.ScArcSin);
ScInterpreter.Register(OC.ocArcCos, ScInterpreter.prototype.ScArcCos);
ScInterpreter.Register(OC.ocArcTan, ScInterpreter.prototype.ScArcTan);
ScInterpreter.Register(OC.ocArcCot, ScInterpreter.prototype.ScArcCot);
ScInterpreter.Register(OC.ocSinHyp, ScInterpreter.prototype.ScSinHyp);
ScInterpreter.Register(OC.ocCosHyp, ScInterpreter.prototype.ScCosHyp);
ScInterpreter.Register(OC.ocTanHyp, ScInterpreter.prototype.ScTanHyp);
ScInterpreter.Register(OC.ocCotHyp, ScInterpreter.prototype.ScCotHyp);
ScInterpreter.Register(OC.ocArcSinHyp, ScInterpreter.prototype.ScArcSinHyp);
ScInterpreter.Register(OC.ocArcCosHyp, ScInterpreter.prototype.ScArcCosHyp);
ScInterpreter.Register(OC.ocArcTanHyp, ScInterpreter.prototype.ScArcTanHyp);
ScInterpreter.Register(OC.ocArcCotHyp, ScInterpreter.prototype.ScArcCotHyp);
ScInterpreter.Register(OC.ocCosecant, ScInterpreter.prototype.ScCosecant);
ScInterpreter.Register(OC.ocSecant, ScInterpreter.prototype.ScSecant);
ScInterpreter.Register(OC.ocCosecantHyp, ScInterpreter.prototype.ScCosecantHyp);
ScInterpreter.Register(OC.ocSecantHyp, ScInterpreter.prototype.ScSecantHyp);
ScInterpreter.Register(OC.ocExp, ScInterpreter.prototype.ScExp);
ScInterpreter.Register(OC.ocSqrt, ScInterpreter.prototype.ScSqrt);

// @@ MATH (trigonometry, logarithms, PI, RAND, ...) @@

// --- text functions --------------------------------------------------------------------------------
// TRIM, UPPER, PROPER, LOWER, LEN, T, VALUE, NUMBERVALUE, CLEAN, CODE, CHAR, UNICODE, UNICHAR,
// DOLLAR, REPLACE, FIXED, FIND, EXACT, LEFT, RIGHT, MID, the byte variants (LENB, LEFTB, RIGHTB,
// MIDB, REPLACEB, FINDB, SEARCHB), SEARCH, REGEX, TEXT, SUBSTITUTE, REPT, CONCATENATE,
// TEXTBEFORE, TEXTAFTER and TEXTSPLIT. Reduced: the locale is en-US (ScGlobal::eLnge, the
// character classification); CODE and CHAR use Windows-1252 as the "thread text encoding";
// REGEX runs on JavaScript's RegExp instead of ICU's RegexMatcher (no step limit, ICU-only syntax
// such as (?w) or possessive quantifiers is not available); number format codes cannot be
// invalid (svl's reduced scanner accepts anything), so TEXT, FIXED and DOLLAR never fail on the
// code. Left out: JIS, ASC (the fullwidth/halfwidth transliteration) and BAHTTEXT.

declare module './interpr4.ts' {
  interface ScInterpreter {
    GetStringPositionArgument(): number;
    DetectSearchType(rStr: string, rDoc: ScDocument): utlSearchType;
    ScTrim(): void;
    ScUpper(): void;
    ScProper(): void;
    ScLower(): void;
    ScLen(): void;
    ScT(): void;
    ScValue(): void;
    ScNumberValue(): void;
    ScClean(): void;
    ScCode(): void;
    ScChar(): void;
    ScUnicode(): void;
    ScUnichar(): void;
    ScCurrency(): void;
    ScReplace(): void;
    ScFixed(): void;
    ScFind(): void;
    ScExact(): void;
    ScLeft(): void;
    ScLenB(): void;
    ScRightB(): void;
    ScLeftB(): void;
    ScMidB(): void;
    ScReplaceB(): void;
    ScFindB(): void;
    ScSearchB(): void;
    ScRight(): void;
    ScSearch(): void;
    ScRegex(): void;
    ScMid(): void;
    ScText(): void;
    ScSubstitute(): void;
    ScRept(): void;
    ScConcat(): void;
    ScTextAfter(): void;
    ScTextBefore(): void;
    ScTextBeforeOrAfter(bBefore: boolean): void;
    ScTextSplit(): void;
  }
}

/** interpre.hxx: the maximum length of a string result. */
export const kScInterpreterMaxStrLen = Math.trunc(0x7fffffff / 8);

/** ScInterpreter::CheckStringPositionArgument (interpre.hxx): fVal clamped, and whether it was valid. */
function CheckStringPositionArgument(fVal: number): { bOk: boolean; fVal: number } {
  if (!Number.isFinite(fVal)) return { bOk: false, fVal: -1.0 };
  else if (fVal < 0.0) return { bOk: false, fVal: 0.0 };
  else if (fVal > 2147483647) return { bOk: false, fVal: 2147483647 };
  return { bOk: true, fVal };
}

// interpre.hxx
ScInterpreter.prototype.GetStringPositionArgument = function (this: ScInterpreter): number {
  let fVal = approxFloor(this.GetDouble());
  const r = CheckStringPositionArgument(fVal);
  fVal = r.fVal;
  if (!r.bOk) {
    fVal = -1.0;
    this.SetError(FormulaError.IllegalArgument);
  }
  return Math.trunc(fVal);
};

/** OUString::iterateCodePoints: the index after (nIncrement 1) or before (-1) the code point at nIdx. */
function iterateCodePoints(s: string, nIdx: number, nIncrement = 1): number {
  if (nIncrement > 0) {
    const c = s.charCodeAt(nIdx);
    if (c >= 0xd800 && c <= 0xdbff && nIdx + 1 < s.length) {
      const d = s.charCodeAt(nIdx + 1);
      if (d >= 0xdc00 && d <= 0xdfff) return nIdx + 2;
    }
    return nIdx + 1;
  }
  const c = s.charCodeAt(nIdx - 1);
  if (c >= 0xdc00 && c <= 0xdfff && nIdx - 2 >= 0) {
    const d = s.charCodeAt(nIdx - 2);
    if (d >= 0xd800 && d <= 0xdbff) return nIdx - 2;
  }
  return nIdx - 1;
}

/** OUString::indexOf: an empty substring is never found. */
function OUString_indexOf(s: string, sub: string, nFrom = 0): number {
  return sub ? s.indexOf(sub, nFrom) : -1;
}

/** comphelper::string::strip */
function strip(rIn: string, c: string): string {
  let a = 0, b = rIn.length;
  while (a < b && rIn[a] === c) ++a;
  while (b > a && rIn[b - 1] === c) --b;
  return rIn.slice(a, b);
}

/** CharClass::uppercase / lowercase / isLetter of ScGlobal::getCharClass() (en-US). */
const CharClass_uppercase = (s: string): string => s.toLocaleUpperCase('en-US');
const CharClass_lowercase = (s: string): string => s.toLocaleLowerCase('en-US');
const CharClass_isLetter = (s: string, nPos: number): boolean => /\p{L}/u.test(s[nPos] ?? '');

ScInterpreter.prototype.ScTrim = function (this: ScInterpreter): void {
  // Doesn't only trim but also removes duplicated blanks within!
  const aVal = strip(this.GetString(), ' ');
  let aStr = '';
  for (let p = 0; p < aVal.length; p++) {
    if (aVal[p] !== ' ' || aVal[p - 1] !== ' ') // first can't be ' ', so -1 is fine
      aStr += aVal[p];
  }
  this.PushString(aStr);
};

ScInterpreter.prototype.ScUpper = function (this: ScInterpreter): void {
  const aString = CharClass_uppercase(this.GetString());
  this.PushString(aString);
};

ScInterpreter.prototype.ScProper = function (this: ScInterpreter): void {
  //2do: what to do with I18N-CJK ?!?
  const aStr = [...this.GetString().split('')];
  const nLen = aStr.length;
  if (nLen > 0) {
    const aUpr = CharClass_uppercase(aStr.join(''));
    const aLwr = CharClass_lowercase(aStr.join(''));
    aStr[0] = aUpr[0] ?? aStr[0]!;
    let nPos = 1;
    while (nPos < nLen) {
      const aTmpStr = aStr[nPos - 1]!;
      if (!CharClass_isLetter(aTmpStr, 0)) aStr[nPos] = aUpr[nPos] ?? aStr[nPos]!;
      else aStr[nPos] = aLwr[nPos] ?? aStr[nPos]!;
      ++nPos;
    }
  }
  this.PushString(aStr.join(''));
};

ScInterpreter.prototype.ScLower = function (this: ScInterpreter): void {
  const aString = CharClass_lowercase(this.GetString());
  this.PushString(aString);
};

ScInterpreter.prototype.ScLen = function (this: ScInterpreter): void {
  const aStr = this.GetString();
  let nIdx = 0;
  let nCnt = 0;
  while (nIdx < aStr.length) {
    nIdx = iterateCodePoints(aStr, nIdx);
    ++nCnt;
  }
  this.PushDouble(nCnt);
};

ScInterpreter.prototype.ScT = function (this: ScInterpreter): void {
  switch (this.GetStackType()) {
    case svDoubleRef:
    case svSingleRef: {
      const aAdr = this.PopDoubleRefOrSingleRef();
      if (!aAdr) {
        this.PushInt(0);
        return;
      }
      let bValue = false;
      const aCell = this.mrDoc.GetRefCellValue(aAdr);
      if (this.GetCellErrCode(aCell) === FormulaError.NONE) {
        switch (aCell.getType()) {
          case CELLTYPE_VALUE:
            bValue = true;
            break;
          case CELLTYPE_FORMULA:
            bValue = aCell.getFormula()!.IsValue();
            break;
          default:
          // nothing
        }
      }
      if (bValue) this.PushString('');
      else {
        // like GetString()
        const aStr = this.GetCellString(aCell);
        this.PushString(aStr);
      }
      break;
    }
    case svMatrix: {
      const r = this.GetDoubleOrStringFromMatrix();
      if (ScMatrix.IsValueType(r.nType)) this.PushString('');
      else this.PushString(r.aStr);
      break;
    }
    case svDouble: {
      this.PopError();
      this.PushString('');
      break;
    }
    case svString:
      // leave on stack
      break;
    default:
      this.PushError(FormulaError.UnknownOpCode);
  }
};

ScInterpreter.prototype.ScValue = function (this: ScInterpreter): void {
  let aInputString = '';
  let fVal: number;

  switch (this.GetRawStackType()) {
    case svMissing:
    case svEmptyCell:
      this.Pop();
      this.PushInt(0);
      return;
    case svDouble:
      return; // leave on stack

    case svSingleRef:
    case svDoubleRef: {
      const aAdr = this.PopDoubleRefOrSingleRef();
      if (!aAdr) {
        this.PushInt(0);
        return;
      }
      const aCell = this.mrDoc.GetRefCellValue(aAdr);
      if (aCell.hasString()) {
        aInputString = this.GetCellString(aCell);
      } else if (aCell.hasNumeric()) {
        this.PushDouble(this.GetCellValue(aAdr, aCell));
        return;
      } else {
        this.PushDouble(0.0);
        return;
      }
      break;
    }
    case svMatrix: {
      const r = this.GetDoubleOrStringFromMatrix();
      fVal = r.fVal;
      aInputString = r.aStr;
      switch (r.nType) {
        case ScMatValType.Empty:
          fVal = 0.0;
          // [[fallthrough]]
          this.PushDouble(fVal);
          return;
        case ScMatValType.Value:
        case ScMatValType.Boolean:
          this.PushDouble(fVal);
          return;
        case ScMatValType.String:
          // evaluated below
          break;
        default:
          this.PushIllegalArgument();
      }
      break;
    }
    default:
      aInputString = this.GetString();
      break;
  }

  // 0 for default locale
  const r = NFIsNumberFormat(aInputString, 'en-US');
  if (r) this.PushDouble(r.value);
  else this.PushIllegalArgument();
};

// fdo#57180
ScInterpreter.prototype.ScNumberValue = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 1, 3)) return;

  let aInputString: string;
  let aGroupSeparator = '';
  let cDecimalSeparator = '';

  if (nParamCount === 3) aGroupSeparator = this.GetString();

  if (nParamCount >= 2) {
    const aDecimalSeparator = this.GetString();
    if (aDecimalSeparator.length === 1) cDecimalSeparator = aDecimalSeparator[0]!;
    else {
      this.PushIllegalArgument(); //if given, separator length must be 1
      return;
    }
  }

  if (cDecimalSeparator && aGroupSeparator.indexOf(cDecimalSeparator) !== -1) {
    this.PushIllegalArgument(); //decimal separator cannot appear in group separator
    return;
  }

  switch (this.GetStackType()) {
    case svDouble:
      return; // leave on stack
    default:
      aInputString = this.GetString();
  }
  if (this.nGlobalError !== FormulaError.NONE) {
    this.PushError(this.nGlobalError);
    return;
  }
  if (!aInputString) {
    // maCalcConfig.mbEmptyStringAsZero is false by default
    this.PushNoValue();
    return;
  }

  const nDecSep = cDecimalSeparator ? aInputString.indexOf(cDecimalSeparator) : -1;
  if (nDecSep !== 0) {
    let aTemporary = nDecSep >= 0 ? aInputString.slice(0, nDecSep) : aInputString;
    for (const nChar of aGroupSeparator) aTemporary = aTemporary.split(nChar).join('');
    if (nDecSep >= 0) aInputString = aTemporary + aInputString.slice(nDecSep);
    else aInputString = aTemporary;
  }

  for (let i = aInputString.length; --i >= 0; ) {
    const c = aInputString.charCodeAt(i);
    if (c === 0x0020 || c === 0x0009 || c === 0x000a || c === 0x000d) aInputString = aInputString.slice(0, i) + aInputString.slice(i + 1); // remove spaces etc.
  }
  let nPercentCount = 0;
  for (let i = aInputString.length - 1; i >= 0 && aInputString.charCodeAt(i) === 0x0025; i--) {
    aInputString = aInputString.slice(0, i) + aInputString.slice(i + 1); // remove and count trailing '%'
    nPercentCount++;
  }

  const r = stringToDouble(aInputString, cDecimalSeparator || '\0', '\0');
  let fVal = r.fVal;
  if (r.eStatus === rtl_math_ConversionStatus.Ok && r.nParseEnd === aInputString.length) {
    if (nPercentCount) fVal *= Math.pow(10.0, -(nPercentCount * 2)); // process '%' from input string
    this.PushDouble(fVal);
    return;
  }
  this.PushNoValue();
};

function lcl_ScInterpreter_IsPrintable(nCodePoint: number): boolean {
  const s = String.fromCodePoint(nCodePoint);
  return !/\p{Cc}/u.test(s) /*not in Cc*/ && !/\p{Cn}/u.test(s) /*not in Cn*/;
}

ScInterpreter.prototype.ScClean = function (this: ScInterpreter): void {
  const aStr = this.GetString();

  let aBuf = '';
  let nIdx = 0;
  while (nIdx < aStr.length) {
    const nNext = iterateCodePoints(aStr, nIdx);
    const c = aStr.codePointAt(nIdx)!;
    nIdx = nNext;
    if (lcl_ScInterpreter_IsPrintable(c)) aBuf += String.fromCodePoint(c);
  }
  this.PushString(aBuf);
};

/** The "thread text encoding" of CODE and CHAR: Windows-1252, as on Windows. */
const aThreadTextEncoding: string = (() => {
  const a = new Uint8Array(256);
  for (let i = 0; i < 256; i++) a[i] = i;
  try {
    return new TextDecoder('windows-1252').decode(a);
  } catch {
    return String.fromCharCode(...a);
  }
})();

ScInterpreter.prototype.ScCode = function (this: ScInterpreter): void {
  //2do: make it full range unicode?
  const aStr = this.GetString();
  if (!aStr) this.PushInt(0);
  else {
    // "classic" ByteString conversion: undefined characters become '?'
    const n = aThreadTextEncoding.indexOf(aStr[0]!);
    this.PushInt(n >= 0 ? n : 0x3f);
  }
};

ScInterpreter.prototype.ScChar = function (this: ScInterpreter): void {
  //2do: make it full range unicode?
  const fVal = this.GetDouble();
  if (fVal < 0.0 || fVal >= 256.0) this.PushIllegalArgument();
  else {
    // "classic" ByteString conversion
    const cEncodedChar = Math.trunc(fVal);
    const aStr = aThreadTextEncoding[cEncodedChar]!;
    this.PushString(aStr);
  }
};

ScInterpreter.prototype.ScUnicode = function (this: ScInterpreter): void {
  if (this.MustHaveParamCount(this.GetByte(), 1)) {
    const aStr = this.GetString();
    if (!aStr) this.PushIllegalParameter();
    else {
      this.PushDouble(aStr.codePointAt(0)!);
    }
  }
};

ScInterpreter.prototype.ScUnichar = function (this: ScInterpreter): void {
  if (this.MustHaveParamCount(this.GetByte(), 1)) {
    const nCodePoint = this.GetUInt32();
    if (this.nGlobalError !== FormulaError.NONE || !(nCodePoint <= 0x10ffff)) this.PushIllegalArgument();
    else {
      const aStr = String.fromCodePoint(nCodePoint);
      this.PushString(aStr);
    }
  }
};

ScInterpreter.prototype.ScCurrency = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 1, 2)) return;

  let aStr: string;
  let fDec: number;
  if (nParamCount === 2) {
    fDec = approxFloor(this.GetDouble());
    if (fDec < -15.0 || fDec > 15.0) {
      this.PushIllegalArgument();
      return;
    }
  } else fDec = 2.0;
  let fVal = this.GetDouble();
  let fFac: number;
  if (fDec !== 0.0) fFac = Math.pow(10, fDec);
  else fFac = 1.0;
  if (fVal < 0.0) fVal = Math.ceil(fVal * fFac - 0.5) / fFac;
  else fVal = Math.floor(fVal * fFac + 0.5) / fFac;
  if (fDec < 0.0) fDec = 0.0;
  const nIndex = GetStandardFormat(SvNumFormatType.CURRENCY, 'en-US');
  if (Math.trunc(fDec) !== GetFormatSpecialInfo(nIndex, 'en-US').nPrecision) {
    const sFormatString = GenerateFormat(
      nIndex,
      'en-US',
      true, // with thousands separator
      false, // not red
      Math.trunc(fDec), // decimal places
      1,
    );
    aStr = GetOutputString(fVal, sFormatString, 'en-US').text;
  } else {
    aStr = GetOutputString(fVal, nIndex, 'en-US').text;
  }
  this.PushString(aStr);
};

ScInterpreter.prototype.ScReplace = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 4)) return;

  const aNewStr = this.GetString();
  let nCount = this.GetStringPositionArgument();
  let nPos = this.GetStringPositionArgument();
  let aOldStr = this.GetString();
  if (nPos < 1 || nCount < 0) this.PushIllegalArgument();
  else {
    const nLen = aOldStr.length;
    if (nPos > nLen + 1) nPos = nLen + 1;
    if (nCount > nLen - nPos + 1) nCount = nLen - nPos + 1;
    let nIdx = 0;
    let nCnt = 0;
    while (nIdx < nLen && nPos > nCnt + 1) {
      nIdx = iterateCodePoints(aOldStr, nIdx);
      ++nCnt;
    }
    const nStart = nIdx;
    while (nIdx < nLen && nPos + nCount - 1 > nCnt) {
      nIdx = iterateCodePoints(aOldStr, nIdx);
      ++nCnt;
    }
    if (this.CheckStringResultLen(aOldStr, aNewStr.length - (nIdx - nStart))) aOldStr = aOldStr.slice(0, nStart) + aNewStr + aOldStr.slice(nIdx);
    else aOldStr = '';
    this.PushString(aOldStr);
  }
};

ScInterpreter.prototype.ScFixed = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 1, 3)) return;

  let fDec: number;
  let bThousand: boolean;
  if (nParamCount === 3) bThousand = !this.GetBool(); // Param true: no thousands separator
  else bThousand = true;
  if (nParamCount >= 2) {
    fDec = approxFloor(this.GetDoubleWithDefault(2.0));
    if (fDec < -15.0 || fDec > 15.0) {
      this.PushIllegalArgument();
      return;
    }
  } else fDec = 2.0;
  let fVal = this.GetDouble();
  let fFac: number;
  if (fDec !== 0.0) fFac = Math.pow(10, fDec);
  else fFac = 1.0;
  if (fVal < 0.0) fVal = Math.ceil(fVal * fFac - 0.5) / fFac;
  else fVal = Math.floor(fVal * fFac + 0.5) / fFac;
  if (fDec < 0.0) fDec = 0.0;
  const nIndex = GetStandardFormat(SvNumFormatType.NUMBER, 'en-US');
  const sFormatString = GenerateFormat(
    nIndex,
    'en-US',
    bThousand, // with thousands separator
    false, // not red
    Math.trunc(fDec), // decimal places
    1,
  );
  this.PushString(GetOutputString(fVal, sFormatString, 'en-US').text);
};

ScInterpreter.prototype.ScFind = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 2, 3)) return;

  let nCnt: number;
  if (nParamCount === 3) nCnt = Math.trunc(this.GetDouble()) | 0;
  else nCnt = 1;
  const sStr = this.GetString();
  if (nCnt < 1 || nCnt > sStr.length) this.PushNoValue();
  else {
    const nPos = OUString_indexOf(sStr, this.GetString(), nCnt - 1);
    if (nPos === -1) this.PushNoValue();
    else {
      let nIdx = 0;
      nCnt = 0;
      while (nIdx < nPos) {
        nIdx = iterateCodePoints(sStr, nIdx);
        ++nCnt;
      }
      this.PushDouble(nCnt + 1);
    }
  }
};

ScInterpreter.prototype.ScExact = function (this: ScInterpreter): void {
  this.nFuncFmtType = SvNumFormatType.LOGICAL;
  if (this.MustHaveParamCount(this.GetByte(), 2)) {
    const s1 = this.GetString();
    const s2 = this.GetString();
    this.PushInt(s1 === s2 ? 1 : 0);
  }
};

ScInterpreter.prototype.ScLeft = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 1, 2)) return;

  let n: number;
  if (nParamCount === 2) {
    n = this.GetStringPositionArgument();
    if (n < 0) {
      this.PushIllegalArgument();
      return;
    }
  } else n = 1;
  let aStr = this.GetString();
  let nIdx = 0;
  let nCnt = 0;
  while (nIdx < aStr.length && n > nCnt++) nIdx = iterateCodePoints(aStr, nIdx);
  aStr = aStr.slice(0, nIdx);
  this.PushString(aStr);
};

/** The UBlockCode ranges of scriptList (Hangul Jamo, CJK radicals to Hangul syllables, CJK
    compatibility ideographs and forms, halfwidth and fullwidth forms, CJK strokes) as BMP code
    point ranges; the supplementary blocks are never reached by a UTF-16 code unit. */
const scriptList: readonly (readonly [number, number])[] = [
  [0x1100, 0x11ff], // UBLOCK_HANGUL_JAMO
  // UBLOCK_CJK_RADICALS_SUPPLEMENT .. UBLOCK_HANGUL_SYLLABLES
  [0x2e80, 0x2fdf], [0x2ff0, 0x31bf], [0x3200, 0x9fff], [0xa000, 0xa4cf], [0xac00, 0xd7af],
  [0xf900, 0xfaff], // UBLOCK_CJK_COMPATIBILITY_IDEOGRAPHS
  [0xfe30, 0xfe4f], // UBLOCK_CJK_COMPATIBILITY_FORMS
  [0xff00, 0xffef], // UBLOCK_HALFWIDTH_AND_FULLWIDTH_FORMS
  [0x31c0, 0x31ef], // UBLOCK_CJK_STROKES
];

function ByteLen(currentChar: number): number {
  // for the locale of ja-JP, character U+0x005c and U+0x20ac should be ScriptType::Asian
  // (the configured system language is not Japanese here)
  for (const [from, to] of scriptList) if (currentChar >= from && currentChar <= to) return 2;
  return 1;
}

function getLengthB(str: string): number {
  let length = 0;
  for (let index = 0; index < str.length; ++index) length += ByteLen(str.charCodeAt(index));
  return length;
}

ScInterpreter.prototype.ScLenB = function (this: ScInterpreter): void {
  this.PushDouble(getLengthB(this.GetString()));
};

function lcl_RightB(rStr: string, n: number): string {
  for (let nPos = rStr.length; ; --nPos) {
    if (n === 0 || nPos === 0) return rStr.slice(nPos);
    n -= ByteLen(rStr.charCodeAt(nPos - 1));
    if (n < 0)
      // only one "byte" of a "doublebyte" character is requested; produce a space
      return ' ' + rStr.slice(nPos);
  }
}

ScInterpreter.prototype.ScRightB = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 1, 2)) return;

  let n: number;
  if (nParamCount === 2) {
    n = this.GetStringPositionArgument();
    if (n < 0) {
      this.PushIllegalArgument();
      return;
    }
  } else n = 1;
  const aStr = lcl_RightB(this.GetString(), n);
  this.PushString(aStr);
};

function lcl_LeftB(rStr: string, n: number): string {
  for (let nPos = 0; ; ++nPos) {
    if (n === 0 || nPos === rStr.length) return rStr.slice(0, nPos);
    n -= ByteLen(rStr.charCodeAt(nPos));
    if (n < 0)
      // only one "byte" of a "doublebyte" character is requested; produce a space
      return rStr.slice(0, nPos) + ' ';
  }
}

ScInterpreter.prototype.ScLeftB = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 1, 2)) return;

  let n: number;
  if (nParamCount === 2) {
    n = this.GetStringPositionArgument();
    if (n < 0) {
      this.PushIllegalArgument();
      return;
    }
  } else n = 1;
  const aStr = lcl_LeftB(this.GetString(), n);
  this.PushString(aStr);
};

ScInterpreter.prototype.ScMidB = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 3)) return;

  const nCount = this.GetStringPositionArgument();
  const nStart = this.GetStringPositionArgument();
  let aStr = this.GetString();
  if (nStart < 1 || nCount < 0) this.PushIllegalArgument();
  else {
    aStr = lcl_LeftB(aStr, nStart + nCount - 1);
    const nCnt = getLengthB(aStr) - nStart + 1;
    aStr = lcl_RightB(aStr, Math.max(nCnt, 0));
    this.PushString(aStr);
  }
};

ScInterpreter.prototype.ScReplaceB = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 4)) return;

  const aNewStr = this.GetString();
  const nCount = this.GetStringPositionArgument();
  const nPos = this.GetStringPositionArgument();
  const aOldStr = this.GetString();
  const nLen = getLengthB(aOldStr);
  if (nPos < 1.0 || nPos > nLen || nCount < 0.0 || nPos + nCount - 1 > nLen) this.PushIllegalArgument();
  else {
    // REPLACEB(aOldStr;nPos;nCount;aNewStr) is the same as
    // LEFTB(aOldStr;nPos-1) & aNewStr & RIGHT(aOldStr;LENB(aOldStr)-(nPos - 1)-nCount)
    const aStr1 = lcl_LeftB(aOldStr, nPos - 1);
    const aStr3 = lcl_RightB(aOldStr, nLen - nPos - nCount + 1);

    this.PushString(aStr1 + aNewStr + aStr3);
  }
};

ScInterpreter.prototype.ScFindB = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 2, 3)) return;

  let nStart: number;
  if (nParamCount === 3) nStart = this.GetStringPositionArgument();
  else nStart = 1;
  const aStr = this.GetString();
  const nLen = getLengthB(aStr);
  const asStr = this.GetString();
  const nsLen = getLengthB(asStr);
  if (nStart < 1 || nStart > nLen - nsLen + 1) this.PushIllegalArgument();
  else {
    // create a string from sStr starting at nStart
    const aBuf = lcl_RightB(aStr, nLen - nStart + 1);
    // search aBuf for asStr
    const nPos = OUString_indexOf(aBuf, asStr, 0);
    if (nPos === -1) this.PushNoValue();
    else {
      // obtain byte value of nPos
      const nBytePos = getLengthB(aBuf.slice(0, nPos));
      this.PushDouble(nBytePos + nStart);
    }
  }
};

ScInterpreter.prototype.ScSearchB = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 2, 3)) return;

  let nStart: number;
  if (nParamCount === 3) {
    nStart = this.GetStringPositionArgument();
    if (nStart < 1) {
      this.PushIllegalArgument();
      return;
    }
  } else nStart = 1;
  const aStr = this.GetString();
  const nLen = getLengthB(aStr);
  const asStr = this.GetString();
  const nsLen = nStart - 1;
  if (nsLen >= nLen) this.PushNoValue();
  else {
    // create a string from sStr starting at nStart
    const aSubStr = lcl_RightB(aStr, nLen - nStart + 1);
    // search aSubStr for asStr
    const eSearchType = this.DetectSearchType(asStr, this.mrDoc);
    const sPar = new SearchParam(asStr, eSearchType, false, '~', false);
    const sT = new TextSearch(sPar);
    const r = sT.SearchForward(aSubStr, 0, aSubStr.length);
    if (!r.bFound) this.PushNoValue();
    else {
      // obtain byte value of nPos
      const nBytePos = getLengthB(aSubStr.slice(0, r.nStart));
      this.PushDouble(nBytePos + nStart);
    }
  }
};

ScInterpreter.prototype.ScRight = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 1, 2)) return;

  let n: number;
  if (nParamCount === 2) {
    n = this.GetStringPositionArgument();
    if (n < 0) {
      this.PushIllegalArgument();
      return;
    }
  } else n = 1;
  let aStr = this.GetString();
  const nLen = aStr.length;
  if (nLen <= n) this.PushString(aStr);
  else {
    let nIdx = nLen;
    let nCnt = 0;
    while (nIdx > 0 && n > nCnt) {
      nIdx = iterateCodePoints(aStr, nIdx, -1);
      ++nCnt;
    }
    aStr = aStr.slice(nIdx, nLen);
    this.PushString(aStr);
  }
};

ScInterpreter.prototype.ScSearch = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 2, 3)) return;

  let nStart: number;
  if (nParamCount === 3) {
    nStart = this.GetStringPositionArgument();
    if (nStart < 1) {
      this.PushIllegalArgument();
      return;
    }
  } else nStart = 1;
  const sStr = this.GetString();
  const SearchStr = this.GetString();
  const nPos = nStart - 1;
  const nEndPos = sStr.length;
  if (nPos >= nEndPos) this.PushNoValue();
  else {
    const eSearchType = this.DetectSearchType(SearchStr, this.mrDoc);
    const sPar = new SearchParam(SearchStr, eSearchType, false, '~', false);
    const sT = new TextSearch(sPar);
    const bBool = sT.SearchForward(sStr, nPos, nEndPos);
    if (!bBool.bFound) this.PushNoValue();
    else {
      let nIdx = 0;
      let nCnt = 0;
      while (nIdx < bBool.nStart) {
        nIdx = iterateCodePoints(sStr, nIdx);
        ++nCnt;
      }
      this.PushDouble(nCnt + 1);
    }
  }
};

/** icu::RegexMatcher::appendReplacement's expansion of a replacement text for a match: \ escapes
    the next character, $n and ${name} insert a capture group; null for an invalid reference. */
function lcl_ExpandIcuReplacement(aReplacement: string, aMatch: RegExpExecArray): string | null {
  const nGroups = aMatch.length - 1;
  let aRes = '';
  for (let i = 0; i < aReplacement.length; ) {
    const c = aReplacement[i]!;
    if (c === '\\') {
      if (i + 1 < aReplacement.length) {
        const nNext = iterateCodePoints(aReplacement, i + 1);
        aRes += aReplacement.slice(i + 1, nNext);
        i = nNext;
      } else i++;
      continue;
    }
    if (c !== '$') {
      aRes += c;
      i++;
      continue;
    }
    i++;
    if (aReplacement[i] === '{') {
      const nEnd = aReplacement.indexOf('}', i);
      if (nEnd < 0) return null;
      const aName = aReplacement.slice(i + 1, nEnd);
      if (!aMatch.groups || !(aName in aMatch.groups)) return null;
      aRes += aMatch.groups[aName] ?? '';
      i = nEnd + 1;
      continue;
    }
    if (!/[0-9]/.test(aReplacement[i] ?? '')) return null;
    // The longest number that is a valid group.
    let nGroup = Number(aReplacement[i]);
    i++;
    while (/[0-9]/.test(aReplacement[i] ?? '') && nGroup * 10 + Number(aReplacement[i]) <= nGroups) {
      nGroup = nGroup * 10 + Number(aReplacement[i]);
      i++;
    }
    if (nGroup > nGroups) return null;
    aRes += aMatch[nGroup] ?? '';
  }
  return aRes;
}

/** RegexMatcher::find: the next match from rState.nPos, advancing past empty matches. */
function lcl_RegexFind(aRegex: RegExp, aText: string, rState: { nPos: number }): RegExpExecArray | null {
  if (rState.nPos > aText.length) return null;
  aRegex.lastIndex = rState.nPos;
  const m = aRegex.exec(aText);
  if (!m) {
    rState.nPos = aText.length + 1;
    return null;
  }
  rState.nPos = m[0].length ? m.index + m[0].length : iterateCodePoints(aText, m.index);
  return m;
}

ScInterpreter.prototype.ScRegex = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 2, 4)) return;

  // Flags are supported only for replacement, search match flags can be
  // individually and much more flexible set in the regular expression
  // pattern using (?ismwx-ismwx)
  let bGlobalReplacement = false;
  let nOccurrence = 1; // default first occurrence, if any
  if (nParamCount === 4) {
    // Argument can be either string or double.
    let fOccurrence: number;
    let aFlagsString = '';
    let bDouble: boolean;
    if (!this.IsMissing()) {
      const r = this.GetDoubleOrString();
      bDouble = r.bDouble;
      fOccurrence = r.fVal;
      aFlagsString = r.aStr;
    } else {
      // For an omitted argument keep the default.
      this.PopError();
      bDouble = true;
      fOccurrence = nOccurrence;
    }
    if (this.nGlobalError !== FormulaError.NONE) {
      this.PushError(this.nGlobalError);
      return;
    }
    if (bDouble) {
      const r = CheckStringPositionArgument(fOccurrence);
      if (!r.bOk) {
        this.PushError(FormulaError.IllegalArgument);
        return;
      }
      nOccurrence = Math.trunc(r.fVal);
    } else {
      const aFlags = aFlagsString;
      // Empty flags string is valid => no flag set.
      if (aFlags.length > 1) {
        // Only one flag supported.
        this.PushIllegalArgument();
        return;
      }
      if (aFlags.length === 1) {
        if (aFlags.indexOf('g') >= 0) bGlobalReplacement = true;
        else {
          // Unsupported flag.
          this.PushIllegalArgument();
          return;
        }
      }
    }
  }

  let bReplacement = false;
  let aReplacement = '';
  if (nParamCount >= 3) {
    // A missing argument is not an empty string to replace the match.
    // nOccurrence==0 forces no replacement, so simply discard the
    // argument.
    if (this.IsMissing() || nOccurrence === 0) this.PopError();
    else {
      aReplacement = this.GetString();
      bReplacement = true;
    }
  }
  // If bGlobalReplacement==true and bReplacement==false then
  // bGlobalReplacement is silently ignored.

  const aExpression = this.GetString();
  const aText = this.GetString();

  if (this.nGlobalError !== FormulaError.NONE) {
    this.PushError(this.nGlobalError);
    return;
  }

  // 0-th match or replacement is none, return original string early.
  if (nOccurrence === 0) {
    this.PushString(aText);
    return;
  }

  let aRegexMatcher: RegExp;
  try {
    aRegexMatcher = new RegExp(aExpression, 'gu');
  } catch {
    try {
      aRegexMatcher = new RegExp(aExpression, 'g');
    } catch {
      // Invalid regex.
      this.PushIllegalArgument();
      return;
    }
  }

  const aState = { nPos: 0 };
  if (!bReplacement) {
    // Find n-th occurrence.
    let nCount = 0;
    let aMatch: RegExpExecArray | null = null;
    let aFound: RegExpExecArray | null;
    while ((aFound = lcl_RegexFind(aRegexMatcher, aText, aState)) && (aMatch = aFound) && ++nCount < nOccurrence);
    // n-th match found?
    if (nCount !== nOccurrence || !aMatch) {
      this.PushError(FormulaError.NotAvailable);
      return;
    }
    // Extract matched text.
    this.PushString(aMatch[0]);
    return;
  }

  let aReplaced = '';
  let nAppendPos = 0;
  let bFailure = false;
  const appendReplacement = (m: RegExpExecArray): void => {
    const aExpanded = lcl_ExpandIcuReplacement(aReplacement, m);
    if (aExpanded === null) {
      bFailure = true;
      return;
    }
    aReplaced += aText.slice(nAppendPos, m.index) + aExpanded;
    nAppendPos = m.index + m[0].length;
  };
  if (bGlobalReplacement) {
    // Replace all occurrences of match with replacement.
    let m: RegExpExecArray | null;
    while (!bFailure && (m = lcl_RegexFind(aRegexMatcher, aText, aState))) appendReplacement(m);
  } else {
    // Replace first (nOccurrence 1) or n-th occurrence of match with replacement.
    let nCount = 0;
    let m: RegExpExecArray | null;
    while ((m = lcl_RegexFind(aRegexMatcher, aText, aState))) {
      if (++nCount === nOccurrence) {
        appendReplacement(m);
        break;
      }
    }
  }
  // appendTail
  aReplaced += aText.slice(nAppendPos);
  if (bFailure) {
    // Some error, e.g. extraneous $1 without group.
    this.PushIllegalArgument();
    return;
  }
  this.PushString(aReplaced);
};

ScInterpreter.prototype.ScMid = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 3)) return;

  const nSubLen = this.GetStringPositionArgument();
  const nStart = this.GetStringPositionArgument();
  let aStr = this.GetString();
  if (nStart < 1 || nSubLen < 0) this.PushIllegalArgument();
  else if (nStart > kScInterpreterMaxStrLen || nSubLen > kScInterpreterMaxStrLen) this.PushError(FormulaError.StringOverflow);
  else {
    const nLen = aStr.length;
    let nIdx = 0;
    let nCnt = 0;
    while (nIdx < nLen && nStart - 1 > nCnt) {
      nIdx = iterateCodePoints(aStr, nIdx);
      ++nCnt;
    }
    const nIdx0 = nIdx; //start position

    while (nIdx < nLen && nStart + nSubLen - 1 > nCnt) {
      nIdx = iterateCodePoints(aStr, nIdx);
      ++nCnt;
    }
    aStr = aStr.slice(nIdx0, nIdx);
    this.PushString(aStr);
  }
};

ScInterpreter.prototype.ScText = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 2)) return;

  const sFormatString = this.GetString();
  let aStr = '';
  let bString = false;
  let fVal = 0.0;
  switch (this.GetStackType()) {
    case svError:
      this.PopError();
      break;
    case svDouble:
      fVal = this.PopDouble();
      break;
    default: {
      const xTok = this.PopToken();
      if (this.nGlobalError === FormulaError.NONE && xTok) {
        this.PushTokenRef(xTok);
        // Temporarily override the ConvertStringToValue()
        // error for GetCellValue() / GetCellValueOrZero()
        const nSErr = this.mnStringNoValueError;
        this.mnStringNoValueError = FormulaError.NotNumericString;
        fVal = this.GetDouble();
        this.mnStringNoValueError = nSErr;
        if ((this.nGlobalError as FormulaError) === FormulaError.NotNumericString) {
          // Not numeric.
          this.nGlobalError = FormulaError.NONE;
          this.PushTokenRef(xTok);
          aStr = this.GetString();
          bString = true;
        }
      }
    }
  }
  if (this.nGlobalError !== FormulaError.NONE) this.PushError(this.nGlobalError);
  else if (!sFormatString) {
    // Mimic the Excel behaviour that
    // * anything numeric returns an empty string
    // * text convertible to numeric returns an empty string
    // * any other text returns that text
    // Conversion was detected above.
    if (bString) this.PushString(aStr);
    else this.PushString('');
  } else {
    const pPattern = this.mrDoc.GetPattern(this.aPos.Col(), this.aPos.Row(), this.aPos.Tab());
    const eCellLang: string = pPattern ? pPattern.GetItem('ATTR_LANGUAGE_FORMAT') : 'en-US';
    if (bString) {
      // GetPreviewString: the text section of a format with one, else the text itself
      this.PushString(NFGetFormat(sFormatString, eCellLang).GetTextOutput(aStr));
    } else {
      // GetPreviewStringGuess
      this.PushString(GetOutputString(fVal, sFormatString, eCellLang).text);
    }
  }
};

ScInterpreter.prototype.ScSubstitute = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 3, 4)) return;

  let nCnt: number;
  if (nParamCount === 4) {
    nCnt = this.GetStringPositionArgument();
    if (nCnt < 1) {
      this.PushIllegalArgument();
      return;
    }
  } else nCnt = 0;
  const sNewStr = this.GetString();
  const sOldStr = this.GetString();
  const sStr = this.GetString();
  let nPos = 0;
  let nCount = 0;
  let oResult: string | null = null;
  for (let nEnd = OUString_indexOf(sStr, sOldStr); nEnd >= 0; nEnd = OUString_indexOf(sStr, sOldStr, nEnd)) {
    if (nCnt === 0 || ++nCount === nCnt) {
      // Found a replacement cite
      if (oResult === null) oResult = ''; // Only allocate buffer when needed

      oResult += sStr.slice(nPos, nEnd); // Copy leading unchanged text
      if (!this.CheckStringResultLen(oResult, sNewStr.length)) return this.PushError(this.GetError());
      oResult += sNewStr; // Copy  the replacement
      nPos = nEnd + sOldStr.length;
      if (nCnt > 0)
        // Found the single replacement site - end the loop
        break;
    }
    nEnd += sOldStr.length;
  }
  if (oResult !== null)
    // If there were prior replacements, copy the rest, otherwise use original
    oResult += sStr.slice(nPos);
  this.PushString(oResult !== null ? oResult : sStr);
};

ScInterpreter.prototype.ScRept = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 2)) return;

  let nCnt = this.GetStringPositionArgument();
  const aStr = this.GetString();
  if (nCnt < 0) this.PushIllegalArgument();
  else if (nCnt * aStr.length > kScInterpreterMaxStrLen) {
    this.PushError(FormulaError.StringOverflow);
  } else if (nCnt === 0) this.PushString('');
  else {
    let aRes = '';
    while (nCnt--) aRes += aStr;
    this.PushString(aRes);
  }
};

ScInterpreter.prototype.ScConcat = function (this: ScInterpreter): void {
  let nParamCount = this.GetByte();

  //reverse order of parameter stack to simplify processing
  this.ReverseStack(nParamCount);

  let aRes = '';
  while (nParamCount-- > 0) {
    const aStr = this.GetString();
    if (this.CheckStringResultLen(aRes, aStr.length)) aRes += aStr;
    else {
      aRes = '';
      break;
    }
  }
  this.PushString(aRes);
};

function MayBeRegExp(rStr: string): boolean {
  if (!rStr || (rStr.length === 1 && rStr[0] !== '.')) return false; // single meta characters can not be a regexp
  // First two characters are wildcard '?' and '*' characters.
  return /[?*+.[\]^$\\<>()|]/.test(rStr);
}

function MayBeWildcard(rStr: string): boolean {
  // Wildcards with '~' escape, if there are no wildcards then an escaped
  // character does not make sense, but it modifies the search pattern in an
  // Excel compatible wildcard search...
  return /[*?~]/.test(rStr);
}

ScInterpreter.prototype.DetectSearchType = function (this: ScInterpreter, rStr: string, rDoc: ScDocument): utlSearchType {
  const eType = rDoc.GetDocOptions().GetFormulaSearchType() as number;
  if ((eType === utlSearchType.Wildcard && MayBeWildcard(rStr)) || (eType === utlSearchType.Regexp && MayBeRegExp(rStr))) return eType as utlSearchType;
  return utlSearchType.Normal;
};

ScInterpreter.prototype.ScTextAfter = function (this: ScInterpreter): void {
  this.ScTextBeforeOrAfter(/*bBefore*/ false);
};

ScInterpreter.prototype.ScTextBefore = function (this: ScInterpreter): void {
  this.ScTextBeforeOrAfter(/*bBefore*/ true);
};

ScInterpreter.prototype.ScTextBeforeOrAfter = function (this: ScInterpreter, bBefore: boolean): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 1, 6)) return;

  // 6rd argument optional - if_not_found
  let aIfNotFound: string | undefined;
  if (nParamCount === 6) aIfNotFound = this.GetString();

  // 5rd argument optional - match_end
  let bMatchEnd = false;
  if (nParamCount >= 5) {
    if (!this.IsMissing()) {
      bMatchEnd = this.GetBool();
    } else this.Pop();
  }

  // 4rd argument optional - match_mode
  let bMatchMode = false;
  if (nParamCount >= 4) {
    if (!this.IsMissing()) {
      bMatchMode = this.GetBool();
    } else this.Pop();
  }

  // 3nd argument optional - instance_num
  let nInstanceNum = 1;
  if (nParamCount >= 3) {
    if (!this.IsMissing()) {
      nInstanceNum = this.GetInt32WithDefault(1);
    } else this.Pop();
  }

  if (nInstanceNum === 0) {
    this.PushError(FormulaError.NotAvailable);
    return;
  }

  // 2nd argument delimiter
  const aDelimiters: string[] = [];
  if (nParamCount >= 2) {
    switch (this.GetStackType()) {
      case svSingleRef:
      case svDoubleRef:
      case svMatrix: {
        const pMatSource = this.GetMatrix();
        if (!pMatSource) {
          this.PushIllegalParameter();
          return;
        }

        const { nC: nsC, nR: nsR } = pMatSource.GetDimensions();
        for (let i = 0; i < nsC; i++) {
          for (let j = 0; j < nsR; j++) {
            aDelimiters.push(pMatSource.GetString(i, j));
          }
        }
        break;
      }

      default:
        aDelimiters.push(this.GetString());
    }
  }

  // 1st argument: text
  const sText = this.GetString();
  if (!sText) {
    this.PushIllegalParameter();
    return;
  }

  const aDelimiterPositions: number[] = [];

  const sStr = sText;
  const nLength = sStr.length;
  let nStart = 0;
  while (nStart < nLength) {
    let nIndex = nLength;
    let nDelLength = 0;
    let bFound = false;

    // Find the first delimiter
    for (const rDelimiter of aDelimiters) {
      if (!rDelimiter) continue;

      const sDelimiter = rDelimiter;
      let nDelimiterIndex: number;
      if (bMatchMode) {
        nDelimiterIndex = CharClass_lowercase(sStr).indexOf(CharClass_lowercase(sDelimiter), nStart);
      } else nDelimiterIndex = sStr.indexOf(sDelimiter, nStart);

      if (nDelimiterIndex !== -1 && nDelimiterIndex < nIndex) {
        bFound = true;
        nDelLength = sDelimiter.length;
        nIndex = nDelimiterIndex;
      }
    }

    if (bFound) {
      if (bBefore) aDelimiterPositions.push(nIndex);
      else aDelimiterPositions.push(nIndex + nDelLength);
    }

    nStart = nIndex + nDelLength;
  }

  if (bMatchEnd) {
    if (nInstanceNum < 0) aDelimiterPositions.unshift(0);
    else aDelimiterPositions.push(nLength);
  }

  const nSize = aDelimiterPositions.length;
  if (nSize === 0 || Math.abs(nInstanceNum) > nSize) {
    if (aIfNotFound !== undefined) this.PushString(aIfNotFound);
    else this.PushError(FormulaError.NotAvailable);
  } else {
    if (nInstanceNum < 0) nInstanceNum = nSize + nInstanceNum + 1;

    const aDelPos = aDelimiterPositions[nInstanceNum - 1]!;
    if (bBefore) this.PushString(sStr.slice(0, aDelPos));
    else this.PushString(sStr.slice(aDelPos, nLength));
  }
};

function lcl_SplitText(rText: string, rDelimiters: string[], bIgnoreEmpty: boolean, bMatchMode: boolean): string[] {
  const aResStr: string[] = [];
  if (!rDelimiters.length || !rText) {
    aResStr.push(rText);
  } else {
    const nLength = rText.length;
    let nStart = 0;
    while (nStart < nLength) {
      let nIndex = nLength;
      let nDelLength = 0;

      // Find the first delimiter
      for (const rDelimiter of rDelimiters) {
        if (!rDelimiter) continue;

        const sDelimiter = rDelimiter;
        let nDelimiterIndex: number;
        if (bMatchMode) {
          nDelimiterIndex = CharClass_lowercase(rText).indexOf(CharClass_lowercase(sDelimiter), nStart);
        } else nDelimiterIndex = rText.indexOf(sDelimiter, nStart);

        if (nDelimiterIndex !== -1 && nDelimiterIndex < nIndex) {
          nDelLength = sDelimiter.length;
          nIndex = nDelimiterIndex;
        }
      }

      const sRes = rText.slice(nStart, nIndex);
      if (!bIgnoreEmpty || sRes) {
        aResStr.push(sRes);
      }
      nStart = nIndex + nDelLength;
    }
  }
  return aResStr;
}

ScInterpreter.prototype.ScTextSplit = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 1, 6)) return;

  // 6rd argument optional - pad_with
  let aPadWith: string | undefined;
  if (nParamCount === 6) aPadWith = this.GetString();

  // 5rd argument optional - match_mode
  let bMatchMode = false;
  if (nParamCount >= 5) {
    if (!this.IsMissing()) {
      bMatchMode = this.GetBool();
    } else this.Pop();
  }

  // 4rd argument optional - ignore_empty
  let bIgnoreEmpty = false;
  if (nParamCount >= 4) {
    if (!this.IsMissing()) bIgnoreEmpty = this.GetBool();
    else this.Pop();
  }

  const getDelimiters = (rDelimiters: string[]): boolean => {
    switch (this.GetStackType()) {
      case svSingleRef:
      case svDoubleRef:
      case svMatrix: {
        const pMatSource = this.GetMatrix();
        if (!pMatSource) {
          this.PushIllegalParameter();
          return false;
        }

        const { nC: nsC, nR: nsR } = pMatSource.GetDimensions();
        for (let i = 0; i < nsC; i++) {
          for (let j = 0; j < nsR; j++) {
            rDelimiters.push(pMatSource.GetString(i, j));
          }
        }
        break;
      }

      default:
        rDelimiters.push(this.GetString());
    }
    return true;
  };

  // 3rd argument optional - row_delimiter
  const aRowDelimiters: string[] = [];
  if (nParamCount >= 3) {
    if (!getDelimiters(aRowDelimiters)) return;
  }

  // 2nd argument optional - col_delimiter
  const aColDelimiters: string[] = [];
  if (nParamCount >= 2) {
    if (!getDelimiters(aColDelimiters)) return;
  }

  // 1st argument: text
  const sText = this.GetString();
  if (!sText) {
    this.PushIllegalParameter();
    return;
  }

  const aRowStrs = lcl_SplitText(sText, aRowDelimiters, bIgnoreEmpty, bMatchMode);
  const aRes: string[][] = [];

  let nCols = 1;
  const nRows = aRowStrs.length;
  for (const rRow of aRowStrs) {
    const aColStrs = lcl_SplitText(rRow, aColDelimiters, bIgnoreEmpty, bMatchMode);
    nCols = Math.max(nCols, aColStrs.length);
    aRes.push(aColStrs);
  }

  const pResMat = this.GetNewMat(nCols, nRows, /*bEmpty*/ true);
  for (let col = 0; col < nCols; ++col) {
    for (let row = 0; row < nRows; ++row) {
      if (col < aRes[row]!.length) {
        pResMat.PutString(aRes[row]![col]!, col, row);
      } else {
        if (aPadWith === undefined) pResMat.PutError(FormulaError.NotAvailable, col, row);
        else pResMat.PutString(aPadWith, col, row);
      }
    }
  }

  this.PushMatrix(pResMat);
};

ScInterpreter.Register(OC.ocTrim, ScInterpreter.prototype.ScTrim);
ScInterpreter.Register(OC.ocUpper, ScInterpreter.prototype.ScUpper);
ScInterpreter.Register(OC.ocProper, ScInterpreter.prototype.ScProper);
ScInterpreter.Register(OC.ocLower, ScInterpreter.prototype.ScLower);
ScInterpreter.Register(OC.ocLen, ScInterpreter.prototype.ScLen);
ScInterpreter.Register(OC.ocT, ScInterpreter.prototype.ScT);
ScInterpreter.Register(OC.ocClean, ScInterpreter.prototype.ScClean);
ScInterpreter.Register(OC.ocValue, ScInterpreter.prototype.ScValue);
ScInterpreter.Register(OC.ocNumberValue, ScInterpreter.prototype.ScNumberValue);
ScInterpreter.Register(OC.ocChar, ScInterpreter.prototype.ScChar);
ScInterpreter.Register(OC.ocCode, ScInterpreter.prototype.ScCode);
ScInterpreter.Register(OC.ocCurrency, ScInterpreter.prototype.ScCurrency);
ScInterpreter.Register(OC.ocReplace, ScInterpreter.prototype.ScReplace);
ScInterpreter.Register(OC.ocFixed, ScInterpreter.prototype.ScFixed);
ScInterpreter.Register(OC.ocFind, ScInterpreter.prototype.ScFind);
ScInterpreter.Register(OC.ocExact, ScInterpreter.prototype.ScExact);
ScInterpreter.Register(OC.ocLeft, ScInterpreter.prototype.ScLeft);
ScInterpreter.Register(OC.ocRight, ScInterpreter.prototype.ScRight);
ScInterpreter.Register(OC.ocSearch, ScInterpreter.prototype.ScSearch);
ScInterpreter.Register(OC.ocMid, ScInterpreter.prototype.ScMid);
ScInterpreter.Register(OC.ocText, ScInterpreter.prototype.ScText);
ScInterpreter.Register(OC.ocSubstitute, ScInterpreter.prototype.ScSubstitute);
ScInterpreter.Register(OC.ocRegex, ScInterpreter.prototype.ScRegex);
ScInterpreter.Register(OC.ocRept, ScInterpreter.prototype.ScRept);
ScInterpreter.Register(OC.ocConcat, ScInterpreter.prototype.ScConcat);
ScInterpreter.Register(OC.ocLenB, ScInterpreter.prototype.ScLenB);
ScInterpreter.Register(OC.ocRightB, ScInterpreter.prototype.ScRightB);
ScInterpreter.Register(OC.ocLeftB, ScInterpreter.prototype.ScLeftB);
ScInterpreter.Register(OC.ocMidB, ScInterpreter.prototype.ScMidB);
ScInterpreter.Register(OC.ocReplaceB, ScInterpreter.prototype.ScReplaceB);
ScInterpreter.Register(OC.ocFindB, ScInterpreter.prototype.ScFindB);
ScInterpreter.Register(OC.ocSearchB, ScInterpreter.prototype.ScSearchB);
ScInterpreter.Register(OC.ocUnicode, ScInterpreter.prototype.ScUnicode);
ScInterpreter.Register(OC.ocUnichar, ScInterpreter.prototype.ScUnichar);
ScInterpreter.Register(OC.ocTextAfter, ScInterpreter.prototype.ScTextAfter);
ScInterpreter.Register(OC.ocTextBefore, ScInterpreter.prototype.ScTextBefore);
ScInterpreter.Register(OC.ocTextSplit, ScInterpreter.prototype.ScTextSplit);

// @@ TEXT @@

// The lookup and reference functions: COLUMNS, ROWS, SHEETS, COLUMN, ROW, SHEET, MATCH, XMATCH,
// LOOKUP, HLOOKUP, VLOOKUP, XLOOKUP, INDIRECT, ADDRESS, OFFSET, INDEX, AREAS and the vector
// search (SearchVectorForValue). Left out: external references, the lookup cache
// (ScLookupCache, every lookup queries the cells), the sorted range cache of the binary search
// modes of XLOOKUP/XMATCH on cell ranges (they search linearly, which gives the same result on
// sorted data), database ranges and table structured references in INDIRECT, the VBA mode.

declare module './interpr4.ts' {
  interface ScInterpreter {
    ScColumns(): void;
    ScRows(): void;
    ScSheets(): void;
    ScColumn(): void;
    ScRow(): void;
    ScSheet(): void;
    ScMatch(): void;
    ScXMatch(): void;
    ScLookup(): void;
    ScHLookup(): void;
    ScVLookup(): void;
    CalculateLookup(bHLookup: boolean): void;
    FillEntry(rEntry: ScQueryEntry): boolean;
    ScXLookup(): void;
    ScIndirect(): void;
    ScAddressFunc(): void;
    ScOffset(): void;
    ScIndex(): void;
    ScMultiArea(): void;
    ScAreas(): void;
    SearchVectorForValue(vsa: VectorSearchArguments): boolean;
    SearchMatrixForValue(vsa: VectorSearchArguments, rParam: ScQueryParam, rEntry: ScQueryEntry, rItem: ScQueryEntryItem): boolean;
    SearchRangeForValue(vsa: VectorSearchArguments, rParam: ScQueryParam, rEntry: ScQueryEntry): boolean;
    LookupQueryWithCache(o_rResultPos: ScAddress, rParam: ScQueryParam, nSearchMode: LookupSearchMode, nOpCode: number): boolean;
  }
}

/** The calculation configuration's reference syntax for strings (ScCalcConfig::
    meStringRefAddressSyntax of ScInterpreter::GetGlobalConfig()); CONV_UNSPECIFIED uses the
    document's address convention. */
const maGlobalCalcConfig: { meStringRefAddressSyntax: FormulaGrammar.AddressConvention } = { meStringRefAddressSyntax: FormulaGrammar.CONV_UNSPECIFIED };

/** ScInterpreter::SetGlobalConfig (only the string reference syntax). */
export function SetGlobalConfig(rConfig: { meStringRefAddressSyntax: FormulaGrammar.AddressConvention }): void {
  maGlobalCalcConfig.meStringRefAddressSyntax = rConfig.meStringRefAddressSyntax;
}

/** ScInterpreter::GetGlobalConfig (only the string reference syntax). */
export function GetGlobalConfig(): { meStringRefAddressSyntax: FormulaGrammar.AddressConvention } { return maGlobalCalcConfig; }

/** MatchMode (interpre.hxx) */
export const MatchMode = { exactorNA: 0, exactorS: -1, exactorG: 1, wildcard: 2, regex: 3 } as const;
export type MatchMode = (typeof MatchMode)[keyof typeof MatchMode];

/** The contents of the function arguments of a vector search (VectorSearchArguments). */
export interface VectorSearchArguments {
  // OpCode of struct owner
  nSearchOpCode: number;
  // match mode (common, enum values are from XLOOKUP)
  // optional 5th argument to set match mode
  //   0 - Exact match. If none found, return #N/A. (MATCH value 0)
  //  -1 - Exact match. If none found, return the next smaller item. (MATCH value 1)
  //   1 - Exact match. If none found, return the next larger item. (MATCH value -1)
  //   2 - A wildcard match where *, ?, and ~ have special meaning. (XLOOKUP only)
  eMatchMode: MatchMode;
  // value to be searched for (common)
  nCol1: SCCOL;
  nRow1: SCROW;
  nTab1: SCTAB;
  nCol2: SCCOL;
  nRow2: SCROW;
  nTab2: SCTAB;
  pMatSrc: ScMatrix | null;
  isStringSearch: boolean;
  isEmptySearch: boolean;
  fSearchVal: number;
  sSearchStr: string;
  bVLookup: boolean;
  // search mode (only XLOOKUP has all 4 options, MATCH only uses Forward)
  eSearchMode: LookupSearchMode;
  // search variables
  nHitIndex: number;
  nBestFit: number;
  // result
  nIndex: number;
  isResultNA: boolean;
}

function newVectorSearchArguments(): VectorSearchArguments {
  return {
    nSearchOpCode: OC.ocNone, eMatchMode: MatchMode.exactorG, nCol1: 0, nRow1: 0, nTab1: 0, nCol2: 0, nRow2: 0, nTab2: 0, pMatSrc: null, isStringSearch: true,
    isEmptySearch: false, fSearchVal: 0, sSearchStr: '', bVLookup: false, eSearchMode: LookupSearchMode.Forward, nHitIndex: 0, nBestFit: SCSIZE_MAX, nIndex: -1,
    isResultNA: false,
  };
}

class VectorMatrixAccessor {
  private mrMat: ScMatrix;
  private mbColVec: boolean;

  constructor(rMat: ScMatrix, bColVec: boolean) {
    this.mrMat = rMat;
    this.mbColVec = bColVec;
  }

  IsEmpty(i: number): boolean { return this.mbColVec ? this.mrMat.IsEmpty(0, i) : this.mrMat.IsEmpty(i, 0); }
  IsEmptyPath(i: number): boolean { return this.mbColVec ? this.mrMat.IsEmptyPath(0, i) : this.mrMat.IsEmptyPath(i, 0); }
  IsValue(i: number): boolean { return this.mbColVec ? this.mrMat.IsValue(0, i) : this.mrMat.IsValue(i, 0); }
  IsStringOrEmpty(i: number): boolean { return this.mbColVec ? this.mrMat.IsStringOrEmpty(0, i) : this.mrMat.IsStringOrEmpty(i, 0); }
  GetDouble(i: number): number { return this.mbColVec ? this.mrMat.GetDouble(0, i) : this.mrMat.GetDouble(i, 0); }
  GetString(i: number): string { return this.mbColVec ? this.mrMat.GetString(0, i) : this.mrMat.GetString(i, 0); }

  GetElementCount(): number {
    const { nC, nR } = this.mrMat.GetDimensions();
    return this.mbColVec ? nR : nC;
  }
}

/** returns -1 when the matrix value is smaller than the query value, 0 when
    they are equal, and 1 when the matrix value is larger than the query
    value. */
function lcl_CompareMatrix2Query(i: number, rMat: VectorMatrixAccessor, rParam: ScQueryParam, rEntry: ScQueryEntry, bMatchWholeCell: boolean, bEmptyIsLess = true): number {
  if (rMat.IsEmpty(i)) {
    /* TODO: in case we introduced query for real empty this would have to
     * be changed! */
    if (bEmptyIsLess) return -1; // empty always less than anything else
    else return 1; // empty always greater than anything else
  }

  /* FIXME: what is an empty path (result of IF(false;true_path) in
   * comparisons? */

  const bByString = rEntry.GetQueryItem().meType === ScQueryEntry.ByString;
  if (rMat.IsValue(i)) {
    const nVal1 = rMat.GetDouble(i);
    if (!Number.isFinite(nVal1)) {
      // XXX Querying for error values is not required, otherwise we'd
      // need to check here.
      return 1; // error always greater than numeric or string
    }

    if (bByString) return -1; // numeric always less than string

    const nVal2 = rEntry.GetQueryItem().mfVal;
    // XXX Querying for error values is not required, otherwise we'd need
    // to check here and move that check before the bByString check.
    if (nVal1 === nVal2) return 0;

    return nVal1 < nVal2 ? -1 : 1;
  }

  if (!bByString) return 1; // string always greater than numeric

  const aStr1 = rMat.GetString(i);
  const aStr2 = rEntry.GetQueryItem().maString;

  // bRealWildOrRegExp
  if (rParam.eSearchType !== utlSearchType.Normal && (rEntry.eOp === ScQueryOp.SC_EQUAL || rEntry.eOp === ScQueryOp.SC_NOT_EQUAL)) {
    const r = rEntry.GetSearchTextPtr(rParam.eSearchType, rParam.bCaseSens, bMatchWholeCell).SearchForward(aStr1, 0, aStr1.length);
    let bMatch = r.bFound;
    // from 614 on, nEnd is behind the found text
    if (bMatch && bMatchWholeCell && (r.nStart !== 0 || r.nEnd !== aStr1.length)) bMatch = false; // RegExp must match entire cell string

    const bOk = rEntry.eOp === ScQueryOp.SC_NOT_EQUAL ? !bMatch : bMatch;

    if (bOk) return 0; // we have a WildOrRegExp match
  }

  const rCollator = GetCollator(rParam.bCaseSens);
  return rCollator.compareString(aStr1, aStr2);
}

/** returns -1 when matrix(i) value is smaller than matrix(j) value, 0 when
    they are equal, and 1 when larger */
function lcl_Compare2MatrixCells(i: number, rMat: VectorMatrixAccessor, j: number): number {
  // empty always less than anything else
  if (rMat.IsEmpty(i)) return rMat.IsEmpty(j) ? 0 : -1;
  else if (rMat.IsEmpty(j)) return 1;

  const bByString = rMat.IsStringOrEmpty(j); // string, empty has already been handled
  if (rMat.IsValue(i)) {
    const nVal1 = rMat.GetDouble(i);
    if (!Number.isFinite(nVal1)) return 1; // error always greater than numeric or string

    if (bByString) return -1; // numeric always less than string

    const nVal2 = rMat.GetDouble(j);
    if (nVal1 === nVal2) return 0;

    return nVal1 < nVal2 ? -1 : 1;
  }

  if (!bByString) return 1; // string always greater than numeric

  return GetCollator().compareString(rMat.GetString(i), rMat.GetString(j)); // case-insensitive
}

/** returns the last item with the identical value as the original item
    value. */
function lcl_GetLastMatch(rIndex: number, rMat: VectorMatrixAccessor, nMatCount: number): number {
  if (rMat.IsValue(rIndex)) {
    const nVal = rMat.GetDouble(rIndex);
    while (rIndex < nMatCount - 1 && rMat.IsValue(rIndex + 1) && nVal === rMat.GetDouble(rIndex + 1)) ++rIndex;
  }
  // Order of IsEmptyPath, IsEmpty, IsStringOrEmpty is significant!
  else if (rMat.IsEmptyPath(rIndex)) {
    while (rIndex < nMatCount - 1 && rMat.IsEmptyPath(rIndex + 1)) ++rIndex;
  } else if (rMat.IsEmpty(rIndex)) {
    while (rIndex < nMatCount - 1 && rMat.IsEmpty(rIndex + 1)) ++rIndex;
  } else if (rMat.IsStringOrEmpty(rIndex)) {
    const aStr = rMat.GetString(rIndex);
    while (rIndex < nMatCount - 1 && rMat.IsStringOrEmpty(rIndex + 1) && aStr === rMat.GetString(rIndex + 1)) ++rIndex;
  }
  return rIndex;
}

ScInterpreter.prototype.ScColumns = function (this: ScInterpreter): void {
  let nParamCount = this.GetByte();
  let nVal = 0;
  while (nParamCount-- > 0) {
    switch (this.GetStackType()) {
      case svSingleRef:
        this.PopError();
        nVal++;
        break;
      case svDoubleRef: {
        const r = this.PopDoubleRef();
        nVal += (r.aEnd.Tab() - r.aStart.Tab() + 1) * (r.aEnd.Col() - r.aStart.Col() + 1);
        break;
      }
      case svMatrix: {
        const pMat = this.PopMatrix();
        if (pMat) nVal += pMat.GetDimensions().nC;
        break;
      }
      default:
        this.PopError();
        this.SetError(FormulaError.IllegalParameter);
    }
  }
  this.PushDouble(nVal);
};

ScInterpreter.prototype.ScRows = function (this: ScInterpreter): void {
  let nParamCount = this.GetByte();
  let nVal = 0;
  while (nParamCount-- > 0) {
    switch (this.GetStackType()) {
      case svSingleRef:
        this.PopError();
        nVal++;
        break;
      case svDoubleRef: {
        const r = this.PopDoubleRef();
        nVal += (r.aEnd.Tab() - r.aStart.Tab() + 1) * (r.aEnd.Row() - r.aStart.Row() + 1);
        break;
      }
      case svMatrix: {
        const pMat = this.PopMatrix();
        if (pMat) nVal += pMat.GetDimensions().nR;
        break;
      }
      default:
        this.PopError();
        this.SetError(FormulaError.IllegalParameter);
    }
  }
  this.PushDouble(nVal);
};

ScInterpreter.prototype.ScSheets = function (this: ScInterpreter): void {
  let nParamCount = this.GetByte();
  let nVal: number;
  if (nParamCount === 0) nVal = this.mrDoc.GetTableCount();
  else {
    nVal = 0;
    while (this.nGlobalError === FormulaError.NONE && nParamCount-- > 0) {
      switch (this.GetStackType()) {
        case svSingleRef:
          this.PopError();
          nVal++;
          break;
        case svDoubleRef: {
          const r = this.PopDoubleRef();
          nVal += r.aEnd.Tab() - r.aStart.Tab() + 1;
          break;
        }
        default:
          this.PopError();
          this.SetError(FormulaError.IllegalParameter);
      }
    }
  }
  this.PushDouble(nVal);
};

ScInterpreter.prototype.ScColumn = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 0, 1)) return;

  let nVal = 0.0;
  if (nParamCount === 0) {
    nVal = this.aPos.Col() + 1;
    if (this.bMatrixFormula) {
      let nCols = 0;
      let nRows = 0;
      if (this.pMyFormulaCell) ({ nCols, nRows } = this.pMyFormulaCell.GetMatColsRows());
      let bMayBeScalar: boolean;
      if (nCols === 0) {
        // Happens if called via ScViewFunc::EnterMatrix()
        // ScFormulaCell::GetResultDimensions() as of course a
        // matrix result is not available yet.
        nCols = 1;
        bMayBeScalar = false;
      } else bMayBeScalar = true;
      if (!bMayBeScalar || nCols !== 1 || nRows !== 1) {
        const pResMat = this.GetNewMat(nCols, 1, /*bEmpty*/ true);
        for (let i = 0; i < nCols; ++i) pResMat.PutDouble(nVal + i, i, 0);
        this.PushMatrix(pResMat);
        return;
      }
    }
  } else {
    switch (this.GetStackType()) {
      case svSingleRef: {
        const aAdr = this.PopSingleRef();
        nVal = aAdr.Col() + 1;
        break;
      }
      case svDoubleRef: {
        const r = this.PopDoubleRef();
        const nCol1 = r.aStart.Col();
        const nCol2 = r.aEnd.Col();
        if (nCol2 > nCol1) {
          const pResMat = this.GetNewMat(nCol2 - nCol1 + 1, 1, /*bEmpty*/ true);
          for (let i = nCol1; i <= nCol2; i++) pResMat.PutDouble(i + 1, i - nCol1, 0);
          this.PushMatrix(pResMat);
          return;
        } else nVal = nCol1 + 1;
        break;
      }
      default:
        this.SetError(FormulaError.IllegalParameter);
    }
  }
  this.PushDouble(nVal);
};

ScInterpreter.prototype.ScRow = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 0, 1)) return;

  let nVal = 0.0;
  if (nParamCount === 0) {
    nVal = this.aPos.Row() + 1;
    if (this.bMatrixFormula) {
      let nCols = 0;
      let nRows = 0;
      if (this.pMyFormulaCell) ({ nCols, nRows } = this.pMyFormulaCell.GetMatColsRows());
      let bMayBeScalar: boolean;
      if (nRows === 0) {
        // Happens if called via ScViewFunc::EnterMatrix()
        // ScFormulaCell::GetResultDimensions() as of course a
        // matrix result is not available yet.
        nRows = 1;
        bMayBeScalar = false;
      } else bMayBeScalar = true;
      if (!bMayBeScalar || nCols !== 1 || nRows !== 1) {
        const pResMat = this.GetNewMat(1, nRows, /*bEmpty*/ true);
        for (let i = 0; i < nRows; i++) pResMat.PutDouble(nVal + i, 0, i);
        this.PushMatrix(pResMat);
        return;
      }
    }
  } else {
    switch (this.GetStackType()) {
      case svSingleRef: {
        const aAdr = this.PopSingleRef();
        nVal = aAdr.Row() + 1;
        break;
      }
      case svDoubleRef: {
        const r = this.PopDoubleRef();
        const nRow1 = r.aStart.Row();
        const nRow2 = r.aEnd.Row();
        if (nRow2 > nRow1) {
          const pResMat = this.GetNewMat(1, nRow2 - nRow1 + 1, /*bEmpty*/ true);
          for (let i = nRow1; i <= nRow2; i++) pResMat.PutDouble(i + 1, 0, i - nRow1);
          this.PushMatrix(pResMat);
          return;
        } else nVal = nRow1 + 1;
        break;
      }
      default:
        this.SetError(FormulaError.IllegalParameter);
    }
  }
  this.PushDouble(nVal);
};

ScInterpreter.prototype.ScSheet = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 0, 1)) return;

  let nVal = 0;
  if (nParamCount === 0) nVal = this.aPos.Tab() + 1;
  else {
    switch (this.GetStackType()) {
      case svString: {
        const aStr = this.PopString();
        nVal = this.mrDoc.GetTable(aStr);
        if (nVal >= 0) ++nVal;
        else this.SetError(FormulaError.IllegalArgument);
        break;
      }
      case svSingleRef: {
        const aAdr = this.PopSingleRef();
        nVal = aAdr.Tab() + 1;
        break;
      }
      case svDoubleRef: {
        const r = this.PopDoubleRef();
        nVal = r.aStart.Tab() + 1;
        break;
      }
      default:
        this.SetError(FormulaError.IllegalParameter);
    }
    if (this.nGlobalError !== FormulaError.NONE) nVal = 0;
  }
  this.PushDouble(nVal);
};

/** Read the search value of MATCH/XMATCH/XLOOKUP into vsa; false if a result was pushed. */
function lcl_GetSearchValue(self: ScInterpreter, vsa: VectorSearchArguments, bNewSearchFunction: boolean): boolean {
  switch (bNewSearchFunction ? self.GetRawStackType() : self.GetStackType()) {
    case svMissing:
    case svEmptyCell:
      vsa.isEmptySearch = true;
      vsa.isStringSearch = false;
      vsa.sSearchStr = self.GetString();
      break;
    case svDouble:
      vsa.isStringSearch = false;
      vsa.fSearchVal = self.GetDouble();
      break;
    case svString:
      vsa.isStringSearch = true;
      vsa.sSearchStr = self.GetString();
      break;
    case svDoubleRef:
    case svSingleRef: {
      const aAdr = self.PopDoubleRefOrSingleRef();
      if (!aAdr) {
        self.PushInt(0);
        return false;
      }
      const aCell = self.mrDoc.GetRefCellValue(aAdr);
      if (aCell.hasNumeric()) {
        vsa.isStringSearch = false;
        vsa.fSearchVal = self.GetCellValue(aAdr, aCell);
      } else {
        vsa.isStringSearch = true;
        vsa.sSearchStr = self.GetCellString(aCell);
      }
      break;
    }
    case svMatrix: {
      const r = self.GetDoubleOrStringFromMatrix();
      vsa.fSearchVal = r.fVal;
      vsa.sSearchStr = r.aStr;
      vsa.isStringSearch = ScMatrix.IsNonValueType(r.nType);
      break;
    }
    default:
      self.PushIllegalParameter();
      return false;
  }
  return true;
}

/** Get the vector to be searched (MATCH, XMATCH); false if an error was pushed. */
function lcl_GetSearchVector(self: ScInterpreter, vsa: VectorSearchArguments): boolean {
  switch (self.GetStackType()) {
    case svSingleRef: {
      const aAdr = self.PopSingleRef();
      vsa.nCol1 = aAdr.Col();
      vsa.nRow1 = aAdr.Row();
      vsa.nTab1 = aAdr.Tab();
      vsa.nCol2 = vsa.nCol1;
      vsa.nRow2 = vsa.nRow1;
      vsa.pMatSrc = null;
      break;
    }
    case svDoubleRef: {
      vsa.pMatSrc = null;
      const r = self.PopDoubleRef();
      vsa.nCol1 = r.aStart.Col();
      vsa.nRow1 = r.aStart.Row();
      vsa.nTab1 = r.aStart.Tab();
      vsa.nCol2 = r.aEnd.Col();
      vsa.nRow2 = r.aEnd.Row();
      const nTab2 = r.aEnd.Tab();
      if (vsa.nTab1 !== nTab2 || (vsa.nCol1 !== vsa.nCol2 && vsa.nRow1 !== vsa.nRow2)) {
        self.PushIllegalParameter();
        return false;
      }
      break;
    }
    case svMatrix: {
      vsa.pMatSrc = self.PopMatrix();
      if (!vsa.pMatSrc) {
        self.PushIllegalParameter();
        return false;
      }
      break;
    }
    default:
      self.PushIllegalParameter();
      return false;
  }
  return true;
}

ScInterpreter.prototype.ScMatch = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 2, 3)) return;

  const vsa = newVectorSearchArguments();
  vsa.nSearchOpCode = OC.ocMatch;

  // get match mode
  const fType = nParamCount === 3 ? this.GetDouble() : 1.0;
  switch (Math.trunc(fType)) {
    case -1:
      vsa.eMatchMode = MatchMode.exactorG;
      vsa.eSearchMode = LookupSearchMode.BinaryDescending;
      break;
    case 0:
      vsa.eMatchMode = MatchMode.exactorNA;
      vsa.eSearchMode = LookupSearchMode.Forward;
      break;
    case 1:
      // default value
      vsa.eMatchMode = MatchMode.exactorS;
      vsa.eSearchMode = LookupSearchMode.BinaryAscending;
      break;
    default:
      this.PushIllegalParameter();
      return;
  }

  // get vector to be searched
  if (!lcl_GetSearchVector(this, vsa)) return;

  // get search value
  if (this.nGlobalError === FormulaError.NONE) {
    if (!lcl_GetSearchValue(this, vsa, false)) return;

    // execute search
    if (this.SearchVectorForValue(vsa)) this.PushDouble(vsa.nIndex);
    else {
      if (vsa.isResultNA) this.PushNA();
      else return; // error occurred and has already been pushed
    }
  } else this.PushIllegalParameter();
};

ScInterpreter.prototype.ScXMatch = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 2, 4)) return;

  const vsa = newVectorSearchArguments();
  vsa.nSearchOpCode = OC.ocXMatch;

  // get search mode
  if (nParamCount === 4) {
    const k = this.GetInt16();
    if (k >= -2 && k <= 2 && k !== 0) vsa.eSearchMode = k as LookupSearchMode;
    else {
      this.PushIllegalParameter();
      return;
    }
  } else vsa.eSearchMode = LookupSearchMode.Forward;

  // get match mode
  if (nParamCount >= 3) {
    const k = this.GetInt16();
    if (k >= -1 && k <= 3) vsa.eMatchMode = k as MatchMode;
    else {
      this.PushIllegalParameter();
      return;
    }
  } else vsa.eMatchMode = MatchMode.exactorNA;

  // get vector to be searched
  if (!lcl_GetSearchVector(this, vsa)) return;

  // get search value
  if (this.nGlobalError === FormulaError.NONE) {
    if (!lcl_GetSearchValue(this, vsa, true)) return;

    // execute search
    if (this.SearchVectorForValue(vsa)) this.PushDouble(vsa.nIndex);
    else {
      if (vsa.isResultNA) this.PushNA();
      else return; // error occurred and has already been pushed
    }
  } else this.PushIllegalParameter();
};

ScInterpreter.prototype.SearchMatrixForValue = function (this: ScInterpreter, vsa: VectorSearchArguments, rParam: ScQueryParam, rEntry: ScQueryEntry, rItem: ScQueryEntryItem): boolean {
  const pMatSrc = vsa.pMatSrc!;
  const { nC, nR } = pMatSrc.GetDimensions();
  if (nC > 1 && nR > 1) {
    // The source matrix must be a vector.
    this.PushIllegalParameter();
    return false;
  }
  vsa.bVLookup = nC === 1;

  // Do not propagate errors from matrix while searching.
  pMatSrc.SetErrorInterpreter(null);

  const nMatCount = vsa.bVLookup ? nR : nC;
  const aMatAcc = new VectorMatrixAccessor(pMatSrc, vsa.bVLookup);
  const bMatchWholeCell = this.mrDoc.GetDocOptions().IsMatchWholeCell();

  switch (vsa.eSearchMode) {
    case LookupSearchMode.Forward: {
      switch (vsa.eMatchMode) {
        case MatchMode.exactorNA:
        case MatchMode.wildcard:
          // simple serial search for equality mode (source data doesn't
          // need to be sorted).
          for (let i = 0; i < nMatCount; ++i) {
            if (lcl_CompareMatrix2Query(i, aMatAcc, rParam, rEntry, bMatchWholeCell) === 0) {
              vsa.nHitIndex = i + 1; // found !
              break;
            }
          }
          break;

        case MatchMode.exactorS:
        case MatchMode.exactorG:
          for (let i = 0; i < nMatCount; ++i) {
            const result = lcl_CompareMatrix2Query(i, aMatAcc, rParam, rEntry, bMatchWholeCell);
            if (result === 0) {
              vsa.nHitIndex = i + 1; // found !
              break;
            } else if (vsa.eMatchMode === MatchMode.exactorS && result === -1) {
              if (vsa.nBestFit === SCSIZE_MAX) vsa.nBestFit = i;
              else {
                // replace value of vsa.nBestFit if value(i) > value(vsa.nBestFit)
                if (lcl_Compare2MatrixCells(i, aMatAcc, vsa.nBestFit) === 1) vsa.nBestFit = i;
              }
            } else if (vsa.eMatchMode === MatchMode.exactorG && result === 1) {
              if (vsa.nBestFit === SCSIZE_MAX) vsa.nBestFit = i;
              else {
                // replace value of vsa.nBestFit if value(i) < value(vsa.nBestFit)
                if (lcl_Compare2MatrixCells(i, aMatAcc, vsa.nBestFit) === -1) vsa.nBestFit = i;
              }
            }
            // else do nothing
          }
          break;

        default:
          this.PushIllegalParameter();
          return false;
      }
      break;
    }

    case LookupSearchMode.Reverse: {
      switch (vsa.eMatchMode) {
        case MatchMode.exactorNA:
        case MatchMode.wildcard:
          // simple serial search for equality mode (source data doesn't
          // need to be sorted).
          for (let i = nMatCount; i > 0; i--) {
            if (lcl_CompareMatrix2Query(i - 1, aMatAcc, rParam, rEntry, bMatchWholeCell) === 0) {
              vsa.nHitIndex = i; // found !
              break;
            }
          }
          break;

        case MatchMode.exactorS:
        case MatchMode.exactorG:
          for (let i = nMatCount - 1; i-- > 0; ) {
            const result = lcl_CompareMatrix2Query(i, aMatAcc, rParam, rEntry, bMatchWholeCell);
            if (result === 0) {
              vsa.nHitIndex = i + 1; // found !
              break;
            } else if (vsa.eMatchMode === MatchMode.exactorS && result === -1) {
              if (vsa.nBestFit === SCSIZE_MAX) vsa.nBestFit = i;
              else {
                // replace value of vsa.nBestFit if value(i) > value(vsa.nBestFit)
                if (lcl_Compare2MatrixCells(i, aMatAcc, vsa.nBestFit) === 1) vsa.nBestFit = i;
              }
            } else if (vsa.eMatchMode === MatchMode.exactorG && result === 1) {
              if (vsa.nBestFit === SCSIZE_MAX) vsa.nBestFit = i;
              else {
                // replace value of vsa.nBestFit if value(i) < value(vsa.nBestFit)
                if (lcl_Compare2MatrixCells(i, aMatAcc, vsa.nBestFit) === -1) vsa.nBestFit = i;
              }
            }
            // else do nothing
          }
          break;

        default:
          this.PushIllegalParameter();
          return false;
      }
      break;
    }

    case LookupSearchMode.BinaryAscending:
    case LookupSearchMode.BinaryDescending: {
      // binary search for non-equality mode (the source data is sorted)
      const bAscOrder = rEntry.eOp === ScQueryOp.SC_LESS_EQUAL;
      let nFirst = 0, nLast = nMatCount - 1, nHitIndex = 0;
      for (let nLen = nLast - nFirst; nLen > 0; nLen = nLast - nFirst) {
        let nMid = nFirst + Math.floor(nLen / 2);
        const nCmp = lcl_CompareMatrix2Query(nMid, aMatAcc, rParam, rEntry, bMatchWholeCell);
        if (nCmp === 0) {
          // exact match.  find the last item with the same value.
          nMid = lcl_GetLastMatch(nMid, aMatAcc, nMatCount);
          vsa.nHitIndex = nMid + 1;
          return true;
        }
        if (nLen === 1) {
          // first and last items are next to each other.
          if (nCmp < 0) nHitIndex = bAscOrder ? nLast : nFirst;
          else nHitIndex = bAscOrder ? nFirst : nLast;
          break;
        }
        if (nCmp < 0) {
          if (bAscOrder) nFirst = nMid;
          else nLast = nMid;
        } else {
          if (bAscOrder) nLast = nMid;
          else nFirst = nMid;
        }
      }
      if (nHitIndex === nMatCount - 1) {
        // last item
        const nCmp = lcl_CompareMatrix2Query(nHitIndex, aMatAcc, rParam, rEntry, bMatchWholeCell);
        if ((bAscOrder && nCmp <= 0) || (!bAscOrder && nCmp >= 0)) {
          // either the last item is an exact match or the real
          // hit is beyond the last item.
          vsa.nHitIndex = nHitIndex + 1;
          return true;
        }
      }
      vsa.nHitIndex = nHitIndex;
      break;
    }

    default:
      this.PushIllegalParameter();
      return false;
  }

  if (vsa.nHitIndex > 0 && ((rItem.meType === ScQueryEntry.ByString && aMatAcc.IsValue(vsa.nHitIndex - 1)) || (rItem.meType === ScQueryEntry.ByValue && !aMatAcc.IsValue(vsa.nHitIndex - 1)))) {
    vsa.nHitIndex = 0;
    vsa.isResultNA = true;
    return false;
  }
  return true;
};

ScInterpreter.prototype.SearchRangeForValue = function (this: ScInterpreter, vsa: VectorSearchArguments, rParam: ScQueryParam, rEntry: ScQueryEntry): boolean {
  vsa.bVLookup = vsa.nCol1 === vsa.nCol2;
  switch (vsa.eSearchMode) {
    case LookupSearchMode.Forward:
    case LookupSearchMode.Reverse:
    case LookupSearchMode.BinaryAscending:
    case LookupSearchMode.BinaryDescending: {
      if (vsa.bVLookup) {
        // search of rows in column
        rParam.bByRow = true;
        const aResultPos = new ScAddress(vsa.nCol1, vsa.nRow1, vsa.nTab1);
        if (this.LookupQueryWithCache(aResultPos, rParam, vsa.eSearchMode, vsa.nSearchOpCode)) vsa.nHitIndex = aResultPos.Row() - vsa.nRow1 + 1;
      } else {
        rParam.bByRow = false;
        // The sorted range cache of the binary search modes of XLOOKUP/XMATCH is not
        // ported: search linearly from the start instead.
        // search of columns in row
        const bReverseSearch = vsa.eSearchMode === LookupSearchMode.Reverse;
        const aCellIter = new ScQueryCellIterator(this.mrDoc, vsa.nTab1, rParam, false, bReverseSearch);
        // Advance Entry.nField in Iterator if column changed
        aCellIter.SetAdvanceQueryParamEntryField(true);
        aCellIter.SetLookupMode(vsa.nSearchOpCode);
        aCellIter.SetSortedBinarySearchMode(bReverseSearch ? LookupSearchMode.Reverse : LookupSearchMode.Forward);
        const aResultPos = new ScAddress(vsa.nCol1, vsa.nRow1, vsa.nTab1);
        let bFound = false;
        if (rEntry.eOp === ScQueryOp.SC_EQUAL) {
          if (aCellIter.GetFirst()) {
            aResultPos.SetCol(aCellIter.GetCol());
            bFound = true;
          }
        } else {
          const r = aCellIter.FindEqualOrSortedLastInRange();
          if (r.bFound) {
            aResultPos.SetCol(r.nFoundCol);
            bFound = true;
          }
        }
        if (bFound) {
          if (vsa.eSearchMode === LookupSearchMode.BinaryAscending || vsa.eSearchMode === LookupSearchMode.BinaryDescending) lcl_LastOfEqualRun(aResultPos, this.mrDoc, rParam, vsa.eSearchMode);
          vsa.nHitIndex = aResultPos.Col() - vsa.nCol1 + 1;
        }
      }
      break;
    }

    default:
      this.PushIllegalParameter();
      return false;
  }
  return true;
};

/** When search value is found, the index is stored in struct VectorSearchArguments.nIndex
    and SearchVectorForValue() returns true. When search value is not found or an error
    occurs, SearchVectorForValue() pushes the relevant (error)message and returns false,
    expect when SearchVectorForValue() is called by ScXLookup and the search value is not
    found.
    This difference in behaviour is because MATCH returns the found index and XLOOKUP
    uses the found index to determine the result(s) to be pushed and may return a custom
    value when the search value is not found.
*/
ScInterpreter.prototype.SearchVectorForValue = function (this: ScInterpreter, vsa: VectorSearchArguments): boolean {
  // preparations
  const rParam = new ScQueryParam();
  rParam.nCol1 = vsa.nCol1;
  rParam.nRow1 = vsa.nRow1;
  rParam.nCol2 = vsa.nCol2;
  rParam.nRow2 = vsa.nRow2;
  rParam.nTab = vsa.nTab1;

  const rEntry = rParam.GetEntry(0);
  rEntry.nField = vsa.eSearchMode !== LookupSearchMode.Reverse ? vsa.nCol1 : vsa.nCol2;
  rEntry.bDoQuery = true;
  switch (vsa.eMatchMode) {
    case MatchMode.exactorNA:
      rEntry.eOp = ScQueryOp.SC_EQUAL;
      break;

    case MatchMode.exactorS:
      rEntry.eOp = ScQueryOp.SC_LESS_EQUAL;
      break;

    case MatchMode.exactorG:
      rEntry.eOp = ScQueryOp.SC_GREATER_EQUAL;
      break;

    case MatchMode.wildcard:
    case MatchMode.regex:
      // this mode can only used with XLOOKUP/XMATCH
      if (vsa.nSearchOpCode === OC.ocXLookup || vsa.nSearchOpCode === OC.ocXMatch) {
        // Wildcard/Regex search mode with binary search is not allowed
        if (vsa.eSearchMode === LookupSearchMode.BinaryAscending || vsa.eSearchMode === LookupSearchMode.BinaryDescending) {
          this.PushNoValue();
          return false;
        }

        rEntry.eOp = ScQueryOp.SC_EQUAL;
        if (vsa.isStringSearch) {
          if (vsa.eMatchMode === MatchMode.wildcard && MayBeWildcard(vsa.sSearchStr)) rParam.eSearchType = utlSearchType.Wildcard;
          else if (vsa.eMatchMode === MatchMode.regex && MayBeRegExp(vsa.sSearchStr)) rParam.eSearchType = utlSearchType.Regexp;
          else rParam.eSearchType = utlSearchType.Normal;
        }
      } else {
        this.PushIllegalParameter();
        return false;
      }
      break;

    default:
      this.PushIllegalParameter();
      return false;
  }

  const rItem = rEntry.GetQueryItem();
  // allow to match empty cells as result if we are looking for the next smaller
  // or larger values in case of the new lookup functions
  if (rEntry.eOp !== ScQueryOp.SC_EQUAL && (vsa.nSearchOpCode === OC.ocXLookup || vsa.nSearchOpCode === OC.ocXMatch)) rItem.mbMatchEmpty = true;

  if (vsa.isStringSearch) {
    rItem.meType = ScQueryEntry.ByString;
    rItem.maString = vsa.sSearchStr;
    if (vsa.nSearchOpCode === OC.ocMatch) rParam.eSearchType = this.DetectSearchType(rEntry.GetQueryItem().maString, this.mrDoc);
  } else if (vsa.isEmptySearch && (vsa.nSearchOpCode === OC.ocXLookup || vsa.nSearchOpCode === OC.ocXMatch)) {
    rEntry.SetQueryByEmpty();
    rItem.mbMatchEmpty = true;
  } else {
    rItem.mfVal = vsa.fSearchVal;
    rItem.meType = ScQueryEntry.ByValue;
  }

  // execute search
  if (vsa.pMatSrc) {
    // The source data is matrix array.
    if (!this.SearchMatrixForValue(vsa, rParam, rEntry, rItem)) return false;
  } else {
    // not a matrix
    if (!this.SearchRangeForValue(vsa, rParam, rEntry)) return false;
  }

  // MATCH expects index starting with 1, XLOOKUP expects index starting with 0
  if (vsa.nHitIndex > 0) {
    vsa.nIndex = vsa.nSearchOpCode === OC.ocXLookup ? --vsa.nHitIndex : vsa.nHitIndex;
    return true;
  } else if (vsa.nHitIndex === 0 && vsa.nBestFit !== SCSIZE_MAX) {
    if (vsa.nSearchOpCode === OC.ocXLookup) {
      vsa.nIndex = vsa.nBestFit;
      if (!vsa.pMatSrc) vsa.nIndex -= vsa.bVLookup ? vsa.nRow1 : vsa.nCol1;
    } else vsa.nIndex = ++vsa.nBestFit;
    return true;
  }

  // nomatch
  vsa.isResultNA = true;
  return false;
};

/** In place of the sorted range cache of the binary search modes: the linear search found the
    first of a run of equal cells; the sorted cache finds the one next to the searched value in
    ascending order, which is the last of the run for an ascending search of the next smaller
    value, or a descending search of an equal or the next larger value. */
function lcl_LastOfEqualRun(o_rResultPos: ScAddress, rDoc: ScDocument, rParam: ScQueryParam, nSearchMode: LookupSearchMode): void {
  const aFound = rDoc.GetRefCellValue(o_rResultPos);
  const bNumeric = aFound.hasNumeric();
  const aStr = bNumeric ? '' : aFound.getString();
  const fVal = bNumeric ? aFound.getValue() : 0;
  const rCollator = GetCollator(rParam.bCaseSens);
  const rItem = rParam.GetEntry(0).GetQueryItem();
  const bExact = bNumeric ? rItem.meType === ScQueryEntry.ByValue && rtl_math_approxEqual(fVal, rItem.mfVal) : rItem.meType === ScQueryEntry.ByString && rCollator.compareString(aStr, rItem.maString) === 0;
  const bSmallerRun = rParam.GetEntry(0).eOp === ScQueryOp.SC_LESS_EQUAL && !bExact;
  if ((nSearchMode === LookupSearchMode.BinaryAscending) !== bSmallerRun) return;
  for (;;) {
    const aNext = o_rResultPos.clone();
    if (rParam.bByRow) aNext.SetRow(aNext.Row() + 1);
    else aNext.SetCol(aNext.Col() + 1);
    if (aNext.Row() > rParam.nRow2 || aNext.Col() > rParam.nCol2) return;
    const aCell = rDoc.GetRefCellValue(aNext);
    if (aCell.isEmpty() || aCell.hasNumeric() !== bNumeric) return;
    if (bNumeric ? !rtl_math_approxEqual(aCell.getValue(), fVal) : rCollator.compareString(aCell.getString(), aStr) !== 0) return;
    o_rResultPos.Set(aNext.Col(), aNext.Row(), aNext.Tab());
  }
}

function lcl_LookupQuery(o_rResultPos: ScAddress, rDoc: ScDocument, rParam: ScQueryParam, rEntry: ScQueryEntry, nSearchMode: LookupSearchMode, nOpCode: number): boolean {
  // The sorted range cache (ScQueryCellIteratorSortedCache) of the binary search modes of
  // XLOOKUP/XMATCH is not ported: those search linearly and position on the last of equal cells.
  const bBinarySearch = nSearchMode === LookupSearchMode.BinaryAscending || nSearchMode === LookupSearchMode.BinaryDescending;
  const bSortedCache = bBinarySearch && (nOpCode === OC.ocXLookup || nOpCode === OC.ocXMatch);
  const nIterSearchMode = bSortedCache ? LookupSearchMode.Forward : nSearchMode;
  if (rEntry.eOp !== ScQueryOp.SC_EQUAL) {
    // range lookup <= or >=
    const bReverse = nIterSearchMode === LookupSearchMode.Reverse;
    const aCellIter = new ScQueryCellIterator(rDoc, rParam.nTab, rParam, false, bReverse);

    aCellIter.SetSortedBinarySearchMode(nIterSearchMode);
    aCellIter.SetLookupMode(nOpCode);
    const r = aCellIter.FindEqualOrSortedLastInRange();
    if (r.bFound) {
      o_rResultPos.SetCol(r.nFoundCol);
      o_rResultPos.SetRow(r.nFoundRow);
      if (bSortedCache) lcl_LastOfEqualRun(o_rResultPos, rDoc, rParam, nSearchMode);
      return true;
    }
  } // EQUAL
  else {
    const aCellIter = new ScQueryCellIterator(rDoc, rParam.nTab, rParam, false, nIterSearchMode === LookupSearchMode.Reverse);
    aCellIter.SetSortedBinarySearchMode(nIterSearchMode);
    aCellIter.SetLookupMode(nOpCode);
    if (aCellIter.GetFirst()) {
      o_rResultPos.SetCol(aCellIter.GetCol());
      o_rResultPos.SetRow(aCellIter.GetRow());
      if (bSortedCache) lcl_LastOfEqualRun(o_rResultPos, rDoc, rParam, nSearchMode);
      return true;
    }
  }
  return false;
}

ScInterpreter.prototype.LookupQueryWithCache = function (this: ScInterpreter, o_rResultPos: ScAddress, rParam: ScQueryParam, nSearchMode: LookupSearchMode, nOpCode: number): boolean {
  // The lookup cache (ScLookupCache) is not ported: always query.
  const rEntry = rParam.GetEntry(0);
  return lcl_LookupQuery(o_rResultPos, this.mrDoc, rParam, rEntry, nSearchMode, nOpCode);
};

ScInterpreter.prototype.FillEntry = function (this: ScInterpreter, rEntry: ScQueryEntry): boolean {
  const rItem = rEntry.GetQueryItem();
  switch (this.GetStackType()) {
    case svDouble:
      rItem.meType = ScQueryEntry.ByValue;
      rItem.mfVal = this.GetDouble();
      break;
    case svString:
      rItem.meType = ScQueryEntry.ByString;
      rItem.maString = this.GetString();
      break;
    case svDoubleRef:
    case svSingleRef: {
      const aAdr = this.PopDoubleRefOrSingleRef();
      if (!aAdr) {
        this.PushInt(0);
        return false;
      }
      const aCell = this.mrDoc.GetRefCellValue(aAdr);
      if (aCell.hasNumeric()) {
        rItem.meType = ScQueryEntry.ByValue;
        rItem.mfVal = this.GetCellValue(aAdr, aCell);
      } else {
        rItem.maString = this.GetCellString(aCell);
        rItem.meType = ScQueryEntry.ByString;
      }
      break;
    }
    case svMatrix: {
      const r = this.GetDoubleOrStringFromMatrix();
      rItem.mfVal = r.fVal;
      rItem.maString = r.aStr;
      rItem.meType = ScMatrix.IsNonValueType(r.nType) ? ScQueryEntry.ByString : ScQueryEntry.ByValue;
      break;
    }
    default:
      this.PushIllegalParameter();
      return false;
  } // switch ( GetStackType() )
  return true;
};

/** Push the value at nDelta of a LOOKUP result vector (shared by the array and the range search). */
function lcl_LookupPushResult(self: ScInterpreter, nDelta: number, eResArrayType: number, fResVal: number, aResStr: string, nResCol1: SCCOL, nResRow1: SCROW, nResRow2: SCROW, nResTab: SCTAB): void {
  switch (eResArrayType) {
    case svDoubleRef:
    case svSingleRef: {
      // Use the result array vector.  Note that the result array is assumed
      // to be a vector (i.e. 1-dimensional array).

      const aAdr = new ScAddress(0, 0, nResTab);
      const bResVertical = nResRow2 - nResRow1 > 0;
      if (bResVertical) {
        const nTempRow = nResRow1 + nDelta;
        if (nTempRow > self.mrDoc.MaxRow()) {
          self.PushDouble(0);
          return;
        }
        aAdr.SetCol(nResCol1);
        aAdr.SetRow(nTempRow);
      } else {
        const nTempCol = nResCol1 + nDelta;
        if (nTempCol > self.mrDoc.MaxCol()) {
          self.PushDouble(0);
          return;
        }
        aAdr.SetCol(nTempCol);
        aAdr.SetRow(nResRow1);
      }
      self.PushCellResultToken(true, aAdr);
      break;
    }
    case svDouble:
    case svString: {
      if (nDelta !== 0) self.PushNA();
      else {
        switch (eResArrayType) {
          case svDouble:
            self.PushDouble(fResVal);
            break;
          case svString:
            self.PushString(aResStr);
            break;
          default:
          // nothing
        }
      }
      break;
    }
    default:
      self.PushIllegalParameter();
  }
}

ScInterpreter.prototype.ScLookup = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 2, 3)) return;

  let pDataMat: ScMatrix | null = null;
  let pResMat: ScMatrix | null = null;
  let nCol1 = 0, nCol2 = 0, nResCol1 = 0, nResCol2 = 0;
  let nRow1 = 0, nRow2 = 0, nResRow1 = 0, nResRow2 = 0;
  let nTab1 = 0, nResTab = 0;
  let nLenMajor = 0; // length of major direction
  let bVertical = true; // whether to lookup vertically or horizontally

  // The third parameter, result array, double, string and reference.
  let fResVal = 0.0;
  let aResStr = '';
  let eResArrayType: number = svUnknown;

  if (nParamCount === 3) {
    eResArrayType = this.GetStackType();
    switch (eResArrayType) {
      case svDoubleRef: {
        const r = this.PopDoubleRef();
        nResCol1 = r.aStart.Col();
        nResRow1 = r.aStart.Row();
        nResTab = r.aStart.Tab();
        nResCol2 = r.aEnd.Col();
        nResRow2 = r.aEnd.Row();
        const nTabJunk = r.aEnd.Tab();
        if (nResTab !== nTabJunk || (nResRow2 - nResRow1 > 0 && nResCol2 - nResCol1 > 0)) {
          // The result array must be a vector.
          this.PushIllegalParameter();
          return;
        }
        break;
      }
      case svSingleRef: {
        const aAdr = this.PopSingleRef();
        nResCol1 = aAdr.Col();
        nResRow1 = aAdr.Row();
        nResTab = aAdr.Tab();
        nResCol2 = nResCol1;
        nResRow2 = nResRow1;
        break;
      }
      case svMatrix: {
        pResMat = this.GetMatrix();
        if (!pResMat) {
          this.PushIllegalParameter();
          return;
        }
        const { nC, nR } = pResMat.GetDimensions();
        if (nC !== 1 && nR !== 1) {
          // Result matrix must be a vector.
          this.PushIllegalParameter();
          return;
        }
        nResCol2 = nC - 1;
        nResRow2 = nR - 1;
        break;
      }
      case svDouble:
        fResVal = this.GetDouble();
        break;
      case svString:
        aResStr = this.GetString();
        break;
      default:
        this.PushIllegalParameter();
        return;
    }
  }

  // For double, string and single reference.
  let fDataVal = 0.0;
  let aDataStr = '';
  let aDataAdr = new ScAddress();
  let bValueData = false;

  // Get the data-result range and also determine whether this is vertical
  // lookup or horizontal lookup.

  const eDataArrayType = this.GetStackType();
  switch (eDataArrayType) {
    case svDoubleRef: {
      const r = this.PopDoubleRef();
      nCol1 = r.aStart.Col();
      nRow1 = r.aStart.Row();
      nTab1 = r.aStart.Tab();
      nCol2 = r.aEnd.Col();
      nRow2 = r.aEnd.Row();
      const nTabJunk = r.aEnd.Tab();
      if (nTab1 !== nTabJunk) {
        this.PushIllegalParameter();
        return;
      }
      bVertical = nRow2 - nRow1 >= nCol2 - nCol1;
      nLenMajor = bVertical ? nRow2 - nRow1 + 1 : nCol2 - nCol1 + 1;
      break;
    }
    case svMatrix: {
      pDataMat = this.GetMatrix();
      if (!pDataMat) {
        this.PushIllegalParameter();
        return;
      }

      const { nC, nR } = pDataMat.GetDimensions();
      bVertical = nR >= nC;
      nLenMajor = bVertical ? nR : nC;
      nCol2 = nC - 1;
      nRow2 = nR - 1;
      break;
    }
    case svDouble:
      fDataVal = this.GetDouble();
      bValueData = true;
      break;
    case svString:
      aDataStr = this.GetString();
      break;
    case svSingleRef: {
      aDataAdr = this.PopSingleRef();
      const aCell = this.mrDoc.GetRefCellValue(aDataAdr);
      if (aCell.hasEmptyValue()) {
        // Empty cells aren't found anywhere, bail out early.
        this.SetError(FormulaError.NotAvailable);
      } else if (aCell.hasNumeric()) {
        fDataVal = this.GetCellValue(aDataAdr, aCell);
        bValueData = true;
      } else aDataStr = this.GetCellString(aCell);
      break;
    }
    default:
      this.SetError(FormulaError.IllegalParameter);
  }

  if (this.nGlobalError !== FormulaError.NONE) {
    this.PushError(this.nGlobalError);
    return;
  }

  // Get the lookup value.

  const aParam = new ScQueryParam();
  const rEntry = aParam.GetEntry(0);
  if (!this.FillEntry(rEntry)) return;

  if (eDataArrayType === svDouble || eDataArrayType === svString || eDataArrayType === svSingleRef) {
    // Delta position for a single value is always 0.

    // Found if data <= query, but not if query is string and found data is
    // numeric or vice versa. This is how Excel does it but doesn't
    // document it.

    let bFound = false;
    const rItem = rEntry.GetQueryItem();

    if (bValueData) {
      if (rItem.meType === ScQueryEntry.ByString) bFound = false;
      else bFound = fDataVal <= rItem.mfVal;
    } else {
      if (rItem.meType !== ScQueryEntry.ByString) bFound = false;
      else bFound = GetCollator().compareString(aDataStr, rItem.maString) <= 0;
    }

    if (!bFound) {
      this.PushNA();
      return;
    }

    if (pResMat) {
      if (pResMat.IsValue(0, 0)) this.PushDouble(pResMat.GetDouble(0, 0));
      else this.PushString(pResMat.GetString(0, 0));
    } else if (nParamCount === 3) {
      switch (eResArrayType) {
        case svDouble:
          this.PushDouble(fResVal);
          break;
        case svString:
          this.PushString(aResStr);
          break;
        case svDoubleRef:
        case svSingleRef:
          this.PushCellResultToken(true, new ScAddress(nResCol1, nResRow1, nResTab));
          break;
        default:
          this.PushIllegalParameter();
      }
    } else {
      switch (eDataArrayType) {
        case svDouble:
          this.PushDouble(fDataVal);
          break;
        case svString:
          this.PushString(aDataStr);
          break;
        case svSingleRef:
          this.PushCellResultToken(true, aDataAdr);
          break;
        default:
          this.PushIllegalParameter();
      }
    }
    return;
  }

  // Now, perform the search to compute the delta position (nDelta).

  if (pDataMat) {
    // Data array is given as a matrix.
    rEntry.bDoQuery = true;
    rEntry.eOp = ScQueryOp.SC_LESS_EQUAL;
    let bFound = false;

    const { nC, nR } = pDataMat.GetDimensions();

    // Do not propagate errors from matrix while copying to vector.
    pDataMat.SetErrorInterpreter(null);

    // Excel has an undocumented behaviour in that it seems to internally
    // sort an interim array (i.e. error values specifically #DIV/0! are
    // sorted to the end) or ignore error values that makes these "get last
    // non-empty" searches work, e.g. =LOOKUP(2,1/NOT(ISBLANK(A:A)),A:A)
    // see tdf#117016
    // Instead of sorting a million entries of which mostly only a bunch of
    // rows are filled and moving error values to the end which most are
    // already anyway, assume the matrix to be sorted except error values
    // and omit the coded DoubleError values.
    // Do this only for a numeric matrix (that includes errors coded as
    // doubles), which covers the case in question.
    const bOmitErrorValues = eDataArrayType === svMatrix && pDataMat.IsNumeric();

    // In case of non-vector matrix, only search the first row or column.
    let pDataMat2: ScMatrix;
    let vIndex: number[] = [];
    if (bOmitErrorValues) {
      const vArray: number[] = [];
      const aMatAcc = new VectorMatrixAccessor(pDataMat, bVertical);
      const nElements = aMatAcc.GetElementCount();
      for (let i = 0; i < nElements; ++i) {
        const fVal = aMatAcc.GetDouble(i);
        if (Number.isFinite(fVal)) {
          vArray.push(fVal);
          vIndex.push(i);
        }
      }
      if (!vArray.length) {
        this.PushNA();
        return;
      }
      const nElems = vArray.length;
      if (nElems === nElements) {
        // No error value omitted, use as is.
        pDataMat2 = pDataMat;
        vIndex = [];
      } else {
        nLenMajor = nElems;
        if (bVertical) {
          const pTempMat = this.GetNewMat(1, nElems, /*bEmpty*/ true);
          for (let i = 0; i < nElems; ++i) pTempMat.PutDouble(vArray[i]!, 0, i);
          pDataMat2 = pTempMat;
        } else {
          const pTempMat = this.GetNewMat(nElems, 1, /*bEmpty*/ true);
          for (let i = 0; i < nElems; ++i) pTempMat.PutDouble(vArray[i]!, i, 0);
          pDataMat2 = pTempMat;
        }
      }
    } else {
      // Just use as is with the VectorMatrixAccessor.
      pDataMat2 = pDataMat;
    }

    // Do not propagate errors from matrix while searching.
    pDataMat2.SetErrorInterpreter(null);

    const aMatAcc2 = new VectorMatrixAccessor(pDataMat2, bVertical);

    // binary search for non-equality mode (the source data is
    // assumed to be sorted in ascending order).

    let nDelta = -1;
    const bMatchWholeCell = this.mrDoc.GetDocOptions().IsMatchWholeCell();

    let nFirst = 0, nLast = nLenMajor - 1; //, nHitIndex = 0;
    for (let nLen = nLast - nFirst; nLen > 0; nLen = nLast - nFirst) {
      let nMid = nFirst + Math.floor(nLen / 2);
      const nCmp = lcl_CompareMatrix2Query(nMid, aMatAcc2, aParam, rEntry, bMatchWholeCell, false /* bEmptyIsLess, instead empty are sorted to end */);
      if (nCmp === 0) {
        // exact match.  find the last item with the same value.
        nMid = lcl_GetLastMatch(nMid, aMatAcc2, nLenMajor);
        nDelta = nMid;
        bFound = true;
        break;
      }

      if (nLen === 1) {
        // first and last items are next to each other.
        nDelta = nCmp < 0 ? nLast - 1 : nFirst - 1;
        // If already the 1st item is greater there's nothing found.
        bFound = nDelta >= 0;
        break;
      }

      if (nCmp < 0) nFirst = nMid;
      else nLast = nMid;
    }

    if (nDelta === nLenMajor - 2) {
      // last item
      const nCmp = lcl_CompareMatrix2Query(nDelta + 1, aMatAcc2, aParam, rEntry, bMatchWholeCell, false /* bEmptyIsLess, instead empty are sorted to end */);
      if (nCmp <= 0) {
        // either the last item is an exact match or the real
        // hit is beyond the last item.
        nDelta += 1;
        bFound = true;
      }
    } else if (nDelta > 0) {
      // valid hit must be 2nd item or higher
      // non-exact match
      bFound = true;
    }

    // With 0-9 < A-Z, if query is numeric and data found is string, or
    // vice versa, the (yet another undocumented) Excel behavior is to
    // return #N/A instead.

    if (bFound) {
      if (vIndex.length) nDelta = vIndex[nDelta]!;

      const aMatAcc = new VectorMatrixAccessor(pDataMat, bVertical);
      let i = nDelta;
      const n = aMatAcc.GetElementCount();
      if (i >= n) i = n;
      const bByString = rEntry.GetQueryItem().meType === ScQueryEntry.ByString;
      if (bByString === aMatAcc.IsValue(i)) bFound = false;
    }

    if (!bFound) {
      this.PushNA();
      return;
    }

    // Now that we've found the delta, push the result back to the cell.

    if (pResMat) {
      const aResMatAcc = new VectorMatrixAccessor(pResMat, nResRow2 - nResRow1 > 0);
      // Result array is matrix.
      // Note this does not replicate the other dimension.
      if (nDelta >= aResMatAcc.GetElementCount()) {
        this.PushNA();
        return;
      }
      if (aResMatAcc.IsValue(nDelta)) this.PushDouble(aResMatAcc.GetDouble(nDelta));
      else this.PushString(aResMatAcc.GetString(nDelta));
    } else if (nParamCount === 3) {
      /* TODO: the entire switch is a copy of the cell range search
       * result, factor out. */
      lcl_LookupPushResult(this, nDelta, eResArrayType, fResVal, aResStr, nResCol1, nResRow1, nResRow2, nResTab);
    } else {
      // No result array. Use the data array to get the final value from.
      // Propagate errors from matrix again.
      pDataMat.SetErrorInterpreter(this);
      if (bVertical) {
        if (pDataMat.IsValue(nC - 1, nDelta)) this.PushDouble(pDataMat.GetDouble(nC - 1, nDelta));
        else this.PushString(pDataMat.GetString(nC - 1, nDelta));
      } else {
        if (pDataMat.IsValue(nDelta, nR - 1)) this.PushDouble(pDataMat.GetDouble(nDelta, nR - 1));
        else this.PushString(pDataMat.GetString(nDelta, nR - 1));
      }
    }

    return;
  }

  // Perform cell range search.

  aParam.nCol1 = nCol1;
  aParam.nRow1 = nRow1;
  aParam.nCol2 = bVertical ? nCol1 : nCol2;
  aParam.nRow2 = bVertical ? nRow2 : nRow1;
  aParam.bByRow = bVertical;

  rEntry.bDoQuery = true;
  rEntry.eOp = ScQueryOp.SC_LESS_EQUAL;
  rEntry.nField = nCol1;
  const rItem = rEntry.GetQueryItem();
  if (rItem.meType === ScQueryEntry.ByString) aParam.eSearchType = this.DetectSearchType(rItem.maString, this.mrDoc);

  const aCellIter = new ScQueryCellIterator(this.mrDoc, nTab1, aParam, false, false);
  // Advance Entry.nField in iterator upon switching columns if
  // lookup in row.
  aCellIter.SetAdvanceQueryParamEntryField(!bVertical);
  const aFound = aCellIter.FindEqualOrSortedLastInRange();
  if (!aFound.bFound) {
    this.PushNA();
    return;
  }

  const nDelta = bVertical ? aFound.nFoundRow - nRow1 : aFound.nFoundCol - nCol1;

  if (pResMat) {
    const aResMatAcc = new VectorMatrixAccessor(pResMat, nResRow2 - nResRow1 > 0);
    // Use the matrix result array.
    // Note this does not replicate the other dimension.
    if (nDelta >= aResMatAcc.GetElementCount()) {
      this.PushNA();
      return;
    }
    if (aResMatAcc.IsValue(nDelta)) this.PushDouble(aResMatAcc.GetDouble(nDelta));
    else this.PushString(aResMatAcc.GetString(nDelta));
  } else if (nParamCount === 3) {
    /* TODO: the entire switch is a copy of the array search result, factor
     * out. */
    lcl_LookupPushResult(this, nDelta, eResArrayType, fResVal, aResStr, nResCol1, nResRow1, nResRow2, nResTab);
  } else {
    // Regardless of whether or not the result array exists, the last
    // array is always used as the "result" array.

    const aAdr = new ScAddress(0, 0, nTab1);
    if (bVertical) {
      const nTempRow = nRow1 + nDelta;
      if (nTempRow > this.mrDoc.MaxRow()) {
        this.PushDouble(0);
        return;
      }
      aAdr.SetCol(nCol2);
      aAdr.SetRow(nTempRow);
    } else {
      const nTempCol = nCol1 + nDelta;
      if (nTempCol > this.mrDoc.MaxCol()) {
        this.PushDouble(0);
        return;
      }
      aAdr.SetCol(nTempCol);
      aAdr.SetRow(nRow2);
    }
    this.PushCellResultToken(true, aAdr);
  }
};

ScInterpreter.prototype.ScHLookup = function (this: ScInterpreter): void { this.CalculateLookup(true); };

ScInterpreter.prototype.CalculateLookup = function (this: ScInterpreter, bHLookup: boolean): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 3, 4)) return;

  // Optional 4th argument to declare whether or not the range is sorted.
  let bSorted = true;
  if (nParamCount === 4) bSorted = this.GetBool();

  // Index of column to search.
  const fIndex = approxFloor(this.GetDouble()) - 1.0;

  let pMat: ScMatrix | null = null;
  let nC = 0, nR = 0;
  let nCol1 = 0;
  let nRow1 = 0;
  let nTab1 = 0;
  let nCol2 = 0;
  let nRow2 = 0;
  const eType = this.GetStackType();
  if (eType === svDoubleRef) {
    const r = this.PopDoubleRef();
    nCol1 = r.aStart.Col();
    nRow1 = r.aStart.Row();
    nTab1 = r.aStart.Tab();
    nCol2 = r.aEnd.Col();
    nRow2 = r.aEnd.Row();
    if (nTab1 !== r.aEnd.Tab()) {
      this.PushIllegalParameter();
      return;
    }
  } else if (eType === svSingleRef) {
    const aAdr = this.PopSingleRef();
    nCol1 = aAdr.Col();
    nRow1 = aAdr.Row();
    nTab1 = aAdr.Tab();
    nCol2 = nCol1;
    nRow2 = nRow1;
  } else if (eType === svMatrix) {
    pMat = this.GetMatrix();

    if (pMat) ({ nC, nR } = pMat.GetDimensions());
    else {
      this.PushIllegalParameter();
      return;
    }
  } else {
    this.PushIllegalParameter();
    return;
  }

  if (fIndex < 0.0 || (bHLookup ? (pMat ? fIndex >= nR : fIndex + nRow1 > nRow2) : pMat ? fIndex >= nC : fIndex + nCol1 > nCol2)) {
    this.PushIllegalArgument();
    return;
  }

  let nZIndex = Math.trunc(fIndex);
  let nSpIndex = Math.trunc(fIndex);

  if (!pMat) {
    nZIndex += nRow1; // value row
    nSpIndex = nSpIndex + nCol1; // value column
  }

  if (this.nGlobalError !== FormulaError.NONE) {
    this.PushIllegalParameter();
    return;
  }

  const aParam = new ScQueryParam();
  aParam.nCol1 = nCol1;
  aParam.nRow1 = nRow1;
  if (bHLookup) {
    aParam.nCol2 = nCol2;
    aParam.nRow2 = nRow1; // search only in the first row
    aParam.bByRow = false;
  } else {
    aParam.nCol2 = nCol1; // search only in the first column
    aParam.nRow2 = nRow2;
    aParam.nTab = nTab1;
  }

  const rEntry = aParam.GetEntry(0);
  rEntry.bDoQuery = true;
  if (bSorted) rEntry.eOp = ScQueryOp.SC_LESS_EQUAL;
  if (!this.FillEntry(rEntry)) return;

  const rItem = rEntry.GetQueryItem();
  let aParamStr = '';
  if (rItem.meType === ScQueryEntry.ByString) {
    aParam.eSearchType = this.DetectSearchType(rItem.maString, this.mrDoc);
    aParamStr = rItem.maString;
  }

  if (pMat) {
    const nMatCount = bHLookup ? nC : nR;
    let nDelta = SCSIZE_MAX;
    if (rItem.meType === ScQueryEntry.ByString) {
      //!!!!!!!
      //TODO: enable regex on matrix strings
      //!!!!!!!
      if (bSorted) {
        const rCollator = GetCollator();
        for (let i = 0; i < nMatCount; i++) {
          if (bHLookup ? pMat.IsStringOrEmpty(i, 0) : pMat.IsStringOrEmpty(0, i)) {
            const nRes = rCollator.compareString(bHLookup ? pMat.GetString(i, 0) : pMat.GetString(0, i), aParamStr);
            if (nRes <= 0) nDelta = i;
            else if (i > 0) // #i2168# ignore first mismatch
              i = nMatCount + 1;
          } else nDelta = i;
        }
      } else {
        if (bHLookup) {
          for (let i = 0; i < nMatCount; i++) {
            if (pMat.IsStringOrEmpty(i, 0)) {
              if (getDataIgnoreCase(pMat.GetString(i, 0)) === getDataIgnoreCase(aParamStr)) {
                nDelta = i;
                i = nMatCount + 1;
              }
            }
          }
        } else {
          // MatchStringInColumns(aParamStr, 0, 0)
          for (let i = 0; i < nR; i++) {
            if (ScMatrix.IsRealStringType(pMat.GetType(0, i)) && getDataIgnoreCase(pMat.GetString(0, i)) === getDataIgnoreCase(aParamStr)) {
              nDelta = i;
              break;
            }
          }
        }
      }
    } else {
      if (bSorted) {
        // #i2168# ignore strings
        for (let i = 0; i < nMatCount; i++) {
          if (!(bHLookup ? pMat.IsStringOrEmpty(i, 0) : pMat.IsStringOrEmpty(0, i))) {
            if ((bHLookup ? pMat.GetDouble(i, 0) : pMat.GetDouble(0, i)) <= rItem.mfVal) nDelta = i;
            else i = nMatCount + 1;
          }
        }
      } else {
        if (bHLookup) {
          for (let i = 0; i < nMatCount; i++) {
            if (!pMat.IsStringOrEmpty(i, 0)) {
              if (pMat.GetDouble(i, 0) === rItem.mfVal) {
                nDelta = i;
                i = nMatCount + 1;
              }
            }
          }
        } else {
          // MatchDoubleInColumns(rItem.mfVal, 0, 0)
          for (let i = 0; i < nR; i++) {
            if (pMat.IsValue(0, i) && pMat.GetDouble(0, i) === rItem.mfVal) {
              nDelta = i;
              break;
            }
          }
        }
      }
    }
    if (nDelta !== SCSIZE_MAX) {
      let nX = nSpIndex;
      let nY = nDelta;
      let nXs = 0;
      let nYs = nY;
      if (bHLookup) {
        nX = nDelta;
        nY = nZIndex;
        nXs = nX;
        nYs = 0;
      }
      if (!(rItem.meType === ScQueryEntry.ByString && pMat.IsValue(nXs, nYs))) {
        if (pMat.IsStringOrEmpty(nX, nY)) this.PushString(pMat.GetString(nX, nY));
        else this.PushDouble(pMat.GetDouble(nX, nY));
      } else this.PushNA();
      return;
    } else this.PushNA();
  } else {
    // not a matrix
    rEntry.nField = nCol1;
    let bFound = false;
    let nCol = 0;
    let nRow = 0;
    if (bSorted) rEntry.eOp = ScQueryOp.SC_LESS_EQUAL;
    if (bHLookup) {
      const aCellIter = new ScQueryCellIterator(this.mrDoc, nTab1, aParam, false, false);
      // advance Entry.nField in Iterator upon switching columns
      aCellIter.SetAdvanceQueryParamEntryField(true);
      if (bSorted) {
        const r = aCellIter.FindEqualOrSortedLastInRange();
        bFound = r.bFound;
        nCol = r.nFoundCol;
      } else if (aCellIter.GetFirst()) {
        bFound = true;
        nCol = aCellIter.GetCol();
      }
      nRow = nZIndex;
    } else {
      const aResultPos = new ScAddress(nCol1, nRow1, nTab1);
      bFound = this.LookupQueryWithCache(aResultPos, aParam, LookupSearchMode.Forward, OC.ocVLookup);
      nRow = aResultPos.Row();
      nCol = nSpIndex;
    }

    if (bFound) {
      const aAdr = new ScAddress(nCol, nRow, nTab1);
      this.PushCellResultToken(true, aAdr);
    } else this.PushNA();
  }
};

ScInterpreter.prototype.ScVLookup = function (this: ScInterpreter): void { this.CalculateLookup(false); };

ScInterpreter.prototype.ScXLookup = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 3, 6)) return;

  const vsa = newVectorSearchArguments();
  vsa.nSearchOpCode = OC.ocXLookup;

  if (nParamCount === 6) {
    const k = this.GetInt16();
    if (k >= -2 && k <= 2 && k !== 0) vsa.eSearchMode = k as LookupSearchMode;
    else {
      this.PushIllegalParameter();
      return;
    }
  } else vsa.eSearchMode = LookupSearchMode.Forward;

  if (nParamCount >= 5) {
    const k = this.GetInt16();
    if (k >= -1 && k <= 3) vsa.eMatchMode = k as MatchMode;
    else {
      this.PushIllegalParameter();
      return;
    }
  } else vsa.eMatchMode = MatchMode.exactorNA;

  // Optional 4th argument to set return values if not found (default is #N/A)
  let xNotFound: FormulaToken | null = null;
  let nFirstMatchError: FormulaError = FormulaError.NONE;
  if (nParamCount >= 4 && this.GetStackType() !== svEmptyCell) {
    xNotFound = this.PopToken();
    nFirstMatchError = xNotFound ? xNotFound.GetError() : FormulaError.NONE;
    this.nGlobalError = FormulaError.NONE; // propagate only for match or active result path
  }

  // 3rd argument is return value array
  let prMat: ScMatrix | null = null;
  let nSearchCol1 = 0;
  let nSearchRow1 = 0;
  let nSearchTab1 = 0;
  let nSearchCol2 = 0;
  let nSearchRow2 = 0;
  let nrC = 0, nrR = 0;

  switch (this.GetStackType()) {
    case svSingleRef: {
      const aAdr = this.PopSingleRef();
      nSearchCol1 = aAdr.Col();
      nSearchRow1 = aAdr.Row();
      nSearchTab1 = aAdr.Tab();
      nSearchCol2 = nSearchCol1;
      nSearchRow2 = nSearchRow1;
      nrC = nSearchCol2 - nSearchCol1 + 1;
      nrR = nSearchRow2 - nSearchRow1 + 1;
      break;
    }
    case svDoubleRef: {
      const r = this.PopDoubleRef();
      nSearchCol1 = r.aStart.Col();
      nSearchRow1 = r.aStart.Row();
      nSearchTab1 = r.aStart.Tab();
      nSearchCol2 = r.aEnd.Col();
      nSearchRow2 = r.aEnd.Row();
      if (nSearchTab1 !== r.aEnd.Tab()) {
        this.PushIllegalParameter();
        return;
      }
      nrC = nSearchCol2 - nSearchCol1 + 1;
      nrR = nSearchRow2 - nSearchRow1 + 1;
      break;
    }
    case svMatrix: {
      prMat = this.PopMatrix();
      if (!prMat) {
        this.PushIllegalParameter();
        return;
      }
      ({ nC: nrC, nR: nrR } = prMat.GetDimensions());
      break;
    }
    default:
      this.PushIllegalParameter();
      return;
  }

  // 2nd argument is vector to be searched
  let nsC = 0, nsR = 0;
  switch (this.GetStackType()) {
    case svSingleRef:
    case svDoubleRef:
      if (!lcl_GetSearchVector(this, vsa)) return;
      nsC = vsa.nCol2 - vsa.nCol1 + 1;
      nsR = vsa.nRow2 - vsa.nRow1 + 1;
      break;
    case svMatrix:
      if (!lcl_GetSearchVector(this, vsa)) return;
      ({ nC: nsC, nR: nsR } = vsa.pMatSrc!.GetDimensions());
      break;
    default:
      this.PushIllegalParameter();
      return;
  }
  if ((nsR >= nsC && nsR !== nrR) || (nsR < nsC && nsC !== nrC)) {
    // search matrix must have same number of elements as result matrix in search direction
    this.PushIllegalParameter();
    return;
  }

  // 1st argument is search value
  if (this.nGlobalError === FormulaError.NONE) {
    if (!lcl_GetSearchValue(this, vsa, true)) return;
  }

  // start search
  if (this.SearchVectorForValue(vsa)) {
    //  found, output result
    let nX: number;
    let nY: number;
    let nResCols: number;
    let nResRows: number;
    if (vsa.bVLookup) {
      nX = 0;
      nY = vsa.nIndex;
      nResCols = nrC;
      nResRows = 1;
    } else {
      nX = vsa.nIndex;
      nY = 0;
      nResCols = 1;
      nResRows = nrR;
    }
    // if result has more than one row or column push double ref or matrix, else push single ref
    if (nResCols > 1 || nResRows > 1) {
      if (prMat) {
        // result is matrix, make / fill matrix with output and push that
        const pResMat = this.GetNewMat(nResCols, nResRows, /*bEmpty*/ true);
        for (let i = 0; i < nResCols; i++) {
          for (let j = 0; j < nResRows; j++) {
            let ri: number;
            let rj: number;
            if (vsa.bVLookup) {
              ri = nX + i;
              rj = nY;
            } else {
              ri = nX;
              rj = nY + j;
            }
            if (prMat.IsEmptyCell(ri, rj)) pResMat.PutEmpty(i, j);
            else if (prMat.IsStringOrEmpty(ri, rj)) pResMat.PutString(prMat.GetString(ri, rj), i, j);
            else pResMat.PutDouble(prMat.GetDouble(ri, rj), i, j);
          }
        }
        this.PushMatrix(pResMat);
      } else {
        // result is a double ref
        this.PushDoubleRef(nSearchCol1 + nX, nSearchRow1 + nY, nSearchTab1, nSearchCol1 + (nResCols - 1) + nX, nSearchRow1 + (nResRows - 1) + nY, nSearchTab1);
      }
    } else {
      if (prMat) {
        // result is matrix with one value
        if (prMat.IsEmptyCell(nX, nY)) this.PushNA();
        else if (prMat.IsStringOrEmpty(nX, nY)) this.PushString(prMat.GetString(nX, nY));
        else this.PushDouble(prMat.GetDouble(nX, nY));
      } else {
        // result is a single ref
        this.PushSingleRef(nSearchCol1 + nX, nSearchRow1 + nY, nSearchTab1);
      }
    }
  } else {
    if (vsa.isResultNA) {
      if (xNotFound && xNotFound.GetType() !== svMissing) {
        this.nGlobalError = nFirstMatchError;
        this.PushTokenRef(xNotFound);
      } else this.PushNA();
    }
  }
};

function lcl_IsTableStructuredRef(sRefStr: string): { bTableRef: boolean; nIndex: number } {
  const nIndex = FindUnquoted(sRefStr, '[');
  return { bTableRef: nIndex > 0 && FindUnquoted(sRefStr, ']', nIndex + 1) > nIndex, nIndex };
}

ScInterpreter.prototype.ScIndirect = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 1, 2)) return;

  // Reference address syntax for INDIRECT is configurable.
  let eConv = GetGlobalConfig().meStringRefAddressSyntax;
  if (eConv === FormulaGrammar.CONV_UNSPECIFIED)
    // Use the current address syntax if unspecified.
    eConv = this.mrDoc.GetAddressConvention();

  // either CONV_A1_XL_A1 was explicitly configured, or it wasn't possible
  // to determine which syntax to use during doc import
  let bTryXlA1 = eConv === FormulaGrammar.CONV_A1_XL_A1;

  if (nParamCount === 2 && 0.0 === this.GetDouble()) {
    // Overwrite the config and try Excel R1C1.
    eConv = FormulaGrammar.CONV_XL_R1C1;
    bTryXlA1 = false;
  }

  const sRefStr = this.GetString();
  if (!sRefStr) {
    // Bail out early for empty cells, rely on "we do have a string" below.
    this.PushError(FormulaError.NoRef);
    return;
  }

  const aDetails = ScAddressDetails(bTryXlA1 ? FormulaGrammar.CONV_OOO : eConv, this.aPos);
  const aDetailsXlA1 = ScAddressDetails(FormulaGrammar.CONV_XL_A1, this.aPos);
  const nTab = this.aPos.Tab();

  let bTableRefNamed = false;

  // Named expressions and DB range names need to be tried first, as older 1K
  // columns allowed names that would now match a 16k columns cell address.
  do {
    const pData = ScRangeStringConverter.GetRangeDataFromString(sRefStr, nTab, this.mrDoc, eConv);
    if (!pData) break;

    // This is the usual way to treat named ranges containing
    // relative references.
    const aRange = pData.IsReference(this.aPos);
    if (!aRange) {
      const sTabRefStr = pData.GetSymbol();
      bTableRefNamed = lcl_IsTableStructuredRef(sTabRefStr).bTableRef;
      // if bTableRefNamed is true, we have a name that maps to a table structured reference.
      // Such a case is handled below.
      break;
    }

    if (aRange.aStart.equals(aRange.aEnd)) this.PushSingleRef(aRange.aStart.Col(), aRange.aStart.Row(), aRange.aStart.Tab());
    else this.PushDoubleRef(aRange.aStart.Col(), aRange.aStart.Row(), aRange.aStart.Tab(), aRange.aEnd.Col(), aRange.aEnd.Row(), aRange.aEnd.Tab());

    // success!
    return;
  } while (false);

  // Database ranges (ScDBCollection) are not ported.

  const aRefAd = new ScRefAddress();
  const aRefAd2 = new ScRefAddress();
  if (!bTableRefNamed && (ConvertDoubleRef(this.mrDoc, sRefStr, nTab, aRefAd, aRefAd2, aDetails) || (bTryXlA1 && ConvertDoubleRef(this.mrDoc, sRefStr, nTab, aRefAd, aRefAd2, aDetailsXlA1)))) {
    // PushDoubleRef(const ScRefAddress&, const ScRefAddress&)
    if (!this.IfErrorPushError()) {
      const aRef = new ScComplexRefData();
      aRef.InitFromRefAddresses(this.mrDoc, aRefAd, aRefAd2, this.aPos);
      this.PushTempTokenWithoutError(new ScDoubleRefToken(this.mrDoc.GetSheetLimits(), aRef));
    }
  } else if (!bTableRefNamed && (ConvertSingleRef(this.mrDoc, sRefStr, nTab, aRefAd, aDetails) || (bTryXlA1 && ConvertSingleRef(this.mrDoc, sRefStr, nTab, aRefAd, aDetailsXlA1)))) {
    // PushSingleRef(const ScRefAddress&)
    if (!this.IfErrorPushError()) {
      const aRef = new ScSingleRefDataOf();
      aRef.InitFromRefAddress(this.mrDoc, aRefAd, this.aPos);
      this.PushTempTokenWithoutError(new ScSingleRefToken(this.mrDoc.GetSheetLimits(), aRef));
    }
  } else {
    // It may be even a TableRef or an external name. Neither is ported.
    this.PushError(FormulaError.NoRef);
  }
};

ScInterpreter.prototype.ScAddressFunc = function (this: ScInterpreter): void {
  let sTabStr = '';

  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 2, 5)) return;

  if (nParamCount >= 5) sTabStr = this.GetString();

  let eConv: FormulaGrammar.AddressConvention = FormulaGrammar.CONV_OOO; // default
  if (nParamCount >= 4 && 0.0 === this.GetDoubleWithDefault(1.0)) eConv = FormulaGrammar.CONV_XL_R1C1;
  else {
    // If A1 syntax is requested then the actual sheet separator and format
    // convention depends on the syntax configured for INDIRECT to match
    // that, and if it is unspecified then the document's address syntax.
    let eForceConv = GetGlobalConfig().meStringRefAddressSyntax;
    if (eForceConv === FormulaGrammar.CONV_UNSPECIFIED) eForceConv = this.mrDoc.GetAddressConvention();
    if (eForceConv === FormulaGrammar.CONV_XL_A1 || eForceConv === FormulaGrammar.CONV_XL_R1C1) eConv = FormulaGrammar.CONV_XL_A1; // for anything Excel use Excel A1
  }

  let nFlags = ScRefFlags.COL_ABS | ScRefFlags.ROW_ABS; // default
  if (nParamCount >= 3) {
    const n = this.GetInt32WithDefault(1);
    switch (n) {
      default:
        this.PushNoValue();
        return;

      case 5:
      case 1:
        break; // default
      case 6:
      case 2:
        nFlags = ScRefFlags.ROW_ABS;
        break;
      case 7:
      case 3:
        nFlags = ScRefFlags.COL_ABS;
        break;
      case 8:
      case 4:
        nFlags = ScRefFlags.ZERO;
        break; // both relative
    }
  }
  nFlags |= ScRefFlags.VALID | ScRefFlags.ROW_VALID | ScRefFlags.COL_VALID;

  let nCol = this.GetInt16();
  let nRow = this.GetInt32();
  if (eConv === FormulaGrammar.CONV_XL_R1C1) {
    // YUCK!  The XL interface actually treats rel R1C1 refs differently
    // than A1
    if (!(nFlags & ScRefFlags.COL_ABS)) nCol += this.aPos.Col() + 1;
    if (!(nFlags & ScRefFlags.ROW_ABS)) nRow += this.aPos.Row() + 1;
  }

  --nCol;
  --nRow;
  if (this.nGlobalError !== FormulaError.NONE || !this.mrDoc.ValidCol(nCol) || !this.mrDoc.ValidRow(nRow)) {
    this.PushIllegalArgument();
    return;
  }

  const aDetails = ScAddressDetails(eConv, this.aPos);
  const aAdr = new ScAddress(nCol, nRow, 0);
  const aRefStr = aAdr.Format(nFlags, this.mrDoc, aDetails);

  if (nParamCount >= 5 && sTabStr) {
    let aDoc = '';
    if (eConv === FormulaGrammar.CONV_OOO) {
      // Isolate Tab from 'Doc'#Tab
      let nPos = GetDocTabPos(sTabStr);
      if (nPos !== -1) {
        if (sTabStr[nPos + 1] === '$') ++nPos; // also split 'Doc'#$Tab
        aDoc = sTabStr.slice(0, nPos + 1);
        sTabStr = sTabStr.slice(nPos + 1);
      }
    }
    /* TODO: yet unsupported external reference in CONV_XL_R1C1 syntax may
     * need some extra handling to isolate Tab from Doc. */
    if (sTabStr[0] !== "'" || !sTabStr.endsWith("'")) sTabStr = CheckTabQuotes(sTabStr, eConv);
    if (aDoc) sTabStr = aDoc + sTabStr;
    sTabStr += eConv === FormulaGrammar.CONV_XL_R1C1 || eConv === FormulaGrammar.CONV_XL_A1 ? '!' : '.';
    sTabStr += aRefStr;
    this.PushString(sTabStr);
  } else this.PushString(aRefStr);
};

ScInterpreter.prototype.ScOffset = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 3, 5)) return;

  let bNewWidth = false;
  let bNewHeight = false;
  let nColNew = 1, nRowNew = 1;
  if (nParamCount === 5) {
    if (this.IsMissing()) this.PopError();
    else {
      nColNew = this.GetInt32();
      bNewWidth = true;
    }
  }
  if (nParamCount >= 4) {
    if (this.IsMissing()) this.PopError();
    else {
      nRowNew = this.GetInt32();
      bNewHeight = true;
    }
  }
  const nColPlus = this.GetInt32();
  const nRowPlus = this.GetInt32();
  if (this.nGlobalError !== FormulaError.NONE) {
    this.PushError(this.nGlobalError);
    return;
  }
  if (nColNew <= 0 || nRowNew <= 0) {
    this.PushIllegalArgument();
    return;
  }
  let nCol1 = 0;
  let nRow1 = 0;
  let nTab1 = 0;
  let nCol2 = 0;
  let nRow2 = 0;
  let nTab2 = 0;
  switch (this.GetStackType()) {
    case svSingleRef: {
      const aAdr = this.PopSingleRef();
      nCol1 = aAdr.Col();
      nRow1 = aAdr.Row();
      nTab1 = aAdr.Tab();
      if (!bNewWidth && !bNewHeight) {
        nCol1 = nCol1 + nColPlus;
        nRow1 = nRow1 + nRowPlus;
        if (!this.mrDoc.ValidCol(nCol1) || !this.mrDoc.ValidRow(nRow1)) this.PushIllegalArgument();
        else this.PushSingleRef(nCol1, nRow1, nTab1);
      } else {
        nCol1 = nCol1 + nColPlus;
        nRow1 = nRow1 + nRowPlus;
        nCol2 = nCol1 + nColNew - 1;
        nRow2 = nRow1 + nRowNew - 1;
        if (!this.mrDoc.ValidCol(nCol1) || !this.mrDoc.ValidRow(nRow1) || !this.mrDoc.ValidCol(nCol2) || !this.mrDoc.ValidRow(nRow2)) this.PushIllegalArgument();
        else this.PushDoubleRef(nCol1, nRow1, nTab1, nCol2, nRow2, nTab1);
      }
      break;
    }
    case svDoubleRef: {
      const r = this.PopDoubleRef();
      nCol1 = r.aStart.Col();
      nRow1 = r.aStart.Row();
      nTab1 = r.aStart.Tab();
      nCol2 = r.aEnd.Col();
      nRow2 = r.aEnd.Row();
      nTab2 = r.aEnd.Tab();
      if (!bNewWidth) nColNew = nCol2 - nCol1 + 1;
      if (!bNewHeight) nRowNew = nRow2 - nRow1 + 1;
      nCol1 = nCol1 + nColPlus;
      nRow1 = nRow1 + nRowPlus;
      nCol2 = nCol1 + nColNew - 1;
      nRow2 = nRow1 + nRowNew - 1;
      if (!this.mrDoc.ValidCol(nCol1) || !this.mrDoc.ValidRow(nRow1) || !this.mrDoc.ValidCol(nCol2) || !this.mrDoc.ValidRow(nRow2) || nTab1 !== nTab2) this.PushIllegalArgument();
      else this.PushDoubleRef(nCol1, nRow1, nTab1, nCol2, nRow2, nTab1);
      break;
    }
    default:
      this.PushIllegalParameter();
      break;
  } // end switch
};

ScInterpreter.prototype.ScIndex = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 1, 4)) return;

  let nArea: number;
  let nAreaCount: number;
  let nCol: number;
  let nRow: number;
  if (nParamCount === 4) nArea = this.GetInt32();
  else nArea = 1;
  let bColMissing: boolean;
  if (nParamCount >= 3) {
    bColMissing = this.IsMissing();
    nCol = this.GetInt16();
  } else {
    bColMissing = false;
    nCol = 0;
  }
  if (nParamCount >= 2) nRow = this.GetInt32();
  else nRow = 0;
  if (nArea < 1 || nCol < 0 || nRow < 0) {
    this.PushIllegalArgument();
    return;
  }
  if (this.GetStackType() === svRefList) nAreaCount = this.sp ? (this.pStack[this.sp - 1]!.GetRefList() as ScRefList).length : 0;
  else nAreaCount = 1; // one reference or array or whatever
  if (this.nGlobalError !== FormulaError.NONE || nAreaCount === 0 || nArea > nAreaCount) {
    this.PushError(FormulaError.NoRef);
    return;
  }
  switch (this.GetStackType()) {
    case svMatrix: {
      const nOldSp = this.sp;
      const pMat = this.GetMatrix();
      if (!pMat) this.PushError(FormulaError.NoRef);
      else {
        const { nC, nR } = pMat.GetDimensions();

        // Access one element of a vector independent of col/row
        // orientation. Excel documentation does not mention, but
        // i62850 had a .xls example of a row vector accessed by
        // row number returning one element. This
        // INDEX(row_vector;element) behaves the same as
        // INDEX(row_vector;0;element) and thus contradicts Excel
        // documentation where the second parameter is always
        // row_num.
        //
        // ODFF v1.3 in 6.14.6 INDEX states "If DataSource is a
        // one-dimensional row vector, Row is optional, which
        // effectively makes Row act as the column offset into the
        // vector". Guess the first Row is a typo and should read
        // Column instead.

        const bRowVectorSpecial = nParamCount === 2 || bColMissing;
        const bRowVectorElement = nR === 1 && (nCol !== 0 || (bRowVectorSpecial && nRow !== 0));
        const bVectorElement = bRowVectorElement || (nC === 1 && nRow !== 0);

        if (nC === 0 || nR === 0 || (!bVectorElement && (nCol > nC || nRow > nR))) this.PushError(FormulaError.NoRef);
        else if (nCol === 0 && nRow === 0) this.sp = nOldSp;
        else if (bVectorElement) {
          // Vectors here don't replicate to the other dimension.
          let nElement: number, nOtherDimension: number;
          if (bRowVectorElement && !bRowVectorSpecial) {
            nElement = nCol;
            nOtherDimension = nRow;
          } else {
            nElement = nRow;
            nOtherDimension = nCol;
          }

          if (nElement === 0 || nElement > nC * nR || nOtherDimension > 1) this.PushError(FormulaError.NoRef);
          else {
            --nElement;
            if (pMat.IsStringOrEmpty(nElement)) this.PushString(pMat.GetString(nElement));
            else this.PushDouble(pMat.GetDouble(nElement));
          }
        } else if (nCol === 0) {
          const pResMat = this.GetNewMat(nC, 1, /*bEmpty*/ true);
          const nRowMinus1 = nRow - 1;
          for (let i = 0; i < nC; i++)
            if (!pMat.IsStringOrEmpty(i, nRowMinus1)) pResMat.PutDouble(pMat.GetDouble(i, nRowMinus1), i, 0);
            else pResMat.PutString(pMat.GetString(i, nRowMinus1), i, 0);

          this.PushMatrix(pResMat);
        } else if (nRow === 0) {
          const pResMat = this.GetNewMat(1, nR, /*bEmpty*/ true);
          const nColMinus1 = nCol - 1;
          for (let i = 0; i < nR; i++)
            if (!pMat.IsStringOrEmpty(nColMinus1, i)) pResMat.PutDouble(pMat.GetDouble(nColMinus1, i), i);
            else pResMat.PutString(pMat.GetString(nColMinus1, i), i);
          this.PushMatrix(pResMat);
        } else {
          if (!pMat.IsStringOrEmpty(nCol - 1, nRow - 1)) this.PushDouble(pMat.GetDouble(nCol - 1, nRow - 1));
          else this.PushString(pMat.GetString(nCol - 1, nRow - 1));
        }
      }
      break;
    }
    case svSingleRef: {
      const aAdr = this.PopSingleRef();
      if (nCol > 1 || nRow > 1) this.PushError(FormulaError.NoRef);
      else this.PushSingleRef(aAdr.Col(), aAdr.Row(), aAdr.Tab());
      break;
    }
    case svDoubleRef:
    case svRefList: {
      let aRange: ScRange;
      let bRowArray = false;
      if (this.GetStackType() === svRefList) {
        const xRef = this.PopToken();
        if (this.nGlobalError !== FormulaError.NONE || !xRef) {
          this.PushError(FormulaError.NoRef);
          return;
        }
        aRange = this.DoubleRefToRange((xRef.GetRefList() as ScRefList)[nArea - 1]!);
      } else aRange = this.PopDoubleRef();
      const nCol1 = aRange.aStart.Col();
      const nRow1 = aRange.aStart.Row();
      const nTab1 = aRange.aStart.Tab();
      const nCol2 = aRange.aEnd.Col();
      const nRow2 = aRange.aEnd.Row();
      const nTab2 = aRange.aEnd.Tab();
      if (nParamCount === 2 && nRow1 === nRow2) bRowArray = true;
      if (nTab1 !== nTab2 || (nCol > 0 && nCol1 + nCol - 1 > nCol2) || (nRow > 0 && nRow1 + nRow - 1 > nRow2 && !bRowArray) || (nRow > nCol2 - nCol1 + 1 && bRowArray)) this.PushError(FormulaError.NoRef);
      else if (nCol === 0 && nRow === 0) {
        if (nCol1 === nCol2 && nRow1 === nRow2) this.PushSingleRef(nCol1, nRow1, nTab1);
        else this.PushDoubleRef(nCol1, nRow1, nTab1, nCol2, nRow2, nTab1);
      } else if (nRow === 0) {
        if (nRow1 === nRow2) this.PushSingleRef(nCol1 + nCol - 1, nRow1, nTab1);
        else this.PushDoubleRef(nCol1 + nCol - 1, nRow1, nTab1, nCol1 + nCol - 1, nRow2, nTab1);
      } else if (nCol === 0) {
        if (nCol1 === nCol2) this.PushSingleRef(nCol1, nRow1 + nRow - 1, nTab1);
        else if (bRowArray) {
          nCol = nRow;
          nRow = 1;
          this.PushSingleRef(nCol1 + nCol - 1, nRow1 + nRow - 1, nTab1);
        } else this.PushDoubleRef(nCol1, nRow1 + nRow - 1, nTab1, nCol2, nRow1 + nRow - 1, nTab1);
      } else this.PushSingleRef(nCol1 + nCol - 1, nRow1 + nRow - 1, nTab1);
      break;
    }
    default:
      this.PopError();
      this.PushError(FormulaError.NoRef);
  }
};

ScInterpreter.prototype.ScMultiArea = function (this: ScInterpreter): void {
  // Legacy support, convert to RefList
  let nParamCount = this.GetByte();
  if (this.MustHaveParamCountMin(nParamCount, 1)) {
    while (this.nGlobalError === FormulaError.NONE && nParamCount-- > 1) this.ScUnionFunc();
  }
};

ScInterpreter.prototype.ScAreas = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 1)) return;

  let nCount = 0;
  switch (this.GetStackType()) {
    case svSingleRef: {
      const xT = this.PopToken()!;
      this.SingleRefToVars(xT.GetSingleRef());
      ++nCount;
      break;
    }
    case svDoubleRef: {
      const xT = this.PopToken()!;
      this.DoubleRefToRange(xT.GetDoubleRef());
      ++nCount;
      break;
    }
    case svRefList: {
      const xT = this.PopToken()!;
      this.ValidateRef(xT.GetRefList() as ScRefList);
      nCount += (xT.GetRefList() as ScRefList).length;
      break;
    }
    default:
      this.SetError(FormulaError.IllegalParameter);
  }
  this.PushDouble(nCount);
};

ScInterpreter.Register(OC.ocColumns, ScInterpreter.prototype.ScColumns);
ScInterpreter.Register(OC.ocRows, ScInterpreter.prototype.ScRows);
ScInterpreter.Register(OC.ocSheets, ScInterpreter.prototype.ScSheets);
ScInterpreter.Register(OC.ocColumn, ScInterpreter.prototype.ScColumn);
ScInterpreter.Register(OC.ocRow, ScInterpreter.prototype.ScRow);
ScInterpreter.Register(OC.ocSheet, ScInterpreter.prototype.ScSheet);
ScInterpreter.Register(OC.ocMatch, ScInterpreter.prototype.ScMatch);
ScInterpreter.Register(OC.ocXMatch, ScInterpreter.prototype.ScXMatch);
ScInterpreter.Register(OC.ocLookup, ScInterpreter.prototype.ScLookup);
ScInterpreter.Register(OC.ocHLookup, ScInterpreter.prototype.ScHLookup);
ScInterpreter.Register(OC.ocVLookup, ScInterpreter.prototype.ScVLookup);
ScInterpreter.Register(OC.ocXLookup, ScInterpreter.prototype.ScXLookup);
ScInterpreter.Register(OC.ocIndirect, ScInterpreter.prototype.ScIndirect);
ScInterpreter.Register(OC.ocAddress, ScInterpreter.prototype.ScAddressFunc);
ScInterpreter.Register(OC.ocOffset, ScInterpreter.prototype.ScOffset);
ScInterpreter.Register(OC.ocIndex, ScInterpreter.prototype.ScIndex);
ScInterpreter.Register(OC.ocMultiArea, ScInterpreter.prototype.ScMultiArea);
ScInterpreter.Register(OC.ocAreas, ScInterpreter.prototype.ScAreas);

// @@ LOOKUP (lookup and reference functions) @@

// The criteria functions: COUNTBLANK, SUMIF, AVERAGEIF, COUNTIF, SUMIFS, AVERAGEIFS, COUNTIFS,
// MINIFS, MAXIFS with IterateParametersIf(s) and QueryMat. Left out: external references, the
// sorted range cache iterators (upstream does not use them either) and the interpreter
// context's cached conditions vector.

declare module './interpr4.ts' {
  interface ScInterpreter {
    GetRefListArrayMaxSize(nParamCount: number): number;
    QueryMat(pMat: ScMatrix, rOptions: CompareOptions): ScMatrix | null;
    ScCountEmptyCells(): void;
    IterateParametersIf(eFunc: ScIterFuncIf): void;
    ScSumIf(): void;
    ScAverageIf(): void;
    ScCountIf(): void;
    IterateParametersIfs(ResultFunc: (rRes: ParamIfsResult) => number): void;
    ScSumIfs(): void;
    ScAverageIfs(): void;
    ScCountIfs(): void;
    ScMinIfs_MS(): void;
    ScMaxIfs_MS(): void;
  }
}

/** ScIterFuncIf */
export const ScIterFuncIf = { ifSUMIF: 0, ifAVERAGEIF: 1 } as const;
export type ScIterFuncIf = (typeof ScIterFuncIf)[keyof typeof ScIterFuncIf];

/** sc::ParamIfsResult */
export interface ParamIfsResult { mfSum: KahanSum; mfCount: number; mfMin: number; mfMax: number }

function newParamIfsResult(): ParamIfsResult { return { mfSum: new KahanSum(0.0), mfCount: 0.0, mfMin: Number.MAX_VALUE, mfMax: -Number.MAX_VALUE }; }

/** sc::CompareOptions (compare.hxx) */
export interface CompareOptions { aQueryEntry: ScQueryEntry; eSearchType: utlSearchType; bMatchWholeCell: boolean }

function newCompareOptions(rDoc: ScDocument, rEntry: ScQueryEntry, eSrchTyp: utlSearchType): CompareOptions {
  const r: CompareOptions = { aQueryEntry: rEntry.clone(), eSearchType: eSrchTyp, bMatchWholeCell: rDoc.GetDocOptions().IsMatchWholeCell() };
  // Wildcard and Regex search work only with equal or not equal.
  if (r.eSearchType !== utlSearchType.Normal && r.aQueryEntry.eOp !== ScQueryOp.SC_EQUAL && r.aQueryEntry.eOp !== ScQueryOp.SC_NOT_EQUAL) r.eSearchType = utlSearchType.Normal;

  // Interpreter functions usually are case insensitive, except the simple
  // comparison operators, for which these options aren't used. Override in
  // struct if needed.
  return r;
}

/** sc::Compare::Cell */
interface CompareOptCell { mfValue: number; maStr: string; mbValue: boolean; mbEmpty: boolean }

/** sc::CompareFunc(rComp, pOptions) of compare.cxx: the comparison of two cells with query
    options (wildcards, regular expressions, whole cell matching). */
function CompareFuncOpt(rCell1: CompareOptCell, rCell2: CompareOptCell, bIgnoreCase: boolean, pOptions: CompareOptions): number {
  // Keep DoubleError if encountered
  // #i40539# if bEmpty is set, bVal/nVal are uninitialized
  if (!rCell1.mbEmpty && rCell1.mbValue && !Number.isFinite(rCell1.mfValue)) return rCell1.mfValue;
  if (!rCell2.mbEmpty && rCell2.mbValue && !Number.isFinite(rCell2.mfValue)) return rCell2.mfValue;

  let nStringQuery = 0; // 0:=no, 1:=0, 2:=1
  let fRes = 0;
  if (rCell1.mbEmpty) {
    if (rCell2.mbEmpty) {
      // empty cell == empty cell, fRes 0
    } else if (rCell2.mbValue) {
      if (rCell2.mfValue !== 0.0) {
        if (rCell2.mfValue < 0.0) fRes = 1; // empty cell > -x
        else fRes = -1; // empty cell < x
      }
      // else: empty cell == 0.0
    } else {
      if (rCell2.maStr) fRes = -1; // empty cell < "..."
      // else: empty cell == ""
    }
  } else if (rCell2.mbEmpty) {
    if (rCell1.mbValue) {
      if (rCell1.mfValue !== 0.0) {
        if (rCell1.mfValue < 0.0) fRes = -1; // -x < empty cell
        else fRes = 1; // x > empty cell
      }
      // else: empty cell == 0.0
    } else {
      if (rCell1.maStr) fRes = 1; // "..." > empty cell
      // else: "" == empty cell
    }
  } else if (rCell1.mbValue) {
    if (rCell2.mbValue) {
      if (!rtl_math_approxEqual(rCell1.mfValue, rCell2.mfValue)) {
        if (rCell1.mfValue - rCell2.mfValue < 0) fRes = -1;
        else fRes = 1;
      }
    } else {
      fRes = -1; // number is less than string
      nStringQuery = 2; // 1+1
    }
  } else if (rCell2.mbValue) {
    fRes = 1; // string is greater than number
    nStringQuery = 1; // 0+1
  } else {
    // Both strings.
    // All similar to ScTable::ValidQuery(), *rComp.pVal[1] actually
    // is/must be identical to *rEntry.pStr, which is essential for
    // regex to work through GetSearchTextPtr().
    const rEntry = pOptions.aQueryEntry;
    if (pOptions.eSearchType !== utlSearchType.Normal) {
      const r = rEntry.GetSearchTextPtr(pOptions.eSearchType, !bIgnoreCase, pOptions.bMatchWholeCell).SearchForward(rCell1.maStr, 0, rCell1.maStr.length);
      let bMatch = r.bFound;
      if (bMatch && pOptions.bMatchWholeCell && (r.nStart !== 0 || r.nEnd !== rCell1.maStr.length)) bMatch = false; // RegEx must match entire string.
      fRes = bMatch ? 0 : 1;
    } else if (rEntry.eOp === ScQueryOp.SC_EQUAL || rEntry.eOp === ScQueryOp.SC_NOT_EQUAL) {
      let bMatch = false;
      if (pOptions.bMatchWholeCell) {
        if (bIgnoreCase) bMatch = getDataIgnoreCase(rCell1.maStr) === getDataIgnoreCase(rCell2.maStr);
        else bMatch = rCell1.maStr === rCell2.maStr;
      } else {
        const aCell = bIgnoreCase ? getDataIgnoreCase(rCell1.maStr) : rCell1.maStr;
        const aQuer = bIgnoreCase ? getDataIgnoreCase(rCell2.maStr) : rCell2.maStr;
        bMatch = aCell.indexOf(aQuer) !== -1;
      }
      fRes = bMatch ? 0 : 1;
    } else fRes = GetCollator(!bIgnoreCase).compareString(rCell1.maStr, rCell2.maStr);
  }

  if (nStringQuery) {
    const rEntry = pOptions.aQueryEntry;
    const rItem = rEntry.GetQueryItems()[0];
    if (rItem && rItem.meType !== ScQueryEntry.ByString && rItem.maString && (rEntry.eOp === ScQueryOp.SC_EQUAL || rEntry.eOp === ScQueryOp.SC_NOT_EQUAL)) {
      // As in ScTable::ValidQuery() match a numeric string for a
      // number query that originated from a string, e.g. in SUMIF
      // and COUNTIF. Transliteration is not needed here.
      let bEqual = false;
      if (nStringQuery === 1) bEqual = rCell1.maStr === rItem.maString;
      else bEqual = rCell2.maStr === rItem.maString;

      // match => fRes=0, else fRes=1
      fRes = (rEntry.eOp === ScQueryOp.SC_NOT_EQUAL ? bEqual : !bEqual) ? 1 : 0;
    }
  }

  return fRes;
}

/** sc::CompareFunc(rCell1, fCell2, pOptions) of compare.cxx. */
function CompareFuncOptValue(rCell1: CompareOptCell, fCell2: number, pOptions: CompareOptions): number {
  // Keep DoubleError if encountered
  // #i40539# if bEmpty is set, bVal/nVal are uninitialized
  if (!rCell1.mbEmpty && rCell1.mbValue && !Number.isFinite(rCell1.mfValue)) return rCell1.mfValue;
  if (!Number.isFinite(fCell2)) return fCell2;

  let bStringQuery = false;
  let fRes = 0;
  if (rCell1.mbEmpty) {
    if (fCell2 !== 0.0) {
      if (fCell2 < 0.0) fRes = 1; // empty cell > -x
      else fRes = -1; // empty cell < x
    }
    // else: empty cell == 0.0
  } else if (rCell1.mbValue) {
    if (!rtl_math_approxEqual(rCell1.mfValue, fCell2)) {
      if (rCell1.mfValue - fCell2 < 0) fRes = -1;
      else fRes = 1;
    }
  } else {
    fRes = 1; // string is greater than number
    bStringQuery = true;
  }

  if (bStringQuery) {
    const rEntry = pOptions.aQueryEntry;
    const rItem = rEntry.GetQueryItems()[0];
    if (rItem && rItem.meType !== ScQueryEntry.ByString && rItem.maString && (rEntry.eOp === ScQueryOp.SC_EQUAL || rEntry.eOp === ScQueryOp.SC_NOT_EQUAL)) {
      // As in ScTable::ValidQuery() match a numeric string for a
      // number query that originated from a string, e.g. in SUMIF
      // and COUNTIF. Transliteration is not needed here.
      const bEqual = rCell1.maStr === rItem.maString;

      // match => fRes=0, else fRes=1
      fRes = (rEntry.eOp === ScQueryOp.SC_NOT_EQUAL ? bEqual : !bEqual) ? 1 : 0;
    }
  }

  return fRes;
}

/** evaluate() of scmatrix.cxx: a comparison result as a boolean for the operator. */
function lcl_EvaluateCompare(fVal: number, eOp: ScQueryOp): number {
  if (!Number.isFinite(fVal)) return fVal;

  switch (eOp) {
    case ScQueryOp.SC_EQUAL:
      return fVal === 0.0 ? 1.0 : 0.0;
    case ScQueryOp.SC_LESS:
      return fVal < 0.0 ? 1.0 : 0.0;
    case ScQueryOp.SC_GREATER:
      return fVal > 0.0 ? 1.0 : 0.0;
    case ScQueryOp.SC_LESS_EQUAL:
      return fVal <= 0.0 ? 1.0 : 0.0;
    case ScQueryOp.SC_GREATER_EQUAL:
      return fVal >= 0.0 ? 1.0 : 0.0;
    case ScQueryOp.SC_NOT_EQUAL:
      return fVal !== 0.0 ? 1.0 : 0.0;
    default:
  }

  return CreateDoubleErrorOf(FormulaError.UnknownState);
}

ScInterpreter.prototype.GetRefListArrayMaxSize = function (this: ScInterpreter, nParamCount: number): number {
  let nSize = 0;
  if (this.IsInArrayContext()) {
    for (let i = 1; i <= nParamCount; ++i) {
      if (this.GetStackType(i) === svRefList) {
        const p = this.pStack[this.sp - i];
        if (p instanceof ScRefListToken && p.IsArrayResult() && p.GetRefList().length > nSize) nSize = p.GetRefList().length;
      }
    }
  }
  return nSize;
};

/** QueryMat: the matrix compared element by element with the query entry's value (through
    CompareMat with the options, sc::ScMatrix::CompareMatrix). */
ScInterpreter.prototype.QueryMat = function (this: ScInterpreter, pMat: ScMatrix, rOptions: CompareOptions): ScMatrix | null {
  const nSaveCurFmtType = this.nCurFmtType;
  const nSaveFuncFmtType = this.nFuncFmtType;
  const rItem = rOptions.aQueryEntry.GetQueryItem();
  const eOp = rOptions.aQueryEntry.eOp;
  const bIgnoreCase = this.mrDoc.GetDocOptions().IsIgnoreCase();
  const { nC, nR } = pMat.GetDimensions();
  const pResultMatrix: ScMatrix | null = new ScMatrix(nC, nR, 0.0);
  const rCell: CompareOptCell = { mfValue: 0, maStr: '', mbValue: false, mbEmpty: false };
  const rCell2: CompareOptCell = { mfValue: 0, maStr: rItem.maString, mbValue: false, mbEmpty: false };
  for (let j = 0; j < nC; j++) {
    for (let k = 0; k < nR; k++) {
      const v = pMat.Get(j, k);
      rCell.mbValue = ScMatrix.IsValueType(v.nType);
      rCell.mbEmpty = ScMatrix.IsEmptyType(v.nType) || ScMatrix.IsEmptyPathType(v.nType);
      rCell.mfValue = rCell.mbValue ? v.fVal : 0.0;
      rCell.maStr = ScMatrix.IsRealStringType(v.nType) ? v.aStr : '';
      let fVal: number;
      if (rItem.meType === ScQueryEntry.ByString) fVal = CompareFuncOpt(rCell, rCell2, bIgnoreCase, rOptions);
      else fVal = CompareFuncOptValue(rCell, rItem.mfVal, rOptions);
      pResultMatrix.PutDouble(lcl_EvaluateCompare(fVal, eOp), j, k);
    }
  }
  this.nCurFmtType = nSaveCurFmtType;
  this.nFuncFmtType = nSaveFuncFmtType;
  if (this.nGlobalError !== FormulaError.NONE) {
    this.SetError(FormulaError.IllegalParameter);
    return pResultMatrix;
  }

  return pResultMatrix;
};

function isCellContentEmpty(rCell: ReturnType<ScDocument['GetRefCellValue']>): boolean {
  switch (rCell.getType()) {
    case CELLTYPE_VALUE:
    case CELLTYPE_STRING:
    case CELLTYPE_EDIT:
      return false;
    case CELLTYPE_FORMULA: {
      // NOTE: Excel treats ="" in a referenced cell as blank in
      // COUNTBLANK() but not in ISBLANK(), which is inconsistent.
      // COUNTBLANK() tests the (display) result whereas ISBLANK() tests
      // the cell content.
      // ODFF allows both for COUNTBLANK().
      // OOo and LibreOffice prior to 4.4 did not treat ="" as blank in
      // COUNTBLANK(), we now do for Excel interoperability.
      /* TODO: introduce yet another compatibility option? */
      const aRes = rCell.getFormula()!.GetResult();
      if (aRes.meType !== 'String') return false;
      if (aRes.maString) return false;
      break;
    }
    default:
  }

  return true;
}

ScInterpreter.prototype.ScCountEmptyCells = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 1)) return;

  const nMatRows = this.GetRefListArrayMaxSize(1);
  // There's either one RefList and nothing else, or none.
  const xResMat = nMatRows ? this.GetNewMat(1, nMatRows, /*bEmpty*/ true) : null;
  let nMaxCount = 0, nCount = 0;
  switch (this.GetStackType()) {
    case svSingleRef: {
      nMaxCount = 1;
      const aAdr = this.PopSingleRef();
      const aCell = this.mrDoc.GetRefCellValue(aAdr);
      if (!isCellContentEmpty(aCell)) nCount = 1;
      break;
    }
    case svRefList:
    case svDoubleRef: {
      const aState = { nParam: 1, nRefInList: 0 };
      let nRefListArrayPos = 0;
      while (aState.nParam-- > 0) {
        nRefListArrayPos = aState.nRefInList;
        const aRange = this.PopDoubleRef(aState);
        nMaxCount += (aRange.aEnd.Row() - aRange.aStart.Row() + 1) * (aRange.aEnd.Col() - aRange.aStart.Col() + 1) * (aRange.aEnd.Tab() - aRange.aStart.Tab() + 1);

        const aIter = new ScCellIteratorOf(this.mrDoc, aRange, this.mnSubTotalFlags);
        for (const it of aIter.cells()) {
          if (!isCellContentEmpty(it.aCell)) ++nCount;
        }
        if (xResMat) {
          xResMat.PutDouble(nMaxCount - nCount, 0, nRefListArrayPos);
          nMaxCount = nCount = 0;
        }
      }
      break;
    }
    case svMatrix: {
      const xMat = this.GetMatrix();
      if (!xMat) this.SetError(FormulaError.IllegalParameter);
      else {
        const { nC, nR } = xMat.GetDimensions();
        nMaxCount = nC * nR;
        // Numbers (implicit), strings and error values, ignore empty
        // strings as those if not entered in an inline array are the
        // result of a formula, to be par with a reference to formula
        // cell as *visual* blank, see isCellContentEmpty() above.
        nCount = xMat.Count(true, true, true);
      }
      break;
    }
    default:
      this.SetError(FormulaError.IllegalParameter);
      break;
  }
  if (xResMat) this.PushMatrix(xResMat);
  else this.PushDouble(nMaxCount - nCount);
};

/** The criterion parameter of the *IF(S) functions: a value or a string; null if a reference
    could not be resolved (nGlobalError is set). */
function lcl_GetCriterion(self: ScInterpreter): { fVal: number; aString: string; bIsString: boolean } | null {
  let aString = '';
  let fVal = 0.0;
  let bIsString = true;
  switch (self.GetStackType()) {
    case svDoubleRef:
    case svSingleRef: {
      const aAdr = self.PopDoubleRefOrSingleRef();
      if (!aAdr) return null;

      const aCell = self.mrDoc.GetRefCellValue(aAdr);
      switch (aCell.getType()) {
        case CELLTYPE_VALUE:
          fVal = self.GetCellValue(aAdr, aCell);
          bIsString = false;
          break;
        case CELLTYPE_FORMULA:
          if (aCell.getFormula()!.IsValue()) {
            fVal = self.GetCellValue(aAdr, aCell);
            bIsString = false;
          } else aString = self.GetCellString(aCell);
          break;
        case CELLTYPE_STRING:
        case CELLTYPE_EDIT:
          aString = self.GetCellString(aCell);
          break;
        default:
          fVal = 0.0;
          bIsString = false;
      }
      break;
    }
    case svString:
      aString = self.GetString();
      break;
    case svMatrix: {
      const r = self.GetDoubleOrStringFromMatrix();
      fVal = r.fVal;
      aString = r.aStr;
      bIsString = ScMatrix.IsRealStringType(r.nType);
      break;
    }
    default:
      fVal = self.GetDouble();
      bIsString = false;
  }
  return { fVal, aString, bIsString };
}

/** Fill the query entry of a criterion (shared by the *IF(S) functions). */
function lcl_FillCriterion(self: ScInterpreter, rParam: ScQueryParam, c: { fVal: number; aString: string; bIsString: boolean }): void {
  const rEntry = rParam.GetEntry(0);
  const rItem = rEntry.GetQueryItem();
  rEntry.bDoQuery = true;
  if (!c.bIsString) {
    rItem.meType = ScQueryEntry.ByValue;
    rItem.mfVal = c.fVal;
    rEntry.eOp = ScQueryOp.SC_EQUAL;
  } else {
    rParam.FillInExcelSyntax(c.aString, 0, true);
    if (rItem.meType === ScQueryEntry.ByString) rParam.eSearchType = self.DetectSearchType(rItem.maString, self.mrDoc);
  }
}

ScInterpreter.prototype.IterateParametersIf = function (this: ScInterpreter, eFunc: ScIterFuncIf): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 2, 3)) return;

  let nCol3 = 0;
  let nRow3 = 0;
  let nTab3 = 0;

  let pSumExtraMatrix: ScMatrix | null = null;
  const bSumExtraRange = nParamCount === 3;
  if (bSumExtraRange) {
    // Save only the upperleft cell in case of cell range.  The geometry
    // of the 3rd parameter is taken from the 1st parameter.

    switch (this.GetStackType()) {
      case svDoubleRef: {
        const r = this.PopDoubleRef();
        nCol3 = r.aStart.Col();
        nRow3 = r.aStart.Row();
        nTab3 = r.aStart.Tab();
        if (r.aEnd.Tab() !== nTab3) {
          this.PushError(FormulaError.IllegalParameter);
          return;
        }
        break;
      }
      case svSingleRef: {
        const aAdr = this.PopSingleRef();
        nCol3 = aAdr.Col();
        nRow3 = aAdr.Row();
        nTab3 = aAdr.Tab();
        break;
      }
      case svMatrix:
        pSumExtraMatrix = this.PopMatrix();
        // nCol3, nRow3, nTab3 remain 0
        break;
      default:
        this.PushError(FormulaError.IllegalParameter);
        return;
    }
  }

  const c = lcl_GetCriterion(this);
  if (!c) {
    this.PushError(this.nGlobalError);
    return;
  }

  let fVal = 0.0;
  const fSum = new KahanSum(0.0);
  let fRes = 0.0;
  let fCount = 0.0;
  const aState = { nParam: 1, nRefInList: 0 };
  const nMatRows = this.GetRefListArrayMaxSize(aState.nParam);
  // There's either one RefList and nothing else, or none.
  const xResMat = nMatRows ? this.GetNewMat(1, nMatRows, /*bEmpty*/ true) : null;
  let nRefListArrayPos = 0;
  while (aState.nParam-- > 0) {
    let nCol1 = 0;
    let nRow1 = 0;
    let nTab1 = 0;
    let nCol2 = 0;
    let nRow2 = 0;
    let nTab2 = 0;
    let pQueryMatrix: ScMatrix | null = null;
    switch (this.GetStackType()) {
      case svRefList:
        if (bSumExtraRange) {
          /* TODO: this could resolve if all refs are of the same size */
          this.SetError(FormulaError.IllegalParameter);
        } else {
          nRefListArrayPos = aState.nRefInList;
          const aRange = this.PopDoubleRef(aState);
          nCol1 = aRange.aStart.Col();
          nRow1 = aRange.aStart.Row();
          nTab1 = aRange.aStart.Tab();
          nCol2 = aRange.aEnd.Col();
          nRow2 = aRange.aEnd.Row();
          nTab2 = aRange.aEnd.Tab();
        }
        break;
      case svDoubleRef: {
        const aRange = this.PopDoubleRef();
        nCol1 = aRange.aStart.Col();
        nRow1 = aRange.aStart.Row();
        nTab1 = aRange.aStart.Tab();
        nCol2 = aRange.aEnd.Col();
        nRow2 = aRange.aEnd.Row();
        nTab2 = aRange.aEnd.Tab();
        break;
      }
      case svSingleRef: {
        const aAdr = this.PopSingleRef();
        nCol1 = aAdr.Col();
        nRow1 = aAdr.Row();
        nTab1 = aAdr.Tab();
        nCol2 = nCol1;
        nRow2 = nRow1;
        nTab2 = nTab1;
        break;
      }
      case svMatrix: {
        pQueryMatrix = this.GetMatrix();
        if (!pQueryMatrix) {
          this.PushError(FormulaError.IllegalParameter);
          return;
        }
        nCol1 = 0;
        nRow1 = 0;
        nTab1 = 0;
        const { nC, nR } = pQueryMatrix.GetDimensions();
        nCol2 = nC - 1;
        nRow2 = nR - 1;
        nTab2 = 0;
        break;
      }
      default:
        this.SetError(FormulaError.IllegalParameter);
    }
    if (nTab1 !== nTab2) this.SetError(FormulaError.IllegalParameter);

    if (bSumExtraRange) {
      // Take the range geometry of the 1st parameter and apply it to
      // the 3rd. If parts of the resulting range would point outside
      // the sheet, don't complain but silently ignore and simply cut
      // them away, this is what Xcl does :-/

      // For the cut-away part we also don't need to determine the
      // criteria match, so shrink the source range accordingly,
      // instead of the result range.
      const nColDelta = nCol2 - nCol1;
      const nRowDelta = nRow2 - nRow1;
      let nMaxCol: SCCOL;
      let nMaxRow: SCROW;
      if (pSumExtraMatrix) {
        const { nC, nR } = pSumExtraMatrix.GetDimensions();
        nMaxCol = nC - 1;
        nMaxRow = nR - 1;
      } else {
        nMaxCol = this.mrDoc.MaxCol();
        nMaxRow = this.mrDoc.MaxRow();
      }
      if (nCol3 + nColDelta > nMaxCol) {
        const nNewDelta = nMaxCol - nCol3;
        nCol2 = nCol1 + nNewDelta;
      }

      if (nRow3 + nRowDelta > nMaxRow) {
        const nNewDelta = nMaxRow - nRow3;
        nRow2 = nRow1 + nNewDelta;
      }
    } else {
      nCol3 = nCol1;
      nRow3 = nRow1;
      nTab3 = nTab1;
    }

    if (this.nGlobalError === FormulaError.NONE) {
      const rParam = new ScQueryParam();
      rParam.nRow1 = nRow1;
      rParam.nRow2 = nRow2;

      const rEntry = rParam.GetEntry(0);
      lcl_FillCriterion(this, rParam, c);
      const aAdr = new ScAddress(0, 0, nTab3);
      rParam.nCol1 = nCol1;
      rParam.nCol2 = nCol2;
      rEntry.nField = nCol1;
      const nColDiff = nCol3 - nCol1;
      const nRowDiff = nRow3 - nRow1;
      if (pQueryMatrix) {
        // Never case-sensitive.
        const aOptions = newCompareOptions(this.mrDoc, rEntry, rParam.eSearchType);
        const pResultMatrix = this.QueryMat(pQueryMatrix, aOptions);
        if (this.nGlobalError !== FormulaError.NONE || !pResultMatrix) {
          this.PushIllegalParameter();
          return;
        }

        if (pSumExtraMatrix) {
          for (let nCol = nCol1; nCol <= nCol2; ++nCol) {
            for (let nRow = nRow1; nRow <= nRow2; ++nRow) {
              if (pResultMatrix.IsValue(nCol, nRow) && pResultMatrix.GetDouble(nCol, nRow) !== 0) {
                const nC = nCol + nColDiff;
                const nR = nRow + nRowDiff;
                if (pSumExtraMatrix.IsValue(nC, nR)) {
                  fVal = pSumExtraMatrix.GetDouble(nC, nR);
                  ++fCount;
                  fSum.add(fVal);
                }
              }
            }
          }
        } else if (!bSumExtraRange) {
          for (let nCol = nCol1; nCol <= nCol2; ++nCol) {
            for (let nRow = nRow1; nRow <= nRow2; ++nRow) {
              if (pResultMatrix.IsValue(nCol, nRow) && pResultMatrix.GetDouble(nCol, nRow) !== 0) {
                if (pQueryMatrix.IsValue(nCol, nRow)) {
                  fVal = pQueryMatrix.GetDouble(nCol, nRow);
                  ++fCount;
                  fSum.add(fVal);
                }
              }
            }
          }
        } else {
          for (let nCol = nCol1; nCol <= nCol2; ++nCol) {
            for (let nRow = nRow1; nRow <= nRow2; ++nRow) {
              if (pResultMatrix.GetDouble(nCol, nRow) !== 0) {
                aAdr.SetCol(nCol + nColDiff);
                aAdr.SetRow(nRow + nRowDiff);
                const aCell = this.mrDoc.GetRefCellValue(aAdr);
                if (aCell.hasNumeric()) {
                  fVal = this.GetCellValue(aAdr, aCell);
                  ++fCount;
                  fSum.add(fVal);
                }
              }
            }
          }
        }
      } else {
        const aCellIter = new ScQueryCellIterator(this.mrDoc, nTab1, rParam, false, false);
        // Increment Entry.nField in iterator when switching to next column.
        aCellIter.SetAdvanceQueryParamEntryField(true);
        if (aCellIter.GetFirst()) {
          if (pSumExtraMatrix) {
            do {
              const nC = aCellIter.GetCol() + nColDiff;
              const nR = aCellIter.GetRow() + nRowDiff;
              if (pSumExtraMatrix.IsValue(nC, nR)) {
                fVal = pSumExtraMatrix.GetDouble(nC, nR);
                ++fCount;
                fSum.add(fVal);
              }
            } while (aCellIter.GetNext());
          } else {
            do {
              aAdr.SetCol(aCellIter.GetCol() + nColDiff);
              aAdr.SetRow(aCellIter.GetRow() + nRowDiff);
              const aCell = this.mrDoc.GetRefCellValue(aAdr);
              if (aCell.hasNumeric()) {
                fVal = this.GetCellValue(aAdr, aCell);
                ++fCount;
                fSum.add(fVal);
              }
            } while (aCellIter.GetNext());
          }
        }
      }
    } else {
      this.PushError(FormulaError.IllegalParameter);
      return;
    }

    switch (eFunc) {
      case ScIterFuncIf.ifSUMIF:
        fRes = fSum.get();
        break;
      case ScIterFuncIf.ifAVERAGEIF:
        fRes = sc_div(fSum.get(), fCount);
        break;
    }
    if (xResMat) {
      if (this.nGlobalError === FormulaError.NONE) xResMat.PutDouble(fRes, 0, nRefListArrayPos);
      else {
        xResMat.PutError(this.nGlobalError, 0, nRefListArrayPos);
        this.nGlobalError = FormulaError.NONE;
      }
      fRes = fCount = 0.0;
      fSum.assign(0);
    }
  }
  if (xResMat) this.PushMatrix(xResMat);
  else this.PushDouble(fRes);
};

ScInterpreter.prototype.ScSumIf = function (this: ScInterpreter): void { this.IterateParametersIf(ScIterFuncIf.ifSUMIF); };

ScInterpreter.prototype.ScAverageIf = function (this: ScInterpreter): void { this.IterateParametersIf(ScIterFuncIf.ifAVERAGEIF); };

ScInterpreter.prototype.ScCountIf = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 2)) return;

  const c = lcl_GetCriterion(this);
  if (!c) {
    this.PushInt(0);
    return;
  }
  let fCount = 0.0;
  const aState = { nParam: 1, nRefInList: 0 };
  const nMatRows = this.GetRefListArrayMaxSize(aState.nParam);
  // There's either one RefList and nothing else, or none.
  const xResMat = nMatRows ? this.GetNewMat(1, nMatRows, /*bEmpty*/ true) : null;
  let nRefListArrayPos = 0;
  while (aState.nParam-- > 0) {
    let nCol1 = 0;
    let nRow1 = 0;
    let nTab1 = 0;
    let nCol2 = 0;
    let nRow2 = 0;
    let nTab2 = 0;
    let pQueryMatrix: ScMatrix | null = null;
    switch (this.GetStackType()) {
      case svRefList:
      case svDoubleRef: {
        if (this.GetStackType() === svRefList) nRefListArrayPos = aState.nRefInList;
        const aRange = this.PopDoubleRef(aState);
        nCol1 = aRange.aStart.Col();
        nRow1 = aRange.aStart.Row();
        nTab1 = aRange.aStart.Tab();
        nCol2 = aRange.aEnd.Col();
        nRow2 = aRange.aEnd.Row();
        nTab2 = aRange.aEnd.Tab();
        break;
      }
      case svSingleRef: {
        const aAdr = this.PopSingleRef();
        nCol1 = aAdr.Col();
        nRow1 = aAdr.Row();
        nTab1 = aAdr.Tab();
        nCol2 = nCol1;
        nRow2 = nRow1;
        nTab2 = nTab1;
        break;
      }
      case svMatrix: {
        pQueryMatrix = this.GetMatrix();
        if (!pQueryMatrix) {
          this.PushIllegalParameter();
          return;
        }
        nCol1 = 0;
        nRow1 = 0;
        nTab1 = 0;
        const { nC, nR } = pQueryMatrix.GetDimensions();
        nCol2 = nC - 1;
        nRow2 = nR - 1;
        nTab2 = 0;
        break;
      }
      default:
        this.PopError(); // Propagate it further
        this.PushIllegalParameter();
        return;
    }
    if (nTab1 !== nTab2) {
      this.PushIllegalParameter();
      return;
    }
    if (nCol1 > nCol2) {
      this.PushIllegalParameter();
      return;
    }
    if (this.nGlobalError === FormulaError.NONE) {
      const rParam = new ScQueryParam();
      rParam.nRow1 = nRow1;
      rParam.nRow2 = nRow2;
      rParam.nTab = nTab1;

      const rEntry = rParam.GetEntry(0);
      lcl_FillCriterion(this, rParam, c);
      rParam.nCol1 = nCol1;
      rParam.nCol2 = nCol2;
      rEntry.nField = nCol1;
      if (pQueryMatrix) {
        // Never case-sensitive.
        const aOptions = newCompareOptions(this.mrDoc, rEntry, rParam.eSearchType);
        const pResultMatrix = this.QueryMat(pQueryMatrix, aOptions);
        if (this.nGlobalError !== FormulaError.NONE || !pResultMatrix) {
          this.PushIllegalParameter();
          return;
        }

        const nSize = pResultMatrix.GetElementCount();
        for (let nIndex = 0; nIndex < nSize; ++nIndex) {
          if (pResultMatrix.IsValue(nIndex) && pResultMatrix.GetDouble(nIndex) !== 0) ++fCount;
        }
      } else {
        const aCellIter = new ScCountIfCellIterator(this.mrDoc, nTab1, rParam, false, false);
        fCount += aCellIter.GetCount();
      }
    } else {
      this.PushIllegalParameter();
      return;
    }
    if (xResMat) {
      xResMat.PutDouble(fCount, 0, nRefListArrayPos);
      fCount = 0.0;
    }
  }
  if (xResMat) this.PushMatrix(xResMat);
  else this.PushDouble(fCount);
};

/** ScDocument::GetDataAreaSubrange (ScTable::GetDataAreaSubrange): shrink a range of one sheet
    to the rows and columns holding data; false (range unchanged) if there is none. */
function lcl_GetDataAreaSubrange(rDoc: ScDocument, rRange: ScRange): boolean {
  const nTab = rRange.aStart.Tab();
  if (nTab !== rRange.aEnd.Tab()) return true;
  const pTab = rDoc.FetchTable(nTab);
  if (!pTab) return true;

  const nCol1 = rRange.aStart.Col();
  let nCol2 = rRange.aEnd.Col();
  if (nCol1 >= pTab.GetAllocatedColumnsCount()) return false;
  nCol2 = Math.min(nCol2, pTab.GetAllocatedColumnsCount() - 1);

  const nRow1 = rRange.aStart.Row(), nRow2 = rRange.aEnd.Row();

  let nFirstNonEmptyCol = -1, nLastNonEmptyCol = -1;
  let nRowStart = nRow2, nRowEnd = nRow1;

  for (let nCol = nCol1; nCol <= nCol2; ++nCol) {
    const pCol = pTab.FetchColumn(nCol);
    if (!pCol) continue;
    // TrimEmptyBlocks
    const nRowStartThis = pCol.HasDataAt(nRow1) ? nRow1 : pCol.GetNextDataPos(nRow1);
    if (nRowStartThis < 0 || nRowStartThis > nRow2) continue;
    const nRowEndThis = pCol.GetLastDataPos(nRow2);
    if (nFirstNonEmptyCol === -1) nFirstNonEmptyCol = nCol;
    nLastNonEmptyCol = nCol;

    nRowStart = Math.min(nRowStart, nRowStartThis);
    nRowEnd = Math.max(nRowEnd, nRowEndThis);
  }

  if (nFirstNonEmptyCol === -1) return false;

  rRange.aStart.Set(nFirstNonEmptyCol, nRowStart, rRange.aStart.Tab());
  rRange.aEnd.Set(nLastNonEmptyCol, nRowEnd, rRange.aEnd.Tab());

  return true;
}

ScInterpreter.prototype.IterateParametersIfs = function (this: ScInterpreter, ResultFunc: (rRes: ParamIfsResult) => number): void {
  let nParamCount = this.GetByte();
  const nQueryCount = Math.trunc(nParamCount / 2);

  let vConditions: Uint8Array = new Uint8Array(0);

  // Range-reduce optimization
  let nStartColDiff = 0;
  let nEndColDiff = 0;
  let nStartRowDiff = 0;
  let nEndRowDiff = 0;
  let bRangeReduce = false;
  let aMainRange = new ScRange();

  let bHasDoubleRefCriteriaRanges = true;
  // Do not attempt main-range reduce if any of the criteria-ranges are not double-refs.
  // For COUNTIFS queries it's possible to range-reduce too, if the query is not supposed
  // to match empty cells (will be checked and undone later if needed), so simply treat
  // the first criteria range as the main range for purposes of detecting if this can be done.
  for (let nParamIdx = 2; nParamIdx < nParamCount; nParamIdx += 2) {
    const pCriteriaRangeToken = this.pStack[this.sp - nParamIdx]!;
    if (pCriteriaRangeToken.GetType() !== svDoubleRef) {
      bHasDoubleRefCriteriaRanges = false;
      break;
    }
  }

  // Probe the main range token, and try if we can shrink the range without altering results.
  const bIsCountIfs = nParamCount % 2 === 0;
  const pMainRangeToken = bIsCountIfs ? this.pStack[this.sp - 1]! : this.pStack[this.sp - nParamCount]!;
  if (pMainRangeToken.GetType() === svDoubleRef && bHasDoubleRefCriteriaRanges) {
    const pRefData = pMainRangeToken.GetDoubleRef() as ScComplexRefData;
    if (!pRefData.IsDeleted()) {
      aMainRange = this.DoubleRefToRange(pRefData);
      if (aMainRange.aStart.Tab() === aMainRange.aEnd.Tab()) {
        // Shrink the range to actual data content.
        const aSubRange = aMainRange.clone();
        lcl_GetDataAreaSubrange(this.mrDoc, aSubRange);
        nStartColDiff = aSubRange.aStart.Col() - aMainRange.aStart.Col();
        nStartRowDiff = aSubRange.aStart.Row() - aMainRange.aStart.Row();
        nEndColDiff = aSubRange.aEnd.Col() - aMainRange.aEnd.Col();
        nEndRowDiff = aSubRange.aEnd.Row() - aMainRange.aEnd.Row();
        bRangeReduce = !!(nStartColDiff || nStartRowDiff || nEndColDiff || nEndRowDiff);
      }
    }
  }

  let fVal = 0.0;
  let nDimensionCols = 0;
  let nDimensionRows = 0;
  const nRefArrayRows = this.GetRefListArrayMaxSize(nParamCount);
  let vRefArrayConditions: Uint8Array[] = [];

  const addConditions = (rVec: Uint8Array, rAdd: Uint8Array): void => {
    for (let i = 0, n = rVec.length; i < n; ++i) rVec[i] = rVec[i]! + rAdd[i]!;
  };

  while (nParamCount > 1 && this.nGlobalError === FormulaError.NONE) {
    // take criteria
    const c = lcl_GetCriterion(this);
    if (!c) {
      this.PushError(this.nGlobalError);
      return;
    }

    if (this.nGlobalError !== FormulaError.NONE) {
      this.PushError(this.nGlobalError);
      return; // and bail out, no need to evaluate other arguments
    }

    // take range
    const aState = { nParam: nParamCount, nRefInList: 0 };
    let nRefArrayPos = SCSIZE_MAX;
    let nCol1 = 0;
    let nRow1 = 0;
    let nTab1 = 0;
    let nCol2 = 0;
    let nRow2 = 0;
    let nTab2 = 0;
    let pQueryMatrix: ScMatrix | null = null;
    while (aState.nParam-- === nParamCount) {
      switch (this.GetStackType()) {
        case svRefList: {
          const p = this.pStack[this.sp - 1];
          if (p instanceof ScRefListToken && p.IsArrayResult()) {
            if (aState.nRefInList === 0) {
              if (!vRefArrayConditions.length) vRefArrayConditions = Array.from({ length: nRefArrayRows }, () => new Uint8Array(0));
              if (vConditions.length) {
                // Similar to other reference list array
                // handling, add/op the current value to
                // all array positions.
                for (let k = 0; k < vRefArrayConditions.length; k++) {
                  const rVec = vRefArrayConditions[k]!;
                  if (!rVec.length) vRefArrayConditions[k] = vConditions.slice();
                  else addConditions(rVec, vConditions);
                }
                // Reset condition results.
                vConditions.fill(0);
              }
            }
            nRefArrayPos = aState.nRefInList;
          }
          const aRange = this.PopDoubleRef(aState);
          nCol1 = aRange.aStart.Col();
          nRow1 = aRange.aStart.Row();
          nTab1 = aRange.aStart.Tab();
          nCol2 = aRange.aEnd.Col();
          nRow2 = aRange.aEnd.Row();
          nTab2 = aRange.aEnd.Tab();
          break;
        }
        case svDoubleRef: {
          const aRange = this.PopDoubleRef();
          nCol1 = aRange.aStart.Col();
          nRow1 = aRange.aStart.Row();
          nTab1 = aRange.aStart.Tab();
          nCol2 = aRange.aEnd.Col();
          nRow2 = aRange.aEnd.Row();
          nTab2 = aRange.aEnd.Tab();
          break;
        }
        case svSingleRef: {
          const aAdr = this.PopSingleRef();
          nCol1 = aAdr.Col();
          nRow1 = aAdr.Row();
          nTab1 = aAdr.Tab();
          nCol2 = nCol1;
          nRow2 = nRow1;
          nTab2 = nTab1;
          break;
        }
        case svMatrix: {
          pQueryMatrix = this.GetMatrix();
          if (!pQueryMatrix) {
            this.PushError(FormulaError.IllegalParameter);
            return;
          }
          nCol1 = 0;
          nRow1 = 0;
          nTab1 = 0;
          const { nC, nR } = pQueryMatrix.GetDimensions();
          nCol2 = nC - 1;
          nRow2 = nR - 1;
          nTab2 = 0;
          break;
        }
        default:
          this.PushError(FormulaError.IllegalParameter);
          return;
      }
      if (nTab1 !== nTab2) {
        this.PushError(FormulaError.IllegalArgument);
        return;
      }

      const rParam = new ScQueryParam();
      const rEntry = rParam.GetEntry(0);
      const rItem = rEntry.GetQueryItem();
      lcl_FillCriterion(this, rParam, c);

      // Undo bRangeReduce if asked to match empty cells for COUNTIFS (which should be rare).
      if (bIsCountIfs && (rEntry.IsQueryByEmpty() || rItem.mbMatchEmpty) && bRangeReduce) {
        bRangeReduce = false;
        // All criteria ranges are svDoubleRef's, so only vConditions needs adjusting.
        if (vConditions.length) {
          const newDimensionCols = nCol2 - nCol1 + 1;
          const newDimensionRows = nRow2 - nRow1 + 1;
          const newConditions = new Uint8Array(newDimensionCols * newDimensionRows);
          let nPos = 0;
          let col = nCol1;
          for (; col < nCol1 + nStartColDiff; ++col) nPos += newDimensionRows;
          for (; col <= nCol2 - nStartColDiff; ++col) {
            nPos += nStartRowDiff;
            const oldCol = col - (nCol1 + nStartColDiff);
            const nIndex = oldCol * nDimensionRows;
            if (nIndex < vConditions.length) newConditions.set(vConditions.subarray(nIndex, nIndex + nDimensionRows), nPos);
            nPos += nDimensionRows;
            nPos += -nEndRowDiff;
          }
          vConditions = newConditions;
          nDimensionCols = newDimensionCols;
          nDimensionRows = newDimensionRows;
        }
      }

      if (bRangeReduce) {
        // All reference ranges must be of the same size as the main range.
        if (aMainRange.aEnd.Col() - aMainRange.aStart.Col() !== nCol2 - nCol1 || aMainRange.aEnd.Row() - aMainRange.aStart.Row() !== nRow2 - nRow1) {
          this.PushError(FormulaError.IllegalArgument);
          return;
        }
        nCol1 += nStartColDiff;
        nRow1 += nStartRowDiff;

        nCol2 += nEndColDiff;
        nRow2 += nEndRowDiff;
      }

      // All reference ranges must be of same dimension and size.
      if (!nDimensionCols) nDimensionCols = nCol2 - nCol1 + 1;
      if (!nDimensionRows) nDimensionRows = nRow2 - nRow1 + 1;
      if (nDimensionCols !== nCol2 - nCol1 + 1 || nDimensionRows !== nRow2 - nRow1 + 1) {
        this.PushError(FormulaError.IllegalArgument);
        return;
      }

      // recalculate matrix values
      if (this.nGlobalError !== FormulaError.NONE) {
        this.PushError(this.nGlobalError);
        return;
      }

      // initialize temporary result matrix
      if (!vConditions.length) vConditions = new Uint8Array(nDimensionCols * nDimensionRows);

      rParam.nRow1 = nRow1;
      rParam.nRow2 = nRow2;
      rParam.nCol1 = nCol1;
      rParam.nCol2 = nCol2;
      rEntry.nField = nCol1;
      const nColDiff = -nCol1;
      const nRowDiff = -nRow1;
      if (pQueryMatrix) {
        // Never case-sensitive.
        const aOptions = newCompareOptions(this.mrDoc, rEntry, rParam.eSearchType);
        const pResultMatrix = this.QueryMat(pQueryMatrix, aOptions);
        if (this.nGlobalError !== FormulaError.NONE || !pResultMatrix) {
          this.PushError(FormulaError.IllegalParameter);
          return;
        }

        // result matrix is filled with boolean values.
        const aResValues = pResultMatrix.GetDoubleArray();
        if (vConditions.length !== aResValues.length) {
          this.PushError(FormulaError.IllegalParameter);
          return;
        }

        for (let i = 0; i < vConditions.length; i++) vConditions[i] = vConditions[i]! + aResValues[i]!;
      } else {
        const aCellIter = new ScQueryCellIterator(this.mrDoc, nTab1, rParam, false, false);
        // Increment Entry.nField in iterator when switching to next column.
        aCellIter.SetAdvanceQueryParamEntryField(true);
        if (aCellIter.GetFirst()) {
          do {
            const nC = aCellIter.GetCol() + nColDiff;
            const nR = aCellIter.GetRow() + nRowDiff;
            ++vConditions[nC * nDimensionRows + nR]!;
          } while (aCellIter.GetNext());
        }
      }
      if (nRefArrayPos !== SCSIZE_MAX) {
        // Apply condition result to reference list array result position.
        const rVec = vRefArrayConditions[nRefArrayPos]!;
        if (!rVec.length) vRefArrayConditions[nRefArrayPos] = vConditions.slice();
        else addConditions(rVec, vConditions);
        // Reset conditions vector.
        // When leaving an svRefList this has to be emptied not set to
        // 0.0 because it's checked when entering an svRefList.
        if (aState.nRefInList === 0) vConditions = new Uint8Array(0);
        else vConditions.fill(0);
      }
    }
    nParamCount -= 2;
  }

  if (vRefArrayConditions.length && vConditions.length) {
    // Add/op the last current value to all array positions.
    for (let k = 0; k < vRefArrayConditions.length; k++) {
      const rVec = vRefArrayConditions[k]!;
      if (!rVec.length) vRefArrayConditions[k] = vConditions.slice();
      else addConditions(rVec, vConditions);
    }
  }

  if (this.nGlobalError !== FormulaError.NONE) {
    this.PushError(this.nGlobalError);
    return; // bail out
  }

  let aRes = newParamIfsResult();
  let xResMat: ScMatrix | null = null;

  // main range - only for AVERAGEIFS, SUMIFS, MINIFS and MAXIFS
  if (nParamCount === 1) {
    const aState = { nParam: nParamCount, nRefInList: 0 };
    let nRefArrayPos = SCSIZE_MAX;
    let bRefArrayMain = false;
    while (aState.nParam-- === nParamCount) {
      let nMainCol1 = 0;
      let nMainRow1 = 0;
      let nMainTab1 = 0;
      let nMainCol2 = 0;
      let nMainRow2 = 0;
      let nMainTab2 = 0;
      let pMainMatrix: ScMatrix | null = null;
      switch (this.GetStackType()) {
        case svRefList: {
          const p = this.pStack[this.sp - 1];
          if (p instanceof ScRefListToken && p.IsArrayResult()) {
            if (!vRefArrayConditions.length) {
              // Replicate conditions if there wasn't a
              // reference list array for criteria
              // evaluation.
              vRefArrayConditions = Array.from({ length: nRefArrayRows }, () => vConditions.slice());
            }

            bRefArrayMain = true;
            nRefArrayPos = aState.nRefInList;
          }
          const aRange = this.PopDoubleRef(aState);
          nMainCol1 = aRange.aStart.Col();
          nMainRow1 = aRange.aStart.Row();
          nMainTab1 = aRange.aStart.Tab();
          nMainCol2 = aRange.aEnd.Col();
          nMainRow2 = aRange.aEnd.Row();
          nMainTab2 = aRange.aEnd.Tab();
          break;
        }
        case svDoubleRef: {
          const aRange = this.PopDoubleRef();
          nMainCol1 = aRange.aStart.Col();
          nMainRow1 = aRange.aStart.Row();
          nMainTab1 = aRange.aStart.Tab();
          nMainCol2 = aRange.aEnd.Col();
          nMainRow2 = aRange.aEnd.Row();
          nMainTab2 = aRange.aEnd.Tab();
          break;
        }
        case svSingleRef: {
          const aAdr = this.PopSingleRef();
          nMainCol1 = aAdr.Col();
          nMainRow1 = aAdr.Row();
          nMainTab1 = aAdr.Tab();
          nMainCol2 = nMainCol1;
          nMainRow2 = nMainRow1;
          nMainTab2 = nMainTab1;
          break;
        }
        case svMatrix: {
          pMainMatrix = this.GetMatrix();
          if (!pMainMatrix) {
            this.PushError(FormulaError.IllegalParameter);
            return;
          }
          nMainCol1 = 0;
          nMainRow1 = 0;
          nMainTab1 = 0;
          const { nC, nR } = pMainMatrix.GetDimensions();
          nMainCol2 = nC - 1;
          nMainRow2 = nR - 1;
          nMainTab2 = 0;
          break;
        }
        // Treat a scalar value as 1x1 matrix.
        case svDouble:
          pMainMatrix = this.GetNewMat(1, 1);
          nMainCol1 = nMainCol2 = 0;
          nMainRow1 = nMainRow2 = 0;
          nMainTab1 = nMainTab2 = 0;
          pMainMatrix.PutDouble(this.GetDouble(), 0, 0);
          break;
        case svString:
          pMainMatrix = this.GetNewMat(1, 1);
          nMainCol1 = nMainCol2 = 0;
          nMainRow1 = nMainRow2 = 0;
          nMainTab1 = nMainTab2 = 0;
          pMainMatrix.PutString(this.GetString(), 0, 0);
          break;
        default:
          this.PopError();
          this.PushError(FormulaError.IllegalParameter);
          return;
      }
      if (nMainTab1 !== nMainTab2) {
        this.PushError(FormulaError.IllegalArgument);
        return;
      }

      if (bRangeReduce) {
        nMainCol1 += nStartColDiff;
        nMainRow1 += nStartRowDiff;

        nMainCol2 += nEndColDiff;
        nMainRow2 += nEndRowDiff;
      }

      // All reference ranges must be of same dimension and size.
      if (nDimensionCols !== nMainCol2 - nMainCol1 + 1 || nDimensionRows !== nMainRow2 - nMainRow1 + 1) {
        this.PushError(FormulaError.IllegalArgument);
        return;
      }

      if (this.nGlobalError !== FormulaError.NONE) {
        this.PushError(this.nGlobalError);
        return; // bail out
      }

      // end-result calculation

      // This gets weird... if conditions were calculated using a
      // reference list array but the main calculation range is not a
      // reference list array, then the conditions of the array are
      // applied to the main range each in turn to form the array result.

      let nRefArrayMainPos = bRefArrayMain ? nRefArrayPos : !vRefArrayConditions.length ? SCSIZE_MAX : 0;
      const bAppliedArray = !bRefArrayMain && nRefArrayMainPos === 0;

      if (nRefArrayMainPos === 0) xResMat = this.GetNewMat(1, nRefArrayRows, /*bEmpty*/ true);

      if (pMainMatrix) {
        const aMainValues = pMainMatrix.GetDoubleArray(false); // Map empty values to NaN's.

        do {
          if (nRefArrayMainPos < vRefArrayConditions.length) vConditions = vRefArrayConditions[nRefArrayMainPos]!;

          if (vConditions.length !== aMainValues.length) {
            this.PushError(FormulaError.IllegalArgument);
            return;
          }

          for (let i = 0; i < vConditions.length; i++) {
            if (vConditions[i] !== nQueryCount) continue;

            fVal = aMainValues[i]!;
            if (GetDoubleErrorValueOf(fVal) === FormulaError.ElementNaN) continue;

            ++aRes.mfCount;
            aRes.mfSum.add(fVal);
            if (aRes.mfMin > fVal) aRes.mfMin = fVal;
            if (aRes.mfMax < fVal) aRes.mfMax = fVal;
          }
          if (nRefArrayMainPos !== SCSIZE_MAX) {
            xResMat!.PutDouble(ResultFunc(aRes), 0, nRefArrayMainPos);
            aRes = newParamIfsResult();
          }
        } while (bAppliedArray && ++nRefArrayMainPos < nRefArrayRows);
      } else {
        const aAdr = new ScAddress(0, 0, nMainTab1);
        do {
          if (nRefArrayMainPos < vRefArrayConditions.length) vConditions = vRefArrayConditions[nRefArrayMainPos]!;

          if (vConditions.length) {
            let itRes = 0;
            for (let nCol = 0; nCol < nDimensionCols; ++nCol) {
              for (let nRow = 0; nRow < nDimensionRows; ++nRow, ++itRes) {
                if (vConditions[itRes] === nQueryCount) {
                  aAdr.SetCol(nCol + nMainCol1);
                  aAdr.SetRow(nRow + nMainRow1);
                  const aCell = this.mrDoc.GetRefCellValue(aAdr);
                  if (aCell.hasNumeric()) {
                    fVal = this.GetCellValue(aAdr, aCell);
                    ++aRes.mfCount;
                    aRes.mfSum.add(fVal);
                    if (aRes.mfMin > fVal) aRes.mfMin = fVal;
                    if (aRes.mfMax < fVal) aRes.mfMax = fVal;
                  }
                }
              }
            }
          }
          if (nRefArrayMainPos !== SCSIZE_MAX) {
            xResMat!.PutDouble(ResultFunc(aRes), 0, nRefArrayMainPos);
            aRes = newParamIfsResult();
          }
        } while (bAppliedArray && ++nRefArrayMainPos < nRefArrayRows);
      }
    }
  } else {
    // COUNTIFS only.
    if (!vRefArrayConditions.length) {
      for (const rCond of vConditions) if (rCond === nQueryCount) ++aRes.mfCount;
    } else {
      xResMat = this.GetNewMat(1, nRefArrayRows, /*bEmpty*/ true);
      for (let i = 0, n = vRefArrayConditions.length; i < n; ++i) {
        let fCount = 0.0;
        for (const rCond of vRefArrayConditions[i]!) if (rCond === nQueryCount) ++fCount;
        xResMat.PutDouble(fCount, 0, i);
      }
    }
  }

  if (xResMat) this.PushMatrix(xResMat);
  else this.PushDouble(ResultFunc(aRes));
};

ScInterpreter.prototype.ScSumIfs = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();

  if (nParamCount < 3 || nParamCount % 2 !== 1) {
    this.PushError(FormulaError.ParameterExpected);
    return;
  }

  this.IterateParametersIfs((rRes) => rRes.mfSum.get());
};

ScInterpreter.prototype.ScAverageIfs = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();

  if (nParamCount < 3 || nParamCount % 2 !== 1) {
    this.PushError(FormulaError.ParameterExpected);
    return;
  }

  this.IterateParametersIfs((rRes) => sc_div(rRes.mfSum.get(), rRes.mfCount));
};

ScInterpreter.prototype.ScCountIfs = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();

  if (nParamCount < 2 || nParamCount % 2 !== 0) {
    this.PushError(FormulaError.ParameterExpected);
    return;
  }

  this.IterateParametersIfs((rRes) => rRes.mfCount);
};

ScInterpreter.prototype.ScMinIfs_MS = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();

  if (nParamCount < 3 || nParamCount % 2 !== 1) {
    this.PushError(FormulaError.ParameterExpected);
    return;
  }

  this.IterateParametersIfs((rRes) => (rRes.mfMin < Number.MAX_VALUE ? rRes.mfMin : 0.0));
};

ScInterpreter.prototype.ScMaxIfs_MS = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();

  if (nParamCount < 3 || nParamCount % 2 !== 1) {
    this.PushError(FormulaError.ParameterExpected);
    return;
  }

  this.IterateParametersIfs((rRes) => (rRes.mfMax > -Number.MAX_VALUE ? rRes.mfMax : 0.0));
};

ScInterpreter.Register(OC.ocCountEmptyCells, ScInterpreter.prototype.ScCountEmptyCells);
ScInterpreter.Register(OC.ocSumIf, ScInterpreter.prototype.ScSumIf);
ScInterpreter.Register(OC.ocAverageIf, ScInterpreter.prototype.ScAverageIf);
ScInterpreter.Register(OC.ocCountIf, ScInterpreter.prototype.ScCountIf);
ScInterpreter.Register(OC.ocSumIfs, ScInterpreter.prototype.ScSumIfs);
ScInterpreter.Register(OC.ocAverageIfs, ScInterpreter.prototype.ScAverageIfs);
ScInterpreter.Register(OC.ocCountIfs, ScInterpreter.prototype.ScCountIfs);
ScInterpreter.Register(OC.ocMinIfs_MS, ScInterpreter.prototype.ScMinIfs_MS);
ScInterpreter.Register(OC.ocMaxIfs_MS, ScInterpreter.prototype.ScMaxIfs_MS);

// @@ CRITERIA (COUNTIF/SUMIF/AVERAGEIF(S), MINIFS/MAXIFS, COUNTBLANK) @@

// MIN, MAX, MINA, MAXA, SUBTOTAL and AGGREGATE. Left out: the array reference lists
// (SwitchToArrayRefList, e.g. MAX(OFFSET(...)) of an array of references in array context), as
// in IterateParameters.

declare module './interpr4.ts' {
  interface ScInterpreter {
    MustHaveParamCountMinWithStackCheck(nAct: number, nMin: number): boolean;
    ScMin(bTextAsZero?: boolean): void;
    ScMax(bTextAsZero?: boolean): void;
    ScSubTotal(): void;
    ScAggregate(): void;
  }
}

ScInterpreter.prototype.MustHaveParamCountMinWithStackCheck = function (this: ScInterpreter, nAct: number, nMin: number): boolean {
  if (this.sp < nAct) {
    this.PushError(FormulaError.UnknownStackVariable);
    return false;
  }
  return this.MustHaveParamCountMin(nAct, nMin);
};

ScInterpreter.prototype.ScMin = function (this: ScInterpreter, bTextAsZero = false): void {
  let nParamCount = this.GetByte();
  if (!this.MustHaveParamCountMin(nParamCount, 1)) return;

  let nMin = Number.MAX_VALUE;
  let nVal = 0.0;
  const refState = { nParam: 0, nRefInList: 0 };
  while (nParamCount-- > 0) {
    switch (this.GetStackType()) {
      case svDouble: {
        nVal = this.GetDouble();
        if (nMin > nVal) nMin = nVal;
        this.nFuncFmtType = SvNumFormatType.NUMBER;
        break;
      }
      case svSingleRef: {
        const aAdr = this.PopSingleRef();
        const aCell = this.mrDoc.GetRefCellValue(aAdr);
        if (aCell.hasNumeric()) {
          nVal = this.GetCellValue(aAdr, aCell);
          this.CurFmtToFuncFmt();
          if (nMin > nVal) nMin = nVal;
        } else if (bTextAsZero && aCell.hasString()) {
          if (nMin > 0.0) nMin = 0.0;
        }
        break;
      }
      case svRefList:
      case svDoubleRef: {
        let nErr: FormulaError = FormulaError.NONE;
        refState.nParam = nParamCount;
        const aRange = this.PopDoubleRef(refState);
        nParamCount = refState.nParam;
        const aValIter = new ScValueIterator(this.mrDoc, aRange, this.mnSubTotalFlags, bTextAsZero);
        let bFirst = true;
        for (const v of aValIter.values()) {
          nVal = v.fVal;
          nErr = v.nErr;
          if (nMin > nVal) nMin = nVal;
          if (bFirst) {
            const info = aValIter.GetCurNumFmtInfo();
            this.nFuncFmtType = info.nType;
            this.nFuncFmtIndex = info.aCode;
            bFirst = false;
          }
          if (nErr !== FormulaError.NONE) break;
        }
        this.SetError(nErr);
        break;
      }
      case svMatrix: {
        const pMat = this.GetMatrix();
        if (pMat) {
          this.nFuncFmtType = SvNumFormatType.NUMBER;
          nVal = pMat.GetMinValue(bTextAsZero, (this.mnSubTotalFlags & SubtotalFlags.IgnoreErrVal) !== 0);
          if (nMin > nVal) nMin = nVal;
        }
        break;
      }
      case svString: {
        this.Pop();
        if (bTextAsZero) {
          if (nMin > 0.0) nMin = 0.0;
        } else this.SetError(FormulaError.IllegalParameter);
        break;
      }
      default:
        this.PopError();
        this.SetError(FormulaError.IllegalParameter);
    }
  }

  if (!Number.isFinite(nVal)) this.PushError(GetDoubleErrorValueOf(nVal));
  else if (nVal < nMin) this.PushDouble(0.0); // zero or only empty arguments
  else this.PushDouble(nMin);
};

ScInterpreter.prototype.ScMax = function (this: ScInterpreter, bTextAsZero = false): void {
  let nParamCount = this.GetByte();
  if (!this.MustHaveParamCountMin(nParamCount, 1)) return;

  let nMax = -Number.MAX_VALUE;
  let nVal = 0.0;
  const refState = { nParam: 0, nRefInList: 0 };
  while (nParamCount-- > 0) {
    switch (this.GetStackType()) {
      case svDouble: {
        nVal = this.GetDouble();
        if (nMax < nVal) nMax = nVal;
        this.nFuncFmtType = SvNumFormatType.NUMBER;
        break;
      }
      case svSingleRef: {
        const aAdr = this.PopSingleRef();
        const aCell = this.mrDoc.GetRefCellValue(aAdr);
        if (aCell.hasNumeric()) {
          nVal = this.GetCellValue(aAdr, aCell);
          this.CurFmtToFuncFmt();
          if (nMax < nVal) nMax = nVal;
        } else if (bTextAsZero && aCell.hasString()) {
          if (nMax < 0.0) nMax = 0.0;
        }
        break;
      }
      case svRefList:
      case svDoubleRef: {
        let nErr: FormulaError = FormulaError.NONE;
        refState.nParam = nParamCount;
        const aRange = this.PopDoubleRef(refState);
        nParamCount = refState.nParam;
        const aValIter = new ScValueIterator(this.mrDoc, aRange, this.mnSubTotalFlags, bTextAsZero);
        let bFirst = true;
        for (const v of aValIter.values()) {
          nVal = v.fVal;
          nErr = v.nErr;
          if (nMax < nVal) nMax = nVal;
          if (bFirst) {
            const info = aValIter.GetCurNumFmtInfo();
            this.nFuncFmtType = info.nType;
            this.nFuncFmtIndex = info.aCode;
            bFirst = false;
          }
          if (nErr !== FormulaError.NONE) break;
        }
        this.SetError(nErr);
        break;
      }
      case svMatrix: {
        const pMat = this.GetMatrix();
        if (pMat) {
          this.nFuncFmtType = SvNumFormatType.NUMBER;
          nVal = pMat.GetMaxValue(bTextAsZero, (this.mnSubTotalFlags & SubtotalFlags.IgnoreErrVal) !== 0);
          if (nMax < nVal) nMax = nVal;
        }
        break;
      }
      case svString: {
        this.Pop();
        if (bTextAsZero) {
          if (nMax < 0.0) nMax = 0.0;
        } else this.SetError(FormulaError.IllegalParameter);
        break;
      }
      default:
        this.PopError();
        this.SetError(FormulaError.IllegalParameter);
    }
  }

  if (!Number.isFinite(nVal)) this.PushError(GetDoubleErrorValueOf(nVal));
  else if (nVal > nMax) this.PushDouble(0.0); // zero or only empty arguments
  else this.PushDouble(nMax);
};

/** Call the implementation of another opcode with the current cPar, as upstream's direct calls
    of ScStDev(), ScMedian() et al. do; an opcode without implementation gives Err:517. */
function lcl_CallOpCode(self: ScInterpreter, eOp: OpCode): void {
  const f = ScInterpreter.maOpCodeFuncs.get(eOp);
  if (f) f.call(self);
  else self.PushError(FormulaError.UnknownOpCode);
}

// The function numbers of SUBTOTAL (SUBTOTAL_FUNC_*) and AGGREGATE (AGGREGATE_FUNC_*).
const SUBTOTAL_FUNC_AVE = 1, SUBTOTAL_FUNC_CNT = 2, SUBTOTAL_FUNC_CNT2 = 3, SUBTOTAL_FUNC_MAX = 4, SUBTOTAL_FUNC_MIN = 5, SUBTOTAL_FUNC_PROD = 6;
const SUBTOTAL_FUNC_STD = 7, SUBTOTAL_FUNC_STDP = 8, SUBTOTAL_FUNC_SUM = 9, SUBTOTAL_FUNC_VAR = 10, SUBTOTAL_FUNC_VARP = 11;
const AGGREGATE_FUNC_AVE = 1, AGGREGATE_FUNC_CNT = 2, AGGREGATE_FUNC_CNT2 = 3, AGGREGATE_FUNC_MAX = 4, AGGREGATE_FUNC_MIN = 5, AGGREGATE_FUNC_PROD = 6;
const AGGREGATE_FUNC_STD = 7, AGGREGATE_FUNC_STDP = 8, AGGREGATE_FUNC_SUM = 9, AGGREGATE_FUNC_VAR = 10, AGGREGATE_FUNC_VARP = 11, AGGREGATE_FUNC_MEDIAN = 12;
const AGGREGATE_FUNC_MODSNGL = 13, AGGREGATE_FUNC_LARGE = 14, AGGREGATE_FUNC_SMALL = 15, AGGREGATE_FUNC_PERCINC = 16, AGGREGATE_FUNC_QRTINC = 17;
const AGGREGATE_FUNC_PERCEXC = 18, AGGREGATE_FUNC_QRTEXC = 19;

ScInterpreter.prototype.ScSubTotal = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCountMinWithStackCheck(nParamCount, 2)) return;

  // We must fish the 1st parameter deep from the stack! And push it on top.
  const p = this.pStack[this.sp - nParamCount]!;
  this.PushWithoutError(p);
  let nFunc = this.GetInt32();
  this.mnSubTotalFlags |= SubtotalFlags.IgnoreNestedStAg | SubtotalFlags.IgnoreFiltered;
  if (nFunc > 100) {
    // For opcodes 101 through 111, we need to skip hidden cells.
    // Other than that these opcodes are identical to 1 through 11.
    this.mnSubTotalFlags |= SubtotalFlags.IgnoreHidden;
    nFunc -= 100;
  }

  if (this.nGlobalError !== FormulaError.NONE || nFunc < 1 || nFunc > 11) this.PushIllegalArgument(); // simulate return on stack, not SetError(...)
  else {
    this.cPar = nParamCount - 1;
    switch (nFunc) {
      case SUBTOTAL_FUNC_AVE: this.ScAverage(); break;
      case SUBTOTAL_FUNC_CNT: this.ScCount(); break;
      case SUBTOTAL_FUNC_CNT2: this.ScCount2(); break;
      case SUBTOTAL_FUNC_MAX: this.ScMax(); break;
      case SUBTOTAL_FUNC_MIN: this.ScMin(); break;
      case SUBTOTAL_FUNC_PROD: this.ScProduct(); break;
      case SUBTOTAL_FUNC_STD: lcl_CallOpCode(this, OC.ocStDev); break;
      case SUBTOTAL_FUNC_STDP: lcl_CallOpCode(this, OC.ocStDevP); break;
      case SUBTOTAL_FUNC_SUM: this.ScSum(); break;
      case SUBTOTAL_FUNC_VAR: lcl_CallOpCode(this, OC.ocVar); break;
      case SUBTOTAL_FUNC_VARP: lcl_CallOpCode(this, OC.ocVarP); break;
      default: this.PushIllegalArgument(); break;
    }
  }
  this.mnSubTotalFlags = SubtotalFlags.NONE;
  // Get rid of the 1st (fished) parameter.
  const xRef = this.PopToken();
  this.Pop();
  this.PushTokenRef(xRef!);
};

ScInterpreter.prototype.ScAggregate = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCountMinWithStackCheck(nParamCount, 3)) return;

  const nErr = this.nGlobalError;
  this.nGlobalError = FormulaError.NONE;

  // fish the 1st parameter from the stack and push it on top.
  const p = this.pStack[this.sp - nParamCount]!;
  this.PushWithoutError(p);
  const nFunc = this.GetInt32();
  // fish the 2nd parameter from the stack and push it on top.
  const p2 = this.pStack[this.sp - (nParamCount - 1)]!;
  this.PushWithoutError(p2);
  const nOption = this.GetInt32();

  if (this.nGlobalError !== FormulaError.NONE || nFunc < 1 || nFunc > 19) {
    this.nGlobalError = nErr;
    this.PushIllegalArgument();
  } else {
    switch (nOption) {
      case 0: // ignore nested SUBTOTAL and AGGREGATE functions
        this.mnSubTotalFlags = SubtotalFlags.IgnoreNestedStAg;
        break;
      case 1: // ignore hidden rows, nested SUBTOTAL and AGGREGATE functions
        this.mnSubTotalFlags = SubtotalFlags.IgnoreHidden | SubtotalFlags.IgnoreNestedStAg;
        break;
      case 2: // ignore error values, nested SUBTOTAL and AGGREGATE functions
        this.mnSubTotalFlags = SubtotalFlags.IgnoreErrVal | SubtotalFlags.IgnoreNestedStAg;
        break;
      case 3: // ignore hidden rows, error values, nested SUBTOTAL and AGGREGATE functions
        this.mnSubTotalFlags = SubtotalFlags.IgnoreHidden | SubtotalFlags.IgnoreErrVal | SubtotalFlags.IgnoreNestedStAg;
        break;
      case 4: // ignore nothing
        this.mnSubTotalFlags = SubtotalFlags.NONE;
        break;
      case 5: // ignore hidden rows
        this.mnSubTotalFlags = SubtotalFlags.IgnoreHidden;
        break;
      case 6: // ignore error values
        this.mnSubTotalFlags = SubtotalFlags.IgnoreErrVal;
        break;
      case 7: // ignore hidden rows and error values
        this.mnSubTotalFlags = SubtotalFlags.IgnoreHidden | SubtotalFlags.IgnoreErrVal;
        break;
      default:
        this.nGlobalError = nErr;
        this.PushIllegalArgument();
        return;
    }

    if ((this.mnSubTotalFlags & SubtotalFlags.IgnoreErrVal) === SubtotalFlags.NONE) this.nGlobalError = nErr;

    this.cPar = nParamCount - 2;
    switch (nFunc) {
      case AGGREGATE_FUNC_AVE: this.ScAverage(); break;
      case AGGREGATE_FUNC_CNT: this.ScCount(); break;
      case AGGREGATE_FUNC_CNT2: this.ScCount2(); break;
      case AGGREGATE_FUNC_MAX: this.ScMax(); break;
      case AGGREGATE_FUNC_MIN: this.ScMin(); break;
      case AGGREGATE_FUNC_PROD: this.ScProduct(); break;
      case AGGREGATE_FUNC_STD: lcl_CallOpCode(this, OC.ocStDev); break;
      case AGGREGATE_FUNC_STDP: lcl_CallOpCode(this, OC.ocStDevP); break;
      case AGGREGATE_FUNC_SUM: this.ScSum(); break;
      case AGGREGATE_FUNC_VAR: lcl_CallOpCode(this, OC.ocVar); break;
      case AGGREGATE_FUNC_VARP: lcl_CallOpCode(this, OC.ocVarP); break;
      case AGGREGATE_FUNC_MEDIAN: lcl_CallOpCode(this, OC.ocMedian); break;
      case AGGREGATE_FUNC_MODSNGL: lcl_CallOpCode(this, OC.ocModalValue); break;
      case AGGREGATE_FUNC_LARGE: lcl_CallOpCode(this, OC.ocLarge); break;
      case AGGREGATE_FUNC_SMALL: lcl_CallOpCode(this, OC.ocSmall); break;
      case AGGREGATE_FUNC_PERCINC: lcl_CallOpCode(this, OC.ocPercentile_Inc); break; // ScPercentile( true )
      case AGGREGATE_FUNC_QRTINC: lcl_CallOpCode(this, OC.ocQuartile_Inc); break; // ScQuartile( true )
      case AGGREGATE_FUNC_PERCEXC: lcl_CallOpCode(this, OC.ocPercentile_Exc); break; // ScPercentile( false )
      case AGGREGATE_FUNC_QRTEXC: lcl_CallOpCode(this, OC.ocQuartile_Exc); break; // ScQuartile( false )
      default:
        this.nGlobalError = nErr;
        this.PushIllegalArgument();
        break;
    }
    this.mnSubTotalFlags = SubtotalFlags.NONE;
  }
  const xRef = this.PopToken();
  // Get rid of the 1st and 2nd (fished) parameters.
  this.Pop();
  this.Pop();
  this.PushTokenRef(xRef!);
};

ScInterpreter.Register(OC.ocMin, function (this: ScInterpreter) { this.ScMin(false); });
ScInterpreter.Register(OC.ocMinA, function (this: ScInterpreter) { this.ScMin(true); });
ScInterpreter.Register(OC.ocMax, function (this: ScInterpreter) { this.ScMax(false); });
ScInterpreter.Register(OC.ocMaxA, function (this: ScInterpreter) { this.ScMax(true); });
ScInterpreter.Register(OC.ocSubTotal, ScInterpreter.prototype.ScSubTotal);
ScInterpreter.Register(OC.ocAggregate, ScInterpreter.prototype.ScAggregate);

// @@ MINMAX (MIN, MAX, MINA, MAXA, SUBTOTAL, AGGREGATE) @@

declare module './interpr4.ts' {
  interface ScInterpreter {
    GetStVarParams(bTextAsZero: boolean, VarResult: (fVal: number, nValCount: number) => number): void;
    ScVar(bTextAsZero?: boolean): void;
    ScVarP(bTextAsZero?: boolean): void;
    ScStDev(bTextAsZero?: boolean): void;
    ScStDevP(bTextAsZero?: boolean): void;
  }
}

/** ScInterpreter::GetRefListArrayMaxSize (interpr6.cxx): the largest size of the array result
    reference lists among the parameters, in array context. */
function lcl_GetRefListArrayMaxSize(self: ScInterpreter, nParamCount: number): number {
  let nSize = 0;
  if (self.IsInArrayContext()) {
    for (let i = 1; i <= nParamCount; ++i) {
      if (self.GetStackType(i) === svRefList) {
        const p = self.pStack[self.sp - i];
        if (p instanceof ScRefListToken && p.IsArrayResult() && p.GetRefList().length > nSize) nSize = p.GetRefList().length;
      }
    }
  }
  return nSize;
}

ScInterpreter.prototype.GetStVarParams = function (this: ScInterpreter, bTextAsZero: boolean, VarResult: (fVal: number, nValCount: number) => number): void {
  let nParamCount = this.GetByte();
  const nMatRows = lcl_GetRefListArrayMaxSize(this, nParamCount);

  class ArrayRefListValue {
    mvValues: number[] = [];
    mfSum = new KahanSum();
    get(): number { return this.mfSum.get(); }
  }
  const vArrayValues: ArrayRefListValue[] = [];

  let values: number[] = [];
  let fSum = new KahanSum(0.0);
  let fVal = 0.0;
  const st = { nParam: 0, nRefInList: 0 };
  while (this.nGlobalError === FormulaError.NONE && nParamCount-- > 0) {
    let eType = this.GetStackType();
    if (eType === svRefList) {
      const p = this.pStack[this.sp - 1];
      if (p instanceof ScRefListToken && p.IsArrayResult()) {
        const nRefArrayPos = st.nRefInList;
        if (vArrayValues.length === 0) {
          // Create and init all elements with current value.
          for (let i = 0; i < nMatRows; i++) {
            const it = new ArrayRefListValue();
            it.mvValues = values.slice();
            it.mfSum = new KahanSum();
            it.mfSum.add(fSum);
            vArrayValues.push(it);
          }
        } else {
          // Current value and values from vector are operands
          // for each vector position.
          for (const it of vArrayValues) {
            it.mvValues.push(...values);
            it.mfSum.add(fSum);
          }
        }
        const rArrayValue = vArrayValues[nRefArrayPos]!;
        st.nParam = nParamCount;
        const aRange = this.PopDoubleRef(st);
        nParamCount = st.nParam;
        const aValIter = new ScValueIterator(this.mrDoc, aRange, this.mnSubTotalFlags, bTextAsZero);
        let nErr: FormulaError = FormulaError.NONE;
        for (const v of aValIter.values()) {
          rArrayValue.mvValues.push(v.fVal);
          rArrayValue.mfSum.add(v.fVal);
          nErr = v.nErr;
          if (nErr !== FormulaError.NONE) break;
        }
        if (nErr !== FormulaError.NONE) {
          rArrayValue.mfSum = new KahanSum(CreateDoubleError(nErr));
        }
        // Reset.
        values = [];
        fSum = new KahanSum(0.0);
        continue;
      }
      eType = svDoubleRef; // [[fallthrough]]
    }
    switch (eType) {
      case svDouble: {
        fVal = this.GetDouble();
        if (this.nGlobalError === FormulaError.NONE) {
          values.push(fVal);
          fSum.add(fVal);
        }
        break;
      }
      case svSingleRef: {
        const aAdr = this.PopSingleRef();
        const aCell = this.mrDoc.GetRefCellValue(aAdr);
        if (aCell.hasNumeric()) {
          fVal = this.GetCellValue(aAdr, aCell);
          if (this.nGlobalError === FormulaError.NONE) {
            values.push(fVal);
            fSum.add(fVal);
          }
        } else if (bTextAsZero && aCell.hasString()) {
          values.push(0.0);
        }
        break;
      }
      case svDoubleRef: {
        st.nParam = nParamCount;
        const aRange = this.PopDoubleRef(st);
        nParamCount = st.nParam;
        const aValIter = new ScValueIterator(this.mrDoc, aRange, this.mnSubTotalFlags, bTextAsZero);
        let nErr: FormulaError = FormulaError.NONE;
        for (const v of aValIter.values()) {
          values.push(v.fVal);
          fSum.add(v.fVal);
          nErr = v.nErr;
          if (nErr !== FormulaError.NONE) break;
        }
        if (nErr !== FormulaError.NONE) {
          this.SetError(nErr);
        }
        break;
      }
      case svExternalSingleRef:
      case svExternalDoubleRef:
      case svMatrix: {
        const pMat = this.GetMatrix();
        if (pMat) {
          const bIgnoreErrVal = (this.mnSubTotalFlags & SubtotalFlags.IgnoreErrVal) !== 0;
          const { nC, nR } = pMat.GetDimensions();
          for (let nMatCol = 0; nMatCol < nC; nMatCol++) {
            for (let nMatRow = 0; nMatRow < nR; nMatRow++) {
              if (!pMat.IsStringOrEmpty(nMatCol, nMatRow)) {
                fVal = pMat.GetDouble(nMatCol, nMatRow);
                if (this.nGlobalError === FormulaError.NONE) {
                  values.push(fVal);
                  fSum.add(fVal);
                } else if (bIgnoreErrVal) this.nGlobalError = FormulaError.NONE;
              } else if (bTextAsZero) {
                values.push(0.0);
              }
            }
          }
        }
        break;
      }
      case svString: {
        this.Pop();
        if (bTextAsZero) {
          values.push(0.0);
        } else this.SetError(FormulaError.IllegalParameter);
        break;
      }
      default:
        this.PopError();
        this.SetError(FormulaError.IllegalParameter);
    }
  }

  if (vArrayValues.length !== 0) {
    // Include value of last non-references-array type and calculate final result.
    if (values.length !== 0) {
      for (const it of vArrayValues) {
        it.mvValues.push(...values);
        it.mfSum.add(fSum);
      }
    }
    const xResMat = this.GetNewMat(1, nMatRows, true);
    for (let r = 0; r < nMatRows; ++r) {
      const n = vArrayValues[r]!.mvValues.length;
      if (!n) xResMat.PutError(FormulaError.DivisionByZero, 0, r);
      else {
        const rArrayValue = vArrayValues[r]!;
        let vSum = 0.0;
        const vMean = rArrayValue.get() / n;
        for (let i = 0; i < n; i++) vSum += approxSub(rArrayValue.mvValues[i]!, vMean) * approxSub(rArrayValue.mvValues[i]!, vMean);
        xResMat.PutDouble(VarResult(vSum, n), 0, r);
      }
    }
    this.PushMatrix(xResMat);
  } else {
    const n = values.length;
    if (!n) this.SetError(FormulaError.DivisionByZero);
    let vSum = 0.0;
    if (this.nGlobalError === FormulaError.NONE) {
      const vMean = fSum.get() / n;
      for (let i = 0; i < n; i++) vSum += approxSub(values[i]!, vMean) * approxSub(values[i]!, vMean);
    }
    this.PushDouble(VarResult(vSum, n));
  }
};

ScInterpreter.prototype.ScVar = function (this: ScInterpreter, bTextAsZero = false): void {
  const VarResult = (fVal: number, nValCount: number): number => {
    if (nValCount <= 1) return CreateDoubleError(FormulaError.DivisionByZero);
    return fVal / (nValCount - 1);
  };
  this.GetStVarParams(bTextAsZero, VarResult);
};

ScInterpreter.prototype.ScVarP = function (this: ScInterpreter, bTextAsZero = false): void {
  const VarResult = (fVal: number, nValCount: number): number => {
    // sc::div
    return nValCount !== 0 ? fVal / nValCount : CreateDoubleError(FormulaError.DivisionByZero);
  };
  this.GetStVarParams(bTextAsZero, VarResult);
};

ScInterpreter.prototype.ScStDev = function (this: ScInterpreter, bTextAsZero = false): void {
  const VarResult = (fVal: number, nValCount: number): number => {
    if (nValCount <= 1) return CreateDoubleError(FormulaError.DivisionByZero);
    return Math.sqrt(fVal / (nValCount - 1));
  };
  this.GetStVarParams(bTextAsZero, VarResult);
};

ScInterpreter.prototype.ScStDevP = function (this: ScInterpreter, bTextAsZero = false): void {
  const VarResult = (fVal: number, nValCount: number): number => {
    if (nValCount === 0) return CreateDoubleError(FormulaError.DivisionByZero);
    return Math.sqrt(fVal / nValCount);
  };
  this.GetStVarParams(bTextAsZero, VarResult);

  /* this was: PushDouble( sqrt( div( nVal, nValCount)));
   *
   * Besides that the special NAN gets lost in the call through sqrt(),
   * unxlngi6.pro then looped back and forth somewhere between div() and
   * ::rtl::math::setNan(). Tests showed that
   *
   *      sqrt( div( 1, 0));
   *
   * produced a loop, but
   *
   *      double f1 = div( 1, 0);
   *      sqrt( f1 );
   *
   * was fine. There seems to be some compiler optimization problem. It does
   * not occur when compiled with debug=t.
   */
};

ScInterpreter.Register(OC.ocVar, function (this: ScInterpreter) { this.ScVar(); });
ScInterpreter.Register(OC.ocVarS, function (this: ScInterpreter) { this.ScVar(); });
ScInterpreter.Register(OC.ocVarA, function (this: ScInterpreter) { this.ScVar(true); });
ScInterpreter.Register(OC.ocVarP, function (this: ScInterpreter) { this.ScVarP(); });
ScInterpreter.Register(OC.ocVarP_MS, function (this: ScInterpreter) { this.ScVarP(); });
ScInterpreter.Register(OC.ocVarPA, function (this: ScInterpreter) { this.ScVarP(true); });
ScInterpreter.Register(OC.ocStDev, function (this: ScInterpreter) { this.ScStDev(); });
ScInterpreter.Register(OC.ocStDevS, function (this: ScInterpreter) { this.ScStDev(); });
ScInterpreter.Register(OC.ocStDevA, function (this: ScInterpreter) { this.ScStDev(true); });
ScInterpreter.Register(OC.ocStDevP, function (this: ScInterpreter) { this.ScStDevP(); });
ScInterpreter.Register(OC.ocStDevP_MS, function (this: ScInterpreter) { this.ScStDevP(); });
ScInterpreter.Register(OC.ocStDevPA, function (this: ScInterpreter) { this.ScStDevP(true); });

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
