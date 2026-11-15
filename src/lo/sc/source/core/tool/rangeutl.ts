// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/core/tool/rangeutl.cxx partial
// ScRangeStringConverter::GetRangeDataFromString: the named expression a string names (a sheet
// local name with a sheet prefix, else the sheet's then the global name), as INDIRECT uses it.
import { FormulaGrammar } from '../../../../include/formula/grammar.ts';
import { FindUnquoted, type SCTAB } from '../../../inc/address.ts';
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

export const ScRangeStringConverter = {
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
