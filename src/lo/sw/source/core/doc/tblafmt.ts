// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/core/doc/tblafmt.cxx reduced
// @upstream svx/source/items/autoformathelper.cxx reduced
// @upstream editeng/source/items/legacyitem.cxx reduced
// @upstream svx/source/items/legacyitem.cxx reduced
// @upstream sw/source/core/layout/legacyitem.cxx reduced
// Table AutoFormat styles: the 16 box formats of a style (first, odd, even and last rows by first,
// odd, even and last columns), read from LibreOffice's autotbl.fmt (SwTableAutoFormatTable's
// Load, with the legacy item readers), and the built-in Default Table Style. Of the items, what the
// model has is kept: the Western font, height, weight and posture, underline, overline, strike
// through, contour, shadow, colour, borders, background, paragraph alignment and the vertical
// alignment; the CJK and CTL fonts, diagonal lines, Calc's cell justification, orientation and
// margins, text direction and the shadow are read and dropped. Number formats are kept as their
// format string (number formats are not ported). A brush with a graphic is not supported.
import { SvStream } from '../../../../tools/source/stream/stream.ts';
import type { FontLineStyle, SvxAdjust, SvxBorderLine } from '../../../inc/hintids.ts';

const AUTOFORMAT_ID_X = 9501, AUTOFORMAT_ID_358 = 9601, AUTOFORMAT_DATA_ID_X = 9502;
const AUTOFORMAT_ID_504 = 9801, AUTOFORMAT_DATA_ID_504 = 9802, AUTOFORMAT_DATA_ID_552 = 9902;
const AUTOFORMAT_ID_680DR25 = 10021, AUTOFORMAT_ID_31005 = 10041, AUTOFORMAT_DATA_ID_31005 = 10042;
const AUTOFORMAT_ID = AUTOFORMAT_ID_31005, AUTOFORMAT_DATA_ID = AUTOFORMAT_DATA_ID_31005;
const AUTOFORMAT_ID_300OVRLN = 10031, AUTOFORMAT_ID_680DR14 = 10011;
const AUTOFORMAT_DATA_ID_641 = 10002, AUTOFORMAT_DATA_ID_300OVRLN = 10032, AUTOFORMAT_DATA_ID_680DR14 = 10012;
const FONTHEIGHT_16_VERSION = 1, FONTHEIGHT_UNIT_VERSION = 2, BOX_4DISTS_VERSION = 1, BOX_BORDER_STYLE_VERSION = 2;
const BRUSH_GRAPHIC_VERSION = 1, ADJUST_LASTBLOCK_VERSION = 1, FMTBREAK_NOAUTO = 1;

/** SwAutoFormatProps, reduced to what Writer's model takes. */
export interface SwAutoFormatProps {
  font: string; height: number; weight: boolean; posture: boolean;
  underline: FontLineStyle; overline: FontLineStyle; crossedOut: boolean; contour: boolean; shadowed: boolean; color: string | null;
  box: { top: SvxBorderLine | null; left: SvxBorderLine | null; right: SvxBorderLine | null; bottom: SvxBorderLine | null };
  /** SvxBoxItem's distances (left, top, right, bottom). */
  dist: [number, number, number, number];
  background: string | null;
  adjust: SvxAdjust;
  vertOrient: 'top' | 'center' | 'bottom' | null;
  numFormat: string;
}

export interface SwTableAutoFormat {
  m_aName: string;
  m_bInclFont: boolean; m_bInclJustify: boolean; m_bInclFrame: boolean; m_bInclBackground: boolean; m_bInclValueFormat: boolean; m_bInclWidthHeight: boolean;
  m_aRepeatHeading: number; m_bLayoutSplit: boolean; m_bRowSplit: boolean; m_bKeepWithNextPara: boolean;
  /** The 16 box formats. */
  m_aBoxAutoFormat: SwAutoFormatProps[];
}

/** SwAutoFormatProps::SwAutoFormatProps: the pool defaults, 12 pt, distances 55. */
export function DefaultAutoFormatProps(defaultFont: string): SwAutoFormatProps {
  return {
    font: defaultFont, height: 240, weight: false, posture: false, underline: 'none', overline: 'none', crossedOut: false, contour: false, shadowed: false, color: null,
    box: { top: null, left: null, right: null, bottom: null }, dist: [55, 55, 55, 55], background: null, adjust: 'left', vertOrient: null, numFormat: '',
  };
}

