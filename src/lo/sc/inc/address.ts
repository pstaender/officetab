// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/address.hxx faithful
// @upstream sc/source/core/tool/address.cxx reduced
// ScAddress, ScRange, ScRefAddress and the address parser and formatter for Calc A1 (CONV_OOO),
// Excel A1 (CONV_XL_A1, CONV_XL_OOX) and R1C1 (CONV_XL_R1C1). Strings are parsed through an index
// instead of a sal_Unicode pointer (-1 for nullptr, '\0' past the end). Left out: references to
// external documents ('file'#Sheet.A1, [doc]Sheet!A1 and the pExtInfo / pExternalLinks
// machinery; such references do not parse) and the FORCE_DOC document name of VBA.
import { FormulaGrammar } from '../../include/formula/grammar.ts';
import type { ScSheetLimits } from './sheetlimits.ts';
import { CheckTabQuotes, FormExcelSheetRange, GetDocTabPos } from '../source/core/tool/compiler.ts';

export type SCROW = number;
export type SCCOL = number;
export type SCTAB = number;
export type SCCOLROW = number;
export type SCSIZE = number;

// Maximum possible value of data type, NOT maximum row value.
export const SCROW_MAX = 0x7fffffff;
export const SCCOL_MAX = 0x7fff;
export const SCTAB_MAX = 0x7fff;
export const SCCOLROW_MAX = 0x7fffffff;
export const SCSIZE_MAX = Number.MAX_SAFE_INTEGER;

// Count values
export const MAXROWCOUNT = 1024 * 1024;
export const MAXCOLCOUNT = 16 * 1024;
export const INITIALCOLCOUNT = 1; // initial number of columns we allocate memory for
/// limiting to 10000 for now, problem with 32 bit builds for now
export const MAXTABCOUNT = 10000;
// Maximum values
export const MAXROW = MAXROWCOUNT - 1;
export const MAXCOL = MAXCOLCOUNT - 1;
export const MAXTAB = MAXTABCOUNT - 1;
export const MAXCOLROW = MAXROW;
export const MAXROWCOUNT_JUMBO = 16 * 1024 * 1024;
export const MAXCOLCOUNT_JUMBO = 16 * 1024;
export const MAXROW_JUMBO = MAXROWCOUNT_JUMBO - 1;
export const MAXCOL_JUMBO = MAXCOLCOUNT_JUMBO - 1;
// Maximum tiled rendering values
export const MAXTILEDROW = MAXROW;
// Limit the initial tab count to prevent users to set the count too high,
// which could cause the memory usage of blank documents to exceed the
// available system memory.
export const MAXINITTAB = 1024;
export const MININITTAB = 1;

export const MAXROW_STRING = '1048575';
export const MAXCOL_STRING = 'XFD';
export const MAXROW_JUMBO_STRING = '16777215';
export const MAXCOL_JUMBO_STRING = 'XFD';

// Special values
export const SC_TAB_APPEND = SCTAB_MAX;
export const TABLEID_DOC = SCTAB_MAX; // entire document, e.g. protect
export const SCROWS32K = 32000; // for fuzzing
export const SCCOL_REPEAT_NONE = SCCOL_MAX;
export const SCROW_REPEAT_NONE = SCROW_MAX;
export const SC_TABSTART_NONE = SCCOL_MAX;
export const MAXROW_30 = 8191;

export const ValidCol = (nCol: SCCOL, nMaxCol: SCCOL): boolean => nCol >= 0 && nCol <= nMaxCol;
export const ValidRow = (nRow: SCROW, nMaxRow: SCROW): boolean => nRow >= 0 && nRow <= nMaxRow;
export const ValidTab = (nTab: SCTAB, nMaxTab: SCTAB = MAXTAB): boolean => nTab >= 0 && nTab <= nMaxTab;
export const ValidColRow = (nCol: SCCOL, nRow: SCROW, nMaxCol: SCCOL, nMaxRow: SCROW): boolean => ValidCol(nCol, nMaxCol) && ValidRow(nRow, nMaxRow);
export const ValidColRowTab = (nCol: SCCOL, nRow: SCROW, nTab: SCTAB, nMaxCol: SCCOL, nMaxRow: SCROW): boolean =>
  ValidCol(nCol, nMaxCol) && ValidRow(nRow, nMaxRow) && ValidTab(nTab);
export const SanitizeCol = (nCol: SCCOL, nMaxCol: SCCOL): SCCOL => (nCol < 0 ? 0 : nCol > nMaxCol ? nMaxCol : nCol);
export const SanitizeRow = (nRow: SCROW, nMaxRow: SCROW): SCROW => (nRow < 0 ? 0 : nRow > nMaxRow ? nMaxRow : nRow);
export const SanitizeTab = (nTab: SCTAB): SCTAB => (nTab < 0 ? 0 : nTab > MAXTAB ? MAXTAB : nTab);

// The result of ConvertRef() is a bit group of the following:
const ScRefFlagsValues = {
  ZERO: 0x0000,
  COL_ABS: 0x0001,
  ROW_ABS: 0x0002,
  TAB_ABS: 0x0004,
  TAB_3D: 0x0008,
  COL2_ABS: 0x0010,
  ROW2_ABS: 0x0020,
  TAB2_ABS: 0x0040,
  TAB2_3D: 0x0080,
  ROW_VALID: 0x0100,
  COL_VALID: 0x0200,
  TAB_VALID: 0x0400,
  // BITS for convenience
  BITS: 0x0001 | 0x0002 | 0x0004 | 0x0008 | 0x0100 | 0x0200 | 0x0400,
  // somewhat cheesy kludge to force the display of the document name even for
  // local references.  Requires TAB_3D to be valid
  FORCE_DOC: 0x0800,
  ROW2_VALID: 0x1000,
  COL2_VALID: 0x2000,
  TAB2_VALID: 0x4000,
  VALID: 0x8000,
  TAB_ABS_3D: 0x0004 | 0x0008,
  ADDR_ABS: 0x8000 | 0x0001 | 0x0002 | 0x0004,
  RANGE_ABS: 0x8000 | 0x0001 | 0x0002 | 0x0004 | 0x0010 | 0x0020 | 0x0040,
  ADDR_ABS_3D: 0x8000 | 0x0001 | 0x0002 | 0x0004 | 0x0008,
  RANGE_ABS_3D: 0x8000 | 0x0001 | 0x0002 | 0x0004 | 0x0010 | 0x0020 | 0x0040 | 0x0008,
};
export const ScRefFlags: { readonly [K in keyof typeof ScRefFlagsValues]: number } = ScRefFlagsValues;
export type ScRefFlags = number;

/** applyStartToEndFlags: moves the start flags (or those of `source`) to the end flags. */
export function applyStartToEndFlags(target: ScRefFlags, source?: ScRefFlags): ScRefFlags {
  return (target | (((source ?? target) << 4) & 0xffff));
}

/** The document an address is parsed against or formatted for: its sheet names and limits. */
export interface ScAddressDocument {
  MaxCol(): SCCOL;
  MaxRow(): SCROW;
  GetSheetLimits(): ScSheetLimits;
  GetTableCount(): SCTAB;
  /** ScDocument::GetTable(rName, rTab): the sheet's index, -1 when there is none. */
  GetTable(rName: string): SCTAB;
  /** ScDocument::GetName(nTab, rName): the sheet's name, undefined when there is none. */
  GetName(nTab: SCTAB): string | undefined;
}

export class ScAddress {
  private nRow: SCROW;
  private nCol: SCCOL;
  private nTab: SCTAB;

  constructor(nColP: SCCOL | ScAddress = 0, nRowP: SCROW = 0, nTabP: SCTAB = 0) {
    if (nColP instanceof ScAddress) { this.nCol = nColP.nCol; this.nRow = nColP.nRow; this.nTab = nColP.nTab; return; }
    this.nRow = nRowP;
    this.nCol = nColP;
    this.nTab = nTabP;
  }

  /** ScAddress(ScAddress::INITIALIZE_INVALID) */
  static Invalid(): ScAddress { return new ScAddress(-1, -1, -1); }

  static readonly detailsOOOa1: ScAddressDetails = { eConv: FormulaGrammar.CONV_OOO, nRow: 0, nCol: 0 };

  clone(): ScAddress { return new ScAddress(this.nCol, this.nRow, this.nTab); }

  assign(rAddress: ScAddress): this {
    this.nCol = rAddress.nCol;
    this.nRow = rAddress.nRow;
    this.nTab = rAddress.nTab;
    return this;
  }

  Set(nColP: SCCOL, nRowP: SCROW, nTabP: SCTAB): void {
    this.nCol = nColP;
    this.nRow = nRowP;
    this.nTab = nTabP;
  }

  Row(): SCROW { return this.nRow; }
  Col(): SCCOL { return this.nCol; }
  Tab(): SCTAB { return this.nTab; }
  SetRow(nRowP: SCROW): void { this.nRow = nRowP; }
  SetCol(nColP: SCCOL): void { this.nCol = nColP; }
  SetTab(nTabP: SCTAB): void { this.nTab = nTabP; }
  SetInvalid(): void { this.nRow = -1; this.nCol = -1; this.nTab = -1; }
  IsValid(): boolean { return this.nRow >= 0 && this.nCol >= 0 && this.nTab >= 0; }

  PutInOrder(rAddress: ScAddress): void {
    if (rAddress.nCol < this.nCol) [this.nCol, rAddress.nCol] = [rAddress.nCol, this.nCol];
    if (rAddress.nRow < this.nRow) [this.nRow, rAddress.nRow] = [rAddress.nRow, this.nRow];
    if (rAddress.nTab < this.nTab) [this.nTab, rAddress.nTab] = [rAddress.nTab, this.nTab];
  }

  IncRow(nDelta: SCROW = 1): void { this.nRow = this.nRow + nDelta; }
  IncCol(nDelta: SCCOL = 1): void { this.nCol = this.nCol + nDelta; }
  IncTab(nDelta: SCTAB = 1): void { this.nTab = this.nTab + nDelta; }

  /**
      @param  pSheetEndPos
              If given and Parse() successfully parsed a sheet name it returns
              the end position (exclusive) behind the sheet name AND a
              following sheet name separator. This independent of whether the
              resulting reference is fully valid or not.
   */
  Parse(r: string, rDoc: ScAddressDocument, rDetails: ScAddressDetails = ScAddress.detailsOOOa1, pSheetEndPos?: { value: number }, pErrRef?: string): ScRefFlags {
    return lcl_ScAddress_Parse(r, rDoc, this, rDetails, pSheetEndPos, pErrRef);
  }

  Format(nFlags: ScRefFlags, pDoc?: ScAddressDocument | null, rDetails: ScAddressDetails = ScAddress.detailsOOOa1): string {
    return lcl_Format(this.nTab, this.nRow, this.nCol, nFlags, pDoc ?? null, rDetails);
  }

  /**
      @param  rErrorPos
              If FALSE is returned, the positions contain <0 or >MAX...
              values if shifted out of bounds.
      @param  pDocument
              The document for the maximum defined sheet number.
   */
  Move(dx: SCCOL, dy: SCROW, dz: SCTAB, rErrorPos: ScAddress, rDoc: ScAddressDocument): boolean {
    const nMaxTab = rDoc.GetTableCount();
    const nMaxCol = rDoc.MaxCol();
    const nMaxRow = rDoc.MaxRow();
    dx = this.Col() + dx;
    dy = this.Row() + dy;
    dz = this.Tab() + dz;
    let bValid = true;
    rErrorPos.SetCol(dx);
    if (dx < 0) { dx = 0; bValid = false; }
    else if (dx > nMaxCol) { dx = nMaxCol; bValid = false; }
    rErrorPos.SetRow(dy);
    if (dy < 0) { dy = 0; bValid = false; }
    else if (dy > nMaxRow) { dy = nMaxRow; bValid = false; }
    rErrorPos.SetTab(dz);
    if (dz < 0) { dz = 0; bValid = false; }
    else if (dz > nMaxTab) {
      // Always set MAXTAB+1 so further checks without ScDocument detect invalid.
      rErrorPos.SetTab(MAXTAB + 1);
      dz = nMaxTab;
      bValid = false;
    }
    this.Set(dx, dy, dz);
    return bValid;
  }

