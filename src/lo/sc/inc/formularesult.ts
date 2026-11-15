// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/formularesult.hxx reduced
// @upstream sc/source/core/tool/formularesult.cxx reduced
// ScFormulaResult: the result of a formula cell, a token (double, string, error, empty cell or
// matrix) with the error code. The hybrid (import) results are a double and/or string with a
// pending formula string.
import { FormulaError } from '../../include/formula/errorcodes.ts';
import { FormulaDoubleToken, FormulaErrorToken, FormulaStringToken, svDouble, svEmptyCell, svError, svHybridCell, svMatrix, svMatrixCell, svString, svUnknown, type FormulaToken, type StackVar } from '../../formula/source/core/api/token.ts';
import type { ScMatrix } from '../source/core/tool/scmatrix.ts';
import { ScEmptyCellToken, ScMatrixCellResultToken } from '../source/core/tool/token.ts';

/** The value of a result (sc::FormulaResultValue). */
export interface FormulaResultValue { meType: 'Invalid' | 'Value' | 'String' | 'Error'; mfValue: number; maString: string; mnError: FormulaError }

export class ScFormulaResult {
  private mpToken: FormulaToken | null = null;
  private mfValue = 0.0;
  private mbToken = false;
  private mbEmpty = false;
  private mbEmptyDisplayedAsString = false;
  private mnError: FormulaError = FormulaError.NONE;
  /** A string result kept with a double (hybrid result of an import). */
  private maHybridString: string | null = null;
  private maHybridFormula = '';

  clone(): ScFormulaResult {
    const r = new ScFormulaResult();
    r.mpToken = this.mpToken; r.mfValue = this.mfValue; r.mbToken = this.mbToken; r.mbEmpty = this.mbEmpty;
    r.mbEmptyDisplayedAsString = this.mbEmptyDisplayedAsString; r.mnError = this.mnError; r.maHybridString = this.maHybridString;
    r.maHybridFormula = this.maHybridFormula;
    return r;
  }

  /** Assign a result token (from the interpreter). */
  SetToken(p: FormulaToken | null): void {
    this.mbEmpty = false;
    this.mbEmptyDisplayedAsString = false;
    this.maHybridString = null;
    if (!p) {
      this.mpToken = null;
      this.mbToken = false;
      return;
    }
    switch (p.GetType()) {
      case svError:
        this.mnError = p.GetError();
        this.mpToken = null;
        this.mbToken = false;
        // set in case mnError is 0 now, which shouldn't happen but ...
        this.mfValue = 0.0;
        break;
      case svEmptyCell:
        this.mbEmpty = true;
        this.mbEmptyDisplayedAsString = (p as ScEmptyCellToken).IsDisplayedAsString();
        this.mpToken = null;
        this.mbToken = false;
        this.mfValue = 0.0;
        this.mnError = FormulaError.NONE;
        break;
      case svDouble:
        this.mfValue = p.GetDouble();
        this.mpToken = null;
        this.mbToken = false;
        this.mnError = FormulaError.NONE;
        break;
      case svMatrix:
        // A matrix from the interpreter becomes the matrix cell result with its upper left
        // element (ScMatrixFormulaCellToken::Assign).
        this.mpToken = p instanceof ScMatrixCellResultToken ? p : new ScMatrixCellResultToken(p.GetMatrix() as ScMatrix | null, UpperLeftToken(p.GetMatrix() as ScMatrix | null));
        this.mbToken = true;
        this.mnError = FormulaError.NONE;
        break;
      default:
        this.mpToken = p;
        this.mbToken = true;
        this.mnError = FormulaError.NONE;
    }
  }

  SetDouble(f: number): void {
    this.mpToken = null;
    this.mbToken = false;
    this.mfValue = f;
    this.mbEmpty = false;
    this.mnError = FormulaError.NONE;
    this.maHybridString = null;
  }

  /** Hybrid result of an import: a double and/or a string to show until recalculated. */
  SetHybridDouble(f: number): void { this.SetDouble(f); }
  SetHybridString(r: string): void {
    this.mpToken = null;
    this.mbToken = false;
    this.maHybridString = r;
    this.mnError = FormulaError.NONE;
    this.mbEmpty = false;
  }
  SetHybridFormula(r: string): void { this.maHybridFormula = r; }
  GetHybridFormula(): string { return this.maHybridFormula; }

