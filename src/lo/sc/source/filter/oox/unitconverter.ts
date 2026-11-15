// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/filter/oox/unitconverter.cxx reduced
// UnitConverter: the units of the Excel import (twips, EMU, digit and space widths of the default
// font, screen pixels at 96 dpi), the null date and the serial date conversion, and the error
// codes (calcDateTimeFromSerial, used by the pivot cache only, is left out). Reduced: the digit and space widths are not measured on the document's reference device
// but taken from the advance widths of common fonts (and their metric-compatible substitutes),
// with Liberation Sans' widths for other fonts; GetDigitWidthTwips is also what the export uses
// as XclRoot::GetCharWidth.

/** Unit (unitconverter.hxx) */
export const Unit = { Inch: 0, Point: 1, Twip: 2, Emu: 3, ScreenX: 4, ScreenY: 5, Digit: 6, Space: 7 } as const;
export type Unit = (typeof Unit)[keyof typeof Unit];

// BIFF error codes (biffhelper.hxx)
export const BIFF_ERR_NULL = 0x00;
export const BIFF_ERR_DIV0 = 0x07;
export const BIFF_ERR_VALUE = 0x0f;
export const BIFF_ERR_REF = 0x17;
export const BIFF_ERR_NAME = 0x1d;
export const BIFF_ERR_NUM = 0x24;
export const BIFF_ERR_NA = 0x2a;

/** The advance width of the digits and of the space of a font, in em. */
interface CharWidths { digit: number; space: number }
const FONT_WIDTHS: Record<string, CharWidths> = {
  calibri: { digit: 1038 / 2048, space: 463 / 2048 },
  carlito: { digit: 1038 / 2048, space: 463 / 2048 },
  arial: { digit: 1139 / 2048, space: 569 / 2048 },
  helvetica: { digit: 1139 / 2048, space: 569 / 2048 },
  'liberation sans': { digit: 1139 / 2048, space: 569 / 2048 },
  'times new roman': { digit: 1024 / 2048, space: 512 / 2048 },
  'liberation serif': { digit: 1024 / 2048, space: 512 / 2048 },
  'courier new': { digit: 1229 / 2048, space: 1229 / 2048 },
  'liberation mono': { digit: 1229 / 2048, space: 1229 / 2048 },
  cambria: { digit: 1131 / 2048, space: 451 / 2048 },
  caladea: { digit: 1131 / 2048, space: 451 / 2048 },
  verdana: { digit: 1302 / 2048, space: 720 / 2048 },
  tahoma: { digit: 1117 / 2048, space: 643 / 2048 },
  aptos: { digit: 1100 / 2048, space: 470 / 2048 },
};
const widthsOf = (rFontName: string): CharWidths => FONT_WIDTHS[rFontName.trim().toLowerCase()] ?? FONT_WIDTHS['liberation sans']!;

/** The width of the widest digit of a font, in twips (the font height in twips). */
export function GetDigitWidthTwips(rFontName: string, nHeightTwips: number): number {
  return Math.max(1, Math.round(widthsOf(rFontName).digit * nHeightTwips));
}
/** The width of the space character of a font, in twips. */
export function GetSpaceWidthTwips(rFontName: string, nHeightTwips: number): number {
  return Math.max(1, Math.round(widthsOf(rFontName).space * nHeightTwips));
}

/** util::Date */
export interface UtilDate { Day: number; Month: number; Year: number }
/** util::DateTime */
export interface UtilDateTime extends UtilDate { Hours: number; Minutes: number; Seconds: number; NanoSeconds: number }

function lclIsLeapYear(nYear: number): boolean {
  return ((nYear % 4) === 0) && (((nYear % 100) !== 0) || ((nYear % 400) === 0));
}

/** Returns the number of days before the passed date, starting from the null
    date 0000-Jan-01, using standard leap year conventions. */
