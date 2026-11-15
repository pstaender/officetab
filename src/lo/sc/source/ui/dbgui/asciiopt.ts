// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/inc/asciiopt.hxx faithful
// @upstream sc/source/ui/dbgui/asciiopt.cxx reduced
// @upstream sc/source/ui/inc/csvcontrol.hxx partial
// @upstream sc/source/core/data/global.cxx partial
// ScAsciiOptions: the options of the CSV ("Text - txt - csv (StarCalc)") filter and their
// filter options string (ReadFromString / WriteToString). From csvcontrol.hxx only the column
// types (SC_COL_*) and ScCsvExpData; from global.cxx ScGlobal::GetCharsetValue and
// GetCharsetString.
//
// Differences: the text encoding is held as a WHATWG encoding label ('utf-8', 'windows-1252',
// ...; what TextDecoder takes) instead of an rtl_TextEncoding, and translated to and from the
// rtl_TextEncoding numbers of the options string; osl_getThreadTextEncoding() (the "system"
// encoding) is UTF-8. A LanguageType stays a number (as in the options string); LanguageTypeToTag
// translates it to the BCP 47 tag the number formatter takes (LANGUAGE_SYSTEM is en-US).
// "DETECT" for the encoding needs bytes (ICU's charset detector, SfxObjectShell::DetectCharSet)
// and is left to the caller, which decodes the file: the encoding is kept unchanged then.
// Not upstream: accessors for bSaveAsShown and bSaveFormulas, which upstream only reads through
// the options string (ScImportOptions), so that a dialog can set them.
import { DetectCsvSeparators, type SvTextStream } from '../../../../sfx2/source/doc/objstor.ts';

// --- csvcontrol.hxx ------------------------------------------------------------------------------

// External used column types.
export const SC_COL_STANDARD = 1;
export const SC_COL_TEXT = 2;
export const SC_COL_MDY = 3;
export const SC_COL_DMY = 4;
export const SC_COL_YMD = 5;
export const SC_COL_SKIP = 9;
export const SC_COL_ENGLISH = 10;

/** Exported data of a column (data used in the dialog). */
export class ScCsvExpData {
  mnIndex: number; /// Index of a column.
  mnType: number; /// External type of the column.
  constructor(nIndex = 0, nType: number = SC_COL_STANDARD) {
    this.mnIndex = nIndex;
    this.mnType = nType;
  }
}
export type ScCsvExpDataVec = ScCsvExpData[];

// --- rtl_TextEncoding and LanguageType -----------------------------------------------------------

/** rtl_TextEncoding values (rtl/textenc.h) with the label TextDecoder knows them by. */
const aTextEncodings: readonly (readonly [number, string])[] = [
  [1, 'windows-1252'], [2, 'macintosh'], [3, 'ibm437'], [4, 'ibm850'], [11, 'us-ascii'],
  [12, 'iso-8859-1'], [13, 'iso-8859-2'], [14, 'iso-8859-3'], [15, 'iso-8859-4'], [16, 'iso-8859-5'],
  [17, 'iso-8859-6'], [18, 'iso-8859-7'], [19, 'iso-8859-8'], [20, 'iso-8859-9'], [21, 'iso-8859-14'],
  [22, 'iso-8859-15'], [30, 'ibm866'], [32, 'windows-874'], [33, 'windows-1250'], [34, 'windows-1251'],
  [35, 'windows-1253'], [36, 'windows-1254'], [37, 'windows-1255'], [38, 'windows-1256'],
  [39, 'windows-1257'], [40, 'windows-1258'], [44, 'x-mac-cyrillic'], [60, 'shift_jis'], [61, 'gbk'],
  [62, 'euc-kr'], [63, 'big5'], [64, 'shift_jis'], [65, 'gb2312'], [67, 'gbk'], [68, 'big5'],
  [69, 'euc-jp'], [70, 'gb2312'], [72, 'iso-2022-jp'], [74, 'koi8-r'], [76, 'utf-8'],
  [77, 'iso-8859-10'], [78, 'iso-8859-13'], [79, 'euc-kr'], [85, 'gb18030'], [86, 'big5-hkscs'],
  [87, 'tis-620'], [88, 'koi8-u'], [0xFFFF, 'utf-16le'],
];
export const RTL_TEXTENCODING_DONTKNOW = 0;
export const RTL_TEXTENCODING_UTF8 = 76;
export const RTL_TEXTENCODING_UNICODE = 0xFFFF;