  equals(rAddress: ScAddress): boolean {
    return this.nRow === rAddress.nRow && this.nCol === rAddress.nCol && this.nTab === rAddress.nTab;
  }

  /** operator<=>: ordered by tab, col, row. */
  compare(rh: ScAddress): number {
    return this.nTab - rh.nTab || this.nCol - rh.nCol || this.nRow - rh.nRow;
  }
  lessThan(rh: ScAddress): boolean { return this.compare(rh) < 0; }

  /** Less than ordered by tab,row,col as needed by row-wise import/export */
  lessThanByRow(rh: ScAddress): boolean {
    return (this.nTab - rh.nTab || this.nRow - rh.nRow || this.nCol - rh.nCol) < 0;
  }

  /** A number unique for every valid address (tab, column and row packed). */
  hash(): number {
    return (this.nTab * 0x4000 + this.nCol) * 0x1000000 + this.nRow;
  }

  /**
   * Create a human-readable string representation of the cell address.  You
   * cannot specify precise formatting with this method; use Format() if you
   * need to specify how the address needs to be formatted.
   *
   * The address string does not display sheet name.
   */
  GetColRowString(): string {
    return ScColToAlpha(this.nCol) + String(this.nRow + 1);
  }

  toString(): string { return `${this.nTab + 1}!R${this.nRow + 1}C${this.nCol + 1}`; }
}

export interface ScAddressDetails {
  eConv: FormulaGrammar.AddressConvention;
  nRow: SCROW;
  nCol: SCCOL;
}

/** ScAddress::Details: the convention and, for R1C1, the position relative references start from. */
export function ScAddressDetails(eConvP: FormulaGrammar.AddressConvention, nRowP: SCROW | ScAddress = 0, nColP: SCCOL = 0): ScAddressDetails {
  if (nRowP instanceof ScAddress) return { eConv: eConvP, nRow: nRowP.Row(), nCol: nRowP.Col() };
  return { eConv: eConvP, nRow: nRowP, nCol: nColP };
}

export const ValidAddress = (rAddress: ScAddress, nMaxCol: SCCOL, nMaxRow: SCROW): boolean =>
  ValidCol(rAddress.Col(), nMaxCol) && ValidRow(rAddress.Row(), nMaxRow) && ValidTab(rAddress.Tab());

export class ScRange {
  aStart: ScAddress;
  aEnd: ScAddress;

  constructor(a?: ScAddress | SCCOL, b?: ScAddress | SCROW, nTab?: SCTAB, nCol2?: SCCOL, nRow2?: SCROW, nTab2?: SCTAB) {
    if (a === undefined) { this.aStart = new ScAddress(); this.aEnd = new ScAddress(); return; }
    if (a instanceof ScAddress) {
      if (b instanceof ScAddress) {
        this.aStart = a.clone(); this.aEnd = b.clone();
        this.PutInOrder();
      } else { this.aStart = a.clone(); this.aEnd = a.clone(); }
      return;
    }
    if (nCol2 !== undefined) {
      this.aStart = new ScAddress(a, b as SCROW, nTab!);
      this.aEnd = new ScAddress(nCol2, nRow2!, nTab2!);
      return;
    }
    this.aStart = new ScAddress(a, b as SCROW, nTab!);
    this.aEnd = this.aStart.clone();
  }

  /** ScRange(ScAddress::INITIALIZE_INVALID) */
  static Invalid(): ScRange { const r = new ScRange(); r.SetInvalid(); return r; }

  clone(): ScRange { const r = new ScRange(); r.aStart = this.aStart.clone(); r.aEnd = this.aEnd.clone(); return r; }

  assign(rRange: ScRange | ScAddress): this {
    if (rRange instanceof ScAddress) { this.aStart = rRange.clone(); this.aEnd = rRange.clone(); return this; }
    this.aStart = rRange.aStart.clone();
    this.aEnd = rRange.aEnd.clone();
    return this;
  }

  SetInvalid(): void { this.aStart.SetInvalid(); this.aEnd.SetInvalid(); }
  IsValid(): boolean { return this.aStart.IsValid() && this.aEnd.IsValid(); }

  /** is Address& or Range& fully in Range? */
  Contains(r: ScAddress | ScRange): boolean {
    if (r instanceof ScAddress) {
      return this.aStart.Col() <= r.Col() && r.Col() <= this.aEnd.Col()
        && this.aStart.Row() <= r.Row() && r.Row() <= this.aEnd.Row()
        && this.aStart.Tab() <= r.Tab() && r.Tab() <= this.aEnd.Tab();
    }
    return this.aStart.Col() <= r.aStart.Col() && r.aEnd.Col() <= this.aEnd.Col()
      && this.aStart.Row() <= r.aStart.Row() && r.aEnd.Row() <= this.aEnd.Row()
      && this.aStart.Tab() <= r.aStart.Tab() && r.aEnd.Tab() <= this.aEnd.Tab();
  }

  // do two ranges intersect?
  Intersects(rRange: ScRange): boolean {
    return this.aStart.Col() <= rRange.aEnd.Col() && rRange.aStart.Col() <= this.aEnd.Col()
      && this.aStart.Row() <= rRange.aEnd.Row() && rRange.aStart.Row() <= this.aEnd.Row()
      && this.aStart.Tab() <= rRange.aEnd.Tab() && rRange.aStart.Tab() <= this.aEnd.Tab();
  }

  Parse(rString: string, rDoc: ScAddressDocument, rDetails: ScAddressDetails = ScAddress.detailsOOOa1, pErrRef?: string): ScRefFlags {
    if (!rString) return ScRefFlags.ZERO;
    switch (rDetails.eConv) {
      case FormulaGrammar.CONV_XL_A1:
      case FormulaGrammar.CONV_XL_OOX:
        return lcl_ScRange_Parse_XL_A1(this, rString, rDoc, false, undefined, pErrRef);
      case FormulaGrammar.CONV_XL_R1C1:
        return lcl_ScRange_Parse_XL_R1C1(this, rString, rDoc, rDetails, false, undefined);
      default:
      case FormulaGrammar.CONV_OOO:
        return lcl_ScRange_Parse_OOo(this, rString, rDoc, pErrRef);
    }
  }

  // Accept a full range, or an address
  ParseAny(rString: string, rDoc: ScAddressDocument, rDetails: ScAddressDetails = ScAddress.detailsOOOa1): ScRefFlags {
    let nRet = this.Parse(rString, rDoc, rDetails);
    const nValid = ScRefFlags.VALID | ScRefFlags.COL2_VALID | ScRefFlags.ROW2_VALID | ScRefFlags.TAB2_VALID;
    if ((nRet & nValid) !== nValid) {
      const aAdr = this.aStart.clone(); //initialize with currentPos as fallback for table number
      nRet = aAdr.Parse(rString, rDoc, rDetails);
      if (nRet & ScRefFlags.VALID) { this.aStart = aAdr.clone(); this.aEnd = aAdr.clone(); }
    }
    return nRet;
  }

  // Parse only full row references
  ParseCols(rDoc: ScAddressDocument, rStr: string, rDetails: ScAddressDetails = ScAddress.detailsOOOa1): ScRefFlags {
    if (!rStr) return ScRefFlags.ZERO;
    let p = 0;
    let nRes = ScRefFlags.ZERO;
    const ignored = { v: ScRefFlags.ZERO };
    switch (rDetails.eConv) {
      default:
      case FormulaGrammar.CONV_OOO: // No full col refs in OOO yet, assume XL notation
      case FormulaGrammar.CONV_XL_A1:
      case FormulaGrammar.CONV_XL_OOX:
        if ((p = lcl_a1_get_col(rDoc, rStr, p, this.aStart, ignored)) !== -1) {
          if (at(rStr, p) === ':') {
            if ((p = lcl_a1_get_col(rDoc, rStr, p + 1, this.aEnd, ignored)) !== -1) nRes = ScRefFlags.COL_VALID;
          } else {
            this.aEnd = this.aStart.clone();
            nRes = ScRefFlags.COL_VALID;
          }
        }
        break;
      case FormulaGrammar.CONV_XL_R1C1:
        if ((at(rStr, p) === 'C' || at(rStr, p) === 'c') && (p = lcl_r1c1_get_col(rDoc.GetSheetLimits(), rStr, p, rDetails, this.aStart, ignored)) !== -1) {
          if (at(rStr, p) === ':') {
            if ((at(rStr, p + 1) === 'C' || at(rStr, p + 1) === 'c') && (p = lcl_r1c1_get_col(rDoc.GetSheetLimits(), rStr, p + 1, rDetails, this.aEnd, ignored)) !== -1) nRes = ScRefFlags.COL_VALID;
          } else {
            this.aEnd = this.aStart.clone();
            nRes = ScRefFlags.COL_VALID;
          }
        }
        break;
    }
    return p !== -1 && at(rStr, p) === '\0' ? nRes : ScRefFlags.ZERO;
  }

  // Parse only full row references
  ParseRows(rDoc: ScAddressDocument, rStr: string, rDetails: ScAddressDetails = ScAddress.detailsOOOa1): void {
    if (!rStr) return;
    let p = 0;
    const ignored = { v: ScRefFlags.ZERO };
    switch (rDetails.eConv) {
      default:
      case FormulaGrammar.CONV_OOO: // No full row refs in OOO yet, assume XL notation
      case FormulaGrammar.CONV_XL_A1:
      case FormulaGrammar.CONV_XL_OOX:
        if ((p = lcl_a1_get_row(rDoc, rStr, p, this.aStart, ignored)) !== -1) {
          if (at(rStr, p) === ':') lcl_a1_get_row(rDoc, rStr, p + 1, this.aEnd, ignored);
          else this.aEnd = this.aStart.clone();
        }
        break;
      case FormulaGrammar.CONV_XL_R1C1:
        if ((at(rStr, p) === 'R' || at(rStr, p) === 'r') && (p = lcl_r1c1_get_row(rDoc.GetSheetLimits(), rStr, p, rDetails, this.aStart, ignored)) !== -1) {
          if (at(rStr, p) === ':') {
            if (at(rStr, p + 1) === 'R' || at(rStr, p + 1) === 'r') lcl_r1c1_get_row(rDoc.GetSheetLimits(), rStr, p + 1, rDetails, this.aEnd, ignored);
          } else this.aEnd = this.aStart.clone();
        }
        break;
    }
  }

