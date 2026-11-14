// SPDX-License-Identifier: MPL-2.0
// @upstream sw/inc/hintids.hxx reduced
// Upstream's integer which-ids become typed keys of one attribute record.
import type { GraphicAttr } from '../../drawinglayer/source/primitive2d/graphicprimitivehelper2d.ts';
import type { SdrShape } from './frmfmt.ts';
import type { SwCharFormat } from './format.ts';

export type FontLineStyle = 'none' | 'single' | 'double' | 'dotted' | 'dash' | 'wave';
export type SvxCaseMap = 'none' | 'uppercase' | 'lowercase' | 'capitalize' | 'smallcaps';
export type SvxAdjust = 'left' | 'right' | 'center' | 'block';
export type SvxBreak = 'none' | 'page-before' | 'page-after' | 'column-before';

/** Placeholder character of text attributes with content, such as fields (CH_TXTATR_BREAKWORD). */
export const CH_TXTATR_BREAKWORD = '\u0001';

/**
 * SwFormatField, reduced to the field types Writer's Insert > Field menu offers without a dialog.
 * Fixed fields keep the text they were created with.
 */
export interface SwField {
  /**
   * DocInfo: SwDocInfoField, a document property (SwDocInfoSubType in `subType`, a custom
   * property's name in `name`; a fixed one keeps its text in `fixed`). DocStat: SwDocStatField,
   * a statistic other than the page count (SwDocStatSubType in `subType`, its numbering in `numType`).
   * SetExp: SwSetExpField, setting the variable `name` to `formula` (`subType`: the field's
   * SwGetSetExpType Command and Invisible; whether it is a string or an expression is its type's,
   * SwDoc.m_aSetExpFieldTypes); with `input`, an input field for the variable asking `prompt`.
   * GetExp: SwGetExpField, showing the variable `formula`, or with SwGetSetExpType.Formula the
   * result of the formula `formula` (`subType`: its full SwGetSetExpType). User: SwUserField of the
   * user field `name` (SwDoc.m_aUserFieldTypes; `subType`: SwUserType ShowCommand and Invisible).
   * Input: SwInputField (`subType`: SwInputFieldSubType Text or User), showing `content`, or for
   * User the content of the user field `content`, and asking `prompt`. RefPageSet: SwRefPageSetField
   * (`subType` 1 when on, its `offset`). RefPageGet: SwRefPageGetField (its numbering in `numType`).
   */
  type: 'PageNumber' | 'PageCount' | 'Date' | 'Time' | 'Sequence' | 'Fieldmark' | 'GetRef' | 'DocInfo' | 'DocStat'
    | 'SetExp' | 'GetExp' | 'User' | 'Input' | 'RefPageSet' | 'RefPageGet';
  fixed?: string;
  /**
   * Sequence: SwSetExpField of a number range (nsSwGetSetExpType::GST_SEQ), its type's name (Table,
   * Figure, …). GetRef: SwGetRefField::m_sSetRefName, the reference mark, bookmark or number range
   * referred to; for a footnote or endnote, its id.
   */
  name?: string;
  /** GetRef: SwGetRefField::m_nSubType, a ReferencesSubtype. DocInfo, DocStat: the field's sub type. */
  subType?: number;
  /** GetRef: the field's RefFieldFormat. */
  format?: number;
  /**
   * Sequence: SwSetExpField::GetSeqNumber, the number references find the field by (unique per
   * name). GetRef: SwGetRefField::m_nSeqNo, that of the number range field referred to.
   */
  seqNo?: number;
  /**
   * Sequence: the numbering type (SVX_NUM_ARABIC unless set). PageNumber, PageCount: unset is
   * SVX_NUM_PAGEDESC, the numbering of the page's style. DocStat: as PageCount.
   */
  numType?: number;
  /**
   * SetExp, GetExp: SwFormulaField::m_sFormula, the variable's value or formula, or the variable
   * shown. Sequence: its formula (the default is its name +1).
   */
  formula?: string;
  /**
   * SetExp, GetExp, User: the number format's code (SvNumberFormatter key upstream; unset is
   * General). Unused for string variables.
   */
  numFormat?: string;
  /** SetExp: SwSetExpField::mbInput, an input field of the variable. */
  input?: boolean;
  /** SetExp of an input field, Input: the prompt (SwSetExpField::maPText, SwInputField::maPText). */
  prompt?: string;
  /** RefPageSet: SwRefPageSetField::m_nOffset. */
  offset?: number;
  /** Fieldmark: the form field's type (ODF_FORMTEXT, ODF_FORMCHECKBOX, ODF_FORMDROPDOWN). */
  fieldType?: string;
  /** Fieldmark: its parameters (Fieldmark::parameter_map_t): strings, a list's entries, numbers, flags. */
  params?: Record<string, string | string[] | number | boolean>;
  /**
   * Fieldmark of ODF_FORMTEXT: the text between its separator and end. DocInfo of a custom
   * property: the text it showed when imported (SwDocInfoField::m_aContent). Input: its content
   * (SwInputField::maContent), for a user field's input field the user field's name.
   */
  content?: string;
}