const newFormat = (name: string, defaultFont: string): SwTableAutoFormat => ({
  m_aName: name, m_bInclFont: true, m_bInclJustify: true, m_bInclFrame: true, m_bInclBackground: true, m_bInclValueFormat: true, m_bInclWidthHeight: true,
  m_aRepeatHeading: 0, m_bLayoutSplit: true, m_bRowSplit: true, m_bKeepWithNextPara: false,
  m_aBoxAutoFormat: Array.from({ length: 16 }, () => DefaultAutoFormatProps(defaultFont)),
});

/** SwTableAutoFormatTable::Impl::Impl: the Default Table Style, very thin black lines. */
export function DefaultTableStyle(defaultFont: string, name = 'Default Table Style'): SwTableAutoFormat {
  const pNew = newFormat(name, defaultFont);
  const aLn: SvxBorderLine = { color: '#000000', width: 10 }; // SvxBorderLineWidth::VeryThin
  for (let i = 0; i <= 15; ++i) {
    const p = pNew.m_aBoxAutoFormat[i]!;
    p.box = { left: { ...aLn }, bottom: { ...aLn }, top: i <= 3 ? { ...aLn } : null, right: (i & 3) === 3 ? { ...aLn } : null };
  }
  return pNew;
}

/** RES_POOLTABLESTYLE_3D …: the UI names of the built-in styles, by their m_nStrResId. */
const POOL_TABLESTYLE_NAMES = [
  '3D', 'Black 1', 'Black 2', 'Blue', 'Brown', 'Currency', 'Currency 3D', 'Currency Gray', 'Currency Lavender', 'Currency Turquoise',
  'Gray', 'Green', 'Lavender', 'Red', 'Turquoise', 'Yellow',
  'Academic', 'Box List Blue', 'Box List Green', 'Box List Red', 'Box List Yellow', 'Elegant', 'Financial', 'Simple Grid Columns', 'Simple Grid Rows',
  'Simple List Shaded',
];

const LINESTYLE: FontLineStyle[] = ['none', 'single', 'double', 'dotted', 'none', 'dash'];
const toLineStyle = (n: number): FontLineStyle => (n >= 10 && n <= 12 ? 'wave' : LINESTYLE[n] ?? (n ? 'single' : 'none'));
const ADJUST: SvxAdjust[] = ['left', 'right', 'block', 'center', 'block', 'left'];

interface SwAfVersions {
  nFontVersion: number; nFontHeightVersion: number; nWeightVersion: number; nPostureVersion: number; nUnderlineVersion: number; nOverlineVersion: number;
  nCrossedOutVersion: number; nContourVersion: number; nShadowedVersion: number; nColorVersion: number; nBoxVersion: number; nLineVersion: number;
  nBrushVersion: number; nAdjustVersion: number; nHorJustifyVersion: number; nVerJustifyVersion: number; nOrientationVersion: number; nMarginVersion: number;
  nBoolVersion: number; nInt32Version: number; nRotateModeVersion: number; nNumFormatVersion: number;
  m_nTextOrientationVersion: number; m_nVerticalAlignmentVersion: number;
}

/** WriterSpecificBlockExists: the size of the Writer block that follows (0 for none). */
function WriterSpecificBlockExists(s: SvStream): number {
  const endOfSwBlock = s.ReadUInt64();
  // end-of-block pointing to itself indicates a zero-size block.
  return endOfSwBlock - s.Tell();
}

/** SwAfVersions::Load with AutoFormatVersions::LoadBlockA and LoadBlockB */
function LoadVersions(s: SvStream, nVer: number): SwAfVersions {
  const v = {} as SwAfVersions;
  v.nFontVersion = s.ReadUInt16(); v.nFontHeightVersion = s.ReadUInt16(); v.nWeightVersion = s.ReadUInt16(); v.nPostureVersion = s.ReadUInt16();
  v.nUnderlineVersion = s.ReadUInt16();
  v.nOverlineVersion = nVer >= AUTOFORMAT_ID_300OVRLN ? s.ReadUInt16() : 0;
  v.nCrossedOutVersion = s.ReadUInt16(); v.nContourVersion = s.ReadUInt16(); v.nShadowedVersion = s.ReadUInt16(); v.nColorVersion = s.ReadUInt16();
  v.nBoxVersion = s.ReadUInt16();
  v.nLineVersion = nVer >= AUTOFORMAT_ID_680DR14 ? s.ReadUInt16() : 0;
  v.nBrushVersion = s.ReadUInt16(); v.nAdjustVersion = s.ReadUInt16();
  v.m_nTextOrientationVersion = 0; v.m_nVerticalAlignmentVersion = 0;
  if (nVer >= AUTOFORMAT_ID_31005 && WriterSpecificBlockExists(s)) { v.m_nTextOrientationVersion = s.ReadUInt16(); v.m_nVerticalAlignmentVersion = s.ReadUInt16(); }
  v.nHorJustifyVersion = s.ReadUInt16(); v.nVerJustifyVersion = s.ReadUInt16(); v.nOrientationVersion = s.ReadUInt16(); v.nMarginVersion = s.ReadUInt16();
  v.nBoolVersion = s.ReadUInt16();
  v.nInt32Version = 0; v.nRotateModeVersion = 0;
  if (nVer >= AUTOFORMAT_ID_504) { v.nInt32Version = s.ReadUInt16(); v.nRotateModeVersion = s.ReadUInt16(); }
  v.nNumFormatVersion = s.ReadUInt16();
  return v;
}

