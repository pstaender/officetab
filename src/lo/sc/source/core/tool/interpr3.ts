// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/core/tool/interpr3.cxx partial
// @upstream sc/source/core/tool/interpr6.cxx partial
// Statistics (distributions, MEDIAN, RANK, LARGE, PERCENTILE, CORREL, ...), combinatorics and
// the name errors. Function families are added between the section markers below.
// The statistics part also holds the incomplete gamma helpers upstream keeps in interpr6.cxx
// (GetGammaContFraction ... GetGammaDist). Left out of interpr3.cxx: the sort helpers of the SORT
// function (CreateSortedMatrix ...) and FOURIER. std::nth_element is a full sort here (same
// result). Not ported yet: LINEST/LOGEST/TREND/GROWTH (interpr5.cxx), FORECAST.ETS (interpr8.cxx).
import { CreateDoubleError, FormulaError } from '../../../../include/formula/errorcodes.ts';
import * as OC from '../../../../include/formula/opcode.ts';
import { svDouble, svDoubleRef, svExternalDoubleRef, svExternalSingleRef, svMatrix, svRefList, svSingleRef } from '../../../../formula/source/core/api/token.ts';
import { approxCeil, approxFloor, erfc, round as rtl_math_round, sin as rtl_math_sin } from '../../../../sal/rtl/math.ts';
import { SubtotalFlags } from '../../../inc/global.ts';
import { ScValueIterator } from '../data/dociter.ts';
import { div, divide } from '../../../inc/math.ts';
import { KahanSum } from './kahan.ts';
import { ScInterpreter } from './interpr4.ts';
import type { ScMatrix } from './scmatrix.ts';

declare module './interpr4.ts' {
  interface ScInterpreter {
    ScNoName(): void;
    ScBadName(): void;
  }
}

// General functions

ScInterpreter.prototype.ScNoName = function (this: ScInterpreter): void { this.PushError(FormulaError.NoName); };

ScInterpreter.prototype.ScBadName = function (this: ScInterpreter): void {
  let nParamCount = this.GetByte();
  while (nParamCount-- > 0) this.PopError();
  this.PushError(FormulaError.NoName);
};

declare module './interpr4.ts' {
  interface ScInterpreter {
    // interpr6.cxx
    GetGammaContFraction(fA: number, fX: number): number;
    GetGammaSeries(fA: number, fX: number): number;
    GetLowRegIGamma(fA: number, fX: number): number;
    GetUpRegIGamma(fA: number, fX: number): number;
    GetGammaDistPDF(fX: number, fAlpha: number, fLambda: number): number;
    GetGammaDist(fX: number, fAlpha: number, fLambda: number): number;
    // interpr3.cxx
    phi(x: number): number;
    integralPhi(x: number): number;
    taylor(pPolynom: readonly number[], nMax: number, x: number): number;
    gauss(x: number): number;
    gaussinv(x: number): number;
    Fakultaet(x: number): number;
    BinomCoeff(n: number, k: number): number;
    GetGamma(fZ: number): number;
    GetLogGamma(fZ: number): number;
    GetFDist(x: number, fF1: number, fF2: number): number;
    GetTDist(T: number, fDF: number, nType: number): number;
    GetChiDist(fX: number, fDF: number): number;
    GetChiSqDistCDF(fX: number, fDF: number): number;
    GetChiSqDistPDF(fX: number, fDF: number): number;
    ScChiSqDist(): void;
    ScChiSqDist_MS(): void;
    ScGamma(): void;
    ScLogGamma(): void;
    GetBeta(fAlpha: number, fBeta: number): number;
    GetLogBeta(fAlpha: number, fBeta: number): number;
    GetBetaDistPDF(fX: number, fA: number, fB: number): number;
    GetBetaDist(fXin: number, fAlpha: number, fBeta: number): number;
    ScBetaDist(): void;
    ScBetaDist_MS(): void;
    ScPhi(): void;
    ScGauss(): void;
    ScFisher(): void;
    ScFisherInv(): void;
    ScFact(): void;
    ScCombin(): void;
    ScCombinA(): void;
    ScPermut(): void;
    ScPermutationA(): void;
    GetBinomDistPMF(x: number, n: number, p: number): number;
    ScB(): void;
    ScBinomDist(): void;
    ScCritBinom(): void;
    ScNegBinomDist(): void;
    ScNegBinomDist_MS(): void;
    ScNormDist(nMinParamCount: number): void;
    ScLogNormDist(nMinParamCount: number): void;
    ScStdNormDist(): void;
    ScStdNormDist_MS(): void;
    ScExpDist(): void;
    ScTDist(): void;
    ScTDist_T(nTails: number): void;
    ScTDist_MS(): void;
    ScFDist(): void;
    ScFDist_LT(): void;
    ScChiDist(bODFF: boolean): void;
    ScWeibull(): void;
    ScPoissonDist(bODFF: boolean): void;
    ScHypGeomDist(nMinParamCount: number): void;
    GetHypGeomDist(x: number, n: number, M: number, N: number): number;
    ScGammaDist(bODFF: boolean): void;
    ScNormInv(): void;
    ScSNormInv(): void;
    ScLogNormInv(): void;
    ScGammaInv(): void;
    ScBetaInv(): void;
    ScTInv(nType: number): void;
    GetTInv(fAlpha: number, fSize: number, nType: number): number;
    ScFInv(): void;
    ScFInv_LT(): void;
    ScChiInv(): void;
    ScChiSqInv(): void;
    ScConfidence(): void;
    ScConfidenceT(): void;
  }
}

const fMaxGammaArgument = 171.624376956302; // found experimental
const fMachEps = Number.EPSILON;
/** std::numeric_limits<double>::min() */
const DBL_MIN = 2.2250738585072014e-308;
const M_SQRT1_2 = Math.SQRT1_2;
const HUGE_VAL = Number.POSITIVE_INFINITY;

/** o3tl::div_allow_zero */
const div_allow_zero = (a: number, b: number): number => a / b;

/** The KahanSum copy (KahanSum's copy constructor). */
function kcopy(k: KahanSum): KahanSum {
  const t = new KahanSum();
  t.add(k);
  return t;
}
/** KahanSum operator-(double): (k - f).get() */
function ksub(k: KahanSum, f: number): KahanSum {
  const t = kcopy(k);
  t.add(-f);
  return t;
}
/** KahanSum operator-(KahanSum) */
function ksubk(k: KahanSum, f: KahanSum): KahanSum {
  const t = kcopy(k);
  t.subtract(f);
  return t;
}

/** std::nth_element (a full sort, which also puts the nth element in place). */
function nth_element(rArray: number[]): void {
  rArray.sort((a, b) => a - b);
}

/** Linear (column major) element access of a matrix that sets the matrix' error interpreter's
    error as ScMatrix::GetDouble(SCSIZE) does. */
function GetMatDouble(pMat: ScMatrix, nIndex: number): number {
  const nR = pMat.GetRowCount();
  return pMat.GetDouble(Math.trunc(nIndex / nR), nIndex % nR);
}

// --- interpr6.cxx ---------------------------------------------------------------------------------

const fHalfMachEps = 0.5 * Number.EPSILON;

// The idea how this group of gamma functions is calculated, is
// based on the Cephes library
// online http://www.moshier.net/#Cephes [called 2008-02]

/** You must ensure fA>0.0 && fX>0.0
    valid results only if fX > fA+1.0
    uses continued fraction with odd items */
ScInterpreter.prototype.GetGammaContFraction = function (this: ScInterpreter, fA: number, fX: number): number {
  const fBigInv = Number.EPSILON;
  const fBig = 1.0 / fBigInv;
  let fCount = 0.0;
  let fY = 1.0 - fA;
  let fDenom = fX + 2.0 - fA;
  let fPkm1 = fX + 1.0;
  let fPkm2 = 1.0;
  let fQkm1 = fDenom * fX;
  let fQkm2 = fX;
  let fApprox = fPkm1 / fQkm1;
  let bFinished = false;
  do {
    fCount = fCount + 1.0;
    fY = fY + 1.0;
    const fNum = fY * fCount;
    fDenom = fDenom + 2.0;
    const fPk = fPkm1 * fDenom - fPkm2 * fNum;
    const fQk = fQkm1 * fDenom - fQkm2 * fNum;
    if (fQk !== 0.0) {
      const fR = fPk / fQk;
      bFinished = Math.abs((fApprox - fR) / fR) <= fHalfMachEps;
      fApprox = fR;
    }
    fPkm2 = fPkm1;
    fPkm1 = fPk;
    fQkm2 = fQkm1;
    fQkm1 = fQk;
    if (Math.abs(fPk) > fBig) {
      // reduce a fraction does not change the value
      fPkm2 = fPkm2 * fBigInv;
      fPkm1 = fPkm1 * fBigInv;
      fQkm2 = fQkm2 * fBigInv;
      fQkm1 = fQkm1 * fBigInv;
    }
  } while (!bFinished && fCount < 10000);
  // most iterations, if fX==fAlpha+1.0; approx sqrt(fAlpha) iterations then
  if (!bFinished) this.SetError(FormulaError.NoConvergence);
  return fApprox;
};

/** You must ensure fA>0.0 && fX>0.0
    valid results only if fX <= fA+1.0
    uses power series */
ScInterpreter.prototype.GetGammaSeries = function (this: ScInterpreter, fA: number, fX: number): number {
  let fDenomfactor = fA;
  let fSummand = div_allow_zero(1.0, fA);
  let fSum = fSummand;
  let nCount = 1;
  do {
    fDenomfactor = fDenomfactor + 1.0;
    fSummand = (fSummand * fX) / fDenomfactor;
    fSum = fSum + fSummand;
    nCount = nCount + 1;
  } while (fSummand / fSum > fHalfMachEps && nCount <= 10000);
  // large amount of iterations will be carried out for huge fAlpha, even
  // if fX <= fAlpha+1.0
  if (nCount > 10000) this.SetError(FormulaError.NoConvergence);
  return fSum;
};

/** You must ensure fA>0.0 && fX>0.0) */
ScInterpreter.prototype.GetLowRegIGamma = function (this: ScInterpreter, fA: number, fX: number): number {
  const fLnFactor = fA * Math.log(fX) - fX - this.GetLogGamma(fA);
  const fFactor = Math.exp(fLnFactor); // Do we need more accuracy than exp(ln()) has?
  if (fX > fA + 1.0) // includes fX>1.0; 1-GetUpRegIGamma, continued fraction
    return 1.0 - fFactor * this.GetGammaContFraction(fA, fX);
  // fX<=1.0 || fX<=fA+1.0, series
  return fFactor * this.GetGammaSeries(fA, fX);
};

/** You must ensure fA>0.0 && fX>0.0) */
ScInterpreter.prototype.GetUpRegIGamma = function (this: ScInterpreter, fA: number, fX: number): number {
  const fLnFactor = fA * Math.log(fX) - fX - this.GetLogGamma(fA);
  const fFactor = Math.exp(fLnFactor); //Do I need more accuracy than exp(ln()) has?;
  if (fX > fA + 1.0) // includes fX>1.0
    return fFactor * this.GetGammaContFraction(fA, fX);
  //fX<=1 || fX<=fA+1, 1-GetLowRegIGamma, series
  return 1.0 - fFactor * this.GetGammaSeries(fA, fX);
};

/** Gamma distribution, probability density function.
    fLambda is "scale" parameter
    You must ensure fAlpha>0.0 and fLambda>0.0 */
ScInterpreter.prototype.GetGammaDistPDF = function (this: ScInterpreter, fX: number, fAlpha: number, fLambda: number): number {
  if (fX < 0.0) return 0.0; // see ODFF
  else if (fX === 0) {
    // in this case 0^0 isn't zero
    if (fAlpha < 1.0) {
      this.SetError(FormulaError.DivisionByZero); // should be #DIV/0
      return HUGE_VAL;
    } else if (fAlpha === 1) {
      return 1.0 / fLambda;
    } else {
      return 0.0;
    }
  } else {
    const fXr = fX / fLambda;
    // use exp(ln()) only for large arguments because of less accuracy
    if (fXr > 1.0) {
      const fLogDblMax = Math.log(Number.MAX_VALUE);
      if (Math.log(fXr) * (fAlpha - 1.0) < fLogDblMax && fAlpha < fMaxGammaArgument) {
        return div_allow_zero((Math.pow(fXr, fAlpha - 1.0) * Math.exp(-fXr)) / fLambda, this.GetGamma(fAlpha));
      } else {
        return Math.exp((fAlpha - 1.0) * Math.log(fXr) - fXr - Math.log(fLambda) - this.GetLogGamma(fAlpha));
      }
    } else {
      // fXr near to zero
      if (fAlpha < fMaxGammaArgument) {
        return div_allow_zero((Math.pow(fXr, fAlpha - 1.0) * Math.exp(-fXr)) / fLambda, this.GetGamma(fAlpha));
      } else {
        return (Math.pow(fXr, fAlpha - 1.0) * Math.exp(-fXr)) / fLambda / Math.exp(this.GetLogGamma(fAlpha));
      }
    }
  }
};

/** Gamma distribution, cumulative distribution function.
    fLambda is "scale" parameter
    You must ensure fAlpha>0.0 and fLambda>0.0 */
ScInterpreter.prototype.GetGammaDist = function (this: ScInterpreter, fX: number, fAlpha: number, fLambda: number): number {
  if (fX <= 0.0) return 0.0;
  return this.GetLowRegIGamma(fAlpha, fX / fLambda);
};

// --- interpr3.cxx ---------------------------------------------------------------------------------

interface ScDistFunc {
  GetValue(x: number): number;
}

//  iteration for inverse distributions

/** u*w<0.0 fails for values near zero */
function lcl_HasChangeOfSign(u: number, w: number): boolean {
  return (u < 0.0 && w > 0.0) || (u > 0.0 && w < 0.0);
}

/** Returns the inverse and rConvError. */
function lcl_IterateInverse(rFunction: ScDistFunc, fAx: number, fBx: number): { fVal: number; rConvError: boolean } {
  let rConvError = false;
  const fYEps = 1.0e-307;
  const fXEps = Number.EPSILON;

  //  find enclosing interval

  let fkAx = new KahanSum(fAx);
  let fkBx = new KahanSum(fBx);
  let fAy = rFunction.GetValue(fAx);
  let fBy = rFunction.GetValue(fBx);
  let fTemp: KahanSum;
  let nCount: number;
  for (nCount = 0; nCount < 1000 && !lcl_HasChangeOfSign(fAy, fBy); nCount++) {
    if (Math.abs(fAy) <= Math.abs(fBy)) {
      fTemp = kcopy(fkAx);
      fkAx.add(ksubk(fkAx, fkBx).get() * 2.0);
      if (fkAx.get() < 0.0) fkAx = new KahanSum(0.0);
      fkBx = fTemp;
      fBy = fAy;
      fAy = rFunction.GetValue(fkAx.get());
    } else {
      fTemp = kcopy(fkBx);
      fkBx.add(ksubk(fkBx, fkAx).get() * 2.0);
      fkAx = fTemp;
      fAy = fBy;
      fBy = rFunction.GetValue(fkBx.get());
    }
  }

  fAx = fkAx.get();
  fBx = fkBx.get();
  if (fAy === 0.0) return { fVal: fAx, rConvError };
  if (fBy === 0.0) return { fVal: fBx, rConvError };
  if (!lcl_HasChangeOfSign(fAy, fBy)) {
    rConvError = true;
    return { fVal: 0.0, rConvError };
  }
  // inverse quadric interpolation with additional brackets
  // set three points
  let fPx = fAx;
  let fPy = fAy;
  let fQx = fBx;
  let fQy = fBy;
  let fRx = fAx;
  let fRy = fAy;
  let fSx = 0.5 * (fAx + fBx); // potential next point
  let bHasToInterpolate = true;
  nCount = 0;
  while (nCount < 500 && Math.abs(fRy) > fYEps && fBx - fAx > Math.max(Math.abs(fAx), Math.abs(fBx)) * fXEps) {
    if (bHasToInterpolate) {
      if (fPy !== fQy && fQy !== fRy && fRy !== fPy) {
        fSx = (fPx * fRy * fQy) / (fRy - fPy) / (fQy - fPy) + (fRx * fQy * fPy) / (fQy - fRy) / (fPy - fRy) + (fQx * fPy * fRy) / (fPy - fQy) / (fRy - fQy);
        bHasToInterpolate = fAx < fSx && fSx < fBx; // inside the brackets?
      } else bHasToInterpolate = false;
    }
    if (!bHasToInterpolate) {
      fSx = 0.5 * (fAx + fBx);
      // reset points
      fQx = fBx;
      fQy = fBy;
      bHasToInterpolate = true;
    }
    // shift points for next interpolation
    fPx = fQx;
    fQx = fRx;
    fRx = fSx;
    fPy = fQy;
    fQy = fRy;
    fRy = rFunction.GetValue(fSx);
    // update brackets
    if (lcl_HasChangeOfSign(fAy, fRy)) {
      fBx = fRx;
      fBy = fRy;
    } else {
      fAx = fRx;
      fAy = fRy;
    }
    // if last iteration brought too small advance, then do bisection next
    // time, for safety
    bHasToInterpolate = bHasToInterpolate && Math.abs(fRy) * 2.0 <= Math.abs(fQy);
    ++nCount;
  }
  return { fVal: fRx, rConvError };
}

ScInterpreter.prototype.phi = function (this: ScInterpreter, x: number): number {
  return 0.39894228040143268 * Math.exp(-(x * x) / 2.0);
};

ScInterpreter.prototype.integralPhi = function (this: ScInterpreter, x: number): number {
  // Using gauss(x)+0.5 has severe cancellation errors for x<-4
  return 0.5 * erfc(-x * M_SQRT1_2);
};

ScInterpreter.prototype.taylor = function (this: ScInterpreter, pPolynom: readonly number[], nMax: number, x: number): number {
  let nVal = new KahanSum(pPolynom[nMax]!);
  for (let i = nMax - 1; i >= 0; i--) {
    nVal = new KahanSum(nVal.get() * x);
    nVal.add(pPolynom[i]!);
  }
  return nVal.get();
};

const gauss_t0 = [
  0.39894228040143268, -0.06649038006690545, 0.00997355701003582, -0.00118732821548045, 0.00011543468761616, -0.0000094446562595, 0.00000066596935163, -0.00000004122667415,
  0.00000000227352982, 0.00000000011301172, 0.00000000000511243, -0.00000000000021218,
];
const gauss_t2 = [
  0.47724986805182079, 0.05399096651318805, -0.05399096651318805, 0.02699548325659403, -0.00449924720943234, -0.00224962360471617, 0.0013497741628297, -0.0001178374269137,
  -0.00011515930357476, 0.00003704737285544, 0.00000282690796889, -0.00000354513195524, 0.00000037669563126, 0.00000019202407921, -0.0000000522690859, -0.00000000491799345,
  0.00000000366377919, -0.00000000015981997, -0.00000000017381238, 0.00000000002624031, 0.00000000000560919, -0.00000000000172127, -0.00000000000008634, 0.00000000000007894,
];
const gauss_t4 = [
  0.49996832875816688, 0.00013383022576489, -0.00026766045152977, 0.00033457556441221, -0.00028996548915725, 0.00018178605666397, -0.00008252863922168, 0.00002551802519049,
  -0.00000391665839292, -0.00000074018205222, 0.00000064422023359, -0.0000001737015534, 0.00000000909595465, 0.00000000944943118, -0.00000000329957075, 0.00000000029492075,
  0.00000000011874477, -0.00000000004420396, 0.00000000000361422, 0.00000000000143638, -0.00000000000045848,
];
const gauss_asympt = [-1.0, 1.0, -3.0, 15.0, -105.0];

ScInterpreter.prototype.gauss = function (this: ScInterpreter, x: number): number {
  const xAbs = Math.abs(x);
  const xShort = approxFloor(xAbs) % 65536; // static_cast<sal_uInt16>
  let nVal = 0.0;
  if (xShort === 0) {
    nVal = this.taylor(gauss_t0, 11, xAbs * xAbs) * xAbs;
  } else if (xShort <= 2) {
    nVal = this.taylor(gauss_t2, 23, xAbs - 2.0);
  } else if (xShort <= 4) {
    nVal = this.taylor(gauss_t4, 20, xAbs - 4.0);
  } else {
    nVal = 0.5 + this.phi(xAbs) * div_allow_zero(this.taylor(gauss_asympt, 4, div_allow_zero(1.0, xAbs * xAbs)), xAbs);
  }
  if (x < 0.0) return -nVal;
  return nVal;
};

//  #i26836# new gaussinv implementation by Martin Eitzenberger <m.eitzenberger@unix.net>

