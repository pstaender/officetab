// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/scmatrix.hxx reduced
// @upstream sc/source/core/tool/scmatrix.cxx reduced
// @upstream sc/inc/types.hxx partial
// ScMatrix, reduced: a dense column-major matrix of doubles (a Float64Array, so NaN-coded errors
// keep their payload), element types and strings, instead of the mdds multi_type_matrix. Kept:
// the element accessors, replication of single rows/columns (ValidColRowOrReplicated), the
// comparison and arithmetic helpers and the Sum/Product/Count/Min/Max iterations. Left out: the
// threaded ExecuteOperation callbacks, MatConcat with an interpreter context, CollectKahan,
// the immutable flag's enforcement and the matrix size limit of the configuration.
import { CreateDoubleError, FormulaError, GetDoubleErrorValue } from '../../../../include/formula/errorcodes.ts';
import { KahanSum } from './kahan.ts';
import type { ScJumpMatrix } from './jumpmatrix.ts';
import { approxFloor } from '../../../../sal/rtl/math.ts';

export const ScMatValType = {
  Value: 0x00,
  Boolean: 0x01,
  String: 0x02,
  Empty: 0x02 | 0x04, // STRING plus flag
  EmptyPath: 0x02 | 0x04 | 0x08, // EMPTY plus flag
  NonvalueMask: 0x02 | 0x04 | 0x08, // mask of all non-value bits
} as const;
export type ScMatValType = number;

export class ScMatrixValue {
  fVal = 0.0;
  aStr = '';
  nType: ScMatValType = ScMatValType.Empty;

  /// Only valid if ScMatrix methods indicate so!
  GetString(): string { return this.aStr; }
  /// Only valid if ScMatrix methods indicate that this is no string!
  GetError(): FormulaError { return GetDoubleErrorValue(this.fVal); }
  /// Only valid if ScMatrix methods indicate that this is a boolean
  GetBoolean(): boolean { return this.fVal !== 0.0; }
}

/** The result of an iteration: the result and the count of the values used. */
export interface IterateResult { mfFirst: number; mfRest: number; mnCount: number }

/** ScInterpreter::ScGetGCD (a static member upstream; here a copy, so the matrix does not import
    the interpreter). */
function ScGetGCD(fx: number, fy: number): number {
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
}

export class ScMatrix {
  private nC: number;
  private nR: number;
  private maValues: Float64Array;
  private maTypes: Uint8Array;
  private maStrings: (string | undefined)[] | null = null;
  private mbImmutable = false;
  private pErrorInterpreter: { SetError(e: FormulaError): void } | null = null;

  /** ScMatrix(nC, nR) creates an empty matrix, ScMatrix(nC, nR, fInitVal) one filled with a value. */
  constructor(nC: number, nR: number, fInitVal?: number) {
    this.nC = nC;
    this.nR = nR;
    this.maValues = new Float64Array(nC * nR);
    this.maTypes = new Uint8Array(nC * nR);
    if (fInitVal === undefined) this.maTypes.fill(ScMatValType.Empty);
    else if (fInitVal !== 0) this.maValues.fill(fInitVal);
  }

  /** Value or boolean. */
  static IsValueType(nType: ScMatValType): boolean { return nType <= ScMatValType.Boolean; }
  /// Boolean.
  static IsBooleanType(nType: ScMatValType): boolean { return nType === ScMatValType.Boolean; }
  /// String, empty or empty path, but not value nor boolean.
  static IsNonValueType(nType: ScMatValType): boolean { return (nType & ScMatValType.NonvalueMask) !== 0; }
  /** String, but not empty or empty path or any other type. */
  static IsRealStringType(nType: ScMatValType): boolean { return (nType & ScMatValType.NonvalueMask) === ScMatValType.String; }
  /// Empty, but not empty path or any other type.
  static IsEmptyType(nType: ScMatValType): boolean { return (nType & ScMatValType.NonvalueMask) === ScMatValType.Empty; }
  /// Empty path, but not empty or any other type.
  static IsEmptyPathType(nType: ScMatValType): boolean { return (nType & ScMatValType.NonvalueMask) === ScMatValType.EmptyPath; }

