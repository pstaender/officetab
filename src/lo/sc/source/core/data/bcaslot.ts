// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/core/inc/bcaslot.hxx reduced
// @upstream sc/source/core/data/bcaslot.cxx reduced
// ScBroadcastAreaSlotMachine, reduced: the formula cells listening to single cells (upstream's
// per-cell SvtBroadcaster of the columns) and to areas. Areas are shared between the listeners
// of the same range (ScBroadcastArea) and registered in slots of 16 columns by 512 rows per
// sheet; an area spanning more than 4096 slots (whole sheets) is kept in a per-sheet list that
// is checked on every broadcast. BCA_LISTEN_ALWAYS areas (volatile functions) are notified on any
// change. Updating the areas on inserted or deleted cells (UpdateBroadcastAreas) is replaced by
// the document dropping and re-establishing all listeners after a structural change.
import { SCROW_MAX, type ScAddress, type ScRange } from '../../../inc/address.ts';

/** A listener: anything that can be marked dirty (a formula cell). */
export interface ScListener { SetDirty(bDirtyFlag?: boolean): void }

const SLOT_COLS = 16;
const SLOT_ROWS = 512;
const MAX_SLOTS_PER_AREA = 4096;

/** ScBroadcastArea: a range and its listeners. */
class ScBroadcastArea {
  readonly aRange: ScRange;
  readonly maListeners = new Set<ScListener>();
  constructor(rRange: ScRange) { this.aRange = rRange.clone(); }
}

const areaKey = (r: ScRange) => `${r.aStart.Tab()},${r.aStart.Col()},${r.aStart.Row()},${r.aEnd.Tab()},${r.aEnd.Col()},${r.aEnd.Row()}`;
const cellKey = (nTab: number, nCol: number, nRow: number) => (nTab * 0x4000 + nCol) * 0x1000000 + nRow;
const slotKey = (nTab: number, nColSlot: number, nRowSlot: number) => (nTab * 0x400 + nColSlot) * 0x1000 + nRowSlot;

export class ScBroadcastAreaSlotMachine {
  /** Listeners of single cells by cell key. */
  private maCellListeners = new Map<number, Set<ScListener>>();
  private maAreas = new Map<string, ScBroadcastArea>();
  private maSlots = new Map<number, Set<ScBroadcastArea>>();
  /** Areas too big for slots, by sheet. */
  private maBigAreas = new Map<number, Set<ScBroadcastArea>>();
  /** Listeners of BCA_LISTEN_ALWAYS. */
  private maAlways = new Set<ScListener>();

  private static IsAlways(rRange: ScRange): boolean {
    return rRange.aStart.Row() === SCROW_MAX && rRange.aEnd.Row() === SCROW_MAX;
  }

  StartListeningCell(rAddr: ScAddress, pListener: ScListener): void {
    const k = cellKey(rAddr.Tab(), rAddr.Col(), rAddr.Row());
    let s = this.maCellListeners.get(k);
    if (!s) this.maCellListeners.set(k, (s = new Set()));
    s.add(pListener);
  }

  EndListeningCell(rAddr: ScAddress, pListener: ScListener): void {
    const k = cellKey(rAddr.Tab(), rAddr.Col(), rAddr.Row());
    const s = this.maCellListeners.get(k);
    if (!s) return;
    s.delete(pListener);
    if (!s.size) this.maCellListeners.delete(k);
  }

  private *slotsOf(r: ScRange): Generator<number> {
    for (let nTab = r.aStart.Tab(); nTab <= r.aEnd.Tab(); nTab++)
      for (let c = Math.floor(r.aStart.Col() / SLOT_COLS); c <= Math.floor(r.aEnd.Col() / SLOT_COLS); c++)
        for (let rr = Math.floor(r.aStart.Row() / SLOT_ROWS); rr <= Math.floor(r.aEnd.Row() / SLOT_ROWS); rr++) yield slotKey(nTab, c, rr);
  }

  private static SlotCount(r: ScRange): number {
    return (r.aEnd.Tab() - r.aStart.Tab() + 1) * (Math.floor(r.aEnd.Col() / SLOT_COLS) - Math.floor(r.aStart.Col() / SLOT_COLS) + 1)
      * (Math.floor(r.aEnd.Row() / SLOT_ROWS) - Math.floor(r.aStart.Row() / SLOT_ROWS) + 1);
  }

  StartListeningArea(rRange: ScRange, pListener: ScListener): void {
    if (ScBroadcastAreaSlotMachine.IsAlways(rRange)) {
      this.maAlways.add(pListener);
      return;
    }
    const k = areaKey(rRange);
    let pArea = this.maAreas.get(k);
    if (!pArea) {
      pArea = new ScBroadcastArea(rRange);
      this.maAreas.set(k, pArea);
      if (ScBroadcastAreaSlotMachine.SlotCount(rRange) > MAX_SLOTS_PER_AREA) {
        for (let nTab = rRange.aStart.Tab(); nTab <= rRange.aEnd.Tab(); nTab++) {
          let s = this.maBigAreas.get(nTab);
          if (!s) this.maBigAreas.set(nTab, (s = new Set()));
          s.add(pArea);
        }
      } else {
        for (const sk of this.slotsOf(rRange)) {
          let s = this.maSlots.get(sk);
          if (!s) this.maSlots.set(sk, (s = new Set()));
          s.add(pArea);
        }
      }
    }
    pArea.maListeners.add(pListener);
  }

