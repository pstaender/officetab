// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/filter/excel/xestyle.cxx reduced
// The styles part of the XLSX export: XclExpFontBuffer, XclExpNumFmtBuffer, XclExpCellArea
// (fills), XclExpCellBorder (with lclGetBorderLine's mapping of line styles and widths),
// XclExpCellAlign, XclExpCellProt, XclExpXF (style and cell XFs) and XclExpStyle (cellStyles),
// written as styles.xml. Reduced: colours are written as RGB (no palette or theme colours); the
// XF list is built on demand from the patterns and cell styles that are used (plus the
// user-defined cell styles), without the BIFF record limits and the built-in XF records of the
// binary format; every number format gets an identifier from 164 on as upstream does, with the
// format code kept (the port's formats are codes) except BOOLEAN, which becomes Excel's
// "TRUE";"TRUE";"FALSE"; the differential formats (dxfs) are empty.
import { escapeXml } from '../../../../xmloff/source/core/xmlparse.ts';
import { encodeXString } from '../../../../oox/source/helper/attributelist.ts';
import type { ScPatternAttr } from '../../../inc/patattr.ts';
import { SC_POOL_DEFAULTS, type ScItemId, type ScItems, type SvxBorderLine } from '../../../inc/scitems.ts';
import { SfxStyleFamily, type ScStyleSheet } from '../../../inc/stlsheet.ts';
import { STR_STYLENAME_STANDARD } from '../../../inc/stlpool.ts';
import type { ScDocument } from '../../core/data/document.ts';
import { GetDigitWidthTwips, GetSpaceWidthTwips } from '../oox/unitconverter.ts';

/** Reads items as a pattern or style gives them (the effective value). */
interface ItemSource { GetItem<K extends ScItemId>(nWhich: K): ScItems[K] }

const FONT_ITEMS: ScItemId[] = ['ATTR_FONT', 'ATTR_FONT_HEIGHT', 'ATTR_FONT_WEIGHT', 'ATTR_FONT_POSTURE', 'ATTR_FONT_UNDERLINE', 'ATTR_FONT_CROSSEDOUT', 'ATTR_FONT_CONTOUR', 'ATTR_FONT_SHADOWED', 'ATTR_FONT_COLOR'];
const ALIGN_ITEMS: ScItemId[] = ['ATTR_HOR_JUSTIFY', 'ATTR_HOR_JUSTIFY_METHOD', 'ATTR_VER_JUSTIFY', 'ATTR_VER_JUSTIFY_METHOD', 'ATTR_INDENT', 'ATTR_SHRINKTOFIT', 'ATTR_WRITINGDIR', 'ATTR_STACKED', 'ATTR_ROTATE_VALUE', 'ATTR_LINEBREAK'];
const BORDER_ITEMS: ScItemId[] = ['ATTR_BORDER', 'ATTR_BORDER_TLBR', 'ATTR_BORDER_BLTR'];

const ToPsz = (b: boolean) => (b ? 'true' : 'false');
/** XclXmlUtils::ToOString of a colour: ARGB. */
export const ToARGB = (c: string) => `FF${c.slice(1).toUpperCase()}`;

/** The built-in cell style names of Excel (sppcStyleNames / lcl_StyleNameFromId). */
export const BUILTIN_STYLE_NAMES = ['Normal', 'RowLevel_', 'ColLevel_', 'Comma', 'Currency', 'Percent', 'Comma [0]', 'Currency [0]', 'Hyperlink', 'Followed Hyperlink', 'Note', 'Warning Text', '', '', '', 'Title', 'Heading 1', 'Heading 2', 'Heading 3', 'Heading 4', 'Input', 'Output', 'Calculation', 'Check Cell', 'Linked Cell', 'Total', 'Good', 'Bad', 'Neutral', 'Accent1', '20% - Accent1', '40% - Accent1', '60% - Accent1', 'Accent2', '20% - Accent2', '40% - Accent2', '60% - Accent2', 'Accent3', '20% - Accent3', '40% - Accent3', '60% - Accent3', 'Accent4', '20% - Accent4', '40% - Accent4', '60% - Accent4', 'Accent5', '20% - Accent5', '40% - Accent5', '60% - Accent5', 'Accent6', '20% - Accent6', '40% - Accent6', '60% - Accent6', 'Explanatory Text'];
const BUILTIN_PREFIX = 'Excel Built-in ';

