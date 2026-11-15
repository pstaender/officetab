// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/rangelst.hxx reduced
// @upstream sc/source/core/tool/rangelst.cxx reduced
// ScRangeList: a list of ranges (a multi-selection, a reference list) with Join to merge
// adjacent or overlapping ranges, Parse and Format in a convention, and Intersects/Contains.
import { FormulaGrammar } from '../../include/formula/grammar.ts';
import { ScAddress, ScRange, ScRefFlags, type ScAddressDetails, type ScAddressDocument, type SCTAB } from './address.ts';

export class ScRangeList {
  private maRanges: ScRange[] = [];

  constructor(rRange?: ScRange) {
    if (rRange) this.maRanges.push(rRange.clone());
  }

  clone(): ScRangeList {
    const r = new ScRangeList();
    r.maRanges = this.maRanges.map((x) => x.clone());
    return r;
  }

  /** Parse a list of ranges separated by cDelimiter (';' for Calc A1, ',' for Excel). */
  Parse(rStr: string, rDoc: ScAddressDocument, eConv: FormulaGrammar.AddressConvention = FormulaGrammar.CONV_OOO, nDefaultTab: SCTAB = 0, cDelimiter = '\0'): ScRefFlags {
    if (!rStr) return ScRefFlags.ZERO;
    if (cDelimiter === '\0') cDelimiter = eConv === FormulaGrammar.CONV_OOO ? ';' : ',';
    let nResult = ~ScRefFlags.ZERO; // set all bits
    const aRange = new ScRange();
    const nTab = nDefaultTab;
    for (const aOne of rStr.split(cDelimiter)) {
      aRange.aStart.SetTab(nTab); // default tab if not specified
      const details = { eConv, nRow: 0, nCol: 0 };
      let nRes = aRange.ParseAny(aOne, rDoc, details);
      const nEndRangeBits = ScRefFlags.COL2_VALID | ScRefFlags.ROW2_VALID | ScRefFlags.TAB2_VALID;
      const nTmp1 = nRes & ScRefFlags.BITS;
      const nTmp2 = nRes & nEndRangeBits;
      // If we have a valid single range with
      // any of the address bits we are interested in
      // set - set the equiv end range bits
      if (nRes & ScRefFlags.VALID && nTmp1 !== ScRefFlags.ZERO && nTmp2 !== nEndRangeBits) nRes |= (nTmp1 << 4) & 0xffff;
      if (nRes & ScRefFlags.VALID) this.push_back(aRange.clone());
      nResult &= nRes; // all common bits are preserved
    }
    return nResult; // ScRefFlags::VALID set when all are OK
  }

  Format(rDoc: ScAddressDocument, nFlags: ScRefFlags = ScRefFlags.ZERO, eConv: FormulaGrammar.AddressConvention = FormulaGrammar.CONV_OOO, cDelimiter = '\0', bFullAddressNotation = false): string {
    if (cDelimiter === '\0') cDelimiter = eConv === FormulaGrammar.CONV_OOO ? ';' : ',';
    const details: ScAddressDetails = { eConv, nRow: 0, nCol: 0 };
    return this.maRanges.map((r) => r.Format(rDoc, nFlags, details, bFullAddressNotation)).join(cDelimiter);
  }

  push_back(r: ScRange): void { this.maRanges.push(r); }