// --- legacy item readers ---

/** legacy::SvxFont::Create: the family name (in UTF-16 after the magic number, when present). */
function ReadFont(s: SvStream): string {
  s.ReadUChar(); s.ReadUChar(); s.ReadUChar(); // family, pitch, encoding
  let aName = s.ReadUniOrByteString();
  s.ReadUniOrByteString(); // style
  const nStreamPos = s.Tell();
  if (s.remainingSize() >= 4 && s.ReadUInt32() === 0xFE331188) {
    aName = s.ReadUniOrByteString('unicode');
    s.ReadUniOrByteString('unicode');
  } else s.Seek(nStreamPos);
  return aName;
}

/** legacy::SvxFontHeight::Create: the height in twips (the proportion and its unit are dropped). */
function ReadFontHeight(s: SvStream, nItemVersion: number): number {
  const nsize = s.ReadUInt16();
  if (FONTHEIGHT_16_VERSION <= nItemVersion) s.ReadUInt16(); else s.ReadUChar();
  if (FONTHEIGHT_UNIT_VERSION <= nItemVersion) s.ReadUInt16();
  return nsize;
}

/** CreateBorderLine: the colour and the width of all its lines (GuessLinesWidths, reduced). */
function CreateBorderLine(s: SvStream, version: number): SvxBorderLine {
  const color = s.readColor();
  const nOutline = s.ReadUInt16(), nInline = s.ReadUInt16(), nDistance = s.ReadUInt16();
  if (version >= 1) s.ReadUInt16(); // style
  return { color, width: nOutline + nInline + nDistance };
}

/** legacy::SvxBox::Create */
function ReadBox(s: SvStream, nItemVersion: number): { box: SwAutoFormatProps['box']; dist: SwAutoFormatProps['dist'] } {
  const box: SwAutoFormatProps['box'] = { top: null, left: null, right: null, bottom: null };
  const nDistance = s.ReadUInt16();
  const aLineMap = ['top', 'left', 'right', 'bottom'] as const;
  let cLine = 0;
  while (s.good()) {
    cLine = s.ReadSChar();
    if (cLine > 3) break;
    box[aLineMap[cLine]!] = CreateBorderLine(s, nItemVersion >= BOX_BORDER_STYLE_VERSION ? 1 : 0);
  }
  let dist: SwAutoFormatProps['dist'] = [nDistance, nDistance, nDistance, nDistance];
  if (nItemVersion >= BOX_4DISTS_VERSION && (cLine & 0x10) !== 0) {
    const d = aLineMap.map(() => s.ReadUInt16()); // top, left, right, bottom
    dist = [d[1]!, d[0]!, d[2]!, d[3]!];
  }
  return { box, dist };
}

/** legacy::SvxLine::Create: a diagonal line, dropped. */
function ReadLine(s: SvStream): void { s.readColor(); s.ReadInt16(); s.ReadInt16(); s.ReadInt16(); }

/** legacy::SvxBrush::Create: the colour, mixed for the old hatch styles; null for none. */
function ReadBrush(s: SvStream, nItemVersion: number): string | null {
  s.ReadCharAsBool(); // bTrans
  const c = s.readColor(), f = s.readColor();
  const nStyle = s.ReadSChar();
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a: number, b: number, d: number) => `#${rgb(c).map((v, i) => Math.trunc((v * a + rgb(f)[i]! * b) / d).toString(16).padStart(2, '0')).join('')}`;
  let color: string | null;
  switch (nStyle) {
    case 8: color = mix(1, 2, 3); break; // BRUSH_25
    case 9: color = mix(1, 1, 2); break; // BRUSH_50
    case 10: color = mix(2, 1, 3); break; // BRUSH_75
    case 0: color = null; break; // BRUSH_NULL
    default: color = c;
  }
  if (nItemVersion < BRUSH_GRAPHIC_VERSION) return color;
  const nDoLoad = s.ReadUInt16();
  if (nDoLoad & 1) throw new Error('SvxBrush with a graphic is not supported');
  if (nDoLoad & 2) s.ReadUniOrByteString(); // link
  if (nDoLoad & 4) s.ReadUniOrByteString(); // filter
  s.ReadSChar(); // graphic position
  return color;
}

