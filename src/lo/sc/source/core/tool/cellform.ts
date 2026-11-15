// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/cellform.hxx reduced
// @upstream sc/source/core/tool/cellform.cxx reduced
// ScCellFormat: the text a cell shows (GetString, with the format's colour) and the text the
// input line edits (GetInputString). Formats are format codes of the svl port. "General" in a
// narrow column (ScColumn's standard format output that drops decimals to fit) is done by
// GetStringForWidth with an estimated digit width instead of the output device's text width.
import { FormulaError } from '../../../../include/formula/errorcodes.ts';
import { GetFormat, GetInputLineString, GetOutputString, GetType, SvNumFormatType } from '../../../../svl/source/numbers/zforlist.ts';
import { CELLTYPE_EDIT, CELLTYPE_FORMULA, CELLTYPE_STRING, CELLTYPE_VALUE, type ScRefCellValue } from '../../../inc/cellvalue.ts';
import { ScGlobal } from '../../../inc/global.ts';

export interface ScCellFormatResult { aString: string; pColor: string | null }

export const ScCellFormat = {
  /** The display string of a cell in a format; bNullVals false hides zero values, bFormula
      shows the formula instead of its result. */
  GetString(rCell: ScRefCellValue, nFormat: string, lang = 'en-US', bNullVals = true, bFormula = false): ScCellFormatResult {
    switch (rCell.getType()) {
      case CELLTYPE_STRING:
        return { aString: GetFormat(nFormat, lang).GetTextOutput(rCell.getSharedString()!), pColor: null };
      case CELLTYPE_EDIT:
        return { aString: GetFormat(nFormat, lang).GetTextOutput(rCell.getString()), pColor: null };
      case CELLTYPE_VALUE: {
        const nValue = rCell.getDouble();
        if (!bNullVals && nValue === 0.0) return { aString: '', pColor: null };
        const r = GetOutputString(nValue, nFormat, lang);
        return { aString: r.text, pColor: r.color };
      }
      case CELLTYPE_FORMULA: {
        const pFCell = rCell.getFormula()!;
        if (bFormula) return { aString: pFCell.GetFormula(), pColor: null };
        // A macro started from the interpreter, which has
        // access to Formula Cells, becomes a CellText, even if
        // that triggers further interpretation, except if those
        // cells are already being interpreted.
        if (pFCell.GetDocument().IsInInterpreter() && pFCell.IsRunning()) return { aString: '...', pColor: null };
        const nErrCode = pFCell.GetErrCode();
        if (nErrCode !== FormulaError.NONE) return { aString: ScGlobal.GetErrorString(nErrCode), pColor: null };
        if (pFCell.IsEmptyDisplayedAsString()) return { aString: '', pColor: null };
        if (pFCell.IsValue()) {
          const fValue = pFCell.GetValue();
          if (!bNullVals && fValue === 0.0) return { aString: '', pColor: null };
          const r = GetOutputString(fValue, nFormat, lang);
          return { aString: r.text, pColor: r.color };
        }
        return { aString: GetFormat(nFormat, lang).GetTextOutput(pFCell.GetString()), pColor: null };
      }
      default:
        return { aString: '', pColor: null };
    }
  },

  /** The string the input line shows for a cell (formulas are handled by the caller). */
  GetInputString(rCell: ScRefCellValue, nFormat: string, lang = 'en-US'): string {
    switch (rCell.getType()) {
      case CELLTYPE_STRING:
      case CELLTYPE_EDIT:
        return rCell.getString();
      case CELLTYPE_VALUE:
        return GetInputLineString(rCell.getDouble(), nFormat, lang);
      case CELLTYPE_FORMULA: {
        let str: string | null = null;
        const pFC = rCell.getFormula()!;
        if (pFC.IsEmptyDisplayedAsString()) {
          // empty
        } else if (pFC.IsValue()) str = GetInputLineString(pFC.GetValue(), nFormat, lang);
        else str = pFC.GetString();
        const nErrCode = pFC.GetErrCode();
        if (nErrCode !== FormulaError.NONE) str = null;
        return str ?? '';
      }
      default:
        return '';
    }
  },

  /**
   * The display string of a number in the General format fitted to a column width (in twips):
   * ScColumn's standard format output drops decimals (rounding) until the text fits, and falls
   * back to scientific notation, then to "###". Digits are estimated at 0.55 em of the font
   * height (Liberation Sans' digit advance), which replaces the output device's text width.
   */
  GetStringForWidth(fValue: number, nFormat: string, nWidthTwips: number, nFontHeightTwips = 200, lang = 'en-US'): ScCellFormatResult {
    const r = GetOutputString(fValue, nFormat, lang);
    const nCharWidth = nFontHeightTwips * 0.55;
    const nAvail = nWidthTwips - 2 * 20; // the cell's left and right margins
    const fits = (s: string) => s.length * nCharWidth <= nAvail;
    if (GetType(nFormat, lang) !== SvNumFormatType.NUMBER || !/^General$/i.test(nFormat.trim()) || fits(r.text)) return { aString: r.text, pColor: r.color };
    // Reduce decimals.
    const a = Math.abs(fValue);
    if (a >= 1e-4 && a < 1e15) {
      const nInt = Math.max(1, Math.floor(Math.log10(a)) + 1);
      for (let nDec = Math.max(0, 10 - nInt); nDec >= 0; nDec--) {
        let s = fValue.toFixed(nDec);
        if (nDec > 0) s = s.replace(/\.?0+$/, '');
        if (fits(s)) return { aString: s, pColor: r.color };
      }
    }
    // Scientific.
    for (let nDec = 5; nDec >= 0; nDec--) {
      const s = fValue.toExponential(nDec).replace(/\.?0+e/, 'e').replace('e', 'E').replace(/E\+?(-?)(\d)$/, 'E$1$2').replace(/E(\d)/, 'E+$1');
      if (fits(s)) return { aString: s, pColor: r.color };
    }
    return { aString: '###', pColor: r.color };
  },
};