  /** Parse an Excel style reference up to and including the sheet name
      separator '!', including detection of sheet names. aStart.nTab and
      aEnd.nTab are set, or -1 if sheet name not found.
      @param bOnlyAcceptSingle  If <TRUE/>, a 3D reference (Sheet1:Sheet2)
          encountered results in an error (-1 returned).
      @returns
          The position after '!' if successfully parsed, with rStartTabName
          and/or rEndTabName filled if applicable. ScRefFlags::... flags set in
          nFlags. Or if no valid sheet header could be parsed the start
          position passed with p. Or -1 if a 3D sheet header could be parsed
          but bOnlyAcceptSingle==true was given.
   */
  Parse_XL_Header(s: string, p: number, rDoc: ScAddressDocument, rNames: { start: string; end: string }, nFlags: { v: ScRefFlags }, bOnlyAcceptSingle: boolean, pErrRef?: string): number {
    const start = p;
    const nSaveFlags = nFlags.v;
    rNames.start = '';
    rNames.end = '';
    let pMsoxlQuoteStop = -1;
    let pQuoted3DStop = -1;
    if (at(s, p) === '[') return start; // external document, not supported
    else if (at(s, p) === '\'') {
      // Sickness in Excel's ODF msoxl namespace:
      // 'Sheet1'!B3 would also be a valid!
      // Then again, 'Sheet1':'Sheet2'!C4 would be logical and Calc wrote
      // that to OOXML but Excel instead does 'Sheet1:Sheet2'!C4 which is
      // the worse you can get.
      const q = parseQuotedName(s, p);
      p = q.p;
      if (at(s, p) === ':') {
        // The incorrect 'Sheet1':'Sheet2' case. Just fall through.
      } else if (at(s, p) !== '!') {
        return start;
      }
      if (q.name) {
        if (q.name.indexOf('[') !== -1) return start; // external document, not supported
        // Look for 'Sheet1:Sheet2'!
        if (at(s, p) === '!') {
          let pQ = start + 1;
          do {
            if (at(s, pQ) === ':') {
              pMsoxlQuoteStop = pQ;
              pQuoted3DStop = p - 1;
              break;
            }
          } while (++pQ < p);
        }
      }
      p = pQuoted3DStop !== -1 ? start + 1 : start;
    }

    const startTabs = p;
    const r1 = lcl_XL_ParseSheetRef(s, p, !bOnlyAcceptSingle, pMsoxlQuoteStop, pErrRef);
    p = r1.p;
    if (p === -1) return start; // invalid tab
    if (bOnlyAcceptSingle && at(s, p) === ':') return -1; // 3D
    let startEndTabs = -1;
    if (p !== startTabs) {
      rNames.start = r1.name;
      nFlags.v |= ScRefFlags.TAB_VALID | ScRefFlags.TAB_3D | ScRefFlags.TAB_ABS;
      if (at(s, p) === ':') { // 3d ref
        startEndTabs = p + 1;
        const r2 = lcl_XL_ParseSheetRef(s, startEndTabs, false, pQuoted3DStop !== -1 ? pQuoted3DStop : pMsoxlQuoteStop, pErrRef);
        p = r2.p;
        if (p === -1) {
          nFlags.v = nSaveFlags;
          return start; // invalid tab
        }
        rNames.end = r2.name;
        nFlags.v |= ScRefFlags.TAB2_VALID | ScRefFlags.TAB2_3D | ScRefFlags.TAB2_ABS;
      } else {
        // If only one sheet is given, the full reference is still valid,
        // only the second 3D flag is not set.
        nFlags.v |= ScRefFlags.TAB2_VALID | ScRefFlags.TAB2_ABS;
        this.aEnd.SetTab(this.aStart.Tab());
      }

      if (at(s, p++) !== '!') {
        nFlags.v = nSaveFlags;
        return start; // syntax error
      } else p = lcl_eatWhiteSpace(s, p);
    } else {
      nFlags.v |= ScRefFlags.TAB_VALID | ScRefFlags.TAB2_VALID;
      // Use the current tab, it needs to be passed in. : aEnd.SetTab( .. );
    }

    // Internal reference.
    if (!rNames.start) {
      nFlags.v = nSaveFlags;
      return start;
    }

    let nTab = -1;
    if ((pErrRef !== undefined && at(s, startTabs) !== '\'' && rNames.start === pErrRef) || (nTab = rDoc.GetTable(rNames.start)) < 0) {
      // invalid table name.
      nFlags.v &= ~ScRefFlags.TAB_VALID;
      nTab = -1;
    }

    this.aStart.SetTab(nTab);
    this.aEnd.SetTab(nTab);

    if (rNames.end) {
      if ((pErrRef !== undefined && startEndTabs !== -1 && at(s, startEndTabs) !== '\'' && rNames.end === pErrRef) || (nTab = rDoc.GetTable(rNames.end)) < 0) {
        // invalid table name.
        nFlags.v &= ~ScRefFlags.TAB2_VALID;
        nTab = -1;
      }
      this.aEnd.SetTab(nTab);
    }
    return p;
  }

  /** Returns string with formatted cell range from aStart to aEnd,
      according to provided address convention.
      @param bFullAddressNotation
          If TRUE, the full address notation will be used.
          For example in case all columns are used, "A1:AMJ177" is full address notation
          and "1:177" is shortened address notation.
   */
  Format(rDoc: ScAddressDocument, nFlags: ScRefFlags = ScRefFlags.ZERO, rDetails: ScAddressDetails = ScAddress.detailsOOOa1, bFullAddressNotation = false): string {
    if (!(nFlags & ScRefFlags.VALID)) return STR_NO_REF_TABLE;

    let r = '';
    switch (rDetails.eConv) {
      default:
      case FormulaGrammar.CONV_OOO: {
        const bOneTab = this.aStart.Tab() === this.aEnd.Tab();
        if (!bOneTab) nFlags |= ScRefFlags.TAB_3D;
        r = this.aStart.Format(nFlags, rDoc, rDetails);
        if (!this.aStart.equals(this.aEnd) || lcl_ColAbsFlagDiffer(nFlags) || lcl_RowAbsFlagDiffer(nFlags)) {
          let pDoc: ScAddressDocument | null = rDoc;
          // move flags of end reference to start reference, mask with BITS to exclude FORCE_DOC flag
          nFlags = ScRefFlags.VALID | ((nFlags >> 4) & ScRefFlags.BITS);
          if (bOneTab) pDoc = null;
          else nFlags |= ScRefFlags.TAB_3D;
          r += `:${this.aEnd.Format(nFlags, pDoc, rDetails)}`;
        }
        break;
      }

      case FormulaGrammar.CONV_XL_A1:
      case FormulaGrammar.CONV_XL_OOX: {
        const nMaxCol = rDoc.MaxCol();
        const nMaxRow = rDoc.MaxRow();
        r += lcl_ScRange_Format_XL_Header(this, nFlags, rDoc, rDetails);
        if (this.aStart.Col() === 0 && this.aEnd.Col() >= nMaxCol && !bFullAddressNotation) {
          // Full col refs always require 2 rows (2:2)
          r += lcl_a1_append_r(this.aStart.Row(), (nFlags & ScRefFlags.ROW_ABS) !== 0);
          r += ':';
          r += lcl_a1_append_r(this.aEnd.Row(), (nFlags & ScRefFlags.ROW2_ABS) !== 0);
        } else if (this.aStart.Row() === 0 && this.aEnd.Row() >= nMaxRow && !bFullAddressNotation) {
          // Full row refs always require 2 cols (A:A)
          r += lcl_a1_append_c(this.aStart.Col(), (nFlags & ScRefFlags.COL_ABS) !== 0);
          r += ':';
          r += lcl_a1_append_c(this.aEnd.Col(), (nFlags & ScRefFlags.COL2_ABS) !== 0);
        } else {
          r += lcl_a1_append_c(this.aStart.Col(), (nFlags & ScRefFlags.COL_ABS) !== 0);
          r += lcl_a1_append_r(this.aStart.Row(), (nFlags & ScRefFlags.ROW_ABS) !== 0);
          if (this.aStart.Col() !== this.aEnd.Col() || lcl_ColAbsFlagDiffer(nFlags) || this.aStart.Row() !== this.aEnd.Row() || lcl_RowAbsFlagDiffer(nFlags)) {
            r += ':';
            r += lcl_a1_append_c(this.aEnd.Col(), (nFlags & ScRefFlags.COL2_ABS) !== 0);
            r += lcl_a1_append_r(this.aEnd.Row(), (nFlags & ScRefFlags.ROW2_ABS) !== 0);
          }
        }
        break;
      }

      case FormulaGrammar.CONV_XL_R1C1: {
        const nMaxCol = rDoc.MaxCol();
        const nMaxRow = rDoc.MaxRow();
        r += lcl_ScRange_Format_XL_Header(this, nFlags, rDoc, rDetails);
        if (this.aStart.Col() === 0 && this.aEnd.Col() >= nMaxCol && !bFullAddressNotation) {
          r += lcl_r1c1_append_r(this.aStart.Row(), (nFlags & ScRefFlags.ROW_ABS) !== 0, rDetails);
          if (this.aStart.Row() !== this.aEnd.Row() || lcl_RowAbsFlagDiffer(nFlags)) {
            r += ':';
            r += lcl_r1c1_append_r(this.aEnd.Row(), (nFlags & ScRefFlags.ROW2_ABS) !== 0, rDetails);
          }
        } else if (this.aStart.Row() === 0 && this.aEnd.Row() >= nMaxRow && !bFullAddressNotation) {
          r += lcl_r1c1_append_c(this.aStart.Col(), (nFlags & ScRefFlags.COL_ABS) !== 0, rDetails);
          if (this.aStart.Col() !== this.aEnd.Col() || lcl_ColAbsFlagDiffer(nFlags)) {
            r += ':';
            r += lcl_r1c1_append_c(this.aEnd.Col(), (nFlags & ScRefFlags.COL2_ABS) !== 0, rDetails);
          }
        } else {
          r += lcl_r1c1_append_r(this.aStart.Row(), (nFlags & ScRefFlags.ROW_ABS) !== 0, rDetails);
          r += lcl_r1c1_append_c(this.aStart.Col(), (nFlags & ScRefFlags.COL_ABS) !== 0, rDetails);
          if (this.aStart.Col() !== this.aEnd.Col() || lcl_ColAbsFlagDiffer(nFlags) || this.aStart.Row() !== this.aEnd.Row() || lcl_RowAbsFlagDiffer(nFlags)) {
            r += ':';
            r += lcl_r1c1_append_r(this.aEnd.Row(), (nFlags & ScRefFlags.ROW2_ABS) !== 0, rDetails);
            r += lcl_r1c1_append_c(this.aEnd.Col(), (nFlags & ScRefFlags.COL2_ABS) !== 0, rDetails);
          }
        }
        break;
      }
    }
    return r;
  }

  PutInOrder(): void { this.aStart.PutInOrder(this.aEnd); }

  /**
      @param  rErrorRange
              If FALSE is returned, the positions contain <0 or >MAX...
              values if shifted out of bounds.
   */
  Move(dx: SCCOL, dy: SCROW, dz: SCTAB, rErrorRange: ScRange, rDoc: ScAddressDocument): boolean {
    const nMaxCol = rDoc.MaxCol();
    const nMaxRow = rDoc.MaxRow();
    if (dy && this.aStart.Row() === 0 && this.aEnd.Row() === nMaxRow) dy = 0; // Entire column not to be moved.
    if (dx && this.aStart.Col() === 0 && this.aEnd.Col() === nMaxCol) dx = 0; // Entire row not to be moved.
    let b = this.aStart.Move(dx, dy, dz, rErrorRange.aStart, rDoc);
    b = this.aEnd.Move(dx, dy, dz, rErrorRange.aEnd, rDoc) && b;
    return b;
  }

  /** Same as Move() but with sticky end col/row anchors. */
  MoveSticky(rDoc: ScAddressDocument, dx: SCCOL, dy: SCROW, dz: SCTAB, rErrorRange: ScRange): boolean {
    const nMaxCol = rDoc.MaxCol();
    const nMaxRow = rDoc.MaxRow();
    let bColRange = this.aStart.Col() < this.aEnd.Col();
    let bRowRange = this.aStart.Row() < this.aEnd.Row();
    if (dy && this.aStart.Row() === 0 && this.aEnd.Row() === nMaxRow) dy = 0; // Entire column not to be moved.
    if (dx && this.aStart.Col() === 0 && this.aEnd.Col() === nMaxCol) dx = 0; // Entire row not to be moved.
    const b1 = this.aStart.Move(dx, dy, dz, rErrorRange.aStart, rDoc);
    if (dx && bColRange && this.aEnd.Col() === nMaxCol) dx = 0; // End column sticky.
    if (dy && bRowRange && this.aEnd.Row() === nMaxRow) dy = 0; // End row sticky.
    const nOldTab = this.aEnd.Tab();
    let b2 = this.aEnd.Move(dx, dy, dz, rErrorRange.aEnd, rDoc);
    if (!b2) {
      // End column or row of a range may have become sticky.
      bColRange = !dx || (bColRange && this.aEnd.Col() === nMaxCol);
      if (dx && bColRange) rErrorRange.aEnd.SetCol(nMaxCol);
      bRowRange = !dy || (bRowRange && this.aEnd.Row() === nMaxRow);
      if (dy && bRowRange) rErrorRange.aEnd.SetRow(nMaxRow);
      b2 = bColRange && bRowRange && this.aEnd.Tab() - nOldTab === dz;
    }
    return b1 && b2;
  }

