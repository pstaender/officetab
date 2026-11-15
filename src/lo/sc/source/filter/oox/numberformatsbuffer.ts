// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/filter/oox/numberformatsbuffer.cxx reduced
// NumberFormatsBuffer: the number formats of styles.xml (numFmt) and Excel's built-in formats by
// their identifiers. Reduced: the built-in table is the default table (spBuiltinFormats_BASE)
// with the en-US table on top, whatever the system locale (the other locales' tables are left
// out); the predefined formats are the en-US codes of LibreOffice's predefined formats; format
// codes stay codes (the port's number formatter identifies formats by code), so the conversion
// with addNewConverted is not needed (except that Excel's "TRUE";"TRUE";"FALSE" becomes BOOLEAN, as
// the formatter recognises it). BIFF12 records are not read.

/** One built-in format: a code, or the identifier of the format it reuses. */
interface BuiltinFormat { mnNumFmtId: number; macFmtCode?: string; mnReuseId?: number }

const NUMFMT_STRING = (n: number, c: string): BuiltinFormat => ({ mnNumFmtId: n, macFmtCode: c });
const NUMFMT_REUSE = (n: number, r: number): BuiltinFormat => ({ mnNumFmtId: n, mnReuseId: r });

/** NUMFMT_CURRENCY_MINUS_SYMBOL_NUMBER */
const CURRENCY_MINUS_SYMBOL_NUMBER = (i: number, SYMBOL: string, SPACE: string, MODIF: string): BuiltinFormat[] => [
  NUMFMT_STRING(i + 0, `${MODIF}${SYMBOL}${SPACE}#,##0;${MODIF}-${SYMBOL}${SPACE}#,##0`),
  NUMFMT_STRING(i + 1, `${MODIF}${SYMBOL}${SPACE}#,##0;[RED]${MODIF}-${SYMBOL}${SPACE}#,##0`),
  NUMFMT_STRING(i + 2, `${MODIF}${SYMBOL}${SPACE}#,##0.00;${MODIF}-${SYMBOL}${SPACE}#,##0.00`),
  NUMFMT_STRING(i + 3, `${MODIF}${SYMBOL}${SPACE}#,##0.00;[RED]${MODIF}-${SYMBOL}${SPACE}#,##0.00`),
];
/** NUMFMT_ACCOUNTING_MINUS_SYMBOL_NUMBER */
const ACCOUNTING_MINUS_SYMBOL_NUMBER = (i: number, SYMBOL: string, SPACE: string): BuiltinFormat[] => [
  NUMFMT_STRING(i + 0, `_-* #,##0_-;-* #,##0_-;_-* "-"_-;_-@_-`),
  NUMFMT_STRING(i + 1, `_-${SYMBOL}${SPACE}* #,##0_-;-${SYMBOL}${SPACE}* #,##0_-;_-${SYMBOL}${SPACE}* "-"_-;_-@_-`),
  NUMFMT_STRING(i + 2, `_-* #,##0.00_-;-* #,##0.00_-;_-* "-"??_-;_-@_-`),
  NUMFMT_STRING(i + 3, `_-${SYMBOL}${SPACE}* #,##0.00_-;-${SYMBOL}${SPACE}* #,##0.00_-;_-${SYMBOL}${SPACE}* "-"??_-;_-@_-`),
];
/** NUMFMT_CURRENCY_OPEN_SYMBOL_NUMBER_CLOSE */
const CURRENCY_OPEN_SYMBOL_NUMBER_CLOSE = (i: number, SYMBOL: string, SPACE: string, MODIF: string): BuiltinFormat[] => [
  NUMFMT_STRING(i + 0, `${MODIF}${SYMBOL}${SPACE}#,##0_);${MODIF}(${SYMBOL}${SPACE}#,##0)`),
  NUMFMT_STRING(i + 1, `${MODIF}${SYMBOL}${SPACE}#,##0_);[RED]${MODIF}(${SYMBOL}${SPACE}#,##0)`),
  NUMFMT_STRING(i + 2, `${MODIF}${SYMBOL}${SPACE}#,##0.00_);${MODIF}(${SYMBOL}${SPACE}#,##0.00)`),
  NUMFMT_STRING(i + 3, `${MODIF}${SYMBOL}${SPACE}#,##0.00_);[RED]${MODIF}(${SYMBOL}${SPACE}#,##0.00)`),
];
/** NUMFMT_ACCOUNTING_OPEN_SYMBOL_NUMBER_CLOSE */
const ACCOUNTING_OPEN_SYMBOL_NUMBER_CLOSE = (i: number, SYMBOL: string, SPACE: string): BuiltinFormat[] => [
  NUMFMT_STRING(i + 0, `_(* #,##0_);_(* (#,##0);_(* "-"_);_(@_)`),
  NUMFMT_STRING(i + 1, `_(${SYMBOL}${SPACE}* #,##0_);_(${SYMBOL}${SPACE}* (#,##0);_(${SYMBOL}${SPACE}* "-"_);_(@_)`),
  NUMFMT_STRING(i + 2, `_(* #,##0.00_);_(* (#,##0.00);_(* "-"??_);_(@_)`),
  NUMFMT_STRING(i + 3, `_(${SYMBOL}${SPACE}* #,##0.00_);_(${SYMBOL}${SPACE}* (#,##0.00);_(${SYMBOL}${SPACE}* "-"??_);_(@_)`),
];
/** NUMFMT_ALLDATETIMES */
const ALLDATETIMES = (SYSTEMDATE: string, DAY: string, DAYSEP: string, MONTH: string, MONTHSEP: string, YEAR: string, HOUR12: string, HOUR24: string): BuiltinFormat[] => [
  NUMFMT_STRING(14, SYSTEMDATE),
  NUMFMT_STRING(15, DAY + DAYSEP + MONTH + MONTHSEP + YEAR),
  NUMFMT_STRING(16, DAY + DAYSEP + MONTH),
  NUMFMT_STRING(17, MONTH + MONTHSEP + YEAR),
  NUMFMT_STRING(18, `${HOUR12}:mm AM/PM`),
  NUMFMT_STRING(19, `${HOUR12}:mm:ss AM/PM`),
  NUMFMT_STRING(20, `${HOUR24}:mm`),
  NUMFMT_STRING(21, `${HOUR24}:mm:ss`),
  NUMFMT_STRING(22, `${SYSTEMDATE} ${HOUR24}:mm`),
];

