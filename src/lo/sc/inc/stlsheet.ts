// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/stlsheet.hxx reduced
// @upstream sc/source/core/data/stlsheet.cxx reduced
// ScStyleSheet: a named cell (or page) style with its attributes and a parent style. Page styles
// carry no items here (printing is not ported).
import { SC_POOL_DEFAULTS, type ScItemId, type ScItems, type ScItemSet } from './scitems.ts';

export const SfxStyleFamily = { Para: 'Para', Page: 'Page', Frame: 'Frame' } as const;
export type SfxStyleFamily = (typeof SfxStyleFamily)[keyof typeof SfxStyleFamily];

export class ScStyleSheet {
  private aName: string;
  private aParent: string;
  private readonly nFamily: SfxStyleFamily;
  private maItems: ScItemSet;
  /** Resolves a parent name to the style (set by the pool). */
  private mpResolve: (rName: string) => ScStyleSheet | null;
  private bUserDefined: boolean;

  constructor(rName: string, nFamily: SfxStyleFamily, aParent: string, rItems: ScItemSet, pResolve: (rName: string) => ScStyleSheet | null, bUserDefined = false) {
    this.aName = rName;
    this.nFamily = nFamily;
    this.aParent = aParent;
    this.maItems = { ...rItems };
    this.mpResolve = pResolve;
    this.bUserDefined = bUserDefined;
  }

  GetName(): string { return this.aName; }
  SetName(rNew: string): void { this.aName = rNew; }
  GetFamily(): SfxStyleFamily { return this.nFamily; }
  GetParent(): string { return this.aParent; }
  /** Sets the parent; refuses a parent that would make a cycle. */
  SetParent(rParentName: string): boolean {
    let p = rParentName ? this.mpResolve(rParentName) : null;
    while (p) {
      if (p === this) return false;
      p = p.aParent ? this.mpResolve(p.aParent) : null;
    }
    this.aParent = rParentName;
    return true;
  }
  IsUserDefined(): boolean { return this.bUserDefined; }

  /** The style's own attributes. */
  GetItemSet(): ScItemSet { return this.maItems; }
  /** Replace the style's own attributes (the cells using it then show them). */
  SetItemSet(rItems: ScItemSet): void { this.maItems = { ...rItems }; }

  /** The value of an item, through the parent chain to the pool defaults. */
  GetItem<K extends ScItemId>(nWhich: K): ScItems[K] {
    const v = this.maItems[nWhich];
    if (v !== undefined) return v as ScItems[K];
    const pParent = this.aParent ? this.mpResolve(this.aParent) : null;
    if (pParent && pParent !== this) return pParent.GetItem(nWhich);
    return SC_POOL_DEFAULTS[nWhich];
  }

  /** ScStyleSheet::IsUsed is answered by the document (ScDocument::IsStyleSheetUsed). */
  HasParentSupport(): boolean { return true; }
}