/** The label of an rtl_TextEncoding ('' for RTL_TEXTENCODING_DONTKNOW or an unknown one). */
export function TextEncodingToLabel(eEnc: number): string {
  return aTextEncodings.find(([n]) => n === eEnc)?.[1] ?? '';
}
/** The rtl_TextEncoding of a label (RTL_TEXTENCODING_DONTKNOW if unknown). */
export function LabelToTextEncoding(aLabel: string): number {
  const s = aLabel.toLowerCase();
  if (s === 'utf-16' || s === 'utf-16be') return RTL_TEXTENCODING_UNICODE;
  return aTextEncodings.find(([, l]) => l === s)?.[0] ?? RTL_TEXTENCODING_DONTKNOW;
}
/** osl_getThreadTextEncoding(): UTF-8 in the browser. */
const osl_getThreadTextEncoding = (): number => RTL_TEXTENCODING_UTF8;

/** ScGlobal::GetCharsetValue */
export function GetCharsetValue(rCharSet: string): number {
  // new TextEncoding values
  if (/^[0-9]+$/.test(rCharSet)) {
    const nVal = parseInt(rCharSet, 10);
    if (nVal === RTL_TEXTENCODING_DONTKNOW) return osl_getThreadTextEncoding();
    return nVal;
  }
  // old CharSet values for compatibility
  const s = rCharSet.toUpperCase();
  if (s === 'ANSI') return 1; // RTL_TEXTENCODING_MS_1252
  else if (s === 'MAC') return 2; // RTL_TEXTENCODING_APPLE_ROMAN
  else if (s === 'IBMPC') return 4; // RTL_TEXTENCODING_IBM_850
  else if (s === 'IBMPC_437') return 3;
  else if (s === 'IBMPC_850') return 4;
  else if (s === 'IBMPC_860') return 5;
  else if (s === 'IBMPC_861') return 6;
  else if (s === 'IBMPC_863') return 7;
  else if (s === 'IBMPC_865') return 8;
  // Some wrong "help" on the net mentions UTF8 and even unoconv uses it,
  // which worked accidentally if the system encoding is UTF-8 anyway, so
  // support it ;) but only when reading.
  else if (s === 'UTF8') return RTL_TEXTENCODING_UTF8;
  else if (s === 'UTF-8') return RTL_TEXTENCODING_UTF8;
  else return osl_getThreadTextEncoding();
}

/** ScGlobal::GetCharsetString */
export function GetCharsetString(eVal: number): string {
  switch (eVal) {
    // old CharSet strings for compatibility
    case 1: return 'ANSI';
    case 2: return 'MAC';
    // IBMPC == IBMPC_850
    case 3: return 'IBMPC_437';
    case 4: return 'IBMPC_850';
    case 5: return 'IBMPC_860';
    case 6: return 'IBMPC_861';
    case 7: return 'IBMPC_863';
    case 8: return 'IBMPC_865';
    case RTL_TEXTENCODING_DONTKNOW: return 'SYSTEM';
    // new string of TextEncoding value
    default: return String(eVal);
  }
}

export const LANGUAGE_SYSTEM = 0x0000;
export const LANGUAGE_DONTKNOW = 0x03FF;
export const LANGUAGE_ENGLISH_US = 0x0409;

