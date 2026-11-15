// SPDX-License-Identifier: MPL-2.0
// @upstream include/formula/errorcodes.hxx faithful
// FormulaError and the NaN-coded error doubles. As upstream, an error travels as a quiet NaN whose
// lower 32 mantissa bits hold the code; V8 keeps NaN payloads through stores and arithmetic, and
// the bits are written and read through a DataView.

export const FormulaError = {
  NONE: 0,
  IllegalChar: 501,
  IllegalArgument: 502,
  IllegalFPOperation: 503, // #NUM!
  IllegalParameter: 504,
  Pair: 507,
  PairExpected: 508,
  OperatorExpected: 509,
  VariableExpected: 510,
  ParameterExpected: 511,
  CodeOverflow: 512,
  StringOverflow: 513,
  StackOverflow: 514,
  UnknownState: 515,
  UnknownVariable: 516,
  UnknownOpCode: 517,
  UnknownStackVariable: 518,
  NoValue: 519, // #VALUE!
  UnknownToken: 520,
  NoCode: 521, // #NULL!
  CircularReference: 522,
  NoConvergence: 523,
  NoRef: 524, // #REF!
  NoName: 525, // #NAME?
  // ScInterpreter internal:  no numeric value but numeric queried. If this is
  // set as mnStringNoValueError no error is generated but 0 returned.
  CellNoValue: 529,
  // Interpreter: needed AddIn not found
  NoAddin: 530,
  // Interpreter: needed Macro not found
  NoMacro: 531,
  // Interpreter: Division by zero
  DivisionByZero: 532, // #DIV/0!
  // Compiler: a non-simple (str,err,val) value was put in an array
  NestedArray: 533,
  // ScInterpreter internal:  no numeric value but numeric queried. If this is
  // temporarily (!) set as mnStringNoValueError, the error is generated and can
  // be used to distinguish that condition from all other (inherited) errors. Do
  // not use for anything else! Never push or inherit the error otherwise!
  NotNumericString: 534,
  // ScInterpreter internal:  jump matrix already has a result at this position,
  // do not overwrite in case of empty code path.
  JumpMatHasResult: 535,
  // ScInterpreter internal:  (matrix) element is not a numeric value, i.e.
  // string or empty, to be distinguished from the general FormulaError::NoValue NAN and not
  // to be used as result.
  ElementNaN: 536,
  // ScInterpreter/ScFormulaCell internal:  keep dirty, retry interpreting next
  // round.
  RetryCircular: 537,
  // If matrix could not be allocated.
  MatrixSize: 538,
  // Bad inline array content, non-value/non-string.
  BadArrayContent: 539,
  // Interpreter: signal result not available because updating links is not
  // allowed (yet) and tell to try hybrid string as result.
  LinkFormulaNeedingCheck: 540,
  // Interpreter: NA() not available condition, not a real error
  NotAvailable: 0x7fff,
} as const;
export type FormulaError = (typeof FormulaError)[keyof typeof FormulaError];

const aBits = new DataView(new ArrayBuffer(8));

/** Unconditionally construct a double value of NAN where the lower bits
    represent an interpreter error code. */
export function CreateDoubleError(nErr: FormulaError): number {
  aBits.setUint32(0, nErr, true);
  aBits.setUint32(4, 0x7ff80000, true);
  return aBits.getFloat64(0, true);
}

/** Recreate the error code of a coded double error, if any. */
export function GetDoubleErrorValue(fVal: number): FormulaError {
  if (Number.isFinite(fVal)) return FormulaError.NONE;
  if (!Number.isNaN(fVal)) return FormulaError.IllegalFPOperation; // normal INF
  aBits.setFloat64(0, fVal, true);
  const nErr = aBits.getUint32(0, true);
  if (nErr & 0xffff0000) return FormulaError.NoValue; // just a normal NAN
  // Another NAN, e.g. -nan(0x8000000000000) from calculating with -inf
  if (!nErr) return FormulaError.IllegalFPOperation;
  // Any other error known to us as error code.
  return (nErr & 0x0000ffff) as FormulaError;
}

/** Error values that are accepted as detailed "#ERRxxx!" constants.
    Used in FormulaCompiler::GetErrorConstant() to prevent users from inventing
    arbitrary values that already have or later might get a significant meaning.
 */
export function isPublishedFormulaError(nErr: FormulaError): boolean {
  switch (nErr) {
    case FormulaError.NONE:
      return false;
    case FormulaError.IllegalChar:
    case FormulaError.IllegalArgument:
    case FormulaError.IllegalFPOperation:
    case FormulaError.IllegalParameter:
    case FormulaError.Pair:
    case FormulaError.PairExpected:
    case FormulaError.OperatorExpected:
    case FormulaError.VariableExpected:
    case FormulaError.ParameterExpected:
    case FormulaError.CodeOverflow:
    case FormulaError.StringOverflow:
    case FormulaError.StackOverflow:
    case FormulaError.UnknownState:
    case FormulaError.UnknownVariable:
    case FormulaError.UnknownOpCode:
    case FormulaError.UnknownStackVariable:
    case FormulaError.NoValue:
    case FormulaError.UnknownToken:
    case FormulaError.NoCode:
    case FormulaError.CircularReference:
    case FormulaError.NoConvergence:
    case FormulaError.NoRef:
    case FormulaError.NoName:
      return true;
    case FormulaError.CellNoValue:
      return false;
    case FormulaError.NoAddin:
    case FormulaError.NoMacro:
    case FormulaError.DivisionByZero:
    case FormulaError.NestedArray:
    case FormulaError.BadArrayContent:
      return true;
    case FormulaError.NotNumericString:
    case FormulaError.JumpMatHasResult:
    case FormulaError.ElementNaN:
    case FormulaError.RetryCircular:
      return false;
    case FormulaError.MatrixSize:
    case FormulaError.LinkFormulaNeedingCheck:
      return true;
    case FormulaError.NotAvailable:
      return false;
  }
  return false;
}