  IncColIfNotLessThan(rDoc: ScAddressDocument, nStartCol: SCCOL, nOffset: SCCOL): void {
    let offset: SCCOL;
    if (this.aStart.Col() > nStartCol) {
      offset = nOffset;
      if (nStartCol + nOffset > this.aStart.Col()) offset = this.aStart.Col() - nStartCol;
      else if (nStartCol - nOffset > this.aStart.Col()) offset = -1 * (this.aStart.Col() - nStartCol);
      this.aStart.IncCol(offset);
      if (this.aStart.Col() < 0) this.aStart.SetCol(0);
      else if (this.aStart.Col() > rDoc.MaxCol()) this.aStart.SetCol(rDoc.MaxCol());
    }
    if (this.aEnd.Col() > nStartCol) {
      offset = nOffset;
      if (nStartCol + nOffset > this.aEnd.Col()) offset = this.aEnd.Col() - nStartCol;
      else if (nStartCol - nOffset > this.aEnd.Col()) offset = -1 * (this.aEnd.Col() - nStartCol);
      this.aEnd.IncCol(offset);
      if (this.aEnd.Col() < 0) this.aEnd.SetCol(0);
      else if (this.aEnd.Col() > rDoc.MaxCol()) this.aEnd.SetCol(rDoc.MaxCol());
    }
  }

  IncRowIfNotLessThan(rDoc: ScAddressDocument, nStartRow: SCROW, nOffset: SCROW): void {
    let offset: SCROW;
    if (this.aStart.Row() > nStartRow) {
      offset = nOffset;
      if (nStartRow + nOffset > this.aStart.Row()) offset = this.aStart.Row() - nStartRow;
      else if (nStartRow - nOffset > this.aStart.Row()) offset = -1 * (this.aStart.Row() - nStartRow);
      this.aStart.IncRow(offset);
      if (this.aStart.Row() < 0) this.aStart.SetRow(0);
      else if (this.aStart.Row() > rDoc.MaxRow()) this.aStart.SetRow(rDoc.MaxRow());
    }
    if (this.aEnd.Row() > nStartRow) {
      offset = nOffset;
      if (nStartRow + nOffset > this.aEnd.Row()) offset = this.aEnd.Row() - nStartRow;
      else if (nStartRow - nOffset > this.aEnd.Row()) offset = -1 * (this.aEnd.Row() - nStartRow);
      this.aEnd.IncRow(offset);
      if (this.aEnd.Row() < 0) this.aEnd.SetRow(0);
      else if (this.aEnd.Row() > rDoc.MaxRow()) this.aEnd.SetRow(rDoc.MaxRow());
    }
  }

  ExtendTo(rRange: ScRange): void {
    if (this.IsValid()) {
      this.aStart.SetCol(Math.min(this.aStart.Col(), rRange.aStart.Col()));
      this.aStart.SetRow(Math.min(this.aStart.Row(), rRange.aStart.Row()));
      this.aStart.SetTab(Math.min(this.aStart.Tab(), rRange.aStart.Tab()));
      this.aEnd.SetCol(Math.max(this.aEnd.Col(), rRange.aEnd.Col()));
      this.aEnd.SetRow(Math.max(this.aEnd.Row(), rRange.aEnd.Row()));
      this.aEnd.SetTab(Math.max(this.aEnd.Tab(), rRange.aEnd.Tab()));
    } else this.assign(rRange);
  }

  Intersection(rOther: ScRange): ScRange {
    const nCol1 = Math.max(this.aStart.Col(), rOther.aStart.Col());
    const nCol2 = Math.min(this.aEnd.Col(), rOther.aEnd.Col());
    const nRow1 = Math.max(this.aStart.Row(), rOther.aStart.Row());
    const nRow2 = Math.min(this.aEnd.Row(), rOther.aEnd.Row());
    const nTab1 = Math.max(this.aStart.Tab(), rOther.aStart.Tab());
    const nTab2 = Math.min(this.aEnd.Tab(), rOther.aEnd.Tab());
    if (nCol1 > nCol2 || nRow1 > nRow2 || nTab1 > nTab2) return ScRange.Invalid();
    return new ScRange(nCol1, nRow1, nTab1, nCol2, nRow2, nTab2);
  }

  IsEndColSticky(rDoc: ScAddressDocument): boolean {
    // Only in an actual column range, i.e. not if both columns are MAXCOL.
    return this.aEnd.Col() === rDoc.MaxCol() && this.aStart.Col() < this.aEnd.Col();
  }

  IsEndRowSticky(rDoc: ScAddressDocument): boolean {
    // Only in an actual row range, i.e. not if both rows are MAXROW.
    return this.aEnd.Row() === rDoc.MaxRow() && this.aStart.Row() < this.aEnd.Row();
  }

  /** Increment or decrement end column unless sticky or until it becomes
      sticky. Checks if the range encompasses at least two columns so should
      be called before adjusting the start column. */
  IncEndColSticky(rDoc: ScAddressDocument, nDelta: SCCOL): void {
    const nCol = this.aEnd.Col();
    if (this.aStart.Col() >= nCol) {
      // Less than two columns => not sticky.
      this.aEnd.IncCol(nDelta);
      return;
    }
    const nMaxCol = rDoc.MaxCol();
    if (nCol === nMaxCol) return; // already sticky
    if (nCol < nMaxCol) this.aEnd.SetCol(Math.min(nCol + nDelta, nMaxCol));
    else this.aEnd.IncCol(nDelta); // was greater than nMaxCol, caller should know...
  }

  /** Increment or decrement end row unless sticky or until it becomes
      sticky. Checks if the range encompasses at least two rows so should
      be called before adjusting the start row. */
  IncEndRowSticky(rDoc: ScAddressDocument, nDelta: SCROW): void {
    const nRow = this.aEnd.Row();
    if (this.aStart.Row() >= nRow) {
      // Less than two rows => not sticky.
      this.aEnd.IncRow(nDelta);
      return;
    }
    if (nRow === rDoc.MaxRow()) return; // already sticky
    if (nRow < rDoc.MaxRow()) this.aEnd.SetRow(Math.min(nRow + nDelta, rDoc.MaxRow()));
    else this.aEnd.IncRow(nDelta); // was greater than rDoc.MaxRow(), caller should know...
  }

  equals(rRange: ScRange): boolean { return this.aStart.equals(rRange.aStart) && this.aEnd.equals(rRange.aEnd); }
  lessThan(r: ScRange): boolean { return this.aStart.lessThan(r.aStart) || (this.aStart.equals(r.aStart) && this.aEnd.lessThan(r.aEnd)); }

  toString(): string {
    let s = this.aStart.toString();
    if (!this.aEnd.equals(this.aStart)) {
      s += ':';
      if (this.aEnd.Tab() !== this.aStart.Tab()) s += this.aEnd.toString();
      else s += `R${this.aEnd.Row() + 1}C${this.aEnd.Col() + 1}`;
    }
    return s;
  }
}

export const ValidRange = (rRange: ScRange, nMaxCol: SCCOL, nMaxRow: SCROW): boolean =>
  ValidAddress(rRange.aStart, nMaxCol, nMaxRow) && ValidAddress(rRange.aEnd, nMaxCol, nMaxRow);

export class ScRangePair {
  private aRange: [ScRange, ScRange];
  constructor(rRange1: ScRange, rRange2: ScRange) { this.aRange = [rRange1.clone(), rRange2.clone()]; }
  GetRange(n: 0 | 1): ScRange { return this.aRange[n]; }
}

export class ScRefAddress {
  private aAdr: ScAddress;
  private bRelCol = false;
  private bRelRow = false;
  private bRelTab = false;

  constructor(nCol?: SCCOL, nRow?: SCROW, nTab?: SCTAB) {
    this.aAdr = new ScAddress(nCol ?? 0, nRow ?? 0, nTab ?? 0);
  }

  IsRelCol(): boolean { return this.bRelCol; }
  IsRelRow(): boolean { return this.bRelRow; }
  IsRelTab(): boolean { return this.bRelTab; }
  SetRelCol(bNewRelCol: boolean): void { this.bRelCol = bNewRelCol; }
  SetRelRow(bNewRelRow: boolean): void { this.bRelRow = bNewRelRow; }
  SetRelTab(bNewRelTab: boolean): void { this.bRelTab = bNewRelTab; }

  Set(rAdr: ScAddress | SCCOL, a: boolean | SCROW, b: boolean | SCTAB, c: boolean, d?: boolean, e?: boolean): void {
    if (rAdr instanceof ScAddress) {
      this.aAdr = rAdr.clone();
      this.bRelCol = a as boolean;
      this.bRelRow = b as boolean;
      this.bRelTab = c;
      return;
    }
    this.aAdr.Set(rAdr, a as SCROW, b as SCTAB);
    this.bRelCol = c;
    this.bRelRow = d!;
    this.bRelTab = e!;
  }

  GetAddress(): ScAddress { return this.aAdr; }
  Col(): SCCOL { return this.aAdr.Col(); }
  Row(): SCROW { return this.aAdr.Row(); }
  Tab(): SCTAB { return this.aAdr.Tab(); }

  equals(r: ScRefAddress): boolean {
    return this.aAdr.equals(r.aAdr) && this.bRelCol === r.bRelCol && this.bRelRow === r.bRelRow && this.bRelTab === r.bRelTab;
  }

  GetRefString(rDoc: ScAddressDocument, nActTab: SCTAB, rDetails: ScAddressDetails = ScAddress.detailsOOOa1): string {
    if (this.Tab() + 1 > rDoc.GetTableCount()) return STR_NO_REF_TABLE;
    let nFlags = ScRefFlags.VALID;
    if (nActTab !== this.Tab()) {
      nFlags |= ScRefFlags.TAB_3D;
      if (!this.bRelTab) nFlags |= ScRefFlags.TAB_ABS;
    }
    if (!this.bRelCol) nFlags |= ScRefFlags.COL_ABS;
    if (!this.bRelRow) nFlags |= ScRefFlags.ROW_ABS;
    return this.aAdr.Format(nFlags, rDoc, rDetails);
  }
}

export const BCA_BRDCST_ALWAYS = (): ScAddress => new ScAddress(0, SCROW_MAX, 0);
export const BCA_LISTEN_ALWAYS = (): ScRange => new ScRange(BCA_BRDCST_ALWAYS(), BCA_BRDCST_ALWAYS());

/** STR_NO_REF_TABLE, ScCompiler::GetNativeSymbol(ocErrRef) */
const STR_NO_REF_TABLE = '#REF!';

// --- address.cxx -------------------------------------------------------------------------------

/** The character at an index, '\0' past the end (the terminating NUL of a sal_Unicode string). */
const at = (s: string, i: number): string => (i >= 0 && i < s.length ? s[i]! : '\0');
const isAsciiAlpha = (c: string) => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');
const isAsciiDigit = (c: string) => c >= '0' && c <= '9';

/**
 * Parse from the opening single quote to the closing single quote.  Inside
 * the quotes, a single quote character is encoded by double single-quote
 * characters. Returns the position immediately after the closing single
 * quote and the name, or the start position and an empty name.
 */