ScInterpreter.prototype.gaussinv = function (this: ScInterpreter, x: number): number {
  let t: number, z: number;

  const q = x - 0.5;

  if (Math.abs(q) <= 0.425) {
    t = 0.180625 - q * q;

    z =
      (q *
        (((((((t * 2509.0809287301226727 + 33430.575583588128105) * t + 67265.770927008700853) * t + 45921.953931549871457) * t + 13731.693765509461125) * t + 1971.5909503065514427) * t +
          133.14166789178437745) *
          t +
          3.387132872796366608)) /
      (((((((t * 5226.495278852854561 + 28729.085735721942674) * t + 39307.89580009271061) * t + 21213.794301586595867) * t + 5394.1960214247511077) * t + 687.1870074920579083) * t +
        42.313330701600911252) *
        t +
        1.0);
  } else {
    if (q > 0) t = 1 - x;
    else t = x;

    t = Math.sqrt(-Math.log(t));

    if (t <= 5.0) {
      t += -1.6;

      z =
        (((((((t * 7.7454501427834140764e-4 + 0.0227238449892691845833) * t + 0.24178072517745061177) * t + 1.27045825245236838258) * t + 3.64784832476320460504) * t + 5.7694972214606914055) * t +
          4.6303378461565452959) *
          t +
          1.42343711074968357734) /
        (((((((t * 1.05075007164441684324e-9 + 5.475938084995344946e-4) * t + 0.0151986665636164571966) * t + 0.14810397642748007459) * t + 0.68976733498510000455) * t + 1.6763848301838038494) *
          t +
          2.05319162663775882187) *
          t +
          1.0);
    } else {
      t += -5.0;

      z =
        (((((((t * 2.01033439929228813265e-7 + 2.71155556874348757815e-5) * t + 0.0012426609473880784386) * t + 0.026532189526576123093) * t + 0.29656057182850489123) * t + 1.7848265399172913358) *
          t +
          5.4637849111641143699) *
          t +
          6.6579046435011037772) /
        (((((((t * 2.04426310338993978564e-15 + 1.4215117583164458887e-7) * t + 1.8463183175100546818e-5) * t + 7.868691311456132591e-4) * t + 0.0148753612908506148525) * t +
          0.13692988092273580531) *
          t +
          0.59983220655588793769) *
          t +
          1.0);
    }

    if (q < 0.0) z = -z;
  }

  return z;
};

ScInterpreter.prototype.Fakultaet = function (this: ScInterpreter, x: number): number {
  x = approxFloor(x);
  if (x < 0.0) return 0.0;
  else if (x === 0.0) return 1.0;
  else if (x <= 170.0) {
    let fTemp = x;
    while (fTemp > 2.0) {
      fTemp--;
      x *= fTemp;
    }
  } else this.SetError(FormulaError.NoValue);
  return x;
};

ScInterpreter.prototype.BinomCoeff = function (this: ScInterpreter, n: number, k: number): number {
  // this method has been duplicated as BinomialCoefficient()
  // in scaddins/source/analysis/analysishelper.cxx

  let nVal = 0.0;
  k = approxFloor(k);
  if (n < k) nVal = 0.0;
  else if (k === 0.0) nVal = 1.0;
  else {
    nVal = n / k;
    n--;
    k--;
    while (k > 0.0) {
      nVal *= n / k;
      k--;
      n--;
    }
  }
  return nVal;
};

// The algorithm is based on lanczos13m53 in lanczos.hpp
// in math library from http://www.boost.org
const lanczos_fNum = [
  23531376880.41075968857200767445163675473, 42919803642.64909876895789904700198885093, 35711959237.35566804944018545154716670596, 17921034426.03720969991975575445893111267,
  6039542586.35202800506429164430729792107, 1439720407.311721673663223072794912393972, 248874557.8620541565114603864132294232163, 31426415.58540019438061423162831820536287,
  2876370.628935372441225409051620849613599, 186056.2653952234950402949897160456992822, 8071.672002365816210638002902272250613822, 210.8242777515793458725097339207133627117,
  2.506628274631000270164908177133837338626,
];
const lanczos_fDenom = [0, 39916800, 120543840, 150917976, 105258076, 45995730, 13339535, 2637558, 357423, 32670, 1925, 66, 1];

/** you must ensure fZ>0
    Uses a variant of the Lanczos sum with a rational function. */
function lcl_getLanczosSum(fZ: number): number {
  // Horner scheme
  let fSumNum: number;
  let fSumDenom: number;
  let nI: number;
  if (fZ <= 1.0) {
    fSumNum = lanczos_fNum[12]!;
    fSumDenom = lanczos_fDenom[12]!;
    for (nI = 11; nI >= 0; --nI) {
      fSumNum *= fZ;
      fSumNum += lanczos_fNum[nI]!;
      fSumDenom *= fZ;
      fSumDenom += lanczos_fDenom[nI]!;
    }
  }
  // Cancel down with fZ^12; Horner scheme with reverse coefficients
  else {
    const fZInv = 1 / fZ;
    fSumNum = lanczos_fNum[0]!;
    fSumDenom = lanczos_fDenom[0]!;
    for (nI = 1; nI <= 12; ++nI) {
      fSumNum *= fZInv;
      fSumNum += lanczos_fNum[nI]!;
      fSumDenom *= fZInv;
      fSumDenom += lanczos_fDenom[nI]!;
    }
  }
  return fSumNum / fSumDenom;
}

// The algorithm is based on tgamma in gamma.hpp
// in math library from http://www.boost.org
/** You must ensure fZ>0; fZ>171.624376956302 will overflow. */
function lcl_GetGammaHelper(fZ: number): number {
  let fGamma = lcl_getLanczosSum(fZ);
  const fg = 6.024680040776729583740234375;
  const fZgHelp = fZ + fg - 0.5;
  // avoid intermediate overflow
  const fHalfpower = Math.pow(fZgHelp, fZ / 2 - 0.25);
  fGamma *= fHalfpower;
  fGamma /= Math.exp(fZgHelp);
  fGamma *= fHalfpower;
  if (fZ <= 20.0 && fZ === approxFloor(fZ)) fGamma = rtl_math_round(fGamma);
  return fGamma;
}

// The algorithm is based on tgamma in gamma.hpp
// in math library from http://www.boost.org
/** You must ensure fZ>0 */
function lcl_GetLogGammaHelper(fZ: number): number {
  const fg = 6.024680040776729583740234375;
  const fZgHelp = fZ + fg - 0.5;
  return Math.log(lcl_getLanczosSum(fZ)) + (fZ - 0.5) * Math.log(fZgHelp) - fZgHelp;
}

/** You must ensure non integer arguments for fZ<1 */
ScInterpreter.prototype.GetGamma = function (this: ScInterpreter, fZ: number): number {
  const fLogPi = Math.log(Math.PI);
  const fLogDblMax = Math.log(Number.MAX_VALUE);

  if (fZ > fMaxGammaArgument) {
    this.SetError(FormulaError.IllegalFPOperation);
    return HUGE_VAL;
  }

  if (fZ >= 1.0) return lcl_GetGammaHelper(fZ);

  if (fZ >= 0.5) // shift to x>=1 using Gamma(x)=Gamma(x+1)/x
    return lcl_GetGammaHelper(fZ + 1) / fZ;

  if (fZ >= -0.5) {
    // shift to x>=1, might overflow
    const fLogTest = lcl_GetLogGammaHelper(fZ + 2) - Math.log1p(fZ) - Math.log(Math.abs(fZ));
    if (fLogTest >= fLogDblMax) {
      this.SetError(FormulaError.IllegalFPOperation);
      return HUGE_VAL;
    }
    return lcl_GetGammaHelper(fZ + 2) / (fZ + 1) / fZ;
  }
  // fZ<-0.5
  // Use Euler's reflection formula: gamma(x)= pi/ ( gamma(1-x)*sin(pi*x) )
  const fLogDivisor = lcl_GetLogGammaHelper(1 - fZ) + Math.log(Math.abs(rtl_math_sin(Math.PI * fZ)));
  if (fLogDivisor - fLogPi >= fLogDblMax) // underflow
    return 0.0;

  if (fLogDivisor < 0.0)
    if (fLogPi - fLogDivisor > fLogDblMax) {
      // overflow
      this.SetError(FormulaError.IllegalFPOperation);
      return HUGE_VAL;
    }

  return Math.exp(fLogPi - fLogDivisor) * (rtl_math_sin(Math.PI * fZ) < 0.0 ? -1.0 : 1.0);
};

/** You must ensure fZ>0 */
ScInterpreter.prototype.GetLogGamma = function (this: ScInterpreter, fZ: number): number {
  if (fZ >= fMaxGammaArgument) return lcl_GetLogGammaHelper(fZ);
  if (fZ >= 1.0) return Math.log(lcl_GetGammaHelper(fZ));
  if (fZ >= 0.5) return Math.log(lcl_GetGammaHelper(fZ + 1) / fZ);
  return lcl_GetLogGammaHelper(fZ + 2) - Math.log1p(fZ) - Math.log(fZ);
};

ScInterpreter.prototype.GetFDist = function (this: ScInterpreter, x: number, fF1: number, fF2: number): number {
  const arg = fF2 / (fF2 + fF1 * x);
  const alpha = fF2 / 2.0;
  const beta = fF1 / 2.0;
  return this.GetBetaDist(arg, alpha, beta);
};

ScInterpreter.prototype.GetTDist = function (this: ScInterpreter, T: number, fDF: number, nType: number): number {
  switch (nType) {
    case 1: // 1-tailed T-distribution
      return 0.5 * this.GetBetaDist(fDF / (fDF + T * T), fDF / 2.0, 0.5);
    case 2: // 2-tailed T-distribution
      return this.GetBetaDist(fDF / (fDF + T * T), fDF / 2.0, 0.5);
    case 3: // left-tailed T-distribution (probability density function)
      return Math.pow(1 + (T * T) / fDF, -(fDF + 1) / 2) / (Math.sqrt(fDF) * this.GetBeta(0.5, fDF / 2.0));
    case 4: {
      // left-tailed T-distribution (cumulative distribution function)
      const X = fDF / (T * T + fDF);
      const R = 0.5 * this.GetBetaDist(X, 0.5 * fDF, 0.5);
      return T < 0 ? R : 1 - R;
    }
  }
  this.SetError(FormulaError.IllegalArgument);
  return HUGE_VAL;
};

// for LEGACY.CHIDIST, returns right tail, fDF=degrees of freedom
/** You must ensure fDF>0.0 */
ScInterpreter.prototype.GetChiDist = function (this: ScInterpreter, fX: number, fDF: number): number {
  if (fX <= 0.0) return 1.0; // see ODFF
  return this.GetUpRegIGamma(fDF / 2.0, fX / 2.0);
};

// ready for ODF 1.2
// for ODF CHISQDIST; cumulative distribution function, fDF=degrees of freedom
// returns left tail
/** You must ensure fDF>0.0 */
ScInterpreter.prototype.GetChiSqDistCDF = function (this: ScInterpreter, fX: number, fDF: number): number {
  if (fX <= 0.0) return 0.0; // see ODFF
  return this.GetLowRegIGamma(fDF / 2.0, fX / 2.0);
};

ScInterpreter.prototype.GetChiSqDistPDF = function (this: ScInterpreter, fX: number, fDF: number): number {
  // you must ensure fDF is positive integer
  let fValue: number;
  if (fX <= 0.0) return 0.0; // see ODFF
  if (fDF * fX > 1391000.0) {
    // intermediate invalid values, use log
    fValue = Math.exp((0.5 * fDF - 1) * Math.log(fX * 0.5) - 0.5 * fX - Math.log(2.0) - this.GetLogGamma(0.5 * fDF));
  } else {
    // fDF is small in most cases, we can iterate
    let fCount: number;
    if (fDF % 2.0 < 0.5) {
      // even
      fValue = 0.5;
      fCount = 2.0;
    } else {
      fValue = 1 / Math.sqrt(fX * 2 * Math.PI);
      fCount = 1.0;
    }
    while (fCount < fDF) {
      fValue *= fX / fCount;
      fCount += 2.0;
    }
    if (fX >= 1425.0) // underflow in e^(-x/2)
      fValue = Math.exp(Math.log(fValue) - fX / 2);
    else fValue *= Math.exp(-fX / 2);
  }
  return fValue;
};

ScInterpreter.prototype.ScChiSqDist = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 2, 3)) return;
  let bCumulative: boolean;
  if (nParamCount === 3) bCumulative = this.GetBool();
  else bCumulative = true;
  const fDF = approxFloor(this.GetDouble());
  if (fDF < 1.0) this.PushIllegalArgument();
  else {
    const fX = this.GetDouble();
    if (bCumulative) this.PushDouble(this.GetChiSqDistCDF(fX, fDF));
    else this.PushDouble(this.GetChiSqDistPDF(fX, fDF));
  }
};

ScInterpreter.prototype.ScChiSqDist_MS = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 3, 3)) return;
  const bCumulative = this.GetBool();
  const fDF = approxFloor(this.GetDouble());
  if (fDF < 1.0 || fDF > 1e10) this.PushIllegalArgument();
  else {
    const fX = this.GetDouble();
    if (fX < 0) this.PushIllegalArgument();
    else {
      if (bCumulative) this.PushDouble(this.GetChiSqDistCDF(fX, fDF));
      else this.PushDouble(this.GetChiSqDistPDF(fX, fDF));
    }
  }
};

ScInterpreter.prototype.ScGamma = function (this: ScInterpreter): void {
  const x = this.GetDouble();
  if (x <= 0.0 && x === approxFloor(x)) this.PushIllegalArgument();
  else {
    const fResult = this.GetGamma(x);
    if (this.nGlobalError !== FormulaError.NONE) {
      this.PushError(this.nGlobalError);
      return;
    }
    this.PushDouble(fResult);
  }
};

ScInterpreter.prototype.ScLogGamma = function (this: ScInterpreter): void {
  const x = this.GetDouble();
  if (x > 0.0) // constraint from ODFF
    this.PushDouble(this.GetLogGamma(x));
  else this.PushIllegalArgument();
};

ScInterpreter.prototype.GetBeta = function (this: ScInterpreter, fAlpha: number, fBeta: number): number {
  let fA: number;
  let fB: number;
  if (fAlpha > fBeta) {
    fA = fAlpha;
    fB = fBeta;
  } else {
    fA = fBeta;
    fB = fAlpha;
  }
  if (fA + fB < fMaxGammaArgument) // simple case
    return div_allow_zero(this.GetGamma(fA), this.GetGamma(fA + fB)) * this.GetGamma(fB);
  // need logarithm
  // GetLogGamma is not accurate enough, back to Lanczos for all three
  // GetGamma and arrange factors newly.
  const fg = 6.024680040776729583740234375; //see GetGamma
  const fgm = fg - 0.5;
  let fLanczos = lcl_getLanczosSum(fA);
  fLanczos /= lcl_getLanczosSum(fA + fB);
  fLanczos *= lcl_getLanczosSum(fB);
  const fABgm = fA + fB + fgm;
  fLanczos *= Math.sqrt(fABgm / (fA + fgm) / (fB + fgm));
  const fTempA = fB / (fA + fgm); // (fA+fgm)/fABgm = 1 / ( 1 + fB/(fA+fgm))
  const fTempB = fA / (fB + fgm);
  let fResult = Math.exp(-fA * Math.log1p(fTempA) - fB * Math.log1p(fTempB) - fgm);
  fResult *= fLanczos;
  return fResult;
};

// Same as GetBeta but with logarithm
ScInterpreter.prototype.GetLogBeta = function (this: ScInterpreter, fAlpha: number, fBeta: number): number {
  let fA: number;
  let fB: number;
  if (fAlpha > fBeta) {
    fA = fAlpha;
    fB = fBeta;
  } else {
    fA = fBeta;
    fB = fAlpha;
  }
  const fg = 6.024680040776729583740234375; //see GetGamma
  const fgm = fg - 0.5;
  let fLanczos = lcl_getLanczosSum(fA);
  fLanczos /= lcl_getLanczosSum(fA + fB);
  fLanczos *= lcl_getLanczosSum(fB);
  let fLogLanczos = Math.log(fLanczos);
  const fABgm = fA + fB + fgm;
  fLogLanczos += 0.5 * (Math.log(fABgm) - Math.log(fA + fgm) - Math.log(fB + fgm));
  const fTempA = fB / (fA + fgm); // (fA+fgm)/fABgm = 1 / ( 1 + fB/(fA+fgm))
  const fTempB = fA / (fB + fgm);
  let fResult = -fA * Math.log1p(fTempA) - fB * Math.log1p(fTempB) - fgm;
  fResult += fLogLanczos;
  return fResult;
};

// beta distribution probability density function
ScInterpreter.prototype.GetBetaDistPDF = function (this: ScInterpreter, fX: number, fA: number, fB: number): number {
  // special cases
  if (fA === 1.0) {
    // result b*(1-x)^(b-1)
    if (fB === 1.0) return 1.0;
    if (fB === 2.0) return -2.0 * fX + 2.0;
    if (fX === 1.0 && fB < 1.0) {
      this.SetError(FormulaError.IllegalArgument);
      return HUGE_VAL;
    }
    if (fX <= 0.01) return fB + fB * Math.expm1((fB - 1.0) * Math.log1p(-fX));
    return fB * Math.pow(0.5 - fX + 0.5, fB - 1.0);
  }
  if (fB === 1.0) {
    // result a*x^(a-1)
    if (fA === 2.0) return fA * fX;
    if (fX === 0.0 && fA < 1.0) {
      this.SetError(FormulaError.IllegalArgument);
      return HUGE_VAL;
    }
    return fA * Math.pow(fX, fA - 1);
  }
  if (fX <= 0.0) {
    if (fA < 1.0 && fX === 0.0) {
      this.SetError(FormulaError.IllegalArgument);
      return HUGE_VAL;
    }
    return 0.0;
  }
  if (fX >= 1.0) {
    if (fB < 1.0 && fX === 1.0) {
      this.SetError(FormulaError.IllegalArgument);
      return HUGE_VAL;
    }
    return 0.0;
  }

  // normal cases; result x^(a-1)*(1-x)^(b-1)/Beta(a,b)
  const fLogDblMax = Math.log(Number.MAX_VALUE);
  const fLogDblMin = Math.log(DBL_MIN);
  const fLogY = fX < 0.1 ? Math.log1p(-fX) : Math.log(0.5 - fX + 0.5);
  const fLogX = Math.log(fX);
  const fAm1LogX = (fA - 1.0) * fLogX;
  const fBm1LogY = (fB - 1.0) * fLogY;
  const fLogBeta = this.GetLogBeta(fA, fB);
  // check whether parts over- or underflow
  if (
    fAm1LogX < fLogDblMax && fAm1LogX > fLogDblMin &&
    fBm1LogY < fLogDblMax && fBm1LogY > fLogDblMin &&
    fLogBeta < fLogDblMax && fLogBeta > fLogDblMin &&
    fAm1LogX + fBm1LogY < fLogDblMax && fAm1LogX + fBm1LogY > fLogDblMin
  )
    return (Math.pow(fX, fA - 1.0) * Math.pow(0.5 - fX + 0.5, fB - 1.0)) / this.GetBeta(fA, fB);
  // need logarithm;
  // might overflow as a whole, but seldom, not worth to pre-detect it
  return Math.exp(fAm1LogX + fBm1LogY - fLogBeta);
};

/*
                x^a * (1-x)^b
    I_x(a,b) = ----------------  * result of ContFrac
                a * Beta(a,b)
*/
function lcl_GetBetaHelperContFrac(fX: number, fA: number, fB: number): number {
  // like old version
  let a1: number, b1: number, a2: number, b2: number, fnorm: number, cfnew: number, cf: number;
  a1 = 1.0;
  b1 = 1.0;
  b2 = 1.0 - ((fA + fB) / (fA + 1.0)) * fX;
  if (b2 === 0.0) {
    a2 = 0.0;
    fnorm = 1.0;
    cf = 1.0;
  } else {
    a2 = 1.0;
    fnorm = 1.0 / b2;
    cf = a2 * fnorm;
  }
  cfnew = 1.0;
  let rm = 1.0;

  const fMaxIter = 50000.0;
  // loop security, normal cases converge in less than 100 iterations.
  // FIXME: You will get so much iterations for fX near mean,
  // I do not know a better algorithm.
  let bfinished = false;
  do {
    const apl2m = fA + 2.0 * rm;
    const d2m = (rm * (fB - rm) * fX) / ((apl2m - 1.0) * apl2m);
    const d2m1 = (-(fA + rm) * (fA + fB + rm) * fX) / (apl2m * (apl2m + 1.0));
    a1 = (a2 + d2m * a1) * fnorm;
    b1 = (b2 + d2m * b1) * fnorm;
    a2 = a1 + d2m1 * a2 * fnorm;
    b2 = b1 + d2m1 * b2 * fnorm;
    if (b2 !== 0.0) {
      fnorm = 1.0 / b2;
      cfnew = a2 * fnorm;
      bfinished = Math.abs(cf - cfnew) < Math.abs(cf) * fMachEps;
    }
    cf = cfnew;
    rm += 1.0;
  } while (rm < fMaxIter && !bfinished);
  return cf;
}

