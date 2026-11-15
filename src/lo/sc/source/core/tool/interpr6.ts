// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/core/tool/interpr6.cxx partial
// IterateParameters and the functions built on it: SUM, SUMSQ, PRODUCT, AVERAGE, COUNT, COUNTA
// and RAWSUBTRACT. Ranges are iterated with ScValueIterator / ScCellIterator (the span set fast
// path of upstream is the same loop here). The incomplete gamma helpers of interpr6.cxx belong
// to the statistics port.
import { FormulaError } from '../../../../include/formula/errorcodes.ts';
import * as OC from '../../../../include/formula/opcode.ts';
import { svDouble, svDoubleRef, svError, svMatrix, svRefList, svSingleRef, svString } from '../../../../formula/source/core/api/token.ts';
import { SvNumFormatType } from '../../../../svl/source/numbers/zforlist.ts';
import { CELLTYPE_NONE } from '../../../inc/cellvalue.ts';
import { SubtotalFlags } from '../../../inc/global.ts';
import { ScCellIterator, ScValueIterator } from '../data/dociter.ts';
import { KahanSum } from './kahan.ts';
import { ScInterpreter } from './interpr4.ts';
import type { ScMatrix } from './scmatrix.ts';

/** ScIterFunc */
export const ScIterFunc = { ifSUM: 0, ifSUMSQ: 1, ifPRODUCT: 2, ifAVERAGE: 3, ifCOUNT: 4, ifCOUNT2: 5, ifMIN: 6, ifMAX: 7 } as const;
export type ScIterFunc = (typeof ScIterFunc)[keyof typeof ScIterFunc];
const { ifSUM, ifSUMSQ, ifPRODUCT, ifAVERAGE, ifCOUNT, ifCOUNT2 } = ScIterFunc;

declare module './interpr4.ts' {
  interface ScInterpreter {
    IterateParameters(eFunc: ScIterFunc, bTextAsZero?: boolean): void;
    ScSum(): void;
    ScSumSQ(): void;
    ScProduct(): void;
    ScAverage(bTextAsZero?: boolean): void;
    ScCount(): void;
    ScCount2(): void;
    ScRawSubtract(): void;
  }
}

/** The running result: a Kahan sum, or a product. */
class IterResult {
  private k = new KahanSum();
  private fProd = 1.0;
  private readonly bProduct: boolean;
  constructor(bProduct: boolean) { this.bProduct = bProduct; }
  add(f: number): void { if (this.bProduct) this.fProd *= f; else this.k.add(f); }
  set(f: number): void { if (this.bProduct) this.fProd = f; else this.k = new KahanSum(f); }
  get(): number { return this.bProduct ? this.fProd : this.k.get(); }
}

function IterateMatrix(pMat: ScMatrix | null, eFunc: ScIterFunc, bTextAsZero: boolean, nSubTotalFlags: SubtotalFlags, st: { nCount: number; fRes: IterResult }, self: ScInterpreter): void {
  if (!pMat) return;
  const bIgnoreErrVal = (nSubTotalFlags & SubtotalFlags.IgnoreErrVal) !== 0;
  self.nFuncFmtType = SvNumFormatType.NUMBER;
  switch (eFunc) {
    case ifAVERAGE:
    case ifSUM: {
      const aRes = pMat.Sum(bTextAsZero, bIgnoreErrVal);
      if (aRes.mnCount) { st.fRes.add(aRes.mfFirst); st.fRes.add(aRes.mfRest); }
      st.nCount += aRes.mnCount;
      break;
    }
    case ifCOUNT:
      st.nCount += pMat.Count(bTextAsZero, false); // do not count error values
      break;
    case ifCOUNT2:
      /* TODO: what is this supposed to be with bIgnoreErrVal? */
      st.nCount += pMat.Count(true, true); // do count error values
      break;
    case ifPRODUCT: {
      const aRes = pMat.Product(bTextAsZero, bIgnoreErrVal);
      st.fRes.add(aRes.mfFirst);
      st.nCount += aRes.mnCount;
      break;
    }
    case ifSUMSQ: {
      const aRes = pMat.SumSquare(bTextAsZero, bIgnoreErrVal);
      st.fRes.add(aRes.mfRest);
      st.nCount += aRes.mnCount;
      break;
    }
    default:
  }
}

function lcl_IterResult(eFunc: ScIterFunc, fRes: number, nCount: number): number {
  switch (eFunc) {
    case ifAVERAGE:
      fRes = nCount ? fRes / nCount : Number.NaN;
      break;
    case ifCOUNT2:
    case ifCOUNT:
      fRes = nCount;
      break;
    case ifPRODUCT:
      if (!nCount) fRes = 0.0;
      break;
    default:
    // nothing
  }
  return fRes;
}

