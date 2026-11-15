// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/core/tool/interpr8.cxx partial
// The newer Excel functions kept in interpr8.cxx: IFS, SWITCH, CONCAT, TEXTJOIN, ... Function
// families are added between the section markers below. Left out: FORECAST.ETS (exponential
// smoothing), LET and LAMBDA.
import { ScInterpreter } from './interpr4.ts';
import { FormulaError } from '../../../../include/formula/errorcodes.ts';
import * as OC from '../../../../include/formula/opcode.ts';
import { svDouble, svDoubleRef, svMatrix, svSingleRef, svString } from '../../../../formula/source/core/api/token.ts';
import { approxEqual } from '../../../../sal/rtl/math.ts';
import { ScMatrix } from './scmatrix.ts';
import { svMissing, svRefList } from '../../../../formula/source/core/api/token.ts';
import { ScAddress } from '../../../inc/address.ts';
import { ScGlobal } from '../../../inc/global.ts';
import { GetDoubleErrorValue } from '../../../../include/formula/errorcodes.ts';

// IFS and SWITCH are ordinary functions (not jump commands): all parameters are evaluated.

declare module './interpr4.ts' {
  interface ScInterpreter {
    ScIfs_MS(): void;
    ScSwitch_MS(): void;
  }
}

ScInterpreter.prototype.ScIfs_MS = function (this: ScInterpreter): void {
  let nParamCount = this.GetByte();

  this.ReverseStack(nParamCount);

  this.nGlobalError = FormulaError.NONE; // propagate only for condition or active result path
  let bFinished = false;
  while (nParamCount > 0 && !bFinished && this.nGlobalError === FormulaError.NONE) {
    const bVal = this.GetBool();
    nParamCount--;
    if (bVal) {
      // TRUE
      if (nParamCount < 1) {
        // no parameter given for THEN
        this.PushParameterExpected();
        return;
      }
      bFinished = true;
    } else {
      // FALSE
      if (nParamCount >= 3) {
        // ELSEIF path
        this.Pop();
        nParamCount--;
      } else {
        // no parameter given for ELSE
        this.PushNA();
        return;
      }
    }
  }

  if (this.nGlobalError !== FormulaError.NONE || !bFinished) {
    if (!bFinished) this.PushNA(); // no true expression found
    if (this.nGlobalError !== FormulaError.NONE) this.PushNoValue(); // expression returned something other than true or false
    return;
  }

  //push result :
  const xToken = this.PopToken();
  if (xToken) {
    // Remove unused arguments of IFS from the stack before pushing the result.
    while (nParamCount > 1) {
      this.Pop();
      nParamCount--;
    }
    this.PushTokenRef(xToken);
  } else this.PushError(FormulaError.UnknownStackVariable);
};

ScInterpreter.prototype.ScSwitch_MS = function (this: ScInterpreter): void {
  let nParamCount = this.GetByte();

  if (!this.MustHaveParamCountMin(nParamCount, 3)) return;

  this.ReverseStack(nParamCount);

  this.nGlobalError = FormulaError.NONE; // propagate only for match or active result path
  let isValue = false;
  let fRefVal = 0;
  let aRefStr = '';
  switch (this.GetStackType()) {
    case svDouble:
      isValue = true;
      fRefVal = this.GetDouble();
      break;
    case svString:
      isValue = false;
      aRefStr = this.GetString();
      break;
    case svSingleRef:
    case svDoubleRef: {
      const aAdr = this.PopDoubleRefOrSingleRef();
      if (!aAdr) break;
      const aCell = this.mrDoc.GetRefCellValue(aAdr);
      isValue = !(aCell.hasString() || aCell.hasEmptyValue() || aCell.isEmpty());
      if (isValue) fRefVal = this.GetCellValue(aAdr, aCell);
      else aRefStr = this.GetCellString(aCell);
      break;
    }
    case svMatrix: {
      const r = this.GetDoubleOrStringFromMatrix();
      fRefVal = r.fVal;
      aRefStr = r.aStr;
      isValue = ScMatrix.IsValueType(r.nType);
      break;
    }
    default:
      this.PopError();
      this.PushIllegalArgument();
      return;
  }
  nParamCount--;
  let bFinished = false;
  while (nParamCount > 1 && !bFinished && this.nGlobalError === FormulaError.NONE) {
    let fVal = 0;
    let aStr = '';
    if (isValue) fVal = this.GetDouble();
    else aStr = this.GetString();
    nParamCount--;
    if ((this.nGlobalError !== FormulaError.NONE && nParamCount < 2) || (isValue && approxEqual(fRefVal, fVal)) || (!isValue && aRefStr.toUpperCase() === aStr.toUpperCase())) {
      // TRUE
      bFinished = true;
    } else {
      // FALSE
      if (nParamCount >= 2) {
        // ELSEIF path
        this.Pop();
        nParamCount--;
        // if nParamCount equals 1: default value  to be returned
        bFinished = nParamCount === 1;
      } else {
        // no parameter given for ELSE
        this.PushNA();
        return;
      }
      this.nGlobalError = FormulaError.NONE;
    }
  }

  if (this.nGlobalError !== FormulaError.NONE || !bFinished) {
    if (!bFinished) this.PushNA(); // no true expression found
    else this.PushError(this.nGlobalError);
    return;
  }

  // push result
  const xToken = this.PopToken();
  if (xToken) {
    // Remove unused arguments of SWITCH from the stack before pushing the result.
    while (nParamCount > 1) {
      this.Pop();
      nParamCount--;
    }
    this.PushTokenRef(xToken);
  } else this.PushError(FormulaError.UnknownStackVariable);
};