// cumulative distribution function, normalized
ScInterpreter.prototype.GetBetaDist = function (this: ScInterpreter, fXin: number, fAlpha: number, fBeta: number): number {
  // special cases
  if (fXin <= 0.0) // values are valid, see spec
    return 0.0;
  if (fXin >= 1.0) // values are valid, see spec
    return 1.0;
  if (fBeta === 1.0) return Math.pow(fXin, fAlpha);
  if (fAlpha === 1.0)
    //            1.0 - pow(1.0-fX,fBeta) is not accurate enough
    return -Math.expm1(fBeta * Math.log1p(-fXin));
  //FIXME: need special algorithm for fX near fP for large fA,fB
  let fResult: number;
  // I use always continued fraction, power series are neither
  // faster nor more accurate.
  let fY = 0.5 - fXin + 0.5;
  let flnY = Math.log1p(-fXin);
  let fX = fXin;
  let flnX = Math.log(fXin);
  let fA = fAlpha;
  let fB = fBeta;
  const bReflect = fXin > fAlpha / (fAlpha + fBeta);
  if (bReflect) {
    fA = fBeta;
    fB = fAlpha;
    fX = fY;
    fY = fXin;
    flnX = flnY;
    flnY = Math.log(fXin);
  }
  fResult = lcl_GetBetaHelperContFrac(fX, fA, fB);
  fResult = fResult / fA;
  const fP = fA / (fA + fB);
  const fQ = fB / (fA + fB);
  let fTemp: number;
  if (fA > 1.0 && fB > 1.0 && fP < 0.97 && fQ < 0.97) //found experimental
    fTemp = this.GetBetaDistPDF(fX, fA, fB) * fX * fY;
  else fTemp = Math.exp(fA * flnX + fB * flnY - this.GetLogBeta(fA, fB));
  fResult *= fTemp;
  if (bReflect) fResult = 0.5 - fResult + 0.5;
  if (fResult > 1.0) // ensure valid range
    fResult = 1.0;
  if (fResult < 0.0) fResult = 0.0;
  return fResult;
};

ScInterpreter.prototype.ScBetaDist = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 3, 6)) // expanded, see #i91547#
    return;
  let fLowerBound: number, fUpperBound: number;
  let x: number;
  let bIsCumulative: boolean;
  if (nParamCount === 6) bIsCumulative = this.GetBool();
  else bIsCumulative = true;
  if (nParamCount >= 5) fUpperBound = this.GetDouble();
  else fUpperBound = 1.0;
  if (nParamCount >= 4) fLowerBound = this.GetDouble();
  else fLowerBound = 0.0;
  const beta = this.GetDouble();
  const alpha = this.GetDouble();
  x = this.GetDouble();
  const fScale = fUpperBound - fLowerBound;
  if (fScale <= 0.0 || alpha <= 0.0 || beta <= 0.0) {
    this.PushIllegalArgument();
    return;
  }
  if (bIsCumulative) {
    // cumulative distribution function
    // special cases
    if (x < fLowerBound) {
      this.PushDouble(0.0);
      return; //see spec
    }
    if (x > fUpperBound) {
      this.PushDouble(1.0);
      return; //see spec
    }
    // normal cases
    x = (x - fLowerBound) / fScale; // convert to standard form
    this.PushDouble(this.GetBetaDist(x, alpha, beta));
    return;
  } else {
    // probability density function
    if (x < fLowerBound || x > fUpperBound) {
      this.PushDouble(0.0);
      return;
    }
    x = (x - fLowerBound) / fScale;
    this.PushDouble(this.GetBetaDistPDF(x, alpha, beta) / fScale);
    return;
  }
};

/**
  Microsoft version has parameters in different order
  Also, upper and lowerbound are optional and have default values
  and different constraints apply.
  Basically, function is identical with ScInterpreter::ScBetaDist()
*/
ScInterpreter.prototype.ScBetaDist_MS = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 4, 6)) return;
  let fLowerBound: number, fUpperBound: number;
  let x: number;
  if (nParamCount === 6) fUpperBound = this.GetDouble();
  else fUpperBound = 1.0;
  if (nParamCount >= 5) fLowerBound = this.GetDouble();
  else fLowerBound = 0.0;
  const bIsCumulative = this.GetBool();
  const beta = this.GetDouble();
  const alpha = this.GetDouble();
  x = this.GetDouble();
  if (alpha <= 0.0 || beta <= 0.0 || x < fLowerBound || x > fUpperBound) {
    this.PushIllegalArgument();
    return;
  }
  const fScale = fUpperBound - fLowerBound;
  if (bIsCumulative) {
    // cumulative distribution function
    x = (x - fLowerBound) / fScale; // convert to standard form
    this.PushDouble(this.GetBetaDist(x, alpha, beta));
    return;
  } else {
    // probability density function
    x = (x - fLowerBound) / fScale;
    this.PushDouble(this.GetBetaDistPDF(x, alpha, beta) / fScale);
    return;
  }
};

ScInterpreter.prototype.ScPhi = function (this: ScInterpreter): void {
  this.PushDouble(this.phi(this.GetDouble()));
};

ScInterpreter.prototype.ScGauss = function (this: ScInterpreter): void {
  this.PushDouble(this.gauss(this.GetDouble()));
};

ScInterpreter.prototype.ScFisher = function (this: ScInterpreter): void {
  const fVal = this.GetDouble();
  if (Math.abs(fVal) >= 1.0) this.PushIllegalArgument();
  else this.PushDouble(Math.atanh(fVal));
};

ScInterpreter.prototype.ScFisherInv = function (this: ScInterpreter): void {
  this.PushDouble(Math.tanh(this.GetDouble()));
};

ScInterpreter.prototype.ScFact = function (this: ScInterpreter): void {
  const nVal = this.GetDouble();
  if (nVal < 0.0) this.PushIllegalArgument();
  else this.PushDouble(this.Fakultaet(nVal));
};

ScInterpreter.prototype.ScCombin = function (this: ScInterpreter): void {
  if (this.MustHaveParamCount(this.GetByte(), 2)) {
    const k = approxFloor(this.GetDouble());
    const n = approxFloor(this.GetDouble());
    if (k < 0.0 || n < 0.0 || k > n) this.PushIllegalArgument();
    else this.PushDouble(this.BinomCoeff(n, k));
  }
};

ScInterpreter.prototype.ScCombinA = function (this: ScInterpreter): void {
  if (this.MustHaveParamCount(this.GetByte(), 2)) {
    const k = approxFloor(this.GetDouble());
    const n = approxFloor(this.GetDouble());
    if (k < 0.0 || n < 0.0 || k > n) this.PushIllegalArgument();
    else this.PushDouble(this.BinomCoeff(n + k - 1, k));
  }
};

ScInterpreter.prototype.ScPermut = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 2)) return;

  const k = approxFloor(this.GetDouble());
  const n = approxFloor(this.GetDouble());
  if (n < 0.0 || k < 0.0 || k > n) this.PushIllegalArgument();
  else if (k === 0.0) this.PushInt(1); // (n! / (n - 0)!) == 1
  else {
    let nVal = n;
    for (let i = k - 1; i >= 1; i--) nVal *= n - i;
    this.PushDouble(nVal);
  }
};

ScInterpreter.prototype.ScPermutationA = function (this: ScInterpreter): void {
  if (this.MustHaveParamCount(this.GetByte(), 2)) {
    const k = approxFloor(this.GetDouble());
    const n = approxFloor(this.GetDouble());
    if (n < 0.0 || k < 0.0) this.PushIllegalArgument();
    else this.PushDouble(Math.pow(n, k));
  }
};

// used in ScB and ScBinomDist
// preconditions: 0.0 <= x <= n, 0.0 < p < 1.0;  x,n integral although double
ScInterpreter.prototype.GetBinomDistPMF = function (this: ScInterpreter, x: number, n: number, p: number): number {
  const q = 0.5 - p + 0.5;
  let fFactor = Math.pow(q, n);
  if (fFactor <= DBL_MIN) {
    fFactor = Math.pow(p, n);
    if (fFactor <= DBL_MIN) return this.GetBetaDistPDF(p, x + 1.0, n - x + 1.0) / (n + 1.0);
    else {
      const max = Math.trunc(n - x);
      for (let i = 0; i < max && fFactor > 0.0; i++) fFactor *= ((n - i) / (i + 1)) * (q / p);
      return fFactor;
    }
  } else {
    const max = Math.trunc(x);
    for (let i = 0; i < max && fFactor > 0.0; i++) fFactor *= ((n - i) / (i + 1)) * (p / q);
    return fFactor;
  }
};

//preconditions: 0.0 <= xs < xe <= n; xs,xe,n integral although double
function lcl_GetBinomDistRange(n: number, xs: number, xe: number, fFactor: number /* q^n */, p: number, q: number): number {
  let i: number;
  // skip summands index 0 to xs-1, start sum with index xs
  const nXs = Math.trunc(xs);
  for (i = 1; i <= nXs && fFactor > 0.0; i++) fFactor *= ((n - i + 1) / i) * (p / q);
  const fSum = new KahanSum(fFactor); // Summand xs
  const nXe = Math.trunc(xe);
  for (i = nXs + 1; i <= nXe && fFactor > 0.0; i++) {
    fFactor *= ((n - i + 1) / i) * (p / q);
    fSum.add(fFactor);
  }
  return Math.min(fSum.get(), 1.0);
}

ScInterpreter.prototype.ScB = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 3, 4)) return;
  if (nParamCount === 3) {
    // mass function
    const x = approxFloor(this.GetDouble());
    const p = this.GetDouble();
    const n = approxFloor(this.GetDouble());
    if (n < 0.0 || x < 0.0 || x > n || p < 0.0 || p > 1.0) this.PushIllegalArgument();
    else if (p === 0.0) this.PushDouble(x === 0.0 ? 1.0 : 0.0);
    else if (p === 1.0) this.PushDouble(x === n ? 1.0 : 0.0);
    else this.PushDouble(this.GetBinomDistPMF(x, n, p));
  } else {
    // nParamCount == 4
    const xe = approxFloor(this.GetDouble());
    const xs = approxFloor(this.GetDouble());
    const p = this.GetDouble();
    const n = approxFloor(this.GetDouble());
    const q = 0.5 - p + 0.5;
    const bIsValidX = 0.0 <= xs && xs <= xe && xe <= n;
    if (bIsValidX && 0.0 < p && p < 1.0) {
      if (xs === xe) // mass function
        this.PushDouble(this.GetBinomDistPMF(xs, n, p));
      else {
        let fFactor = Math.pow(q, n);
        if (fFactor > DBL_MIN) this.PushDouble(lcl_GetBinomDistRange(n, xs, xe, fFactor, p, q));
        else {
          fFactor = Math.pow(p, n);
          if (fFactor > DBL_MIN) {
            // sum from j=xs to xe {(n choose j) * p^j * q^(n-j)}
            // = sum from i = n-xe to n-xs { (n choose i) * q^i * p^(n-i)}
            this.PushDouble(lcl_GetBinomDistRange(n, n - xe, n - xs, fFactor, q, p));
          } else this.PushDouble(this.GetBetaDist(q, n - xe, xe + 1.0) - this.GetBetaDist(q, n - xs + 1, xs));
        }
      }
    } else {
      if (bIsValidX) {
        // not(0<p<1)
        if (p === 0.0) this.PushDouble(xs === 0.0 ? 1.0 : 0.0);
        else if (p === 1.0) this.PushDouble(xe === n ? 1.0 : 0.0);
        else this.PushIllegalArgument();
      } else this.PushIllegalArgument();
    }
  }
};

ScInterpreter.prototype.ScBinomDist = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 4)) return;

  const bIsCum = this.GetBool(); // false=mass function; true=cumulative
  const p = this.GetDouble();
  const n = approxFloor(this.GetDouble());
  const x = approxFloor(this.GetDouble());
  const q = 0.5 - p + 0.5; // get one bit more for p near 1.0
  if (n < 0.0 || x < 0.0 || x > n || p < 0.0 || p > 1.0) {
    this.PushIllegalArgument();
    return;
  }
  if (p === 0.0) {
    this.PushDouble(x === 0.0 || bIsCum ? 1.0 : 0.0);
    return;
  }
  if (p === 1.0) {
    this.PushDouble(x === n ? 1.0 : 0.0);
    return;
  }
  if (!bIsCum) this.PushDouble(this.GetBinomDistPMF(x, n, p));
  else {
    if (x === n) this.PushDouble(1.0);
    else {
      let fFactor = Math.pow(q, n);
      if (x === 0.0) this.PushDouble(fFactor);
      else if (fFactor <= DBL_MIN) {
        fFactor = Math.pow(p, n);
        if (fFactor <= DBL_MIN) this.PushDouble(this.GetBetaDist(q, n - x, x + 1.0));
        else {
          if (fFactor > fMachEps) {
            let fSum = 1.0 - fFactor;
            const max = Math.trunc(n - x) - 1;
            for (let i = 0; i < max && fFactor > 0.0; i++) {
              fFactor *= ((n - i) / (i + 1)) * (q / p);
              fSum -= fFactor;
            }
            this.PushDouble(fSum < 0.0 ? 0.0 : fSum);
          } else this.PushDouble(lcl_GetBinomDistRange(n, n - x, n, fFactor, q, p));
        }
      } else this.PushDouble(lcl_GetBinomDistRange(n, 0.0, x, fFactor, p, q));
    }
  }
};

ScInterpreter.prototype.ScCritBinom = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 3)) return;

  let alpha = this.GetDouble();
  const p = this.GetDouble();
  const n = approxFloor(this.GetDouble());
  if (n < 0.0 || alpha < 0.0 || alpha > 1.0 || p < 0.0 || p > 1.0) this.PushIllegalArgument();
  else if (alpha === 0.0) this.PushDouble(0.0);
  else if (alpha === 1.0) this.PushDouble(p === 0 ? 0.0 : n);
  else {
    let fFactor: number;
    const q = 0.5 - p + 0.5; // get one bit more for p near 1.0
    if (q > p) {
      // work from the side where the cumulative curve is
      // work from 0 upwards
      fFactor = Math.pow(q, n);
      if (fFactor > DBL_MIN) {
        const fSum = new KahanSum(fFactor);
        const max = Math.trunc(n);
        let i: number;
        for (i = 0; i < max && fSum.get() < alpha; i++) {
          fFactor *= ((n - i) / (i + 1)) * (p / q);
          fSum.add(fFactor);
        }
        this.PushDouble(i);
      } else {
        // accumulate BinomDist until accumulated BinomDist reaches alpha
        const fSum = new KahanSum(0.0);
        const max = Math.trunc(n);
        let i: number;
        for (i = 0; i < max && fSum.get() < alpha; i++) {
          const x = this.GetBetaDistPDF(p, i + 1, n - i + 1) / (n + 1);
          if (this.nGlobalError === FormulaError.NONE) fSum.add(x);
          else {
            this.PushNoValue();
            return;
          }
        }
        this.PushDouble(i - 1);
      }
    } else {
      // work from n backwards
      fFactor = Math.pow(p, n);
      if (fFactor > DBL_MIN) {
        const fSum = new KahanSum(1.0 - fFactor);
        const max = Math.trunc(n);
        let i: number;
        for (i = 0; i < max && fSum.get() >= alpha; i++) {
          fFactor *= ((n - i) / (i + 1)) * (q / p);
          fSum.add(-fFactor);
        }
        this.PushDouble(n - i);
      } else {
        // accumulate BinomDist until accumulated BinomDist reaches alpha
        const fSum = new KahanSum(0.0);
        const max = Math.trunc(n);
        let i: number;
        alpha = 1 - alpha;
        for (i = 0; i < max && fSum.get() < alpha; i++) {
          const x = this.GetBetaDistPDF(q, i + 1, n - i + 1) / (n + 1);
          if (this.nGlobalError === FormulaError.NONE) fSum.add(x);
          else {
            this.PushNoValue();
            return;
          }
        }
        this.PushDouble(n - i + 1);
      }
    }
  }
};

ScInterpreter.prototype.ScNegBinomDist = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 3)) return;

  const p = this.GetDouble(); // probability
  const s = approxFloor(this.GetDouble()); // No of successes
  const f = approxFloor(this.GetDouble()); // No of failures
  if (f + s <= 1.0 || p < 0.0 || p > 1.0) this.PushIllegalArgument();
  else {
    const q = 1.0 - p;
    let fFactor = Math.pow(p, s);
    for (let i = 0.0; i < f; i++) fFactor *= ((i + s) / (i + 1.0)) * q;
    this.PushDouble(fFactor);
  }
};

ScInterpreter.prototype.ScNegBinomDist_MS = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 4)) return;

  const bCumulative = this.GetBool();
  const p = this.GetDouble(); // probability
  const s = approxFloor(this.GetDouble()); // No of successes
  const f = approxFloor(this.GetDouble()); // No of failures
  if (s < 1.0 || f < 0.0 || p < 0.0 || p > 1.0) this.PushIllegalArgument();
  else {
    const q = 1.0 - p;
    if (bCumulative) this.PushDouble(1.0 - this.GetBetaDist(q, f + 1, s));
    else {
      let fFactor = Math.pow(p, s);
      for (let i = 0.0; i < f; i++) fFactor *= ((i + s) / (i + 1.0)) * q;
      this.PushDouble(fFactor);
    }
  }
};

ScInterpreter.prototype.ScNormDist = function (this: ScInterpreter, nMinParamCount: number): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, nMinParamCount, 4)) return;
  const bCumulative = nParamCount !== 4 || this.GetBool();
  const sigma = this.GetDouble(); // standard deviation
  const mue = this.GetDouble(); // mean
  const x = this.GetDouble(); // x
  if (sigma <= 0.0) {
    this.PushIllegalArgument();
    return;
  }
  if (bCumulative) this.PushDouble(this.integralPhi((x - mue) / sigma));
  else this.PushDouble(this.phi((x - mue) / sigma) / sigma);
};

ScInterpreter.prototype.ScLogNormDist = function (this: ScInterpreter, nMinParamCount: number): void {
  //expanded, see #i100119# and fdo72158
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, nMinParamCount, 4)) return;
  const bCumulative = nParamCount !== 4 || this.GetBool(); // cumulative
  const sigma = nParamCount >= 3 ? this.GetDouble() : 1.0; // standard deviation
  const mue = nParamCount >= 2 ? this.GetDouble() : 0.0; // mean
  const x = this.GetDouble(); // x
  if (sigma <= 0.0) {
    this.PushIllegalArgument();
    return;
  }
  if (bCumulative) {
    // cumulative
    if (x <= 0.0) this.PushDouble(0.0);
    else this.PushDouble(this.integralPhi((Math.log(x) - mue) / sigma));
  } else {
    // density
    if (x <= 0.0) this.PushIllegalArgument();
    else this.PushDouble(this.phi((Math.log(x) - mue) / sigma) / sigma / x);
  }
};

ScInterpreter.prototype.ScStdNormDist = function (this: ScInterpreter): void {
  this.PushDouble(this.integralPhi(this.GetDouble()));
};

ScInterpreter.prototype.ScStdNormDist_MS = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 2)) return;
  const bCumulative = this.GetBool(); // cumulative
  const x = this.GetDouble(); // x

  if (bCumulative) this.PushDouble(this.integralPhi(x));
  else this.PushDouble(Math.exp(-Math.pow(x, 2) / 2) / Math.sqrt(2 * Math.PI));
};

ScInterpreter.prototype.ScExpDist = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 3)) return;

  const kum = this.GetDouble(); // 0 or 1
  const lambda = this.GetDouble(); // lambda
  const x = this.GetDouble(); // x
  if (lambda <= 0.0) this.PushIllegalArgument();
  else if (kum === 0.0) {
    // density
    if (x >= 0.0) this.PushDouble(lambda * Math.exp(-lambda * x));
    else this.PushInt(0);
  } else {
    // distribution
    if (x > 0.0) this.PushDouble(1.0 - Math.exp(-lambda * x));
    else this.PushInt(0);
  }
};

ScInterpreter.prototype.ScTDist = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 3)) return;
  const fFlag = approxFloor(this.GetDouble());
  const fDF = approxFloor(this.GetDouble());
  const T = this.GetDouble();
  if (fDF < 1.0 || T < 0.0 || (fFlag !== 1.0 && fFlag !== 2.0)) {
    this.PushIllegalArgument();
    return;
  }
  this.PushDouble(this.GetTDist(T, fDF, Math.trunc(fFlag)));
};

ScInterpreter.prototype.ScTDist_T = function (this: ScInterpreter, nTails: number): void {
  if (!this.MustHaveParamCount(this.GetByte(), 2)) return;
  const fDF = approxFloor(this.GetDouble());
  const fT = this.GetDouble();
  if (fDF < 1.0 || (nTails === 2 && fT < 0.0)) {
    this.PushIllegalArgument();
    return;
  }
  const fRes = this.GetTDist(fT, fDF, nTails);
  if (nTails === 1 && fT < 0.0) this.PushDouble(1.0 - fRes); // tdf#105937, right tail, negative X
  else this.PushDouble(fRes);
};

ScInterpreter.prototype.ScTDist_MS = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 3)) return;
  const bCumulative = this.GetBool();
  const fDF = approxFloor(this.GetDouble());
  const T = this.GetDouble();
  if (fDF < 1.0) {
    this.PushIllegalArgument();
    return;
  }
  this.PushDouble(this.GetTDist(T, fDF, bCumulative ? 4 : 3));
};

