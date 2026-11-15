// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/core/tool/interpr5.cxx reduced
// @upstream sc/source/core/tool/compare.cxx reduced
// The arithmetic and comparison operators with their array (matrix) forms, the concatenation,
// SUMPRODUCT, MMULT, TRANSPOSE, MDETERM-free matrix helpers and the array formula cells (ocMatRef).
// The comparison (sc::CompareFunc) without query options. Left out: LINEST, LOGEST, TREND,
// GROWTH, MINVERSE, MDETERM, FREQUENCY and MUNIT.
import { CreateDoubleError, FormulaError, GetDoubleErrorValue } from '../../../../include/formula/errorcodes.ts';
import * as OC from '../../../../include/formula/opcode.ts';
import { svDouble, svDoubleRef, svEmptyCell, svError, svMatrix, svMissing, svSingleRef, svString } from '../../../../formula/source/core/api/token.ts';
import { approxAdd, approxEqual, approxSub } from '../../../../sal/rtl/math.ts';
import { SvNumFormatType } from '../../../../svl/source/numbers/zforlist.ts';
import { CELLTYPE_FORMULA } from '../../../inc/cellvalue.ts';
import { ScQueryOp } from '../../../inc/global.ts';
import { KahanSum } from './kahan.ts';
import { ScEmptyCellToken, ScMatrixToken } from './token.ts';
import { ScInterpreter } from './interpr4.ts';
import { ScMatrix } from './scmatrix.ts';
import { svRefList } from '../../../../formula/source/core/api/token.ts';
import { approxFloor } from '../../../../sal/rtl/math.ts';
import { ScValueIterator } from '../data/dociter.ts';

declare module './interpr4.ts' {
  interface ScInterpreter {
    CalculateAddSub(bSub: boolean): void;
    ScAdd(): void;
    ScSub(): void;
    ScMul(): void;
    ScDiv(): void;
    ScPow(): void;
    ScPower(): void;
    ScAmpersand(): void;
    ScNeg(): void;
    ScPercentSign(): void;
    Compare(eOp: ScQueryOp): number;
    CompareMat(eOp: ScQueryOp): ScMatrix | null;
    ScEqual(): void;
    ScNotEqual(): void;
    ScLess(): void;
    ScGreater(): void;
    ScLessEqual(): void;
    ScGreaterEqual(): void;
    ScSumProduct(): void;
    ScMatMult(): void;
    ScMatTrans(): void;
    ScMatRef(): void;
    MatConcat(pMat1: ScMatrix, pMat2: ScMatrix): ScMatrix | null;
    CheckStringResultLen(rResult: string, nIncrease: number): boolean;
  }
}

/** One side of a comparison (sc::Compare::Cell). */
export interface CompareCell { mfValue: number; maStr: string; mbValue: boolean; mbEmpty: boolean }
/** sc::Compare */
export interface Compare { maCells: [CompareCell, CompareCell]; meOp: ScQueryOp; mbIgnoreCase: boolean }

const collator = new Intl.Collator('en-US', { sensitivity: 'accent', numeric: false });
const caseCollator = new Intl.Collator('en-US', { sensitivity: 'variant', caseFirst: 'lower' });

/** sc::CompareFunc without query options: <0, 0, >0 or an error double. */
export function CompareFunc(rComp: Compare): number {
  const rCell1 = rComp.maCells[0];
  const rCell2 = rComp.maCells[1];

  // Keep DoubleError if encountered
  // #i40539# if bEmpty is set, bVal/nVal are uninitialized
  if (!rCell1.mbEmpty && rCell1.mbValue && !Number.isFinite(rCell1.mfValue)) return rCell1.mfValue;
  if (!rCell2.mbEmpty && rCell2.mbValue && !Number.isFinite(rCell2.mfValue)) return rCell2.mfValue;

  let fRes = 0;
  if (rCell1.mbEmpty) {
    if (rCell2.mbEmpty) {
      // empty cell == empty cell, fRes 0
    } else if (rCell2.mbValue) {
      if (rCell2.mfValue !== 0.0) {
        if (rCell2.mfValue < 0.0) fRes = 1; // empty cell > -x
        else fRes = -1; // empty cell < x
      }
    } else if (rCell2.maStr) fRes = -1; // empty cell < "..."
  } else if (rCell2.mbEmpty) {
    if (rCell1.mbValue) {
      if (rCell1.mfValue !== 0.0) {
        if (rCell1.mfValue < 0.0) fRes = -1; // -x < empty cell
        else fRes = 1; // x > empty cell
      }
    } else if (rCell1.maStr) fRes = 1; // "..." > empty cell
  } else if (rCell1.mbValue) {
    if (rCell2.mbValue) {
      if (!approxEqual(rCell1.mfValue, rCell2.mfValue)) {
        if (rCell1.mfValue - rCell2.mfValue < 0) fRes = -1;
        else fRes = 1;
      }
    } else fRes = -1; // number is less than string
  } else if (rCell2.mbValue) fRes = 1; // string is greater than number
  else if (rComp.meOp === ScQueryOp.SC_EQUAL || rComp.meOp === ScQueryOp.SC_NOT_EQUAL) {
    if (rComp.mbIgnoreCase) fRes = rCell1.maStr.toUpperCase() === rCell2.maStr.toUpperCase() ? 0 : 1;
    else fRes = rCell1.maStr === rCell2.maStr ? 0 : 1;
  } else if (rComp.mbIgnoreCase) fRes = collator.compare(rCell1.maStr, rCell2.maStr);
  else fRes = caseCollator.compare(rCell1.maStr, rCell2.maStr);
  return fRes;
}

const newCell = (): CompareCell => ({ mfValue: 0, maStr: '', mbValue: false, mbEmpty: false });

/** lcl_GetDiffDateTimeFmtType */
function lcl_GetDiffDateTimeFmtType(nFuncFmt: SvNumFormatType, nFmt1: SvNumFormatType | null, nFmt2: SvNumFormatType | null): SvNumFormatType {
  if (nFmt1 === null && nFmt2 === null) return nFuncFmt;
  if (nFmt1 === nFmt2) {
    if (nFmt1 === SvNumFormatType.TIME || nFmt1 === SvNumFormatType.DATETIME) nFuncFmt = SvNumFormatType.TIME; // times result in time duration
    // else: nothing special, number (date - date := days)
  } else if (nFmt1 === null) nFuncFmt = nFmt2!; // e.g. date + days := date
  else if (nFmt2 === null) nFuncFmt = nFmt1;
  else if (nFmt1 === SvNumFormatType.DATE || nFmt2 === SvNumFormatType.DATE || nFmt1 === SvNumFormatType.DATETIME || nFmt2 === SvNumFormatType.DATETIME) {
    if (nFmt1 === SvNumFormatType.TIME || nFmt2 === SvNumFormatType.TIME) nFuncFmt = SvNumFormatType.DATETIME; // date + time
  }
  return nFuncFmt;
}

/** An element-wise operation of two matrices (lcl_MatrixCalculation), extending single rows and
    columns; elements beyond the smaller matrix are #N/A. */