  EndListeningArea(rRange: ScRange, pListener: ScListener): void {
    if (ScBroadcastAreaSlotMachine.IsAlways(rRange)) {
      this.maAlways.delete(pListener);
      return;
    }
    const k = areaKey(rRange);
    const pArea = this.maAreas.get(k);
    if (!pArea) return;
    pArea.maListeners.delete(pListener);
    if (pArea.maListeners.size) return;
    // remove the area
    this.maAreas.delete(k);
    if (ScBroadcastAreaSlotMachine.SlotCount(rRange) > MAX_SLOTS_PER_AREA) {
      for (let nTab = rRange.aStart.Tab(); nTab <= rRange.aEnd.Tab(); nTab++) this.maBigAreas.get(nTab)?.delete(pArea);
    } else {
      for (const sk of this.slotsOf(rRange)) {
        const s = this.maSlots.get(sk);
        if (!s) continue;
        s.delete(pArea);
        if (!s.size) this.maSlots.delete(sk);
      }
    }
  }

  /** The listeners of a changed cell: those of the cell, of the areas containing it, and the
      always-listeners. */
  CollectListeners(nTab: number, nCol: number, nRow: number, f: (p: ScListener) => void): void {
    const s = this.maCellListeners.get(cellKey(nTab, nCol, nRow));
    if (s) for (const p of s) f(p);
    const slot = this.maSlots.get(slotKey(nTab, Math.floor(nCol / SLOT_COLS), Math.floor(nRow / SLOT_ROWS)));
    if (slot) {
      for (const pArea of slot) {
        const r = pArea.aRange;
        if (r.aStart.Col() <= nCol && nCol <= r.aEnd.Col() && r.aStart.Row() <= nRow && nRow <= r.aEnd.Row() && r.aStart.Tab() <= nTab && nTab <= r.aEnd.Tab())
          for (const p of pArea.maListeners) f(p);
      }
    }
    const big = this.maBigAreas.get(nTab);
    if (big) {
      for (const pArea of big) {
        const r = pArea.aRange;
        if (r.aStart.Col() <= nCol && nCol <= r.aEnd.Col() && r.aStart.Row() <= nRow && nRow <= r.aEnd.Row()) for (const p of pArea.maListeners) f(p);
      }
    }
    for (const p of this.maAlways) f(p);
  }

  /** The listeners of any cell of a changed range (AreaBroadcast for a range). */
  CollectRangeListeners(rRange: ScRange, f: (p: ScListener) => void): void {
    // cells: when the range is small, look the cells up; else scan all cell listeners
    const nCells = (rRange.aEnd.Col() - rRange.aStart.Col() + 1) * (rRange.aEnd.Row() - rRange.aStart.Row() + 1) * (rRange.aEnd.Tab() - rRange.aStart.Tab() + 1);
    if (nCells <= this.maCellListeners.size) {
      for (let nTab = rRange.aStart.Tab(); nTab <= rRange.aEnd.Tab(); nTab++)
        for (let nCol = rRange.aStart.Col(); nCol <= rRange.aEnd.Col(); nCol++)
          for (let nRow = rRange.aStart.Row(); nRow <= rRange.aEnd.Row(); nRow++) {
            const s = this.maCellListeners.get(cellKey(nTab, nCol, nRow));
            if (s) for (const p of s) f(p);
          }
    } else {
      for (const [k, s] of this.maCellListeners) {
        const nRow = k % 0x1000000;
        const nRest = Math.floor(k / 0x1000000);
        const nCol = nRest % 0x4000;
        const nTab = Math.floor(nRest / 0x4000);
        if (rRange.aStart.Col() <= nCol && nCol <= rRange.aEnd.Col() && rRange.aStart.Row() <= nRow && nRow <= rRange.aEnd.Row() && rRange.aStart.Tab() <= nTab && nTab <= rRange.aEnd.Tab())
          for (const p of s) f(p);
      }
    }
    for (const pArea of this.maAreas.values()) if (pArea.aRange.Intersects(rRange)) for (const p of pArea.maListeners) f(p);
    for (const p of this.maAlways) f(p);
  }

  /** Whether any area or cell listener exists. */
  IsEmpty(): boolean { return !this.maCellListeners.size && !this.maAreas.size && !this.maAlways.size; }

  /** Drop all listeners. */
  Clear(): void {
    this.maCellListeners.clear();
    this.maAreas.clear();
    this.maSlots.clear();
    this.maBigAreas.clear();
    this.maAlways.clear();
  }

  /** Whether the cell has listeners (ScDocument::HasBroadcaster / for tests). */
  HasCellListeners(rAddr: ScAddress): boolean { return this.maCellListeners.has(cellKey(rAddr.Tab(), rAddr.Col(), rAddr.Row())); }
  GetAreaCount(): number { return this.maAreas.size; }
}