  Clone(): ScMatrix {
    const m = new ScMatrix(this.nC, this.nR);
    m.maValues.set(this.maValues);
    m.maTypes.set(this.maTypes);
    m.maStrings = this.maStrings ? [...this.maStrings] : null;
    return m;
  }

  /** Clone the matrix if it is immutable (a cached result), else return it. */
  CloneIfConst(): ScMatrix { return this.mbImmutable ? this.Clone() : this; }
  SetImmutable(): void { this.mbImmutable = true; }
  IsImmutable(): boolean { return this.mbImmutable; }

  /** Resize the matrix to specified new dimension; new elements are empty. */
  Resize(nC: number, nR: number, fVal?: number): void {
    const m = new ScMatrix(nC, nR, fVal);
    for (let c = 0; c < Math.min(nC, this.nC); c++)
      for (let r = 0; r < Math.min(nR, this.nR); r++) {
        const i = c * this.nR + r, j = c * nR + r;
        m.maValues[j] = this.maValues[i]!;
        m.maTypes[j] = this.maTypes[i]!;
        if (this.maStrings?.[i] !== undefined) (m.maStrings ??= [])[j] = this.maStrings[i];
      }
    this.nC = nC; this.nR = nR; this.maValues = m.maValues; this.maTypes = m.maTypes; this.maStrings = m.maStrings;
  }

  CloneAndExtend(nNewCols: number, nNewRows: number): ScMatrix {
    const m = this.Clone();
    m.Resize(nNewCols, nNewRows);
    return m;
  }

  SetErrorInterpreter(p: { SetError(e: FormulaError): void } | null): void { this.pErrorInterpreter = p; }

  GetDimensions(): { nC: number; nR: number } { return { nC: this.nC, nR: this.nR }; }
  GetColCount(): number { return this.nC; }
  GetRowCount(): number { return this.nR; }
  GetElementCount(): number { return this.nC * this.nR; }
  ValidColRow(nC: number, nR: number): boolean { return nC < this.nC && nR < this.nR && nC >= 0 && nR >= 0; }

  /** For a row vector or column vector, if the position does not point into
      the vector but is a valid column or row offset it is adapted such that
      it points to an element to be replicated, same column row 0 for a row
      vector, same row column 0 for a column vector. Else, for a 2D matrix,
      returns false. Returns the adapted position or null. */
  ValidColRowReplicated(nC: number, nR: number): { nC: number; nR: number } | null {
    if (this.nC === 1 && this.nR === 1) return { nC: 0, nR: 0 };
    else if (this.nC === 1 && nR < this.nR) return { nC: 0, nR };
    else if (this.nR === 1 && nC < this.nC) return { nC, nR: 0 };
    return null;
  }

  /** Checks if the matrix position is within the matrix. If it is not, for a
      row vector or column vector the position is adapted such that it points
      to an element to be replicated, same column row 0 for a row vector,
      same row column 0 for a column vector. Else, for a 2D matrix and
      position not within matrix, returns null. */
  ValidColRowOrReplicated(nC: number, nR: number): { nC: number; nR: number } | null {
    return this.ValidColRow(nC, nR) ? { nC, nR } : this.ValidColRowReplicated(nC, nR);
  }

  private idx(nC: number, nR: number): number { return nC * this.nR + nR; }

  PutDouble(fVal: number, nC: number, nR?: number): void {
    if (nR === undefined) { const i = nC; this.maValues[i] = fVal; this.maTypes[i] = ScMatValType.Value; return; }
    if (!this.ValidColRow(nC, nR)) return;
    const i = this.idx(nC, nR);
    this.maValues[i] = fVal;
    this.maTypes[i] = ScMatValType.Value;
    if (this.maStrings) this.maStrings[i] = undefined;
  }

