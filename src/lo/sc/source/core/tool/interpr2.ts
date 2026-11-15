// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/core/tool/interpr2.cxx partial
// Date and time, the rounding functions and other math, the financial functions and the
// reference operators (intersection, range, union). Function families are added between the
// section markers below.
import { FormulaError } from '../../../../include/formula/errorcodes.ts';
import * as OC from '../../../../include/formula/opcode.ts';
import { svDoubleRef, svRefList, svSingleRef, svUnknown, type FormulaToken } from '../../../../formula/source/core/api/token.ts';
import { ScComplexRefData } from '../../../inc/refdata.ts';
import { ScInterpreter } from './interpr4.ts';
import { ScDoubleRefToken, ScRefListToken, ScSingleRefToken, extendRangeReference, type ScRefList } from './token.ts';

declare module './interpr4.ts' {
  interface ScInterpreter {
    ScIntersect(): void;
    ScRangeFunc(): void;
    ScUnionFunc(): void;
    ScCurrent(): void;
    ValidateRef(rRefList: ScRefList): void;
  }
}

// @@ DATETIME @@

// @@ MATH (rounding, ABS, INT, MOD, LOG, ...) @@

// @@ FINANCIAL @@

// --- reference operators ------------------------------------------------------------------------

ScInterpreter.prototype.ScIntersect = function (this: ScInterpreter): void {
  const p2nd = this.PopToken();
  const p1st = this.PopToken();
  if (this.nGlobalError !== FormulaError.NONE || !p2nd || !p1st) {
    this.PushIllegalArgument();
    return;
  }
  const sv1 = p1st.GetType();
  const sv2 = p2nd.GetType();
  if ((sv1 !== svSingleRef && sv1 !== svDoubleRef && sv1 !== svRefList) || (sv2 !== svSingleRef && sv2 !== svDoubleRef && sv2 !== svRefList)) {
    this.PushIllegalArgument();
    return;
  }
  if (sv1 === svRefList || sv2 === svRefList) {
    // Now this is a bit nasty but it simplifies things, and having
    // intersections with lists isn't too common, if at all...
    // Convert a reference to list.
    const toList = (t: FormulaToken, sv: number): ScRefList => {
      if (sv === svSingleRef) {
        const aRef = new ScComplexRefData();
        aRef.Ref1 = t.GetSingleRef().clone();
        aRef.Ref2 = t.GetSingleRef().clone();
        return [aRef];
      }
      if (sv === svDoubleRef) return [t.GetDoubleRef() as ScComplexRefData];
      return t.GetRefList() as ScRefList;
    };
    const l1 = toList(p1st, sv1), l2 = toList(p2nd, sv2);
    const xRes = new ScRefListToken();
    const pRefList = xRes.GetRefList();
    for (const rRef1 of l1) {
      const r11 = rRef1.Ref1.toAbs(this.mrDoc, this.aPos);
      const r12 = rRef1.Ref2.toAbs(this.mrDoc, this.aPos);
      for (const rRef2 of l2) {
        const r21 = rRef2.Ref1.toAbs(this.mrDoc, this.aPos);
        const r22 = rRef2.Ref2.toAbs(this.mrDoc, this.aPos);
        const nCol1 = Math.max(r11.Col(), r21.Col());
        const nRow1 = Math.max(r11.Row(), r21.Row());
        const nTab1 = Math.max(r11.Tab(), r21.Tab());
        const nCol2 = Math.min(r12.Col(), r22.Col());
        const nRow2 = Math.min(r12.Row(), r22.Row());
        const nTab2 = Math.min(r12.Tab(), r22.Tab());
        if (nCol2 < nCol1 || nRow2 < nRow1 || nTab2 < nTab1) {
          // nothing
        } else {
          const aRef = new ScComplexRefData();
          aRef.InitRange(nCol1, nRow1, nTab1, nCol2, nRow2, nTab2);
          pRefList.push(aRef);
        }
      }
    }
    const n = pRefList.length;
    if (!n) this.PushError(FormulaError.NoCode);
    else if (n === 1) {
      const rRef = pRefList[0]!;
      if (rRef.Ref1.equals(rRef.Ref2)) this.PushTempToken(new ScSingleRefToken(this.mrDoc.GetSheetLimits(), rRef.Ref1));
      else this.PushTempToken(new ScDoubleRefToken(this.mrDoc.GetSheetLimits(), rRef));
    } else this.PushTokenRef(xRes);
  } else {
    const pt = [p1st, p2nd];
    const sv = [sv1, sv2];
    const nC1 = [0, 0], nC2 = [0, 0], nR1 = [0, 0], nR2 = [0, 0], nT1 = [0, 0], nT2 = [0, 0];
    for (let i = 0; i < 2; ++i) {
      const r = (sv[i] === svSingleRef ? pt[i]!.GetSingleRef() : (pt[i]!.GetDoubleRef() as ScComplexRefData).Ref1).toAbs(this.mrDoc, this.aPos);
      nC1[i] = r.Col();
      nR1[i] = r.Row();
      nT1[i] = r.Tab();
      if (sv[i] === svDoubleRef) {
        const r2 = (pt[i]!.GetDoubleRef() as ScComplexRefData).Ref2.toAbs(this.mrDoc, this.aPos);
        nC2[i] = r2.Col();
        nR2[i] = r2.Row();
        nT2[i] = r2.Tab();
      } else {
        nC2[i] = nC1[i]!;
        nR2[i] = nR1[i]!;
        nT2[i] = nT1[i]!;
      }
    }
    const nCol1 = Math.max(nC1[0]!, nC1[1]!);
    const nRow1 = Math.max(nR1[0]!, nR1[1]!);
    const nTab1 = Math.max(nT1[0]!, nT1[1]!);
    const nCol2 = Math.min(nC2[0]!, nC2[1]!);
    const nRow2 = Math.min(nR2[0]!, nR2[1]!);
    const nTab2 = Math.min(nT2[0]!, nT2[1]!);
    if (nCol2 < nCol1 || nRow2 < nRow1 || nTab2 < nTab1) this.PushError(FormulaError.NoCode);
    else if (nCol2 === nCol1 && nRow2 === nRow1 && nTab2 === nTab1) this.PushSingleRef(nCol1, nRow1, nTab1);
    else this.PushDoubleRef(nCol1, nRow1, nTab1, nCol2, nRow2, nTab2);
  }
};

