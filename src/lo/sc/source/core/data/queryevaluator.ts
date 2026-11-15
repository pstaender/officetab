// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/queryevaluator.hxx reduced
// @upstream sc/source/core/data/queryevaluator.cxx reduced
// ScQueryEvaluator: whether a row of a table passes a query (ValidQuery), comparing cells by
// value, by string (plain, wildcard or regular expression, whole cell or substring) or by the
// range lookup rule (numbers before strings). Reduced: shared strings are plain strings compared
// directly (case-insensitively through upper case), the collator is Intl.Collator, number formats
// are format codes. Left out: rounding to the shown precision for filters (mbRoundForFilter), the
// text and background colour queries (they never match), the cached sorted item lookups for
// queries with many items (the generic comparison gives the same result) and the block position
// hints.
import { FormulaError } from '../../../../include/formula/errorcodes.ts';
import { approxEqual, approxFloor } from '../../../../sal/rtl/math.ts';
import { GetType as NFGetType, SvNumFormatType } from '../../../../svl/source/numbers/zforlist.ts';
import { SearchType } from '../../../../unotools/source/i18n/textsearch.ts';
import type { SCCOL, SCCOLROW, SCROW } from '../../../inc/address.ts';
import { CELLTYPE_FORMULA, CELLTYPE_STRING, CELLTYPE_VALUE, type ScRefCellValue } from '../../../inc/cellvalue.ts';
import { ScGlobal, ScQueryConnect, ScQueryOp } from '../../../inc/global.ts';
import { ScQueryEntry, type ScQueryEntryItem } from '../../../inc/queryentry.ts';
import type { ScQueryParam } from '../../../inc/queryparam.ts';
import { ScCellFormat } from '../tool/cellform.ts';
import type { ScDocument } from './document.ts';
import type { ScTable } from './table.ts';

const aCollator = new Intl.Collator('en-US', { sensitivity: 'accent' });
const aCaseCollator = new Intl.Collator('en-US', { sensitivity: 'variant', caseFirst: 'lower' });

/** ScGlobal::GetCollator(bCaseSensitive): compareString returns -1, 0 or 1. */
export function GetCollator(bCaseSensitive = false): { compareString(a: string, b: string): number } {
  const c = bCaseSensitive ? aCaseCollator : aCollator;
  return { compareString: (a: string, b: string) => Math.sign(c.compare(a, b)) };
}

/** svl::SharedString::getDataIgnoreCase: the upper-case form identifying a string ignoring case. */
export function getDataIgnoreCase(s: string): string { return s.toUpperCase(); }

/** A pair of results: whether the condition is fulfilled, and whether the equal condition is. */
type ResultPair = [boolean, boolean];

export class ScQueryEvaluator {
  private mrDoc: ScDocument;
  private mrTab: ScTable;
  private mrParam: ScQueryParam;
  private mpTestEqualCondition: { value: boolean } | null;
  private readonly mbMatchWholeCell: boolean;
  private readonly mbCaseSensitive: boolean;

  private readonly mnEntryCount: number;
  private mpPasst: boolean[] = [];
  private mpTest: boolean[] = [];

  private static isPartialTextMatchOp(eOp: ScQueryOp): boolean {
    switch (eOp) {
      // these operators can only be used with textural comparisons.
      case ScQueryOp.SC_CONTAINS:
      case ScQueryOp.SC_DOES_NOT_CONTAIN:
      case ScQueryOp.SC_BEGINS_WITH:
      case ScQueryOp.SC_ENDS_WITH:
      case ScQueryOp.SC_DOES_NOT_BEGIN_WITH:
      case ScQueryOp.SC_DOES_NOT_END_WITH:
        return true;
      default:
    }
    return false;
  }

  private static isTextMatchOp(eOp: ScQueryOp): boolean {
    if (ScQueryEvaluator.isPartialTextMatchOp(eOp)) return true;

    switch (eOp) {
      // these operators can be used for either textural or value comparison.
      case ScQueryOp.SC_EQUAL:
      case ScQueryOp.SC_NOT_EQUAL:
        return true;
      default:
    }
    return false;
  }

