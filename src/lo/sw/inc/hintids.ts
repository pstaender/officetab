// SPDX-License-Identifier: MPL-2.0
// @upstream sw/inc/hintids.hxx reduced
// Upstream's integer which-ids become typed keys of one attribute record.

export type FontLineStyle = 'none' | 'single' | 'double' | 'dotted' | 'dash' | 'wave';
export type SvxAdjust = 'left' | 'right' | 'center' | 'block';
export type SvxBreak = 'none' | 'page-before' | 'page-after' | 'column-before';

export interface SvxLRSpace { left: number; right: number; firstLine: number }
export interface SvxULSpace { upper: number; lower: number }
export type SvxLineSpacing =
  | { rule: 'proportional'; value: number } // percent
  | { rule: 'fix'; value: number } // twips
  | { rule: 'min'; value: number }; // twips

export interface SwCharAttrs {
  RES_CHRATR_FONT: string;
  RES_CHRATR_FONTSIZE: number; // twips
  RES_CHRATR_WEIGHT: boolean;
  RES_CHRATR_POSTURE: boolean;
  RES_CHRATR_UNDERLINE: FontLineStyle;
  RES_CHRATR_CROSSEDOUT: boolean;
  RES_CHRATR_COLOR: string | null; // null = automatic
  RES_CHRATR_BACKGROUND: string | null;
  RES_CHRATR_ESCAPEMENT: number; // percent; >0 super, <0 sub
  RES_CHRATR_CASEMAP: 'none' | 'uppercase' | 'lowercase';
}

export interface SwParaAttrs {
  RES_PARATR_ADJUST: SvxAdjust;
  RES_PARATR_LINESPACING: SvxLineSpacing;
  RES_PARATR_WIDOWS: number;
  RES_PARATR_ORPHANS: number;
  RES_LR_SPACE: SvxLRSpace;
  RES_UL_SPACE: SvxULSpace;
  RES_KEEP: boolean;
  RES_BREAK: SvxBreak;
  RES_BACKGROUND: string | null;
}

export type SwAttrs = SwCharAttrs & SwParaAttrs;
export type SwAttrSet = Partial<SwAttrs>;
export type SwCharAttrSet = Partial<SwCharAttrs>;

export const POOL_DEFAULTS: SwAttrs = {
  RES_CHRATR_FONT: 'Liberation Serif',
  RES_CHRATR_FONTSIZE: 240,
  RES_CHRATR_WEIGHT: false,
  RES_CHRATR_POSTURE: false,
  RES_CHRATR_UNDERLINE: 'none',
  RES_CHRATR_CROSSEDOUT: false,
  RES_CHRATR_COLOR: null,
  RES_CHRATR_BACKGROUND: null,
  RES_CHRATR_ESCAPEMENT: 0,
  RES_CHRATR_CASEMAP: 'none',
  RES_PARATR_ADJUST: 'left',
  RES_PARATR_LINESPACING: { rule: 'proportional', value: 100 },
  RES_PARATR_WIDOWS: 2,
  RES_PARATR_ORPHANS: 2,
  RES_LR_SPACE: { left: 0, right: 0, firstLine: 0 },
  RES_UL_SPACE: { upper: 0, lower: 0 },
  RES_KEEP: false,
  RES_BREAK: 'none',
  RES_BACKGROUND: null,
};

export const CHAR_KEYS = new Set<string>(Object.keys(POOL_DEFAULTS).filter((k) => k.startsWith('RES_CHRATR_')));
