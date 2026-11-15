// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/patattr.hxx reduced
// @upstream sc/source/core/data/patattr.cxx reduced
// ScPatternAttr: the hard attributes of a cell range on top of a cell style, and the
// CellAttributeHelper that keeps one shared instance per distinct pattern (the pool's
// registration). Patterns are immutable once registered; changing attributes makes a new pattern.
// Left out: the font and colour conversions for output devices (GetFont, FillEditItemSet), the
// conditional set argument, and the item set's which-range machinery.
import { IsMerged, ItemEquals, SC_ITEM_IDS, SC_POOL_DEFAULTS, ScMF, type ScItemId, type ScItems, type ScItemSet } from './scitems.ts';
import type { ScStyleSheet } from './stlsheet.ts';

export class ScPatternAttr {
  private readonly maItems: ScItemSet;
  private pStyle: ScStyleSheet | null;
  private mxVisible: boolean | null = null;
  private mnKey: string | null = null;
  /** Set once registered with the CellAttributeHelper. */
  mbRegistered = false;

  constructor(pStyle: ScStyleSheet | null = null, rItems: ScItemSet = {}) {
    this.pStyle = pStyle;
    this.maItems = Object.freeze({ ...rItems });
  }

  /** The hard attributes of the pattern. */
  GetItemSet(): ScItemSet { return this.maItems; }

  /** The value of an item: the pattern's own, else the style's (through its parents), else the
      pool default. */
  GetItem<K extends ScItemId>(nWhich: K): ScItems[K] {
    const v = this.maItems[nWhich];
    if (v !== undefined) return v as ScItems[K];
    if (this.pStyle) return this.pStyle.GetItem(nWhich);
    return SC_POOL_DEFAULTS[nWhich];
  }

  /** Whether the pattern sets the item itself (SfxItemState::SET). */
  HasItem(nWhich: ScItemId): boolean { return this.maItems[nWhich] !== undefined; }

  GetStyleSheet(): ScStyleSheet | null { return this.pStyle; }
  GetStyleName(): string | null { return this.pStyle ? this.pStyle.GetName() : null; }

  /** A copy with another style; hard attributes that equal the style's are kept. */
  SetStyleSheet(pNewStyle: ScStyleSheet | null, bClearDirectFormat = true): ScPatternAttr {
    if (!pNewStyle) return new ScPatternAttr(null, this.maItems);
    let aItems = this.maItems;
    if (bClearDirectFormat) {
      // ClearItems: hard attributes set in the new style are removed (ScPatternAttr::SetStyleSheet).
      const n: ScItemSet = {};
      for (const k of Object.keys(aItems) as ScItemId[]) {
        if (pNewStyle.GetItemSet()[k] === undefined) (n as Record<string, unknown>)[k] = aItems[k];
      }
      aItems = n;
    }
    return new ScPatternAttr(pNewStyle, aItems);
  }

  /** A copy with the items put (SfxItemSet::Put). */
  PutItems(rItems: ScItemSet): ScPatternAttr {
    return new ScPatternAttr(this.pStyle, { ...this.maItems, ...rItems });
  }

  /** A copy without the given items (ClearItem). */
  ClearItems(aWhich: readonly ScItemId[]): ScPatternAttr {
    const n: ScItemSet = { ...this.maItems };
    for (const k of aWhich) delete n[k];
    return new ScPatternAttr(this.pStyle, n);
  }

  /** Remove the hard attributes that equal those of the style or the defaults
      (ScPatternAttr::ClearItems / RemoveDefaults reduced). */
  RemoveDefaults(): ScPatternAttr {
    const n: ScItemSet = {};
    for (const k of Object.keys(this.maItems) as ScItemId[]) {
      const inherited = this.pStyle ? this.pStyle.GetItem(k) : SC_POOL_DEFAULTS[k];
      if (!ItemEquals(this.maItems[k], inherited)) (n as Record<string, unknown>)[k] = this.maItems[k];
    }
    return new ScPatternAttr(this.pStyle, n);
  }

  /** The number format code, from the pattern (ATTR_VALUE_FORMAT). */
  GetNumberFormat(): string { return this.GetItem('ATTR_VALUE_FORMAT'); }