  private static isMatchWholeCellHelper(docMatchWholeCell: boolean, eOp: ScQueryOp): boolean {
    let bMatchWholeCell = docMatchWholeCell;
    if (ScQueryEvaluator.isPartialTextMatchOp(eOp))
      // may have to do partial textural comparison.
      bMatchWholeCell = false;
    return bMatchWholeCell;
  }

  private isMatchWholeCellOp(eOp: ScQueryOp): boolean { return ScQueryEvaluator.isMatchWholeCellHelper(this.mbMatchWholeCell, eOp); }

  static isMatchWholeCell(rDoc: ScDocument, eOp: ScQueryOp): boolean {
    return ScQueryEvaluator.isMatchWholeCellHelper(rDoc.GetDocOptions().IsMatchWholeCell(), eOp);
  }

  constructor(rDoc: ScDocument, rTab: ScTable, rParam: ScQueryParam, pTestEqualCondition: { value: boolean } | null = null, bNewSearchFunction = false) {
    this.mrDoc = rDoc;
    this.mrTab = rTab;
    this.mrParam = rParam;
    this.mpTestEqualCondition = pTestEqualCondition;
    this.mbMatchWholeCell = !bNewSearchFunction ? rDoc.GetDocOptions().IsMatchWholeCell() : true;
    this.mbCaseSensitive = rParam.bCaseSens;
    this.mnEntryCount = this.mrParam.GetEntryCount();
    this.mpPasst = new Array<boolean>(this.mnEntryCount).fill(false);
    this.mpTest = new Array<boolean>(this.mnEntryCount).fill(false);
  }

  private isRealWildOrRegExp(rEntry: ScQueryEntry): boolean {
    if (this.mrParam.eSearchType === SearchType.Normal) return false;

    return ScQueryEvaluator.isTextMatchOp(rEntry.eOp);
  }

  private isTestWildOrRegExp(rEntry: ScQueryEntry): boolean {
    if (!this.mpTestEqualCondition) return false;

    if (this.mrParam.eSearchType === SearchType.Normal) return false;

    return rEntry.eOp === ScQueryOp.SC_LESS_EQUAL || rEntry.eOp === ScQueryOp.SC_GREATER_EQUAL;
  }

  static isQueryByValue(eOp: ScQueryOp, eType: number, rCell: ScRefCellValue): boolean {
    if (eType === ScQueryEntry.ByString || ScQueryEvaluator.isPartialTextMatchOp(eOp)) return false;

    return ScQueryEvaluator.isQueryByValueForCell(rCell);
  }

  private static isQueryByValueForCell(rCell: ScRefCellValue): boolean {
    if (rCell.getType() === CELLTYPE_FORMULA && rCell.getFormula()!.GetErrCode() !== FormulaError.NONE)
      // Error values are compared as string.
      return false;

    return rCell.hasNumeric();
  }

  static isQueryByString(eOp: ScQueryOp, eType: number, rCell: ScRefCellValue): boolean {
    if (ScQueryEvaluator.isTextMatchOp(eOp)) return true;

    if (eType !== ScQueryEntry.ByString) return false;

    return rCell.hasString();
  }

  private getNumFmt(nCol: SCCOL, nRow: SCROW): string {
    const nNumFmt = this.mrTab.GetNumberFormat(nCol, nRow);
    if (/^General$/i.test(nNumFmt))
      // Any General of any locale is irrelevant for rounding.
      return '';
    return nNumFmt;
  }