ScInterpreter.Register(OC.ocIfs_MS, ScInterpreter.prototype.ScIfs_MS);
ScInterpreter.Register(OC.ocSwitch_MS, ScInterpreter.prototype.ScSwitch_MS);

// @@ LOGIC (IFS, SWITCH) @@

// CONCAT and TEXTJOIN.

declare module './interpr4.ts' {
  interface ScInterpreter {
    ScConcat_MS(): void;
    ScTextJoin_MS(): void;
  }
}

/** ScMatrix::GetString(ScInterpreterContext&, nC, nR): an element as a string, a number in the
    standard format's input line string, an error value as its error string. */
function lcl_MatGetStringContext(self: ScInterpreter, pMat: ScMatrix, nC: number, nR: number): string {
  if (!pMat.ValidColRowOrReplicated(nC, nR)) return '';
  if (pMat.IsStringOrEmpty(nC, nR)) {
    // result of empty FALSE jump path
    if (pMat.IsEmptyPath(nC, nR)) return 'FALSE';
    return pMat.GetString(nC, nR);
  }
  const fVal = pMat.Get(nC, nR).fVal;
  const nError = GetDoubleErrorValue(fVal);
  if (nError !== FormulaError.NONE) {
    self.SetError(nError);
    return ScGlobal.GetErrorString(nError);
  }
  return self.GetStringFromDouble(fVal);
}

ScInterpreter.prototype.ScConcat_MS = function (this: ScInterpreter): void {
  let aResBuf = '';
  let nParamCount = this.GetByte();

  //reverse order of parameter stack to simplify concatenation:
  this.ReverseStack(nParamCount);

  let nRefInList = 0;
  while (nParamCount-- > 0 && this.nGlobalError === FormulaError.NONE) {
    switch (this.GetStackType()) {
      case svString:
      case svDouble: {
        const aStr = this.GetString();
        if (this.CheckStringResultLen(aResBuf, aStr.length)) aResBuf += aStr;
        break;
      }
      case svSingleRef: {
        const aAdr = this.PopSingleRef();
        if (this.nGlobalError !== FormulaError.NONE) break;
        const aCell = this.mrDoc.GetRefCellValue(aAdr);
        if (!aCell.hasEmptyValue()) {
          const rStr = this.GetCellString(aCell);
          if (this.CheckStringResultLen(aResBuf, rStr.length)) aResBuf += rStr;
        }
        break;
      }
      case svDoubleRef:
      case svRefList: {
        const st = { nParam: nParamCount, nRefInList };
        const aRange = this.PopDoubleRef(st);
        nParamCount = st.nParam;
        nRefInList = st.nRefInList;
        if (this.nGlobalError !== FormulaError.NONE) break;
        // we need to read row for row, so we can't use ScCellIter
        const nCol1 = aRange.aStart.Col(), nRow1 = aRange.aStart.Row(), nTab1 = aRange.aStart.Tab();
        const nCol2 = aRange.aEnd.Col(), nRow2 = aRange.aEnd.Row(), nTab2 = aRange.aEnd.Tab();
        if (nTab1 !== nTab2) {
          this.SetError(FormulaError.IllegalParameter);
          break;
        }
        const aAdr = new ScAddress(0, 0, nTab1);
        for (let nRow = nRow1; nRow <= nRow2; nRow++) {
          for (let nCol = nCol1; nCol <= nCol2; nCol++) {
            aAdr.SetRow(nRow);
            aAdr.SetCol(nCol);
            const aCell = this.mrDoc.GetRefCellValue(aAdr);
            if (!aCell.hasEmptyValue()) {
              const rStr = this.GetCellString(aCell);
              if (this.CheckStringResultLen(aResBuf, rStr.length)) aResBuf += rStr;
            }
          }
        }
        break;
      }
      case svMatrix: {
        const pMat = this.GetMatrix();
        if (pMat) {
          const { nC, nR } = pMat.GetDimensions();
          if (nC === 0 || nR === 0) this.SetError(FormulaError.IllegalArgument);
          else {
            for (let k = 0; k < nR; ++k) {
              for (let j = 0; j < nC; ++j) {
                if (pMat.IsStringOrEmpty(j, k)) {
                  const aStr = pMat.GetString(j, k);
                  if (this.CheckStringResultLen(aResBuf, aStr.length)) aResBuf += aStr;
                } else {
                  if (pMat.IsValue(j, k)) {
                    const aStr = lcl_MatGetStringContext(this, pMat, j, k);
                    if (this.CheckStringResultLen(aResBuf, aStr.length)) aResBuf += aStr;
                  }
                }
              }
            }
          }
        }
        break;
      }
      default:
        this.PopError();
        this.SetError(FormulaError.IllegalArgument);
        break;
    }
  }
  this.PushString(aResBuf);
};

