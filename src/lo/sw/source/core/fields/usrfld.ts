// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/core/fields/usrfld.cxx reduced
// @upstream sw/source/core/fields/fldbas.cxx partial
// User fields (SwUserFieldType, SwUserField) and the value formatting of value fields
// (SwValueFieldType::ExpandValue, DoubleToString). Number formats are format codes (svl's
// SvNumberFormatter is held by code here), so a format is not converted between languages; the
// content of an expression is kept as typed and calculated in the field's language.
import { SwCalc, SwCalcError } from '../bastyp/calc.ts';
import { GetOutputString, IsNumberFormat, IsTextFormat } from '../../../../svl/source/numbers/zforlist.ts';
import { GetLocaleNotation } from '../../../../svl/source/numbers/zformat.ts';

/** SwUserType (fldbas.hxx) */
export const SwUserType = { None: 0x0000, String: 0x0001, Expr: 0x0002, LowerMask: 0x0003, UpperMask: 0x0300, ShowCommand: 0x0100, Invisible: 0x0200 } as const;

/** ShellResource::aCalc_Error (STR_CALC_ERROR): what a faulty expression shows. */
export const aCalc_Error = '** Expression is faulty **';

/**
 * SwValueFieldType::DoubleToString: the value with up to 12 decimals, trailing zeros removed, in
 * the language's decimal separator.
 */
export function DoubleToString(rVal: number, nLng: string): string {
  let s = rVal.toFixed(12).replace(/\.?0+$/, '');
  if (s === '-0') s = '0';
  return s.replace('.', GetLocaleNotation(nLng).decimal);
}

/**
 * SwValueFieldType::ExpandValue: the value in the number format (General when unset), or the
 * calculator's error text for a failed calculation (DBL_MAX upstream, NaN here).
 */
export function ExpandValue(rVal: number, nFormat: string | undefined, nLng: string): string {
  if (!Number.isFinite(rVal)) return aCalc_Error; // error string for calculator
  const code = nFormat || 'General';
  if (IsTextFormat(code, nLng)) return DoubleToString(rVal, nLng);
  return GetOutputString(rVal, code, nLng).text;
}

export class SwUserFieldType {
  m_aName: string;
  /** The content as typed: a text, or an expression to calculate. */
  m_aContent = '';
  /** SwUserType String or Expr. */
  m_nType: number = SwUserType.Expr;
  m_nValue = 0;
  m_bValidValue = false;

  constructor(aName: string) { this.m_aName = aName; }

  GetName(): string { return this.m_aName; }
  GetType(): number { return this.m_nType; }
  SetType(nSub: number): void { this.m_nType = nSub; this.m_bValidValue = false; }
  GetContent(): string { return this.m_aContent; }

  /**
   * SwUserFieldType::SetContent: in a number format, text that is a number in the language is
   * stored as that number.
   */
  SetContent(rStr: string, nFormat?: string, nLng = 'en-US'): void {
    if (this.m_aContent === rStr) return;
    this.m_aContent = rStr;
    this.m_bValidValue = false;
    if (nFormat && !IsTextFormat(nFormat, nLng)) {
      const r = IsNumberFormat(rStr, nLng, nFormat);
      if (r) {
        this.SetValue(r.value);
        this.m_aContent = DoubleToString(r.value, nLng);
      }
    }
  }

  SetValue(rVal: number): void { this.m_nValue = rVal; this.m_bValidValue = true; }

  /** SwUserFieldType::GetValue: the content calculated, once until it changes. */
  GetValue(rCalc?: SwCalc): number {
    if (this.m_bValidValue || !rCalc) return this.m_nValue;
    if (!rCalc.Push(this)) {
      rCalc.SetCalcError(SwCalcError.Syntax);
      return 0;
    }
    const v = rCalc.Calculate(this.m_aContent);
    rCalc.Pop();
    if (!rCalc.IsCalcError()) { this.m_nValue = v; this.m_bValidValue = true; }
    else this.m_nValue = 0;
    return this.m_nValue;
  }

  /** SwUserFieldType::Expand: the value in the format for an expression, else the content. */
  Expand(nFormat: string | undefined, nSubType: number, nLng: string): string {
    if ((this.m_nType & SwUserType.Expr) && !(nSubType & SwUserType.ShowCommand)) return ExpandValue(this.m_nValue, nFormat, nLng);
    return this.m_aContent;
  }

  /** SwValueFieldType::GetInputOrDateTime, reduced: the content, as the dialog shows it. */
  GetInputOrDateTime(): string { return this.m_aContent; }

  Clone(): SwUserFieldType {
    const p = new SwUserFieldType(this.m_aName);
    p.m_aContent = this.m_aContent;
    p.m_nType = this.m_nType;
    return p;
  }
}

/** SwUserField::ExpandImpl: nothing when invisible. */
export function ExpandUserField(pType: SwUserFieldType | undefined, nSubType: number, nFormat: string | undefined, nLng: string): string {
  if (nSubType & SwUserType.Invisible) return '';
  return pType ? pType.Expand(nFormat, nSubType, nLng) : '';
}