/** xmloff/odffields.hxx */
export const ODF_FORMTEXT = 'vnd.oasis.opendocument.field.FORMTEXT';
export const ODF_FORMFIELD_DEFAULT_LENGTH = 5;
export const ODF_FORMCHECKBOX = 'vnd.oasis.opendocument.field.FORMCHECKBOX';
export const ODF_FORMCHECKBOX_HELPTEXT = 'Checkbox_HelpText';
export const ODF_FORMCHECKBOX_RESULT = 'Checkbox_Checked';
export const ODF_FORMDROPDOWN = 'vnd.oasis.opendocument.field.FORMDROPDOWN';
export const ODF_FORMDROPDOWN_LISTENTRY = 'Dropdown_ListEntry';
export const ODF_FORMDROPDOWN_RESULT = 'Dropdown_Selected';
/** vEnSpaces: what an empty form field shows (ODF_FORMFIELD_DEFAULT_LENGTH en spaces). */
export const vEnSpaces = '\u2002'.repeat(ODF_FORMFIELD_DEFAULT_LENGTH);

/**
 * sw::mark::ExpandFieldmark: a check box's box, a drop-down's selected entry. A text form field
 * (reduced here to one placeholder like the others, not text editable in place) shows its content.
 */
export function ExpandFieldmark(f: SwField): string {
  if (f.fieldType === ODF_FORMTEXT) return f.content || vEnSpaces;
  if (f.fieldType === ODF_FORMCHECKBOX) return f.params?.[ODF_FORMCHECKBOX_RESULT] === true ? '\u2612' : '\u2610';
  const nCurrentIdx = typeof f.params?.[ODF_FORMDROPDOWN_RESULT] === 'number' ? f.params[ODF_FORMDROPDOWN_RESULT] : 0;
  const vListEntries = f.params?.[ODF_FORMDROPDOWN_LISTENTRY];
  if (Array.isArray(vListEntries) && nCurrentIdx < vListEntries.length) return vListEntries[nCurrentIdx]!;
  return vEnSpaces;
}

/**
 * SwFormatFlyCnt for an as-character anchored graphic, reduced: the graphic is referenced by its
 * key in SwDoc's graphic store instead of living in a fly frame's own SwGrfNode section.
 */
/**
 * SwCropGrf (RES_GRFATR_CROPGRF): the part of the graphic cut off at each side. Upstream keeps
 * lengths relative to the graphic's preferred size; here they are fractions of the graphic, so no
 * graphic needs decoding to lay out (negative values add empty space).
 */
export interface SwCropGrf { left: number; top: number; right: number; bottom: number }
/**
 * The colour attributes of a graphic (grfatr.hxx): RES_GRFATR_LUMINANCE, CONTRAST, CHANNELR/G/B
 * (percent, -100 to 100), GAMMA (0.1 to 10), INVERT, TRANSPARENCY (percent) and DRAWMODE, as
 * vcl's GraphicAttr. A missing member has its default (0, gamma 1, not inverted, Standard).
 */
