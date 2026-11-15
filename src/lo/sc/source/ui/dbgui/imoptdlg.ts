// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/inc/imoptdlg.hxx faithful
// @upstream sc/source/ui/dbgui/imoptdlg.cxx faithful
// ScImportOptions: the export options of the CSV filter, read from the same filter options
// string as ScAsciiOptions (ScDocShell::AsciiSave takes them). The text encoding is a label as
// in ScAsciiOptions (see asciiopt.ts), aStrFont the options string's encoding token.
import { GetCharsetString, GetCharsetValue, LabelToTextEncoding, RTL_TEXTENCODING_DONTKNOW, RTL_TEXTENCODING_UTF8, ScAsciiOptions, TextEncodingToLabel, getToken, toInt32 } from './asciiopt.ts';

const pStrFix = 'FIX';

/** o3tl::getToken(rStr, nToken, ',', rnIdx) with nToken > 0: skip nToken tokens first. */
function getTokenN(rStr: string, nToken: number, nIdx: number): { aToken: string; nPos: number } {
  let r = getToken(rStr, ',', nIdx);
  while (nToken-- > 0 && r.nPos >= 0) r = getToken(rStr, ',', r.nPos);
  if (nToken >= 0) return { aToken: '', nPos: -1 };
  return r;
}

//  The option string can no longer contain a semicolon (because of pick list),
//  therefore, starting with version 336 comma instead

export class ScImportOptions {
  /** The field separator; '' is none (sal_Unicode 0). */
  nFieldSepCode = '';
  /** The text separator (quote); '' is none. */
  nTextSepCode = '';
  aStrFont = '';
  eCharSet = '';
  bFixedWidth = false;
  bSaveAsShown = false;
  bQuoteAllText = false;
  bSaveNumberAsSuch = true;
  bSaveFormulas = false;
  bRemoveSpace = false;
  bEvaluateFormulas = true;
  bIncludeBOM = false;
  // "0" for 'current sheet', "-1" for all sheets (each to a separate file),
  // or 1-based specific sheet number (to a separate file).
  nSheetToExport = 0;

  /** ScImportOptions(rStr), or ScImportOptions(nFieldSep, nTextSep, nEnc) with nEnc a label. */
  constructor(rStr: string, nTextSep?: string, nEnc?: string) {
    if (nTextSep !== undefined) {
      this.nFieldSepCode = rStr;
      this.nTextSepCode = nTextSep;
      this.SetTextEncoding(nEnc ?? '');
      return;
    }
    // Use the same string format as ScAsciiOptions,
    // because the import options string is passed here when a CSV file is loaded and saved again.
    // The old format is still supported because it might be used in macros.

    this.bFixedWidth = false;
    this.nFieldSepCode = '';
    this.nTextSepCode = '';
    this.eCharSet = '';
    this.bSaveAsShown = true; // "true" if not in string (after CSV import)
    this.bQuoteAllText = false;
    this.bSaveNumberAsSuch = true;
    this.bSaveFormulas = false;
    this.bRemoveSpace = false;
    this.nSheetToExport = 0;
    this.bEvaluateFormulas = true; // true if not present at all, for compatibility
    this.bIncludeBOM = false;
    const nTokenCount = rStr.length ? rStr.split(',').length : 0;
    if (nTokenCount < 3) return;

    let nIdx = 0;
    const next = (nToken = 0): string => {
      const r = getTokenN(rStr, nToken, nIdx);
      nIdx = r.nPos;
      return r.aToken;
    };
    // first 3 tokens: common
    const aToken = next();
    if (aToken.toUpperCase() === pStrFix) this.bFixedWidth = true;
    else this.nFieldSepCode = ScAsciiOptions.GetWeightedFieldSep(aToken, true);
    const nText = toInt32(next());
    this.nTextSepCode = nText ? String.fromCharCode(nText & 0xFFFF) : '';
    this.aStrFont = next();
    this.eCharSet = TextEncodingToLabel(GetCharsetValue(this.aStrFont));

    if (nTokenCount === 4) {
      // compatibility with old options string: "Save as shown" as 4th token, numeric
      this.bSaveAsShown = toInt32(next()) !== 0;
      this.bQuoteAllText = true; // use old default then
    } else {
      // look at the same positions as in ScAsciiOptions
      if (nTokenCount >= 7) this.bQuoteAllText = next(3) === 'true'; // 7th token
      if (nTokenCount >= 8) this.bSaveNumberAsSuch = next() === 'true';
      if (nTokenCount >= 9) this.bSaveAsShown = next() === 'true';
      if (nTokenCount >= 10) this.bSaveFormulas = next() === 'true';
      if (nTokenCount >= 11) this.bRemoveSpace = next() === 'true';
      if (nTokenCount >= 12) {
        const aTok = next();
        if (aTok === '-1') this.nSheetToExport = -1; // all
        else if (aTok.length === 0 || /^[0-9]+$/.test(aTok)) this.nSheetToExport = toInt32(aTok);
        else this.nSheetToExport = -23; // invalid, force error
      }
      if (nTokenCount >= 13)
        // If present, defaults to "false".
        this.bEvaluateFormulas = next() === 'true';
      if (nTokenCount >= 14) this.bIncludeBOM = next() === 'true';
    }
  }

  BuildString(): string {
    let aResult = '';

    if (this.bFixedWidth) aResult += pStrFix;
    else aResult += String(this.nFieldSepCode ? this.nFieldSepCode.charCodeAt(0) : 0);
    aResult += ',' + String(this.nTextSepCode ? this.nTextSepCode.charCodeAt(0) : 0) + ',' + this.aStrFont +
      // use the same string format as ScAsciiOptions:
      ',1,,0,' + // first row, no column info, default language
      String(this.bQuoteAllText) + // same as "quoted field as text" in ScAsciiOptions
      ',' +
      String(this.bSaveNumberAsSuch) + // "save number as such": not in ScAsciiOptions
      ',' +
      String(this.bSaveAsShown) + // "save as shown": not in ScAsciiOptions
      ',' +
      String(this.bSaveFormulas) + // "save formulas": not in ScAsciiOptions
      ',' +
      String(this.bRemoveSpace) + // same as "Remove space" in ScAsciiOptions
      ',' +
      String(this.nSheetToExport) + // Only available for command line --convert-to
      ',' +
      String(this.bEvaluateFormulas) + // same as "Evaluate formulas" in ScAsciiOptions
      ',' +
      String(this.bIncludeBOM); // same as "Include BOM" in ScAsciiOptions

    return aResult;
  }

  /** nEnc: an encoding label, '' for RTL_TEXTENCODING_DONTKNOW. */
  SetTextEncoding(nEnc: string): void {
    this.eCharSet = nEnc === '' ? TextEncodingToLabel(RTL_TEXTENCODING_UTF8) : nEnc; // osl_getThreadTextEncoding()
    this.aStrFont = GetCharsetString(nEnc === '' ? RTL_TEXTENCODING_DONTKNOW : LabelToTextEncoding(nEnc));
  }
}