/** i18nlangtag's isolang table, reduced to common languages: LanguageType to BCP 47. */
const aLanguageTags: Readonly<Record<number, string>> = {
  0x0401: 'ar-SA', 0x0402: 'bg-BG', 0x0403: 'ca-ES', 0x0404: 'zh-TW', 0x0405: 'cs-CZ', 0x0406: 'da-DK',
  0x0407: 'de-DE', 0x0408: 'el-GR', 0x0409: 'en-US', 0x040a: 'es-ES', 0x040b: 'fi-FI', 0x040c: 'fr-FR',
  0x040d: 'he-IL', 0x040e: 'hu-HU', 0x040f: 'is-IS', 0x0410: 'it-IT', 0x0411: 'ja-JP', 0x0412: 'ko-KR',
  0x0413: 'nl-NL', 0x0414: 'nb-NO', 0x0415: 'pl-PL', 0x0416: 'pt-BR', 0x0418: 'ro-RO', 0x0419: 'ru-RU',
  0x041a: 'hr-HR', 0x041b: 'sk-SK', 0x041d: 'sv-SE', 0x041e: 'th-TH', 0x041f: 'tr-TR', 0x0422: 'uk-UA',
  0x0424: 'sl-SI', 0x0425: 'et-EE', 0x0426: 'lv-LV', 0x0427: 'lt-LT', 0x0804: 'zh-CN', 0x0807: 'de-CH',
  0x0809: 'en-GB', 0x080a: 'es-MX', 0x080c: 'fr-BE', 0x0810: 'it-CH', 0x0813: 'nl-BE', 0x0816: 'pt-PT',
  0x0c07: 'de-AT', 0x0c09: 'en-AU', 0x0c0a: 'es-ES', 0x0c0c: 'fr-CA', 0x1009: 'en-CA', 0x100c: 'fr-CH',
  0x1409: 'en-NZ', 0x1809: 'en-IE', 0x1c09: 'en-ZA', 0x4009: 'en-IN',
};
/** The BCP 47 tag of a LanguageType; LANGUAGE_SYSTEM (and unknown ones) are en-US. */
export function LanguageTypeToTag(eLang: number): string {
  return aLanguageTags[eLang] ?? 'en-US';
}
/** The LanguageType of a BCP 47 tag ('' is LANGUAGE_SYSTEM, unknown ones LANGUAGE_DONTKNOW). */
export function TagToLanguageType(aTag: string): number {
  if (!aTag) return LANGUAGE_SYSTEM;
  for (const [k, v] of Object.entries(aLanguageTags)) if (v.toLowerCase() === aTag.toLowerCase()) return Number(k);
  return LANGUAGE_DONTKNOW;
}

// --- asciiopt.cxx --------------------------------------------------------------------------------

const pStrFix = 'FIX';
const pStrMrg = 'MRG';
const pStrDet = 'DETECT';

/** o3tl::getToken(rStr, 0, cTok, nPos): the token at nPos and the position after it (-1 at the end). */
export function getToken(rStr: string, cTok: string, nPos: number): { aToken: string; nPos: number } {
  const nEnd = rStr.indexOf(cTok, nPos);
  if (nEnd < 0) return { aToken: rStr.slice(nPos), nPos: -1 };
  return { aToken: rStr.slice(nPos, nEnd), nPos: nEnd + 1 };
}
/** o3tl::toInt32: the leading integer of a string, 0 if none. */
export function toInt32(s: string): number {
  const m = /^\s*([+-]?\d+)/.exec(s);
  return m ? (parseInt(m[1]!, 10) | 0) : 0;
}

export class ScAsciiOptions {
  private bFixedLen = false;
  private aFieldSeps = ';';
  private bMergeFieldSeps = false;
  private bRemoveSpace = false;
  private bQuotedFieldAsText = false;
  private bDetectSpecialNumber = false;
  private bDetectScientificNumber = true;
  private bEvaluateFormulas = true;
  private bSkipEmptyCells = false;
  private bSaveAsShown = true;
  private bSaveFormulas = false;
  private bIncludeBOM = false;
  private cTextSep: string = '"'; // cDefaultTextSep
  private eCharSet: string = TextEncodingToLabel(osl_getThreadTextEncoding());
  private eLang: number = LANGUAGE_SYSTEM;
  private bCharSetSystem = false;
  private nStartRow = 1;
  private mvColStart: number[] = [];
  private mvColFormat: number[] = [];

  static readonly cDefaultTextSep = '"';

  /** A copy (the C++ copy constructor). */
  Clone(): ScAsciiOptions {
    const r = Object.assign(new ScAsciiOptions(), this);
    r.mvColStart = [...this.mvColStart];
    r.mvColFormat = [...this.mvColFormat];
    return r;
  }