export type SwGrfAttr = GraphicAttr;
/** The attributes without their defaults, or undefined when all are default. */
export function NormalizeGrfAttr(a: SwGrfAttr | undefined): SwGrfAttr | undefined {
  if (!a) return undefined;
  const out: SwGrfAttr = {};
  for (const k of ['m_nLuminance', 'm_nContrast', 'm_nChannelR', 'm_nChannelG', 'm_nChannelB', 'm_nTransparency'] as const) if (a[k]) out[k] = a[k];
  if (a.m_fGamma !== undefined && a.m_fGamma !== 1) out.m_fGamma = a.m_fGamma;
  if (a.m_bInvert) out.m_bInvert = true;
  if (a.m_eDrawMode) out.m_eDrawMode = a.m_eDrawMode;
  return Object.keys(out).length ? out : undefined;
}
/** SwFormatFlyCnt: an as-character graphic, or a drawing shape in the line (`shape`, no graphic). */
export interface SwFlyCnt {
  graphic: string; width: number; height: number; name: string; alt?: string; crop?: SwCropGrf; shape?: SdrShape;
  /** The Alt Text dialog's title (SdrObject::GetTitle). */
  title?: string;
  /** SwRotationGrf in 1/10 degree, counterclockwise: the line holds the rotated graphic's bounds. */
  rotation?: number;
  /** SwMirrorGrf: 'vertical' mirrors left and right, 'horizontal' top and bottom. */
  mirror?: 'vertical' | 'horizontal' | 'both';
  /** The graphic's colour attributes. */
  m_aGrfAttr?: SwGrfAttr;
  /** An embedded formula (SwOLENode with a Math object): no graphic; layout takes its size. */
  math?: SwMathObj;
  /**
   * Layout only: the formula's baseline below its top when it is aligned to the line's baseline
   * (SwFEShell::AlignFormulaToBaseline); otherwise the object stands on the baseline.
   */
  m_nAscent?: number;
}

/**
 * The Math object of an embedded formula (SmDocShell): its StarMath text, and the base font
 * height in twips when it is not the default 12 pt. Its size follows from arranging the text.
 */
export interface SwMathObj {
  m_sText: string;
  m_nBaseFontHeight?: number;
  /** AlignFormulaToBaseline: VertOrientation NONE at minus the baseline. */
  m_bBaseline?: boolean;
  /** Otherwise VertOrientation CENTER (the object's centre on the baseline) instead of TOP. */
  m_eVertOrient?: 'center';
}

/** SvxTabStop: position relative to the paragraph indent (TABS_RELATIVE_TO_INDENT). */
export interface SvxTabStop { pos: number; adjust: 'left' | 'right' | 'center' | 'decimal'; fill: string; decimal: string }

/** SwFormatFootnote: refers to the footnote's section by id; m_bEndNote for endnotes. */
export interface SwFormatFootnote { id: string; endnote?: boolean }

/**
 * SwPostItField, reduced: the comment's text is plain paragraphs separated by newlines instead of
 * an OutlinerParaObject. A comment on a range also marks that text with RES_TXTATR_ANNOTMARK.
 */
export interface SwPostItField { id: string; author: string; date: string; text: string; resolved: boolean }

/**
 * SwRedlineData, reduced: the type, author and time of a tracked change (no stacked changes, no
 * comment, and formatting changes are not recorded). Text in a change carries it as
 * RES_TXTATR_REDLINE; a paragraph whose end mark is inserted or deleted as RES_PARATR_REDLINE.
 */
export interface SwRedlineData { type: 'Insert' | 'Delete'; author: string; date: string }

/** SwFormatPageDesc: the paragraph starts a page of this style, optionally renumbering pages. */
export interface SwFormatPageDesc { name: string; numOffset: number | null }