  private compareByValue(rCell: ScRefCellValue, nCol: SCCOL, nRow: SCROW, rEntry: ScQueryEntry, rItem: ScQueryEntryItem): ResultPair {
    let bOk = false;
    let bTestEqual = false;
    let nCellVal: number;
    const fQueryVal = rItem.mfVal;

    switch (rCell.getType()) {
      case CELLTYPE_VALUE:
        nCellVal = rCell.getDouble();
        break;
      case CELLTYPE_FORMULA:
        nCellVal = rCell.getFormula()!.GetValue();
        break;
      default:
        nCellVal = 0.0;
    }

    /* NOTE: lcl_PrepareQuery() prepares a filter query such that if a
     * date+time format was queried rEntry.bQueryByDate is not set. In
     * case other queries wanted to use this mechanism they should do
     * the same, in other words only if rEntry.nVal is an integer value
     * rEntry.bQueryByDate should be true and the time fraction be
     * stripped here. */

    if (rItem.meType === ScQueryEntry.ByDate) {
      const nNumFmt = this.getNumFmt(nCol, nRow);
      if (nNumFmt) {
        const nNumFmtType = NFGetType(nNumFmt, 'en-US');
        /* NOTE: Omitting the check for absence of
         * css::util::NumberFormat::TIME would include also date+time formatted
         * values of the same day. That may be desired in some
         * cases, querying all time values of a day, but confusing
         * in other cases. A user can always setup a standard
         * filter query for x >= date AND x < date+1 */
        if (nNumFmtType & SvNumFormatType.DATE && !(nNumFmtType & SvNumFormatType.TIME)) {
          // The format is of date type.  Strip off the time
          // element.
          nCellVal = approxFloor(nCellVal);
        }
      }
    }

    switch (rEntry.eOp) {
      case ScQueryOp.SC_EQUAL:
        bOk = approxEqual(nCellVal, fQueryVal);
        break;
      case ScQueryOp.SC_LESS:
        bOk = nCellVal < fQueryVal && !approxEqual(nCellVal, fQueryVal);
        break;
      case ScQueryOp.SC_GREATER:
        bOk = nCellVal > fQueryVal && !approxEqual(nCellVal, fQueryVal);
        break;
      case ScQueryOp.SC_LESS_EQUAL:
        bOk = nCellVal < fQueryVal || approxEqual(nCellVal, fQueryVal);
        if (bOk && this.mpTestEqualCondition) bTestEqual = approxEqual(nCellVal, fQueryVal);
        break;
      case ScQueryOp.SC_GREATER_EQUAL:
        bOk = nCellVal > fQueryVal || approxEqual(nCellVal, fQueryVal);
        if (bOk && this.mpTestEqualCondition) bTestEqual = approxEqual(nCellVal, fQueryVal);
        break;
      case ScQueryOp.SC_NOT_EQUAL:
        bOk = !approxEqual(nCellVal, fQueryVal);
        break;
      default:
        break;
    }

    return [bOk, bTestEqual];
  }

  getCellString(rCell: ScRefCellValue, nRow: SCROW, nCol: SCCOL): string {
    if (rCell.getType() === CELLTYPE_FORMULA && rCell.getFormula()!.GetErrCode() !== FormulaError.NONE) {
      // Error cell is evaluated as string (for now).
      return ScGlobal.GetErrorString(rCell.getFormula()!.GetErrCode());
    } else if (rCell.getType() === CELLTYPE_STRING) return rCell.getSharedString()!;
    const nFormat = this.mrTab.GetNumberFormat(nCol, nRow);
    return ScCellFormat.GetInputString(rCell, nFormat);
  }

  getCellSharedString(rCell: ScRefCellValue, nRow: SCROW, nCol: SCCOL): string { return this.getCellString(rCell, nRow, nCol); }

  private equalCellSharedString(rCell: ScRefCellValue, nRow: SCROW, nField: SCCOLROW, bCaseSens: boolean, rString: string): boolean {
    const aValue = this.getCellSharedString(rCell, nRow, nField);
    // Fast string equality check by comparing string identifiers.
    if (bCaseSens) return aValue === rString;
    return getDataIgnoreCase(aValue) === getDataIgnoreCase(rString);
  }

  private isFastCompareByString(rEntry: ScQueryEntry): boolean {
    // If this is true, then there's a fast path in compareByString() which
    // can be selected using the template argument to get fast code
    // that will not check the same conditions every time. This makes a difference
    // in fast lookups that search for an exact value (case sensitive or not).
    const bRealWildOrRegExp = this.isRealWildOrRegExp(rEntry);
    const bTestWildOrRegExp = this.isTestWildOrRegExp(rEntry);
    // SC_EQUAL is part of isTextMatchOp(rEntry)
    return rEntry.eOp === ScQueryOp.SC_EQUAL && !bRealWildOrRegExp && !bTestWildOrRegExp && this.isMatchWholeCellOp(rEntry.eOp);
  }

