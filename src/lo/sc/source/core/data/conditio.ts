// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/conditio.hxx reduced
// @upstream sc/source/core/data/conditio.cxx reduced
// Conditions (ScConditionEntry): an operator and one or two expressions, evaluated for a cell
// (IsCellValid), the base of validity (ScValidationData) and of conditional formatting
// (ScCondFormatEntry applies a cell style when its condition holds; ScConditionalFormat is the
// conditions of a range, ScConditionalFormatList those of a sheet). Reduced: the expressions are
// evaluated by a temporary formula cell each time (no cached formula cells, no listeners and
// repaint tasks); the duplicate/top/average cache is computed on each call; colour scales, data
// bars, icon sets and date conditions (ScColorScaleFormat, ScDataBarFormat, ScIconSetFormat,
// ScCondDateFormatEntry) are left out.
import { FormulaGrammar } from '../../../../include/formula/grammar.ts';
import { ocCell, ocColumn, ocName, ocPush, ocRow, ocSheet } from '../../../../include/formula/opcode.ts';
import { svByte, svDouble, svDoubleRef, svIndex, svSingleRef, svString } from '../../../../formula/source/core/api/token.ts';
import { approxEqual } from '../../../../sal/rtl/math.ts';
import { GetInputLineString } from '../../../../svl/source/numbers/zforlist.ts';
import { ScAddress, ScRange, type SCTAB } from '../../../inc/address.ts';
import { CELLTYPE_EDIT, CELLTYPE_FORMULA, CELLTYPE_STRING, CELLTYPE_VALUE, type ScRefCellValue } from '../../../inc/cellvalue.ts';
import { ScRangeList } from '../../../inc/rangelst.ts';
import { UpdateRefMode, type RefUpdateContext } from '../../../inc/refupdatecontext.ts';
import { FormulaError } from '../../../../include/formula/errorcodes.ts';
import { ScCompiler } from '../tool/compiler.ts';
import { ScTokenArray } from '../tool/token.ts';
import type { ScDocument } from './document.ts';
import { ScFormulaCell } from './formulacell.ts';

export const ScConditionMode = {
  Equal: 0, Less: 1, Greater: 2, EqLess: 3, EqGreater: 4, NotEqual: 5, Between: 6, NotBetween: 7, Duplicate: 8, NotDuplicate: 9, Direct: 10, Top10: 11,
  Bottom10: 12, TopPercent: 13, BottomPercent: 14, AboveAverage: 15, BelowAverage: 16, AboveEqualAverage: 17, BelowEqualAverage: 18, Error: 19,
  NoError: 20, BeginsWith: 21, EndsWith: 22, ContainsText: 23, NotContainsText: 24, NONE: 25,
} as const;
export type ScConditionMode = (typeof ScConditionMode)[keyof typeof ScConditionMode];

const SC_COND_NOBLANKS = 1;
const SC_COND_CASESENS = 2;

/** lcl_HasRelRef: whether the result depends on the position the formula is evaluated at. */
function lcl_HasRelRef(rDoc: ScDocument, pFormula: ScTokenArray | null, nRecursion = 0): boolean {
  if (pFormula) {
    for (const t of pFormula.GetArray()) {
      switch (t.GetType()) {
        case svDoubleRef: {
          const rRef2 = t.GetDoubleRef().Ref2;
          if (rRef2.IsColRel() || rRef2.IsRowRel() || rRef2.IsTabRel()) return true;
          const rRef1 = t.GetSingleRef();
          if (rRef1.IsColRel() || rRef1.IsRowRel() || rRef1.IsTabRel()) return true;
          break;
        }
        case svSingleRef: {
          const rRef1 = t.GetSingleRef();
          if (rRef1.IsColRel() || rRef1.IsRowRel() || rRef1.IsTabRel()) return true;
          break;
        }
        case svIndex:
          if (t.GetOpCode() === ocName) {
            // DB areas always absolute
            const nSheet = t.GetSheet();
            const pRangeData = (nSheet >= 0 ? rDoc.GetRangeName(nSheet) : rDoc.GetRangeName())?.findByIndex(t.GetIndex());
            if (pRangeData && nRecursion < 42 && lcl_HasRelRef(rDoc, pRangeData.GetCode(), nRecursion + 1)) return true;
          }
          break;
        // #i34474# function result dependent on cell position
        case svByte:
          switch (t.GetOpCode()) {
            case ocRow: // ROW() returns own row index
            case ocColumn: // COLUMN() returns own column index
            case ocSheet: // SHEET() returns own sheet index
            case ocCell: // CELL() may return own cell address
              return true;
            default:
          }
          break;
        default:
      }
    }
  }
  return false;
}