/** editeng's SvxBorderLine, reduced to a solid line: width in twips. */
export interface SvxBorderLine { color: string; width: number }
/** SvxBoxItem of a paragraph: four lines and the distance to the text (only beside a line). */
export interface SvxParaBox { top: SvxBorderLine | null; bottom: SvxBorderLine | null; left: SvxBorderLine | null; right: SvxBorderLine | null; padding: number }

export interface SvxLRSpace { left: number; right: number; firstLine: number }
/** SvxULSpaceItem; `context` is m_bContext ("Don't add space between paragraphs of the same style"). */
export interface SvxULSpace { upper: number; lower: number; context?: boolean }
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
  /** SvxCaseMapItem: SvxCaseMap NotMapped, Uppercase, Lowercase, Capitalize (title) and SmallCaps. */
  RES_CHRATR_CASEMAP: SvxCaseMap;
  /** SvxOverlineItem. */
  RES_CHRATR_OVERLINE: FontLineStyle;
  /** SvxShadowedItem: the text with a shadow. */
  RES_CHRATR_SHADOWED: boolean;
  /** SvxContourItem: outline font effect. */
  RES_CHRATR_CONTOUR: boolean;
  /** SvxLanguageItem as a BCP 47 tag; "zxx" for no language (not proofread). */
  RES_CHRATR_LANGUAGE: string;
  /** SvxBoxItem of characters (RES_CHRATR_BOX), reduced to one line around the text; null for none. */
  RES_CHRATR_BOX: SvxBorderLine | null;
  /** SwFormatINetFormat: the hyperlink URL, or null (RES_TXTATR_INETFMT). */
  RES_TXTATR_INETFMT: string | null;
  /**
   * SwFormatINetFormat::msINetFormatName and msVisitedFormatName: the character style the link
   * shows in, as in an index ("Index Link"); null for the "Internet Link" style.
   */
  RES_TXTATR_INETFMT_CHARFMT: SwCharFormat | null;
  /** On the placeholder character of a field (RES_TXTATR_FIELD). */
  RES_TXTATR_FIELD: SwField | null;
  /** On the placeholder character of an as-character graphic (RES_TXTATR_FLYCNT). */
  RES_TXTATR_FLYCNT: SwFlyCnt | null;
  /** On the placeholder character of a footnote anchor (RES_TXTATR_FTN). */
  RES_TXTATR_FTN: SwFormatFootnote | null;
  /** The character style of the text (SwFormatCharFormat, RES_TXTATR_CHARFMT). */
  RES_TXTATR_CHARFMT: SwCharFormat | null;
  /** On the placeholder character of a comment anchor (RES_TXTATR_ANNOTATION). */
  RES_TXTATR_ANNOTATION: SwPostItField | null;
  /** The id of the comment whose range this text is (sw::mark::AnnotationMark). */
  RES_TXTATR_ANNOTMARK: string | null;
  /** The tracked change this text belongs to (an SwRangeRedline over it). */
  RES_TXTATR_REDLINE: SwRedlineData | null;
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
  /** The index (table of contents) a generated paragraph belongs to; '' for none (SwTOXBaseSection). */
  RES_PARATR_TOX_ID: string;
  /** Paragraph borders (RES_BOX). */
  RES_BOX: SvxParaBox | null;
  /** Merge borders with the next paragraph when they are equal (RES_PARATR_CONNECT_BORDER). */
  RES_PARATR_CONNECT_BORDER: boolean;
  /** SvxTabStopItem, sorted by position; default tab stops follow the last one. */
  RES_PARATR_TABSTOP: SvxTabStop[];
  /** Name of the SwNumRule; '' for none (RES_PARATR_NUMRULE). */
  RES_PARATR_NUMRULE: string;
  /** SwList id; paragraphs of one list share their counters (RES_PARATR_LIST_ID). */
  RES_PARATR_LIST_ID: string;
  RES_PARATR_LIST_LEVEL: number;
  RES_PARATR_LIST_ISRESTART: boolean;
  /** Restart value; -1 restarts at the level's start value (RES_PARATR_LIST_RESTARTVALUE). */
  RES_PARATR_LIST_RESTARTVALUE: number;
  RES_PARATR_LIST_ISCOUNTED: boolean;
  /** SvxFrameDirectionItem: left to right or right to left text (RES_FRAMEDIR). */
  RES_FRAMEDIR: 'lr-tb' | 'rl-tb';
  /** A page break with a page style (RES_PAGEDESC). */
  RES_PAGEDESC: SwFormatPageDesc | null;
  /** The tracked change of the paragraph's end mark: an inserted or deleted paragraph break. */
  RES_PARATR_REDLINE: SwRedlineData | null;
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
  RES_CHRATR_OVERLINE: 'none',
  RES_CHRATR_SHADOWED: false,
  RES_CHRATR_CONTOUR: false,
  RES_CHRATR_LANGUAGE: 'en-US',
  RES_CHRATR_BOX: null,
  RES_TXTATR_INETFMT: null,
  RES_TXTATR_INETFMT_CHARFMT: null,
  RES_TXTATR_FIELD: null,
  RES_TXTATR_FLYCNT: null,
  RES_TXTATR_FTN: null,
  RES_TXTATR_ANNOTATION: null,
  RES_TXTATR_CHARFMT: null,
  RES_TXTATR_ANNOTMARK: null,
  RES_TXTATR_REDLINE: null,
  RES_PARATR_ADJUST: 'left',
  RES_PARATR_LINESPACING: { rule: 'proportional', value: 100 },
  RES_PARATR_WIDOWS: 2,
  RES_PARATR_ORPHANS: 2,
  RES_LR_SPACE: { left: 0, right: 0, firstLine: 0 },
  RES_UL_SPACE: { upper: 0, lower: 0 },
  RES_KEEP: false,
  RES_BREAK: 'none',
  RES_BACKGROUND: null,
  RES_BOX: null,
  RES_PARATR_TOX_ID: '',
  RES_PARATR_CONNECT_BORDER: true,
  RES_PARATR_TABSTOP: [],
  RES_PARATR_NUMRULE: '',
  RES_PARATR_LIST_ID: '',
  RES_PARATR_LIST_LEVEL: 0,
  RES_PARATR_LIST_ISRESTART: false,
  RES_PARATR_LIST_RESTARTVALUE: -1,
  RES_PARATR_LIST_ISCOUNTED: true,
  RES_PARATR_REDLINE: null,
  RES_PAGEDESC: null,
  RES_FRAMEDIR: 'lr-tb',
};