  PutString(rStr: string, nC: number, nR?: number): void {
    const i = nR === undefined ? nC : this.ValidColRow(nC, nR) ? this.idx(nC, nR) : -1;
    if (i < 0) return;
    this.maValues[i] = 0;
    this.maTypes[i] = ScMatValType.String;
    (this.maStrings ??= [])[i] = rStr;
  }

  PutEmpty(nC: number, nR?: number): void {
    const i = nR === undefined ? nC : this.ValidColRow(nC, nR) ? this.idx(nC, nR) : -1;
    if (i < 0) return;
    this.maValues[i] = 0;
    this.maTypes[i] = ScMatValType.Empty;
    if (this.maStrings) this.maStrings[i] = undefined;
  }

  PutEmptyPath(nC: number, nR: number): void {
    if (!this.ValidColRow(nC, nR)) return;
    const i = this.idx(nC, nR);
    this.maValues[i] = 0;
    this.maTypes[i] = ScMatValType.EmptyPath;
  }

  PutError(nErrorCode: FormulaError, nC: number, nR: number): void {
    this.PutDouble(CreateDoubleError(nErrorCode), nC, nR);
  }

  PutBoolean(bVal: boolean, nC: number, nR: number): void {
    if (!this.ValidColRow(nC, nR)) return;
    const i = this.idx(nC, nR);
    this.maValues[i] = bVal ? 1.0 : 0.0;
    this.maTypes[i] = ScMatValType.Boolean;
  }

  FillDouble(fVal: number, nC1: number, nR1: number, nC2: number, nR2: number): void {
    for (let c = nC1; c <= nC2; c++) for (let r = nR1; r <= nR2; r++) this.PutDouble(fVal, c, r);
  }

  /** May be used before obtaining the double value of an element to avoid
      passing its NAN around.
      @ATTENTION: MUST NOT be used if the element is a string!
                  Use GetErrorIfNotString() instead if not sure.
      @returns 0 if no error, else one of err... constants */
  GetError(nC: number, nR: number): FormulaError {
    const p = this.ValidColRowOrReplicated(nC, nR);
    if (!p) return FormulaError.NoValue;
    return GetDoubleErrorValue(this.maValues[this.idx(p.nC, p.nR)]!);
  }

  /** Use in ScInterpreter to obtain the error code, if any.
      @returns 0 if no error or string element, else one of err... constants */
  GetErrorIfNotString(nC: number, nR: number): FormulaError {
    return this.IsValue(nC, nR) ? this.GetError(nC, nR) : FormulaError.NONE;
  }

  /** @return 0.0 if empty or empty path, else value or string as 0.0 */
  GetDouble(nC: number, nR?: number): number {
    if (nR === undefined) {
      // by index, column-major
      return this.maValues[nC] ?? CreateDoubleError(FormulaError.NoValue);
    }
    const p = this.ValidColRowOrReplicated(nC, nR);
    if (!p) return CreateDoubleError(FormulaError.NoValue);
    const fVal = this.maValues[this.idx(p.nC, p.nR)]!;
    if (this.pErrorInterpreter) {
      const nError = GetDoubleErrorValue(fVal);
      if (nError !== FormulaError.NONE) this.pErrorInterpreter.SetError(nError);
    }
    return fVal;
  }

  /** @return string or empty string for empty, empty path or value elements. */
  GetString(nC: number, nR?: number): string {
    if (nR === undefined) {
      const t = this.maTypes[nC]!;
      return ScMatrix.IsRealStringType(t) ? this.maStrings![nC]! : '';
    }
    const p = this.ValidColRowOrReplicated(nC, nR);
    if (!p) return '';
    const i = this.idx(p.nC, p.nR);
    const t = this.maTypes[i]!;
    if (ScMatrix.IsRealStringType(t)) return this.maStrings![i]!;
    if (t === ScMatValType.EmptyPath) return '';
    return '';
  }