/** lcl_GetCellContent: the value (true) or string (false) of a cell. */
function lcl_GetCellContent(rCell: ScRefCellValue, bIsStr1: boolean): { bVal: boolean; rArg: number; rArgStr: string } {
  let rArg = 0;
  let rArgStr = '';
  if (rCell.isEmpty()) return { bVal: !bIsStr1, rArg, rArgStr };

  let bVal = true;
  switch (rCell.getType()) {
    case CELLTYPE_VALUE:
      rArg = rCell.getDouble();
      break;
    case CELLTYPE_FORMULA:
      bVal = rCell.getFormula()!.IsValue();
      if (bVal) rArg = rCell.getFormula()!.GetValue();
      else rArgStr = rCell.getFormula()!.GetString();
      break;
    case CELLTYPE_STRING:
    case CELLTYPE_EDIT:
      bVal = false;
      rArgStr = rCell.getString();
      break;
    default:
  }
  return { bVal, rArg, rArgStr };
}

const collator = new Intl.Collator('en-US', { sensitivity: 'base' });
const collatorCase = new Intl.Collator('en-US', { sensitivity: 'variant' });

export class ScConditionEntry {
  protected mrDoc: ScDocument;
  protected eOp: ScConditionMode;
  protected nOptions = 0;
  protected nVal1 = 0.0; // input or calculated
  protected nVal2 = 0.0;
  protected aStrVal1 = ''; // input or calculated
  protected aStrVal2 = '';
  protected bIsStr1 = false; // for recognition of unquoted strings
  protected bIsStr2 = false;
  protected pFormula1: ScTokenArray | null = null; // entered formula
  protected pFormula2: ScTokenArray | null = null;
  protected aSrcPos: ScAddress; // source position for formulas
  protected bRelRef1 = false;
  protected bRelRef2 = false;
  /** The conditional format the entry belongs to (pCondFormat), for the duplicate and top
      conditions. */
  pCondFormat: ScConditionalFormat | null = null;

  /** A condition of expressions (strings in eGrammar1/2), of token arrays, or a copy of r. */
  constructor(eOper: ScConditionMode | ScConditionEntry, rExpr1?: string | ScTokenArray | null, rExpr2?: string | ScTokenArray | null, rDocument?: ScDocument, rPos?: ScAddress, eGrammar1: FormulaGrammar.Grammar = FormulaGrammar.GRAM_DEFAULT, eGrammar2: FormulaGrammar.Grammar = FormulaGrammar.GRAM_DEFAULT) {
    if (eOper instanceof ScConditionEntry) {
      const r = eOper;
      this.mrDoc = rDocument ?? r.mrDoc;
      this.eOp = r.eOp;
      this.nOptions = r.nOptions;
      this.nVal1 = r.nVal1;
      this.nVal2 = r.nVal2;
      this.aStrVal1 = r.aStrVal1;
      this.aStrVal2 = r.aStrVal2;
      this.bIsStr1 = r.bIsStr1;
      this.bIsStr2 = r.bIsStr2;
      this.aSrcPos = r.aSrcPos.clone();
      this.bRelRef1 = r.bRelRef1;
      this.bRelRef2 = r.bRelRef2;
      this.pCondFormat = r.pCondFormat;
      // Real copy of the formulas (for Ref Undo)
      if (r.pFormula1) this.pFormula1 = r.pFormula1.Clone();
      if (r.pFormula2) this.pFormula2 = r.pFormula2.Clone();
      return;
    }
    this.mrDoc = rDocument!;
    this.eOp = eOper;
    this.aSrcPos = rPos!.clone();
    if (typeof rExpr1 === 'string' || typeof rExpr2 === 'string') this.Compile((rExpr1 as string) ?? '', (rExpr2 as string) ?? '', eGrammar1, eGrammar2);
    else {
      if (rExpr1) {
        this.pFormula1 = rExpr1.Clone();
        this.SimplifyCompiledFormula(1);
        this.bRelRef1 = lcl_HasRelRef(this.mrDoc, this.pFormula1);
      }
      if (rExpr2) {
        this.pFormula2 = rExpr2.Clone();
        this.SimplifyCompiledFormula(2);
        this.bRelRef2 = lcl_HasRelRef(this.mrDoc, this.pFormula2);
      }
    }
    // Formula cells are created at IsValid
  }

  GetDocument(): ScDocument { return this.mrDoc; }
  GetOperation(): ScConditionMode { return this.eOp; }
  SetOperation(eMode: ScConditionMode): void { this.eOp = eMode; }
  IsIgnoreBlank(): boolean { return (this.nOptions & SC_COND_NOBLANKS) === 0; }
  SetIgnoreBlank(bSet: boolean): void {
    // The bit SC_COND_NOBLANKS is set if blanks are not ignored
    // (only of valid)
    if (bSet) this.nOptions &= ~SC_COND_NOBLANKS;
    else this.nOptions |= SC_COND_NOBLANKS;
  }
  IsCaseSensitive(): boolean { return (this.nOptions & SC_COND_CASESENS) !== 0; }
  SetCaseSensitive(bSet: boolean): void {
    // The bit SC_COND_CASESENS is set if validation compare is case sensitive
    // (only of valid)
    if (bSet) this.nOptions |= SC_COND_CASESENS;
    else this.nOptions &= ~SC_COND_CASESENS;
  }
  GetSrcPos(): ScAddress { return this.aSrcPos; }
  /** The formula or constant of an expression (for the dialogs and the file formats). */
  GetFormula1(): ScTokenArray | null { return this.pFormula1; }
  GetFormula2(): ScTokenArray | null { return this.pFormula2; }