ScInterpreter.prototype.ScTextJoin_MS = function (this: ScInterpreter): void {
  let nParamCount = this.GetByte();

  if (!this.MustHaveParamCountMin(nParamCount, 3)) return;

  //reverse order of parameter stack to simplify processing
  this.ReverseStack(nParamCount);

  // get aDelimiters and bSkipEmpty
  const aDelimiters: string[] = [];
  let nRefInList = 0;
  switch (this.GetStackType()) {
    case svString:
    case svDouble:
      aDelimiters.push(this.GetString());
      break;
    case svSingleRef: {
      const aAdr = this.PopSingleRef();
      if (this.nGlobalError !== FormulaError.NONE) break;
      const aCell = this.mrDoc.GetRefCellValue(aAdr);
      if (aCell.hasEmptyValue()) aDelimiters.push('');
      else {
        aDelimiters.push(this.GetCellString(aCell));
      }
      break;
    }
    case svDoubleRef:
    case svRefList: {
      const st = { nParam: nParamCount, nRefInList };
      const aRange = this.PopDoubleRef(st);
      nParamCount = st.nParam;
      nRefInList = st.nRefInList;
      if (this.nGlobalError !== FormulaError.NONE) break;
      // we need to read row for row, so we can't use ScCellIterator
      const nCol1 = aRange.aStart.Col(), nRow1 = aRange.aStart.Row(), nTab1 = aRange.aStart.Tab();
      const nCol2 = aRange.aEnd.Col(), nRow2 = aRange.aEnd.Row(), nTab2 = aRange.aEnd.Tab();
      if (nTab1 !== nTab2) {
        this.SetError(FormulaError.IllegalParameter);
        break;
      }
      const aAdr = new ScAddress(0, 0, nTab1);
      for (let nRow = nRow1; nRow <= nRow2; nRow++) {
        for (let nCol = nCol1; nCol <= nCol2; nCol++) {
          aAdr.SetRow(nRow);
          aAdr.SetCol(nCol);
          const aCell = this.mrDoc.GetRefCellValue(aAdr);
          if (aCell.hasEmptyValue()) aDelimiters.push('');
          else {
            aDelimiters.push(this.GetCellString(aCell));
          }
        }
      }
      break;
    }
    case svMatrix: {
      const pMat = this.GetMatrix();
      if (pMat) {
        const { nC, nR } = pMat.GetDimensions();
        if (nC === 0 || nR === 0) this.SetError(FormulaError.IllegalArgument);
        else {
          for (let k = 0; k < nR; ++k) {
            for (let j = 0; j < nC; ++j) {
              if (pMat.IsEmpty(j, k)) aDelimiters.push('');
              else if (pMat.IsStringOrEmpty(j, k)) aDelimiters.push(pMat.GetString(j, k));
              else if (pMat.IsValue(j, k)) aDelimiters.push(lcl_MatGetStringContext(this, pMat, j, k));
              else {
                // should this really happen?
                aDelimiters.push('');
              }
            }
          }
        }
      }
      break;
    }
    default:
      this.PopError();
      this.SetError(FormulaError.IllegalArgument);
      break;
  }
  if (!aDelimiters.length) {
    this.PushIllegalArgument();
    return;
  }
  const nSize = aDelimiters.length;
  const bSkipEmpty = this.GetDouble() !== 0;
  nParamCount -= 2;

  let aResBuf = '';
  let bFirst = true;
  let nIdx = 0;
  nRefInList = 0;
  /** The delimiter before a string that is not the first one, cycling through the delimiters. */
  const appendDelimiter = (): void => {
    if (!bFirst) {
      aResBuf += aDelimiters[nIdx];
      if (nSize > 1) {
        if (++nIdx >= nSize) nIdx = 0;
      }
    } else bFirst = false;
  };
  // get the strings to be joined
  while (nParamCount-- > 0 && this.nGlobalError === FormulaError.NONE) {
    switch (this.GetStackType()) {
      case svString:
      case svDouble: {
        const aStr = this.GetString();
        if (aStr || !bSkipEmpty) {
          appendDelimiter();
          if (this.CheckStringResultLen(aResBuf, aStr.length)) aResBuf += aStr;
        }
        break;
      }
      case svSingleRef: {
        const aAdr = this.PopSingleRef();
        if (this.nGlobalError !== FormulaError.NONE) break;
        const aCell = this.mrDoc.GetRefCellValue(aAdr);
        let aStr = '';
        if (!aCell.hasEmptyValue()) {
          aStr = this.GetCellString(aCell);
        }
        if (aStr || !bSkipEmpty) {
          appendDelimiter();
          if (this.CheckStringResultLen(aResBuf, aStr.length)) aResBuf += aStr;
        }
        break;
      }
      case svDoubleRef:
      case svRefList: {
        const st = { nParam: nParamCount, nRefInList };
        const aRange = this.PopDoubleRef(st);
        nParamCount = st.nParam;
        nRefInList = st.nRefInList;
        if (this.nGlobalError !== FormulaError.NONE) break;
        // we need to read row for row, so we can't use ScCellIterator
        const nCol1 = aRange.aStart.Col(), nRow1 = aRange.aStart.Row(), nTab1 = aRange.aStart.Tab();
        const nCol2 = aRange.aEnd.Col(), nRow2 = aRange.aEnd.Row(), nTab2 = aRange.aEnd.Tab();
        if (nTab1 !== nTab2) {
          this.SetError(FormulaError.IllegalParameter);
          break;
        }
        const aAdr = new ScAddress(0, 0, nTab1);
        let aStr: string;
        for (let nRow = nRow1; nRow <= nRow2; nRow++) {
          for (let nCol = nCol1; nCol <= nCol2; nCol++) {
            aAdr.SetRow(nRow);
            aAdr.SetCol(nCol);
            const aCell = this.mrDoc.GetRefCellValue(aAdr);
            if (aCell.hasEmptyValue()) aStr = '';
            else {
              aStr = this.GetCellString(aCell);
            }
            if (aStr || !bSkipEmpty) {
              appendDelimiter();
              if (this.CheckStringResultLen(aResBuf, aStr.length)) aResBuf += aStr;
            }
          }
        }
        break;
      }
      case svMatrix: {
        const pMat = this.GetMatrix();
        if (pMat) {
          const { nC, nR } = pMat.GetDimensions();
          if (nC === 0 || nR === 0) this.SetError(FormulaError.IllegalArgument);
          else {
            let aStr: string;
            for (let k = 0; k < nR; ++k) {
              for (let j = 0; j < nC; ++j) {
                if (pMat.IsEmpty(j, k)) aStr = '';
                else if (pMat.IsStringOrEmpty(j, k)) aStr = pMat.GetString(j, k);
                else if (pMat.IsValue(j, k)) aStr = lcl_MatGetStringContext(this, pMat, j, k);
                else {
                  // should this really happen?
                  aStr = '';
                }
                if (aStr || !bSkipEmpty) {
                  appendDelimiter();
                  if (this.CheckStringResultLen(aResBuf, aStr.length)) aResBuf += aStr;
                }
              }
            }
          }
        }
        break;
      }
      case svMissing: {
        if (!bSkipEmpty) {
          appendDelimiter();
        }
        break;
      }
      default:
        this.PopError();
        this.SetError(FormulaError.IllegalArgument);
        break;
    }
  }
  this.PushString(aResBuf);
};

ScInterpreter.Register(OC.ocConcat_MS, ScInterpreter.prototype.ScConcat_MS);
ScInterpreter.Register(OC.ocTextJoin_MS, ScInterpreter.prototype.ScTextJoin_MS);

// @@ TEXT (CONCAT, TEXTJOIN) @@

export { ScInterpreter };