  /** @returns the type and value of the element */
  Get(nC: number, nR: number): ScMatrixValue {
    const aVal = new ScMatrixValue();
    const p = this.ValidColRowOrReplicated(nC, nR);
    if (!p) { aVal.fVal = CreateDoubleError(FormulaError.NoValue); aVal.nType = ScMatValType.Value; return aVal; }
    const i = this.idx(p.nC, p.nR);
    aVal.nType = this.maTypes[i]!;
    aVal.fVal = this.maValues[i]!;
    if (ScMatrix.IsRealStringType(aVal.nType)) aVal.aStr = this.maStrings![i]!;
    return aVal;
  }

  /** The element type at a position (Value for positions outside). */
  GetType(nC: number, nR: number): ScMatValType {
    const p = this.ValidColRowOrReplicated(nC, nR);
    if (!p) return ScMatValType.Value;
    return this.maTypes[this.idx(p.nC, p.nR)]!;
  }

  /** @return <TRUE/> if string or empty or empty path, in fact non-value. */
  IsStringOrEmpty(nC: number, nR?: number): boolean {
    if (nR === undefined) return ScMatrix.IsNonValueType(this.maTypes[nC]!);
    return ScMatrix.IsNonValueType(this.GetType(nC, nR));
  }

  /** @return <TRUE/> if empty or empty cell or empty result, not empty path. */
  IsEmpty(nC: number, nR: number): boolean { return ScMatrix.IsEmptyType(this.GetType(nC, nR)); }
  /** @return <TRUE/> if empty cell, not empty or empty result or empty path. */
  IsEmptyCell(nC: number, nR: number): boolean { return ScMatrix.IsEmptyType(this.GetType(nC, nR)); }
  /** @return <TRUE/> if empty path. */
  IsEmptyPath(nC: number, nR: number): boolean { return ScMatrix.IsEmptyPathType(this.GetType(nC, nR)); }
  /** @return <TRUE/> if value or boolean. */
  IsValue(nC: number, nR?: number): boolean {
    if (nR === undefined) return ScMatrix.IsValueType(this.maTypes[nC]!);
    return ScMatrix.IsValueType(this.GetType(nC, nR));
  }
  /** @return <TRUE/> if value or boolean or empty or empty path. */
  IsValueOrEmpty(nC: number, nR: number): boolean {
    const t = this.GetType(nC, nR);
    return ScMatrix.IsValueType(t) || ScMatrix.IsEmptyType(t) || ScMatrix.IsEmptyPathType(t);
  }
  /** @return <TRUE/> if boolean. */
  IsBoolean(nC: number, nR: number): boolean { return this.GetType(nC, nR) === ScMatValType.Boolean; }

  /** @return <TRUE/> if entire matrix is numeric, including booleans, with no strings or empties */
  IsNumeric(): boolean {
    for (let i = 0; i < this.maTypes.length; i++) if (!ScMatrix.IsValueType(this.maTypes[i]!)) return false;
    return true;
  }