  /** Whether the pattern differs from the default only in invisible ways (IsVisible). */
  IsVisible(): boolean {
    if (this.mxVisible === null) {
      const b = this.GetItem('ATTR_BACKGROUND') !== null
        || !!this.GetItem('ATTR_BORDER').top || !!this.GetItem('ATTR_BORDER').bottom || !!this.GetItem('ATTR_BORDER').left || !!this.GetItem('ATTR_BORDER').right
        || !!this.GetItem('ATTR_BORDER_TLBR') || !!this.GetItem('ATTR_BORDER_BLTR');
      this.mxVisible = b;
    }
    return this.mxVisible;
  }

  /** IsVisibleEqual */
  IsVisibleEqual(r: ScPatternAttr): boolean {
    return ItemEquals(this.GetItem('ATTR_BACKGROUND'), r.GetItem('ATTR_BACKGROUND')) && ItemEquals(this.GetItem('ATTR_BORDER'), r.GetItem('ATTR_BORDER'))
      && ItemEquals(this.GetItem('ATTR_BORDER_TLBR'), r.GetItem('ATTR_BORDER_TLBR')) && ItemEquals(this.GetItem('ATTR_BORDER_BLTR'), r.GetItem('ATTR_BORDER_BLTR'));
  }

  /** Merged cell origin (ATTR_MERGE with more than one column or row). */
  IsMerged(): boolean { return IsMerged(this.GetItem('ATTR_MERGE')); }
  /** Overlapped by a merged cell (ScMF::Hor or ScMF::Ver). */
  IsOverlapped(): boolean { return (this.GetItem('ATTR_MERGE_FLAG') & (ScMF.Hor | ScMF.Ver)) !== 0; }

  /** A key identifying the pattern's content, for sharing equal patterns. */
  GetKey(): string {
    if (this.mnKey === null) {
      const o: Record<string, unknown> = {};
      for (const k of SC_ITEM_IDS) if (this.maItems[k] !== undefined) o[k] = this.maItems[k];
      this.mnKey = `${this.pStyle ? this.pStyle.GetName() : ''}\u0000${JSON.stringify(o)}`;
    }
    return this.mnKey;
  }

  /** Equality by content (ScPatternAttr::operator==). */
  equals(r: ScPatternAttr): boolean { return this === r || this.GetKey() === r.GetKey(); }

  /** After a style changed, the cached state is stale. */
  InvalidateCaches(): void { this.mxVisible = null; this.mnKey = null; }
}

/**
 * CellAttributeHelper (sc/source/core/data/patattr.cxx): owns the registered patterns of a
 * document, one instance per distinct content, and the default pattern.
 */
export class CellAttributeHelper {
  private maRegistered = new Map<string, ScPatternAttr>();
  private mpDefaultCellAttribute: ScPatternAttr;

  constructor(pDefaultStyle: ScStyleSheet | null) {
    this.mpDefaultCellAttribute = new ScPatternAttr(pDefaultStyle);
    this.mpDefaultCellAttribute.mbRegistered = true;
    this.maRegistered.set(this.mpDefaultCellAttribute.GetKey(), this.mpDefaultCellAttribute);
  }

  getDefaultCellAttribute(): ScPatternAttr { return this.mpDefaultCellAttribute; }

  /** The registered pattern equal to rCandidate (registering it if new). */
  registerAndCheck(rCandidate: ScPatternAttr): ScPatternAttr {
    if (rCandidate.mbRegistered) return rCandidate;
    const k = rCandidate.GetKey();
    const p = this.maRegistered.get(k);
    if (p) return p;
    rCandidate.mbRegistered = true;
    this.maRegistered.set(k, rCandidate);
    return rCandidate;
  }

  /** Re-key all patterns after a cell style was renamed or changed. */
  CellStyleChanged(): void {
    const all = [...this.maRegistered.values()];
    this.maRegistered.clear();
    for (const p of all) {
      p.InvalidateCaches();
      if (!this.maRegistered.has(p.GetKey())) this.maRegistered.set(p.GetKey(), p);
    }
  }
}