  /** A single constant is remembered as value or string, not as formula (SimplifyCompiledFormula). */
  private SimplifyCompiledFormula(n: 1 | 2): void {
    const rFormula = n === 1 ? this.pFormula1 : this.pFormula2;
    if (!rFormula || rFormula.GetLen() !== 1) return;

    // Single (constant number)?
    const pToken = rFormula.FirstToken()!;
    if (pToken.GetOpCode() !== ocPush) return;

    if (pToken.GetType() === svDouble) {
      if (n === 1) { this.nVal1 = pToken.GetDouble(); this.pFormula1 = null; } else { this.nVal2 = pToken.GetDouble(); this.pFormula2 = null; } // Do not remember as formula
    } else if (pToken.GetType() === svString) {
      if (n === 1) { this.bIsStr1 = true; this.aStrVal1 = pToken.GetString(); this.pFormula1 = null; } else { this.bIsStr2 = true; this.aStrVal2 = pToken.GetString(); this.pFormula2 = null; } // Do not remember as formula
    }
  }

  Compile(rExpr1: string, rExpr2: string, eGrammar1: FormulaGrammar.Grammar = FormulaGrammar.GRAM_DEFAULT, eGrammar2: FormulaGrammar.Grammar = FormulaGrammar.GRAM_DEFAULT): void {
    if (rExpr1 || rExpr2) {
      if (rExpr1) {
        this.pFormula1 = null;
        const aComp = new ScCompiler(this.mrDoc, this.aSrcPos, null, eGrammar1);
        this.pFormula1 = aComp.CompileString(rExpr1);
        this.SimplifyCompiledFormula(1);
        this.bRelRef1 = lcl_HasRelRef(this.mrDoc, this.pFormula1);
      }
      if (rExpr2) {
        this.pFormula2 = null;
        const aComp = new ScCompiler(this.mrDoc, this.aSrcPos, null, eGrammar2);
        this.pFormula2 = aComp.CompileString(rExpr2);
        this.SimplifyCompiledFormula(2);
        this.bRelRef2 = lcl_HasRelRef(this.mrDoc, this.pFormula2);
      }
    }
  }

  /** The formulas' tokens moved so that relative references evaluated at rPos point where they
      pointed from aSrcPos (a temporary formula cell at rPos). */
  private EvalCell(pFormula: ScTokenArray, rPos: ScAddress): ScFormulaCell {
    const p = new ScFormulaCell(this.mrDoc, rPos, pFormula);
    return p;
  }

  /** Evaluate the expressions at rPos (Interpret). */
  Interpret(rPos: ScAddress): void {
    // Evaluate formulas
    if (this.pFormula1) {
      const pEff1 = this.EvalCell(this.pFormula1, this.bRelRef1 ? rPos : this.aSrcPos);
      if (pEff1.IsValue()) {
        this.bIsStr1 = false;
        this.nVal1 = pEff1.GetValue();
        this.aStrVal1 = '';
      } else {
        this.bIsStr1 = true;
        this.aStrVal1 = pEff1.GetString();
        this.nVal1 = 0.0;
      }
    }
    if (this.pFormula2) {
      const pEff2 = this.EvalCell(this.pFormula2, this.bRelRef2 ? rPos : this.aSrcPos);
      if (pEff2.IsValue()) {
        this.bIsStr2 = false;
        this.nVal2 = pEff2.GetValue();
        this.aStrVal2 = '';
      } else {
        this.bIsStr2 = true;
        this.aStrVal2 = pEff2.GetString();
        this.nVal2 = 0.0;
      }
    }
  }