function lcl_MatrixCalculation(rMat1: ScMatrix, rMat2: ScMatrix, pInterpreter: ScInterpreter, op: (a: number, b: number) => number): ScMatrix {
  const d1 = rMat1.GetDimensions(), d2 = rMat2.GetDimensions();
  const nMinC = Math.min(d1.nC, d2.nC), nMinR = Math.min(d1.nR, d2.nR);
  const nMaxC = Math.max(d1.nC, d2.nC), nMaxR = Math.max(d1.nR, d2.nR);
  const nC = d1.nC === 1 || d2.nC === 1 ? nMaxC : nMinC;
  const nR = d1.nR === 1 || d2.nR === 1 ? nMaxR : nMinR;
  const xResMat = pInterpreter.GetNewMat(nC, nR, true);
  for (let i = 0; i < nC; i++) {
    for (let j = 0; j < nR; j++) {
      const p1 = rMat1.ValidColRowOrReplicated(i, j), p2 = rMat2.ValidColRowOrReplicated(i, j);
      if (!p1 || !p2) { xResMat.PutError(FormulaError.NotAvailable, i, j); continue; }
      const v1 = elementValue(rMat1, p1.nC, p1.nR, pInterpreter), v2 = elementValue(rMat2, p2.nC, p2.nR, pInterpreter);
      if (!Number.isFinite(v1)) xResMat.PutDouble(v1, i, j);
      else if (!Number.isFinite(v2)) xResMat.PutDouble(v2, i, j);
      else xResMat.PutDouble(op(v1, v2), i, j);
    }
  }
  return xResMat;
}

/** The numeric value of a matrix element for arithmetic: strings are converted, empty is 0. */
function elementValue(pMat: ScMatrix, nC: number, nR: number, pInterpreter: ScInterpreter): number {
  if (pMat.IsValue(nC, nR)) return pMat.GetDouble(nC, nR);
  if (pMat.IsEmpty(nC, nR) || pMat.IsEmptyPath(nC, nR)) return 0.0;
  // a string: convert, or #VALUE!
  const nErr = pInterpreter.nGlobalError;
  pInterpreter.nGlobalError = FormulaError.NONE;
  const f = pInterpreter.ConvertStringToValue(pMat.GetString(nC, nR));
  const nConvErr = pInterpreter.nGlobalError;
  pInterpreter.nGlobalError = nErr;
  return nConvErr !== FormulaError.NONE ? CreateDoubleError(nConvErr) : f;
}

/** A matrix and a scalar operated element-wise (AddOp, SubOp, MulOp, DivOp, PowOp). */
function lcl_MatrixScalar(pMat: ScMatrix, fVal: number, bFlag: boolean, pInterpreter: ScInterpreter, op: (a: number, b: number) => number): ScMatrix {
  const { nC, nR } = pMat.GetDimensions();
  const xResMat = pInterpreter.GetNewMat(nC, nR, true);
  for (let i = 0; i < nC; i++) {
    for (let j = 0; j < nR; j++) {
      const v = elementValue(pMat, i, j, pInterpreter);
      if (!Number.isFinite(v)) xResMat.PutDouble(v, i, j);
      else if (!Number.isFinite(fVal)) xResMat.PutDouble(fVal, i, j);
      else xResMat.PutDouble(bFlag ? op(fVal, v) : op(v, fVal), i, j);
    }
  }
  return xResMat;
}

const div = (a: number, b: number) => (b === 0.0 ? CreateDoubleError(FormulaError.DivisionByZero) : a / b);
const pow = (a: number, b: number) => {
  const r = Math.pow(a, b);
  return Number.isNaN(r) ? CreateDoubleError(FormulaError.IllegalArgument) : !Number.isFinite(r) ? CreateDoubleError(FormulaError.IllegalFPOperation) : r;
};


ScInterpreter.prototype.CalculateAddSub = function (this: ScInterpreter, bSub: boolean): void {
  let pMat1: ScMatrix | null = null;
  let pMat2: ScMatrix | null = null;
  let fVal1 = 0.0, fVal2 = 0.0;
  let nFmt1: SvNumFormatType | null = null, nFmt2: SvNumFormatType | null = null;
  let nFmtCurrencyType = this.nCurFmtType;
  let nFmtCurrencyIndex = this.nCurFmtIndex;
  let nFmtPercentType = this.nCurFmtType;
  if (this.GetStackType() === svMatrix) pMat2 = this.GetMatrix();
  else {
    fVal2 = this.GetDouble();
    switch (this.nCurFmtType) {
      case SvNumFormatType.DATE:
      case SvNumFormatType.TIME:
      case SvNumFormatType.DATETIME:
        nFmt2 = this.nCurFmtType;
        break;
      case SvNumFormatType.CURRENCY:
        nFmtCurrencyType = this.nCurFmtType;
        nFmtCurrencyIndex = this.nCurFmtIndex;
        break;
      case SvNumFormatType.PERCENT:
        nFmtPercentType = SvNumFormatType.PERCENT;
        break;
      default:
        break;
    }
  }
  if (this.GetStackType() === svMatrix) pMat1 = this.GetMatrix();
  else {
    fVal1 = this.GetDouble();
    switch (this.nCurFmtType) {
      case SvNumFormatType.DATE:
      case SvNumFormatType.TIME:
      case SvNumFormatType.DATETIME:
        nFmt1 = this.nCurFmtType;
        break;
      case SvNumFormatType.CURRENCY:
        nFmtCurrencyType = this.nCurFmtType;
        nFmtCurrencyIndex = this.nCurFmtIndex;
        break;
      case SvNumFormatType.PERCENT:
        nFmtPercentType = SvNumFormatType.PERCENT;
        break;
      default:
        break;
    }
  }
  const op = bSub ? (a: number, b: number) => approxSub(a, b) : (a: number, b: number) => approxAdd(a, b);
  if (pMat1 && pMat2) {
    this.PushMatrix(lcl_MatrixCalculation(pMat1, pMat2, this, op));
  } else if (pMat1 || pMat2) {
    const bFlag = !pMat1; // double - Matrix
    const pMat = pMat1 ?? pMat2!;
    this.PushMatrix(lcl_MatrixScalar(pMat, bFlag ? fVal1 : fVal2, bFlag, this, op));
  } else {
    // Determine nFuncFmtType type before PushDouble().
    if (nFmtCurrencyType === SvNumFormatType.CURRENCY) {
      this.nFuncFmtType = nFmtCurrencyType;
      this.nFuncFmtIndex = nFmtCurrencyIndex;
    } else {
      this.nFuncFmtType = lcl_GetDiffDateTimeFmtType(this.nFuncFmtType, nFmt1, nFmt2);
      if (nFmtPercentType === SvNumFormatType.PERCENT && this.nFuncFmtType === SvNumFormatType.NUMBER) this.nFuncFmtType = SvNumFormatType.PERCENT;
    }
    this.PushDouble(op(fVal1, fVal2));
  }
};

ScInterpreter.prototype.ScAdd = function (this: ScInterpreter): void { this.CalculateAddSub(false); };
ScInterpreter.prototype.ScSub = function (this: ScInterpreter): void { this.CalculateAddSub(true); };