ScInterpreter.prototype.ScRangeFunc = function (this: ScInterpreter): void {
  const x2 = this.PopToken();
  const x1 = this.PopToken();
  if (this.nGlobalError !== FormulaError.NONE || !x2 || !x1) {
    this.PushIllegalArgument();
    return;
  }
  // We explicitly tell extendRangeReference() to not reuse the token,
  // casting const away spares two clones.
  const xRes = extendRangeReference(this.mrDoc.GetSheetLimits(), x1, x2, this.aPos, false);
  if (!xRes) this.PushIllegalArgument();
  else this.PushTokenRef(xRes);
};

ScInterpreter.prototype.ValidateRef = function (this: ScInterpreter, rRefList: ScRefList): void {
  for (const rRef of rRefList) this.DoubleRefToRange(rRef);
};

ScInterpreter.prototype.ScUnionFunc = function (this: ScInterpreter): void {
  const p2nd = this.PopToken();
  const p1st = this.PopToken();
  if (this.nGlobalError !== FormulaError.NONE || !p2nd || !p1st) {
    this.PushIllegalArgument();
    return;
  }
  let sv1 = p1st.GetType();
  let sv2 = p2nd.GetType();
  if ((sv1 !== svSingleRef && sv1 !== svDoubleRef && sv1 !== svRefList) || (sv2 !== svSingleRef && sv2 !== svDoubleRef && sv2 !== svRefList)) {
    this.PushIllegalArgument();
    return;
  }
  let xRes: FormulaToken;
  // Append to an existing RefList if there is one.
  if (sv1 === svRefList) {
    xRes = p1st.Clone();
    sv1 = svUnknown; // mark as handled
  } else if (sv2 === svRefList) {
    xRes = p2nd.Clone();
    sv2 = svUnknown; // mark as handled
  } else xRes = new ScRefListToken();
  const pRes = xRes.GetRefList() as ScRefList;
  const pt = [p1st, p2nd];
  const sv = [sv1, sv2];
  for (let i = 0; i < 2; ++i) {
    switch (sv[i]) {
      case svSingleRef: {
        const aRef = new ScComplexRefData();
        aRef.Ref1 = pt[i]!.GetSingleRef().clone();
        aRef.Ref2 = pt[i]!.GetSingleRef().clone();
        pRes.push(aRef);
        break;
      }
      case svDoubleRef:
        pRes.push((pt[i]!.GetDoubleRef() as ScComplexRefData).clone());
        break;
      case svRefList:
        for (const rRef of pt[i]!.GetRefList() as ScRefList) pRes.push(rRef.clone());
        break;
      default:
      // nothing, prevent compiler warning
    }
  }
  this.ValidateRef(pRes); // set #REF! if needed
  this.PushTokenRef(xRes);
};

ScInterpreter.prototype.ScCurrent = function (this: ScInterpreter): void {
  const xTok = this.PopToken();
  if (xTok) {
    this.PushTokenRef(xTok);
    this.PushTokenRef(xTok);
  } else this.PushError(FormulaError.UnknownStackVariable);
};

ScInterpreter.Register(OC.ocIntersect, ScInterpreter.prototype.ScIntersect);
ScInterpreter.Register(OC.ocRange, ScInterpreter.prototype.ScRangeFunc);
ScInterpreter.Register(OC.ocUnion, ScInterpreter.prototype.ScUnionFunc);
ScInterpreter.Register(OC.ocCurrent, ScInterpreter.prototype.ScCurrent);