  /** The values of the format's range (FillCache, computed on each call here). */
  private FillCache(): { maValues: Map<number, number>; maStrings: Map<string, number>; nValueItems: number } {
    const mpCache = { maValues: new Map<number, number>(), maStrings: new Map<string, number>(), nValueItems: 0 };
    const rRanges = this.pCondFormat?.GetRange();
    if (!rRanges) return mpCache;
    for (const rRange of rRanges) {
      let nRow = rRange.aEnd.Row();
      let nCol = rRange.aEnd.Col();
      let nColStart = rRange.aStart.Col();
      let nRowStart = rRange.aStart.Row();
      const nTab = rRange.aStart.Tab();

      // temporary fix to workaround slow duplicate entry
      // conditions, prevent to use a whole row
      if (nRow === this.mrDoc.MaxRow()) {
        const r = this.mrDoc.ShrinkToUsedDataArea(nTab, nColStart, nRowStart, nCol, nRow, false);
        ({ nStartCol: nColStart, nStartRow: nRowStart, nEndCol: nCol, nEndRow: nRow } = r);
      }

      for (let r = nRowStart; r <= nRow; r++)
        for (let c = nColStart; c <= nCol; c++) {
          const aCell = this.mrDoc.GetRefCellValue(new ScAddress(c, r, nTab));
          if (aCell.isEmpty()) continue;
          const v = lcl_GetCellContent(aCell, false);
          if (!v.bVal) {
            const k = v.rArgStr.toLowerCase();
            mpCache.maStrings.set(k, (mpCache.maStrings.get(k) ?? 0) + 1);
          } else {
            mpCache.maValues.set(v.rArg, (mpCache.maValues.get(v.rArg) ?? 0) + 1);
            ++mpCache.nValueItems;
          }
        }
    }
    return mpCache;
  }

  private IsDuplicate(nArg: number, rStr: string): boolean {
    const mpCache = this.FillCache();
    if (!rStr) return (mpCache.maValues.get(nArg) ?? 0) > 1;
    return (mpCache.maStrings.get(rStr.toLowerCase()) ?? 0) > 1;
  }

  private sortedValues(): [number, number][] { return [...this.FillCache().maValues].sort((a, b) => a[0] - b[0]); }

  private IsTopNElement(nArg: number): boolean {
    const mpCache = this.FillCache();
    if (mpCache.nValueItems <= this.nVal1) return true;
    let nCells = 0;
    for (const [v, n] of this.sortedValues().reverse()) {
      if (nCells >= this.nVal1) return false;
      if (v <= nArg) return true;
      nCells += n;
    }
    return true;
  }

  private IsBottomNElement(nArg: number): boolean {
    const mpCache = this.FillCache();
    if (mpCache.nValueItems <= this.nVal1) return true;
    let nCells = 0;
    for (const [v, n] of this.sortedValues()) {
      if (nCells >= this.nVal1) return false;
      if (v >= nArg) return true;
      nCells += n;
    }
    return true;
  }

  private IsTopNPercent(nArg: number): boolean {
    const mpCache = this.FillCache();
    let nCells = 0;
    const nLimitCells = Math.trunc((mpCache.nValueItems * this.nVal1) / 100);
    for (const [v, n] of this.sortedValues().reverse()) {
      if (nCells >= nLimitCells) return false;
      if (v <= nArg) return true;
      nCells += n;
    }
    return true;
  }

  private IsBottomNPercent(nArg: number): boolean {
    const mpCache = this.FillCache();
    let nCells = 0;
    const nLimitCells = Math.trunc((mpCache.nValueItems * this.nVal1) / 100);
    for (const [v, n] of this.sortedValues()) {
      if (nCells >= nLimitCells) return false;
      if (v >= nArg) return true;
      nCells += n;
    }
    return true;
  }

  private IsBelowAverage(nArg: number, bEqual: boolean): boolean {
    const mpCache = this.FillCache();
    let nSum = 0;
    for (const [v, n] of mpCache.maValues) nSum += v * n;
    if (bEqual) return nArg <= nSum / mpCache.nValueItems;
    return nArg < nSum / mpCache.nValueItems;
  }

  private IsAboveAverage(nArg: number, bEqual: boolean): boolean {
    const mpCache = this.FillCache();
    let nSum = 0;
    for (const [v, n] of mpCache.maValues) nSum += v * n;
    if (bEqual) return nArg >= nSum / mpCache.nValueItems;
    return nArg > nSum / mpCache.nValueItems;
  }

  private IsError(rPos: ScAddress): boolean {
    const rCell = this.mrDoc.GetRefCellValue(rPos);
    if (rCell.getType() === CELLTYPE_FORMULA) {
      if (rCell.getFormula()!.GetErrCode() !== FormulaError.NONE) return true;
    }
    return false;
  }

