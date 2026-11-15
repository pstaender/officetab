// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/scitems.hxx reduced
// @upstream sc/source/core/data/docpool.cxx reduced
// @upstream sc/inc/attrib.hxx reduced
// The cell attribute items Calc's patterns and cell styles hold, keyed by their ATTR_ names, with
// plain values instead of SfxPoolItems, and their pool defaults (ScDocumentPool). Kept: the font
// (name, height in twips, weight, posture, underline, overline, strikeout, contour, shadow, colour,
// language), alignment (horizontal/vertical justification, indent, rotation, stacked, wrap,
// shrink to fit, writing direction), borders, diagonal lines, margins, background, number format,
// protection, merge, hyperlink. The CJK/CTL font items, emphasis marks, relief, hyphenation and
// the page style items are left out. ATTR_VALUE_FORMAT holds the format code (as the svl port of
// this project identifies formats by code) instead of a number formatter key.
/** FontLineStyle, as Writer's port spells it. */
export type FontLineStyle = 'none' | 'single' | 'double' | 'dotted' | 'dash' | 'wave';

/** SvxBorderLineStyle, the values ODF and OOXML can express. */
export type SvxBorderLineStyle = 'solid' | 'dotted' | 'dashed' | 'double' | 'fine-dashed' | 'dash-dot' | 'dash-dot-dot' | 'double-thin' | 'thin-thick' | 'thick-thin';

/** editeng's SvxBorderLine: colour, width in twips and style. */
export interface SvxBorderLine { color: string; width: number; style?: SvxBorderLineStyle }

/** SvxBoxItem: the four border lines of a cell. */
export interface SvxBoxItem { top: SvxBorderLine | null; bottom: SvxBorderLine | null; left: SvxBorderLine | null; right: SvxBorderLine | null }

/** SvxCellHorJustify */
export type SvxCellHorJustify = 'Standard' | 'Left' | 'Center' | 'Right' | 'Block' | 'Repeat';
/** SvxCellVerJustify */
export type SvxCellVerJustify = 'Standard' | 'Top' | 'Center' | 'Bottom' | 'Block';
/** SvxCellJustifyMethod */
export type SvxCellJustifyMethod = 'Auto' | 'Distribute';
/** SvxRotateMode */
export type SvxRotateMode = 'STANDARD' | 'TOP' | 'CENTER' | 'BOTTOM';
/** SvxFrameDirection of a cell */
export type SvxFrameDirection = 'Environment' | 'Horizontal_LR_TB' | 'Horizontal_RL_TB';

/** SvxMarginItem: the text distances inside a cell, twips. */
export interface SvxMarginItem { left: number; top: number; right: number; bottom: number }

/** ScMergeAttr: the number of columns and rows a merged cell spans (0 or 1: not merged). */
export interface ScMergeAttr { nColMerge: number; nRowMerge: number }

/** ScMF: the flags of ScMergeFlagAttr. */
export const ScMF = {
  NONE: 0x0000,
  Hor: 0x0001,
  Ver: 0x0002,
  Auto: 0x0004, /// autofilter arrow
  Button: 0x0008, /// field button for datapilot
  ButtonPopup: 0x0010, /// dp button with popup arrow
  HiddenMember: 0x0020, /// dp field button with presence of hidden member
  DpTable: 0x0040, /// dp table output
  DpCollapse: 0x0080, /// dp compact layout collapse button
  DpExpand: 0x0100, /// dp compact layout expand button
  ButtonPopup2: 0x0200, /// dp button with popup arrow for multiple fields
  All: 0x03ff,
} as const;
export type ScMF = number;

/** ScProtectionAttr */
export interface ScProtectionAttr { bProtection: boolean; bHideFormula: boolean; bHideCell: boolean; bHidePrint: boolean }