/** XclTools::GetXclRotation */
export function GetXclRotation(nScRot: number): number {
  const nXclRot = Math.trunc(nScRot / 100);
  if ((0 <= nXclRot) && (nXclRot <= 90)) return nXclRot;
  if (nXclRot < 180) return 270 - nXclRot;
  if (nXclRot < 270) return nXclRot - 180;
  if (nXclRot < 360) return 450 - nXclRot;
  return 0;
}

/** lclGetBorderLine: the Excel line style of a Calc border line (none for no line). */
export function lclGetBorderLine(pLine: SvxBorderLine | null): string {
  // Document: sc/qa/unit/data/README.cellborders
  const Map_LineLO_toMS: Record<string, [string, string, string, string]> = {
    //    0,05  -  0,74   0,75  -  1,49    1,50  -  2,49      2,50  -  9,00   Width Range [pt]
    solid: ['hair', 'thin', 'medium', 'thick'],
    dotted: ['dotted', 'dotted', 'slantDashDot', 'slantDashDot'],
    dashed: ['dotted', 'dashed', 'mediumDashed', 'mediumDashed'],
    'fine-dashed': ['dashed', 'dashed', 'slantDashDot', 'slantDashDot'],
    'dash-dot': ['dashed', 'dashDot', 'mediumDashDot', 'mediumDashDot'],
    'dash-dot-dot': ['dashed', 'dashDotDot', 'mediumDashDotDot', 'mediumDashDotDot'],
    'double-thin': ['double', 'double', 'double', 'double'],
  };
  if (!pLine || pLine.width <= 0) return 'none';
  const row = Map_LineLO_toMS[pLine.style ?? 'solid'] ?? Map_LineLO_toMS.solid!;
  const nOuterWidth = pLine.width;
  const idx = nOuterWidth >= 50 ? 3 : nOuterWidth >= 35 ? 2 : nOuterWidth >= 15 ? 1 : nOuterWidth >= 1 ? 0 : 1;
  return row[idx];
}

/** XclExpNumFmtBuffer::GetFormatCode (GetFormatStringForExcel): BOOLEAN has no Excel keyword. */
const GetFormatCode = (rCode: string) => (rCode.toUpperCase() === 'BOOLEAN' ? '"TRUE";"TRUE";"FALSE"' : rCode);

export class XclExpXFBuffer {
  private readonly mrDoc: ScDocument;
  private maFonts: string[] = [];
  private maNumFmts = new Map<string, number>();
  private maFills: string[] = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  private maBorders: string[] = ['<border diagonalUp="false" diagonalDown="false"><left/><right/><top/><bottom/><diagonal/></border>'];
  private maStyleXfs: string[] = [];
  private maStyleIndex = new Map<ScStyleSheet, number>();
  private maCellStyles: string[] = [];
  private maCellXfs: string[] = [];
  private maCellIndex = new Map<ScPatternAttr, number>();
  private maCellKeys = new Map<string, number>();
  /** The default font's character widths (XclRoot::GetCharWidth and GetSpaceWidth), twips. */
  readonly mnCharWidth: number;
  readonly mnSpaceWidth: number;
  readonly maDefFontName: string;
  readonly mnDefFontHeight: number;

  constructor(rDoc: ScDocument) {
    this.mrDoc = rDoc;
    const pDef = rDoc.GetStyleSheetPool().Find(STR_STYLENAME_STANDARD, SfxStyleFamily.Para);
    this.maDefFontName = pDef ? pDef.GetItem('ATTR_FONT') : SC_POOL_DEFAULTS.ATTR_FONT;
    this.mnDefFontHeight = pDef ? pDef.GetItem('ATTR_FONT_HEIGHT') : SC_POOL_DEFAULTS.ATTR_FONT_HEIGHT;
    this.mnCharWidth = GetDigitWidthTwips(this.maDefFontName, this.mnDefFontHeight);
    this.mnSpaceWidth = GetSpaceWidthTwips(this.maDefFontName, this.mnDefFontHeight);
    // the default style is the first style XF, the default pattern the first cell XF
    if (pDef) this.InsertStyle(pDef);
    for (const s of rDoc.GetStyleSheetPool().GetStyles(SfxStyleFamily.Para)) if (s.IsUserDefined()) this.InsertStyle(s);
    this.Insert(rDoc.GetDefPattern());
  }

