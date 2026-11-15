// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/math.hxx partial
// sc::div and sc::divide: division that yields a coded #DIV/0! error, or a defined
// Infinity/NaN, for a zero denominator. power() (math.cxx) is not ported here.
import { CreateDoubleError, FormulaError } from '../../include/formula/errorcodes.ts';

/** Return fNumerator/fDenominator if fDenominator!=0 else #DIV/0! error coded
    into double.
 */
export function div(fNumerator: number, fDenominator: number): number {
  return fDenominator !== 0.0 ? fNumerator / fDenominator : CreateDoubleError(FormulaError.DivisionByZero);
}

/** Return fNumerator/fDenominator if fDenominator!=0 else +-Infinity if
    fNumerator!=0 or NaN if fNumerator==0.

    Use where the double coded error creating div() is not wanted.
 */
export function divide(fNumerator: number, fDenominator: number): number {
  if (fDenominator === 0.0) {
    if (Number.isFinite(fNumerator) && fNumerator !== 0.0) return fNumerator < 0 || Object.is(fNumerator, -0) ? -Infinity : Infinity;
    return NaN;
  }
  return fNumerator / fDenominator;
}