  /** Set the jumps of an IF over this matrix of conditions (ScMatrixImpl::IfJump). */
  IfJump(rJumpMatrix: ScJumpMatrix, pJump: number[], nJumpCount: number): void {
    for (let nC = 0; nC < this.nC; ++nC) {
      for (let nR = 0; nR < this.nR; ++nR) {
        let bIsValue: boolean;
        let bTrue: boolean;
        let fVal: number;
        const eType = this.maTypes[this.idx(nC, nR)]!;
        if (ScMatrix.IsValueType(eType)) {
          fVal = this.maValues[this.idx(nC, nR)]!;
          bIsValue = Number.isFinite(fVal);
          bTrue = bIsValue && fVal !== 0.0;
          if (bTrue) fVal = 1.0;
        } else if (ScMatrix.IsRealStringType(eType)) {
          // Treat empty and empty path as 0, but string
          // as error. ScMatrix::IsValueOrEmpty() returns
          // true for any empty, empty path, empty cell,
          // empty result.
          bIsValue = false;
          bTrue = false;
          fVal = CreateDoubleError(FormulaError.NoValue);
        } else {
          bIsValue = true;
          bTrue = false;
          fVal = 0.0;
        }
        if (bTrue) {
          // TRUE
          if (nJumpCount >= 2) {
            // THEN path
            rJumpMatrix.SetJump(nC, nR, fVal, pJump[1]!, pJump[nJumpCount]!);
          } else {
            // no parameter given for THEN
            rJumpMatrix.SetJump(nC, nR, fVal, pJump[nJumpCount]!, pJump[nJumpCount]!);
          }
        } else {
          // FALSE
          if (nJumpCount === 3 && bIsValue) {
            // ELSE path
            rJumpMatrix.SetJump(nC, nR, fVal, pJump[2]!, pJump[nJumpCount]!);
          } else {
            // no parameter given for ELSE,
            // or DoubleError
            rJumpMatrix.SetJump(nC, nR, fVal, pJump[nJumpCount]!, pJump[nJumpCount]!);
          }
        }
      }
    }
  }

  MatTrans(mRes: ScMatrix): void {
    for (let c = 0; c < this.nC; c++)
      for (let r = 0; r < this.nR; r++) mRes.copyElement(this, c, r, r, c);
  }

  MatCopy(mRes: ScMatrix): void {
    for (let c = 0; c < Math.min(this.nC, mRes.nC); c++)
      for (let r = 0; r < Math.min(this.nR, mRes.nR); r++) mRes.copyElement(this, c, r, c, r);
  }

  /** Copies one element of rSrc into this matrix. */
  copyElement(rSrc: ScMatrix, nSC: number, nSR: number, nC: number, nR: number): void {
    if (!this.ValidColRow(nC, nR)) return;
    const i = rSrc.idx(nSC, nSR), j = this.idx(nC, nR);
    this.maValues[j] = rSrc.maValues[i]!;
    this.maTypes[j] = rSrc.maTypes[i]!;
    if (rSrc.maStrings?.[i] !== undefined) (this.maStrings ??= [])[j] = rSrc.maStrings[i];
  }

  private compare(f: (v: number) => boolean): void {
    for (let i = 0; i < this.maValues.length; i++) {
      const t = this.maTypes[i]!;
      if (ScMatrix.IsValueType(t)) {
        const v = this.maValues[i]!;
        if (Number.isFinite(v)) { this.maValues[i] = f(v) ? 1.0 : 0.0; this.maTypes[i] = ScMatValType.Value; }
      }
    }
  }
  CompareEqual(): void { this.compare((v) => v === 0.0); }
  CompareNotEqual(): void { this.compare((v) => v !== 0.0); }
  CompareLess(): void { this.compare((v) => v < 0.0); }
  CompareGreater(): void { this.compare((v) => v > 0.0); }
  CompareLessEqual(): void { this.compare((v) => v <= 0.0); }
  CompareGreaterEqual(): void { this.compare((v) => v >= 0.0); }

  private eval(op: (a: boolean, b: boolean) => boolean, init: boolean): number {
    let bResult = init, bFirst = true;
    for (let i = 0; i < this.maValues.length; i++) {
      const t = this.maTypes[i]!;
      if (!ScMatrix.IsValueType(t)) continue;
      const v = this.maValues[i]!;
      if (!Number.isFinite(v)) return v;
      const b = v !== 0.0;
      bResult = bFirst ? b : op(bResult, b);
      bFirst = false;
    }
    return bResult ? 1.0 : 0.0;
  }
  And(): number { return this.eval((a, b) => a && b, true); } // logical AND of all matrix values, or NAN
  Or(): number { return this.eval((a, b) => a || b, false); } // logical OR of all matrix values, or NAN
  Xor(): number { return this.eval((a, b) => a !== b, false); } // logical XOR of all matrix values, or NAN