ScInterpreter.prototype.ScFDist = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 3)) return;
  const fF2 = approxFloor(this.GetDouble());
  const fF1 = approxFloor(this.GetDouble());
  const fF = this.GetDouble();
  if (fF < 0.0 || fF1 < 1.0 || fF2 < 1.0 || fF1 >= 1.0e10 || fF2 >= 1.0e10) {
    this.PushIllegalArgument();
    return;
  }
  this.PushDouble(this.GetFDist(fF, fF1, fF2));
};

ScInterpreter.prototype.ScFDist_LT = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 3, 4)) return;
  let bCum: boolean;
  if (nParamCount === 3) bCum = true;
  else if (this.IsMissing()) {
    bCum = true;
    this.Pop();
  } else bCum = this.GetBool();
  const fF2 = approxFloor(this.GetDouble());
  const fF1 = approxFloor(this.GetDouble());
  const fF = this.GetDouble();
  if (fF < 0.0 || fF1 < 1.0 || fF2 < 1.0 || fF1 >= 1.0e10 || fF2 >= 1.0e10) {
    this.PushIllegalArgument();
    return;
  }
  if (bCum) {
    // left tail cumulative distribution
    this.PushDouble(1.0 - this.GetFDist(fF, fF1, fF2));
  } else {
    // probability density function
    this.PushDouble((Math.pow(fF1 / fF2, fF1 / 2) * Math.pow(fF, fF1 / 2 - 1)) / (Math.pow(1 + (fF * fF1) / fF2, (fF1 + fF2) / 2) * this.GetBeta(fF1 / 2, fF2 / 2)));
  }
};

ScInterpreter.prototype.ScChiDist = function (this: ScInterpreter, bODFF: boolean): void {
  if (!this.MustHaveParamCount(this.GetByte(), 2)) return;
  const fDF = approxFloor(this.GetDouble());
  const fChi = this.GetDouble();
  if (
    fDF < 1.0 || // x<=0 returns 1, see ODFF1.2 6.18.11
    (!bODFF && fChi < 0) // Excel does not accept negative fChi
  ) {
    this.PushIllegalArgument();
    return;
  }
  const fResult = this.GetChiDist(fChi, fDF);
  if (this.nGlobalError !== FormulaError.NONE) {
    this.PushError(this.nGlobalError);
    return;
  }
  this.PushDouble(fResult);
};

ScInterpreter.prototype.ScWeibull = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 4)) return;

  const kum = this.GetDouble(); // 0 or 1
  const beta = this.GetDouble(); // beta
  const alpha = this.GetDouble(); // alpha
  const x = this.GetDouble(); // x
  if (alpha <= 0.0 || beta <= 0.0 || x < 0.0) this.PushIllegalArgument();
  else if (kum === 0.0) // Density
    this.PushDouble((alpha / Math.pow(beta, alpha)) * Math.pow(x, alpha - 1.0) * Math.exp(-Math.pow(x / beta, alpha)));
  // Distribution
  else this.PushDouble(1.0 - Math.exp(-Math.pow(x / beta, alpha)));
};

ScInterpreter.prototype.ScPoissonDist = function (this: ScInterpreter, bODFF: boolean): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, bODFF ? 2 : 3, 3)) return;

  const bCumulative = nParamCount !== 3 || this.GetBool(); // default cumulative
  const lambda = this.GetDouble(); // Mean
  const x = approxFloor(this.GetDouble()); // discrete distribution
  if (lambda <= 0.0 || x < 0.0) this.PushIllegalArgument();
  else if (!bCumulative) {
    // Probability mass function
    if (lambda > 712.0) {
      // underflow in exp(-lambda)
      // accuracy 11 Digits
      this.PushDouble(Math.exp(x * Math.log(lambda) - lambda - this.GetLogGamma(x + 1.0)));
    } else {
      let fPoissonVar = 1.0;
      for (let f = 0.0; f < x; ++f) fPoissonVar *= lambda / (f + 1.0);
      this.PushDouble(fPoissonVar * Math.exp(-lambda));
    }
  } else {
    // Cumulative distribution function
    if (lambda > 712.0) {
      // underflow in exp(-lambda)
      // accuracy 12 Digits
      this.PushDouble(this.GetUpRegIGamma(x + 1.0, lambda));
    } else {
      if (x >= 936.0) // result is always indistinguishable from 1
        this.PushDouble(1.0);
      else {
        let fSummand = Math.exp(-lambda);
        const fSum = new KahanSum(fSummand);
        const nEnd = Math.trunc(x);
        for (let i = 1; i <= nEnd; i++) {
          fSummand = (fSummand * lambda) / i;
          fSum.add(fSummand);
        }
        this.PushDouble(fSum.get());
      }
    }
  }
};

/** Local function used in the calculation of the hypergeometric distribution.
 */
function lcl_PutFactorialElements(cn: number[], fLower: number, fUpper: number, fBase: number): void {
  for (let i = fLower; i <= fUpper; ++i) {
    const fVal = fBase - i;
    if (fVal > 1.0) cn.push(fVal);
  }
}

/** Calculates a value of the hypergeometric distribution.

    @see #i47296#

    This function has an extra argument bCumulative,
    which only calculates the non-cumulative distribution and
    which is optional in Calc and mandatory with Excel's HYPGEOM.DIST()

    @see fdo#71722
    @see tdf#102948, make Calc function ODFF1.2-compliant
    @see tdf#117041, implement note at bottom of ODFF1.2 par.6.18.37
 */
ScInterpreter.prototype.ScHypGeomDist = function (this: ScInterpreter, nMinParamCount: number): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, nMinParamCount, 5)) return;

  const bCumulative = nParamCount === 5 && this.GetBool();
  const N = approxFloor(this.GetDouble());
  const M = approxFloor(this.GetDouble());
  const n = approxFloor(this.GetDouble());
  const x = approxFloor(this.GetDouble());

  if (x < 0.0 || n < x || N < n || N < M || M < 0.0) {
    this.PushIllegalArgument();
    return;
  }

  const fVal = new KahanSum(0.0);

  for (let i = bCumulative ? 0 : Math.trunc(x); i <= x && this.nGlobalError === FormulaError.NONE; i++) {
    if (n - i <= N - M && i <= M) fVal.add(this.GetHypGeomDist(i, n, M, N));
  }

  this.PushDouble(fVal.get());
};

/** Calculates a value of the hypergeometric distribution.

    The algorithm is designed to avoid unnecessary multiplications and division
    by expanding all factorial elements (9 of them).  It is done by excluding
    those ranges that overlap in the numerator and the denominator.  This allows
    for a fast calculation for large values which would otherwise cause an overflow
    in the intermediate values.

    @see #i47296#
 */
ScInterpreter.prototype.GetHypGeomDist = function (this: ScInterpreter, x: number, n: number, M: number, N: number): number {
  const nMaxArraySize = 500000; // arbitrary max array size

  const cnNumer: number[] = [];
  const cnDenom: number[] = [];

  const nEstContainerSize = Math.trunc(x + Math.min(n, M));
  const nMaxSize = nMaxArraySize;
  if (nEstContainerSize > nMaxSize) {
    this.PushNoValue();
    return 0;
  }

  // Trim coefficient C first
  let fCNumVarUpper = N - n - M + x - 1.0;
  let fCDenomVarLower = 1.0;
  if (N - n - M + x >= M - x + 1.0) {
    fCNumVarUpper = M - x - 1.0;
    fCDenomVarLower = N - n - 2.0 * (M - x) + 1.0;
  }

  const fCNumLower = N - n - fCNumVarUpper;
  void fCNumLower; // only used in assertions
  let fCDenomUpper = N - n - M + x + 1.0 - fCDenomVarLower;

  let fDNumVarLower = n - M;

  if (n >= M + 1.0) {
    if (N - M < n + 1.0) {
      // Case 1

      if (N - n < n + 1.0) {
        // no overlap
        lcl_PutFactorialElements(cnNumer, 0.0, fCNumVarUpper, N - n);
        lcl_PutFactorialElements(cnDenom, 0.0, N - n - 1.0, N);
      } else {
        // overlap
        lcl_PutFactorialElements(cnNumer, N - 2.0 * n, fCNumVarUpper, N - n);
        lcl_PutFactorialElements(cnDenom, 0.0, n - 1.0, N);
      }

      if (fCDenomUpper < n - x + 1.0)
        // no overlap
        lcl_PutFactorialElements(cnNumer, 1.0, N - M - n + x, N - M + 1.0);
      else {
        // overlap
        lcl_PutFactorialElements(cnNumer, 1.0, N - M - fCDenomUpper, N - M + 1.0);

        fCDenomUpper = n - x;
        fCDenomVarLower = N - M - 2.0 * (n - x) + 1.0;
      }
    } else {
      // Case 2

      if (n > M - 1.0) {
        // no overlap
        lcl_PutFactorialElements(cnNumer, 0.0, fCNumVarUpper, N - n);
        lcl_PutFactorialElements(cnDenom, 0.0, M - 1.0, N);
      } else {
        lcl_PutFactorialElements(cnNumer, M - n, fCNumVarUpper, N - n);
        lcl_PutFactorialElements(cnDenom, 0.0, n - 1.0, N);
      }

      if (fCDenomUpper < n - x + 1.0)
        // no overlap
        lcl_PutFactorialElements(cnNumer, N - M - n + 1.0, N - M - n + x, N - M + 1.0);
      else {
        lcl_PutFactorialElements(cnNumer, N - M - n + 1.0, N - M - fCDenomUpper, N - M + 1.0);
        fCDenomUpper = n - x;
        fCDenomVarLower = N - M - 2.0 * (n - x) + 1.0;
      }
    }
  } else {
    if (N - M < M + 1.0) {
      // Case 3

      if (N - n < M + 1.0) {
        // No overlap
        lcl_PutFactorialElements(cnNumer, 0.0, fCNumVarUpper, N - n);
        lcl_PutFactorialElements(cnDenom, 0.0, N - M - 1.0, N);
      } else {
        lcl_PutFactorialElements(cnNumer, N - n - M, fCNumVarUpper, N - n);
        lcl_PutFactorialElements(cnDenom, 0.0, n - 1.0, N);
      }

      if (n - x + 1.0 > fCDenomUpper)
        // No overlap
        lcl_PutFactorialElements(cnNumer, 1.0, N - M - n + x, N - M + 1.0);
      else {
        // Overlap
        lcl_PutFactorialElements(cnNumer, 1.0, N - M - fCDenomUpper, N - M + 1.0);

        fCDenomVarLower = N - M - 2.0 * (n - x) + 1.0;
        fCDenomUpper = n - x;
      }
    } else {
      // Case 4

      if (N - n < N - M + 1.0) {
        // No overlap
        lcl_PutFactorialElements(cnNumer, 0.0, fCNumVarUpper, N - n);
        lcl_PutFactorialElements(cnDenom, 0.0, M - 1.0, N);
      } else {
        // Overlap
        lcl_PutFactorialElements(cnNumer, M - n, fCNumVarUpper, N - n);
        lcl_PutFactorialElements(cnDenom, 0.0, n - 1.0, N);
      }

      if (n - x + 1.0 > fCDenomUpper)
        // No overlap
        lcl_PutFactorialElements(cnNumer, N - 2.0 * M + 1.0, N - M - n + x, N - M + 1.0);
      else if (M >= fCDenomUpper) {
        lcl_PutFactorialElements(cnNumer, N - 2.0 * M + 1.0, N - M - fCDenomUpper, N - M + 1.0);

        fCDenomUpper = n - x;
        fCDenomVarLower = N - M - 2.0 * (n - x) + 1.0;
      } else {
        lcl_PutFactorialElements(cnDenom, fCDenomVarLower, N - n - 2.0 * M + x, N - n - M + x + 1.0);

        fCDenomUpper = n - x;
        fCDenomVarLower = N - M - 2.0 * (n - x) + 1.0;
      }
    }

    fDNumVarLower = 0.0;
  }

  const nDNumVarUpper = fCDenomUpper < x + 1.0 ? n - x - 1.0 : n - fCDenomUpper - 1.0;
  const nDDenomVarLower = fCDenomUpper < x + 1.0 ? fCDenomVarLower : N - n - M + 1.0;
  lcl_PutFactorialElements(cnNumer, fDNumVarLower, nDNumVarUpper, n);
  lcl_PutFactorialElements(cnDenom, nDDenomVarLower, N - n - M + x, N - n - M + x + 1.0);

  cnNumer.sort((a, b) => a - b);
  cnDenom.sort((a, b) => a - b);
  let it1 = cnNumer.length - 1;
  let it2 = cnDenom.length - 1;

  let fFactor = 1.0;
  for (; it1 >= 0 || it2 >= 0; ) {
    let fEnum = 1.0,
      fDenom = 1.0;
    if (it1 >= 0) fEnum = cnNumer[it1--]!;
    if (it2 >= 0) fDenom = cnDenom[it2--]!;
    fFactor *= fEnum / fDenom;
  }

  return fFactor;
};

ScInterpreter.prototype.ScGammaDist = function (this: ScInterpreter, bODFF: boolean): void {
  const nMinParamCount = bODFF ? 3 : 4;
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, nMinParamCount, 4)) return;
  let bCumulative: boolean;
  if (nParamCount === 4) bCumulative = this.GetBool();
  else bCumulative = true;
  const fBeta = this.GetDouble(); // scale
  const fAlpha = this.GetDouble(); // shape
  const fX = this.GetDouble(); // x
  if ((!bODFF && fX < 0) || fAlpha <= 0.0 || fBeta <= 0.0) this.PushIllegalArgument();
  else {
    if (bCumulative) // distribution
      this.PushDouble(this.GetGammaDist(fX, fAlpha, fBeta));
    // density
    else this.PushDouble(this.GetGammaDistPDF(fX, fAlpha, fBeta));
  }
};

ScInterpreter.prototype.ScNormInv = function (this: ScInterpreter): void {
  if (this.MustHaveParamCount(this.GetByte(), 3)) {
    const sigma = this.GetDouble();
    const mue = this.GetDouble();
    const x = this.GetDouble();
    if (sigma <= 0.0 || x < 0.0 || x > 1.0) this.PushIllegalArgument();
    else if (x === 0.0 || x === 1.0) this.PushNoValue();
    else this.PushDouble(this.gaussinv(x) * sigma + mue);
  }
};

ScInterpreter.prototype.ScSNormInv = function (this: ScInterpreter): void {
  const x = this.GetDouble();
  if (x < 0.0 || x > 1.0) this.PushIllegalArgument();
  else if (x === 0.0 || x === 1.0) this.PushNoValue();
  else this.PushDouble(this.gaussinv(x));
};

ScInterpreter.prototype.ScLogNormInv = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (this.MustHaveParamCount(nParamCount, 1, 3)) {
    const fSigma = nParamCount === 3 ? this.GetDouble() : 1.0; // Stddev
    const fMue = nParamCount >= 2 ? this.GetDouble() : 0.0; // Mean
    const fP = this.GetDouble(); // p
    if (fSigma <= 0.0 || fP <= 0.0 || fP >= 1.0) this.PushIllegalArgument();
    else this.PushDouble(Math.exp(fMue + fSigma * this.gaussinv(fP)));
  }
};

/** ScGammaDistFunction */
function ScGammaDistFunction(rInt: ScInterpreter, fp: number, fAlpha: number, fBeta: number): ScDistFunc {
  return { GetValue: (x: number) => fp - rInt.GetGammaDist(x, fAlpha, fBeta) };
}

ScInterpreter.prototype.ScGammaInv = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 3)) return;
  const fBeta = this.GetDouble();
  const fAlpha = this.GetDouble();
  const fP = this.GetDouble();
  if (fAlpha <= 0.0 || fBeta <= 0.0 || fP < 0.0 || fP >= 1.0) {
    this.PushIllegalArgument();
    return;
  }
  if (fP === 0.0) this.PushInt(0);
  else {
    const aFunc = ScGammaDistFunction(this, fP, fAlpha, fBeta);
    const fStart = fAlpha * fBeta;
    const { fVal, rConvError: bConvError } = lcl_IterateInverse(aFunc, fStart * 0.5, fStart);
    if (bConvError) this.SetError(FormulaError.NoConvergence);
    this.PushDouble(fVal);
  }
};

/** ScBetaDistFunction */
function ScBetaDistFunction(rInt: ScInterpreter, fp: number, fAlpha: number, fBeta: number): ScDistFunc {
  return { GetValue: (x: number) => fp - rInt.GetBetaDist(x, fAlpha, fBeta) };
}

ScInterpreter.prototype.ScBetaInv = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 3, 5)) return;
  let fA: number, fB: number;
  if (nParamCount === 5) fB = this.GetDouble();
  else fB = 1.0;
  if (nParamCount >= 4) fA = this.GetDouble();
  else fA = 0.0;
  const fBeta = this.GetDouble();
  const fAlpha = this.GetDouble();
  const fP = this.GetDouble();
  if (fP < 0.0 || fP > 1.0 || fA >= fB || fAlpha <= 0.0 || fBeta <= 0.0) {
    this.PushIllegalArgument();
    return;
  }

  const aFunc = ScBetaDistFunction(this, fP, fAlpha, fBeta);
  // 0..1 as range for iteration so it isn't extended beyond the valid range
  const { fVal, rConvError: bConvError } = lcl_IterateInverse(aFunc, 0.0, 1.0);
  if (bConvError) this.PushError(FormulaError.NoConvergence);
  else this.PushDouble(fA + fVal * (fB - fA)); // scale to (A,B)
};

// Note: T, F, and Chi are
// monotonically decreasing,
// therefore 1-Dist as function

/** ScTDistFunction */
function ScTDistFunction(rInt: ScInterpreter, fp: number, fDF: number, nT: number): ScDistFunc {
  return { GetValue: (x: number) => fp - rInt.GetTDist(x, fDF, nT) };
}

ScInterpreter.prototype.ScTInv = function (this: ScInterpreter, nType: number): void {
  if (!this.MustHaveParamCount(this.GetByte(), 2)) return;
  const fDF = approxFloor(this.GetDouble());
  const fP = this.GetDouble();
  if (fDF < 1.0 || fP <= 0.0 || fP > 1.0) {
    this.PushIllegalArgument();
    return;
  }
  if (nType === 4) {
    // left-tailed cumulative t-distribution
    if (fP === 1.0) this.PushIllegalArgument();
    else if (fP < 0.5) this.PushDouble(-this.GetTInv(1 - fP, fDF, nType));
    else this.PushDouble(this.GetTInv(fP, fDF, nType));
  } else this.PushDouble(this.GetTInv(fP, fDF, nType));
};

ScInterpreter.prototype.GetTInv = function (this: ScInterpreter, fAlpha: number, fSize: number, nType: number): number {
  const aFunc = ScTDistFunction(this, fAlpha, fSize, nType);
  const { fVal, rConvError: bConvError } = lcl_IterateInverse(aFunc, fSize * 0.5, fSize);
  if (bConvError) this.SetError(FormulaError.NoConvergence);
  return fVal;
};

/** ScFDistFunction */
function ScFDistFunction(rInt: ScInterpreter, fp: number, fF1: number, fF2: number): ScDistFunc {
  return { GetValue: (x: number) => fp - rInt.GetFDist(x, fF1, fF2) };
}

ScInterpreter.prototype.ScFInv = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 3)) return;
  const fF2 = approxFloor(this.GetDouble());
  const fF1 = approxFloor(this.GetDouble());
  const fP = this.GetDouble();
  if (fP <= 0.0 || fF1 < 1.0 || fF2 < 1.0 || fF1 >= 1.0e10 || fF2 >= 1.0e10 || fP > 1.0) {
    this.PushIllegalArgument();
    return;
  }

  const aFunc = ScFDistFunction(this, fP, fF1, fF2);
  const { fVal, rConvError: bConvError } = lcl_IterateInverse(aFunc, fF1 * 0.5, fF1);
  if (bConvError) this.SetError(FormulaError.NoConvergence);
  this.PushDouble(fVal);
};

ScInterpreter.prototype.ScFInv_LT = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 3)) return;
  const fF2 = approxFloor(this.GetDouble());
  const fF1 = approxFloor(this.GetDouble());
  const fP = this.GetDouble();
  if (fP <= 0.0 || fF1 < 1.0 || fF2 < 1.0 || fF1 >= 1.0e10 || fF2 >= 1.0e10 || fP > 1.0) {
    this.PushIllegalArgument();
    return;
  }

  const aFunc = ScFDistFunction(this, 1.0 - fP, fF1, fF2);
  const { fVal, rConvError: bConvError } = lcl_IterateInverse(aFunc, fF1 * 0.5, fF1);
  if (bConvError) this.SetError(FormulaError.NoConvergence);
  this.PushDouble(fVal);
};

/** ScChiDistFunction */
function ScChiDistFunction(rInt: ScInterpreter, fp: number, fDF: number): ScDistFunc {
  return { GetValue: (x: number) => fp - rInt.GetChiDist(x, fDF) };
}