ScInterpreter.prototype.IterateParameters = function (this: ScInterpreter, eFunc: ScIterFunc, bTextAsZero = false): void {
  let nParamCount = this.GetByte();
  const st = { nCount: 0, fRes: new IterResult(eFunc === ifPRODUCT) };
  let fVal = 0.0;
  const refState = { nParam: 0, nRefInList: 0 };
  const flags = this.mnSubTotalFlags;
  if (this.nGlobalError !== FormulaError.NONE && (eFunc === ifCOUNT2 || eFunc === ifCOUNT || flags & SubtotalFlags.IgnoreErrVal)) this.nGlobalError = FormulaError.NONE;
  const accumulate = (v: number) => {
    switch (eFunc) {
      case ifAVERAGE:
      case ifSUM: st.fRes.add(v); break;
      case ifSUMSQ: st.fRes.add(v * v); break;
      case ifPRODUCT: st.fRes.add(v); break;
      default: // nothing
    }
  };
  while (nParamCount-- > 0) {
    switch (this.GetStackType()) {
      case svString: {
        if (eFunc === ifCOUNT) {
          const aStr = this.PopString();
          if (bTextAsZero) st.nCount++;
          else {
            // Only check if string can be converted to number, no
            // error propagation.
            const nErr = this.nGlobalError;
            this.nGlobalError = FormulaError.NONE;
            this.ConvertStringToValue(aStr);
            if (this.nGlobalError === FormulaError.NONE) ++st.nCount;
            this.nGlobalError = nErr;
          }
        } else {
          this.Pop();
          switch (eFunc) {
            case ifAVERAGE:
            case ifSUM:
            case ifSUMSQ:
            case ifPRODUCT:
              if (bTextAsZero) {
                st.nCount++;
                if (eFunc === ifPRODUCT) st.fRes.set(0.0);
              } else {
                while (nParamCount-- > 0) this.PopError();
                this.SetError(FormulaError.NoValue);
              }
              break;
            default:
              st.nCount++;
          }
        }
        break;
      }
      case svDouble:
        fVal = this.GetDouble();
        st.nCount++;
        accumulate(fVal);
        this.nFuncFmtType = SvNumFormatType.NUMBER;
        break;
      case svSingleRef: {
        const aAdr = this.PopSingleRef();
        if (this.nGlobalError === FormulaError.NoRef) {
          this.PushError(FormulaError.NoRef);
          return;
        }
        if ((flags & SubtotalFlags.IgnoreFiltered && this.mrDoc.RowFiltered(aAdr.Row(), aAdr.Tab())) || (flags & SubtotalFlags.IgnoreHidden && this.mrDoc.RowHidden(aAdr.Row(), aAdr.Tab()))) break;
        if (this.nGlobalError !== FormulaError.NONE && (eFunc === ifCOUNT2 || eFunc === ifCOUNT || flags & SubtotalFlags.IgnoreErrVal)) {
          this.nGlobalError = FormulaError.NONE;
          if (eFunc === ifCOUNT2 && !(flags & SubtotalFlags.IgnoreErrVal)) ++st.nCount;
          break;
        }
        const aCell = this.mrDoc.GetRefCellValue(aAdr);
        if (!aCell.isEmpty()) {
          if (eFunc === ifCOUNT2) {
            if (aCell.getType() !== CELLTYPE_NONE) st.nCount++;
            if (this.nGlobalError !== FormulaError.NONE) this.nGlobalError = FormulaError.NONE;
          } else if (aCell.hasNumeric()) {
            fVal = this.GetCellValue(aAdr, aCell);
            if (this.nGlobalError !== FormulaError.NONE) {
              if (eFunc === ifCOUNT || flags & SubtotalFlags.IgnoreErrVal) this.nGlobalError = FormulaError.NONE;
              break;
            }
            st.nCount++;
            this.CurFmtToFuncFmt();
            accumulate(fVal);
          } else if (aCell.hasError()) {
            // an error result of a formula cell
            const nErr = aCell.getFormula()!.GetErrCode();
            if (eFunc === ifCOUNT || flags & SubtotalFlags.IgnoreErrVal) break;
            this.SetError(nErr);
          } else if (bTextAsZero && aCell.hasString()) {
            st.nCount++;
            if (eFunc === ifPRODUCT) st.fRes.set(0.0);
          }
        }
        break;
      }
      case svRefList:
      case svDoubleRef: {
        const nParamBefore = refState.nParam;
        refState.nParam = nParamCount;
        const aRange = this.PopDoubleRef(refState);
        nParamCount = refState.nParam;
        void nParamBefore;
        if (this.nGlobalError === FormulaError.NoRef) {
          this.PushError(FormulaError.NoRef);
          return;
        }
        if (this.nGlobalError !== FormulaError.NONE && (eFunc === ifCOUNT2 || eFunc === ifCOUNT || flags & SubtotalFlags.IgnoreErrVal)) {
          this.nGlobalError = FormulaError.NONE;
          if (eFunc === ifCOUNT2 && !(flags & SubtotalFlags.IgnoreErrVal)) ++st.nCount;
          if (eFunc === ifCOUNT2 || eFunc === ifCOUNT) break;
        }
        if (eFunc === ifCOUNT2) {
          const aIter = new ScCellIterator(this.mrDoc, aRange, flags);
          for (const c of aIter.cells()) if (!c.aCell.isEmpty()) ++st.nCount;
          if (this.nGlobalError !== FormulaError.NONE) this.nGlobalError = FormulaError.NONE;
        } else {
          const aValIter = new ScValueIterator(this.mrDoc, aRange, flags, bTextAsZero);
          let bFirst = true;
          let nErr: FormulaError = FormulaError.NONE;
          for (const v of aValIter.values()) {
            if (bFirst) {
              // placed the loop on the inside for performance reasons:
              const info = aValIter.GetCurNumFmtInfo();
              this.nFuncFmtType = info.nType;
              this.nFuncFmtIndex = info.aCode;
              bFirst = false;
            }
            if (eFunc === ifCOUNT) {
              if (v.nErr === FormulaError.NONE) st.nCount++;
              continue;
            }
            if (v.nErr !== FormulaError.NONE && flags & SubtotalFlags.IgnoreErrVal) continue;
            if (v.nErr !== FormulaError.NONE && nErr === FormulaError.NONE) nErr = v.nErr;
            accumulate(v.fVal);
            st.nCount++;
          }
          this.SetError(nErr);
        }
        break;
      }
      case svMatrix: {
        const pMat = this.PopMatrix();
        IterateMatrix(pMat, eFunc, bTextAsZero, flags, st, this);
        break;
      }
      case svError: {
        this.PopError();
        if (eFunc === ifCOUNT || flags & SubtotalFlags.IgnoreErrVal) this.nGlobalError = FormulaError.NONE;
        else if (eFunc === ifCOUNT2 && !(flags & SubtotalFlags.IgnoreErrVal)) {
          st.nCount++;
          this.nGlobalError = FormulaError.NONE;
        }
        break;
      }
      default:
        while (nParamCount-- > 0) this.PopError();
        this.SetError(FormulaError.IllegalParameter);
    }
  }
  // A boolean return type makes no sense on sums et al.
  // Counts are always numbers.
  if (this.nFuncFmtType === SvNumFormatType.LOGICAL || eFunc === ifCOUNT || eFunc === ifCOUNT2) this.nFuncFmtType = SvNumFormatType.NUMBER;
  const fResult = lcl_IterResult(eFunc, st.fRes.get(), st.nCount);
  if (eFunc === ifAVERAGE && !st.nCount && this.nGlobalError === FormulaError.NONE) {
    this.PushError(FormulaError.DivisionByZero);
    return;
  }
  this.PushDouble(fResult);
};