export const LIST_KEYS = ['RES_PARATR_NUMRULE', 'RES_PARATR_LIST_ID', 'RES_PARATR_LIST_LEVEL', 'RES_PARATR_LIST_ISRESTART', 'RES_PARATR_LIST_RESTARTVALUE', 'RES_PARATR_LIST_ISCOUNTED'] as const;

/** Paragraph attributes that belong to the paragraph itself, not its formatting: styles keep them. */
export const PARA_OWN_KEYS = [...LIST_KEYS, 'RES_PARATR_REDLINE', 'RES_PAGEDESC', 'RES_BREAK'] as const;

/**
 * The paragraph attributes the styles spotlight does not count as direct formatting (the hidden
 * properties of SwDoc::HasParagraphDirectFormatting: NumberingLevel, NumberingIsNumber,
 * ParaIsNumberingRestart, NumberingStartValue), plus the tracked change of the paragraph mark.
 */
export const PARA_HIDDEN_PROPERTIES = new Set<string>(['RES_PARATR_LIST_LEVEL', 'RES_PARATR_LIST_ISCOUNTED', 'RES_PARATR_LIST_ISRESTART', 'RES_PARATR_LIST_RESTARTVALUE', 'RES_PARATR_REDLINE']);

export const CHAR_KEYS = new Set<string>(Object.keys(POOL_DEFAULTS).filter((k) => k.startsWith('RES_CHRATR_') || k.startsWith('RES_TXTATR_')));