  GetCharSet(): string { return this.eCharSet; }
  GetFieldSeps(): string { return this.aFieldSeps; }
  IsMergeSeps(): boolean { return this.bMergeFieldSeps; }
  IsRemoveSpace(): boolean { return this.bRemoveSpace; }
  IsQuotedAsText(): boolean { return this.bQuotedFieldAsText; }
  IsDetectSpecialNumber(): boolean { return this.bDetectSpecialNumber; }
  IsDetectScientificNumber(): boolean { return this.bDetectScientificNumber; }
  IsEvaluateFormulas(): boolean { return this.bEvaluateFormulas; }
  IsSkipEmptyCells(): boolean { return this.bSkipEmptyCells; }
  GetIncludeBOM(): boolean { return this.bIncludeBOM; }
  /** The quote character; '' is none (sal_Unicode 0). */
  GetTextSep(): string { return this.cTextSep; }
  IsFixedLen(): boolean { return this.bFixedLen; }
  GetInfoCount(): number { return this.mvColStart.length; }
  GetColStart(): readonly number[] { return this.mvColStart; }
  GetColFormat(): readonly number[] { return this.mvColFormat; }
  GetStartRow(): number { return this.nStartRow; }
  GetLanguage(): number { return this.eLang; }
  /** Not upstream (see the header). */
  IsSaveAsShown(): boolean { return this.bSaveAsShown; }
  IsSaveFormulas(): boolean { return this.bSaveFormulas; }

  SetCharSet(eNew: string): void { this.eCharSet = eNew; }
  SetCharSetSystem(bSet: boolean): void { this.bCharSetSystem = bSet; }
  SetFixedLen(bSet: boolean): void { this.bFixedLen = bSet; }
  SetFieldSeps(rStr: string): void { this.aFieldSeps = rStr; }
  SetMergeSeps(bSet: boolean): void { this.bMergeFieldSeps = bSet; }
  SetRemoveSpace(bSet: boolean): void { this.bRemoveSpace = bSet; }
  SetQuotedAsText(bSet: boolean): void { this.bQuotedFieldAsText = bSet; }
  SetDetectSpecialNumber(bSet: boolean): void { this.bDetectSpecialNumber = bSet; }
  SetDetectScientificNumber(bSet: boolean): void { this.bDetectScientificNumber = bSet; }
  SetEvaluateFormulas(bSet: boolean): void { this.bEvaluateFormulas = bSet; }
  SetSkipEmptyCells(bSet: boolean): void { this.bSkipEmptyCells = bSet; }
  SetIncludeBOM(bVal: boolean): void { this.bIncludeBOM = bVal; }
  SetTextSep(c: string): void { this.cTextSep = c; }
  SetStartRow(nRow: number): void { this.nStartRow = nRow; }
  SetLanguage(e: number): void { this.eLang = e; }
  /** Not upstream (see the header). */
  SetSaveAsShown(bSet: boolean): void { this.bSaveAsShown = bSet; }
  SetSaveFormulas(bSet: boolean): void { this.bSaveFormulas = bSet; }

  SetColumnInfo(rDataVec: ScCsvExpDataVec): void {
    const nInfoCount = rDataVec.length;
    this.mvColStart.length = nInfoCount;
    this.mvColFormat.length = nInfoCount;
    for (let nIx = 0; nIx < nInfoCount; ++nIx) {
      this.mvColStart[nIx] = rDataVec[nIx]!.mnIndex;
      this.mvColFormat[nIx] = rDataVec[nIx]!.mnType;
    }
  }

  // The options string must not contain semicolons (because of the pick list),
  // use comma as separator.