  /** Add a range, merging it with ranges it touches or overlaps (Join). */
  Join(rNewRange: ScRange, bIsInList = false): void {
    void bIsInList;
    let aNew = rNewRange.clone();
    let bJoined: boolean;
    do {
      bJoined = false;
      for (let i = 0; i < this.maRanges.length; i++) {
        const r = this.maRanges[i]!;
        if (r.Contains(aNew)) return; // already included
        if (aNew.Contains(r)) {
          this.maRanges.splice(i, 1);
          bJoined = true;
          break;
        }
        if (r.aStart.Tab() !== aNew.aStart.Tab() || r.aEnd.Tab() !== aNew.aEnd.Tab()) continue;
        // same columns, adjacent or overlapping rows
        if (r.aStart.Col() === aNew.aStart.Col() && r.aEnd.Col() === aNew.aEnd.Col() && r.aStart.Row() <= aNew.aEnd.Row() + 1 && aNew.aStart.Row() <= r.aEnd.Row() + 1) {
          aNew = new ScRange(r.aStart.Col(), Math.min(r.aStart.Row(), aNew.aStart.Row()), r.aStart.Tab(), r.aEnd.Col(), Math.max(r.aEnd.Row(), aNew.aEnd.Row()), r.aEnd.Tab());
          this.maRanges.splice(i, 1);
          bJoined = true;
          break;
        }
        // same rows, adjacent or overlapping columns
        if (r.aStart.Row() === aNew.aStart.Row() && r.aEnd.Row() === aNew.aEnd.Row() && r.aStart.Col() <= aNew.aEnd.Col() + 1 && aNew.aStart.Col() <= r.aEnd.Col() + 1) {
          aNew = new ScRange(Math.min(r.aStart.Col(), aNew.aStart.Col()), r.aStart.Row(), r.aStart.Tab(), Math.max(r.aEnd.Col(), aNew.aEnd.Col()), r.aEnd.Row(), r.aEnd.Tab());
          this.maRanges.splice(i, 1);
          bJoined = true;
          break;
        }
      }
    } while (bJoined);
    this.maRanges.push(aNew);
  }

  /** Remove the area of a range from the list (DeleteArea). */
  DeleteArea(rRange: ScRange): void {
    const out: ScRange[] = [];
    for (const r of this.maRanges) {
      if (!r.Intersects(rRange)) { out.push(r); continue; }
      const x = r.Intersection(rRange);
      // up to 4 remaining pieces per sheet range
      if (r.aStart.Row() < x.aStart.Row()) out.push(new ScRange(r.aStart.Col(), r.aStart.Row(), r.aStart.Tab(), r.aEnd.Col(), x.aStart.Row() - 1, r.aEnd.Tab()));
      if (x.aEnd.Row() < r.aEnd.Row()) out.push(new ScRange(r.aStart.Col(), x.aEnd.Row() + 1, r.aStart.Tab(), r.aEnd.Col(), r.aEnd.Row(), r.aEnd.Tab()));
      if (r.aStart.Col() < x.aStart.Col()) out.push(new ScRange(r.aStart.Col(), x.aStart.Row(), r.aStart.Tab(), x.aStart.Col() - 1, x.aEnd.Row(), r.aEnd.Tab()));
      if (x.aEnd.Col() < r.aEnd.Col()) out.push(new ScRange(x.aEnd.Col() + 1, x.aStart.Row(), r.aStart.Tab(), r.aEnd.Col(), x.aEnd.Row(), r.aEnd.Tab()));
    }
    this.maRanges = out;
  }

  Intersects(rRange: ScRange): boolean { return this.maRanges.some((r) => r.Intersects(rRange)); }
  Contains(rRange: ScRange | ScAddress): boolean {
    if (rRange instanceof ScAddress) return this.maRanges.some((r) => r.Contains(rRange));
    return this.maRanges.some((r) => r.Contains(rRange));
  }

  /** The total number of cells. */
  GetCellCount(): number {
    return this.maRanges.reduce((n, r) => n + (r.aEnd.Col() - r.aStart.Col() + 1) * (r.aEnd.Row() - r.aStart.Row() + 1) * (r.aEnd.Tab() - r.aStart.Tab() + 1), 0);
  }

  /** The bounding range of all ranges (Combine). */
  Combine(): ScRange {
    if (!this.maRanges.length) return ScRange.Invalid();
    const r = this.maRanges[0]!.clone();
    for (const x of this.maRanges) r.ExtendTo(x);
    return r;
  }

  RemoveAll(): void { this.maRanges = []; }
  Remove(nPos: number): void { this.maRanges.splice(nPos, 1); }
  empty(): boolean { return this.maRanges.length === 0; }
  size(): number { return this.maRanges.length; }
  at(idx: number): ScRange { return this.maRanges[idx]!; }
  front(): ScRange { return this.maRanges[0]!; }
  back(): ScRange { return this.maRanges[this.maRanges.length - 1]!; }
  [Symbol.iterator](): Iterator<ScRange> { return this.maRanges[Symbol.iterator](); }
  equals(r: ScRangeList): boolean { return this.maRanges.length === r.maRanges.length && this.maRanges.every((x, i) => x.equals(r.maRanges[i]!)); }
}