function parseQuotedName(s: string, p: number): { p: number; name: string } {
  if (at(s, p) !== '\'') return { p, name: '' };
  const pStart = p;
  let cPrev = '\0';
  let aBuf = '';
  for (++p; at(s, p) !== '\0'; ++p) {
    const c = s[p]!;
    if (c === '\'') {
      if (cPrev === '\'') {
        // double single-quote equals one single quote.
        aBuf += c;
        cPrev = '\0';
        continue;
      }
    } else if (cPrev === '\'') {
      // We are past the closing quote.  We're done!
      return { p, name: aBuf };
    } else aBuf += c;
    cPrev = c;
  }
  return { p: pStart, name: '' };
}

/** sal_Unicode_strtol: the number and the end position, or end -1 on overflow. */
function sal_Unicode_strtol(s: string, p: number): { n: number; end: number } {
  let accum = 0;
  let is_neg = false;
  if (at(s, p) === '-') { is_neg = true; p++; }
  else if (at(s, p) === '+') p++;
  while (isAsciiDigit(at(s, p))) {
    accum = accum * 10 + (s.charCodeAt(p) - 48);
    if (accum > Number.MAX_SAFE_INTEGER) return { n: 0, end: -1 };
    p++;
  }
  return { n: is_neg ? -accum : accum, end: p };
}

function lcl_eatWhiteSpace(s: string, p: number): number {
  if (p >= 0) while (at(s, p) === ' ') ++p;
  return p;
}

// Compare ignore case ASCII.
function lcl_isString(s: string, p1: number, rStr: string): boolean {
  const n = rStr.length;
  if (!n) return false;
  for (let i = 0; i < n; ++i) {
    const a = at(s, p1 + i);
    if (a === '\0') return false;
    if (a !== rStr[i]) {
      let c1 = a.charCodeAt(0);
      if (c1 >= 65 && c1 <= 90) c1 += 0x20;
      if (c1 < 97 || c1 > 122) return false; // not a letter
      let c2 = rStr.charCodeAt(i);
      if (c2 >= 65 && c2 <= 90) c2 += 0x20;
      if (c2 < 97 || c2 > 122) return false; // not a letter to match
      if (c1 !== c2) return false; // lower case doesn't match either
    }
  }
  return true;
}

function lcl_XL_ParseSheetRef(s: string, start: number, bAllow3D: boolean, pMsoxlQuoteStop: number, pErrRef?: string): { p: number; name: string } {
  let aTabName = '';
  let p = start;

  // XL only seems to use single quotes for sheet names.
  if (pMsoxlQuoteStop !== -1) {
    let pCurrentStart = p;
    while (p < pMsoxlQuoteStop) {
      if (at(s, p) === '\'') {
        // We pre-analyzed the quoting, no checks needed here.
        if (at(s, ++p) === '\'') {
          aTabName += s.slice(pCurrentStart, p);
          pCurrentStart = ++p;
        }
      } else if (at(s, p) === ':') {
        break; // while
      } else ++p;
    }
    if (pCurrentStart < p) aTabName += s.slice(pCurrentStart, p);
    if (!aTabName) return { p: -1, name: '' };
    if (p === pMsoxlQuoteStop && at(s, pMsoxlQuoteStop) === '\'') ++p; // position on ! of ...'!...
    if (at(s, p) !== '!' && (!bAllow3D || at(s, p) !== ':')) return { p: !bAllow3D && at(s, p) === ':' ? p : start, name: '' };
  } else if (at(s, p) === '\'') {
    const q = parseQuotedName(s, p);
    p = q.p;
    aTabName = q.name;
    if (!aTabName) return { p: -1, name: '' };
  } else if (pErrRef !== undefined && lcl_isString(s, p, pErrRef) && at(s, p + pErrRef.length) === '!') {
    p += pErrRef.length; // position after "#REF!" on '!'
    // XXX NOTE: caller has to check the name and that it wasn't quoted.
    aTabName = pErrRef;
  } else {
    let only_digits = true;

    /*
     * Valid: Normal!a1
     * Valid: x.y!a1
     * Invalid: .y!a1
     *
     * Some names starting with digits are actually valid, but
     * unparse quoted. Things are quite tricky: most sheet names
     * starting with a digit are ok, but not those starting with
     * "[0-9]*\." or "[0-9]+[eE]".
     *
     * Valid: 42!a1
     * Valid: 4x!a1
     * Invalid: 1.!a1
     * Invalid: 1e!a1
     */
    for (;;) {
      const uc = at(s, p);
      if (isAsciiAlpha(uc) || uc === '_') {
        if (only_digits && p !== start && (uc === 'e' || uc === 'E')) {
          p = start;
          break;
        }
        only_digits = false;
        p++;
      } else if (isAsciiDigit(uc)) {
        p++;
      } else if (uc === '.') {
        if (only_digits) { // Valid, except after only digits.
          p = start;
          break;
        }
        p++;
      } else if (uc.charCodeAt(0) > 127) {
        // non ASCII character is allowed.
        ++p;
        only_digits = false;
      } else break;
    }

    if (at(s, p) !== '!' && (!bAllow3D || at(s, p) !== ':')) return { p: !bAllow3D && at(s, p) === ':' ? p : start, name: '' };

    aTabName += s.slice(start, p);
  }

  return { p, name: aTabName };
}

function lcl_r1c1_get_col(rSheetLimits: ScSheetLimits, s: string, p: number, rDetails: ScAddressDetails, pAddr: ScAddress, nFlags: { v: ScRefFlags }): number {
  if (at(s, p) === '\0') return -1;
  p++;
  const isRelative = at(s, p) === '[';
  if (isRelative) p++;
  let { n, end: pEnd } = sal_Unicode_strtol(s, p);
  if (pEnd === -1) return -1;

  if (p === pEnd) { // C is a relative ref with offset 0
    if (isRelative) return -1;
    n = rDetails.nCol;
    if (n < 0 || n >= rSheetLimits.GetMaxColCount()) return -1;
  } else if (isRelative) {
    if (at(s, pEnd) !== ']') return -1;
    n += rDetails.nCol;
    if (n < 0 || n >= rSheetLimits.GetMaxColCount()) return -1;
    pEnd++;
  } else {
    nFlags.v |= ScRefFlags.COL_ABS;
    if (n <= 0 || n > rSheetLimits.GetMaxColCount()) return -1;
    n--;
  }

  pAddr.SetCol(n);
  nFlags.v |= ScRefFlags.COL_VALID;
  return pEnd;
}

function lcl_r1c1_get_row(rSheetLimits: ScSheetLimits, s: string, p: number, rDetails: ScAddressDetails, pAddr: ScAddress, nFlags: { v: ScRefFlags }): number {
  if (at(s, p) === '\0') return -1;
  p++;
  const isRelative = at(s, p) === '[';
  if (isRelative) p++;
  let { n, end: pEnd } = sal_Unicode_strtol(s, p);
  if (pEnd === -1) return -1;

  if (p === pEnd) { // R is a relative ref with offset 0
    if (isRelative) return -1;
    n = rDetails.nRow;
    if (n < 0 || n >= rSheetLimits.GetMaxRowCount()) return -1;
  } else if (isRelative) {
    if (at(s, pEnd) !== ']') return -1;
    n += rDetails.nRow;
    pEnd++;
    if (n < 0 || n >= rSheetLimits.GetMaxRowCount()) return -1;
  } else {
    nFlags.v |= ScRefFlags.ROW_ABS;
    if (n <= 0) return -1;
    n--;
    if (n >= rSheetLimits.GetMaxRowCount()) return -1;
  }

  pAddr.SetRow(n);
  nFlags.v |= ScRefFlags.ROW_VALID;
  return pEnd;
}

const INVALIDATE_ALL = ScRefFlags.VALID | ScRefFlags.COL_VALID | ScRefFlags.ROW_VALID | ScRefFlags.TAB_VALID
  | ScRefFlags.COL2_VALID | ScRefFlags.ROW2_VALID | ScRefFlags.TAB2_VALID;
const INVALIDATE_SINGLE = ScRefFlags.VALID | ScRefFlags.COL_VALID | ScRefFlags.ROW_VALID | ScRefFlags.TAB_VALID;

function lcl_ScRange_Parse_XL_R1C1(r: ScRange, s: string, rDoc: ScAddressDocument, rDetails: ScAddressDetails, bOnlyAcceptSingle: boolean, pSheetEndPos: { value: number } | undefined): ScRefFlags {
  const pStart = 0;
  let p = 0;
  if (pSheetEndPos) pSheetEndPos.value = 0;
  let pTmp = -1;
  const nFlags = { v: ScRefFlags.VALID | ScRefFlags.TAB_VALID };
  // Keep in mind that nFlags2 gets left-shifted by 4 bits before being merged.
  const nFlags2 = { v: ScRefFlags.TAB_VALID };
  const names = { start: '', end: '' };

  p = r.Parse_XL_Header(s, p, rDoc, names, nFlags, bOnlyAcceptSingle);

  let nBailOutFlags = ScRefFlags.ZERO;
  if (pSheetEndPos && pStart < p && nFlags.v & ScRefFlags.TAB_VALID && nFlags.v & ScRefFlags.TAB_3D) {
    pSheetEndPos.value = p - pStart;
    nBailOutFlags = ScRefFlags.TAB_VALID | ScRefFlags.TAB_3D;
  }

  if (p === -1) return ScRefFlags.ZERO;

  const lim = rDoc.GetSheetLimits();
  if (at(s, p) === 'R' || at(s, p) === 'r') {
    if ((p = lcl_r1c1_get_row(lim, s, p, rDetails, r.aStart, nFlags)) === -1) return nBailOutFlags;

    if (at(s, p) !== 'C' && at(s, p) !== 'c') { // full row R#
      if (at(s, p) !== ':' || (at(s, p + 1) !== 'R' && at(s, p + 1) !== 'r') || (pTmp = lcl_r1c1_get_row(lim, s, p + 1, rDetails, r.aEnd, nFlags2)) === -1) {
        // Only the initial row number is given, or the second row
        // number is invalid. Fallback to just the initial R
        nFlags.v = applyStartToEndFlags(nFlags.v);
        r.aEnd.SetRow(r.aStart.Row());
      } else { // pTmp != nullptr
        // Full row range successfully parsed.
        nFlags.v = applyStartToEndFlags(nFlags.v, nFlags2.v);
        p = pTmp;
      }

      if (at(s, p) !== '\0') {
        // any trailing invalid character must invalidate the whole address.
        nFlags.v &= ~INVALIDATE_ALL;
        return nFlags.v;
      }

      nFlags.v |= ScRefFlags.COL_VALID | ScRefFlags.COL2_VALID | ScRefFlags.COL_ABS | ScRefFlags.COL2_ABS;
      r.aStart.SetCol(0);
      r.aEnd.SetCol(rDoc.MaxCol());

      return bOnlyAcceptSingle ? ScRefFlags.ZERO : nFlags.v;
    } else if ((p = lcl_r1c1_get_col(lim, s, p, rDetails, r.aStart, nFlags)) === -1) {
      return ScRefFlags.ZERO;
    }

    if (at(s, p) !== ':' || (at(s, p + 1) !== 'R' && at(s, p + 1) !== 'r')
      || (pTmp = lcl_r1c1_get_row(lim, s, p + 1, rDetails, r.aEnd, nFlags2)) === -1
      || (at(s, pTmp) !== 'C' && at(s, pTmp) !== 'c')
      || (pTmp = lcl_r1c1_get_col(lim, s, pTmp, rDetails, r.aEnd, nFlags2)) === -1) {
      // single cell reference
      if (at(s, p) !== '\0') {
        // any trailing invalid character must invalidate the whole address.
        nFlags.v &= ~INVALIDATE_SINGLE;
        return nFlags.v;
      }
      return bOnlyAcceptSingle ? nFlags.v : ScRefFlags.ZERO;
    }
    p = pTmp;

    // double reference
    if (at(s, p) !== '\0') {
      // any trailing invalid character must invalidate the whole range.
      nFlags.v &= ~INVALIDATE_ALL;
      return nFlags.v;
    }

    nFlags.v = applyStartToEndFlags(nFlags.v, nFlags2.v);
    return bOnlyAcceptSingle ? ScRefFlags.ZERO : nFlags.v;
  } else if (at(s, p) === 'C' || at(s, p) === 'c') { // full col C#
    if ((p = lcl_r1c1_get_col(lim, s, p, rDetails, r.aStart, nFlags)) === -1) return nBailOutFlags;

    if (at(s, p) !== ':' || (at(s, p + 1) !== 'C' && at(s, p + 1) !== 'c') || (pTmp = lcl_r1c1_get_col(lim, s, p + 1, rDetails, r.aEnd, nFlags2)) === -1) {
      // Fallback to just the initial C
      nFlags.v = applyStartToEndFlags(nFlags.v);
      r.aEnd.SetCol(r.aStart.Col());
    } else { // pTmp != nullptr
      nFlags.v = applyStartToEndFlags(nFlags.v, nFlags2.v);
      p = pTmp;
    }

    if (at(s, p) !== '\0') {
      // any trailing invalid character must invalidate the whole address.
      nFlags.v &= ~INVALIDATE_ALL;
      return nFlags.v;
    }

    nFlags.v |= ScRefFlags.ROW_VALID | ScRefFlags.ROW2_VALID | ScRefFlags.ROW_ABS | ScRefFlags.ROW2_ABS;
    r.aStart.SetRow(0);
    r.aEnd.SetRow(rDoc.MaxRow());

    return bOnlyAcceptSingle ? ScRefFlags.ZERO : nFlags.v;
  }

  return nBailOutFlags;
}