function lclGetDays(rDate: UtilDate): number {
  // number of days in all full years before passed date including all leap days
  let nDays = rDate.Year * 365 + Math.trunc((rDate.Year + 3) / 4) - Math.trunc((rDate.Year + 99) / 100) + Math.trunc((rDate.Year + 399) / 400);
  if ((1 <= rDate.Month) && (rDate.Month <= 12)) {
    // number of days at start of month   jan feb mar apr  may  jun  jul  aug  sep  oct  nov  dec
    const spnCumDays = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    // add number of days in full months before passed date
    nDays += spnCumDays[rDate.Month - 1]!;
    // add number of days from passed date (this adds one day too much)
    nDays += rDate.Day;
    /*  Remove the one day added too much if there is no leap day before
        the passed day in the passed year. This means: remove the day, if
        we are in january or february (leap day not reached if existing),
        or if the passed year is not a leap year. */
    if ((rDate.Month < 3) || !lclIsLeapYear(rDate.Year)) --nDays;
  }
  return nDays;
}

const EMU_PER_TWIP = 635;
const EMU_PER_MM = 36000;

export class UnitConverter {
  private maCoeffs: number[] = [];
  private maOoxErrCodes = new Map<string, number>();
  private mnNullDate: number;

  constructor() {
    this.mnNullDate = lclGetDays({ Day: 30, Month: 12, Year: 1899 });
    // initialize constant and default coefficients
    this.maCoeffs[Unit.Inch] = 914400;
    this.maCoeffs[Unit.Point] = 12700;
    this.maCoeffs[Unit.Twip] = EMU_PER_TWIP;
    this.maCoeffs[Unit.Emu] = 1;
    // a 96 dpi screen
    this.maCoeffs[Unit.ScreenX] = 9525;
    this.maCoeffs[Unit.ScreenY] = 9525;
    this.maCoeffs[Unit.Digit] = 2.0 * EMU_PER_MM; // default: 1 digit = 2 mm
    this.maCoeffs[Unit.Space] = 1.0 * EMU_PER_MM; // default  1 space = 1 mm

    // error code maps
    this.addErrorCode(BIFF_ERR_NULL, '#NULL!');
    this.addErrorCode(BIFF_ERR_DIV0, '#DIV/0!');
    this.addErrorCode(BIFF_ERR_VALUE, '#VALUE!');
    this.addErrorCode(BIFF_ERR_REF, '#REF!');
    this.addErrorCode(BIFF_ERR_NAME, '#NAME?');
    this.addErrorCode(BIFF_ERR_NUM, '#NUM!');
    this.addErrorCode(BIFF_ERR_NA, '#N/A');
  }

  /** finalizeImport: the character widths of the default font (name, height in twips). */
  finalizeImport(rFontName: string, nHeightTwips: number): void {
    if (!rFontName || nHeightTwips <= 0) return;
    // get maximum width of all digits
    const nDigitWidth = GetDigitWidthTwips(rFontName, nHeightTwips) * EMU_PER_TWIP;
    if (nDigitWidth > 0) this.maCoeffs[Unit.Digit] = nDigitWidth;
    // get width of space character
    const nSpaceWidth = GetSpaceWidthTwips(rFontName, nHeightTwips) * EMU_PER_TWIP;
    if (nSpaceWidth > 0) this.maCoeffs[Unit.Space] = nSpaceWidth;
  }

  finalizeNullDate(rNullDate: UtilDate): void {
    // convert the nulldate to number of days since 0000-Jan-01
    this.mnNullDate = lclGetDays(rNullDate);
  }

  scaleValue(fValue: number, eFromUnit: Unit, eToUnit: Unit): number {
    return (eFromUnit === eToUnit) ? fValue : (fValue * this.getCoefficient(eFromUnit) / this.getCoefficient(eToUnit));
  }

  calcSerialFromDateTime(rDateTime: UtilDateTime): number {
    const nDays = lclGetDays({ Day: rDateTime.Day, Month: rDateTime.Month, Year: rDateTime.Year }) - this.mnNullDate;
    return nDays + rDateTime.Hours / 24.0 + rDateTime.Minutes / 1440.0 + rDateTime.Seconds / 86400.0;
  }

  calcBiffErrorCode(rErrorCode: string): number {
    return this.maOoxErrCodes.get(rErrorCode) ?? BIFF_ERR_NA;
  }

  calcErrorString(nErrorCode: number): string {
    for (const [k, v] of this.maOoxErrCodes) if (v === nErrorCode) return k;
    return '#N/A';
  }

  private addErrorCode(nErrorCode: number, rErrorCode: string): void {
    this.maOoxErrCodes.set(rErrorCode, nErrorCode);
  }

  private getCoefficient(eUnit: Unit): number {
    return this.maCoeffs[eUnit]!;
  }
}