  /** Sum of the values; strings count as 0 with bTextAsZero (not otherwise counted). */
  Sum(bTextAsZero: boolean, bIgnoreErrorValues = false): IterateResult {
    const k = new KahanSum();
    let nCount = 0;
    let fFirst = 0;
    for (let i = 0; i < this.maValues.length; i++) {
      const t = this.maTypes[i]!;
      if (ScMatrix.IsValueType(t)) {
        const v = this.maValues[i]!;
        if (bIgnoreErrorValues && !Number.isFinite(v)) continue;
        if (nCount === 0) fFirst = v; else k.add(v);
        nCount++;
      } else if (bTextAsZero && ScMatrix.IsRealStringType(t)) {
        if (nCount === 0) fFirst = 0;
        nCount++;
      }
    }
    return { mfFirst: fFirst, mfRest: k.get(), mnCount: nCount };
  }

  SumSquare(bTextAsZero: boolean, bIgnoreErrorValues = false): IterateResult {
    const k = new KahanSum();
    let nCount = 0;
    for (let i = 0; i < this.maValues.length; i++) {
      const t = this.maTypes[i]!;
      if (ScMatrix.IsValueType(t)) {
        const v = this.maValues[i]!;
        if (bIgnoreErrorValues && !Number.isFinite(v)) continue;
        k.add(v * v);
        nCount++;
      } else if (bTextAsZero && ScMatrix.IsRealStringType(t)) nCount++;
    }
    return { mfFirst: 0, mfRest: k.get(), mnCount: nCount };
  }

  Product(bTextAsZero: boolean, bIgnoreErrorValues = false): IterateResult {
    let fProd = 1.0;
    let nCount = 0;
    for (let i = 0; i < this.maValues.length; i++) {
      const t = this.maTypes[i]!;
      if (ScMatrix.IsValueType(t)) {
        const v = this.maValues[i]!;
        if (bIgnoreErrorValues && !Number.isFinite(v)) continue;
        fProd *= v;
        nCount++;
      } else if (bTextAsZero && ScMatrix.IsRealStringType(t)) {
        fProd = 0;
        nCount++;
      }
    }
    return { mfFirst: fProd, mfRest: 1.0, mnCount: nCount };
  }

  Count(bCountStrings: boolean, bCountErrors: boolean, bIgnoreEmptyStrings = false): number {
    let n = 0;
    for (let i = 0; i < this.maValues.length; i++) {
      const t = this.maTypes[i]!;
      if (ScMatrix.IsValueType(t)) {
        if (bCountErrors || Number.isFinite(this.maValues[i]!)) n++;
      } else if (bCountStrings && ScMatrix.IsRealStringType(t)) {
        if (!bIgnoreEmptyStrings || this.maStrings![i] !== '') n++;
      }
    }
    return n;
  }

  GetMaxValue(bTextAsZero: boolean, bIgnoreErrorValues = false): number {
    let f = -Infinity, bFound = false;
    for (let i = 0; i < this.maValues.length; i++) {
      const t = this.maTypes[i]!;
      if (ScMatrix.IsValueType(t)) {
        const v = this.maValues[i]!;
        if (bIgnoreErrorValues && !Number.isFinite(v)) continue;
        if (Number.isNaN(v)) return v;
        if (v > f) f = v;
        bFound = true;
      } else if (bTextAsZero && ScMatrix.IsRealStringType(t)) { if (0 > f) f = 0; bFound = true; }
    }
    return bFound ? f : 0.0;
  }

  GetMinValue(bTextAsZero: boolean, bIgnoreErrorValues = false): number {
    let f = Infinity, bFound = false;
    for (let i = 0; i < this.maValues.length; i++) {
      const t = this.maTypes[i]!;
      if (ScMatrix.IsValueType(t)) {
        const v = this.maValues[i]!;
        if (bIgnoreErrorValues && !Number.isFinite(v)) continue;
        if (Number.isNaN(v)) return v;
        if (v < f) f = v;
        bFound = true;
      } else if (bTextAsZero && ScMatrix.IsRealStringType(t)) { if (0 < f) f = 0; bFound = true; }
    }
    return bFound ? f : 0.0;
  }