function lcl_a1_get_col(rDoc: ScAddressDocument, s: string, p: number, pAddr: ScAddress, nFlags: { v: ScRefFlags }, pErrRef?: string): number {
  if (at(s, p) === '$') {
    nFlags.v |= ScRefFlags.COL_ABS;
    p++;
  }

  if (pErrRef !== undefined && lcl_isString(s, p, pErrRef)) {
    p += pErrRef.length;
    nFlags.v &= ~ScRefFlags.COL_VALID;
    pAddr.SetCol(-1);
    return p;
  }

  if (!isAsciiAlpha(at(s, p))) return -1;

  let nCol = at(s, p++).toUpperCase().charCodeAt(0) - 65;
  const nMaxCol = rDoc.MaxCol();
  while (nCol <= nMaxCol && isAsciiAlpha(at(s, p))) nCol = (nCol + 1) * 26 + at(s, p++).toUpperCase().charCodeAt(0) - 65;
  if (nCol > nMaxCol || nCol < 0 || isAsciiAlpha(at(s, p))) return -1;

  nFlags.v |= ScRefFlags.COL_VALID;
  pAddr.SetCol(nCol);

  return p;
}

function lcl_a1_get_row(rDoc: ScAddressDocument, s: string, p: number, pAddr: ScAddress, nFlags: { v: ScRefFlags }, pErrRef?: string): number {
  if (at(s, p) === '$') {
    nFlags.v |= ScRefFlags.ROW_ABS;
    p++;
  }

  if (pErrRef !== undefined && lcl_isString(s, p, pErrRef)) {
    p += pErrRef.length;
    nFlags.v &= ~ScRefFlags.ROW_VALID;
    pAddr.SetRow(-1);
    return p;
  }

  let { n, end: pEnd } = sal_Unicode_strtol(s, p);
  if (pEnd === -1 || p === pEnd || n < 1) return -1;
  n -= 1;
  if (n > rDoc.MaxRow()) return -1;

  nFlags.v |= ScRefFlags.ROW_VALID;
  pAddr.SetRow(n);

  return pEnd;
}

/// B:B or 2:2, but not B:2 or 2:B or B2:B or B:B2 or ...
function isValidSingleton(nFlags: ScRefFlags, nFlags2: ScRefFlags): boolean {
  const bCols = !!(nFlags & ScRefFlags.COL_VALID) && (!!(nFlags & ScRefFlags.COL2_VALID) || !!(nFlags2 & ScRefFlags.COL_VALID));
  const bRows = !!(nFlags & ScRefFlags.ROW_VALID) && (!!(nFlags & ScRefFlags.ROW2_VALID) || !!(nFlags2 & ScRefFlags.ROW_VALID));
  return bCols !== bRows;
}

function lcl_ScRange_Parse_XL_A1(r: ScRange, s: string, rDoc: ScAddressDocument, bOnlyAcceptSingle: boolean, pSheetEndPos: { value: number } | undefined, pErrRef?: string): ScRefFlags {
  const pStart = 0;
  let p = 0;
  if (pSheetEndPos) pSheetEndPos.value = 0;
  let tmp1: number, tmp2: number;
  const names = { start: '', end: '' };
  const nFlags = { v: ScRefFlags.VALID | ScRefFlags.TAB_VALID };
  const nFlags2 = { v: ScRefFlags.TAB_VALID };

  p = r.Parse_XL_Header(s, p, rDoc, names, nFlags, bOnlyAcceptSingle, pErrRef);

  let nBailOutFlags = ScRefFlags.ZERO;
  if (pSheetEndPos && pStart < p && nFlags.v & ScRefFlags.TAB_VALID && nFlags.v & ScRefFlags.TAB_3D) {
    pSheetEndPos.value = p - pStart;
    nBailOutFlags = ScRefFlags.TAB_VALID | ScRefFlags.TAB_3D;
  }

  if (p === -1) return nBailOutFlags;

  tmp1 = lcl_a1_get_col(rDoc, s, p, r.aStart, nFlags, pErrRef);
  if (tmp1 === -1) { // Is it a row only reference 3:5
    if (bOnlyAcceptSingle) return nBailOutFlags; // by definition full row refs are ranges

    tmp1 = lcl_a1_get_row(rDoc, s, p, r.aStart, nFlags, pErrRef);

    tmp1 = lcl_eatWhiteSpace(s, tmp1);
    if (tmp1 === -1 || at(s, tmp1++) !== ':') return nBailOutFlags; // Even a singleton requires ':' (eg 2:2)

    tmp1 = lcl_eatWhiteSpace(s, tmp1);
    tmp2 = lcl_a1_get_row(rDoc, s, tmp1, r.aEnd, nFlags2, pErrRef);
    if (tmp2 === -1 || at(s, tmp2) !== '\0') return nBailOutFlags; // Must have fully parsed a singleton.

    r.aStart.SetCol(0); r.aEnd.SetCol(rDoc.MaxCol());
    nFlags.v |= ScRefFlags.COL_VALID | ScRefFlags.COL2_VALID | ScRefFlags.COL_ABS | ScRefFlags.COL2_ABS;
    nFlags.v = applyStartToEndFlags(nFlags.v, nFlags2.v);
    return nFlags.v;
  }

  tmp2 = lcl_a1_get_row(rDoc, s, tmp1, r.aStart, nFlags, pErrRef);
  if (tmp2 === -1) { // check for col only reference F:H
    if (bOnlyAcceptSingle) return nBailOutFlags; // by definition full col refs are ranges

    tmp1 = lcl_eatWhiteSpace(s, tmp1);
    if (at(s, tmp1++) !== ':') return nBailOutFlags; // Even a singleton requires ':' (eg F:F)

    tmp1 = lcl_eatWhiteSpace(s, tmp1);
    tmp2 = lcl_a1_get_col(rDoc, s, tmp1, r.aEnd, nFlags2, pErrRef);
    if (tmp2 === -1 || at(s, tmp2) !== '\0') return nBailOutFlags; // Must have fully parsed a singleton.

    r.aStart.SetRow(0); r.aEnd.SetRow(rDoc.MaxRow());
    nFlags.v |= ScRefFlags.ROW_VALID | ScRefFlags.ROW2_VALID | ScRefFlags.ROW_ABS | ScRefFlags.ROW2_ABS;
    nFlags.v = applyStartToEndFlags(nFlags.v, nFlags2.v);
    return nFlags.v;
  }

  // prepare as if it's a singleton, in case we want to fall back */
  r.aEnd.SetCol(r.aStart.Col());
  r.aEnd.SetRow(r.aStart.Row()); // don't overwrite sheet number as parsed in Parse_XL_Header()

  if (bOnlyAcceptSingle) {
    if (at(s, tmp2) === '\0') return nFlags.v;
    // any trailing invalid character must invalidate the address.
    nFlags.v &= ~INVALIDATE_SINGLE;
    return nFlags.v;
  }

  tmp2 = lcl_eatWhiteSpace(s, tmp2);
  if (at(s, tmp2) !== ':') {
    // Sheet1:Sheet2!C4 is a valid range, without a second sheet it is
    // not. Any trailing invalid character invalidates the range.
    if (at(s, tmp2) === '\0' && nFlags.v & ScRefFlags.TAB2_3D) {
      if (nFlags.v & ScRefFlags.COL_ABS) nFlags.v |= ScRefFlags.COL2_ABS;
      if (nFlags.v & ScRefFlags.ROW_ABS) nFlags.v |= ScRefFlags.ROW2_ABS;
    } else nFlags.v &= ~INVALIDATE_ALL;
    return nFlags.v;
  }

  p = lcl_eatWhiteSpace(s, tmp2 + 1); // after ':'
  tmp1 = lcl_a1_get_col(rDoc, s, p, r.aEnd, nFlags2, pErrRef);
  if (tmp1 === -1 && !names.end) { // Probably the aEndTabName was specified after the first range
    const rr = lcl_XL_ParseSheetRef(s, p, false, -1, pErrRef);
    p = rr.p;
    if (p !== -1) {
      names.end = rr.name;
      let nTab = 0;
      if (names.end && (nTab = rDoc.GetTable(names.end)) >= 0) {
        r.aEnd.SetTab(nTab);
        nFlags.v |= ScRefFlags.TAB2_VALID | ScRefFlags.TAB2_3D | ScRefFlags.TAB2_ABS;
      }
      if (at(s, p) === '!' || at(s, p) === ':') p = lcl_eatWhiteSpace(s, p + 1);
      tmp1 = lcl_a1_get_col(rDoc, s, p, r.aEnd, nFlags2, pErrRef);
    }
  }
  if (tmp1 === -1) // strange, but maybe valid singleton
    return isValidSingleton(nFlags.v, nFlags2.v) ? nFlags.v : nFlags.v & ~ScRefFlags.VALID;

  tmp2 = lcl_a1_get_row(rDoc, s, tmp1, r.aEnd, nFlags2, pErrRef);
  if (tmp2 === -1) // strange, but maybe valid singleton
    return isValidSingleton(nFlags.v, nFlags2.v) ? nFlags.v : nFlags.v & ~ScRefFlags.VALID;

  if (at(s, tmp2) !== '\0') {
    // any trailing invalid character must invalidate the range.
    nFlags.v &= ~INVALIDATE_ALL;
    return nFlags.v;
  }

  nFlags.v = applyStartToEndFlags(nFlags.v, nFlags2.v);
  return nFlags.v;
}

/** ScGlobal::FindUnquoted for a string from a start position. */
export function FindUnquoted(rString: string, cChar: string, nStart = 0): number {
  const cQuote = '\'';
  let bQuoted = false;
  for (let p = nStart; p < rString.length; ++p) {
    const c = rString[p]!;
    if (c === cChar && !bQuoted) return p;
    else if (c === cQuote) {
      if (!bQuoted) bQuoted = true;
      else if (p < rString.length - 1 && rString[p + 1] === cQuote) ++p;
      else bQuoted = false;
    }
  }
  return -1;
}