/** Default number format table. Last parent of all other tables, used for unknown locales. The
    NUMFMT_PREDEF entries are LibreOffice's predefined formats (NumberFormatIndex) in en-US. */
const spBuiltinFormats_BASE: BuiltinFormat[] = [
  // 0..13 numeric and currency formats
  NUMFMT_STRING(0, 'General'), // NUMBER_STANDARD
  NUMFMT_STRING(1, '0'), // NUMBER_INT
  NUMFMT_STRING(2, '0.00'), // NUMBER_DEC2
  NUMFMT_STRING(3, '#,##0'), // NUMBER_1000INT
  NUMFMT_STRING(4, '#,##0.00'), // NUMBER_1000DEC2
  NUMFMT_STRING(5, '[$$-409]#,##0;-[$$-409]#,##0'), // CURRENCY_1000INT
  NUMFMT_STRING(6, '[$$-409]#,##0;[RED]-[$$-409]#,##0'), // CURRENCY_1000INT_RED
  NUMFMT_STRING(7, '[$$-409]#,##0.00;-[$$-409]#,##0.00'), // CURRENCY_1000DEC2
  NUMFMT_STRING(8, '[$$-409]#,##0.00;[RED]-[$$-409]#,##0.00'), // CURRENCY_1000DEC2_RED
  NUMFMT_STRING(9, '0%'), // PERCENT_INT
  NUMFMT_STRING(10, '0.00%'), // PERCENT_DEC2
  NUMFMT_STRING(11, '0.00E+00'), // SCIENTIFIC_000E00
  NUMFMT_STRING(12, '# ?/?'), // FRACTION_1
  NUMFMT_STRING(13, '# ??/??'), // FRACTION_2

  // 14...22 date and time formats
  NUMFMT_STRING(14, 'MM/DD/YY'), // DATE_SYS_DDMMYYYY
  NUMFMT_STRING(15, 'DD-MMM-YY'), // DATE_SYS_DMMMYY
  NUMFMT_STRING(16, 'DD-MMM'), // DATE_SYS_DDMMM
  NUMFMT_STRING(17, 'MMM-YY'), // DATE_SYS_MMYY
  NUMFMT_STRING(18, 'HH:MM AM/PM'), // TIME_HHMMAMPM
  NUMFMT_STRING(19, 'HH:MM:SS AM/PM'), // TIME_HHMMSSAMPM
  NUMFMT_STRING(20, 'HH:MM'), // TIME_HHMM
  NUMFMT_STRING(21, 'HH:MM:SS'), // TIME_HHMMSS
  NUMFMT_STRING(22, 'MM/DD/YY HH:MM'), // DATETIME_SYSTEM_SHORT_HHMM

  // 23...36 international formats
  NUMFMT_REUSE(23, 0),
  NUMFMT_REUSE(24, 0),
  NUMFMT_REUSE(25, 0),
  NUMFMT_REUSE(26, 0),
  NUMFMT_REUSE(27, 14),
  NUMFMT_REUSE(28, 14),
  NUMFMT_REUSE(29, 14),
  NUMFMT_REUSE(30, 14),
  NUMFMT_REUSE(31, 14),
  NUMFMT_REUSE(32, 21),
  NUMFMT_REUSE(33, 21),
  NUMFMT_REUSE(34, 21),
  NUMFMT_REUSE(35, 21),
  NUMFMT_REUSE(36, 14),

  // 37...44 accounting formats, defaults without currency symbol here
  ...CURRENCY_MINUS_SYMBOL_NUMBER(37, '', '', ''),
  ...ACCOUNTING_MINUS_SYMBOL_NUMBER(41, '', ''),

  // 45...49 more special formats
  NUMFMT_STRING(45, 'mm:ss'),
  NUMFMT_STRING(46, '[h]:mm:ss'),
  NUMFMT_STRING(47, 'mm:ss.0'),
  NUMFMT_STRING(48, '##0.0E+0'),
  NUMFMT_STRING(49, '@'), // TEXT

  // 50...81 international formats
  ...[50, 51, 52, 53, 54, 55, 56, 57, 58].map((n) => NUMFMT_REUSE(n, 14)),
  NUMFMT_REUSE(59, 1),
  NUMFMT_REUSE(60, 2),
  NUMFMT_REUSE(61, 3),
  NUMFMT_REUSE(62, 4),
  NUMFMT_REUSE(63, 5),
  NUMFMT_REUSE(64, 6),
  NUMFMT_REUSE(65, 7),
  NUMFMT_REUSE(66, 8),
  NUMFMT_REUSE(67, 9),
  NUMFMT_REUSE(68, 10),
  NUMFMT_REUSE(69, 12),
  NUMFMT_REUSE(70, 13),
  NUMFMT_REUSE(71, 14),
  NUMFMT_REUSE(72, 14),
  NUMFMT_REUSE(73, 15),
  NUMFMT_REUSE(74, 16),
  NUMFMT_REUSE(75, 17),
  NUMFMT_REUSE(76, 20),
  NUMFMT_REUSE(77, 21),
  NUMFMT_REUSE(78, 22),
  NUMFMT_REUSE(79, 45),
  NUMFMT_REUSE(80, 46),
  NUMFMT_REUSE(81, 47),

  // 82...163 not used, must not occur in a file (Excel may crash)
];