  IsValid(nArg: number, rPos: ScAddress): boolean {
    const eOp = this.eOp;
    // Interpret must already have been called
    if (this.bIsStr1) {
      switch (eOp) {
        case ScConditionMode.BeginsWith:
        case ScConditionMode.EndsWith:
        case ScConditionMode.ContainsText:
        case ScConditionMode.NotContainsText:
          break;
        case ScConditionMode.NotEqual:
          return true;
        default:
          return false;
      }
    }

    if (eOp === ScConditionMode.Between || eOp === ScConditionMode.NotBetween) if (this.bIsStr2) return false;

    let nComp1 = this.nVal1; // Copy, so that it can be changed
    let nComp2 = this.nVal2;

    if (eOp === ScConditionMode.Between || eOp === ScConditionMode.NotBetween)
      if (nComp1 > nComp2)
        // Right order for value range
        [nComp1, nComp2] = [nComp2, nComp1];

    const num = (f: number) => String(f);
    // All corner cases need to be tested with ::rtl::math::approxEqual!
    let bValid = false;
    switch (eOp) {
      case ScConditionMode.NONE:
        break; // Always sal_False
      case ScConditionMode.Equal:
        bValid = approxEqual(nArg, nComp1);
        break;
      case ScConditionMode.NotEqual:
        bValid = !approxEqual(nArg, nComp1);
        break;
      case ScConditionMode.Greater:
        bValid = nArg > nComp1 && !approxEqual(nArg, nComp1);
        break;
      case ScConditionMode.EqGreater:
        bValid = nArg >= nComp1 || approxEqual(nArg, nComp1);
        break;
      case ScConditionMode.Less:
        bValid = nArg < nComp1 && !approxEqual(nArg, nComp1);
        break;
      case ScConditionMode.EqLess:
        bValid = nArg <= nComp1 || approxEqual(nArg, nComp1);
        break;
      case ScConditionMode.Between:
        bValid = (nArg >= nComp1 && nArg <= nComp2) || approxEqual(nArg, nComp1) || approxEqual(nArg, nComp2);
        break;
      case ScConditionMode.NotBetween:
        bValid = (nArg < nComp1 || nArg > nComp2) && !approxEqual(nArg, nComp1) && !approxEqual(nArg, nComp2);
        break;
      case ScConditionMode.Duplicate:
      case ScConditionMode.NotDuplicate:
        if (this.pCondFormat) {
          bValid = this.IsDuplicate(nArg, '');
          if (eOp === ScConditionMode.NotDuplicate) bValid = !bValid;
        }
        break;
      case ScConditionMode.Direct:
        bValid = nComp1 !== 0.0;
        break;
      case ScConditionMode.Top10:
        bValid = this.IsTopNElement(nArg);
        break;
      case ScConditionMode.Bottom10:
        bValid = this.IsBottomNElement(nArg);
        break;
      case ScConditionMode.TopPercent:
        bValid = this.IsTopNPercent(nArg);
        break;
      case ScConditionMode.BottomPercent:
        bValid = this.IsBottomNPercent(nArg);
        break;
      case ScConditionMode.AboveAverage:
      case ScConditionMode.AboveEqualAverage:
        bValid = this.IsAboveAverage(nArg, eOp === ScConditionMode.AboveEqualAverage);
        break;
      case ScConditionMode.BelowAverage:
      case ScConditionMode.BelowEqualAverage:
        bValid = this.IsBelowAverage(nArg, eOp === ScConditionMode.BelowEqualAverage);
        break;
      case ScConditionMode.Error:
      case ScConditionMode.NoError:
        bValid = this.IsError(rPos);
        if (eOp === ScConditionMode.NoError) bValid = !bValid;
        break;
      case ScConditionMode.BeginsWith:
        bValid = num(nArg).startsWith(this.aStrVal1 ? this.aStrVal1 : num(this.nVal1));
        break;
      case ScConditionMode.EndsWith:
        bValid = num(nArg).endsWith(this.aStrVal1 ? this.aStrVal1 : num(this.nVal1));
        break;
      case ScConditionMode.ContainsText:
      case ScConditionMode.NotContainsText:
        bValid = num(nArg).includes(this.aStrVal1 ? this.aStrVal1 : num(this.nVal1));
        if (eOp === ScConditionMode.NotContainsText) bValid = !bValid;
        break;
      default:
      // unknown operation at ScConditionEntry
    }
    return bValid;
  }