ScInterpreter.prototype.ScChiInv = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 2)) return;
  const fDF = approxFloor(this.GetDouble());
  const fP = this.GetDouble();
  if (fDF < 1.0 || fP <= 0.0 || fP > 1.0) {
    this.PushIllegalArgument();
    return;
  }

  const aFunc = ScChiDistFunction(this, fP, fDF);
  const { fVal, rConvError: bConvError } = lcl_IterateInverse(aFunc, fDF * 0.5, fDF);
  if (bConvError) this.SetError(FormulaError.NoConvergence);
  this.PushDouble(fVal);
};

/***********************************************/
/** ScChiSqDistFunction */
function ScChiSqDistFunction(rInt: ScInterpreter, fp: number, fDF: number): ScDistFunc {
  return { GetValue: (x: number) => fp - rInt.GetChiSqDistCDF(x, fDF) };
}

ScInterpreter.prototype.ScChiSqInv = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 2)) return;
  const fDF = approxFloor(this.GetDouble());
  const fP = this.GetDouble();
  if (fDF < 1.0 || fP < 0.0 || fP >= 1.0) {
    this.PushIllegalArgument();
    return;
  }

  const aFunc = ScChiSqDistFunction(this, fP, fDF);
  const { fVal, rConvError: bConvError } = lcl_IterateInverse(aFunc, fDF * 0.5, fDF);
  if (bConvError) this.SetError(FormulaError.NoConvergence);
  this.PushDouble(fVal);
};

ScInterpreter.prototype.ScConfidence = function (this: ScInterpreter): void {
  if (this.MustHaveParamCount(this.GetByte(), 3)) {
    const n = approxFloor(this.GetDouble());
    const sigma = this.GetDouble();
    const alpha = this.GetDouble();
    if (sigma <= 0.0 || alpha <= 0.0 || alpha >= 1.0 || n < 1.0) this.PushIllegalArgument();
    else this.PushDouble((this.gaussinv(1.0 - alpha / 2.0) * sigma) / Math.sqrt(n));
  }
};

ScInterpreter.prototype.ScConfidenceT = function (this: ScInterpreter): void {
  if (this.MustHaveParamCount(this.GetByte(), 3)) {
    const n = approxFloor(this.GetDouble());
    const sigma = this.GetDouble();
    const alpha = this.GetDouble();
    if (sigma <= 0.0 || alpha <= 0.0 || alpha >= 1.0 || n < 1.0) this.PushIllegalArgument();
    else if (n === 1.0) // for interoperability with Excel
      this.PushError(FormulaError.DivisionByZero);
    else this.PushDouble((sigma * this.GetTInv(alpha, n - 1, 2)) / Math.sqrt(n));
  }
};

declare module './interpr4.ts' {
  interface ScInterpreter {
    ScZTest(): void;
    /** Returns false with an error pushed, else fT and fF. */
    CalculateTest(_bTemplin: boolean, nC1: number, nC2: number, nR1: number, nR2: number, pMat1: ScMatrix, pMat2: ScMatrix): { bOk: boolean; fT: number; fF: number };
    ScTTest(): void;
    ScFTest(): void;
    ScChiTest(): void;
    ScKurt(): void;
    ScHarMean(): void;
    ScGeoMean(): void;
    ScStandard(): void;
    /** Returns null with an error pushed, else the sum, count and values. */
    CalculateSkew(): { fSum: KahanSum; fCount: number; values: number[] } | null;
    CalculateSkewOrSkewp(bSkewp: boolean): void;
    ScSkew(): void;
    ScSkewp(): void;
    GetMedian(rArray: number[]): number;
    ScMedian(): void;
    GetPercentile(rArray: number[], fPercentile: number): number;
    GetPercentileExclusive(rArray: number[], fPercentile: number): number;
    ScPercentile(bInclusive: boolean): void;
    ScQuartile(bInclusive: boolean): void;
    ScModalValue(): void;
    ScModalValue_MS(bSingle: boolean): void;
    CalculateSmallLarge(bSmall: boolean): void;
    ScLarge(): void;
    ScSmall(): void;
    ScPercentrank(bInclusive: boolean): void;
    GetPercentrank(rArray: number[], fVal: number, bInclusive: boolean): number;
    ScTrimMean(): void;
    GetRankNumberArray(): { aArray: number[]; rCol: number; rRow: number };
    GetNumberSequenceArray(nParamCount: number, rArray: number[], bConvertTextInArray: boolean): void;
    GetSortArray(nParamCount: number, rSortArray: number[], pIndexOrder: number[] | null, bConvertTextInArray: boolean, bAllowEmptyArray: boolean): void;
    QuickSort(rSortArray: number[], pIndexOrder: number[] | null): void;
    ScRank(bAverage: boolean): void;
    ScAveDev(): void;
    ScDevSq(): void;
    ScProbability(): void;
    ScCorrel(): void;
    ScCovarianceP(): void;
    ScCovarianceS(): void;
    ScPearson(): void;
    CalculatePearsonCovar(_bPearson: boolean, _bStexy: boolean, _bSample: boolean): void;
    ScRSQ(): void;
    ScSTEYX(): void;
    CalculateSlopeIntercept(bSlope: boolean): void;
    ScSlope(): void;
    ScIntercept(): void;
    ScForecast(): void;
  }
}

/// Two columns of data should be sortable with GetSortArray() and QuickSort()
// This is an arbitrary limit.
function MAX_COUNT_DOUBLE_FOR_SORT(self: ScInterpreter): number {
  return self.mrDoc.GetSheetLimits().GetMaxRowCount() * 2;
}

/** The values of a range for the GetFirst/GetNext loops that stop at the first error: calls
    fn for each value, the error value included, and returns the error that ended the loop. */
function lcl_IterateUntilError(rIter: ScValueIterator, fn: (fVal: number) => void): FormulaError {
  for (const v of rIter.values()) {
    fn(v.fVal);
    if (v.nErr !== FormulaError.NONE) return v.nErr;
  }
  return FormulaError.NONE;
}

ScInterpreter.prototype.ScZTest = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 2, 3)) return;
  let sigma = 0.0;
  if (nParamCount === 3) {
    sigma = this.GetDouble();
    if (sigma <= 0.0) {
      this.PushIllegalArgument();
      return;
    }
  }
  const x = this.GetDouble();

  const fSum = new KahanSum(0.0);
  const fSumSqr = new KahanSum(0.0);
  let fVal: number;
  let rValCount = 0.0;
  switch (this.GetStackType()) {
    case svDouble: {
      fVal = this.GetDouble();
      fSum.add(fVal);
      fSumSqr.add(fVal * fVal);
      rValCount++;
      break;
    }
    case svSingleRef: {
      const aAdr = this.PopSingleRef();
      const aCell = this.mrDoc.GetRefCellValue(aAdr);
      if (aCell.hasNumeric()) {
        fVal = this.GetCellValue(aAdr, aCell);
        fSum.add(fVal);
        fSumSqr.add(fVal * fVal);
        rValCount++;
      }
      break;
    }
    case svRefList:
    case svDoubleRef: {
      const st = { nParam: 1, nRefInList: 0 };
      while (st.nParam-- > 0) {
        const aRange = this.PopDoubleRef(st);
        const aValIter = new ScValueIterator(this.mrDoc, aRange, this.mnSubTotalFlags);
        const nErr = lcl_IterateUntilError(aValIter, (v) => {
          fSum.add(v);
          fSumSqr.add(v * v);
          rValCount++;
        });
        this.SetError(nErr);
      }
      break;
    }
    case svMatrix:
    case svExternalSingleRef:
    case svExternalDoubleRef: {
      const pMat = this.GetMatrix();
      if (pMat) {
        const nCount = pMat.GetElementCount();
        if (pMat.IsNumeric()) {
          for (let i = 0; i < nCount; i++) {
            fVal = GetMatDouble(pMat, i);
            fSum.add(fVal);
            fSumSqr.add(fVal * fVal);
            rValCount++;
          }
        } else {
          for (let i = 0; i < nCount; i++)
            if (!pMat.IsStringOrEmpty(i)) {
              fVal = GetMatDouble(pMat, i);
              fSum.add(fVal);
              fSumSqr.add(fVal * fVal);
              rValCount++;
            }
        }
      }
      break;
    }
    default:
      this.SetError(FormulaError.IllegalParameter);
      break;
  }
  if (rValCount <= 1.0) this.PushError(FormulaError.DivisionByZero);
  else {
    const mue = fSum.get() / rValCount;

    if (nParamCount !== 3) {
      sigma = ksub(fSumSqr, (fSum.get() * fSum.get()) / rValCount).get() / (rValCount - 1.0);
      if (sigma === 0.0) {
        this.PushError(FormulaError.DivisionByZero);
        return;
      }
      this.PushDouble(0.5 - this.gauss((mue - x) / Math.sqrt(sigma / rValCount)));
    } else this.PushDouble(0.5 - this.gauss(((mue - x) * Math.sqrt(rValCount)) / sigma));
  }
};

ScInterpreter.prototype.CalculateTest = function (this: ScInterpreter, _bTemplin: boolean, nC1: number, nC2: number, nR1: number, nR2: number, pMat1: ScMatrix, pMat2: ScMatrix): { bOk: boolean; fT: number; fF: number } {
  let fT = 0.0, fF = 0.0;
  let fCount1 = 0.0;
  let fCount2 = 0.0;
  const fSum1 = new KahanSum(0.0);
  const fSumSqr1 = new KahanSum(0.0);
  const fSum2 = new KahanSum(0.0);
  const fSumSqr2 = new KahanSum(0.0);
  let fVal: number;
  let i: number, j: number;
  for (i = 0; i < nC1; i++)
    for (j = 0; j < nR1; j++) {
      if (!pMat1.IsStringOrEmpty(i, j)) {
        fVal = pMat1.GetDouble(i, j);
        fSum1.add(fVal);
        fSumSqr1.add(fVal * fVal);
        fCount1++;
      }
    }
  for (i = 0; i < nC2; i++)
    for (j = 0; j < nR2; j++) {
      if (!pMat2.IsStringOrEmpty(i, j)) {
        fVal = pMat2.GetDouble(i, j);
        fSum2.add(fVal);
        fSumSqr2.add(fVal * fVal);
        fCount2++;
      }
    }
  if (fCount1 < 2.0 || fCount2 < 2.0) {
    this.PushNoValue();
    return { bOk: false, fT, fF };
  } // if (fCount1 < 2.0 || fCount2 < 2.0)
  if (_bTemplin) {
    const fS1 = ksub(fSumSqr1, (fSum1.get() * fSum1.get()) / fCount1).get() / (fCount1 - 1.0) / fCount1;
    const fS2 = ksub(fSumSqr2, (fSum2.get() * fSum2.get()) / fCount2).get() / (fCount2 - 1.0) / fCount2;
    if (fS1 + fS2 === 0.0) {
      this.PushNoValue();
      return { bOk: false, fT, fF };
    }
    const fMean = new KahanSum(fSum1.get() / fCount1);
    fMean.add(-(fSum2.get() / fCount2));
    fT = Math.abs(fMean.get()) / Math.sqrt(fS1 + fS2);
    const c = fS1 / (fS1 + fS2);
    //  GetTDist is calculated via GetBetaDist and also works with non-integral
    // degrees of freedom. The result matches Excel
    fF = 1.0 / ((c * c) / (fCount1 - 1.0) + ((1.0 - c) * (1.0 - c)) / (fCount2 - 1.0));
  } else {
    //  according to Bronstein-Semendjajew
    const fS1 = ksub(fSumSqr1, (fSum1.get() * fSum1.get()) / fCount1).get() / (fCount1 - 1.0); // Variance
    const fS2 = ksub(fSumSqr2, (fSum2.get() * fSum2.get()) / fCount2).get() / (fCount2 - 1.0);
    fT =
      (Math.abs(fSum1.get() / fCount1 - fSum2.get() / fCount2) / Math.sqrt((fCount1 - 1.0) * fS1 + (fCount2 - 1.0) * fS2)) *
      Math.sqrt((fCount1 * fCount2 * (fCount1 + fCount2 - 2)) / (fCount1 + fCount2));
    fF = fCount1 + fCount2 - 2;
  }
  return { bOk: true, fT, fF };
};

ScInterpreter.prototype.ScTTest = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 4)) return;
  const fTyp = approxFloor(this.GetDouble());
  const fTails = approxFloor(this.GetDouble());
  if (fTails !== 1.0 && fTails !== 2.0) {
    this.PushIllegalArgument();
    return;
  }

  const pMat2 = this.GetMatrix();
  const pMat1 = this.GetMatrix();
  if (!pMat1 || !pMat2) {
    this.PushIllegalParameter();
    return;
  }
  let fT: number, fF: number;
  let i: number, j: number;
  const { nC: nC1, nR: nR1 } = pMat1.GetDimensions();
  const { nC: nC2, nR: nR2 } = pMat2.GetDimensions();
  if (fTyp === 1.0) {
    if (nC1 !== nC2 || nR1 !== nR2) {
      this.PushIllegalArgument();
      return;
    }
    let fCount = 0.0;
    const fSum1 = new KahanSum(0.0);
    const fSum2 = new KahanSum(0.0);
    const fSumSqrD = new KahanSum(0.0);
    let fVal1: number, fVal2: number;
    for (i = 0; i < nC1; i++)
      for (j = 0; j < nR1; j++) {
        if (!pMat1.IsStringOrEmpty(i, j) && !pMat2.IsStringOrEmpty(i, j)) {
          fVal1 = pMat1.GetDouble(i, j);
          fVal2 = pMat2.GetDouble(i, j);
          fSum1.add(fVal1);
          fSum2.add(fVal2);
          fSumSqrD.add((fVal1 - fVal2) * (fVal1 - fVal2));
          fCount++;
        }
      }
    if (fCount < 1.0) {
      this.PushNoValue();
      return;
    }
    const fSumD = ksubk(fSum1, fSum2);
    const fDivider = ksub(new KahanSum(fSumSqrD.get() * fCount), fSumD.get() * fSumD.get()).get();
    if (fDivider === 0.0) {
      this.PushError(FormulaError.DivisionByZero);
      return;
    }
    fT = Math.abs(fSumD.get()) * Math.sqrt((fCount - 1.0) / fDivider);
    fF = fCount - 1.0;
  } else if (fTyp === 2.0) {
    const r = this.CalculateTest(false, nC1, nC2, nR1, nR2, pMat1, pMat2);
    if (!r.bOk) return; // error was pushed
    fT = r.fT;
    fF = r.fF;
  } else if (fTyp === 3.0) {
    const r = this.CalculateTest(true, nC1, nC2, nR1, nR2, pMat1, pMat2);
    if (!r.bOk) return; // error was pushed
    fT = r.fT;
    fF = r.fF;
  } else {
    this.PushIllegalArgument();
    return;
  }
  this.PushDouble(this.GetTDist(fT, fF, Math.trunc(fTails)));
};

/** ScMatrix::CollectKahan(sc::op::kOpSumAndSumSquare): the sum and the sum of squares of the
    numeric (and boolean) elements. */
function lcl_CollectSumAndSumSquare(pMat: ScMatrix): { mnCount: number; fSum: KahanSum; fSumSqr: KahanSum } {
  const fSum = new KahanSum(0.0);
  const fSumSqr = new KahanSum(0.0);
  let mnCount = 0;
  const nCount = pMat.GetElementCount();
  for (let i = 0; i < nCount; i++) {
    if (pMat.IsValue(i)) {
      const fVal = GetMatDouble(pMat, i);
      fSum.add(fVal);
      fSumSqr.add(fVal * fVal);
      ++mnCount;
    }
  }
  return { mnCount, fSum, fSumSqr };
}

ScInterpreter.prototype.ScFTest = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 2)) return;
  const pMat2 = this.GetMatrix();
  const pMat1 = this.GetMatrix();
  if (!pMat1 || !pMat2) {
    this.PushIllegalParameter();
    return;
  }

  const aVal1 = lcl_CollectSumAndSumSquare(pMat1);
  const aVal2 = lcl_CollectSumAndSumSquare(pMat2);
  const fCount1 = aVal1.mnCount;
  const fCount2 = aVal2.mnCount;
  const fSum1 = aVal1.fSum;
  const fSumSqr1 = aVal1.fSumSqr;
  const fSum2 = aVal2.fSum;
  const fSumSqr2 = aVal2.fSumSqr;

  if (fCount1 < 2.0 || fCount2 < 2.0) {
    this.PushNoValue();
    return;
  }
  const fS1 = ksub(fSumSqr1, (fSum1.get() * fSum1.get()) / fCount1).get() / (fCount1 - 1.0);
  const fS2 = ksub(fSumSqr2, (fSum2.get() * fSum2.get()) / fCount2).get() / (fCount2 - 1.0);
  if (fS1 === 0.0 || fS2 === 0.0) {
    this.PushNoValue();
    return;
  }
  let fF: number, fF1: number, fF2: number;
  if (fS1 > fS2) {
    fF = fS1 / fS2;
    fF1 = fCount1 - 1.0;
    fF2 = fCount2 - 1.0;
  } else {
    fF = fS2 / fS1;
    fF1 = fCount2 - 1.0;
    fF2 = fCount1 - 1.0;
  }
  const fFcdf = this.GetFDist(fF, fF1, fF2);
  this.PushDouble(2.0 * Math.min(fFcdf, 1.0 - fFcdf));
};

ScInterpreter.prototype.ScChiTest = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 2)) return;
  const pMat2 = this.GetMatrix();
  const pMat1 = this.GetMatrix();
  if (!pMat1 || !pMat2) {
    this.PushIllegalParameter();
    return;
  }
  const { nC: nC1, nR: nR1 } = pMat1.GetDimensions();
  const { nC: nC2, nR: nR2 } = pMat2.GetDimensions();
  if (nR1 !== nR2 || nC1 !== nC2) {
    this.PushIllegalArgument();
    return;
  }
  const fChi = new KahanSum(0.0);
  let bEmpty = true;
  for (let i = 0; i < nC1; i++) {
    for (let j = 0; j < nR1; j++) {
      if (!(pMat1.IsEmpty(i, j) || pMat2.IsEmpty(i, j))) {
        bEmpty = false;
        if (!pMat1.IsStringOrEmpty(i, j) && !pMat2.IsStringOrEmpty(i, j)) {
          const fValX = pMat1.GetDouble(i, j);
          const fValE = pMat2.GetDouble(i, j);
          if (fValE === 0.0) {
            this.PushError(FormulaError.DivisionByZero);
            return;
          }
          // These fTemp values guard against a failure when compiled
          // with optimization (using g++ 4.8.2 on tinderbox 71-TDF),
          // where ((fValX - fValE) * (fValX - fValE)) with
          // fValE==1e+308 should had produced Infinity but did
          // not, instead the result of divide() then was 1e+308.
          const fTemp1 = (fValX - fValE) * (fValX - fValE);
          const fTemp2 = fTemp1;
          if (fTemp2 === Infinity || fTemp2 === -Infinity) {
            this.PushError(FormulaError.NoConvergence);
            return;
          }
          fChi.add(divide(fTemp2, fValE));
        } else {
          this.PushIllegalArgument();
          return;
        }
      }
    }
  }
  if (bEmpty) {
    // not in ODFF1.2, but for interoperability with Excel
    this.PushIllegalArgument();
    return;
  }
  let fDF: number;
  if (nC1 === 1 || nR1 === 1) {
    fDF = nC1 * nR1 - 1;
    if (fDF === 0.0) {
      this.PushNoValue();
      return;
    }
  } else fDF = (nC1 - 1) * (nR1 - 1);
  this.PushDouble(this.GetChiDist(fChi.get(), fDF));
};

ScInterpreter.prototype.ScKurt = function (this: ScInterpreter): void {
  const r = this.CalculateSkew();
  if (!r) return;
  const { fSum, fCount, values } = r;

  // ODF 1.2 constraints: # of numbers >= 4
  if (fCount < 4.0) {
    // for interoperability with Excel
    this.PushError(FormulaError.DivisionByZero);
    return;
  }

  const vSum = new KahanSum();
  const fMean = fSum.get() / fCount;
  for (const v of values) vSum.add((v - fMean) * (v - fMean));

  const fStdDev = Math.sqrt(vSum.get() / (fCount - 1.0));
  if (fStdDev === 0.0) {
    this.PushError(FormulaError.DivisionByZero);
    return;
  }

  const xpower4 = new KahanSum(0.0);
  for (const v of values) {
    const dx = (v - fMean) / fStdDev;
    xpower4.add(dx * dx * (dx * dx));
  }

  const k_d = (fCount - 2.0) * (fCount - 3.0);
  const k_l = (fCount * (fCount + 1.0)) / ((fCount - 1.0) * k_d);
  const k_t = (3.0 * (fCount - 1.0) * (fCount - 1.0)) / k_d;

  this.PushDouble(xpower4.get() * k_l - k_t);
};

