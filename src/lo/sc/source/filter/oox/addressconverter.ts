// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/filter/oox/addressconverter.cxx reduced
// AddressConverter: cell addresses and ranges of the OOXML formats ("B3", "A1:C4", space separated
// range lists), checked against the sheet limits. Reduced: the BIFF address structures and the
// tracking of invalid addresses for warnings are left out; an invalid address yields null.
import { ScAddress, ScColToAlpha, ScRange, type SCCOL, type SCROW, type SCTAB } from '../../../inc/address.ts';
import type { ScSheetLimits } from '../../../inc/sheetlimits.ts';

/** parseOoxAddress2d: column and row of "A1" (case-insensitive, '$' allowed), 0-based. */
export function parseOoxAddress2d(aString: string): { nCol: number; nRow: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?([0-9]{1,7})$/.exec(aString.trim());
  if (!m) return null;
  let nCol = 0;
  for (const c of m[1]!.toUpperCase()) nCol = nCol * 26 + (c.charCodeAt(0) - 64);
  const nRow = parseInt(m[2]!, 10);
  if (nRow < 1) return null;
  return { nCol: nCol - 1, nRow: nRow - 1 };
}

export class AddressConverter {
  private readonly maMaxPos: ScAddress;

  constructor(rLimits: ScSheetLimits) {
    this.maMaxPos = new ScAddress(rLimits.mnMaxCol, rLimits.mnMaxRow, 0);
  }

  getMaxApiAddress(): ScAddress { return this.maMaxPos; }

  checkCol(nCol: SCCOL): boolean { return nCol >= 0 && nCol <= this.maMaxPos.Col(); }
  checkRow(nRow: SCROW): boolean { return nRow >= 0 && nRow <= this.maMaxPos.Row(); }

  /** createValidCellAddress / convertToCellAddress: null if invalid. */
  convertToCellAddress(rString: string, nSheet: SCTAB): ScAddress | null {
    const a = parseOoxAddress2d(rString);
    if (!a || !this.checkCol(a.nCol) || !this.checkRow(a.nRow)) return null;
    return new ScAddress(a.nCol, a.nRow, nSheet);
  }

  /** convertToCellRange: "A1:B2" or "A1"; with bAllowOverflow the range is cut at the sheet limits. */
  convertToCellRange(rString: string, nSheet: SCTAB, bAllowOverflow = true): ScRange | null {
    const parts = rString.trim().split(':');
    if (parts.length < 1 || parts.length > 2) return null;
    const a = parseOoxAddress2d(parts[0]!), b = parseOoxAddress2d(parts[parts.length - 1]!);
    if (!a || !b) return null;
    const r = new ScRange(Math.min(a.nCol, b.nCol), Math.min(a.nRow, b.nRow), nSheet, Math.max(a.nCol, b.nCol), Math.max(a.nRow, b.nRow), nSheet);
    if (!this.checkCol(r.aStart.Col()) || !this.checkRow(r.aStart.Row())) return null;
    if (!this.checkCol(r.aEnd.Col()) || !this.checkRow(r.aEnd.Row())) {
      if (!bAllowOverflow) return null;
      r.aEnd.SetCol(Math.min(r.aEnd.Col(), this.maMaxPos.Col()));
      r.aEnd.SetRow(Math.min(r.aEnd.Row(), this.maMaxPos.Row()));
    }
    return r;
  }

  /** convertToCellRangeList: a space separated list of ranges. */
  convertToCellRangeList(rString: string, nSheet: SCTAB): ScRange[] {
    const out: ScRange[] = [];
    for (const s of rString.split(/\s+/)) {
      if (!s) continue;
      const r = this.convertToCellRange(s, nSheet);
      if (r) out.push(r);
    }
    return out;
  }
}

/** The OOXML address of a cell ("B3"). */
export const FormatOoxAddress = (nCol: SCCOL, nRow: SCROW): string => `${ScColToAlpha(nCol)}${nRow + 1}`;
/** The OOXML range ("A1:C4", or "A1" for one cell). */
export function FormatOoxRange(r: ScRange): string {
  const a = FormatOoxAddress(r.aStart.Col(), r.aStart.Row());
  return r.aStart.Col() === r.aEnd.Col() && r.aStart.Row() === r.aEnd.Row() ? a : `${a}:${FormatOoxAddress(r.aEnd.Col(), r.aEnd.Row())}`;
}