  IsValidStr(rArg: string, rPos: ScAddress): boolean {
    const eOp = this.eOp;
    let bValid = false;
    // Interpret must already have been called
    if (eOp === ScConditionMode.Direct)
      // Formula is independent from the content
      return this.nVal1 !== 0.0;

    if (eOp === ScConditionMode.Duplicate || eOp === ScConditionMode.NotDuplicate) {
      if (this.pCondFormat && rArg) {
        bValid = this.IsDuplicate(0.0, rArg);
        if (eOp === ScConditionMode.NotDuplicate) bValid = !bValid;
        return bValid;
      }
    }

    if (eOp === ScConditionMode.Error) return this.IsError(rPos);
    if (eOp === ScConditionMode.NoError) return !this.IsError(rPos);

    // If number contains condition, always false, except for "not equal".
    if (!this.bIsStr1) return eOp === ScConditionMode.NotEqual;
    if (eOp === ScConditionMode.Between || eOp === ScConditionMode.NotBetween) if (!this.bIsStr2) return false;

    const aUpVal1 = this.aStrVal1; //TODO: As a member? (Also set in Interpret)
    const aUpVal2 = this.aStrVal2;
    const bCase = this.IsCaseSensitive();
    const eq = (a: string, b: string) => (bCase ? a === b : a.toLowerCase() === b.toLowerCase());
    const cmp = (a: string, b: string) => (bCase ? collatorCase : collator).compare(a, b);

    switch (eOp) {
      case ScConditionMode.Equal:
        bValid = eq(aUpVal1, rArg);
        break;
      case ScConditionMode.NotEqual:
        bValid = !eq(aUpVal1, rArg);
        break;
      case ScConditionMode.TopPercent:
      case ScConditionMode.BottomPercent:
      case ScConditionMode.Top10:
      case ScConditionMode.Bottom10:
      case ScConditionMode.AboveAverage:
      case ScConditionMode.BelowAverage:
        return false;
      case ScConditionMode.BeginsWith:
        bValid = rArg.length >= aUpVal1.length && eq(rArg.slice(0, aUpVal1.length), aUpVal1);
        break;
      case ScConditionMode.EndsWith: {
        const nLen = aUpVal1.length;
        if (nLen > rArg.length) bValid = false;
        else bValid = eq(rArg.slice(rArg.length - nLen), aUpVal1);
        break;
      }
      case ScConditionMode.ContainsText:
      case ScConditionMode.NotContainsText: {
        const aArgStr = !bCase ? rArg.toLowerCase() : rArg;
        const aValStr = !bCase ? aUpVal1.toLowerCase() : aUpVal1;
        bValid = aArgStr.includes(aValStr);
        if (eOp === ScConditionMode.NotContainsText) bValid = !bValid;
        break;
      }
      default: {
        const nCompare = cmp(rArg, aUpVal1);
        switch (eOp) {
          case ScConditionMode.Greater:
            bValid = nCompare > 0;
            break;
          case ScConditionMode.EqGreater:
            bValid = nCompare >= 0;
            break;
          case ScConditionMode.Less:
            bValid = nCompare < 0;
            break;
          case ScConditionMode.EqLess:
            bValid = nCompare <= 0;
            break;
          case ScConditionMode.Between:
          case ScConditionMode.NotBetween: {
            const nCompare2 = cmp(rArg, aUpVal2);
            //  Test for NOTBETWEEN:
            bValid = (nCompare > 0 && nCompare2 > 0) || (nCompare < 0 && nCompare2 < 0);
            if (eOp === ScConditionMode.Between) bValid = !bValid;
            break;
          }
          default:
            // unknown operation in ScConditionEntry
            bValid = false;
        }
      }
    }
    return bValid;
  }

  IsCellValid(rCell: ScRefCellValue, rPos: ScAddress): boolean {
    this.Interpret(rPos); // Evaluate formula

    if (this.eOp === ScConditionMode.Direct) return this.nVal1 !== 0.0;

    const { bVal, rArg, rArgStr } = lcl_GetCellContent(rCell, this.bIsStr1);
    if (bVal) return this.IsValid(rArg, rPos);
    return this.IsValidStr(rArgStr, rPos);
  }

  /** An expression as text at a position in a grammar (GetExpression). */
  GetExpression(rCursor: ScAddress, nIndex: 0 | 1, eGrammar: FormulaGrammar.Grammar = FormulaGrammar.GRAM_DEFAULT): string {
    const pFormula = nIndex === 0 ? this.pFormula1 : this.pFormula2;
    const bIsStr = nIndex === 0 ? this.bIsStr1 : this.bIsStr2;
    const aStrVal = nIndex === 0 ? this.aStrVal1 : this.aStrVal2;
    const nVal = nIndex === 0 ? this.nVal1 : this.nVal2;
    if (pFormula) {
      const aComp = new ScCompiler(this.mrDoc, rCursor, pFormula, eGrammar);
      return aComp.CreateStringFromTokenArray();
    } else if (bIsStr) return `"${aStrVal}"`;
    return GetInputLineString(nVal, 'General', 'en-US');
  }

  /** Follow inserted, deleted and moved cells (UpdateReference). */
  UpdateReference(rCxt: RefUpdateContext): void {
    if (this.pCondFormat) this.aSrcPos = this.pCondFormat.GetRange().Combine().aStart;
    const aOldSrcPos = this.aSrcPos.clone();
    if (rCxt.meMode === UpdateRefMode.URM_INSDEL && rCxt.maRange.Contains(this.aSrcPos)) {
      const aErrorPos = new ScAddress();
      this.aSrcPos.Move(rCxt.mnColDelta, rCxt.mnRowDelta, rCxt.mnTabDelta, aErrorPos, this.mrDoc);
    }

    for (const pFormula of [this.pFormula1, this.pFormula2]) {
      if (!pFormula) continue;
      switch (rCxt.meMode) {
        case UpdateRefMode.URM_INSDEL:
          pFormula.AdjustReferenceOnShift(rCxt, aOldSrcPos);
          break;
        case UpdateRefMode.URM_MOVE:
          pFormula.AdjustReferenceOnMove(rCxt, aOldSrcPos, this.aSrcPos);
          break;
        default:
      }
    }
  }

  /** Whether the second expression is used (Between and NotBetween). */
  HasSecondExpression(): boolean { return this.eOp === ScConditionMode.Between || this.eOp === ScConditionMode.NotBetween; }