/** SwAutoFormatProps::Load with AutoFormatBase::LoadBlockA and LoadBlockB */
function LoadProps(s: SvStream, v: SwAfVersions, nVer: number, defaultFont: string): SwAutoFormatProps {
  const p = DefaultAutoFormatProps(defaultFont);
  p.font = ReadFont(s);
  p.height = ReadFontHeight(s, v.nFontHeightVersion);
  p.weight = s.ReadUChar() >= 7; // WEIGHT_SEMIBOLD and bolder
  p.posture = s.ReadUChar() !== 0;
  // --- from 641 on: CJK and CTL font settings
  if (AUTOFORMAT_DATA_ID_641 <= nVer) for (let k = 0; k < 2; k++) { ReadFont(s); ReadFontHeight(s, v.nFontHeightVersion); s.ReadUChar(); s.ReadUChar(); }
  p.underline = toLineStyle(s.ReadUChar());
  if (nVer >= AUTOFORMAT_DATA_ID_300OVRLN) p.overline = toLineStyle(s.ReadUChar());
  p.crossedOut = s.ReadUChar() !== 0;
  p.contour = s.ReadCharAsBool();
  p.shadowed = s.ReadCharAsBool();
  const color = s.readColor();
  p.color = color;
  const b = ReadBox(s, v.nBoxVersion);
  p.box = b.box; p.dist = b.dist;
  // --- from 680/dr14 on: diagonal frame lines
  if (nVer >= AUTOFORMAT_DATA_ID_680DR14) { ReadLine(s); ReadLine(s); }
  p.background = ReadBrush(s, v.nBrushVersion);
  p.adjust = ADJUST[s.ReadUChar()] ?? 'left';
  if (v.nAdjustVersion >= ADJUST_LASTBLOCK_VERSION) s.ReadSChar();
  if (nVer >= AUTOFORMAT_DATA_ID_31005) {
    const nSize = WriterSpecificBlockExists(s);
    if (nSize > 0 && nSize < 0xffff) {
      s.ReadUInt16(); // SvxFrameDirection
      // HORRIBLE HACK to read both 32-bit and 64-bit "long": abuse nSize
      if (nSize === 14) s.ReadInt64(); else if (nSize === 10) s.ReadInt32();
      const orient = s.ReadInt16();
      s.ReadInt16(); // relation
      p.vertOrient = orient === 2 ? 'center' : orient === 3 ? 'bottom' : orient === 1 ? 'top' : null;
    }
  }
  // LoadBlockB
  s.ReadUInt16(); s.ReadUInt16(); s.ReadUInt16(); // HorJustify, VerJustify, Orientation
  s.ReadInt16(); s.ReadInt16(); s.ReadInt16(); s.ReadInt16(); // Margin
  s.ReadCharAsBool(); // Linebreak
  if (nVer >= AUTOFORMAT_DATA_ID_504) { s.ReadInt32(); s.ReadUInt16(); } // RotateAngle, RotateMode
  if (v.nNumFormatVersion === 0) {
    // --- from 680/dr25 on: store strings as UTF-8
    p.numFormat = s.ReadUniOrByteString(nVer >= AUTOFORMAT_ID_680DR25 ? 'utf-8' : s.m_eStreamCharSet);
    s.ReadUInt16(); s.ReadUInt16();
  }
  return p;
}