  /** The numeric values in column-major order; non-values become NaN-coded ElementNaN or
      are skipped (bEmptyAsZero false skips empties too: upstream returns them as NaN). */
  GetDoubleArray(bEmptyAsZero = true): number[] {
    const a: number[] = [];
    for (let i = 0; i < this.maValues.length; i++) {
      const t = this.maTypes[i]!;
      if (ScMatrix.IsValueType(t)) a.push(this.maValues[i]!);
      else if (ScMatrix.IsEmptyType(t) && bEmptyAsZero) a.push(0.0);
      else a.push(CreateDoubleError(FormulaError.ElementNaN));
    }
    return a;
  }

  /** Applies a unary operation to all value elements; strings become NoValue errors. */
  ApplyUnary(rMat: ScMatrix, op: (v: number) => number): void {
    for (let i = 0; i < rMat.maValues.length && i < this.maValues.length; i++) {
      const t = rMat.maTypes[i]!;
      if (ScMatrix.IsValueType(t)) { this.maValues[i] = op(rMat.maValues[i]!); this.maTypes[i] = ScMatValType.Value; }
      else if (ScMatrix.IsEmptyType(t) || ScMatrix.IsEmptyPathType(t)) { this.maValues[i] = op(0.0); this.maTypes[i] = ScMatValType.Value; }
      else { this.maValues[i] = CreateDoubleError(FormulaError.NoValue); this.maTypes[i] = ScMatValType.Value; }
    }
  }

  NotOp(rMat: ScMatrix): void { this.ApplyUnary(rMat, (v) => (Number.isFinite(v) ? (v === 0.0 ? 1.0 : 0.0) : v)); }
  NegOp(rMat: ScMatrix): void { this.ApplyUnary(rMat, (v) => -v); }

  /** CalcGcdLcm<Op>: walks the element blocks (a run of booleans is one block) in column-major
      order. */
  private CalcGcdLcm(fInit: number, calculate: (fx: number, fy: number) => number, boolValue: (aBools: boolean[]) => number): number {
    let mfval = fInit;
    const n = this.maValues.length;
    for (let i = 0; i < n; ) {
      const t = this.maTypes[i]!;
      if (t === ScMatValType.Boolean) {
        const aBools: boolean[] = [];
        while (i < n && this.maTypes[i] === ScMatValType.Boolean) aBools.push(this.maValues[i++] !== 0.0);
        mfval = boolValue(aBools);
        continue;
      }
      if (ScMatrix.IsValueType(t)) {
        const v = this.maValues[i]!;
        if (v < 0.0) mfval = CreateDoubleError(FormulaError.IllegalArgument);
        else if (!Number.isNaN(mfval)) mfval = approxFloor(calculate(v, mfval));
        // else: keep the coded error (C++ keeps a NaN's payload through the calculation)
      } else mfval = CreateDoubleError(FormulaError.IllegalArgument); // empty or string
      i++;
    }
    return mfval;
  }

  GetGcd(): number {
    // If the array has at least one true value, the gcdResult is 1.
    return this.CalcGcdLcm(0.0, (fx, fy) => ScGetGCD(fx, fy), (a) => (a.includes(true) ? 1.0 : 0.0));
  }

  GetLcm(): number {
    // If the array has at least one false value, the minimum value is 0.
    return this.CalcGcdLcm(1.0, (fx, fy) => (fx * fy) / ScGetGCD(fx, fy), (a) => (a.includes(false) ? 0.0 : 1.0));
  }

  /** Iterates over all elements in column-major order. */
  forEach(f: (nC: number, nR: number, v: ScMatrixValue) => void): void {
    for (let c = 0; c < this.nC; c++) for (let r = 0; r < this.nR; r++) f(c, r, this.Get(c, r));
  }
}