/** Multiplication, division and power share this shape. */
function binaryOp(self: ScInterpreter, op: (a: number, b: number) => number, bCurrencyKeep: boolean): void {
  let pMat1: ScMatrix | null = null, pMat2: ScMatrix | null = null;
  let fVal1 = 0.0, fVal2 = 0.0;
  let nFmtCurrencyType = self.nCurFmtType;
  let nFmtCurrencyIndex = self.nCurFmtIndex;
  if (self.GetStackType() === svMatrix) pMat2 = self.GetMatrix();
  else {
    fVal2 = self.GetDouble();
    if (self.nCurFmtType === SvNumFormatType.CURRENCY) { nFmtCurrencyType = self.nCurFmtType; nFmtCurrencyIndex = self.nCurFmtIndex; }
  }
  if (self.GetStackType() === svMatrix) pMat1 = self.GetMatrix();
  else {
    fVal1 = self.GetDouble();
    if (self.nCurFmtType === SvNumFormatType.CURRENCY) { nFmtCurrencyType = self.nCurFmtType; nFmtCurrencyIndex = self.nCurFmtIndex; }
  }
  if (pMat1 && pMat2) self.PushMatrix(lcl_MatrixCalculation(pMat1, pMat2, self, op));
  else if (pMat1 || pMat2) {
    const bFlag = !pMat1;
    self.PushMatrix(lcl_MatrixScalar(pMat1 ?? pMat2!, bFlag ? fVal1 : fVal2, bFlag, self, op));
  } else {
    if (bCurrencyKeep && nFmtCurrencyType === SvNumFormatType.CURRENCY) {
      self.nFuncFmtType = nFmtCurrencyType;
      self.nFuncFmtIndex = nFmtCurrencyIndex;
    }
    self.PushDouble(op(fVal1, fVal2));
  }
}

ScInterpreter.prototype.ScMul = function (this: ScInterpreter): void { binaryOp(this, (a, b) => a * b, true); };
ScInterpreter.prototype.ScDiv = function (this: ScInterpreter): void { binaryOp(this, div, true); };
ScInterpreter.prototype.ScPow = function (this: ScInterpreter): void { binaryOp(this, pow, false); };
ScInterpreter.prototype.ScPower = function (this: ScInterpreter): void {
  if (this.MustHaveParamCount(this.GetByte(), 2)) this.ScPow();
};

ScInterpreter.prototype.CheckStringResultLen = function (this: ScInterpreter, rResult: string, nIncrease: number): boolean {
  if (rResult.length + nIncrease > 0x7fffffff - 1) {
    this.SetError(FormulaError.StringOverflow);
    return false;
  }
  return true;
};

ScInterpreter.prototype.MatConcat = function (this: ScInterpreter, pMat1: ScMatrix, pMat2: ScMatrix): ScMatrix | null {
  const d1 = pMat1.GetDimensions(), d2 = pMat2.GetDimensions();
  const nC = d1.nC === 1 || d2.nC === 1 ? Math.max(d1.nC, d2.nC) : Math.min(d1.nC, d2.nC);
  const nR = d1.nR === 1 || d2.nR === 1 ? Math.max(d1.nR, d2.nR) : Math.min(d1.nR, d2.nR);
  const xResMat = this.GetNewMat(nC, nR, true);
  for (let i = 0; i < nC; i++)
    for (let j = 0; j < nR; j++) {
      const p1 = pMat1.ValidColRowOrReplicated(i, j), p2 = pMat2.ValidColRowOrReplicated(i, j);
      if (!p1 || !p2) { xResMat.PutError(FormulaError.NotAvailable, i, j); continue; }
      let nErr = pMat1.GetErrorIfNotString(p1.nC, p1.nR);
      if (nErr === FormulaError.NONE) nErr = pMat2.GetErrorIfNotString(p2.nC, p2.nR);
      if (nErr !== FormulaError.NONE) xResMat.PutError(nErr, i, j);
      else xResMat.PutString(matString(this, pMat1, p1.nC, p1.nR) + matString(this, pMat2, p2.nC, p2.nR), i, j);
    }
  return xResMat;
};

/** ScMatrix::GetString(rContext, nC, nR): an element as string (values formatted). */
function matString(self: ScInterpreter, pMat: ScMatrix, nC: number, nR: number): string {
  if (pMat.IsValue(nC, nR)) {
    if (pMat.IsBoolean(nC, nR)) return pMat.GetDouble(nC, nR) ? 'TRUE' : 'FALSE';
    return self.GetStringFromDouble(pMat.GetDouble(nC, nR));
  }
  return pMat.GetString(nC, nR);
}

ScInterpreter.prototype.ScAmpersand = function (this: ScInterpreter): void {
  let pMat1: ScMatrix | null = null, pMat2: ScMatrix | null = null;
  let sStr1 = '', sStr2 = '';
  if (this.GetStackType() === svMatrix) pMat2 = this.GetMatrix();
  else sStr2 = this.GetString();
  if (this.GetStackType() === svMatrix) pMat1 = this.GetMatrix();
  else sStr1 = this.GetString();
  if (pMat1 && pMat2) {
    const pResMat = this.MatConcat(pMat1, pMat2);
    if (!pResMat) this.PushNoValue();
    else this.PushMatrix(pResMat);
  } else if (pMat1 || pMat2) {
    const bFlag = !pMat1;
    const pMat = pMat1 ?? pMat2!;
    const sStr = bFlag ? sStr1 : sStr2;
    const { nC, nR } = pMat.GetDimensions();
    const pResMat = this.GetNewMat(nC, nR, true);
    if (this.nGlobalError !== FormulaError.NONE) {
      for (let i = 0; i < nC; ++i) for (let j = 0; j < nR; ++j) pResMat.PutError(this.nGlobalError, i, j);
    } else {
      for (let i = 0; i < nC; ++i)
        for (let j = 0; j < nR; ++j) {
          const nErr = pMat.GetErrorIfNotString(i, j);
          if (nErr !== FormulaError.NONE) pResMat.PutError(nErr, i, j);
          else pResMat.PutString(bFlag ? sStr + matString(this, pMat, i, j) : matString(this, pMat, i, j) + sStr, i, j);
        }
    }
    this.PushMatrix(pResMat);
  } else {
    if (this.CheckStringResultLen(sStr1, sStr2.length)) sStr1 += sStr2;
    this.PushString(sStr1);
  }
};

ScInterpreter.prototype.ScNeg = function (this: ScInterpreter): void {
  // Simple negation doesn't change current format type to number, keep
  // current type.
  this.nFuncFmtType = this.nCurFmtType;
  switch (this.GetStackType()) {
    case svMatrix: {
      const pMat = this.GetMatrix();
      if (!pMat) this.PushIllegalParameter();
      else {
        const { nC, nR } = pMat.GetDimensions();
        const pResMat = this.GetNewMat(nC, nR, true);
        pResMat.NegOp(pMat);
        this.PushMatrix(pResMat);
      }
      break;
    }
    default:
      this.PushDouble(-this.GetDouble());
  }
};

ScInterpreter.prototype.ScPercentSign = function (this: ScInterpreter): void {
  this.nFuncFmtType = SvNumFormatType.PERCENT;
  const nSavePar = this.cPar;
  this.PushInt(100);
  this.cPar = 2;
  this.ScDiv();
  this.cPar = nSavePar;
  this.nFuncFmtType = SvNumFormatType.PERCENT;
};

