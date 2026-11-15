// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/core/tool/rangeutl.cxx partial
// ScRangeStringConverter::GetRangeDataFromString: the named expression a string names (a sheet
// local name with a sheet prefix, else the sheet's then the global name), as INDIRECT uses it;
// and the ODF cell address strings of the XML filter (GetAddressFromString, GetRangeFromString,
// GetRangeListFromString and the GetStringFrom* counterparts) in Calc's A1 convention, with a
// space as the list separator and ' as the quote. Left out: the area and range-list variants
// of the API, other separators and conventions.
import { FormulaGrammar } from '../../../../include/formula/grammar.ts';
import { FindUnquoted, ScAddress, ScColToAlpha, ScRange, ScRefFlags, type SCTAB } from '../../../inc/address.ts';
import type { ScDocument } from '../data/document.ts';
import type { ScRangeData } from './rangenam.ts';

/** ScGlobal::EraseQuotes: remove the enclosing quotes and unescape doubled ones. */
function EraseQuotes(rString: string, cQuote: string): string {
  if (rString.length >= 2 && rString[0] === cQuote && rString[rString.length - 1] === cQuote) {
    rString = rString.slice(1, -1);
    rString = rString.split(cQuote + cQuote).join(cQuote);
  }
  return rString;
}

/** The position of the next unquoted cSeparator from nOffset (ScRangeStringConverter::IndexOf). */
function IndexOf(rString: string, cSearchChar: string, nOffset: number, cQuote = "'"): number {
  let bQuoted = false;
  for (let i = nOffset; i < rString.length; i++) {
    const c = rString[i]!;
    if (c === cQuote) bQuoted = !bQuoted;
    else if (c === cSearchChar && !bQuoted) return i;
  }
  return -1;
}

/** ScCompiler::CheckTabQuotes for the ODF address: quote a sheet name that is not a plain word. */
function QuoteTab(rName: string): string {
  return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(rName) ? rName : `'${rName.replace(/'/g, "''")}'`;
}

export const ScRangeStringConverter = {
  /** One address ("Sheet1.A1", "$'My sheet'.$B$2"); null when it is none. */
  GetAddressFromString(rAddressStr: string, rDoc: ScDocument): ScAddress | null {
    const r = new ScAddress();
    const nRes = r.Parse(rAddressStr.trim(), rDoc);
    return nRes & ScRefFlags.VALID ? r : null;
  },

  /** A range "Sheet1.A1:Sheet1.B2" or "$Sheet1.$A$1:.$B$2" (the end on the start's sheet). */
  GetRangeFromString(rRangeStr: string, rDoc: ScDocument): ScRange | null {
    const s = rRangeStr.trim();
    const nColon = IndexOf(s, ':', 0);
    const aStart = ScRangeStringConverter.GetAddressFromString(nColon < 0 ? s : s.slice(0, nColon), rDoc);
    if (!aStart) return null;
    if (nColon < 0) return new ScRange(aStart, aStart);
    let sEnd = s.slice(nColon + 1);
    if (sEnd.startsWith('.') || sEnd.startsWith('$.')) sEnd = `${QuoteTab(rDoc.GetName(aStart.Tab()) ?? '')}${sEnd.replace(/^\$?/, '')}`;
    const aEnd = ScRangeStringConverter.GetAddressFromString(sEnd, rDoc);
    if (!aEnd) return null;
    const r = new ScRange(aStart, aEnd);
    r.PutInOrder();
    return r;
  },

  /** A space separated list of ranges. */
  GetRangeListFromString(rRangeListStr: string, rDoc: ScDocument): ScRange[] {
    const out: ScRange[] = [];
    let nOffset = 0;
    const s = rRangeListStr.trim();
    while (nOffset < s.length) {
      let nEnd = IndexOf(s, ' ', nOffset);
      if (nEnd < 0) nEnd = s.length;
      const part = s.slice(nOffset, nEnd);
      if (part) { const r = ScRangeStringConverter.GetRangeFromString(part, rDoc); if (r) out.push(r); }
      nOffset = nEnd + 1;
    }
    return out;
  },

  /** "Sheet1.A1" (bAbsolute: "$Sheet1.$A$1"). */
  GetStringFromAddress(rAddress: ScAddress, rDoc: ScDocument, bAbsolute = false): string {
    const d = bAbsolute ? '$' : '';
    return `${d}${QuoteTab(rDoc.GetName(rAddress.Tab()) ?? '')}.${d}${ScColToAlpha(rAddress.Col())}${d}${rAddress.Row() + 1}`;
  },

  /** "Sheet1.A1:Sheet1.B2" */
  GetStringFromRange(rRange: ScRange, rDoc: ScDocument, bAbsolute = false): string {
    return `${ScRangeStringConverter.GetStringFromAddress(rRange.aStart, rDoc, bAbsolute)}:${ScRangeStringConverter.GetStringFromAddress(rRange.aEnd, rDoc, bAbsolute)}`;
  },

  GetStringFromRangeList(rRanges: readonly ScRange[], rDoc: ScDocument, bAbsolute = false): string {
    return rRanges.map((r) => ScRangeStringConverter.GetStringFromRange(r, rDoc, bAbsolute)).join(' ');
  },

  GetRangeDataFromString(rString: string, nTab: SCTAB, rDoc: ScDocument, eConv: FormulaGrammar.AddressConvention): ScRangeData | null {
    // This may be called with an external 'doc'#name but wouldn't find any.

    // Dot '.' is not allowed in range names, if present only lookup if it's a
    // sheet-local name. Same for '!' Excel syntax.
    // If eConv == FormulaGrammar::CONV_A1_XL_A1 then try both, first our own.
    let nIndex = -1;
    if (eConv === FormulaGrammar.CONV_OOO || eConv === FormulaGrammar.CONV_A1_XL_A1) nIndex = FindUnquoted(rString, '.');
    if (nIndex < 0 && (eConv === FormulaGrammar.CONV_A1_XL_A1 || eConv === FormulaGrammar.CONV_XL_A1 || eConv === FormulaGrammar.CONV_XL_R1C1 || eConv === FormulaGrammar.CONV_XL_OOX))
      nIndex = FindUnquoted(rString, '!');

    if (nIndex >= 0) {
      if (nIndex === 0) return null; // Can't be a name.

      const aTab = EraseQuotes(rString.slice(0, nIndex), "'");
      const nLocalTab = rDoc.GetTable(aTab);
      if (nLocalTab < 0) return null;

      const pLocalRangeName = rDoc.GetRangeName(nLocalTab);
      if (!pLocalRangeName) return null;

      const aName = rString.slice(nIndex + 1);
      return pLocalRangeName.findByUpperName(aName.toUpperCase());
    }

    const pLocalRangeName = rDoc.GetRangeName(nTab);
    let pData: ScRangeData | null = null;
    const aUpperName = rString.toUpperCase();
    if (pLocalRangeName) pData = pLocalRangeName.findByUpperName(aUpperName);
    if (!pData) {
      const pGlobalRangeName = rDoc.GetRangeName();
      if (pGlobalRangeName) pData = pGlobalRangeName.findByUpperName(aUpperName);
    }
    return pData;
  },
};
