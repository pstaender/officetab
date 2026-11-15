// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/scitems.hxx reduced
// @upstream sc/source/core/data/docpool.cxx reduced
// @upstream sc/inc/attrib.hxx reduced
// The cell attribute items Calc's patterns and cell styles hold, keyed by their ATTR_ names, with
// plain values instead of SfxPoolItems, and their pool defaults (ScDocumentPool). Kept: the font
// (name, height in twips, weight, posture, underline, overline, strikeout, contour, shadow, colour,
// language), alignment (horizontal/vertical justification, indent, rotation, stacked, wrap,
// shrink to fit, writing direction), borders, diagonal lines, margins, background, number format,
// protection, merge, hyperlink, and the page style items (ATTR_LRSPACE to ATTR_PAGE_SCALETO) with
// the user defaults ScStyleSheet::GetItemSet gives a page style. The CJK/CTL font items, emphasis
// marks, relief, hyphenation, the paper bin and the page shadow are left out. ATTR_VALUE_FORMAT
// holds the format code (as the svl port of this project identifies formats by code) instead of a
// number formatter key. The header and footer sets (SvxSetItem) are one plain object
// (ScPageHFSetItem) rather than nested item sets.
import type { EditTextObject } from '../../editeng/source/editeng/editobj.ts';
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

/** SvxPageItem: orientation, page usage (SvxPageUsage) and the numbering of page numbers
    (SvxNumType as the ODF style:num-format, '1' for arabic). */
export interface SvxPageItem { bLandscape: boolean; eUse: 'All' | 'Left' | 'Right' | 'Mirror'; eNumType: string }
/** SvxSizeItem, twips. */
export interface SvxSizeItem { nWidth: number; nHeight: number }
/** SvxLRSpaceItem of a page, twips. */
export interface SvxLRSpaceItem { nLeft: number; nRight: number }
/** SvxULSpaceItem of a page, twips. */
export interface SvxULSpaceItem { nUpper: number; nLower: number }
/** ScPageHFItem: the left, centre and right areas of a header or footer (null: empty). */
export interface ScPageHFItem { pLeftArea: EditTextObject | null; pCenterArea: EditTextObject | null; pRightArea: EditTextObject | null }
/**
 * The header or footer set (ATTR_PAGE_HEADERSET / ATTR_PAGE_FOOTERSET, an SvxSetItem of
 * ATTR_PAGE_ON, ATTR_PAGE_DYNAMIC, ATTR_PAGE_SHARED, ATTR_PAGE_SHARED_FIRST, ATTR_PAGE_SIZE,
 * ATTR_LRSPACE, ATTR_ULSPACE, ATTR_BACKGROUND and ATTR_BORDER). Twips. nUpper and nLower are the
 * ULSpace: a header's distance to the body is nLower, a footer's nUpper.
 */
export interface ScPageHFSetItem {
  bOn: boolean; bDynamic: boolean; bShared: boolean; bSharedFirst: boolean;
  nHeight: number; nLeft: number; nRight: number; nUpper: number; nLower: number;
  aBackground: string | null; aBorder: SvxBoxItem;
}
/** ScPageScaleToItem: scale to so many pages wide and high (0: not set). */
export interface ScPageScaleToItem { nWidth: number; nHeight: number }
/** ScVObjMode */
export type ScVObjMode = 'Show' | 'Hide';

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
  /** The key of the cell's validity (ScValidationDataList), 0 for none. */
  ATTR_VALIDDATA: number;
  /** The keys of the conditional formats of the cell (ScCondFormatItem). */
  ATTR_CONDITIONAL: readonly number[];
  // page attributes
  ATTR_LRSPACE: SvxLRSpaceItem;
  ATTR_ULSPACE: SvxULSpaceItem;
  ATTR_PAGE: SvxPageItem;
  ATTR_PAGE_SIZE: SvxSizeItem;
  ATTR_PAGE_HORCENTER: boolean;
  ATTR_PAGE_VERCENTER: boolean;
  ATTR_PAGE_NOTES: boolean;
  ATTR_PAGE_GRID: boolean;
  ATTR_PAGE_HEADERS: boolean;
  ATTR_PAGE_CHARTS: ScVObjMode;
  ATTR_PAGE_OBJECTS: ScVObjMode;
  ATTR_PAGE_DRAWINGS: ScVObjMode;
  ATTR_PAGE_TOPDOWN: boolean;
  /** percent */
  ATTR_PAGE_SCALE: number;
  /** fit the print ranges on so many pages (0: not set) */
  ATTR_PAGE_SCALETOPAGES: number;
  /** 0: continue the numbering of the previous sheet */
  ATTR_PAGE_FIRSTPAGENO: number;
  ATTR_PAGE_HEADERLEFT: ScPageHFItem;
  ATTR_PAGE_FOOTERLEFT: ScPageHFItem;
  ATTR_PAGE_HEADERRIGHT: ScPageHFItem;
  ATTR_PAGE_FOOTERRIGHT: ScPageHFItem;
  ATTR_PAGE_HEADERFIRST: ScPageHFItem;
  ATTR_PAGE_FOOTERFIRST: ScPageHFItem;
  ATTR_PAGE_HEADERSET: ScPageHFSetItem;
  ATTR_PAGE_FOOTERSET: ScPageHFSetItem;
  ATTR_PAGE_FORMULAS: boolean;
  ATTR_PAGE_NULLVALS: boolean;
  ATTR_PAGE_SCALETO: ScPageScaleToItem;
}