ScInterpreter.prototype.Compare = function (this: ScInterpreter, eOp: ScQueryOp): number {
  const aComp: Compare = { maCells: [newCell(), newCell()], meOp: eOp, mbIgnoreCase: this.mrDoc.GetDocOptions().IsIgnoreCase() };
  for (let i = 1; i >= 0; i--) {
    const rCell = aComp.maCells[i]!;
    switch (this.GetRawStackType()) {
      case svEmptyCell:
        this.Pop();
        rCell.mbEmpty = true;
        break;
      case svMissing:
      case svDouble:
        rCell.mfValue = this.GetDouble();
        rCell.mbValue = true;
        break;
      case svString:
        rCell.maStr = this.GetString();
        rCell.mbValue = false;
        break;
      case svDoubleRef:
      case svSingleRef: {
        const aAdr = this.PopDoubleRefOrSingleRef();
        if (!aAdr) break;
        const aCell = this.mrDoc.GetRefCellValue(aAdr);
        if (aCell.hasEmptyValue()) rCell.mbEmpty = true;
        else if (aCell.hasString()) {
          rCell.maStr = this.GetCellString(aCell);
          rCell.mbValue = false;
        } else {
          rCell.mfValue = this.GetCellValue(aAdr, aCell);
          rCell.mbValue = true;
        }
        break;
      }
      case svMatrix: {
        const pMat = this.GetMatrix();
        if (!pMat) { this.SetError(FormulaError.IllegalParameter); break; }
        if (pMat.IsEmpty(0, 0)) rCell.mbEmpty = true;
        else if (pMat.IsStringOrEmpty(0, 0)) { rCell.maStr = pMat.GetString(0, 0); rCell.mbValue = false; }
        else { rCell.mfValue = pMat.GetDouble(0, 0); rCell.mbValue = true; }
        break;
      }
      default:
        this.PopError();
        this.SetError(FormulaError.IllegalParameter);
        break;
    }
  }
  if (this.nGlobalError !== FormulaError.NONE) return 0;
  this.nCurFmtType = this.nFuncFmtType = SvNumFormatType.LOGICAL;
  return CompareFunc(aComp);
};

ScInterpreter.prototype.CompareMat = function (this: ScInterpreter, eOp: ScQueryOp): ScMatrix | null {
  const aComp: Compare = { maCells: [newCell(), newCell()], meOp: eOp, mbIgnoreCase: this.mrDoc.GetDocOptions().IsIgnoreCase() };
  const pMat: (ScMatrix | null)[] = [null, null];
  for (let i = 1; i >= 0; i--) {
    const eType = this.GetStackType();
    if (eType === svMatrix || eType === svDoubleRef) {
      pMat[i] = this.GetMatrix();
      if (!pMat[i]) this.SetError(FormulaError.IllegalParameter);
      else pMat[i]!.SetErrorInterpreter(null);
      // errors are transported as DoubleError inside matrix
    } else {
      const rCell = aComp.maCells[i]!;
      switch (eType) {
        case svDouble:
          rCell.mfValue = this.GetDouble();
          rCell.mbValue = true;
          break;
        case svString:
          rCell.maStr = this.GetString();
          rCell.mbValue = false;
          break;
        case svSingleRef: {
          const aAdr = this.PopSingleRef();
          const aCell = this.mrDoc.GetRefCellValue(aAdr);
          if (aCell.hasEmptyValue()) rCell.mbEmpty = true;
          else if (aCell.hasString()) { rCell.maStr = this.GetCellString(aCell); rCell.mbValue = false; }
          else { rCell.mfValue = this.GetCellValue(aAdr, aCell); rCell.mbValue = true; }
          break;
        }
        default:
          this.PopError();
          this.SetError(FormulaError.IllegalParameter);
      }
    }
  }
  if (this.nGlobalError !== FormulaError.NONE) return null;
  const fill = (rCell: CompareCell, m: ScMatrix, c: number, r: number) => {
    const v = m.Get(c, r);
    rCell.mbEmpty = ScMatrix.IsEmptyType(v.nType) || ScMatrix.IsEmptyPathType(v.nType);
    rCell.mbValue = ScMatrix.IsValueType(v.nType);
    rCell.mfValue = v.fVal;
    rCell.maStr = v.aStr;
  };
  let pResMat: ScMatrix | null = null;
  if (pMat[0] && pMat[1]) {
    const d0 = pMat[0].GetDimensions(), d1 = pMat[1].GetDimensions();
    const nC = d0.nC === 1 || d1.nC === 1 ? Math.max(d0.nC, d1.nC) : Math.min(d0.nC, d1.nC);
    const nR = d0.nR === 1 || d1.nR === 1 ? Math.max(d0.nR, d1.nR) : Math.min(d0.nR, d1.nR);
    pResMat = this.GetNewMat(nC, nR, true);
    for (let j = 0; j < nC; j++)
      for (let k = 0; k < nR; k++) {
        const p0 = pMat[0].ValidColRowOrReplicated(j, k), p1 = pMat[1].ValidColRowOrReplicated(j, k);
        if (!p0 || !p1) { pResMat.PutError(FormulaError.NoValue, j, k); continue; }
        fill(aComp.maCells[0], pMat[0], p0.nC, p0.nR);
        fill(aComp.maCells[1], pMat[1], p1.nC, p1.nR);
        pResMat.PutDouble(CompareFunc(aComp), j, k);
      }
  } else if (pMat[0] || pMat[1]) {
    const i = pMat[0] ? 0 : 1;
    const m = pMat[i]!;
    const { nC, nR } = m.GetDimensions();
    pResMat = this.GetNewMat(nC, nR, true);
    for (let j = 0; j < nC; j++)
      for (let k = 0; k < nR; k++) {
        fill(aComp.maCells[i]!, m, j, k);
        pResMat.PutDouble(CompareFunc(aComp), j, k);
      }
  }
  this.nCurFmtType = this.nFuncFmtType = SvNumFormatType.LOGICAL;
  return pResMat;
};

function compareOp(self: ScInterpreter, eOp: ScQueryOp, test: (f: number) => boolean, matOp: (m: ScMatrix) => void): void {
  if (self.GetStackType(1) === svMatrix || self.GetStackType(2) === svMatrix) {
    const pMat = self.CompareMat(eOp);
    if (!pMat) self.PushIllegalParameter();
    else {
      matOp(pMat);
      // the comparison matrix holds booleans
      const { nC, nR } = pMat.GetDimensions();
      for (let c = 0; c < nC; c++) for (let r = 0; r < nR; r++) if (pMat.IsValue(c, r) && pMat.GetError(c, r) === FormulaError.NONE) pMat.PutBoolean(pMat.GetDouble(c, r) !== 0, c, r);
      self.PushMatrix(pMat);
    }
  } else {
    const f = self.Compare(eOp);
    if (!Number.isFinite(f)) self.PushDouble(f);
    else self.PushInt(test(f) ? 1 : 0);
  }
}

