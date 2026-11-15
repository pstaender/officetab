// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/stringutil.hxx reduced
// @upstream sc/source/core/tool/stringutil.cxx reduced
// ScSetStringParam (how ScDocument::SetString reads a string) and ScStringUtil's simple number
// parser and multi-line check.

export const TextFormatPolicy = {
  /** Set Text number format if the input string can be parsed as a number or formula text. */
  Always: 0,
  /** Set Text number format only when the input string is considered a special number but we
      only want to detect a simple number. */
  SpecialNumberOnly: 1,
  /** Keep an existing number format, do not set Text number format and do not set another
      number format. */
  Keep: 2,
  /** Never set Text number format. */
  Never: 3,
} as const;
export type TextFormatPolicy = (typeof TextFormatPolicy)[keyof typeof TextFormatPolicy];

export class ScSetStringParam {
  /** When true, we try to detect special number format (dates etc) from the input string, when
      false, we only try to detect a basic decimal number format. */
  mbDetectNumberFormat = true;
  /** When true and the string results in a compiled formula, the formula is parsed even with a
      text cell format... (not used) */
  meSetTextNumFormat: TextFormatPolicy = TextFormatPolicy.Never;
  /** When true, treat input with a leading apostrophe as an escape character for a numeric
      value content, to treat the numeric value as a text. When false, the whole string input
      including the leading apostrophe will be entered literally as string. */
  mbHandleApostrophe = true;
  /** When true and the string is a scientific number, detect it as a number. */
  mbDetectScientificNumberFormat = true;
  /** Whether to check the formula for external links (not used). */
  mbCheckLinkFormula = false;

  /** Call this whenever you need to unconditionally set input as text, no matter what the input
      is. */
  setTextInput(): void {
    this.mbDetectNumberFormat = false;
    this.mbHandleApostrophe = false;
    this.meSetTextNumFormat = TextFormatPolicy.Always;
  }

  /** Call this whenever you need to maximize the chance of input being detected as a numeric
      value (numbers, dates, times etc). */
  setNumericInput(): void {
    this.mbDetectNumberFormat = true;
    this.mbHandleApostrophe = true;
    this.meSetTextNumFormat = TextFormatPolicy.Never;
  }
}

export const ScStringUtil = {
  /** Check if a given string is a simple decimal number (e.g. 12.345). We don't do any
      elaborate parsing here; we only check for the simplest case of decimal number format. */
  parseSimpleNumber(rStr: string, dsep: string, gsep: string, dsepa: string, bDetectScientificNumber: boolean): number | null {
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const dec = dsepa && dsepa !== '\0' ? `[${esc(dsep)}${esc(dsepa)}]` : esc(dsep);
    const re = new RegExp(`^[+-]?(\\d{1,3}(?:${esc(gsep)}\\d{3})+|\\d+)?(?:${dec}\\d*)?${bDetectScientificNumber ? '(?:[eE][+-]?\\d+)?' : ''}$`);
    const s = rStr.trim();
    if (!s || !re.test(s) || !/\d/.test(s)) return null;
    const v = Number(s.split(gsep).join('').replace(new RegExp(dec), '.'));
    return Number.isFinite(v) ? v : null;
  },

  /** Whether the string contains a line break. */
  isMultiline(rStr: string): boolean { return rStr.includes('\n') || rStr.includes('\r'); },
};