/** English, USA. */
const spBuiltinFormats_en_US: BuiltinFormat[] = [
  ...ALLDATETIMES('M/D/YYYY', 'D', '-', 'MMM', '-', 'YY', 'h', 'h'),
  // NUMFMT_ALLCURRENCIES_OPEN_SYMBOL_NUMBER_CLOSE( "$", "" )
  ...CURRENCY_OPEN_SYMBOL_NUMBER_CLOSE(5, '$', '', ''),
  ...CURRENCY_OPEN_SYMBOL_NUMBER_CLOSE(37, '', '', ''),
  ...ACCOUNTING_OPEN_SYMBOL_NUMBER_CLOSE(41, '$', ''),
];

/** lclPosToken: the position of sSearch outside quoted text and brackets (-2 if none). */
function lclPosToken(sFormat: string, sSearch: string, nStartPos: number): number {
  const nLength = sFormat.length;
  for (let i = nStartPos; i < nLength && i >= 0; i++) {
    let nFind = i;
    switch (sFormat[i]) {
      case '"': // skip text
        nFind = sFormat.indexOf('"', i + 1);
        break;
      case '[': // skip condition
        nFind = sFormat.indexOf(']', i + 1);
        break;
      default:
        if (sFormat.startsWith(sSearch, i)) return i;
        break;
    }
    if (nFind < 0) return -2;
    i = nFind;
  }
  return -2;
}