ScInterpreter.prototype.ScEqual = function (this: ScInterpreter): void { compareOp(this, ScQueryOp.SC_EQUAL, (f) => f === 0, (m) => m.CompareEqual()); };
ScInterpreter.prototype.ScNotEqual = function (this: ScInterpreter): void { compareOp(this, ScQueryOp.SC_NOT_EQUAL, (f) => f !== 0, (m) => m.CompareNotEqual()); };
ScInterpreter.prototype.ScLess = function (this: ScInterpreter): void { compareOp(this, ScQueryOp.SC_LESS, (f) => f < 0, (m) => m.CompareLess()); };
ScInterpreter.prototype.ScGreater = function (this: ScInterpreter): void { compareOp(this, ScQueryOp.SC_GREATER, (f) => f > 0, (m) => m.CompareGreater()); };
ScInterpreter.prototype.ScLessEqual = function (this: ScInterpreter): void { compareOp(this, ScQueryOp.SC_LESS_EQUAL, (f) => f <= 0, (m) => m.CompareLessEqual()); };
ScInterpreter.prototype.ScGreaterEqual = function (this: ScInterpreter): void { compareOp(this, ScQueryOp.SC_GREATER_EQUAL, (f) => f >= 0, (m) => m.CompareGreaterEqual()); };

ScInterpreter.prototype.ScSumProduct = function (this: ScInterpreter): void {
  let nParamCount = this.GetByte();
  if (!this.MustHaveParamCountMin(nParamCount, 1)) return;
  const pMatLast = this.GetMatrix();
  --nParamCount;
  if (!pMatLast) {
    this.PushIllegalParameter();
    return;
  }
  const { nC: nCLast, nR: nRLast } = pMatLast.GetDimensions();
  const aResArray = pMatLast.GetDoubleArray();
  while (nParamCount--) {
    const pMat = this.GetMatrix();
    if (!pMat) {
      this.PushIllegalParameter();
      return;
    }
    const { nC, nR } = pMat.GetDimensions();
    if (nC !== nCLast || nR !== nRLast) {
      this.PushNoValue();
      return;
    }
    // MergeDoubleArrayMultiply: non-numeric elements are ElementNaN
    const a = pMat.GetDoubleArray();
    for (let i = 0; i < aResArray.length; i++) {
      const f1 = aResArray[i]!, f2 = a[i]!;
      if (!Number.isFinite(f1)) continue;
      aResArray[i] = Number.isFinite(f2) ? f1 * f2 : f2;
    }
  }
  const fSum = new KahanSum();
  for (const fPosArray of aResArray) {
    const nErr = GetDoubleErrorValue(fPosArray);
    if (nErr === FormulaError.NONE) fSum.add(fPosArray);
    else if (nErr !== FormulaError.ElementNaN) {
      // Propagate the first error encountered, ignore "this is not a number" elements.
      this.PushError(nErr);
      return;
    }
  }
  this.PushDouble(fSum.get());
};

ScInterpreter.prototype.ScMatMult = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 2)) return;
  const pMat2 = this.GetMatrix();
  let pMat1: ScMatrix | null = null;
  let pRMat: ScMatrix | null = null;
  if (pMat2) {
    pMat1 = this.GetMatrix();
    if (pMat1) {
      const { nC: nC1, nR: nR1 } = pMat1.GetDimensions();
      const { nC: nC2, nR: nR2 } = pMat2.GetDimensions();
      if (nC1 !== nR2) this.PushIllegalArgument();
      else if (!pMat1.IsNumeric() || !pMat2.IsNumeric()) this.PushNoValue();
      else {
        pRMat = this.GetNewMat(nC2, nR1);
        for (let i = 0; i < nR1; i++)
          for (let j = 0; j < nC2; j++) {
            const fSum = new KahanSum();
            for (let k = 0; k < nC1; k++) fSum.add(pMat1.GetDouble(k, i) * pMat2.GetDouble(j, k));
            pRMat.PutDouble(fSum.get(), j, i);
          }
        this.PushMatrix(pRMat);
      }
    } else this.PushIllegalParameter();
  } else this.PushIllegalParameter();
};

ScInterpreter.prototype.ScMatTrans = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 1)) return;
  const pMat = this.GetMatrix();
  if (pMat) {
    const { nC, nR } = pMat.GetDimensions();
    const pRMat = this.GetNewMat(nR, nC, true);
    pMat.MatTrans(pRMat);
    this.PushMatrix(pRMat);
  } else this.PushIllegalParameter();
};

ScInterpreter.prototype.ScMatRef = function (this: ScInterpreter): void {
  // In case it contains relative references resolve them as usual.
  this.Push(this.pCur);
  const aAdr = this.PopSingleRef();
  const aCell = this.mrDoc.GetRefCellValue(aAdr);
  if (aCell.getType() !== CELLTYPE_FORMULA) {
    this.PushError(FormulaError.NoRef);
    return;
  }
  const pF = aCell.getFormula()!;
  if (pF.IsRunning()) {
    // Twisted odd corner case where an array element's cell tries to
    // access the top left matrix while it is still running, see tdf#88737
    this.PushError(FormulaError.RetryCircular);
    return;
  }
  const pMat = pF.GetMatrix();
  if (pMat) {
    const { nC: nCols, nR: nRows } = pMat.GetDimensions();
    const nC = this.aPos.Col() - aAdr.Col();
    const nR = this.aPos.Row() - aAdr.Row();
    if ((nCols <= nC && nCols !== 1) || (nRows <= nR && nRows !== 1)) this.PushNA();
    else {
      const nMatVal = pMat.Get(nC, nR);
      const nMatValType = nMatVal.nType;
      if (ScMatrix.IsNonValueType(nMatValType)) {
        if (ScMatrix.IsEmptyPathType(nMatValType)) {
          // result of empty false jump path
          this.nFuncFmtType = SvNumFormatType.LOGICAL;
          this.PushInt(0);
        } else if (ScMatrix.IsEmptyType(nMatValType)) {
          // Not inherited (really?) and display as empty string, not 0.
          this.PushTempToken(new ScEmptyCellToken(false, true));
        } else this.PushString(nMatVal.GetString());
      } else {
        // Determine nFuncFmtType type before PushDouble().
        this.GetNumberFormatInfo(aAdr);
        this.nFuncFmtType = this.nCurFmtType;
        this.nFuncFmtIndex = this.nCurFmtIndex;
        if (nMatValType === 0x01) this.nFuncFmtType = SvNumFormatType.LOGICAL;
        this.PushDouble(nMatVal.fVal); // handles DoubleError
      }
    }
  } else {
    // Determine nFuncFmtType type before PushDouble().
    this.GetNumberFormatInfo(aAdr);
    this.nFuncFmtType = this.nCurFmtType;
    this.nFuncFmtIndex = this.nCurFmtIndex;
    // If not a result matrix, obtain the cell value.
    const nErr = pF.GetErrCode();
    if (nErr !== FormulaError.NONE) this.PushError(nErr);
    else if (pF.IsValue()) this.PushDouble(pF.GetValue());
    else this.PushString(pF.GetString());
  }
};

// --- math (GCD, LCM, SUMX2MY2, SUMX2PY2, SUMXMY2) -----------------------------------------------

declare module './interpr4.ts' {
  interface ScInterpreter {
    ScGetGCD(fx: number, fy: number): number;
    ScGCD(): void;
    ScLCM(): void;
    ScSumX2MY2(): void;
    CalculateSumX2MY2SumX2DY2(_bSumX2DY2: boolean): void;
    ScSumX2DY2(): void;
    ScSumXMY2(): void;
  }
}