  // The value is placed inside parameter rValueSource.
  // For the template argument see isFastCompareByString().
  private compareByString(bFast: boolean, rEntry: ScQueryEntry, rItem: ScQueryEntryItem, rCell: ScRefCellValue, nRow: SCROW): ResultPair {
    let bOk = false;
    let bTestEqual = false;
    let bMatchWholeCell: boolean;
    if (bFast) bMatchWholeCell = true;
    else bMatchWholeCell = this.isMatchWholeCellOp(rEntry.eOp);
    const bRealWildOrRegExp = !bFast && this.isRealWildOrRegExp(rEntry);
    const bTestWildOrRegExp = !bFast && this.isTestWildOrRegExp(rEntry);

    if (!bFast && (bRealWildOrRegExp || bTestWildOrRegExp)) {
      const rValue = this.getCellSharedString(rCell, nRow, rEntry.nField);

      let nStart = 0;
      let nEnd = rValue.length;

      // from 614 on, nEnd is behind the found text
      let bMatch = false;
      if (rEntry.eOp === ScQueryOp.SC_ENDS_WITH || rEntry.eOp === ScQueryOp.SC_DOES_NOT_END_WITH) {
        nEnd = 0;
        nStart = rValue.length;
        const r = rEntry.GetSearchTextPtr(this.mrParam.eSearchType, this.mrParam.bCaseSens, bMatchWholeCell).SearchBackward(rValue, nStart, nEnd);
        bMatch = r.bFound;
        if (bMatch) {
          // SearchBackward reports the higher position as start.
          nStart = r.nEnd;
          nEnd = r.nStart;
        }
      } else {
        const r = rEntry.GetSearchTextPtr(this.mrParam.eSearchType, this.mrParam.bCaseSens, bMatchWholeCell).SearchForward(rValue, nStart, nEnd);
        bMatch = r.bFound;
        nStart = r.nStart;
        nEnd = r.nEnd;
      }
      if (bMatch && bMatchWholeCell && (nStart !== 0 || nEnd !== rValue.length)) bMatch = false; // RegExp must match entire cell string
      if (bRealWildOrRegExp) {
        switch (rEntry.eOp) {
          case ScQueryOp.SC_EQUAL:
          case ScQueryOp.SC_CONTAINS:
            bOk = bMatch;
            break;
          case ScQueryOp.SC_NOT_EQUAL:
          case ScQueryOp.SC_DOES_NOT_CONTAIN:
            bOk = !bMatch;
            break;
          case ScQueryOp.SC_BEGINS_WITH:
            bOk = bMatch && nStart === 0;
            break;
          case ScQueryOp.SC_DOES_NOT_BEGIN_WITH:
            bOk = !(bMatch && nStart === 0);
            break;
          case ScQueryOp.SC_ENDS_WITH:
            bOk = bMatch && nEnd === rValue.length;
            break;
          case ScQueryOp.SC_DOES_NOT_END_WITH:
            bOk = !(bMatch && nEnd === rValue.length);
            break;
          default:
            break;
        }
      } else bTestEqual = bMatch;
    }
    if (bFast || !bRealWildOrRegExp) {
      // Simple string matching i.e. no regexp match.
      if (bFast || ScQueryEvaluator.isTextMatchOp(rEntry.eOp)) {
        // Check this even with bFast.
        if (rItem.meType !== ScQueryEntry.ByString && !rItem.maString) {
          // #i18374# When used from functions (match, countif, sumif, vlookup, hlookup, lookup),
          // the query value is assigned directly, and the string is empty. In that case,
          // don't find any string (isEqual would find empty string results in formula cells).
          bOk = false;
          if (rEntry.eOp === ScQueryOp.SC_NOT_EQUAL) bOk = !bOk;
        } else {
          if (bFast || bMatchWholeCell) {
            bOk = this.equalCellSharedString(rCell, nRow, rEntry.nField, this.mrParam.bCaseSens, rItem.maString);

            if (!bFast && rEntry.eOp === ScQueryOp.SC_NOT_EQUAL) bOk = !bOk;
          } else {
            const rValueSource = this.getCellSharedString(rCell, nRow, rEntry.nField);

            // Where do we find a match (if at all)
            let nStrPos: number;

            // The transliteration ignoring case is the upper case form here.
            const aCell = this.mbCaseSensitive ? rValueSource : getDataIgnoreCase(rValueSource);
            const aQuer = this.mbCaseSensitive ? rItem.maString : getDataIgnoreCase(rItem.maString);
            const nIndex = rEntry.eOp === ScQueryOp.SC_ENDS_WITH || rEntry.eOp === ScQueryOp.SC_DOES_NOT_END_WITH ? aCell.length - aQuer.length : 0;
            nStrPos = nIndex < 0 ? -1 : aCell.indexOf(aQuer, nIndex);
            switch (rEntry.eOp) {
              case ScQueryOp.SC_EQUAL:
              case ScQueryOp.SC_CONTAINS:
                bOk = nStrPos !== -1;
                break;
              case ScQueryOp.SC_NOT_EQUAL:
              case ScQueryOp.SC_DOES_NOT_CONTAIN:
                bOk = nStrPos === -1;
                break;
              case ScQueryOp.SC_BEGINS_WITH:
                bOk = nStrPos === 0;
                break;
              case ScQueryOp.SC_DOES_NOT_BEGIN_WITH:
                bOk = nStrPos !== 0;
                break;
              case ScQueryOp.SC_ENDS_WITH:
                bOk = nStrPos >= 0;
                break;
              case ScQueryOp.SC_DOES_NOT_END_WITH:
                bOk = nStrPos < 0;
                break;
              default:
                break;
            }
          }
        }
      } else {
        // use collator here because data was probably sorted
        const rValue = this.getCellSharedString(rCell, nRow, rEntry.nField);
        const nCompare = GetCollator(this.mrParam.bCaseSens).compareString(rValue, rItem.maString);
        switch (rEntry.eOp) {
          case ScQueryOp.SC_LESS:
            bOk = nCompare < 0;
            break;
          case ScQueryOp.SC_GREATER:
            bOk = nCompare > 0;
            break;
          case ScQueryOp.SC_LESS_EQUAL:
            bOk = nCompare <= 0;
            if (bOk && this.mpTestEqualCondition && !bTestEqual) bTestEqual = nCompare === 0;
            break;
          case ScQueryOp.SC_GREATER_EQUAL:
            bOk = nCompare >= 0;
            if (bOk && this.mpTestEqualCondition && !bTestEqual) bTestEqual = nCompare === 0;
            break;
          default:
            break;
        }
      }
    }

    return [bOk, bTestEqual];
  }

