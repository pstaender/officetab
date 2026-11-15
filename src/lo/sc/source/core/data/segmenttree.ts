// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/segmenttree.hxx reduced
// @upstream sc/source/core/data/segmenttree.cxx reduced
// ScFlatSegments: a value per row (or column) stored as runs, as mdds' flat_segment_tree does for
// ScFlatBoolRowSegments (hidden rows), ScFlatUInt16RowSegments (row heights) and the column
// widths. Lookups are a binary search over the runs.

export interface ScFlatSegmentsRangeData<T> { mnPos1: number; mnPos2: number; mnValue: T }

export class ScFlatSegments<T> {
  /** Run ends (inclusive), ascending; the last is the maximum position. */
  private maEnds: number[];
  private maValues: T[];
  private readonly mnMax: number;

  constructor(nMax: number, aDefault: T) {
    this.mnMax = nMax;
    this.maEnds = [nMax];
    this.maValues = [aDefault];
  }

  clone(): ScFlatSegments<T> {
    const r = new ScFlatSegments<T>(this.mnMax, this.maValues[0]!);
    r.maEnds = [...this.maEnds];
    r.maValues = [...this.maValues];
    return r;
  }

  private search(nPos: number): number {
    let lo = 0, hi = this.maEnds.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.maEnds[mid]! < nPos) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  getValue(nPos: number): T { return this.maValues[this.search(nPos)]!; }

  getRangeData(nPos: number): ScFlatSegmentsRangeData<T> {
    const i = this.search(nPos);
    return { mnPos1: i > 0 ? this.maEnds[i - 1]! + 1 : 0, mnPos2: this.maEnds[i]!, mnValue: this.maValues[i]! };
  }

  setValue(nPos1: number, nPos2: number, aValue: T): void {
    if (nPos1 > nPos2) return;
    nPos1 = Math.max(0, nPos1);
    nPos2 = Math.min(this.mnMax, nPos2);
    const ends: number[] = [];
    const vals: T[] = [];
    const push = (e: number, v: T) => {
      const n = ends.length;
      if (n && vals[n - 1] === v) ends[n - 1] = e;
      else { ends.push(e); vals.push(v); }
    };
    let nStart = 0;
    let bInserted = false;
    for (let i = 0; i < this.maEnds.length; i++) {
      const e = this.maEnds[i]!, v = this.maValues[i]!;
      if (nStart < nPos1) push(Math.min(e, nPos1 - 1), v);
      if (!bInserted && e >= nPos1) { push(nPos2, aValue); bInserted = true; }
      if (e > nPos2) push(e, v);
      nStart = e + 1;
    }
    this.maEnds = ends;
    this.maValues = vals;
  }

  /** Insert nSize positions at nPos taking the value of the position before (or aValue). */
  insertSegment(nPos: number, nSize: number, aValue?: T): void {
    const vIns = aValue ?? (nPos > 0 ? this.getValue(nPos - 1) : this.getValue(nPos));
    for (let i = 0; i < this.maEnds.length; i++) if (this.maEnds[i]! >= nPos) this.maEnds[i] = this.maEnds[i]! + nSize;
    this.trim();
    this.setValue(nPos, Math.min(this.mnMax, nPos + nSize - 1), vIns);
  }

  /** Remove positions nPos1..nPos2; the end gets the default (the last run's value). */
  removeSegment(nPos1: number, nPos2: number): void {
    const nSize = nPos2 - nPos1 + 1;
    const ends: number[] = [];
    const vals: T[] = [];
    let nStart = 0;
    for (let i = 0; i < this.maEnds.length; i++) {
      const e = this.maEnds[i]!, v = this.maValues[i]!;
      if (nStart < nPos1) { ends.push(Math.min(e, nPos1 - 1)); vals.push(v); }
      if (e > nPos2) { ends.push(e - nSize); vals.push(v); }
      nStart = e + 1;
    }
    this.maEnds = ends;
    this.maValues = vals;
    if (!this.maEnds.length) { this.maEnds = [this.mnMax]; return; }
    if (this.maEnds[this.maEnds.length - 1]! < this.mnMax) {
      this.maEnds.push(this.mnMax);
      this.maValues.push(this.maValues[this.maValues.length - 1]!);
    }
    this.trim();
  }

  private trim(): void {
    const ends: number[] = [];
    const vals: T[] = [];
    let nPrev = -1;
    for (let i = 0; i < this.maEnds.length; i++) {
      const e = Math.min(this.maEnds[i]!, this.mnMax), v = this.maValues[i]!;
      if (e <= nPrev) continue;
      const n = ends.length;
      if (n && vals[n - 1] === v) ends[n - 1] = e;
      else { ends.push(e); vals.push(v); }
      nPrev = e;
    }
    if (ends[ends.length - 1]! < this.mnMax) ends[ends.length - 1] = this.mnMax;
    this.maEnds = ends;
    this.maValues = vals;
  }

  /** The runs intersecting nPos1..nPos2 (clipped). */
  *runs(nPos1: number, nPos2: number): Generator<ScFlatSegmentsRangeData<T>> {
    let i = this.search(nPos1);
    let nStart = nPos1;
    while (i < this.maEnds.length && nStart <= nPos2) {
      const e = Math.min(this.maEnds[i]!, nPos2);
      yield { mnPos1: nStart, mnPos2: e, mnValue: this.maValues[i]! };
      nStart = e + 1;
      i++;
    }
  }
}

/** The sum of numeric values over a range (ScFlatUInt16RowSegments::getSumValue). */
export function SumValues(r: ScFlatSegments<number>, nPos1: number, nPos2: number, pSkip?: ScFlatSegments<boolean>): number {
  let n = 0;
  if (!pSkip) {
    for (const s of r.runs(nPos1, nPos2)) n += s.mnValue * (s.mnPos2 - s.mnPos1 + 1);
    return n;
  }
  for (const s of r.runs(nPos1, nPos2)) {
    for (const h of pSkip.runs(s.mnPos1, s.mnPos2)) if (!h.mnValue) n += s.mnValue * (h.mnPos2 - h.mnPos1 + 1);
  }
  return n;
}