  SetResultError(n: FormulaError): void { this.mnError = n; }
  GetResultError(): FormulaError {
    if (this.mnError !== FormulaError.NONE) return this.mnError;
    const sv = this.GetCellResultType();
    if (sv === svError) {
      if (this.GetType() === svMatrixCell)
        // don't need to test for mpToken here, GetType() already did it
        return (this.mpToken as ScMatrixCellResultToken).GetUpperLeftToken()!.GetError();
      if (this.mpToken) return this.mpToken.GetError();
    }
    return FormulaError.NONE;
  }

  /** The type of the result (svDouble, svString, svError, svMatrixCell, svEmptyCell, svUnknown). */
  GetType(): StackVar {
    if (this.mnError !== FormulaError.NONE) return svError;
    if (this.mbEmpty) return svEmptyCell;
    if (this.maHybridString !== null) return svHybridCell;
    if (!this.mbToken) return svDouble;
    if (this.mpToken) {
      const t = this.mpToken.GetType();
      if (t === svMatrix) return svMatrixCell;
      return t;
    }
    return svUnknown;
  }

  /** The type of the cell result: the upper left element's type of a matrix result. */
  GetCellResultType(): StackVar {
    let sv = this.GetType();
    if (sv === svMatrixCell)
      // don't need to test for mpToken here, GetType() already did it
      sv = (this.mpToken as ScMatrixCellResultToken).GetUpperLeftType();
    return sv;
  }

  /** Whether the result is a value (also an error, a boolean or an empty result). */
  IsValue(): boolean {
    if (this.mnError !== FormulaError.NONE) return true;
    if (this.mbEmpty) return !this.mbEmptyDisplayedAsString;
    if (this.maHybridString !== null) return false;
    if (!this.mbToken) return true;
    if (this.mpToken instanceof ScMatrixCellResultToken) {
      const ul = this.mpToken.GetUpperLeftType();
      return ul === svDouble || ul === svError || ul === svEmptyCell || ul === svUnknown;
    }
    return false;
  }

  IsValueNoError(): boolean { return this.mnError === FormulaError.NONE && this.IsValue(); }
  IsEmptyDisplayedAsString(): boolean { return this.mbEmpty && this.mbEmptyDisplayedAsString; }
  IsEmpty(): boolean { return this.mbEmpty; }

  GetDouble(): number {
    if (this.mbEmpty) return 0.0;
    if (this.mbToken && this.mpToken) {
      if (this.mpToken instanceof ScMatrixCellResultToken) return this.mpToken.GetDouble();
      return 0.0;
    }
    return this.mfValue;
  }

  GetString(): string {
    if (this.maHybridString !== null) return this.maHybridString;
    if (this.mbToken && this.mpToken) {
      if (this.mpToken.GetType() === svString) return this.mpToken.GetString();
      if (this.mpToken instanceof ScMatrixCellResultToken) return this.mpToken.GetString();
    }
    return '';
  }

  GetMatrix(): ScMatrix | null {
    if (this.mbToken && this.mpToken && (this.mpToken.GetType() === svMatrix || this.mpToken.GetType() === svMatrixCell)) return this.mpToken.GetMatrix() as ScMatrix | null;
    return null;
  }

  GetToken(): FormulaToken | null {
    if (this.mnError !== FormulaError.NONE) return new FormulaErrorToken(this.mnError);
    if (this.mbEmpty) return new ScEmptyCellToken(false, this.mbEmptyDisplayedAsString);
    if (this.maHybridString !== null) return new FormulaStringToken(this.maHybridString);
    if (!this.mbToken) return new FormulaDoubleToken(this.mfValue);
    return this.mpToken;
  }

  GetResult(): FormulaResultValue {
    if (this.mnError !== FormulaError.NONE) return { meType: 'Error', mfValue: 0, maString: '', mnError: this.mnError };
    if (this.IsValue()) return { meType: 'Value', mfValue: this.GetDouble(), maString: '', mnError: FormulaError.NONE };
    return { meType: 'String', mfValue: 0, maString: this.GetString(), mnError: FormulaError.NONE };
  }
}

/** The upper left element of a matrix result as a token (ScMatrixFormulaCellToken::Assign). */
function UpperLeftToken(pMat: ScMatrix | null): FormulaToken | null {
  if (!pMat) return null;
  const { nC, nR } = pMat.GetDimensions();
  if (!nC || !nR) return null;
  if (pMat.IsValue(0, 0)) {
    const nErr = pMat.GetError(0, 0);
    if (nErr !== FormulaError.NONE) return new FormulaErrorToken(nErr);
    return new FormulaDoubleToken(pMat.GetDouble(0, 0));
  }
  if (pMat.IsEmpty(0, 0)) return new ScEmptyCellToken(false, true);
  return new FormulaStringToken(pMat.GetString(0, 0));
}