export type ScItemId = keyof ScItems;
export type ScItemSet = Partial<ScItems>;

/** The pool defaults (ScDocumentPool's item infos; the default font is the
    LATIN_SPREADSHEET default font, Liberation Sans). */
const TWO_CM = 1134;
const HFDIST_CM = 142;
const NO_BORDER: SvxBoxItem = Object.freeze({ top: null, bottom: null, left: null, right: null });
const EMPTY_HF: ScPageHFItem = Object.freeze({ pLeftArea: null, pCenterArea: null, pRightArea: null });
/** The header and footer set a page style gets (ScStyleSheet::GetItemSet): 0.5 cm plus the
    distance high, the distance 0.25 cm, no margins. */
const HF_SET: ScPageHFSetItem = Object.freeze({
  bOn: true, bDynamic: true, bShared: true, bSharedFirst: true,
  nHeight: 283 + HFDIST_CM, nLeft: 0, nRight: 0, nUpper: HFDIST_CM, nLower: HFDIST_CM, aBackground: null, aBorder: NO_BORDER,
});

/** The page items' defaults: the pool's, with the user defaults ScStyleSheet::GetItemSet sets
    (2 cm margins, the default paper size A4 portrait, scale 100 %, no fitting to pages). */
const SC_PAGE_DEFAULTS = {
  ATTR_LRSPACE: Object.freeze({ nLeft: TWO_CM, nRight: TWO_CM }),
  ATTR_ULSPACE: Object.freeze({ nUpper: TWO_CM, nLower: TWO_CM }),
  ATTR_PAGE: Object.freeze({ bLandscape: false, eUse: 'All' as const, eNumType: '1' }),
  ATTR_PAGE_SIZE: Object.freeze({ nWidth: 11906, nHeight: 16838 }),
  ATTR_PAGE_HORCENTER: false,
  ATTR_PAGE_VERCENTER: false,
  ATTR_PAGE_NOTES: false,
  ATTR_PAGE_GRID: false,
  ATTR_PAGE_HEADERS: false,
  ATTR_PAGE_CHARTS: 'Show' as const,
  ATTR_PAGE_OBJECTS: 'Show' as const,
  ATTR_PAGE_DRAWINGS: 'Show' as const,
  ATTR_PAGE_TOPDOWN: true,
  ATTR_PAGE_SCALE: 100,
  ATTR_PAGE_SCALETOPAGES: 0,
  ATTR_PAGE_FIRSTPAGENO: 1,
  ATTR_PAGE_HEADERLEFT: EMPTY_HF,
  ATTR_PAGE_FOOTERLEFT: EMPTY_HF,
  ATTR_PAGE_HEADERRIGHT: EMPTY_HF,
  ATTR_PAGE_FOOTERRIGHT: EMPTY_HF,
  ATTR_PAGE_HEADERFIRST: EMPTY_HF,
  ATTR_PAGE_FOOTERFIRST: EMPTY_HF,
  ATTR_PAGE_HEADERSET: HF_SET,
  ATTR_PAGE_FOOTERSET: HF_SET,
  ATTR_PAGE_FORMULAS: false,
  ATTR_PAGE_NULLVALS: true,
  ATTR_PAGE_SCALETO: Object.freeze({ nWidth: 0, nHeight: 0 }),
};

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
  ATTR_VALIDDATA: 0,
  ATTR_CONDITIONAL: Object.freeze([]) as readonly number[],
  ...SC_PAGE_DEFAULTS,
});

/** The page style items (ATTR_LRSPACE to ATTR_PAGE_SCALETO). */
export const SC_PAGE_ITEM_IDS = Object.keys(SC_PAGE_DEFAULTS) as ScItemId[];
/** The cell attribute items (ATTR_PATTERN_START to ATTR_PATTERN_END). */
export const SC_ITEM_IDS = (Object.keys(SC_POOL_DEFAULTS) as ScItemId[]).filter((k) => !(k in SC_PAGE_DEFAULTS));

/** Item equality by value (SfxPoolItem::operator==). */
export function ItemEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** ScMergeAttr::IsMerged */
export const IsMerged = (r: ScMergeAttr): boolean => r.nColMerge > 1 || r.nRowMerge > 1;