ScInterpreter.prototype.ScHarMean = function (this: ScInterpreter): void {
  let nParamCount = this.GetByte();
  const nVal = new KahanSum(0.0);
  let nValCount = 0.0;
  const st = { nParam: 0, nRefInList: 0 };
  const addValue = (x: number) => {
    if (x > 0.0) {
      nVal.add(1.0 / x);
      nValCount++;
    } else this.SetError(FormulaError.IllegalArgument);
  };
  while (this.nGlobalError === FormulaError.NONE && nParamCount-- > 0) {
    switch (this.GetStackType()) {
      case svDouble: {
        addValue(this.GetDouble());
        break;
      }
      case svSingleRef: {
        const aAdr = this.PopSingleRef();
        const aCell = this.mrDoc.GetRefCellValue(aAdr);
        if (aCell.hasNumeric()) addValue(this.GetCellValue(aAdr, aCell));
        break;
      }
      case svDoubleRef:
      case svRefList: {
        st.nParam = nParamCount;
        const aRange = this.PopDoubleRef(st);
        nParamCount = st.nParam;
        const aValIter = new ScValueIterator(this.mrDoc, aRange, this.mnSubTotalFlags);
        const nErr = lcl_IterateUntilError(aValIter, addValue);
        this.SetError(nErr);
        break;
      }
      case svMatrix:
      case svExternalSingleRef:
      case svExternalDoubleRef: {
        const pMat = this.GetMatrix();
        if (pMat) {
          const nCount = pMat.GetElementCount();
          if (pMat.IsNumeric()) {
            for (let nElem = 0; nElem < nCount; nElem++) addValue(GetMatDouble(pMat, nElem));
          } else {
            for (let nElem = 0; nElem < nCount; nElem++) if (!pMat.IsStringOrEmpty(nElem)) addValue(GetMatDouble(pMat, nElem));
          }
        }
        break;
      }
      default:
        this.SetError(FormulaError.IllegalParameter);
        break;
    }
  }
  if (this.nGlobalError === FormulaError.NONE) this.PushDouble(div_allow_zero(nValCount, nVal.get()));
  else this.PushError(this.nGlobalError);
};

ScInterpreter.prototype.ScGeoMean = function (this: ScInterpreter): void {
  let nParamCount = this.GetByte();
  const nVal = new KahanSum(0.0);
  let nValCount = 0.0;
  const st = { nParam: 0, nRefInList: 0 };
  /** Returns true when a value of 0 ends the function. */
  const addValue = (x: number): boolean => {
    if (x > 0.0) {
      nVal.add(Math.log(x));
      nValCount++;
    } else if (x === 0.0) {
      // value of 0 means that function result will be 0
      while (nParamCount-- > 0) this.PopError();
      this.PushDouble(0.0);
      return true;
    } else this.SetError(FormulaError.IllegalArgument);
    return false;
  };
  while (this.nGlobalError === FormulaError.NONE && nParamCount-- > 0) {
    switch (this.GetStackType()) {
      case svDouble: {
        if (addValue(this.GetDouble())) return;
        break;
      }
      case svSingleRef: {
        const aAdr = this.PopSingleRef();
        const aCell = this.mrDoc.GetRefCellValue(aAdr);
        if (aCell.hasNumeric()) {
          if (addValue(this.GetCellValue(aAdr, aCell))) return;
        }
        break;
      }
      case svDoubleRef:
      case svRefList: {
        st.nParam = nParamCount;
        const aRange = this.PopDoubleRef(st);
        nParamCount = st.nParam;
        const aValIter = new ScValueIterator(this.mrDoc, aRange, this.mnSubTotalFlags);
        for (const v of aValIter.values()) {
          if (addValue(v.fVal)) return;
          if (v.nErr !== FormulaError.NONE) {
            this.SetError(v.nErr);
            break;
          }
        }
        break;
      }
      case svMatrix:
      case svExternalSingleRef:
      case svExternalDoubleRef: {
        const pMat = this.GetMatrix();
        if (pMat) {
          const nCount = pMat.GetElementCount();
          if (pMat.IsNumeric()) {
            for (let ui = 0; ui < nCount; ui++) {
              if (addValue(GetMatDouble(pMat, ui))) return;
            }
          } else {
            for (let ui = 0; ui < nCount; ui++) {
              if (!pMat.IsStringOrEmpty(ui)) {
                if (addValue(GetMatDouble(pMat, ui))) return;
              }
            }
          }
        }
        break;
      }
      default:
        this.SetError(FormulaError.IllegalParameter);
        break;
    }
  }
  if (this.nGlobalError === FormulaError.NONE) this.PushDouble(Math.exp(div_allow_zero(nVal.get(), nValCount)));
  else this.PushError(this.nGlobalError);
};

ScInterpreter.prototype.ScStandard = function (this: ScInterpreter): void {
  if (this.MustHaveParamCount(this.GetByte(), 3)) {
    const sigma = this.GetDouble();
    const mue = this.GetDouble();
    const x = this.GetDouble();
    if (sigma < 0.0) this.PushError(FormulaError.IllegalArgument);
    else if (sigma === 0.0) this.PushError(FormulaError.DivisionByZero);
    else this.PushDouble((x - mue) / sigma);
  }
};

ScInterpreter.prototype.CalculateSkew = function (this: ScInterpreter): { fSum: KahanSum; fCount: number; values: number[] } | null {
  let nParamCount = this.GetByte();
  if (!this.MustHaveParamCountMin(nParamCount, 1)) return null;

  const fSum = new KahanSum(0.0);
  let fCount = 0.0;
  const values: number[] = [];
  let fVal = 0.0;
  const st = { nParam: 0, nRefInList: 0 };
  const addValue = (v: number) => {
    fSum.add(v);
    values.push(v);
    fCount++;
  };
  while (nParamCount-- > 0) {
    switch (this.GetStackType()) {
      case svDouble: {
        fVal = this.GetDouble();
        addValue(fVal);
        break;
      }
      case svSingleRef: {
        const aAdr = this.PopSingleRef();
        const aCell = this.mrDoc.GetRefCellValue(aAdr);
        if (aCell.hasNumeric()) {
          fVal = this.GetCellValue(aAdr, aCell);
          addValue(fVal);
        }
        break;
      }
      case svDoubleRef:
      case svRefList: {
        st.nParam = nParamCount;
        const aRange = this.PopDoubleRef(st);
        nParamCount = st.nParam;
        const aValIter = new ScValueIterator(this.mrDoc, aRange, this.mnSubTotalFlags);
        const nErr = lcl_IterateUntilError(aValIter, addValue);
        this.SetError(nErr);
        break;
      }
      case svMatrix:
      case svExternalSingleRef:
      case svExternalDoubleRef: {
        const pMat = this.GetMatrix();
        if (pMat) {
          const nCount = pMat.GetElementCount();
          if (pMat.IsNumeric()) {
            for (let nElem = 0; nElem < nCount; nElem++) addValue(GetMatDouble(pMat, nElem));
          } else {
            for (let nElem = 0; nElem < nCount; nElem++) if (!pMat.IsStringOrEmpty(nElem)) addValue(GetMatDouble(pMat, nElem));
          }
        }
        break;
      }
      default:
        this.SetError(FormulaError.IllegalParameter);
        break;
    }
  }

  if (this.nGlobalError !== FormulaError.NONE) {
    this.PushError(this.nGlobalError);
    return null;
  } // if (nGlobalError != FormulaError::NONE)
  return { fSum, fCount, values };
};

ScInterpreter.prototype.CalculateSkewOrSkewp = function (this: ScInterpreter, bSkewp: boolean): void {
  const r = this.CalculateSkew();
  if (!r) return;
  const { fSum, fCount, values } = r;
  // SKEW/SKEWP's constraints: they require at least three numbers
  if (fCount < 3.0) {
    // for interoperability with Excel
    this.PushError(FormulaError.DivisionByZero);
    return;
  }

  const vSum = new KahanSum();
  const fMean = fSum.get() / fCount;
  for (const v of values) vSum.add((v - fMean) * (v - fMean));

  const fStdDev = Math.sqrt(vSum.get() / (bSkewp ? fCount : fCount - 1.0));
  if (fStdDev === 0) {
    this.PushIllegalArgument();
    return;
  }

  const xcube = new KahanSum(0.0);
  for (const v of values) {
    const dx = (v - fMean) / fStdDev;
    xcube.add(dx * dx * dx);
  }

  if (bSkewp) this.PushDouble(xcube.get() / fCount);
  else this.PushDouble((xcube.get() * fCount) / (fCount - 1.0) / (fCount - 2.0));
};

ScInterpreter.prototype.ScSkew = function (this: ScInterpreter): void {
  this.CalculateSkewOrSkewp(false);
};

ScInterpreter.prototype.ScSkewp = function (this: ScInterpreter): void {
  this.CalculateSkewOrSkewp(true);
};

ScInterpreter.prototype.GetMedian = function (this: ScInterpreter, rArray: number[]): number {
  const nSize = rArray.length;
  if (nSize === 0 || this.nGlobalError !== FormulaError.NONE) {
    this.SetError(FormulaError.NoValue);
    return 0.0;
  }

  // Upper median.
  const nMid = Math.trunc(nSize / 2);
  nth_element(rArray);
  if (nSize & 1) return rArray[nMid]!; // Lower and upper median are equal.
  const fUp = rArray[nMid]!;
  // Lower median.
  const fLow = rArray[nMid - 1]!; // max_element of the lower part (the array is sorted)
  return (fUp + fLow) / 2;
};

ScInterpreter.prototype.ScMedian = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCountMin(nParamCount, 1)) return;
  const aArray: number[] = [];
  this.GetNumberSequenceArray(nParamCount, aArray, false);
  this.PushDouble(this.GetMedian(aArray));
};

ScInterpreter.prototype.GetPercentile = function (this: ScInterpreter, rArray: number[], fPercentile: number): number {
  const nSize = rArray.length;
  if (nSize === 1) return rArray[0]!;
  const nIndex = approxFloor(fPercentile * (nSize - 1));
  const fDiff = fPercentile * (nSize - 1) - approxFloor(fPercentile * (nSize - 1));
  nth_element(rArray);
  if (fDiff <= 0.0) {
    // Note: neg fDiff seen with forum-mso-en4-719754.xlsx with
    // fPercentile of near 1 where approxFloor gave nIndex of nSize-1
    // resulting in a non-zero tiny negative fDiff.
    return rArray[nIndex]!;
  }
  const fVal = rArray[nIndex]!;
  const fNext = rArray[nIndex + 1]!; // min_element of the upper part (the array is sorted)
  return fVal + fDiff * (fNext - fVal);
};

ScInterpreter.prototype.GetPercentileExclusive = function (this: ScInterpreter, rArray: number[], fPercentile: number): number {
  const nSize1 = rArray.length + 1;
  if (rArray.length === 0 || nSize1 === 1 || this.nGlobalError !== FormulaError.NONE) {
    this.SetError(FormulaError.NoValue);
    return 0.0;
  }
  if (fPercentile * nSize1 < 1.0 || fPercentile * nSize1 > nSize1 - 1) {
    this.SetError(FormulaError.IllegalParameter);
    return 0.0;
  }

  const nIndex = approxFloor(fPercentile * nSize1 - 1);
  const fDiff = fPercentile * nSize1 - 1 - approxFloor(fPercentile * nSize1 - 1);
  nth_element(rArray);
  if (fDiff === 0.0) return rArray[nIndex]!;
  const fVal = rArray[nIndex]!;
  const fNext = rArray[nIndex + 1]!; // min_element of the upper part (the array is sorted)
  return fVal + fDiff * (fNext - fVal);
};

ScInterpreter.prototype.ScPercentile = function (this: ScInterpreter, bInclusive: boolean): void {
  if (!this.MustHaveParamCount(this.GetByte(), 2)) return;
  const alpha = this.GetDouble();
  if (bInclusive ? alpha < 0.0 || alpha > 1.0 : alpha <= 0.0 || alpha >= 1.0) {
    this.PushIllegalArgument();
    return;
  }
  const aArray: number[] = [];
  this.GetNumberSequenceArray(1, aArray, false);
  if (aArray.length === 0 || this.nGlobalError !== FormulaError.NONE) {
    this.PushNoValue();
    return;
  }
  if (bInclusive) this.PushDouble(this.GetPercentile(aArray, alpha));
  else this.PushDouble(this.GetPercentileExclusive(aArray, alpha));
};

ScInterpreter.prototype.ScQuartile = function (this: ScInterpreter, bInclusive: boolean): void {
  if (!this.MustHaveParamCount(this.GetByte(), 2)) return;
  const fFlag = approxFloor(this.GetDouble());
  if (bInclusive ? fFlag < 0.0 || fFlag > 4.0 : fFlag <= 0.0 || fFlag >= 4.0) {
    this.PushIllegalArgument();
    return;
  }
  const aArray: number[] = [];
  this.GetNumberSequenceArray(1, aArray, false);
  if (aArray.length === 0 || this.nGlobalError !== FormulaError.NONE) {
    this.PushNoValue();
    return;
  }
  if (bInclusive) this.PushDouble(fFlag === 2.0 ? this.GetMedian(aArray) : this.GetPercentile(aArray, 0.25 * fFlag));
  else this.PushDouble(fFlag === 2.0 ? this.GetMedian(aArray) : this.GetPercentileExclusive(aArray, 0.25 * fFlag));
};

ScInterpreter.prototype.ScModalValue = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCountMin(nParamCount, 1)) return;
  const aSortArray: number[] = [];
  this.GetSortArray(nParamCount, aSortArray, null, false, false);
  const nSize = aSortArray.length;
  if (nSize === 0 || this.nGlobalError !== FormulaError.NONE) this.PushNoValue();
  else {
    let nMaxIndex = 0,
      nMax = 1,
      nCount = 1;
    let nOldVal = aSortArray[0]!;
    let i: number;
    for (i = 1; i < nSize; i++) {
      if (aSortArray[i] === nOldVal) nCount++;
      else {
        nOldVal = aSortArray[i]!;
        if (nCount > nMax) {
          nMax = nCount;
          nMaxIndex = i - 1;
        }
        nCount = 1;
      }
    }
    if (nCount > nMax) {
      nMax = nCount;
      nMaxIndex = i - 1;
    }
    if (nMax === 1 && nCount === 1) this.PushNoValue();
    else if (nMax === 1) this.PushDouble(nOldVal);
    else this.PushDouble(aSortArray[nMaxIndex]!);
  }
};

ScInterpreter.prototype.ScModalValue_MS = function (this: ScInterpreter, bSingle: boolean): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCountMin(nParamCount, 1)) return;
  const aArray: number[] = [];
  this.GetNumberSequenceArray(nParamCount, aArray, false);
  const aSortArray = aArray.slice();
  this.QuickSort(aSortArray, null);
  const nSize = aSortArray.length;
  if (nSize === 0 || this.nGlobalError !== FormulaError.NONE) this.PushNoValue();
  else {
    let nMax = 1,
      nCount = 1;
    let nOldVal = aSortArray[0]!;
    let aResultArray: number[] = [0];
    let i: number;
    for (i = 1; i < nSize; i++) {
      if (aSortArray[i] === nOldVal) nCount++;
      else {
        if (nCount >= nMax && nCount > 1) {
          if (nCount > nMax) {
            nMax = nCount;
            if (aResultArray.length !== 1) aResultArray = [0];
            aResultArray[0] = nOldVal;
          } else aResultArray.push(nOldVal);
        }
        nOldVal = aSortArray[i]!;
        nCount = 1;
      }
    }
    if (nCount >= nMax && nCount > 1) {
      if (nCount > nMax) aResultArray = [];
      aResultArray.push(nOldVal);
    }
    if (nMax === 1 && nCount === 1) this.PushNoValue();
    else if (nMax === 1) this.PushDouble(nOldVal); // there is only 1 result, no reordering needed
    else {
      // sort resultArray according to ordering of aArray
      const aOrder: number[][] = aResultArray.map(() => [0, 0]);
      for (i = 0; i < aResultArray.length; i++) {
        for (let j = 0; j < nSize; j++) {
          if (aArray[j] === aResultArray[i]) {
            aOrder[i]![0] = aResultArray[i]!;
            aOrder[i]![1] = j;
            break;
          }
        }
      }
      aOrder.sort((lhs, rhs) => lhs[1]! - rhs[1]!);

      if (bSingle) this.PushDouble(aOrder[0]![0]!);
      else {
        // put result in correct order in aResultArray
        for (i = 0; i < aResultArray.length; i++) aResultArray[i] = aOrder[i]![0]!;
        const pResMatrix = this.GetNewMat(1, aResultArray.length, true);
        for (i = 0; i < aResultArray.length; i++) pResMatrix.PutDouble(aResultArray[i]!, 0, i);
        this.PushMatrix(pResMatrix);
      }
    }
  }
};

ScInterpreter.prototype.CalculateSmallLarge = function (this: ScInterpreter, bSmall: boolean): void {
  if (!this.MustHaveParamCount(this.GetByte(), 2)) return;

  const { aArray, rCol: nCol, rRow: nRow } = this.GetRankNumberArray();
  const nRankArraySize = aArray.length;
  if (nRankArraySize === 0 || this.nGlobalError !== FormulaError.NONE) {
    this.PushNoValue();
    return;
  }

  const aRankArray = aArray.map((f) => {
    f = bSmall ? approxFloor(f) : approxCeil(f);
    // Valid ranks are >= 1.
    if (f < 1.0 || !(f <= Number.MAX_SAFE_INTEGER)) return 0;
    return f;
  });

  const aSortArray: number[] = [];
  this.GetNumberSequenceArray(1, aSortArray, false);
  const nSize = aSortArray.length;
  if (nSize === 0 || this.nGlobalError !== FormulaError.NONE) this.PushNoValue();
  else if (nRankArraySize === 1) {
    const k = aRankArray[0]!;
    if (k < 1 || nSize < k) {
      if (!Number.isFinite(aArray[0])) this.PushDouble(aArray[0]!); // propagates error
      else this.PushNoValue();
    } else {
      const iPos = bSmall ? k - 1 : nSize - k;
      nth_element(aSortArray);
      this.PushDouble(aSortArray[iPos]!);
    }
  } else {
    // We can spare sorting when the total number of ranks is small enough.
    // Find only the elements at given indices if, arbitrarily, the index size is
    // smaller than 1/3 of the haystack array's size; just sort it squarely, otherwise.
    aSortArray.sort((a, b) => a - b);

    const aResultArray: number[] = [];
    for (let i = 0; i < nRankArraySize; ++i) {
      const n = aRankArray[i]!;
      if (1 <= n && n <= nSize) aResultArray.push(aSortArray[bSmall ? n - 1 : nSize - n]!);
      else if (!Number.isFinite(aArray[i])) aResultArray.push(aArray[i]!); // propagate error
      else aResultArray.push(CreateDoubleError(FormulaError.IllegalArgument));
    }
    const pResult = this.GetNewMat(nCol, nRow, true);
    for (let i = 0; i < aResultArray.length; i++) pResult.PutDouble(aResultArray[i]!, i);
    this.PushMatrix(pResult);
  }
};

ScInterpreter.prototype.ScLarge = function (this: ScInterpreter): void {
  this.CalculateSmallLarge(false);
};

ScInterpreter.prototype.ScSmall = function (this: ScInterpreter): void {
  this.CalculateSmallLarge(true);
};

ScInterpreter.prototype.ScPercentrank = function (this: ScInterpreter, bInclusive: boolean): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 2, 3)) return;
  const fSignificance = nParamCount === 3 ? approxFloor(this.GetDouble()) : 3.0;
  if (fSignificance < 1.0) {
    this.PushIllegalArgument();
    return;
  }
  const fNum = this.GetDouble();
  const aSortArray: number[] = [];
  this.GetSortArray(1, aSortArray, null, false, false);
  const nSize = aSortArray.length;
  if (nSize === 0 || this.nGlobalError !== FormulaError.NONE) this.PushNoValue();
  else {
    if (fNum < aSortArray[0]! || fNum > aSortArray[nSize - 1]!) this.PushNoValue();
    else {
      let fRes: number;
      if (nSize === 1) fRes = 1.0; // fNum == aSortArray[ 0 ], see test above
      else fRes = this.GetPercentrank(aSortArray, fNum, bInclusive);
      if (fRes !== 0.0) {
        const fExp = approxFloor(Math.log10(fRes)) + 1.0 - fSignificance;
        fRes = rtl_math_round(fRes * Math.pow(10, -fExp)) / Math.pow(10, -fExp);
      }
      this.PushDouble(fRes);
    }
  }
};