ScInterpreter.prototype.ScSumSQ = function (this: ScInterpreter): void { this.IterateParameters(ifSUMSQ); };
ScInterpreter.prototype.ScSum = function (this: ScInterpreter): void { this.IterateParameters(ifSUM); };
ScInterpreter.prototype.ScProduct = function (this: ScInterpreter): void { this.IterateParameters(ifPRODUCT); };
ScInterpreter.prototype.ScAverage = function (this: ScInterpreter, bTextAsZero = false): void { this.IterateParameters(ifAVERAGE, bTextAsZero); };
ScInterpreter.prototype.ScCount = function (this: ScInterpreter): void { this.IterateParameters(ifCOUNT); };
ScInterpreter.prototype.ScCount2 = function (this: ScInterpreter): void { this.IterateParameters(ifCOUNT2); };

/**
 * The purpose of RAWSUBTRACT() is exactly to not apply any error correction, approximation etc.
 * But use the "raw" IEEE 754 double subtraction.
 * So no Kahan summation
 */
ScInterpreter.prototype.ScRawSubtract = function (this: ScInterpreter): void {
  let nParamCount = this.GetByte();
  if (!this.MustHaveParamCountMin(nParamCount, 2)) return;
  // Reverse stack to process arguments from left to right.
  this.ReverseStack(nParamCount);
  // Obtain the minuend.
  let fRes = this.GetDouble();
  while (this.nGlobalError === FormulaError.NONE && --nParamCount > 0) {
    // Simple single values without matrix support.
    fRes -= this.GetDouble();
  }
  while (nParamCount-- > 0) this.PopError();
  this.PushDouble(fRes);
};

ScInterpreter.Register(OC.ocSum, ScInterpreter.prototype.ScSum);
ScInterpreter.Register(OC.ocSumSQ, ScInterpreter.prototype.ScSumSQ);
ScInterpreter.Register(OC.ocProduct, ScInterpreter.prototype.ScProduct);
ScInterpreter.Register(OC.ocAverage, function (this: ScInterpreter) { this.ScAverage(false); });
ScInterpreter.Register(OC.ocAverageA, function (this: ScInterpreter) { this.ScAverage(true); });
ScInterpreter.Register(OC.ocCount, ScInterpreter.prototype.ScCount);
ScInterpreter.Register(OC.ocCount2, ScInterpreter.prototype.ScCount2);
ScInterpreter.Register(OC.ocRawSubtract, ScInterpreter.prototype.ScRawSubtract);