/**
    @param rRawRes  returns ScRefFlags::... flags without the final check for full
                    validity that is applied to the return value, with which
                    two addresses that form a column or row singleton range,
                    e.g. A:A or 1:1, can be detected. Used in
                    lcl_ScRange_Parse_OOo().
 */
function lcl_ScAddress_Parse_OOo(s: string, rDoc: ScAddressDocument, rAddr: ScAddress, rRawRes: { v: ScRefFlags }, pSheetEndPos: { value: number } | undefined, pErrRef?: string): ScRefFlags {
  const pStart = 0;
  let p = 0;
  if (pSheetEndPos) pSheetEndPos.value = 0;
  let nRes = ScRefFlags.ZERO;
  rRawRes.v = ScRefFlags.ZERO;
  let aTab = '';

  // Let's see if this is a reference to something in an external file.  A
  // document name is always quoted and has a trailing #.
  if (at(s, p) === '\'') {
    const q = parseQuotedName(s, p);
    if (at(s, q.p) === '#') return nRes; // external document, not supported
    // This is not a document name.  Perhaps a quoted relative table
    // name.
    p = pStart;
  }

  let nCol = 0;
  let nRow = 0;
  let nTab = 0;
  let nBailOutFlags = ScRefFlags.ZERO;
  let nBits = ScRefFlags.TAB_VALID;
  let q: number;
  if (FindUnquoted(s, '.', p) !== -1) {
    nRes |= ScRefFlags.TAB_3D;
    if (at(s, p) === '$') {
      nRes |= ScRefFlags.TAB_ABS;
      p++;
    }

    if (pErrRef !== undefined && lcl_isString(s, p, pErrRef) && at(s, p + pErrRef.length) === '.') {
      // #REF! particle of an invalidated reference plus sheet separator.
      p += pErrRef.length + 1;
      nRes &= ~ScRefFlags.TAB_VALID;
      nTab = -1;
    } else {
      if (at(s, p) === '\'') {
        // Tokens that start at ' can have anything in them until a final
        // ' but '' marks an escaped '.  We've earlier guaranteed that a
        // string containing '' will be surrounded by '.
        const qq = parseQuotedName(s, p);
        p = qq.p;
        aTab = qq.name;
      } else {
        let aTabAcc = '';
        while (at(s, p) !== '\0') {
          if (at(s, p) === '.') break;
          if (at(s, p) === '\'') { p++; break; }
          aTabAcc += s[p];
          p++;
        }
        aTab = aTabAcc;
      }
      if (at(s, p) !== '.') nBits = ScRefFlags.ZERO;
      else {
        ++p;
        if ((nTab = rDoc.GetTable(aTab)) < 0) { nTab = 0; nBits = ScRefFlags.ZERO; }
      }
    }

    if (pSheetEndPos && nBits & ScRefFlags.TAB_VALID) {
      pSheetEndPos.value = p - pStart;
      nBailOutFlags = ScRefFlags.TAB_VALID | ScRefFlags.TAB_3D;
    }
  } else {
    nTab = rAddr.Tab();
  }
  nRes |= nBits;

  q = p;
  if (at(s, p) !== '\0') {
    nBits = ScRefFlags.COL_VALID;
    if (at(s, p) === '$') {
      nBits |= ScRefFlags.COL_ABS;
      p++;
    }

    if (pErrRef !== undefined && lcl_isString(s, p, pErrRef)) {
      // #REF! particle of an invalidated reference.
      p += pErrRef.length;
      nBits &= ~ScRefFlags.COL_VALID;
      nCol = -1;
    } else {
      if (isAsciiAlpha(at(s, p))) {
        const nMaxCol = rDoc.MaxCol();
        let n = at(s, p++).toUpperCase().charCodeAt(0) - 65;
        while (n < nMaxCol && isAsciiAlpha(at(s, p))) n = (n + 1) * 26 + at(s, p++).toUpperCase().charCodeAt(0) - 65;
        if (n > nMaxCol || n < 0 || (at(s, p) !== '\0' && at(s, p) !== '$' && !isAsciiDigit(at(s, p)) && (pErrRef === undefined || !lcl_isString(s, p, pErrRef))))
          nBits = ScRefFlags.ZERO;
        else nCol = n;
      } else nBits = ScRefFlags.ZERO;

      if (nBits === ScRefFlags.ZERO) p = q;
    }
    nRes |= nBits;
  }

  q = p;
  if (at(s, p) !== '\0') {
    nBits = ScRefFlags.ROW_VALID;
    if (at(s, p) === '$') {
      nBits |= ScRefFlags.ROW_ABS;
      p++;
    }

    if (pErrRef !== undefined && lcl_isString(s, p, pErrRef)) {
      // #REF! particle of an invalidated reference.
      p += pErrRef.length;
      // Clearing the ROW_VALID bit here is not possible because of the
      // check at the end whether only a valid column was detected in
      // which case all bits are cleared because it could be any other
      // name. Instead, set to an absolute invalid row value. This will
      // display a $#REF! instead of #REF! if the error value was
      // relative, but live with it.
      nBits |= ScRefFlags.ROW_ABS;
      nRow = -1;
    } else {
      if (!isAsciiDigit(at(s, p))) {
        nBits = ScRefFlags.ZERO;
        nRow = -1;
      } else {
        let e = p;
        while (isAsciiDigit(at(s, e))) e++;
        const n = Number(s.slice(p, e)) - 1;
        p = e;
        const nMaxRow = rDoc.MaxRow();
        if (n < 0 || n > nMaxRow) nBits = ScRefFlags.ZERO;
        nRow = n;
      }
      if (nBits === ScRefFlags.ZERO) p = q;
    }
    nRes |= nBits;
  }

  rAddr.Set(nCol, nRow, nTab);

  rRawRes.v |= nRes;

  if (!(nRes & ScRefFlags.ROW_VALID) && nRes & ScRefFlags.COL_VALID && !(nRes & ScRefFlags.TAB_3D && nRes & ScRefFlags.TAB_VALID)) {
    // no Row, no Tab, but Col => DM (...), B (...) et al
    nRes = ScRefFlags.ZERO;
  }
  if (at(s, p) === '\0') {
    const nMask = nRes & (ScRefFlags.ROW_VALID | ScRefFlags.COL_VALID | ScRefFlags.TAB_VALID);
    if (nMask === (ScRefFlags.ROW_VALID | ScRefFlags.COL_VALID | ScRefFlags.TAB_VALID)) nRes |= ScRefFlags.VALID;
  } else nRes = rRawRes.v = nBailOutFlags;
  return nRes;
}

function lcl_ScAddress_Parse(s: string, rDoc: ScAddressDocument, rAddr: ScAddress, rDetails: ScAddressDetails, pSheetEndPos: { value: number } | undefined, pErrRef?: string): ScRefFlags {
  if (!s) return ScRefFlags.ZERO;

  switch (rDetails.eConv) {
    case FormulaGrammar.CONV_XL_A1:
    case FormulaGrammar.CONV_XL_OOX: {
      const rRange = new ScRange(rAddr);
      const nFlags = lcl_ScRange_Parse_XL_A1(rRange, s, rDoc, true, pSheetEndPos, pErrRef);
      rAddr.assign(rRange.aStart);
      return nFlags;
    }
    case FormulaGrammar.CONV_XL_R1C1: {
      const rRange = new ScRange(rAddr);
      const nFlags = lcl_ScRange_Parse_XL_R1C1(rRange, s, rDoc, rDetails, true, pSheetEndPos);
      rAddr.assign(rRange.aStart);
      return nFlags;
    }
    default:
    case FormulaGrammar.CONV_OOO: {
      const nRawRes = { v: ScRefFlags.ZERO };
      return lcl_ScAddress_Parse_OOo(s, rDoc, rAddr, nRawRes, pSheetEndPos, pErrRef);
    }
  }
}

export function ConvertSingleRef(rDoc: ScAddressDocument, rRefString: string, nDefTab: SCTAB, rRefAddress: ScRefAddress, rDetails: ScAddressDetails): boolean {
  let bRet = false;
  if (FindUnquoted(rRefString, '#') === -1) {
    const aAddr = new ScAddress(0, 0, nDefTab);
    const nRes = aAddr.Parse(rRefString, rDoc, rDetails);
    if (nRes & ScRefFlags.VALID) {
      rRefAddress.Set(aAddr, (nRes & ScRefFlags.COL_ABS) === 0, (nRes & ScRefFlags.ROW_ABS) === 0, (nRes & ScRefFlags.TAB_ABS) === 0);
      bRet = true;
    }
  }
  return bRet;
}

export function ConvertDoubleRef(rDoc: ScAddressDocument, rRefString: string, nDefTab: SCTAB, rStartRefAddress: ScRefAddress, rEndRefAddress: ScRefAddress, rDetails: ScAddressDetails): boolean {
  let bRet = false;
  if (FindUnquoted(rRefString, '#') === -1) {
    const aRange = new ScRange(new ScAddress(0, 0, nDefTab));
    const nRes = aRange.Parse(rRefString, rDoc, rDetails);
    if (nRes & ScRefFlags.VALID) {
      rStartRefAddress.Set(aRange.aStart, (nRes & ScRefFlags.COL_ABS) === 0, (nRes & ScRefFlags.ROW_ABS) === 0, (nRes & ScRefFlags.TAB_ABS) === 0);
      rEndRefAddress.Set(aRange.aEnd, (nRes & ScRefFlags.COL2_ABS) === 0, (nRes & ScRefFlags.ROW2_ABS) === 0, (nRes & ScRefFlags.TAB2_ABS) === 0);
      bRet = true;
    }
  }
  return bRet;
}