export interface ScItems {
  ATTR_FONT: string;
  /** twips */
  ATTR_FONT_HEIGHT: number;
  /** SvxWeightItem as bold or not */
  ATTR_FONT_WEIGHT: boolean;
  /** SvxPostureItem as italic or not */
  ATTR_FONT_POSTURE: boolean;
  ATTR_FONT_UNDERLINE: FontLineStyle;
  ATTR_FONT_OVERLINE: FontLineStyle;
  ATTR_FONT_CROSSEDOUT: boolean;
  ATTR_FONT_CONTOUR: boolean;
  ATTR_FONT_SHADOWED: boolean;
  /** null: automatic (COL_AUTO) */
  ATTR_FONT_COLOR: string | null;
  /** BCP 47 tag; '' for LANGUAGE_DONTKNOW */
  ATTR_FONT_LANGUAGE: string;
  ATTR_FONT_WORDLINE: boolean;
  ATTR_HOR_JUSTIFY: SvxCellHorJustify;
  ATTR_HOR_JUSTIFY_METHOD: SvxCellJustifyMethod;
  /** twips */
  ATTR_INDENT: number;
  ATTR_VER_JUSTIFY: SvxCellVerJustify;
  ATTR_VER_JUSTIFY_METHOD: SvxCellJustifyMethod;
  ATTR_STACKED: boolean;
  /** 1/100 degree */
  ATTR_ROTATE_VALUE: number;
  ATTR_ROTATE_MODE: SvxRotateMode;
  ATTR_VERTICAL_ASIAN: boolean;
  ATTR_WRITINGDIR: SvxFrameDirection;
  /** wrap text automatically */
  ATTR_LINEBREAK: boolean;
  ATTR_SHRINKTOFIT: boolean;
  ATTR_BORDER_TLBR: SvxBorderLine | null;
  ATTR_BORDER_BLTR: SvxBorderLine | null;
  ATTR_MARGIN: SvxMarginItem;
  ATTR_MERGE: ScMergeAttr;
  ATTR_MERGE_FLAG: ScMF;
  /** The number format code ('General' for the standard format). */
  ATTR_VALUE_FORMAT: string;
  /** BCP 47 tag of the number format's language */
  ATTR_LANGUAGE_FORMAT: string;
  /** null: transparent (COL_TRANSPARENT) */
  ATTR_BACKGROUND: string | null;
  ATTR_PROTECTION: ScProtectionAttr;
  ATTR_BORDER: SvxBoxItem;
  ATTR_HYPERLINK: string;
}

export type ScItemId = keyof ScItems;
export type ScItemSet = Partial<ScItems>;

/** The pool defaults (ScDocumentPool's item infos; the default font is the
    LATIN_SPREADSHEET default font, Liberation Sans). */
export const SC_POOL_DEFAULTS: Readonly<ScItems> = Object.freeze({
  ATTR_FONT: 'Liberation Sans',
  ATTR_FONT_HEIGHT: 200,
  ATTR_FONT_WEIGHT: false,
  ATTR_FONT_POSTURE: false,
  ATTR_FONT_UNDERLINE: 'none',
  ATTR_FONT_OVERLINE: 'none',
  ATTR_FONT_CROSSEDOUT: false,
  ATTR_FONT_CONTOUR: false,
  ATTR_FONT_SHADOWED: false,
  ATTR_FONT_COLOR: null,
  ATTR_FONT_LANGUAGE: '',
  ATTR_FONT_WORDLINE: false,
  ATTR_HOR_JUSTIFY: 'Standard',
  ATTR_HOR_JUSTIFY_METHOD: 'Auto',
  ATTR_INDENT: 0,
  ATTR_VER_JUSTIFY: 'Standard',
  ATTR_VER_JUSTIFY_METHOD: 'Auto',
  ATTR_STACKED: false,
  ATTR_ROTATE_VALUE: 0,
  ATTR_ROTATE_MODE: 'BOTTOM',
  ATTR_VERTICAL_ASIAN: false,
  ATTR_WRITINGDIR: 'Environment',
  ATTR_LINEBREAK: false,
  ATTR_SHRINKTOFIT: false,
  ATTR_BORDER_TLBR: null,
  ATTR_BORDER_BLTR: null,
  ATTR_MARGIN: Object.freeze({ left: 20, top: 20, right: 20, bottom: 20 }),
  ATTR_MERGE: Object.freeze({ nColMerge: 0, nRowMerge: 0 }),
  ATTR_MERGE_FLAG: ScMF.NONE,
  ATTR_VALUE_FORMAT: 'General',
  ATTR_LANGUAGE_FORMAT: 'en-US',
  ATTR_BACKGROUND: null,
  ATTR_PROTECTION: Object.freeze({ bProtection: true, bHideFormula: false, bHideCell: false, bHidePrint: false }),
  ATTR_BORDER: Object.freeze({ top: null, bottom: null, left: null, right: null }),
  ATTR_HYPERLINK: '',
});

export const SC_ITEM_IDS = Object.keys(SC_POOL_DEFAULTS) as ScItemId[];

/** Item equality by value (SfxPoolItem::operator==). */
export function ItemEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** ScMergeAttr::IsMerged */
export const IsMerged = (r: ScMergeAttr): boolean => r.nColMerge > 1 || r.nRowMerge > 1;