  ReadFromString(rString: string, pStream4Detect: SvTextStream | null = null): void {
    let nPos = rString.length === 0 ? -1 : 0;
    let bDetectSep = false;
    const next = (): string => {
      const r = getToken(rString, ',', nPos);
      nPos = r.nPos;
      return r.aToken;
    };

    // Token 0: Field separator.
    if (nPos >= 0) {
      this.bFixedLen = this.bMergeFieldSeps = false;

      const aToken = next();
      if (aToken === pStrDet) bDetectSep = true;
      else {
        if (aToken === pStrFix) this.bFixedLen = true;
        const r = lcl_decodeSepString(aToken, this.bMergeFieldSeps);
        this.aFieldSeps = r.aFieldSeps;
        this.bMergeFieldSeps = r.bMergeFieldSeps;
      }
    }

    // Token 1: Text separator.
    if (nPos >= 0) {
      const nVal = toInt32(next());
      this.cTextSep = nVal ? String.fromCharCode(nVal & 0xFFFF) : '';
    }

    // Token 2: Text encoding.
    if (nPos >= 0) {
      const aToken = next();
      const bDetectCharSet = aToken === pStrDet;
      // Detecting the encoding needs the bytes: the caller decodes them (see the header).
      if (!bDetectCharSet) this.eCharSet = TextEncodingToLabel(GetCharsetValue(aToken)) || TextEncodingToLabel(osl_getThreadTextEncoding());
    }

    if (bDetectSep && pStream4Detect) this.aFieldSeps = DetectCsvSeparators(pStream4Detect, this.cTextSep);

    // Token 3: Number of start row.
    if (nPos >= 0) {
      this.nStartRow = toInt32(next());
    }

    // Token 4: Column info.
    if (nPos >= 0) {
      const aToken = next();
      const nInfoCount = Math.trunc((aToken.length ? aToken.split('/').length : 0) / 2);
      this.mvColStart.length = nInfoCount;
      this.mvColFormat.length = nInfoCount;
      let nP = 0;
      for (let nInfo = 0; nInfo < nInfoCount; ++nInfo) {
        let r = getToken(aToken, '/', nP);
        nP = r.nPos;
        this.mvColStart[nInfo] = toInt32(r.aToken);
        r = getToken(aToken, '/', nP);
        nP = r.nPos;
        this.mvColFormat[nInfo] = toInt32(r.aToken) & 0xFF;
      }
    }

    // Token 5: Language.
    if (nPos >= 0) {
      this.eLang = toInt32(next()) & 0xFFFF;
    }

    // Token 6: Import quoted field as text.
    if (nPos >= 0) {
      this.bQuotedFieldAsText = next() === 'true';
    }

    // Token 7: Detect special numbers.
    if (nPos >= 0) {
      this.bDetectSpecialNumber = next() === 'true';
    } else this.bDetectSpecialNumber = true; // default of versions that didn't add the parameter

    // Token 8: used for "Save as shown" in export options
    if (nPos >= 0) {
      this.bSaveAsShown = next() === 'true';
    } else this.bSaveAsShown = true; // default value

    // Token 9: used for "Save cell formulas" in export options
    if (nPos >= 0) {
      this.bSaveFormulas = next() === 'true';
    } else this.bSaveFormulas = false;

    // Token 10: Boolean for Trim spaces.
    if (nPos >= 0) {
      this.bRemoveSpace = next() === 'true';
    } else this.bRemoveSpace = false;

    // Token 11: sheet to export for --convert-to csv
    // Does not need to be evaluated here but may be present.
    if (nPos >= 0) {
      next();
    }

    // Token 12: evaluate formulas.
    if (nPos >= 0) {
      // If present, defaults to "false".
      this.bEvaluateFormulas = next() === 'true';
    } else this.bEvaluateFormulas = true; // default of versions that didn't add the parameter

    // Token 13: include BOM.
    this.bIncludeBOM = nPos >= 0 && next() === 'true';

    // Token 14: Detect scientific numbers.
    if (nPos >= 0) {
      this.bDetectScientificNumber = next() === 'true';
    } else this.bDetectScientificNumber = true; // default of versions that didn't add the parameter
  }

