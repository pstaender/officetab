// SPDX-License-Identifier: MPL-2.0
// @upstream sw/inc/format.hxx reduced
// @upstream sw/inc/fmtcol.hxx reduced
// @upstream sw/inc/charfmt.hxx reduced
import { POOL_DEFAULTS, type SwAttrs, type SwAttrSet } from './hintids.ts';

export class SwFormat {
  m_aName: string;
  m_aSet: SwAttrSet;
  m_pDerivedFrom: SwFormat | null;

  constructor(name: string, derivedFrom: SwFormat | null = null, set: SwAttrSet = {}) {
    this.m_aName = name;
    this.m_pDerivedFrom = derivedFrom;
    this.m_aSet = set;
  }

  GetName(): string { return this.m_aName; }
  DerivedFrom(): SwFormat | null { return this.m_pDerivedFrom; }

  /** The value set in this format or one it derives from, without the pool default. */
  GetFormatAttrIfSet<K extends keyof SwAttrs>(which: K): SwAttrs[K] | undefined {
    for (let f: SwFormat | null = this; f; f = f.m_pDerivedFrom) {
      const v = f.m_aSet[which];
      if (v !== undefined) return v as SwAttrs[K];
    }
    return undefined;
  }

  /** Walks the derivation chain, then the pool default, as SwAttrSet::Get does. */
  GetFormatAttr<K extends keyof SwAttrs>(which: K): SwAttrs[K] {
    for (let f: SwFormat | null = this; f; f = f.m_pDerivedFrom) {
      const v = f.m_aSet[which];
      if (v !== undefined) return v as SwAttrs[K];
    }
    return POOL_DEFAULTS[which];
  }
}

export class SwTextFormatColl extends SwFormat {
  m_pNextTextFormatColl: SwTextFormatColl | null = null;
  GetNextTextFormatColl(): SwTextFormatColl { return this.m_pNextTextFormatColl ?? this; }
}

export class SwCharFormat extends SwFormat {}