ScInterpreter.prototype.ScGetGCD = function (this: ScInterpreter, fx: number, fy: number): number {
  // By ODFF definition GCD(0,a) => a. This is also vital for the code in
  // ScGCD() to work correctly with a preset fy=0.0
  if (fy === 0.0) return fx;
  else if (fx === 0.0) return fy;
  else {
    let fz = fx % fy;
    while (fz > 0.0) {
      fx = fy;
      fy = fz;
      fz = fx % fy;
    }
    return fy;
  }
};

ScInterpreter.prototype.ScGCD = function (this: ScInterpreter): void {
  let nParamCount = this.GetByte();
  if (!this.MustHaveParamCountMin(nParamCount, 1)) return;

  let fx: number, fy = 0.0;
  const st = { nParam: 0, nRefInList: 0 };
  while (this.nGlobalError === FormulaError.NONE && nParamCount-- > 0) {
    switch (this.GetStackType()) {
      case svDouble:
      case svString:
      case svSingleRef: {
        fx = approxFloor(this.GetDouble());
        if (fx < 0.0) {
          this.PushIllegalArgument();
          return;
        }
        fy = this.ScGetGCD(fx, fy);
        break;
      }
      case svDoubleRef:
      case svRefList: {
        let nErr: FormulaError = FormulaError.NONE;
        st.nParam = nParamCount;
        const aRange = this.PopDoubleRef(st);
        nParamCount = st.nParam;
        const aValIter = new ScValueIterator(this.mrDoc, aRange, this.mnSubTotalFlags);
        for (const v of aValIter.values()) {
          nErr = v.nErr;
          fx = approxFloor(v.fVal);
          if (fx < 0.0) {
            this.PushIllegalArgument();
            return;
          }
          fy = this.ScGetGCD(fx, fy);
          if (nErr !== FormulaError.NONE) break;
        }
        this.SetError(nErr);
        break;
      }
      case svMatrix: {
        const pMat = this.GetMatrix();
        if (pMat) {
          const { nC, nR } = pMat.GetDimensions();
          if (nC === 0 || nR === 0) this.SetError(FormulaError.IllegalArgument);
          else {
            const nVal = pMat.GetGcd();
            fy = this.ScGetGCD(nVal, fy);
          }
        }
        break;
      }
      default:
        this.SetError(FormulaError.IllegalParameter);
        break;
    }
  }
  this.PushDouble(fy);
};

ScInterpreter.prototype.ScLCM = function (this: ScInterpreter): void {
  let nParamCount = this.GetByte();
  if (!this.MustHaveParamCountMin(nParamCount, 1)) return;

  let fx: number, fy = 1.0;
  const st = { nParam: 0, nRefInList: 0 };
  while (this.nGlobalError === FormulaError.NONE && nParamCount-- > 0) {
    switch (this.GetStackType()) {
      case svDouble:
      case svString:
      case svSingleRef: {
        fx = approxFloor(this.GetDouble());
        if (fx < 0.0) {
          this.PushIllegalArgument();
          return;
        }
        if (fx === 0.0 || fy === 0.0) fy = 0.0;
        else fy = (fx * fy) / this.ScGetGCD(fx, fy);
        break;
      }
      case svDoubleRef:
      case svRefList: {
        let nErr: FormulaError = FormulaError.NONE;
        st.nParam = nParamCount;
        const aRange = this.PopDoubleRef(st);
        nParamCount = st.nParam;
        const aValIter = new ScValueIterator(this.mrDoc, aRange, this.mnSubTotalFlags);
        for (const v of aValIter.values()) {
          nErr = v.nErr;
          fx = approxFloor(v.fVal);
          if (fx < 0.0) {
            this.PushIllegalArgument();
            return;
          }
          if (fx === 0.0 || fy === 0.0) fy = 0.0;
          else fy = (fx * fy) / this.ScGetGCD(fx, fy);
          if (nErr !== FormulaError.NONE) break;
        }
        this.SetError(nErr);
        break;
      }
      case svMatrix: {
        const pMat = this.GetMatrix();
        if (pMat) {
          const { nC, nR } = pMat.GetDimensions();
          if (nC === 0 || nR === 0) this.SetError(FormulaError.IllegalArgument);
          else {
            const nVal = pMat.GetLcm();
            fy = (nVal * fy) / this.ScGetGCD(nVal, fy);
          }
        }
        break;
      }
      default:
        this.SetError(FormulaError.IllegalParameter);
        break;
    }
  }
  this.PushDouble(fy);
};

ScInterpreter.prototype.ScSumX2MY2 = function (this: ScInterpreter): void {
  this.CalculateSumX2MY2SumX2DY2(false);
};

ScInterpreter.prototype.CalculateSumX2MY2SumX2DY2 = function (this: ScInterpreter, _bSumX2DY2: boolean): void {
  if (!this.MustHaveParamCount(this.GetByte(), 2)) return;

  let i: number, j: number;
  const pMat2 = this.GetMatrix();
  const pMat1 = this.GetMatrix();
  if (!pMat2 || !pMat1) {
    this.PushIllegalParameter();
    return;
  }
  const { nC: nC2, nR: nR2 } = pMat2.GetDimensions();
  const { nC: nC1, nR: nR1 } = pMat1.GetDimensions();
  if (nC1 !== nC2 || nR1 !== nR2) {
    this.PushNoValue();
    return;
  }
  let fVal: number;
  const fSum = new KahanSum(0.0);
  for (i = 0; i < nC1; i++)
    for (j = 0; j < nR1; j++)
      if (!pMat1.IsStringOrEmpty(i, j) && !pMat2.IsStringOrEmpty(i, j)) {
        fVal = pMat1.GetDouble(i, j);
        fSum.add(fVal * fVal);
        fVal = pMat2.GetDouble(i, j);
        if (_bSumX2DY2) fSum.add(fVal * fVal);
        else fSum.subtract(fVal * fVal);
      }
  this.PushDouble(fSum.get());
};

ScInterpreter.prototype.ScSumX2DY2 = function (this: ScInterpreter): void {
  this.CalculateSumX2MY2SumX2DY2(true);
};

ScInterpreter.prototype.ScSumXMY2 = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 2)) return;

  const pMat2 = this.GetMatrix();
  const pMat1 = this.GetMatrix();
  if (!pMat2 || !pMat1) {
    this.PushIllegalParameter();
    return;
  }
  const { nC: nC2, nR: nR2 } = pMat2.GetDimensions();
  const { nC: nC1, nR: nR1 } = pMat1.GetDimensions();
  if (nC1 !== nC2 || nR1 !== nR2) {
    this.PushNoValue();
    return;
  } // if (nC1 != nC2 || nR1 != nR2)
  const pResMat = lcl_MatrixCalculation(pMat1, pMat2, this, (a, b) => approxSub(a, b) /* MatrixSub */);
  if (!pResMat) this.PushNoValue();
  else this.PushDouble(pResMat.SumSquare(false).mfRest);
};