  // To be called only if both isQueryByValue() and isQueryByString()
  // returned false and range lookup is wanted! In range lookup comparison
  // numbers are less than strings. Nothing else is compared.
  private static compareByRangeLookup(rCell: ScRefCellValue, rEntry: ScQueryEntry, rItem: ScQueryEntryItem): ResultPair {
    const bTestEqual = false;

    if (rItem.meType === ScQueryEntry.ByString && rEntry.eOp !== ScQueryOp.SC_LESS && rEntry.eOp !== ScQueryOp.SC_LESS_EQUAL) return [false, bTestEqual];

    if (rItem.meType !== ScQueryEntry.ByString && rEntry.eOp !== ScQueryOp.SC_GREATER && rEntry.eOp !== ScQueryOp.SC_GREATER_EQUAL) return [false, bTestEqual];

    if (rItem.meType === ScQueryEntry.ByString) {
      if (rCell.getType() === CELLTYPE_FORMULA && rCell.getFormula()!.GetErrCode() !== FormulaError.NONE)
        // Error values are compared as string.
        return [false, bTestEqual];

      return [rCell.hasNumeric(), bTestEqual];
    }

    return [!rCell.hasNumeric(), bTestEqual];
  }

  private processEntry(nRow: SCROW, nCol: SCCOL, aCell: ScRefCellValue, rEntry: ScQueryEntry): ResultPair {
    const aRes: ResultPair = [false, false];
    const rItems = rEntry.GetQueryItems();
    if (rItems.length === 1 && rItems[0]!.meType === ScQueryEntry.ByEmpty) {
      if (rEntry.IsQueryByEmpty()) aRes[0] = aCell.isEmpty();
      else aRes[0] = !aCell.isEmpty();
      return aRes;
    }
    const bFastCompareByString = this.isFastCompareByString(rEntry);
    // Generic handling.
    for (const rItem of rItems) {
      if (rItem.meType === ScQueryEntry.ByTextColor || rItem.meType === ScQueryEntry.ByBackgroundColor) {
        // Cell colours are not available: never a match.
      } else if (ScQueryEvaluator.isQueryByValue(rEntry.eOp, rItem.meType, aCell)) {
        const aThisRes = this.compareByValue(aCell, nCol, nRow, rEntry, rItem);
        aRes[0] ||= aThisRes[0];
        aRes[1] ||= aThisRes[1];
      } else if (ScQueryEvaluator.isQueryByString(rEntry.eOp, rItem.meType, aCell)) {
        const aThisRes = this.compareByString(bFastCompareByString, rEntry, rItem, aCell, nRow);
        aRes[0] ||= aThisRes[0];
        aRes[1] ||= aThisRes[1];
      } else if (this.mrParam.mbRangeLookup) {
        const aThisRes = ScQueryEvaluator.compareByRangeLookup(aCell, rEntry, rItem);
        aRes[0] ||= aThisRes[0];
        aRes[1] ||= aThisRes[1];
      }

      if (aRes[0] && (aRes[1] || this.mpTestEqualCondition === null)) break;
    }
    return aRes;
  }