function lcl_ScRange_Parse_OOo(rRange: ScRange, r: string, rDoc: ScAddressDocument, pErrRef?: string): ScRefFlags {
  let nRes1 = ScRefFlags.ZERO, nRes2 = ScRefFlags.ZERO;
  const nPos = FindUnquoted(r, ':');
  if (nPos !== -1) {
    const nRawRes1 = { v: ScRefFlags.ZERO };
    nRes1 = lcl_ScAddress_Parse_OOo(r.slice(0, nPos), rDoc, rRange.aStart, nRawRes1, undefined, pErrRef);
    if (nRes1 !== ScRefFlags.ZERO || (nRawRes1.v & (ScRefFlags.COL_VALID | ScRefFlags.ROW_VALID) && nRawRes1.v & ScRefFlags.TAB_VALID)) {
      rRange.aEnd = rRange.aStart.clone(); // sheet must be initialized identical to first sheet
      const nRawRes2 = { v: ScRefFlags.ZERO };
      nRes2 = lcl_ScAddress_Parse_OOo(r.slice(nPos + 1), rDoc, rRange.aEnd, nRawRes2, undefined, pErrRef);
      if (!(nRes1 & ScRefFlags.VALID && nRes2 & ScRefFlags.VALID)
        // If not fully valid addresses, check if both have a valid
        // column or row, and both have valid (or omitted) sheet references.
        && nRawRes1.v & (ScRefFlags.COL_VALID | ScRefFlags.ROW_VALID)
        && nRawRes1.v & ScRefFlags.TAB_VALID
        && nRawRes2.v & (ScRefFlags.COL_VALID | ScRefFlags.ROW_VALID)
        && nRawRes2.v & ScRefFlags.TAB_VALID
        // Both must be column XOR row references, A:A or 1:1 but not A:1 or 1:A
        && (nRawRes1.v & (ScRefFlags.COL_VALID | ScRefFlags.ROW_VALID)) === (nRawRes2.v & (ScRefFlags.COL_VALID | ScRefFlags.ROW_VALID))) {
        nRes1 = nRawRes1.v | ScRefFlags.VALID;
        nRes2 = nRawRes2.v | ScRefFlags.VALID;
        if (nRawRes1.v & ScRefFlags.COL_VALID) {
          rRange.aStart.SetRow(0);
          rRange.aEnd.SetRow(rDoc.MaxRow());
          nRes1 |= ScRefFlags.ROW_VALID | ScRefFlags.ROW_ABS;
          nRes2 |= ScRefFlags.ROW_VALID | ScRefFlags.ROW_ABS;
        } else {
          rRange.aStart.SetCol(0);
          rRange.aEnd.SetCol(rDoc.MaxCol());
          nRes1 |= ScRefFlags.COL_VALID | ScRefFlags.COL_ABS;
          nRes2 |= ScRefFlags.COL_VALID | ScRefFlags.COL_ABS;
        }
      } else if (nRes1 & ScRefFlags.VALID && nRes2 & ScRefFlags.VALID) {
        // Flag entire column/row references so they can be displayed
        // as such. If the sticky reference parts are not both
        // absolute or relative, assume that the user thought about
        // something we should not touch.
        if (rRange.aStart.Row() === 0 && rRange.aEnd.Row() === rDoc.MaxRow() && (nRes1 & ScRefFlags.ROW_ABS) === 0 && (nRes2 & ScRefFlags.ROW_ABS) === 0) {
          nRes1 |= ScRefFlags.ROW_ABS;
          nRes2 |= ScRefFlags.ROW_ABS;
        } else if (rRange.aStart.Col() === 0 && rRange.aEnd.Col() === rDoc.MaxCol() && (nRes1 & ScRefFlags.COL_ABS) === 0 && (nRes2 & ScRefFlags.COL_ABS) === 0) {
          nRes1 |= ScRefFlags.COL_ABS;
          nRes2 |= ScRefFlags.COL_ABS;
        }
      }
      if (nRes1 & ScRefFlags.VALID && nRes2 & ScRefFlags.VALID) {
        // PutInOrder / Justify
        let nMask: number, nBits1: number, nBits2: number;
        let nTemp: number;
        if (rRange.aEnd.Col() < (nTemp = rRange.aStart.Col())) {
          rRange.aStart.SetCol(rRange.aEnd.Col()); rRange.aEnd.SetCol(nTemp);
          nMask = ScRefFlags.COL_VALID | ScRefFlags.COL_ABS;
          nBits1 = nRes1 & nMask;
          nBits2 = nRes2 & nMask;
          nRes1 = (nRes1 & ~nMask) | nBits2;
          nRes2 = (nRes2 & ~nMask) | nBits1;
        }
        if (rRange.aEnd.Row() < (nTemp = rRange.aStart.Row())) {
          rRange.aStart.SetRow(rRange.aEnd.Row()); rRange.aEnd.SetRow(nTemp);
          nMask = ScRefFlags.ROW_VALID | ScRefFlags.ROW_ABS;
          nBits1 = nRes1 & nMask;
          nBits2 = nRes2 & nMask;
          nRes1 = (nRes1 & ~nMask) | nBits2;
          nRes2 = (nRes2 & ~nMask) | nBits1;
        }
        if (rRange.aEnd.Tab() < (nTemp = rRange.aStart.Tab())) {
          rRange.aStart.SetTab(rRange.aEnd.Tab()); rRange.aEnd.SetTab(nTemp);
          nMask = ScRefFlags.TAB_VALID | ScRefFlags.TAB_ABS | ScRefFlags.TAB_3D;
          nBits1 = nRes1 & nMask;
          nBits2 = nRes2 & nMask;
          nRes1 = (nRes1 & ~nMask) | nBits2;
          nRes2 = (nRes2 & ~nMask) | nBits1;
        }
        if ((nRes1 & (ScRefFlags.TAB_ABS | ScRefFlags.TAB_3D)) === (ScRefFlags.TAB_ABS | ScRefFlags.TAB_3D) && !(nRes2 & ScRefFlags.TAB_3D)) nRes2 |= ScRefFlags.TAB_ABS;
      } else {
        // Don't leave around valid half references.
        nRes1 = nRes2 = ScRefFlags.ZERO;
      }
    }
  }
  nRes1 = applyStartToEndFlags(nRes1, nRes2 & ScRefFlags.BITS);
  nRes1 |= nRes2 & ScRefFlags.VALID;
  return nRes1;
}

export function ScColToAlpha(nCol: SCCOL): string {
  if (nCol < 26 * 26) {
    if (nCol < 26) return String.fromCharCode(65 + nCol);
    return String.fromCharCode(65 + Math.floor(nCol / 26) - 1) + String.fromCharCode(65 + (nCol % 26));
  }
  let s = '';
  while (nCol >= 26) {
    const nC = nCol % 26;
    s = String.fromCharCode(65 + nC) + s;
    nCol = nCol - nC;
    nCol = nCol / 26 - 1;
  }
  return String.fromCharCode(65 + nCol) + s;
}

const lcl_a1_append_c = (nCol: number, bIsAbs: boolean): string => (bIsAbs ? '$' : '') + ScColToAlpha(nCol);
const lcl_a1_append_r = (nRow: number, bIsAbs: boolean): string => (bIsAbs ? '$' : '') + String(nRow + 1);

function lcl_r1c1_append_c(nCol: number, bIsAbs: boolean, rDetails: ScAddressDetails): string {
  let r = 'C';
  if (bIsAbs) r += String(nCol + 1);
  else {
    nCol -= rDetails.nCol;
    if (nCol !== 0) r += `[${nCol}]`;
  }
  return r;
}

function lcl_r1c1_append_r(nRow: number, bIsAbs: boolean, rDetails: ScAddressDetails): string {
  let r = 'R';
  if (bIsAbs) r += String(nRow + 1);
  else {
    nRow -= rDetails.nRow;
    if (nRow !== 0) r += `[${nRow}]`;
  }
  return r;
}

function lcl_Format(nTab: SCTAB, nRow: SCROW, nCol: SCCOL, nFlags: ScRefFlags, pDoc: ScAddressDocument | null, rDetails: ScAddressDetails): string {
  let r = '';
  if (nFlags & ScRefFlags.VALID) nFlags |= ScRefFlags.ROW_VALID | ScRefFlags.COL_VALID | ScRefFlags.TAB_VALID;
  if (pDoc && nFlags & ScRefFlags.TAB_VALID) {
    if (nTab < 0 || nTab >= pDoc.GetTableCount()) return STR_NO_REF_TABLE;
    if (nFlags & ScRefFlags.TAB_3D) {
      let aTabName = pDoc.GetName(nTab) ?? '';
      let aDocName = '';
      // External Reference, same as in ScCompiler::MakeTabStr()
      if (aTabName[0] === '\'') { // "'Doc'#Tab"
        const nPos = GetDocTabPos(aTabName);
        if (nPos !== -1) {
          aDocName = aTabName.slice(0, nPos + 1);
          aTabName = aTabName.slice(nPos + 1);
        }
      }
      aTabName = CheckTabQuotes(aTabName, rDetails.eConv);

      const eConv = rDetails.eConv;
      if (eConv === FormulaGrammar.CONV_XL_OOX && aTabName && aTabName[0] === '\'') {
        if (aDocName) r += `'[${aDocName}]${aTabName.slice(1)}`;
        else r += aTabName;
        r += '!';
      } else if (eConv === FormulaGrammar.CONV_XL_OOX || eConv === FormulaGrammar.CONV_XL_A1 || eConv === FormulaGrammar.CONV_XL_R1C1) {
        // CONV_XL_OOX falls through to CONV_XL_A1 and CONV_XL_R1C1
        if (aDocName) r += `[${aDocName}]`;
        r += aTabName;
        r += '!';
      } else {
        // default, CONV_OOO
        r += aDocName;
        if (nFlags & ScRefFlags.TAB_ABS) r += '$';
        r += aTabName;
        r += '.';
      }
    }
  }
  switch (rDetails.eConv) {
    default:
    case FormulaGrammar.CONV_OOO:
    case FormulaGrammar.CONV_XL_A1:
    case FormulaGrammar.CONV_XL_OOX:
      if (nFlags & ScRefFlags.COL_VALID) r += lcl_a1_append_c(nCol, (nFlags & ScRefFlags.COL_ABS) !== 0);
      if (nFlags & ScRefFlags.ROW_VALID) r += lcl_a1_append_r(nRow, (nFlags & ScRefFlags.ROW_ABS) !== 0);
      break;
    case FormulaGrammar.CONV_XL_R1C1:
      if (nFlags & ScRefFlags.ROW_VALID) r += lcl_r1c1_append_r(nRow, (nFlags & ScRefFlags.ROW_ABS) !== 0, rDetails);
      if (nFlags & ScRefFlags.COL_VALID) r += lcl_r1c1_append_c(nCol, (nFlags & ScRefFlags.COL_ABS) !== 0, rDetails);
      break;
  }
  return r;
}

function lcl_Split_DocTab(rDoc: ScAddressDocument, nTab: SCTAB, rDetails: ScAddressDetails): { tab: string; doc: string } {
  let rTabName = rDoc.GetName(nTab) ?? '';
  let rDocName = '';
  // External reference, same as in ScCompiler::MakeTabStr()
  if (rTabName && rTabName[0] === '\'') { // "'Doc'#Tab"
    const nPos = GetDocTabPos(rTabName);
    if (nPos !== -1) {
      rDocName = rTabName.slice(0, nPos + 1);
      rTabName = rTabName.slice(nPos + 1);
    }
  }
  rTabName = CheckTabQuotes(rTabName, rDetails.eConv);
  return { tab: rTabName, doc: rDocName };
}

function lcl_ScRange_Format_XL_Header(rRange: ScRange, nFlags: ScRefFlags, rDoc: ScAddressDocument, rDetails: ScAddressDetails): string {
  if (!(nFlags & ScRefFlags.TAB_3D)) return '';
  let rString = '';
  let nQuotePos = 0;
  let { tab: aTabName, doc: aDocName } = lcl_Split_DocTab(rDoc, rRange.aStart.Tab(), rDetails);
  if (rDetails.eConv === FormulaGrammar.CONV_XL_OOX && aTabName && aTabName[0] === '\'') {
    if (aDocName) rString += `'[${aDocName}]${aTabName.slice(1)}`;
    else rString += aTabName;
  } else {
    // CONV_XL_OOX falls through to the default
    if (aDocName) {
      rString += `[${aDocName}]`;
      nQuotePos = rString.length;
    }
    rString += aTabName;
  }
  if (nFlags & ScRefFlags.TAB2_3D) {
    ({ tab: aTabName, doc: aDocName } = lcl_Split_DocTab(rDoc, rRange.aEnd.Tab(), rDetails));
    rString = FormExcelSheetRange(rString, nQuotePos, aTabName);
  }
  rString += '!';
  return rString;
}

// helpers used in ScRange::Format
const lcl_ColAbsFlagDiffer = (nFlags: ScRefFlags): boolean => !!(nFlags & ScRefFlags.COL_ABS) !== !!(nFlags & ScRefFlags.COL2_ABS);
const lcl_RowAbsFlagDiffer = (nFlags: ScRefFlags): boolean => !!(nFlags & ScRefFlags.ROW_ABS) !== !!(nFlags & ScRefFlags.ROW2_ABS);

export function AlphaToCol(rDoc: ScAddressDocument, rStr: string): SCCOL | -1 {
  let nResult = 0;
  const nStop = rStr.length;
  let nPos = 0;
  const nMaxCol = rDoc.MaxCol();
  while (nResult <= nMaxCol && nPos < nStop && isAsciiAlpha(rStr[nPos]!)) {
    if (nPos > 0) nResult = (nResult + 1) * 26;
    nResult += rStr[nPos]!.toUpperCase().charCodeAt(0) - 65;
    ++nPos;
  }
  const bOk = nResult >= 0 && nResult <= nMaxCol && nPos > 0;
  return bOk ? nResult : -1;
}