ScInterpreter.Register(OC.ocGCD, ScInterpreter.prototype.ScGCD);
ScInterpreter.Register(OC.ocLCM, ScInterpreter.prototype.ScLCM);
ScInterpreter.Register(OC.ocSumX2MY2, ScInterpreter.prototype.ScSumX2MY2);
ScInterpreter.Register(OC.ocSumX2DY2, ScInterpreter.prototype.ScSumX2DY2);
ScInterpreter.Register(OC.ocSumXMY2, ScInterpreter.prototype.ScSumXMY2);

// @@ MATH (GCD, LCM, SUMX2MY2, SUMX2PY2, SUMXMY2) @@

// MUNIT, MDETERM, MINVERSE and FREQUENCY. ScMatrix::IsSizeAllocatable is reduced to the element
// limit of CreateMatrixFromDoubleRef (no SC_MAX_MATRIX_ELEMENTS, no memory pool); the OpenCL
// path of MINVERSE is left out.

declare module './interpr4.ts' {
  interface ScInterpreter {
    ScEMat(): void;
    MEMat(mM: ScMatrix, n: number): void;
    ScMatDet(): void;
    ScMatInv(): void;
    ScFrequency(): void;
  }
}

/** ScMatrix::IsSizeAllocatable (reduced: a fixed element limit). */
function lcl_IsSizeAllocatable(nC: number, nR: number): boolean {
  // 0-size matrix is valid, it could be resized later.
  if ((nC && !nR) || (!nC && nR)) return false;
  if (!nC || !nR) return true;
  return nC * nR <= 64 * 1024 * 1024;
}

ScInterpreter.prototype.ScEMat = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 1)) return;

  const nDim = this.GetUInt32();
  if (this.nGlobalError !== FormulaError.NONE || nDim === 0) this.PushIllegalArgument();
  else if (!lcl_IsSizeAllocatable(nDim, nDim)) this.PushError(FormulaError.MatrixSize);
  else {
    const pRMat = this.GetNewMat(nDim, nDim, /*bEmpty*/ true);
    this.MEMat(pRMat, nDim);
    this.PushMatrix(pRMat);
  }
};

ScInterpreter.prototype.MEMat = function (this: ScInterpreter, mM: ScMatrix, n: number): void {
  mM.FillDouble(0.0, 0, 0, n - 1, n - 1);
  for (let i = 0; i < n; i++) mM.PutDouble(1.0, i, i);
};

/* Matrix LUP decomposition according to the pseudocode of "Introduction to
 * Algorithms" by Cormen, Leiserson, Rivest, Stein.
 *
 * Added scaling for numeric stability.
 *
 * Given an n x n nonsingular matrix A, find a permutation matrix P, a unit
 * lower-triangular matrix L, and an upper-triangular matrix U such that PA=LU.
 * Compute L and U "in place" in the matrix A, the original content is
 * destroyed. Note that the diagonal elements of the U triangular matrix
 * replace the diagonal elements of the L-unit matrix (that are each ==1). The
 * permutation matrix P is an array, where P[i]=j means that the i-th row of P
 * contains a 1 in column j. Additionally keep track of the number of
 * permutations (row exchanges).
 *
 * Returns 0 if a singular matrix is encountered, else +1 if an even number of
 * permutations occurred, or -1 if odd, which is the sign of the determinant.
 * This may be used to calculate the determinant by multiplying the sign with
 * the product of the diagonal elements of the LU matrix.
 */
function lcl_LUP_decompose(mA: ScMatrix, n: number, P: number[]): number {
  let nSign = 1;
  // Find scale of each row.
  const aScale: number[] = new Array<number>(n);
  for (let i = 0; i < n; ++i) {
    let fMax = 0.0;
    for (let j = 0; j < n; ++j) {
      const fTmp = Math.abs(mA.GetDouble(j, i));
      if (fMax < fTmp) fMax = fTmp;
    }
    if (fMax === 0.0) return 0; // singular matrix
    aScale[i] = 1.0 / fMax;
  }
  // Represent identity permutation, P[i]=i
  for (let i = 0; i < n; ++i) P[i] = i;
  // "Recursion" on the diagonal.
  const l = n - 1;
  for (let k = 0; k < l; ++k) {
    // Implicit pivoting. With the scale found for a row, compare values of
    // a column and pick largest.
    let fMax = 0.0;
    const fScale = aScale[k]!;
    let kp = k;
    for (let i = k; i < n; ++i) {
      const fTmp = fScale * Math.abs(mA.GetDouble(k, i));
      if (fMax < fTmp) {
        fMax = fTmp;
        kp = i;
      }
    }
    if (fMax === 0.0) return 0; // singular matrix
    // Swap rows. The pivot element will be at mA[k,kp] (row,col notation)
    if (k !== kp) {
      // permutations
      const nTmp = P[k]!;
      P[k] = P[kp]!;
      P[kp] = nTmp;
      nSign = -nSign;
      // scales
      const fTmp = aScale[k]!;
      aScale[k] = aScale[kp]!;
      aScale[kp] = fTmp;
      // elements
      for (let i = 0; i < n; ++i) {
        const fMatTmp = mA.GetDouble(i, k);
        mA.PutDouble(mA.GetDouble(i, kp), i, k);
        mA.PutDouble(fMatTmp, i, kp);
      }
    }
    // Compute Schur complement.
    for (let i = k + 1; i < n; ++i) {
      const fNum = mA.GetDouble(k, i);
      const fDen = mA.GetDouble(k, k);
      mA.PutDouble(fNum / fDen, k, i);
      for (let j = k + 1; j < n; ++j) mA.PutDouble((mA.GetDouble(j, i) * fDen - fNum * mA.GetDouble(j, k)) / fDen, j, i);
    }
  }

  let bSingular = false;
  for (let i = 0; i < n && !bSingular; i++) bSingular = mA.GetDouble(i, i) === 0.0;
  if (bSingular) nSign = 0;

  return nSign;
}

/* Solve a LUP decomposed equation Ax=b. LU is a combined matrix of L and U
 * triangulars and P the permutation vector as obtained from
 * lcl_LUP_decompose(). B is the right-hand side input vector, X is used to
 * return the solution vector.
 */
function lcl_LUP_solve(mLU: ScMatrix, n: number, P: number[], B: number[], X: number[]): void {
  let nFirst = -1; // SCSIZE_MAX
  // Ax=b => PAx=Pb, with decomposition LUx=Pb.
  // Define y=Ux and solve for y in Ly=Pb using forward substitution.
  for (let i = 0; i < n; ++i) {
    const fSum = new KahanSum(B[P[i]!]!);
    // Matrix inversion comes with a lot of zeros in the B vectors, we
    // don't have to do all the computing with results multiplied by zero.
    // Until then, simply lookout for the position of the first nonzero
    // value.
    if (nFirst !== -1) {
      for (let j = nFirst; j < i; ++j) fSum.subtract(mLU.GetDouble(j, i) * X[j]!); // X[j] === y[j]
    } else if (fSum.get() !== 0) nFirst = i;
    X[i] = fSum.get(); // X[i] === y[i]
  }
  // Solve for x in Ux=y using back substitution.
  for (let i = n; i--; ) {
    const fSum = new KahanSum(X[i]!); // X[i] === y[i]
    for (let j = i + 1; j < n; ++j) fSum.subtract(mLU.GetDouble(j, i) * X[j]!); // X[j] === x[j]
    X[i] = fSum.get() / mLU.GetDouble(i, i); // X[i] === x[i]
  }
}