ScInterpreter.prototype.GetPercentrank = function (this: ScInterpreter, rArray: number[], fVal: number, bInclusive: boolean): number {
  const nSize = rArray.length;
  let fRes: number;
  if (fVal === rArray[0]) {
    if (bInclusive) fRes = 0.0;
    else fRes = 1.0 / (nSize + 1);
  } else {
    let nOldCount = 0;
    let fOldVal = rArray[0]!;
    let i: number;
    for (i = 1; i < nSize && rArray[i]! < fVal; i++) {
      if (rArray[i] !== fOldVal) {
        nOldCount = i;
        fOldVal = rArray[i]!;
      }
    }
    if (rArray[i] !== fOldVal) nOldCount = i;
    if (fVal === rArray[i]) {
      if (bInclusive) fRes = div(nOldCount, nSize - 1);
      else fRes = (i + 1) / (nSize + 1);
    } else {
      //  nOldCount is the count of smaller entries
      //  fVal is between rArray[ nOldCount - 1 ] and rArray[ nOldCount ]
      //  use linear interpolation to find a position between the entries
      if (nOldCount === 0) {
        fRes = 0.0;
      } else {
        const fFract = (fVal - rArray[nOldCount - 1]!) / (rArray[nOldCount]! - rArray[nOldCount - 1]!);
        if (bInclusive) fRes = div(nOldCount - 1 + fFract, nSize - 1);
        else fRes = (nOldCount + fFract) / (nSize + 1);
      }
    }
  }
  return fRes;
};

ScInterpreter.prototype.ScTrimMean = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 2)) return;
  const alpha = this.GetDouble();
  if (alpha < 0.0 || alpha >= 1.0) {
    this.PushIllegalArgument();
    return;
  }
  const aSortArray: number[] = [];
  this.GetSortArray(1, aSortArray, null, false, false);
  const nSize = aSortArray.length;
  if (nSize === 0 || this.nGlobalError !== FormulaError.NONE) this.PushNoValue();
  else {
    let nIndex = approxFloor(alpha * nSize);
    if (nIndex % 2 !== 0) nIndex--;
    nIndex /= 2;
    const fSum = new KahanSum(0.0);
    for (let i = nIndex; i < nSize - nIndex; i++) fSum.add(aSortArray[i]!);
    this.PushDouble(fSum.get() / (nSize - 2 * nIndex));
  }
};

ScInterpreter.prototype.GetRankNumberArray = function (this: ScInterpreter): { aArray: number[]; rCol: number; rRow: number } {
  let aArray: number[] = [];
  let rCol = 0,
    rRow = 0;
  switch (this.GetStackType()) {
    case svDouble:
      aArray.push(this.PopDouble());
      rCol = rRow = 1;
      break;
    case svSingleRef: {
      const aAdr = this.PopSingleRef();
      const aCell = this.mrDoc.GetRefCellValue(aAdr);
      if (aCell.hasNumeric()) {
        aArray.push(this.GetCellValue(aAdr, aCell));
        rCol = rRow = 1;
      }
      break;
    }
    case svDoubleRef: {
      const aRange = this.PopDoubleRef();
      if (this.nGlobalError !== FormulaError.NONE) break;

      // give up unless the start and end are in the same sheet
      if (aRange.aStart.Tab() !== aRange.aEnd.Tab()) {
        this.SetError(FormulaError.IllegalParameter);
        break;
      }

      // the range already is in order
      rCol = aRange.aEnd.Col() - aRange.aStart.Col() + 1;
      rRow = aRange.aEnd.Row() - aRange.aStart.Row() + 1;

      let nErr: FormulaError = FormulaError.NONE;
      const aValIter = new ScValueIterator(this.mrDoc, aRange, this.mnSubTotalFlags);
      for (const v of aValIter.values()) {
        aArray.push(v.fVal);
        nErr = v.nErr;
        if (nErr !== FormulaError.NONE) break;
      }
      // Note that SMALL() and LARGE() rank parameters (2nd) have
      // ParamClass::Value, so in array mode this is never hit and
      // argument was converted to matrix instead, but for normal
      // evaluation any non-numeric value including empty cell will
      // result in error anyway, so just clear and propagate an existing
      // error here already.
      if (aArray.length !== rCol * rRow) {
        aArray = [];
        this.SetError(nErr);
      }
      break;
    }
    case svMatrix:
    case svExternalSingleRef:
    case svExternalDoubleRef: {
      const pMat = this.GetMatrix();
      if (!pMat) break;

      const nCount = pMat.GetElementCount();
      // Do not propagate errors from matrix elements as global error.
      pMat.SetErrorInterpreter(null);
      if (pMat.IsNumeric()) {
        for (let i = 0; i < nCount; ++i) aArray.push(GetMatDouble(pMat, i));
      } else {
        for (let i = 0; i < nCount; ++i) {
          if (pMat.IsValue(i)) aArray.push(GetMatDouble(pMat, i));
          else aArray.push(CreateDoubleError(FormulaError.NoValue));
        }
      }
      ({ nC: rCol, nR: rRow } = pMat.GetDimensions());
      break;
    }
    default:
      this.PopError();
      this.SetError(FormulaError.IllegalParameter);
      break;
  }
  return { aArray, rCol, rRow };
};

ScInterpreter.prototype.GetNumberSequenceArray = function (this: ScInterpreter, nParamCount: number, rArray: number[], bConvertTextInArray: boolean): void {
  const bIgnoreErrVal = (this.mnSubTotalFlags & SubtotalFlags.IgnoreErrVal) !== 0;
  const st = { nParam: nParamCount, nRefInList: 0 };
  this.ReverseStack(nParamCount);
  while (st.nParam-- > 0) {
    const eStackType = this.GetStackType();
    switch (eStackType) {
      case svDouble:
        rArray.push(this.PopDouble());
        break;
      case svSingleRef: {
        const aAdr = this.PopSingleRef();
        const aCell = this.mrDoc.GetRefCellValue(aAdr);
        if (bIgnoreErrVal && aCell.hasError()) {
          // nothing
        } else if (aCell.hasNumeric()) rArray.push(this.GetCellValue(aAdr, aCell));
        break;
      }
      case svDoubleRef:
      case svRefList: {
        const aRange = this.PopDoubleRef(st);
        if (this.nGlobalError !== FormulaError.NONE) break;

        aRange.PutInOrder();

        const aValIter = new ScValueIterator(this.mrDoc, aRange, this.mnSubTotalFlags);
        if (bIgnoreErrVal) {
          for (const v of aValIter.values()) {
            if (v.nErr === FormulaError.NONE) rArray.push(v.fVal);
          }
        } else {
          const nErr = lcl_IterateUntilError(aValIter, (v) => rArray.push(v));
          this.SetError(nErr);
        }
        break;
      }
      case svMatrix:
      case svExternalSingleRef:
      case svExternalDoubleRef: {
        const pMat = this.GetMatrix();
        if (!pMat) break;

        const nCount = pMat.GetElementCount();
        if (pMat.IsNumeric()) {
          if (bIgnoreErrVal) {
            for (let i = 0; i < nCount; ++i) {
              const fVal = GetMatDouble(pMat, i);
              if (this.nGlobalError === FormulaError.NONE) rArray.push(fVal);
              else this.nGlobalError = FormulaError.NONE;
            }
          } else {
            for (let i = 0; i < nCount; ++i) rArray.push(GetMatDouble(pMat, i));
          }
        } else if (bConvertTextInArray && eStackType === svMatrix) {
          for (let i = 0; i < nCount; ++i) {
            if (pMat.IsValue(i)) {
              if (bIgnoreErrVal) {
                const fVal = GetMatDouble(pMat, i);
                if (this.nGlobalError === FormulaError.NONE) rArray.push(fVal);
                else this.nGlobalError = FormulaError.NONE;
              } else rArray.push(GetMatDouble(pMat, i));
            } else {
              // tdf#88547 try to convert string to (date)value
              const aStr = pMat.GetString(i);
              if (aStr.length > 0) {
                const nErr = this.nGlobalError;
                this.nGlobalError = FormulaError.NONE;
                const fVal = this.ConvertStringToValue(aStr);
                if (this.nGlobalError === FormulaError.NONE) {
                  rArray.push(fVal);
                  this.nGlobalError = nErr;
                } else {
                  if (!bIgnoreErrVal) rArray.push(CreateDoubleError(FormulaError.NoValue));
                  // Propagate previous error if any, else
                  // the current #VALUE! error, unless
                  // ignoring error values.
                  if (nErr !== FormulaError.NONE) this.nGlobalError = nErr;
                  else if (!bIgnoreErrVal) this.nGlobalError = FormulaError.NoValue;
                  else this.nGlobalError = FormulaError.NONE;
                }
              }
            }
          }
        } else {
          if (bIgnoreErrVal) {
            for (let i = 0; i < nCount; ++i) {
              if (pMat.IsValue(i)) {
                const fVal = GetMatDouble(pMat, i);
                if (this.nGlobalError === FormulaError.NONE) rArray.push(fVal);
                else this.nGlobalError = FormulaError.NONE;
              }
            }
          } else {
            for (let i = 0; i < nCount; ++i) {
              if (pMat.IsValue(i)) rArray.push(GetMatDouble(pMat, i));
            }
          }
        }
        break;
      }
      default:
        this.PopError();
        this.SetError(FormulaError.IllegalParameter);
        break;
    }
    if (this.nGlobalError !== FormulaError.NONE) break; // while
  }
  // nParam > 0 in case of error, clean stack environment and obtain earlier
  // error if there was one.
  while (st.nParam-- > 0) this.PopError();
};

ScInterpreter.prototype.GetSortArray = function (this: ScInterpreter, nParamCount: number, rSortArray: number[], pIndexOrder: number[] | null, bConvertTextInArray: boolean, bAllowEmptyArray: boolean): void {
  this.GetNumberSequenceArray(nParamCount, rSortArray, bConvertTextInArray);
  if (rSortArray.length > MAX_COUNT_DOUBLE_FOR_SORT(this)) this.SetError(FormulaError.MatrixSize);
  else if (rSortArray.length === 0) {
    if (bAllowEmptyArray) return;
    this.SetError(FormulaError.NoValue);
  }

  if (this.nGlobalError === FormulaError.NONE) this.QuickSort(rSortArray, pIndexOrder);
};

function lcl_QuickSort(nLo: number, nHi: number, rSortArray: number[], pIndexOrder: number[] | null): void {
  // If pIndexOrder is not NULL, we assume rSortArray.size() == pIndexOrder->size().

  const swap = (a: number[], i: number, j: number) => {
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  };

  if (nHi - nLo === 1) {
    if (rSortArray[nLo]! > rSortArray[nHi]!) {
      swap(rSortArray, nLo, nHi);
      if (pIndexOrder) swap(pIndexOrder, nLo, nHi);
    }
    return;
  }

  let ni = nLo;
  let nj = nHi;
  do {
    const fLo = rSortArray[nLo]!;
    while (ni <= nHi && rSortArray[ni]! < fLo) ni++;
    while (nj >= nLo && fLo < rSortArray[nj]!) nj--;
    if (ni <= nj) {
      if (ni !== nj) {
        swap(rSortArray, ni, nj);
        if (pIndexOrder) swap(pIndexOrder, ni, nj);
      }

      ++ni;
      --nj;
    }
  } while (ni < nj);

  if (nj - nLo < nHi - ni) {
    if (nLo < nj) lcl_QuickSort(nLo, nj, rSortArray, pIndexOrder);
    if (ni < nHi) lcl_QuickSort(ni, nHi, rSortArray, pIndexOrder);
  } else {
    if (ni < nHi) lcl_QuickSort(ni, nHi, rSortArray, pIndexOrder);
    if (nLo < nj) lcl_QuickSort(nLo, nj, rSortArray, pIndexOrder);
  }
}

ScInterpreter.prototype.QuickSort = function (this: ScInterpreter, rSortArray: number[], pIndexOrder: number[] | null): void {
  const n = rSortArray.length;

  if (pIndexOrder) {
    pIndexOrder.length = 0;
    for (let i = 0; i < n; ++i) pIndexOrder.push(i);
  }

  if (n < 2) return;

  const nValCount = rSortArray.length;
  for (let i = 0; i + 4 <= nValCount - 1; i += 4) {
    // comphelper::rng::uniform_size_distribution(0, nValCount-2)
    const nInd = Math.floor(Math.random() * (nValCount - 1));
    let t = rSortArray[i]!;
    rSortArray[i] = rSortArray[nInd]!;
    rSortArray[nInd] = t;
    if (pIndexOrder) {
      t = pIndexOrder[i]!;
      pIndexOrder[i] = pIndexOrder[nInd]!;
      pIndexOrder[nInd] = t;
    }
  }

  lcl_QuickSort(0, n - 1, rSortArray, pIndexOrder);
};

ScInterpreter.prototype.ScRank = function (this: ScInterpreter, bAverage: boolean): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 2, 3)) return;
  let bAscending: boolean;
  if (nParamCount === 3) bAscending = this.GetBool();
  else bAscending = false;

  const aSortArray: number[] = [];
  this.GetSortArray(1, aSortArray, null, false, false);
  const fVal = this.GetDouble();
  const nSize = aSortArray.length;
  if (nSize === 0 || this.nGlobalError !== FormulaError.NONE) this.PushNoValue();
  else {
    if (fVal < aSortArray[0]! || fVal > aSortArray[nSize - 1]!) this.PushError(FormulaError.NotAvailable);
    else {
      let fLastPos = 0;
      let fFirstPos = -1.0;
      let bFinished = false;
      let i: number;
      for (i = 0; i < nSize && !bFinished; i++) {
        if (aSortArray[i] === fVal) {
          if (fFirstPos < 0) fFirstPos = i + 1.0;
        } else {
          if (aSortArray[i]! > fVal) {
            fLastPos = i;
            bFinished = true;
          }
        }
      }
      if (!bFinished) fLastPos = i;
      if (fFirstPos <= 0) {
        this.PushError(FormulaError.NotAvailable);
      } else if (!bAverage) {
        if (bAscending) this.PushDouble(fFirstPos);
        else this.PushDouble(nSize + 1.0 - fLastPos);
      } else {
        if (bAscending) this.PushDouble((fFirstPos + fLastPos) / 2.0);
        else this.PushDouble(nSize + 1.0 - (fFirstPos + fLastPos) / 2.0);
      }
    }
  }
};

ScInterpreter.prototype.ScAveDev = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCountMin(nParamCount, 1)) return;
  const SaveSP = this.sp;
  let nMiddle = 0.0;
  let rVal = new KahanSum(0.0);
  let rValCount = 0.0;
  const st = { nParam: nParamCount, nRefInList: 0 };
  while (st.nParam-- > 0) {
    switch (this.GetStackType()) {
      case svDouble:
        rVal.add(this.GetDouble());
        rValCount++;
        break;
      case svSingleRef: {
        const aAdr = this.PopSingleRef();
        const aCell = this.mrDoc.GetRefCellValue(aAdr);
        if (aCell.hasNumeric()) {
          rVal.add(this.GetCellValue(aAdr, aCell));
          rValCount++;
        }
        break;
      }
      case svDoubleRef:
      case svRefList: {
        const aRange = this.PopDoubleRef(st);
        const aValIter = new ScValueIterator(this.mrDoc, aRange, this.mnSubTotalFlags);
        const nErr = lcl_IterateUntilError(aValIter, (v) => {
          rVal.add(v);
          rValCount++;
        });
        this.SetError(nErr);
        break;
      }
      case svMatrix:
      case svExternalSingleRef:
      case svExternalDoubleRef: {
        const pMat = this.GetMatrix();
        if (pMat) {
          const nCount = pMat.GetElementCount();
          if (pMat.IsNumeric()) {
            for (let nElem = 0; nElem < nCount; nElem++) {
              rVal.add(GetMatDouble(pMat, nElem));
              rValCount++;
            }
          } else {
            for (let nElem = 0; nElem < nCount; nElem++)
              if (!pMat.IsStringOrEmpty(nElem)) {
                rVal.add(GetMatDouble(pMat, nElem));
                rValCount++;
              }
          }
        }
        break;
      }
      default:
        this.SetError(FormulaError.IllegalParameter);
        break;
    }
  }
  if (this.nGlobalError !== FormulaError.NONE) {
    this.PushError(this.nGlobalError);
    return;
  }
  nMiddle = rVal.get() / rValCount;
  this.sp = SaveSP;
  rVal = new KahanSum(0.0);
  st.nParam = nParamCount;
  st.nRefInList = 0;
  while (st.nParam-- > 0) {
    switch (this.GetStackType()) {
      case svDouble:
        rVal.add(Math.abs(this.GetDouble() - nMiddle));
        break;
      case svSingleRef: {
        const aAdr = this.PopSingleRef();
        const aCell = this.mrDoc.GetRefCellValue(aAdr);
        if (aCell.hasNumeric()) rVal.add(Math.abs(this.GetCellValue(aAdr, aCell) - nMiddle));
        break;
      }
      case svDoubleRef:
      case svRefList: {
        const aRange = this.PopDoubleRef(st);
        const aValIter = new ScValueIterator(this.mrDoc, aRange, this.mnSubTotalFlags);
        for (const v of aValIter.values()) rVal.add(Math.abs(v.fVal - nMiddle));
        break;
      }
      case svMatrix:
      case svExternalSingleRef:
      case svExternalDoubleRef: {
        const pMat = this.GetMatrix();
        if (pMat) {
          const nCount = pMat.GetElementCount();
          if (pMat.IsNumeric()) {
            for (let nElem = 0; nElem < nCount; nElem++) {
              rVal.add(Math.abs(GetMatDouble(pMat, nElem) - nMiddle));
            }
          } else {
            for (let nElem = 0; nElem < nCount; nElem++) {
              if (!pMat.IsStringOrEmpty(nElem)) rVal.add(Math.abs(GetMatDouble(pMat, nElem) - nMiddle));
            }
          }
        }
        break;
      }
      default:
        this.SetError(FormulaError.IllegalParameter);
        break;
    }
  }
  this.PushDouble(rVal.get() / rValCount);
};

ScInterpreter.prototype.ScDevSq = function (this: ScInterpreter): void {
  const VarResult = (fVal: number, _nValCount: number): number => fVal;
  this.GetStVarParams(false /*bTextAsZero*/, VarResult);
};

ScInterpreter.prototype.ScProbability = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 3, 4)) return;
  let fUp: number, fLo: number;
  fUp = this.GetDouble();
  if (nParamCount === 4) fLo = this.GetDouble();
  else fLo = fUp;
  if (fLo > fUp) [fLo, fUp] = [fUp, fLo];
  const pMatP = this.GetMatrix();
  const pMatW = this.GetMatrix();
  if (!pMatP || !pMatW) this.PushIllegalParameter();
  else {
    const { nC: nC1, nR: nR1 } = pMatP.GetDimensions();
    const { nC: nC2, nR: nR2 } = pMatW.GetDimensions();
    if (nC1 !== nC2 || nR1 !== nR2 || nC1 === 0 || nR1 === 0 || nC2 === 0 || nR2 === 0) this.PushNA();
    else {
      const fSum = new KahanSum(0.0);
      const fRes = new KahanSum(0.0);
      let bStop = false;
      let fP: number, fW: number;
      for (let i = 0; i < nC1 && !bStop; i++) {
        for (let j = 0; j < nR1 && !bStop; ++j) {
          if (pMatP.IsValue(i, j) && pMatW.IsValue(i, j)) {
            fP = pMatP.GetDouble(i, j);
            fW = pMatW.GetDouble(i, j);
            if (fP < 0.0 || fP > 1.0) bStop = true;
            else {
              fSum.add(fP);
              if (fW >= fLo && fW <= fUp) fRes.add(fP);
            }
          } else this.SetError(FormulaError.IllegalArgument);
        }
      }
      if (bStop || Math.abs(ksub(fSum, 1.0).get()) > 1.0e-7) this.PushNoValue();
      else this.PushDouble(fRes.get());
    }
  }
};

ScInterpreter.prototype.ScCorrel = function (this: ScInterpreter): void {
  // This is identical to ScPearson()
  this.ScPearson();
};

ScInterpreter.prototype.ScCovarianceP = function (this: ScInterpreter): void {
  this.CalculatePearsonCovar(false, false, false);
};

ScInterpreter.prototype.ScCovarianceS = function (this: ScInterpreter): void {
  this.CalculatePearsonCovar(false, false, true);
};

ScInterpreter.prototype.ScPearson = function (this: ScInterpreter): void {
  this.CalculatePearsonCovar(true, false, false);
};