  IsEqual(r: ScConditionEntry, bIgnoreSrcPos = false): boolean {
    let bEq = this.eOp === r.eOp && this.nOptions === r.nOptions && this.bIsStr1 === r.bIsStr1 && this.bIsStr2 === r.bIsStr2;
    if (bEq) {
      const f1 = (p: ScTokenArray | null, q: ScTokenArray | null) => (!p && !q) || (!!p && !!q && p.GetLen() === q.GetLen() && p.GetArray().every((t, i) => t.equals(q.GetArray()[i]!)));
      bEq = f1(this.pFormula1, r.pFormula1) && f1(this.pFormula2, r.pFormula2);
      if (!bIgnoreSrcPos) bEq = bEq && this.aSrcPos.equals(r.aSrcPos);
      if (bEq) bEq = (this.pFormula1 || this.nVal1 === r.nVal1) && (this.pFormula2 || this.nVal2 === r.nVal2) && this.aStrVal1 === r.aStrVal1 && this.aStrVal2 === r.aStrVal2;
    }
    return !!bEq;
  }
}

/** A condition that applies a cell style (ScCondFormatEntry). */
export class ScCondFormatEntry extends ScConditionEntry {
  private aStyleName: string;

  constructor(eOper: ScConditionMode | ScCondFormatEntry, rExpr1?: string | ScTokenArray | null, rExpr2?: string | ScTokenArray | null, rDocument?: ScDocument, rPos?: ScAddress, rStyle = '', eGrammar1: FormulaGrammar.Grammar = FormulaGrammar.GRAM_DEFAULT, eGrammar2: FormulaGrammar.Grammar = FormulaGrammar.GRAM_DEFAULT) {
    super(eOper, rExpr1, rExpr2, rDocument, rPos, eGrammar1, eGrammar2);
    this.aStyleName = eOper instanceof ScCondFormatEntry ? eOper.aStyleName : rStyle;
  }

  GetStyle(): string { return this.aStyleName; }
  UpdateStyleName(rNew: string): void { this.aStyleName = rNew; }
  Clone(rDoc?: ScDocument): ScCondFormatEntry { return new ScCondFormatEntry(this, undefined, undefined, rDoc); }
}

/** The conditions of a range (ScConditionalFormat): the first that holds gives the style. */
export class ScConditionalFormat {
  private mrDoc: ScDocument;
  private nKey: number; // Index in attributes
  private maEntries: ScCondFormatEntry[] = [];
  private maRanges = new ScRangeList();

  constructor(nNewKey: number, rDoc: ScDocument) {
    this.nKey = nNewKey;
    this.mrDoc = rDoc;
  }

  Clone(pNewDoc?: ScDocument): ScConditionalFormat {
    // Real copy of the formula (for Ref Undo)
    const pNew = new ScConditionalFormat(this.nKey, pNewDoc ?? this.mrDoc);
    for (const e of this.maEntries) pNew.AddEntry(e.Clone(pNewDoc));
    pNew.SetRange(this.maRanges);
    return pNew;
  }

  AddEntry(pNew: ScCondFormatEntry): void {
    this.maEntries.push(pNew);
    pNew.pCondFormat = this;
  }
  RemoveEntry(n: number): void { this.maEntries.splice(n, 1); }
  SetRange(rRanges: ScRangeList): void { this.maRanges = rRanges.clone(); }
  GetRange(): ScRangeList { return this.maRanges; }
  size(): number { return this.maEntries.length; }
  IsEmpty(): boolean { return this.maEntries.length === 0; }
  GetEntry(nPos: number): ScCondFormatEntry | null { return this.maEntries[nPos] ?? null; }
  GetKey(): number { return this.nKey; }
  SetKey(nNew: number): void { this.nKey = nNew; } // only if not inserted!
  GetDocument(): ScDocument { return this.mrDoc; }

  /** The style of the first condition that holds for the cell (GetCellStyle), '' for none. */
  GetCellStyle(rCell: ScRefCellValue, rPos: ScAddress): string {
    for (const rxEntry of this.maEntries) {
      if (rxEntry.IsCellValid(rCell, rPos)) return rxEntry.GetStyle();
    }
    return '';
  }