  /** XclExpFontBuffer::Insert: the font index of the effective font items. */
  private InsertFont(r: ItemSource): number {
    let s = '<font>';
    if (r.GetItem('ATTR_FONT_WEIGHT')) s += '<b val="true"/>';
    if (r.GetItem('ATTR_FONT_POSTURE')) s += '<i val="true"/>';
    if (r.GetItem('ATTR_FONT_CROSSEDOUT')) s += '<strike val="true"/>';
    if (r.GetItem('ATTR_FONT_CONTOUR')) s += '<outline val="true"/>';
    if (r.GetItem('ATTR_FONT_SHADOWED')) s += '<shadow val="true"/>';
    const u = r.GetItem('ATTR_FONT_UNDERLINE');
    if (u !== 'none') s += `<u val="${u === 'double' ? 'double' : 'single'}"/>`;
    s += `<sz val="${r.GetItem('ATTR_FONT_HEIGHT') / 20}"/>`;
    const c = r.GetItem('ATTR_FONT_COLOR');
    if (c) s += `<color rgb="${ToARGB(c)}"/>`;
    s += `<name val="${escapeXml(r.GetItem('ATTR_FONT'))}"/><family val="2"/><charset val="1"/></font>`;
    let i = this.maFonts.indexOf(s);
    if (i < 0) { i = this.maFonts.length; this.maFonts.push(s); }
    return i;
  }

  /** XclExpNumFmtBuffer::Insert: identifiers from 164 (EXC_FORMAT_OFFSET8) on. */
  private InsertNumFmt(rCode: string): number {
    let n = this.maNumFmts.get(rCode);
    if (n === undefined) this.maNumFmts.set(rCode, n = 164 + this.maNumFmts.size);
    return n;
  }

  private InsertFill(r: ItemSource): number {
    const c = r.GetItem('ATTR_BACKGROUND');
    if (!c) return 0;
    const s = `<fill><patternFill patternType="solid"><fgColor rgb="${ToARGB(c)}"/><bgColor rgb="${ToARGB(c)}"/></patternFill></fill>`;
    let i = this.maFills.indexOf(s);
    if (i < 0) { i = this.maFills.length; this.maFills.push(s); }
    return i;
  }

  private InsertBorder(r: ItemSource): number {
    const box = r.GetItem('ATTR_BORDER');
    const tlbr = r.GetItem('ATTR_BORDER_TLBR'), bltr = r.GetItem('ATTR_BORDER_BLTR');
    const line = (el: string, l: SvxBorderLine | null) => {
      const st = lclGetBorderLine(l);
      return st === 'none' ? `<${el}/>` : `<${el} style="${st}"><color rgb="${ToARGB(l!.color)}"/></${el}>`;
    };
    // one diagonal line element for both directions (Excel has one diagonal line style)
    const diag = tlbr ?? bltr;
    const bDiagTLtoBR = lclGetBorderLine(tlbr) !== 'none', bDiagBLtoTR = lclGetBorderLine(bltr) !== 'none';
    const s = `<border diagonalUp="${ToPsz(bDiagBLtoTR)}" diagonalDown="${ToPsz(bDiagTLtoBR)}">${line('left', box.left)}${line('right', box.right)}${line('top', box.top)}${line('bottom', box.bottom)}${line('diagonal', bDiagTLtoBR || bDiagBLtoTR ? diag : null)}</border>`;
    let i = this.maBorders.indexOf(s);
    if (i < 0) { i = this.maBorders.length; this.maBorders.push(s); }
    return i;
  }

  /** XclExpCellAlign::FillFromItemSet and SaveXml */
  private Alignment(r: ItemSource): string {
    const eHor = r.GetItem('ATTR_HOR_JUSTIFY'), eVer = r.GetItem('ATTR_VER_JUSTIFY');
    let hor = ({ Standard: 'general', Left: 'left', Center: 'center', Right: 'right', Block: 'justify', Repeat: 'fill' } as const)[eHor] as string;
    let ver = ({ Standard: 'bottom', Top: 'top', Center: 'center', Bottom: 'bottom', Block: 'justify' } as const)[eVer] as string;
    // Adjust for distributed alignments.
    if (eHor === 'Block' && r.GetItem('ATTR_HOR_JUSTIFY_METHOD') === 'Distribute') hor = 'distributed';
    if (eVer === 'Block' && r.GetItem('ATTR_VER_JUSTIFY_METHOD') === 'Distribute') ver = 'distributed';
    const nIndent = Math.max(0, Math.min(15, Math.trunc(r.GetItem('ATTR_INDENT') / (3.0 * this.mnSpaceWidth) + 0.5)));
    const nRotation = r.GetItem('ATTR_STACKED') ? 255 : GetXclRotation(r.GetItem('ATTR_ROTATE_VALUE'));
    const dir = r.GetItem('ATTR_WRITINGDIR');
    const nTextDir = dir === 'Horizontal_LR_TB' ? 1 : dir === 'Horizontal_RL_TB' ? 2 : 0;
    return `<alignment horizontal="${hor}" vertical="${ver}" textRotation="${nRotation}" wrapText="${ToPsz(r.GetItem('ATTR_LINEBREAK'))}" indent="${nIndent}" shrinkToFit="${ToPsz(r.GetItem('ATTR_SHRINKTOFIT'))}"${nTextDir ? ` readingOrder="${nTextDir}"` : ''}/>`;
  }