  ValidQuery(nRow: SCROW, pCell: ScRefCellValue | null = null): boolean {
    if (!this.mrParam.GetEntry(0).bDoQuery) return true;

    let nPos = -1;
    const nCount = this.mrParam.GetEntryCount();
    for (let it = 0; it < nCount && this.mrParam.GetEntry(it).bDoQuery; ++it) {
      const rEntry = this.mrParam.GetEntry(it);

      // Short-circuit the test at the end of the loop - if this is SC_AND
      // and the previous value is false, this value will not be needed.
      // Disable this if pbTestEqualCondition is present as that one may get set
      // even if the result is false (that also means pTest doesn't need to be
      // handled here).
      if (rEntry.eConnect === ScQueryConnect.SC_AND && this.mpTestEqualCondition === null && nPos !== -1 && !this.mpPasst[nPos]) continue;

      const nCol = rEntry.nField;

      // We can only handle one single direct query passed as a known pCell,
      // subsequent queries have to obtain the cell.
      let aCell: ScRefCellValue;
      if (pCell && it === 0) aCell = pCell;
      else aCell = this.mrTab.GetCellValue(nCol, nRow);

      const aRes = this.processEntry(nRow, nCol, aCell, rEntry);

      if (nPos === -1) {
        nPos++;
        this.mpPasst[nPos] = aRes[0];
        this.mpTest[nPos] = aRes[1];
      } else {
        if (rEntry.eConnect === ScQueryConnect.SC_AND) {
          this.mpPasst[nPos] = this.mpPasst[nPos]! && aRes[0];
          this.mpTest[nPos] = this.mpTest[nPos]! && aRes[1];
        } else {
          nPos++;
          this.mpPasst[nPos] = aRes[0];
          this.mpTest[nPos] = aRes[1];
        }
      }
    }

    for (let j = 1; j <= nPos; j++) {
      this.mpPasst[0] = this.mpPasst[0]! || this.mpPasst[j]!;
      this.mpTest[0] = this.mpTest[0]! || this.mpTest[j]!;
    }

    const bRet = this.mpPasst[0]!;
    if (this.mpTestEqualCondition) this.mpTestEqualCondition.value = this.mpTest[0]!;

    return bRet;
  }

  GetDocument(): ScDocument { return this.mrDoc; }
}