ScInterpreter.prototype.CalculatePearsonCovar = function (this: ScInterpreter, _bPearson: boolean, _bStexy: boolean, _bSample: boolean): void {
  if (!this.MustHaveParamCount(this.GetByte(), 2)) return;
  const pMat1 = this.GetMatrix();
  const pMat2 = this.GetMatrix();
  if (!pMat1 || !pMat2) {
    this.PushIllegalParameter();
    return;
  }
  const { nC: nC1, nR: nR1 } = pMat1.GetDimensions();
  const { nC: nC2, nR: nR2 } = pMat2.GetDimensions();
  if (nR1 !== nR2 || nC1 !== nC2) {
    this.PushIllegalArgument();
    return;
  }
  /* #i78250#
   * (sum((X-MeanX)(Y-MeanY)))/N equals (SumXY)/N-MeanX*MeanY mathematically,
   * but the latter produces wrong results if the absolute values are high,
   * for example above 10^8
   */
  let fCount = 0.0;
  const fSumX = new KahanSum(0.0);
  const fSumY = new KahanSum(0.0);

  for (let i = 0; i < nC1; i++) {
    for (let j = 0; j < nR1; j++) {
      if (!pMat1.IsStringOrEmpty(i, j) && !pMat2.IsStringOrEmpty(i, j)) {
        fSumX.add(pMat1.GetDouble(i, j));
        fSumY.add(pMat2.GetDouble(i, j));
        fCount++;
      }
    }
  }
  if (fCount < (_bStexy ? 3.0 : _bSample ? 2.0 : 1.0)) this.PushNoValue();
  else {
    const fSumDeltaXDeltaY = new KahanSum(0.0); // sum of (ValX-MeanX)*(ValY-MeanY)
    const fSumSqrDeltaX = new KahanSum(0.0); // sum of (ValX-MeanX)^2
    const fSumSqrDeltaY = new KahanSum(0.0); // sum of (ValY-MeanY)^2
    const fMeanX = fSumX.get() / fCount;
    const fMeanY = fSumY.get() / fCount;
    for (let i = 0; i < nC1; i++) {
      for (let j = 0; j < nR1; j++) {
        if (!pMat1.IsStringOrEmpty(i, j) && !pMat2.IsStringOrEmpty(i, j)) {
          const fValX = pMat1.GetDouble(i, j);
          const fValY = pMat2.GetDouble(i, j);
          fSumDeltaXDeltaY.add((fValX - fMeanX) * (fValY - fMeanY));
          if (_bPearson) {
            fSumSqrDeltaX.add((fValX - fMeanX) * (fValX - fMeanX));
            fSumSqrDeltaY.add((fValY - fMeanY) * (fValY - fMeanY));
          }
        }
      }
    }
    if (_bPearson) {
      // tdf#94962 - Values below the numerical limit lead to unexpected results
      if (fSumSqrDeltaX.get() < DBL_MIN || (!_bStexy && fSumSqrDeltaY.get() < DBL_MIN)) this.PushError(FormulaError.DivisionByZero);
      else if (_bStexy)
        this.PushDouble(Math.sqrt(ksub(fSumSqrDeltaY, (fSumDeltaXDeltaY.get() * fSumDeltaXDeltaY.get()) / fSumSqrDeltaX.get()).get() / (fCount - 2)));
      else this.PushDouble(fSumDeltaXDeltaY.get() / Math.sqrt(fSumSqrDeltaX.get() * fSumSqrDeltaY.get()));
    } else {
      if (_bSample) this.PushDouble(fSumDeltaXDeltaY.get() / (fCount - 1));
      else this.PushDouble(fSumDeltaXDeltaY.get() / fCount);
    }
  }
};

ScInterpreter.prototype.ScRSQ = function (this: ScInterpreter): void {
  // Same as ScPearson()*ScPearson()
  this.ScPearson();
  if (this.nGlobalError !== FormulaError.NONE) return;

  switch (this.GetStackType()) {
    case svDouble: {
      const fVal = this.PopDouble();
      this.PushDouble(fVal * fVal);
      break;
    }
    default:
      this.PopError();
      this.PushNoValue();
  }
};

ScInterpreter.prototype.ScSTEYX = function (this: ScInterpreter): void {
  this.CalculatePearsonCovar(true, true, false);
};

ScInterpreter.prototype.CalculateSlopeIntercept = function (this: ScInterpreter, bSlope: boolean): void {
  if (!this.MustHaveParamCount(this.GetByte(), 2)) return;
  const pMat1 = this.GetMatrix();
  const pMat2 = this.GetMatrix();
  if (!pMat1 || !pMat2) {
    this.PushIllegalParameter();
    return;
  }
  const { nC: nC1, nR: nR1 } = pMat1.GetDimensions();
  const { nC: nC2, nR: nR2 } = pMat2.GetDimensions();
  if (nR1 !== nR2 || nC1 !== nC2) {
    this.PushIllegalArgument();
    return;
  }
  // #i78250# numerical stability improved
  let fCount = 0.0;
  const fSumX = new KahanSum(0.0);
  const fSumY = new KahanSum(0.0);

  for (let i = 0; i < nC1; i++) {
    for (let j = 0; j < nR1; j++) {
      if (!pMat1.IsStringOrEmpty(i, j) && !pMat2.IsStringOrEmpty(i, j)) {
        fSumX.add(pMat1.GetDouble(i, j));
        fSumY.add(pMat2.GetDouble(i, j));
        fCount++;
      }
    }
  }
  if (fCount < 1.0) this.PushNoValue();
  else {
    const fSumDeltaXDeltaY = new KahanSum(0.0); // sum of (ValX-MeanX)*(ValY-MeanY)
    const fSumSqrDeltaX = new KahanSum(0.0); // sum of (ValX-MeanX)^2
    const fMeanX = fSumX.get() / fCount;
    const fMeanY = fSumY.get() / fCount;
    for (let i = 0; i < nC1; i++) {
      for (let j = 0; j < nR1; j++) {
        if (!pMat1.IsStringOrEmpty(i, j) && !pMat2.IsStringOrEmpty(i, j)) {
          const fValX = pMat1.GetDouble(i, j);
          const fValY = pMat2.GetDouble(i, j);
          fSumDeltaXDeltaY.add((fValX - fMeanX) * (fValY - fMeanY));
          fSumSqrDeltaX.add((fValX - fMeanX) * (fValX - fMeanX));
        }
      }
    }
    if (fSumSqrDeltaX.get() === 0.0) this.PushError(FormulaError.DivisionByZero);
    else {
      if (bSlope) this.PushDouble(fSumDeltaXDeltaY.get() / fSumSqrDeltaX.get());
      else this.PushDouble(fMeanY - (fSumDeltaXDeltaY.get() / fSumSqrDeltaX.get()) * fMeanX);
    }
  }
};

ScInterpreter.prototype.ScSlope = function (this: ScInterpreter): void {
  this.CalculateSlopeIntercept(true);
};

ScInterpreter.prototype.ScIntercept = function (this: ScInterpreter): void {
  this.CalculateSlopeIntercept(false);
};

ScInterpreter.prototype.ScForecast = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 3)) return;
  const pMat1 = this.GetMatrix();
  const pMat2 = this.GetMatrix();
  if (!pMat1 || !pMat2) {
    this.PushIllegalParameter();
    return;
  }
  const { nC: nC1, nR: nR1 } = pMat1.GetDimensions();
  const { nC: nC2, nR: nR2 } = pMat2.GetDimensions();
  if (nR1 !== nR2 || nC1 !== nC2) {
    this.PushIllegalArgument();
    return;
  }
  const fVal = this.GetDouble();
  // #i78250# numerical stability improved
  let fCount = 0.0;
  const fSumX = new KahanSum(0.0);
  const fSumY = new KahanSum(0.0);

  for (let i = 0; i < nC1; i++) {
    for (let j = 0; j < nR1; j++) {
      if (!pMat1.IsStringOrEmpty(i, j) && !pMat2.IsStringOrEmpty(i, j)) {
        fSumX.add(pMat1.GetDouble(i, j));
        fSumY.add(pMat2.GetDouble(i, j));
        fCount++;
      }
    }
  }
  if (fCount < 1.0) this.PushNoValue();
  else {
    const fSumDeltaXDeltaY = new KahanSum(0.0); // sum of (ValX-MeanX)*(ValY-MeanY)
    const fSumSqrDeltaX = new KahanSum(0.0); // sum of (ValX-MeanX)^2
    const fMeanX = fSumX.get() / fCount;
    const fMeanY = fSumY.get() / fCount;
    for (let i = 0; i < nC1; i++) {
      for (let j = 0; j < nR1; j++) {
        if (!pMat1.IsStringOrEmpty(i, j) && !pMat2.IsStringOrEmpty(i, j)) {
          const fValX = pMat1.GetDouble(i, j);
          const fValY = pMat2.GetDouble(i, j);
          fSumDeltaXDeltaY.add((fValX - fMeanX) * (fValY - fMeanY));
          fSumSqrDeltaX.add((fValX - fMeanX) * (fValX - fMeanX));
        }
      }
    }
    if (fSumSqrDeltaX.get() === 0.0) this.PushError(FormulaError.DivisionByZero);
    else this.PushDouble(fMeanY + (fSumDeltaXDeltaY.get() / fSumSqrDeltaX.get()) * (fVal - fMeanX));
  }
};

// Registration (the opcode dispatch of interpr4.cxx)
ScInterpreter.Register(OC.ocFact, ScInterpreter.prototype.ScFact);
ScInterpreter.Register(OC.ocPhi, ScInterpreter.prototype.ScPhi);
ScInterpreter.Register(OC.ocGauss, ScInterpreter.prototype.ScGauss);
ScInterpreter.Register(OC.ocStdNormDist, ScInterpreter.prototype.ScStdNormDist);
ScInterpreter.Register(OC.ocStdNormDist_MS, ScInterpreter.prototype.ScStdNormDist_MS);
ScInterpreter.Register(OC.ocFisher, ScInterpreter.prototype.ScFisher);
ScInterpreter.Register(OC.ocFisherInv, ScInterpreter.prototype.ScFisherInv);
ScInterpreter.Register(OC.ocB, ScInterpreter.prototype.ScB);
ScInterpreter.Register(OC.ocNormDist, function (this: ScInterpreter) { this.ScNormDist(3); });
ScInterpreter.Register(OC.ocNormDist_MS, function (this: ScInterpreter) { this.ScNormDist(4); });
ScInterpreter.Register(OC.ocExpDist, ScInterpreter.prototype.ScExpDist);
ScInterpreter.Register(OC.ocExpDist_MS, ScInterpreter.prototype.ScExpDist);
ScInterpreter.Register(OC.ocBinomDist, ScInterpreter.prototype.ScBinomDist);
ScInterpreter.Register(OC.ocBinomDist_MS, ScInterpreter.prototype.ScBinomDist);
ScInterpreter.Register(OC.ocPoissonDist, function (this: ScInterpreter) { this.ScPoissonDist(true); });
ScInterpreter.Register(OC.ocPoissonDist_MS, function (this: ScInterpreter) { this.ScPoissonDist(false); });
ScInterpreter.Register(OC.ocCombin, ScInterpreter.prototype.ScCombin);
ScInterpreter.Register(OC.ocCombinA, ScInterpreter.prototype.ScCombinA);
ScInterpreter.Register(OC.ocPermut, ScInterpreter.prototype.ScPermut);
ScInterpreter.Register(OC.ocPermutationA, ScInterpreter.prototype.ScPermutationA);
ScInterpreter.Register(OC.ocHypGeomDist, function (this: ScInterpreter) { this.ScHypGeomDist(4); });
ScInterpreter.Register(OC.ocHypGeomDist_MS, function (this: ScInterpreter) { this.ScHypGeomDist(5); });
ScInterpreter.Register(OC.ocLogNormDist, function (this: ScInterpreter) { this.ScLogNormDist(1); });
ScInterpreter.Register(OC.ocLogNormDist_MS, function (this: ScInterpreter) { this.ScLogNormDist(4); });
ScInterpreter.Register(OC.ocTDist, ScInterpreter.prototype.ScTDist);
ScInterpreter.Register(OC.ocTDist_MS, ScInterpreter.prototype.ScTDist_MS);
ScInterpreter.Register(OC.ocTDist_RT, function (this: ScInterpreter) { this.ScTDist_T(1); });
ScInterpreter.Register(OC.ocTDist_2T, function (this: ScInterpreter) { this.ScTDist_T(2); });
ScInterpreter.Register(OC.ocFDist, ScInterpreter.prototype.ScFDist);
ScInterpreter.Register(OC.ocFDist_RT, ScInterpreter.prototype.ScFDist);
ScInterpreter.Register(OC.ocFDist_LT, ScInterpreter.prototype.ScFDist_LT);
ScInterpreter.Register(OC.ocChiDist, function (this: ScInterpreter) { this.ScChiDist(true); });
ScInterpreter.Register(OC.ocChiDist_MS, function (this: ScInterpreter) { this.ScChiDist(false); });
ScInterpreter.Register(OC.ocChiSqDist, ScInterpreter.prototype.ScChiSqDist);
ScInterpreter.Register(OC.ocChiSqDist_MS, ScInterpreter.prototype.ScChiSqDist_MS);
ScInterpreter.Register(OC.ocStandard, ScInterpreter.prototype.ScStandard);
ScInterpreter.Register(OC.ocAveDev, ScInterpreter.prototype.ScAveDev);
ScInterpreter.Register(OC.ocDevSq, ScInterpreter.prototype.ScDevSq);
ScInterpreter.Register(OC.ocKurt, ScInterpreter.prototype.ScKurt);
ScInterpreter.Register(OC.ocSkew, ScInterpreter.prototype.ScSkew);
ScInterpreter.Register(OC.ocSkewp, ScInterpreter.prototype.ScSkewp);
ScInterpreter.Register(OC.ocModalValue, ScInterpreter.prototype.ScModalValue);
ScInterpreter.Register(OC.ocModalValue_MS, function (this: ScInterpreter) { this.ScModalValue_MS(true); });
ScInterpreter.Register(OC.ocModalValue_Multi, function (this: ScInterpreter) { this.ScModalValue_MS(false); });
ScInterpreter.Register(OC.ocMedian, ScInterpreter.prototype.ScMedian);
ScInterpreter.Register(OC.ocGeoMean, ScInterpreter.prototype.ScGeoMean);
ScInterpreter.Register(OC.ocHarMean, ScInterpreter.prototype.ScHarMean);
ScInterpreter.Register(OC.ocWeibull, ScInterpreter.prototype.ScWeibull);
ScInterpreter.Register(OC.ocWeibull_MS, ScInterpreter.prototype.ScWeibull);
ScInterpreter.Register(OC.ocBinomInv, ScInterpreter.prototype.ScCritBinom);
ScInterpreter.Register(OC.ocCritBinom, ScInterpreter.prototype.ScCritBinom);
ScInterpreter.Register(OC.ocNegBinomVert, ScInterpreter.prototype.ScNegBinomDist);
ScInterpreter.Register(OC.ocNegBinomDist_MS, ScInterpreter.prototype.ScNegBinomDist_MS);
ScInterpreter.Register(OC.ocZTest, ScInterpreter.prototype.ScZTest);
ScInterpreter.Register(OC.ocZTest_MS, ScInterpreter.prototype.ScZTest);
ScInterpreter.Register(OC.ocTTest, ScInterpreter.prototype.ScTTest);
ScInterpreter.Register(OC.ocTTest_MS, ScInterpreter.prototype.ScTTest);
ScInterpreter.Register(OC.ocFTest, ScInterpreter.prototype.ScFTest);
ScInterpreter.Register(OC.ocFTest_MS, ScInterpreter.prototype.ScFTest);
ScInterpreter.Register(OC.ocRank, function (this: ScInterpreter) { this.ScRank(false); });
ScInterpreter.Register(OC.ocRank_Eq, function (this: ScInterpreter) { this.ScRank(false); });
ScInterpreter.Register(OC.ocRank_Avg, function (this: ScInterpreter) { this.ScRank(true); });
ScInterpreter.Register(OC.ocPercentile, function (this: ScInterpreter) { this.ScPercentile(true); });
ScInterpreter.Register(OC.ocPercentile_Inc, function (this: ScInterpreter) { this.ScPercentile(true); });
ScInterpreter.Register(OC.ocPercentile_Exc, function (this: ScInterpreter) { this.ScPercentile(false); });
ScInterpreter.Register(OC.ocPercentrank, function (this: ScInterpreter) { this.ScPercentrank(true); });
ScInterpreter.Register(OC.ocPercentrank_Inc, function (this: ScInterpreter) { this.ScPercentrank(true); });
ScInterpreter.Register(OC.ocPercentrank_Exc, function (this: ScInterpreter) { this.ScPercentrank(false); });
ScInterpreter.Register(OC.ocLarge, ScInterpreter.prototype.ScLarge);
ScInterpreter.Register(OC.ocSmall, ScInterpreter.prototype.ScSmall);
ScInterpreter.Register(OC.ocQuartile, function (this: ScInterpreter) { this.ScQuartile(true); });
ScInterpreter.Register(OC.ocQuartile_Inc, function (this: ScInterpreter) { this.ScQuartile(true); });
ScInterpreter.Register(OC.ocQuartile_Exc, function (this: ScInterpreter) { this.ScQuartile(false); });
ScInterpreter.Register(OC.ocNormInv, ScInterpreter.prototype.ScNormInv);
ScInterpreter.Register(OC.ocNormInv_MS, ScInterpreter.prototype.ScNormInv);
ScInterpreter.Register(OC.ocSNormInv, ScInterpreter.prototype.ScSNormInv);
ScInterpreter.Register(OC.ocSNormInv_MS, ScInterpreter.prototype.ScSNormInv);
ScInterpreter.Register(OC.ocConfidence, ScInterpreter.prototype.ScConfidence);
ScInterpreter.Register(OC.ocConfidence_N, ScInterpreter.prototype.ScConfidence);
ScInterpreter.Register(OC.ocConfidence_T, ScInterpreter.prototype.ScConfidenceT);
ScInterpreter.Register(OC.ocTrimMean, ScInterpreter.prototype.ScTrimMean);
ScInterpreter.Register(OC.ocProb, ScInterpreter.prototype.ScProbability);
ScInterpreter.Register(OC.ocCorrel, ScInterpreter.prototype.ScCorrel);
ScInterpreter.Register(OC.ocCovar, ScInterpreter.prototype.ScCovarianceP);
ScInterpreter.Register(OC.ocCovarianceP, ScInterpreter.prototype.ScCovarianceP);
ScInterpreter.Register(OC.ocCovarianceS, ScInterpreter.prototype.ScCovarianceS);
ScInterpreter.Register(OC.ocPearson, ScInterpreter.prototype.ScPearson);
ScInterpreter.Register(OC.ocRSQ, ScInterpreter.prototype.ScRSQ);
ScInterpreter.Register(OC.ocSTEYX, ScInterpreter.prototype.ScSTEYX);
ScInterpreter.Register(OC.ocSlope, ScInterpreter.prototype.ScSlope);
ScInterpreter.Register(OC.ocIntercept, ScInterpreter.prototype.ScIntercept);
ScInterpreter.Register(OC.ocForecast_LIN, ScInterpreter.prototype.ScForecast);
ScInterpreter.Register(OC.ocForecast, ScInterpreter.prototype.ScForecast);
ScInterpreter.Register(OC.ocGammaLn, ScInterpreter.prototype.ScLogGamma);
ScInterpreter.Register(OC.ocGammaLn_MS, ScInterpreter.prototype.ScLogGamma);
ScInterpreter.Register(OC.ocGamma, ScInterpreter.prototype.ScGamma);
ScInterpreter.Register(OC.ocGammaDist, function (this: ScInterpreter) { this.ScGammaDist(true); });
ScInterpreter.Register(OC.ocGammaDist_MS, function (this: ScInterpreter) { this.ScGammaDist(false); });
ScInterpreter.Register(OC.ocGammaInv, ScInterpreter.prototype.ScGammaInv);
ScInterpreter.Register(OC.ocGammaInv_MS, ScInterpreter.prototype.ScGammaInv);
ScInterpreter.Register(OC.ocChiTest, ScInterpreter.prototype.ScChiTest);
ScInterpreter.Register(OC.ocChiTest_MS, ScInterpreter.prototype.ScChiTest);
ScInterpreter.Register(OC.ocChiInv, ScInterpreter.prototype.ScChiInv);
ScInterpreter.Register(OC.ocChiInv_MS, ScInterpreter.prototype.ScChiInv);
ScInterpreter.Register(OC.ocChiSqInv, ScInterpreter.prototype.ScChiSqInv);
ScInterpreter.Register(OC.ocChiSqInv_MS, ScInterpreter.prototype.ScChiSqInv);
ScInterpreter.Register(OC.ocTInv, function (this: ScInterpreter) { this.ScTInv(2); });
ScInterpreter.Register(OC.ocTInv_2T, function (this: ScInterpreter) { this.ScTInv(2); });
ScInterpreter.Register(OC.ocTInv_MS, function (this: ScInterpreter) { this.ScTInv(4); });
ScInterpreter.Register(OC.ocFInv, ScInterpreter.prototype.ScFInv);
ScInterpreter.Register(OC.ocFInv_RT, ScInterpreter.prototype.ScFInv);
ScInterpreter.Register(OC.ocFInv_LT, ScInterpreter.prototype.ScFInv_LT);
ScInterpreter.Register(OC.ocLogInv, ScInterpreter.prototype.ScLogNormInv);
ScInterpreter.Register(OC.ocLogInv_MS, ScInterpreter.prototype.ScLogNormInv);
ScInterpreter.Register(OC.ocBetaDist, ScInterpreter.prototype.ScBetaDist);
ScInterpreter.Register(OC.ocBetaDist_MS, ScInterpreter.prototype.ScBetaDist_MS);
ScInterpreter.Register(OC.ocBetaInv, ScInterpreter.prototype.ScBetaInv);
ScInterpreter.Register(OC.ocBetaInv_MS, ScInterpreter.prototype.ScBetaInv);

// @@ STATISTICS @@

ScInterpreter.Register(OC.ocNoName, ScInterpreter.prototype.ScNoName);
ScInterpreter.Register(OC.ocBad, ScInterpreter.prototype.ScBadName);