  private Protection(r: ItemSource): string {
    const p = r.GetItem('ATTR_PROTECTION');
    return `<protection locked="${ToPsz(p.bProtection)}" hidden="${ToPsz(p.bHideFormula || p.bHideCell)}"/>`;
  }

  /** The XF element of an item source; xfId for a cell XF. */
  private XF(r: ItemSource, nXfId: number | null, used: (ids: ScItemId[]) => boolean): string {
    const nFont = this.InsertFont(r), nFmt = this.InsertNumFmt(GetFormatCode(r.GetItem('ATTR_VALUE_FORMAT'))), nFill = this.InsertFill(r), nBorder = this.InsertBorder(r);
    return `<xf numFmtId="${nFmt}" fontId="${nFont}" fillId="${nFill}" borderId="${nBorder}"${nXfId === null ? '' : ` xfId="${nXfId}"`} applyFont="${ToPsz(used(FONT_ITEMS))}" applyBorder="${ToPsz(used(BORDER_ITEMS))}" applyAlignment="${ToPsz(used(ALIGN_ITEMS))}" applyProtection="${ToPsz(used(['ATTR_PROTECTION']))}">${this.Alignment(r)}${this.Protection(r)}</xf>`;
  }

  /** InsertStyleXF: the style XF index of a cell style (made on first use). */
  InsertStyle(rStyle: ScStyleSheet): number {
    let n = this.maStyleIndex.get(rStyle);
    if (n !== undefined) return n;
    n = this.maStyleXfs.length;
    this.maStyleIndex.set(rStyle, n);
    this.maStyleXfs.push(this.XF(rStyle, null, () => true));
    // XclExpStyle::SaveXml
    const aName = rStyle.GetName();
    let nBuiltinId = -1, sName = aName;
    if (aName === STR_STYLENAME_STANDARD) { nBuiltinId = 0; sName = 'Normal'; }
    else if (aName.startsWith(BUILTIN_PREFIX)) {
      const i = BUILTIN_STYLE_NAMES.indexOf(aName.slice(BUILTIN_PREFIX.length));
      if (i > 0 && i !== 1 && i !== 2) { nBuiltinId = i; sName = BUILTIN_STYLE_NAMES[i]!; }
    }
    // builtinId of 54 or above is invalid according to OpenXML SDK validator.
    this.maCellStyles.push(`<cellStyle name="${escapeXml(encodeXString(sName))}" xfId="${n}"${nBuiltinId >= 0 ? ` builtinId="${Math.min(53, nBuiltinId)}"` : ''}/>`);
    return n;
  }

  /** XclExpXFBuffer::Insert: the cell XF index of a pattern. */
  Insert(pPattern: ScPatternAttr): number {
    let n = this.maCellIndex.get(pPattern);
    if (n !== undefined) return n;
    const pStyle = pPattern.GetStyleSheet() ?? this.mrDoc.GetStyleSheetPool().Find(STR_STYLENAME_STANDARD, SfxStyleFamily.Para);
    const nXfId = pStyle ? this.InsertStyle(pStyle) : 0;
    const s = this.XF(pPattern, nXfId, (ids) => ids.some((k) => pPattern.HasItem(k)));
    n = this.maCellKeys.get(s);
    if (n === undefined) { n = this.maCellXfs.length; this.maCellXfs.push(s); this.maCellKeys.set(s, n); }
    this.maCellIndex.set(pPattern, n);
    return n;
  }

  SaveXml(): string {
    const list = (el: string, items: string[]) => `<${el} count="${items.length}">${items.join('')}</${el}>`;
    const numFmts = [...this.maNumFmts].map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${escapeXml(encodeXString(code))}"/>`);
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + list('numFmts', numFmts) + list('fonts', this.maFonts) + list('fills', this.maFills) + list('borders', this.maBorders)
      + list('cellStyleXfs', this.maStyleXfs) + list('cellXfs', this.maCellXfs) + list('cellStyles', this.maCellStyles)
      + '<dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>'
      + '</styleSheet>';
  }
}