ScInterpreter.prototype.ScMatDet = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 1)) return;

  const pMat = this.GetMatrix();
  if (!pMat) {
    this.PushIllegalParameter();
    return;
  }
  if (!pMat.IsNumeric()) {
    this.PushNoValue();
    return;
  }
  const { nC, nR } = pMat.GetDimensions();
  if (nC !== nR || nC === 0) this.PushIllegalArgument();
  else if (!lcl_IsSizeAllocatable(nC, nR)) this.PushError(FormulaError.MatrixSize);
  else {
    // LUP decomposition is done inplace, use copy.
    const xLU = pMat.Clone();
    const P: number[] = new Array<number>(nR);
    const nDetSign = lcl_LUP_decompose(xLU, nR, P);
    if (!nDetSign) this.PushInt(0); // singular matrix
    else {
      // In an LU matrix the determinant is simply the product of
      // all diagonal elements.
      let fDet = nDetSign;
      for (let i = 0; i < nR; ++i) fDet *= xLU.GetDouble(i, i);
      this.PushDouble(fDet);
    }
  }
};

ScInterpreter.prototype.ScMatInv = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 1)) return;

  const pMat = this.GetMatrix();
  if (!pMat) {
    this.PushIllegalParameter();
    return;
  }
  if (!pMat.IsNumeric()) {
    this.PushNoValue();
    return;
  }
  const { nC, nR } = pMat.GetDimensions();

  if (nC !== nR || nC === 0) this.PushIllegalArgument();
  else if (!lcl_IsSizeAllocatable(nC, nR)) this.PushError(FormulaError.MatrixSize);
  else {
    // LUP decomposition is done inplace, use copy.
    const xLU = pMat.Clone();
    // The result matrix.
    const xY = this.GetNewMat(nR, nR, /*bEmpty*/ true);
    const P: number[] = new Array<number>(nR);
    const nDetSign = lcl_LUP_decompose(xLU, nR, P);
    if (!nDetSign) this.PushIllegalArgument();
    else {
      // Solve equation for each column.
      const B: number[] = new Array<number>(nR);
      const X: number[] = new Array<number>(nR);
      for (let j = 0; j < nR; ++j) {
        for (let i = 0; i < nR; ++i) B[i] = 0.0;
        B[j] = 1.0;
        lcl_LUP_solve(xLU, nR, P, B, X);
        for (let i = 0; i < nR; ++i) xY.PutDouble(X[i]!, j, i);
      }
      if (this.nGlobalError !== FormulaError.NONE) this.PushError(this.nGlobalError);
      else this.PushMatrix(xY);
    }
  }
};

/** ScInterpreter::GetSortArray of the statistics port (interpr3), reached without depending on
    its declaration: (nParamCount, rSortArray, pIndexOrder, bConvertTextInArray, bAllowEmptyArray). */
type GetSortArrayFunc = (this: ScInterpreter, nParamCount: number, rSortArray: number[], pIndexOrder: number[] | null, bConvertTextInArray: boolean, bAllowEmptyArray: boolean) => void;
function lcl_GetSortArray(self: ScInterpreter, rSortArray: number[], pIndexOrder: number[] | null): void {
  const f = (self as unknown as { GetSortArray?: GetSortArrayFunc }).GetSortArray;
  if (f) f.call(self, 1, rSortArray, pIndexOrder, false, false);
  else {
    self.PopError();
    self.SetError(FormulaError.UnknownOpCode);
  }
}

ScInterpreter.prototype.ScFrequency = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 2)) return;

  const aBinArray: number[] = [];
  const aBinIndexOrder: number[] = [];

  lcl_GetSortArray(this, aBinArray, aBinIndexOrder);
  const nBinSize = aBinArray.length;
  if (this.nGlobalError !== FormulaError.NONE) {
    this.PushNoValue();
    return;
  }

  const aDataArray: number[] = [];
  lcl_GetSortArray(this, aDataArray, null);
  const nDataSize = aDataArray.length;

  if (aDataArray.length === 0 || this.nGlobalError !== FormulaError.NONE) {
    this.PushNoValue();
    return;
  }
  const pResMat = this.GetNewMat(1, nBinSize + 1, /*bEmpty*/ true);

  if (nBinSize !== aBinIndexOrder.length) {
    this.PushIllegalArgument();
    return;
  }

  let j: number;
  let i = 0;
  for (j = 0; j < nBinSize; ++j) {
    let nCount = 0;
    while (i < nDataSize && aDataArray[i]! <= aBinArray[j]!) {
      ++nCount;
      ++i;
    }
    pResMat.PutDouble(nCount, aBinIndexOrder[j]!);
  }
  pResMat.PutDouble(nDataSize - i, j);
  this.PushMatrix(pResMat);
};

ScInterpreter.Register(OC.ocFrequency, ScInterpreter.prototype.ScFrequency);
ScInterpreter.Register(OC.ocMatrixUnit, ScInterpreter.prototype.ScEMat);
ScInterpreter.Register(OC.ocMatDet, ScInterpreter.prototype.ScMatDet);
ScInterpreter.Register(OC.ocMatInv, ScInterpreter.prototype.ScMatInv);

// @@ MATRIX (MINVERSE, MDETERM, MUNIT, FREQUENCY) @@

ScInterpreter.Register(OC.ocAdd, ScInterpreter.prototype.ScAdd);
ScInterpreter.Register(OC.ocSub, ScInterpreter.prototype.ScSub);
ScInterpreter.Register(OC.ocMul, ScInterpreter.prototype.ScMul);
ScInterpreter.Register(OC.ocDiv, ScInterpreter.prototype.ScDiv);
ScInterpreter.Register(OC.ocPow, ScInterpreter.prototype.ScPow);
ScInterpreter.Register(OC.ocPower, ScInterpreter.prototype.ScPower);
ScInterpreter.Register(OC.ocAmpersand, ScInterpreter.prototype.ScAmpersand);
ScInterpreter.Register(OC.ocNegSub, ScInterpreter.prototype.ScNeg);
ScInterpreter.Register(OC.ocNeg, ScInterpreter.prototype.ScNeg);
ScInterpreter.Register(OC.ocPercentSign, ScInterpreter.prototype.ScPercentSign);
ScInterpreter.Register(OC.ocEqual, ScInterpreter.prototype.ScEqual);
ScInterpreter.Register(OC.ocNotEqual, ScInterpreter.prototype.ScNotEqual);
ScInterpreter.Register(OC.ocLess, ScInterpreter.prototype.ScLess);
ScInterpreter.Register(OC.ocGreater, ScInterpreter.prototype.ScGreater);
ScInterpreter.Register(OC.ocLessEqual, ScInterpreter.prototype.ScLessEqual);
ScInterpreter.Register(OC.ocGreaterEqual, ScInterpreter.prototype.ScGreaterEqual);
ScInterpreter.Register(OC.ocSumProduct, ScInterpreter.prototype.ScSumProduct);
ScInterpreter.Register(OC.ocMatMult, ScInterpreter.prototype.ScMatMult);
ScInterpreter.Register(OC.ocMatTrans, ScInterpreter.prototype.ScMatTrans);
ScInterpreter.Register(OC.ocMatRef, ScInterpreter.prototype.ScMatRef);
