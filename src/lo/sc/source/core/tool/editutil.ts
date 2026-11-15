// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/editutil.hxx partial
// @upstream sc/source/core/tool/editutil.cxx partial
// The header and footer fields of printing: ScHeaderFieldData (the page number, page count,
// sheet name, title, file names, date and time) and ScHeaderEditEngine::CalcFieldValue, which
// gives a field's text. The page numbering type is the ODF style:num-format the page style
// keeps ('1', 'A', 'a', 'I', 'i', '' for none) instead of SvxNumType. The date and time use the
// en-US locale's standard formats (LocaleDataWrapper::getDate/getTime). The edit engines
// themselves (ScEditEngineDefaulter, ScFieldEditEngine) are not ported.
import type { SvxFieldKind } from '../../../../editeng/source/editeng/editobj.ts';
import { toRoman } from '../../../../i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';
import { GetOutputString } from '../../../../svl/source/numbers/zforlist.ts';

export class ScHeaderFieldData {
  /** title or file name (if no title) */
  aTitle = '';
  /** path and file name */
  aLongDocName = '';
  /** pure file name */
  aShortDocName = '';
  aTabName = '';
  aDateTime: Date = new Date(0);
  nPageNo = 0;
  nTotalPages = 0;
  /** the numbering type of page numbers (SvxNumType as ODF's style:num-format) */
  eNumType = '1';
}

function lcl_GetCharStr(nNo: number): string {
  let aStr = '';

  const coDiff = 'Z'.charCodeAt(0) - 'A'.charCodeAt(0) + 1;
  let nCalc: number;

  do {
    nCalc = nNo % coDiff;
    if (!nCalc) nCalc = coDiff;
    aStr = String.fromCharCode('a'.charCodeAt(0) - 1 + nCalc) + aStr;
    nNo = nNo - nCalc;
    if (nNo) nNo = Math.trunc(nNo / coDiff);
  } while (nNo);
  return aStr;
}

export function lcl_GetNumStr(nNo: number, eType: string): string {
  let aTmpStr = '0';
  if (nNo) {
    switch (eType) {
      case 'A': // CHARS_UPPER_LETTER
      case 'a': // CHARS_LOWER_LETTER
        aTmpStr = lcl_GetCharStr(nNo);
        break;

      case 'I': // ROMAN_UPPER
      case 'i': // ROMAN_LOWER
        if (nNo < 4000) aTmpStr = eType === 'I' ? toRoman(nNo).toUpperCase() : toRoman(nNo).toLowerCase();
        else aTmpStr = '';
        break;

      case '': // NUMBER_NONE
        aTmpStr = '';
        break;

      //      case ARABIC:    is default now
      default:
        aTmpStr = String(nNo);
        break;
    }

    if (eType === 'A') aTmpStr = aTmpStr.toUpperCase();
  }
  return aTmpStr;
}

/** A date and time as a spreadsheet serial number (days since 1899-12-30, local time). */
function DateTimeToSerial(d: Date): number {
  return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) - Date.UTC(1899, 11, 30)) / 86400000;
}

/** ScHeaderEditEngine::CalcFieldValue: the text a header or footer field shows. */
export function CalcFieldValue(eField: SvxFieldKind, aData: ScHeaderFieldData): string {
  let aRet: string;
  switch (eField) {
    case 'PAGE':
      aRet = lcl_GetNumStr(aData.nPageNo, aData.eNumType);
      break;
    case 'PAGES':
      aRet = lcl_GetNumStr(aData.nTotalPages, aData.eNumType);
      break;
    case 'TIME':
      // For now, time field in the header / footer is always dynamic.
      aRet = GetOutputString(DateTimeToSerial(aData.aDateTime), 'HH:MM:SS', 'en-US').text;
      break;
    case 'TITLE':
      aRet = aData.aTitle;
      break;
    case 'FILE':
      aRet = aData.aShortDocName;
      break;
    case 'TABLE':
      aRet = aData.aTabName;
      break;
    case 'DATE':
      aRet = GetOutputString(Math.floor(DateTimeToSerial(aData.aDateTime)), 'MM/DD/YY', 'en-US').text;
      break;
    default:
      aRet = '?';
  }
  return aRet;
}