  WriteToString(): string {
    let aOutStr = '';

    // Token 0: Field separator.
    if (this.bFixedLen) aOutStr += pStrFix;
    else if (this.aFieldSeps.length === 0) aOutStr += '0';
    else {
      const nLen = this.aFieldSeps.length;
      for (let i = 0; i < nLen; i++) {
        if (i) aOutStr += '/';
        aOutStr += String(this.aFieldSeps.charCodeAt(i));
      }
      if (this.bMergeFieldSeps) {
        aOutStr += '/' + pStrMrg;
      }
    }

    // Token 1: Text Quote character.
    aOutStr += ',' + String(this.cTextSep ? this.cTextSep.charCodeAt(0) : 0) + ',';

    //Token 2: Text encoding.
    if (this.bCharSetSystem) // force "SYSTEM"
      aOutStr += GetCharsetString(RTL_TEXTENCODING_DONTKNOW);
    else aOutStr += GetCharsetString(LabelToTextEncoding(this.eCharSet));

    //Token 3: Number of start row.
    aOutStr += ',' + String(this.nStartRow) + ',';

    //Token 4: Column info.
    for (let nInfo = 0; nInfo < this.mvColStart.length; nInfo++) {
      if (nInfo) aOutStr += '/';
      aOutStr += String(this.mvColStart[nInfo]) + '/' + String(this.mvColFormat[nInfo]);
    }

    // #i112025# the options string is used in macros and linked sheets,
    // so new options must be added at the end, to remain compatible
    // Always keep in sync with ScImportOptions.

    aOutStr += ',' +
      // Token 5: Language
      String(this.eLang & 0xFFFF) + ',' +
      // Token 6: Import quoted field as text.
      String(this.bQuotedFieldAsText) + ',' +
      // Token 7: Detect special numbers.
      String(this.bDetectSpecialNumber) + ',' +
      // Token 8: used for "Save as shown" in export options
      String(this.bSaveAsShown) + ',' +
      // Token 9: used for "Save cell formulas" in export options
      String(this.bSaveFormulas) + ',' +
      // Token 10: Trim Space
      String(this.bRemoveSpace) +
      // Token 11: sheet to export, always 0 for current sheet
      ',0,' +
      // Token 12: evaluate formulas in import
      String(this.bEvaluateFormulas) + ',' +
      // Token 13: include BOM
      String(this.bIncludeBOM) + ',' +
      // Token 14: Detect scientific numbers.
      String(this.bDetectScientificNumber);
    return aOutStr;
  }

  /** From the import field separators obtain the one most likely to be used
      for export, if multiple separators weighted comma, tab, semicolon,
      space and other.

      @param  bDecodeNumbers
              If TRUE, the separators are encoded as numbers and need to be
              decoded before characters can be extracted, for example "59/44"
              to ";,".
              If FALSE, the string is taken as is and each character is
              expected to be one separator.
      @returns the separator, '' for none (sal_Unicode 0)
   */
  static GetWeightedFieldSep(rFieldSeps: string, bDecodeNumbers: boolean): string {
    const aFieldSeps = bDecodeNumbers ? lcl_decodeSepString(rFieldSeps, false).aFieldSeps : rFieldSeps;
    if (aFieldSeps.length === 0) {
      return '';
    } else if (aFieldSeps.length === 1) return aFieldSeps[0]!;
    else {
      // There can be only one separator for output. See also fdo#53449
      if (aFieldSeps.includes(',')) return ',';
      else if (aFieldSeps.includes('\t')) return '\t';
      else if (aFieldSeps.includes(';')) return ';';
      else if (aFieldSeps.includes(' ')) return ' ';
      else return aFieldSeps[0]!;
    }
  }
}

function lcl_decodeSepString(rSepNums: string, o_bMergeFieldSeps: boolean): { aFieldSeps: string; bMergeFieldSeps: boolean } {
  if (rSepNums.length === 0) return { aFieldSeps: '', bMergeFieldSeps: o_bMergeFieldSeps };

  let aFieldSeps = '';
  let nPos = 0;
  do {
    const r = getToken(rSepNums, '/', nPos);
    nPos = r.nPos;
    const aCode = r.aToken;
    if (aCode === pStrMrg) o_bMergeFieldSeps = true;
    else {
      const nVal = toInt32(aCode);
      if (nVal) aFieldSeps += String.fromCharCode(nVal & 0xFFFF);
    }
  } while (nPos >= 0);

  return { aFieldSeps, bMergeFieldSeps: o_bMergeFieldSeps };
}

/** How ScImportAsciiDlg is called */
export const ScImportAsciiCall = {
  SC_IMPORTFILE: 0, // with File > Open: Text - CSV
  SC_PASTETEXT: 1, // with Paste > Unformatted Text
  SC_TEXTTOCOLUMNS: 2, // with Data > Text to Columns
} as const;
export type ScImportAsciiCall = (typeof ScImportAsciiCall)[keyof typeof ScImportAsciiCall];