export class NumberFormat {
  /** The format code ('' for none). */
  maFmtCode = '';

  setFormatCode(aFmtCode: string): void {
    // Special case for fraction code '\ ?/?', it is passed to us in xml, the '\' is not
    // an escape character but merely should be telling the formatter to display the next
    // char in the format ( afaics it does that anyhow )
    let nPosEscape = 0;
    let nErase = 0;
    const nLastIndex = aFmtCode.length - 1;
    let sFormat = aFmtCode;

    while ((nPosEscape = lclPosToken(aFmtCode, '\\ ', nPosEscape)) > 0) {
      let nPos = nPosEscape + 2;
      while (nPos < nLastIndex && (aFmtCode[nPos] === '?' || aFmtCode[nPos] === '#' || aFmtCode[nPos] === '0')) nPos++;
      if (nPos < nLastIndex && aFmtCode[nPos] === '/') {
        sFormat = sFormat.slice(0, nPosEscape - nErase) + sFormat.slice(nPosEscape - nErase + 1);
        nErase++;
      } // tdf#81939 preserve other escape characters
      nPosEscape = lclPosToken(aFmtCode, ';', nPosEscape); // skip to next format
    }

    // tdf#161301 There may be a lone single stray leading "[$]" garbage, strip it.
    if (sFormat.length >= 3 && sFormat.startsWith('[$]')) sFormat = sFormat.slice(3);

    // the number formatter recognises Excel's boolean format as BOOLEAN
    if (sFormat.toUpperCase() === '"TRUE";"TRUE";"FALSE"') sFormat = 'BOOLEAN';

    this.maFmtCode = sFormat;
  }
}

export class NumberFormatsBuffer {
  private maNumFmts = new Map<number, NumberFormat>();
  private mnHighestId = 0;

  constructor() {
    // create built-in formats for current locale
    this.insertBuiltinFormats();
  }

  createNumFmt(nNumFmtId: number, aFmtCode: string): NumberFormat {
    const xNumFmt = new NumberFormat();
    this.maNumFmts.set(nNumFmtId, xNumFmt);
    if (nNumFmtId > this.mnHighestId) this.mnHighestId = nNumFmtId;
    xNumFmt.setFormatCode(aFmtCode);
    return xNumFmt;
  }

  /** importNumFmt: a numFmt element's numFmtId and formatCode. */
  importNumFmt(rAttribs: Map<string, string>): NumberFormat {
    const nNumFmtId = parseInt(rAttribs.get('numFmtId') ?? '-1', 10);
    const aFmtCode = rAttribs.get('formatCode') ?? '';
    return this.createNumFmt(nNumFmtId, aFmtCode);
  }

  nextFreeId(): number { return ++this.mnHighestId; }

  /** The format code of a format identifier (undefined if unknown); 'General' is the standard format. */
  getFormatCode(nNumFmtId: number): string | undefined {
    const p = this.maNumFmts.get(nNumFmtId);
    if (!p) return undefined;
    // BIFF2-BIFF4 stores standard format explicitly in stream
    if (!p.maFmtCode || p.maFmtCode.toLowerCase() === 'general') return 'General';
    return p.maFmtCode;
  }

  private insertBuiltinFormats(): void {
    // insert the default formats in the format map (from default table to the locale's)
    const aReuseMap = new Map<number, number>();
    for (const table of [spBuiltinFormats_BASE, spBuiltinFormats_en_US]) {
      for (const rBuiltin of table) {
        const rxNumFmt = new NumberFormat();
        this.maNumFmts.set(rBuiltin.mnNumFmtId, rxNumFmt);
        let bReuse = false;
        if (rBuiltin.macFmtCode !== undefined) rxNumFmt.maFmtCode = rBuiltin.macFmtCode;
        else bReuse = (rBuiltin.mnReuseId ?? -1) >= 0;
        if (bReuse) aReuseMap.set(rBuiltin.mnNumFmtId, rBuiltin.mnReuseId!);
        else aReuseMap.delete(rBuiltin.mnNumFmtId);
      }
    }
    // copy reused number formats
    for (const [rNumFmtId, rReuseId] of aReuseMap) {
      this.maNumFmts.set(rNumFmtId, this.maNumFmts.get(rReuseId)!);
      if (rNumFmtId > this.mnHighestId) this.mnHighestId = rNumFmtId;
    }
  }
}