/** SwTableAutoFormat::Load */
function LoadFormat(s: SvStream, v: SwAfVersions, defaultFont: string): SwTableAutoFormat | null {
  const nVal = s.ReadUInt16();
  if (!(nVal === AUTOFORMAT_DATA_ID_X || (AUTOFORMAT_DATA_ID_504 <= nVal && nVal <= AUTOFORMAT_DATA_ID))) return null;
  const f = newFormat('', defaultFont);
  f.m_aName = s.ReadUniOrByteString(nVal >= AUTOFORMAT_ID_680DR25 ? 'utf-8' : s.m_eStreamCharSet);
  if (AUTOFORMAT_DATA_ID_552 <= nVal) {
    const m_nStrResId = s.ReadUInt16();
    // start from 3d because default is added via constructor
    if (m_nStrResId < POOL_TABLESTYLE_NAMES.length) f.m_aName = POOL_TABLESTYLE_NAMES[m_nStrResId]!;
  }
  f.m_bInclFont = s.ReadCharAsBool(); f.m_bInclJustify = s.ReadCharAsBool(); f.m_bInclFrame = s.ReadCharAsBool();
  f.m_bInclBackground = s.ReadCharAsBool(); f.m_bInclValueFormat = s.ReadCharAsBool(); f.m_bInclWidthHeight = s.ReadCharAsBool();
  if (nVal >= AUTOFORMAT_DATA_ID_31005 && WriterSpecificBlockExists(s)) {
    // this only exists for file format compat
    s.ReadSChar(); // SvxFormatBreak
    if (FMTBREAK_NOAUTO > 1) s.ReadSChar();
    f.m_bKeepWithNextPara = s.ReadSChar() !== 0;
    f.m_aRepeatHeading = s.ReadUInt16();
    f.m_bLayoutSplit = s.ReadCharAsBool();
    f.m_bRowSplit = s.ReadCharAsBool();
    s.ReadCharAsBool(); // collapsing borders
    // legacy::SvxShadow::Create
    s.ReadSChar(); s.ReadUInt16(); s.ReadCharAsBool(); s.readColor(); s.readColor(); s.ReadSChar();
  }
  for (let i = 0; i < 16; ++i) f.m_aBoxAutoFormat[i] = LoadProps(s, v, nVal, defaultFont);
  return f;
}

/** SwTableAutoFormatTable::Impl::Load(SvStream&): the styles of an autotbl.fmt. */
export function LoadTableAutoFormats(data: Uint8Array, defaultFont: string): SwTableAutoFormat[] {
  const s = new SvStream(data);
  const out: SwTableAutoFormat[] = [];
  const nVal = s.ReadUInt16();
  if (nVal === AUTOFORMAT_ID_358 || (AUTOFORMAT_ID_504 <= nVal && nVal <= AUTOFORMAT_ID)) {
    const nPos = s.Tell();
    const nCnt = s.ReadUChar(), nChrSet = s.ReadUChar();
    if (s.Tell() !== nPos + nCnt) s.Seek(nPos + nCnt);
    s.m_eStreamCharSet = nChrSet === 76 ? 'utf-8' : 'latin1'; // RTL_TEXTENCODING_UTF8
  }
  if (!(nVal === AUTOFORMAT_ID_358 || nVal === AUTOFORMAT_ID_X || (AUTOFORMAT_ID_504 <= nVal && nVal <= AUTOFORMAT_ID))) return out;
  const v = LoadVersions(s, nVal);
  const nCount = s.ReadUInt16();
  for (let i = 0; i < nCount; ++i) {
    const f = LoadFormat(s, v, defaultFont);
    if (!f) break;
    out.push(f);
  }
  return out;
}

/** The index of a box's format: its line and column class (lcl_SetAFormatBox, SetTableAutoFormat). */
export function AutoFormatPos(nLine: number, nLines: number, nBox: number, nBoxes: number): number {
  const line = !nLine ? 0 : nLine + 1 === nLines ? 3 : 1 + ((nLine - 1) & 1);
  const box = !nBox ? 0 : nBox === nBoxes - 1 ? 3 : 1 + ((nBox - 1) & 1);
  return line * 4 + box;
}

/**
 * SwTableAutoFormat::UpdateToSet: the box's borders (a cell spanning to the end takes the last
 * row's bottom and the last column's right line), background and vertical alignment.
 */
export function BoxBorders(f: SwTableAutoFormat, nPos: number, bCellSpansToEndV: boolean, bCellSpansToEndH: boolean): SwAutoFormatProps['box'] {
  const aAutoFormatBox = { ...f.m_aBoxAutoFormat[nPos]!.box };
  // No format box is adequate to specify the borders of single column/row tables (or cells
  // that span to the respective end), so combine first/last.
  if (bCellSpansToEndV || bCellSpansToEndH) {
    let nLastRowOrColumnId = 15; //LAST_ROW_END_COLUMN
    if (!bCellSpansToEndV) nLastRowOrColumnId = Math.trunc(nPos / 4) * 4 + 3; //LAST COLUMN (3, 7, 11, 15)
    else if (!bCellSpansToEndH) nLastRowOrColumnId = (nPos % 4) + 12; //LAST ROW (12, 13, 14, 15)
    const last = f.m_aBoxAutoFormat[nLastRowOrColumnId]!.box;
    if (bCellSpansToEndV) aAutoFormatBox.bottom = last.bottom;
    if (bCellSpansToEndH) aAutoFormatBox.right = last.right;
  }
  return aAutoFormatBox;
}