  /** Follow inserted, deleted and moved cells: the range and the conditions (UpdateReference,
      reduced: the range list is moved like a cell range by ScRangeList::UpdateReference's rules
      of ScRefUpdate). */
  UpdateReference(rCxt: RefUpdateContext): void {
    for (const e of this.maEntries) e.UpdateReference(rCxt);
    const aNew = new ScRangeList();
    for (const r of this.maRanges) {
      const a = r.clone();
      if (rCxt.meMode === UpdateRefMode.URM_INSDEL) {
        const c = rCxt.maRange;
        if (a.aStart.Tab() >= c.aStart.Tab() && a.aEnd.Tab() <= c.aEnd.Tab()) {
          if (rCxt.mnRowDelta && a.aStart.Col() >= c.aStart.Col() && a.aEnd.Col() <= c.aEnd.Col()) {
            const n1 = a.aStart.Row() >= c.aStart.Row() ? a.aStart.Row() + rCxt.mnRowDelta : rCxt.mnRowDelta < 0 && a.aStart.Row() >= c.aStart.Row() + rCxt.mnRowDelta ? c.aStart.Row() + rCxt.mnRowDelta : a.aStart.Row();
            const n2 = a.aEnd.Row() >= c.aStart.Row() ? a.aEnd.Row() + rCxt.mnRowDelta : rCxt.mnRowDelta < 0 && a.aEnd.Row() >= c.aStart.Row() + rCxt.mnRowDelta ? c.aStart.Row() + rCxt.mnRowDelta - 1 : a.aEnd.Row();
            if (n2 < n1) continue;
            a.aStart.SetRow(Math.max(0, n1));
            a.aEnd.SetRow(Math.min(this.mrDoc.MaxRow(), n2));
          }
          if (rCxt.mnColDelta && a.aStart.Row() >= c.aStart.Row() && a.aEnd.Row() <= c.aEnd.Row()) {
            const n1 = a.aStart.Col() >= c.aStart.Col() ? a.aStart.Col() + rCxt.mnColDelta : rCxt.mnColDelta < 0 && a.aStart.Col() >= c.aStart.Col() + rCxt.mnColDelta ? c.aStart.Col() + rCxt.mnColDelta : a.aStart.Col();
            const n2 = a.aEnd.Col() >= c.aStart.Col() ? a.aEnd.Col() + rCxt.mnColDelta : rCxt.mnColDelta < 0 && a.aEnd.Col() >= c.aStart.Col() + rCxt.mnColDelta ? c.aStart.Col() + rCxt.mnColDelta - 1 : a.aEnd.Col();
            if (n2 < n1) continue;
            a.aStart.SetCol(Math.max(0, n1));
            a.aEnd.SetCol(Math.min(this.mrDoc.MaxCol(), n2));
          }
        }
      }
      aNew.push_back(a);
    }
    this.maRanges = aNew;
  }

  EqualEntries(r: ScConditionalFormat, bIgnoreSrcPos = false): boolean {
    if (this.size() !== r.size()) return false;
    //TODO: Test for same entries in reverse order?
    if (!this.maEntries.every((e, i) => e.IsEqual(r.maEntries[i]!, bIgnoreSrcPos))) return false;
    // right now don't check for same range
    // we only use this method to merge same conditional formats from
    // old ODF data structure
    return true;
  }
}

/** The conditional formats of a sheet (ScConditionalFormatList), by key. */
export class ScConditionalFormatList {
  private m_ConditionalFormats: ScConditionalFormat[] = [];

  Clone(pNewDoc?: ScDocument): ScConditionalFormatList {
    const r = new ScConditionalFormatList();
    for (const f of this.m_ConditionalFormats) r.InsertNew(f.Clone(pNewDoc));
    return r;
  }
  InsertNew(pNew: ScConditionalFormat): void { this.m_ConditionalFormats.push(pNew); }
  GetFormat(nKey: number): ScConditionalFormat | null { return this.m_ConditionalFormats.find((f) => f.GetKey() === nKey) ?? null; }
  erase(nIndex: number): void { this.m_ConditionalFormats = this.m_ConditionalFormats.filter((f) => f.GetKey() !== nIndex); }
  size(): number { return this.m_ConditionalFormats.length; }
  empty(): boolean { return this.m_ConditionalFormats.length === 0; }
  [Symbol.iterator](): Iterator<ScConditionalFormat> { return this.m_ConditionalFormats[Symbol.iterator](); }
  /** The formats whose range touches the position. */
  GetFormatsAt(rPos: ScAddress): ScConditionalFormat[] { return this.m_ConditionalFormats.filter((f) => f.GetRange().Contains(new ScRange(rPos))); }
  UpdateReference(rCxt: RefUpdateContext): void {
    for (const f of [...this.m_ConditionalFormats]) {
      f.UpdateReference(rCxt);
      if (f.GetRange().empty()) this.erase(f.GetKey());
    }
  }
  /** A key not in use (as ScConditionalFormatList::getMaxKey + 1). */
  getMaxKey(): number { return this.m_ConditionalFormats.reduce((n, f) => Math.max(n, f.GetKey()), 0); }
  /** Remove the cells of rRange from the formats' ranges, dropping formats left without range
      (DeleteArea). */
  DeleteArea(rRange: ScRange): void {
    for (const f of [...this.m_ConditionalFormats]) {
      const aList = f.GetRange().clone();
      aList.DeleteArea(rRange);
      f.SetRange(aList);
      if (aList.empty()) this.erase(f.GetKey());
    }
  }
}
export type { SCTAB };
