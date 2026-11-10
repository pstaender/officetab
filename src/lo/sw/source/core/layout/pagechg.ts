// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/core/layout/pagechg.cxx reduced
// @upstream sw/source/core/layout/flowfrm.cxx reduced
// @upstream sw/source/core/layout/frmtool.cxx reduced
// @upstream sw/source/core/layout/tabfrm.cxx reduced
// @upstream sw/source/core/text/widorp.cxx reduced
// @upstream sw/source/core/text/frmcrsr.cxx reduced
// @upstream sw/source/core/inc/rootfrm.hxx reduced
// @upstream sw/source/core/inc/pagefrm.hxx reduced
// @upstream sw/source/core/inc/txtfrm.hxx reduced
// @upstream sw/source/core/inc/tabfrm.hxx reduced
// @upstream sw/source/core/inc/cellfrm.hxx reduced
// @upstream sw/source/core/layout/hffrm.cxx reduced
// @upstream sw/source/core/objectpositioning/tocntntanchoredobjectposition.cxx reduced
// @upstream sw/source/core/objectpositioning/tolayoutanchoredobjectposition.cxx reduced
// @upstream sw/source/core/text/txtfly.cxx reduced
// Upstream's frame tree converges through repeated invalidation; here one forward pass places
// cached paragraph layouts on pages. Tables break between rows only (rows joined by a vertical
// merge stay together) and repeat their heading rows; rows do not split across pages.
// Headers and footers sit inside the page margins and push the body in, as SwHeadFootFrame does.
// Fields expand with the page a paragraph starts on; a paragraph continued on the next page keeps it.
// Flys (SwFlyFrame, positioned as SwToContentAnchoredObjectPosition and SwToLayoutAnchoredObjectPosition
// do, reduced) are placed when their anchor paragraph or page is; text placed after them on the
// page wraps around them. A paragraph continued on another page is formatted again there.
// Character anchors relate to their character's position in the paragraph formatted without the
// flys (upstream formats again with them), and "follow text flow" is not ported.
import { EnhancedCustomShape2d } from '../../../../svx/source/customshapes/EnhancedCustomShape2d.ts';
import { GetCustomShapeContent } from '../../../../svx/source/customshapes/EnhancedCustomShapeGeometry.ts';
import { Point } from '../../../../tools/source/generic/gen.ts';
import { SwRect } from '../../../inc/swrect.ts';
import type { SwDoc } from '../../../inc/doc.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';
import type { SwSectionNode, SwStartNode, SwTableNode } from '../../../inc/node.ts';
import { CalcColumns, type SwFormatCol } from '../../../inc/fmtclds.ts';
import type { SwPageDesc } from '../../../inc/pagedesc.ts';
import type { SwTableBox } from '../../../inc/swtable.ts';
import type { TextMeasurer } from '../../../../vcl/source/outdev/text.ts';
import { NumberParagraphs, type SwNodeNum } from '../doc/list.ts';
import { NumberingType, makeNumberingString } from '../../../../i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';
import { ExpandSeq, GetSeqNumbers } from '../fields/expfld.ts';
import { SwNumFormat, SwNumRule } from '../../../inc/numrule.ts';

/** Footnote numbers are laid out as list labels; this rule only stands in for the list's. */
const FOOTNOTE_RULE = new SwNumRule('');
import { FormatParagraph, LineRangeX, LineXAt, displayText, type FieldExpander, type LineAreaFn, type SwLineLayout, type SwParaPortion } from '../text/itrform2.ts';
import { AsCharFormat, HoriOrientation, RelOrientation, RndStdIds, RotatedBoundSize, VertOrientation, WrapTextMode, type SwFlyFrameFormat } from '../../../inc/frmfmt.ts';
import { CH_TXTATR_BREAKWORD, type SvxParaBox, type SwField, type SwPostItField } from '../../../inc/hintids.ts';
import { ListIndents } from '../text/itrform2.ts';
import { SwStartNodeType } from '../../../inc/ndtyp.ts';

export type SwFrameArea = 'body' | 'header' | 'footer' | 'footnote' | 'fly';

/** A point of a vertical cell's content on the page (SwCellFrame.aVert). */
export const ApplyVert = (m: [number, number, number, number, number, number], x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
/** A page point in a vertical cell's content coordinates. */
export function InvertVert(m: [number, number, number, number, number, number], pt: Point): Point {
  const [a, b, c, d, e, f] = m, det = a * d - b * c, x = pt.X() - e, y = pt.Y() - f;
  return new Point(Math.round((d * x - c * y) / det), Math.round((-b * x + a * y) / det));
}

/**
 * A positioned fly (SwFlyFrame): its frame, the frame grown by its wrap spacing, the anchor it
 * belongs to, and for text frames the laid out content. `aRelH` and `aRelV` are the areas its
 * orientation relates to, so that moving it can compute new offsets.
 */
export interface SwFlyFrame {
  fmt: SwFlyFrameFormat;
  aFrame: SwRect;
  aBound: SwRect;
  node?: SwTextNode;
  frames: SwTextFrame[];
  tabs: SwTabFrame[];
  aRelH: { left: number; width: number };
  aRelV: { top: number; height: number };
  /** Vertical text: the content's rotation onto the page, as SwCellFrame.aVert. */
  aVert?: [number, number, number, number, number, number];
}

/** The paragraph a fly is positioned against: its frame area, print area and top edges. */
export interface AnchorGeometry {
  left: number; width: number; printLeft: number; printWidth: number; top: number; printTop: number;
  /** The rectangle of a character of the anchor paragraph (SwTextFrame::GetCharRect), for CHAR and TEXT_LINE relations. */
  charRect?: (nContent: number) => { x: number; lineTop: number; lineHeight: number } | null;
}

// SwTextFly: wrap only on sides with at least 2cm space for the text; wrap on both sides up to a frame width of 1.5cm.
const TEXT_MIN = 1134;
const FRAME_MAX = 850;

/** Comment sidebar width, 2.5 inches (SwPostItMgr::GetSidebarWidth at 100%). */
export const COMMENT_SIDEBAR = 3600;

/** SwPageFootnoteInfo defaults: 1 mm above and below a 0.5 pt separator a quarter of the width. */
const FTN_TOPDIST = 57, FTN_BOTTOMDIST = 57, FTN_LINEWIDTH = 10;
const FTN_SEPARATOR = FTN_TOPDIST + FTN_LINEWIDTH + FTN_BOTTOMDIST;

export const DOCUMENTBORDER = 568;
export const GAPBETWEENPAGES = 284;

export interface SwTextFrame {
  node: SwTextNode;
  /** Absolute document coordinates of the first line's top-left text area corner. */
  nLeft: number;
  nTop: number;
  nWidth: number;
  lines: SwLineLayout[];
  nHeight: number;
  /** False on a follow frame continuing a paragraph from the previous page. */
  bMaster: boolean;
  bHasFollow: boolean;
  /** The cell this paragraph is in, or undefined in the body. */
  pCell?: SwCellFrame;
  /** Header and footer frames; undefined in the body. */
  pArea?: SwFrameArea;
  /** The paragraph's border box and background area on this frame (SwBorderAttrs). */
  pBorder?: SwParaBorder;
  /** In a text frame with vertical text: the frame's rotation (SwFlyFrame.aVert). */
  aVert?: [number, number, number, number, number, number];
}

/** Where a paragraph's background and borders go: lines on top or bottom only where the box starts or ends. */
export interface SwParaBorder { rect: SwRect; top: boolean; bottom: boolean; box: SvxParaBox | null; background: string | null }

export interface SwCellFrame {
  box: SwTableBox; aFrame: SwRect; frames: SwTextFrame[]; tabs: SwTabFrame[];
  /**
   * Vertical text (SwCellFrame in a vertical layout, reduced): the content is laid out unrotated
   * at the cell's corner, with the cell's height as its width; this maps it onto the page
   * (x' = a x + c y + e, y' = b x + d y + f).
   */
  aVert?: [number, number, number, number, number, number];
}
export interface SwRowFrame { aFrame: SwRect; cells: SwCellFrame[]; bRepeated: boolean }
export interface SwTabFrame { node: SwTableNode; aFrame: SwRect; rows: SwRowFrame[] }

export interface SwPageFrame {
  nIndex: number;
  aFrame: SwRect;
  aPrt: SwRect;
  /** Every text frame on the page, in document order, including those in table cells. */
  frames: SwTextFrame[];
  /** Top-level table pieces on this page. */
  tabs: SwTabFrame[];
  aHeader?: SwRect;
  aFooter?: SwRect;
  /** The footnote area (SwFootnoteBossFrame's SwFootnoteContFrame) and its separator line. */
  aFootnote?: SwRect;
  aFootnoteSep?: SwRect;
  /** Flys on this page (SwPageFrame::GetSortedObjs), in the order they were placed. */
  flys: SwFlyFrame[];
  /** Separator lines between text columns (SwLayoutFrame::PaintColLines). */
  colLines: SwRect[];
  /** The page style of this page (SwPageFrame::GetPageDesc) and its page number as shown. */
  pDesc: SwPageDesc;
  nVirtNum: number;
}

interface CacheEntry { version: number; format: number; width: number; num: SwNodeNum | undefined; fields: string; para: SwParaPortion }

const sameNum = (a: SwNodeNum | undefined, b: SwNodeNum | undefined): boolean =>
  a === b || (!!a && !!b && a.fmt === b.fmt && a.label === b.label && a.counted === b.counted);

/** Positions the flys anchored at a paragraph laid out outside the body flow. */
type FlyPlacer = (node: SwTextNode, g: AnchorGeometry) => void;

/** Cell content placed at a position: its frames, nested tables and height. */
interface Placed { frames: SwTextFrame[]; tabs: SwTabFrame[]; height: number }

/** SwBorderAttrs::CalcLineSpacing_: the extra height of proportional line spacing, from the font size. */
function CalcLineSpacing(node: SwTextNode): number {
  const sp = node.GetAttr('RES_PARATR_LINESPACING');
  if (sp.rule !== 'proportional' || sp.value <= 100) return 0;
  return Math.trunc((node.GetAttr('RES_CHRATR_FONTSIZE') * (sp.value - 100) * 1.15) / 100);
}

/** SwTextFrame::GetLineSpace: the extra height proportional line spacing gives the last line. */
function GetLineSpace(node: SwTextNode, lines: SwLineLayout[]): number {
  const sp = node.GetAttr('RES_PARATR_LINESPACING');
  const last = lines[lines.length - 1];
  if (sp.rule !== 'proportional' || !last) return 0;
  // GetHeightOfLastLine: the height of the last line's font, not of objects in it.
  const h = last.nTextHeight ?? last.nHeight;
  const nTmp = Math.trunc((h * sp.value) / 100) - h;
  return nTmp > 0 ? nTmp : 0;
}

/**
 * SwFlowFrame::CalcUpperSpace: with contextual spacing on either paragraph ("Don't add space
 * between paragraphs of the same style"), two paragraphs of the same style get no space between.
 */
function SameContext(prev: SwTextNode, node: SwTextNode): boolean {
  return (!!node.GetAttr('RES_UL_SPACE').context || !!prev.GetAttr('RES_UL_SPACE').context) && prev.GetTextColl() === node.GetTextColl();
}

export class SwRootFrame {
  pages: SwPageFrame[] = [];
  /** List numbering of the last layout pass, with footnote paragraphs' numbers. */
  m_aNums = new Map<SwTextNode, SwNodeNum>();
  /** Comment anchors of the last layout pass, with their line, for the sidebar (SwPostItMgr). */
  m_aAnnotationAnchors: { field: SwPostItField; node: SwTextNode; x: number; y: number; h: number; page: SwPageFrame }[] = [];
  /** View > Comments: the sidebar is shown beside the pages when the document has comments. */
  m_bShowComments = true;
  /** Where each paragraph that can anchor flys starts: its page and geometry (the master frame). */
  m_aParaGeometry = new Map<SwTextNode, { page: SwPageFrame; g: AnchorGeometry }>();
  /** Graphics anchored as characters, with their rectangles, for selecting them with the mouse. */
  m_aAsCharFlys: { name: string; rect: SwRect; page: SwPageFrame }[] = [];
  /** Footnote numbers by id, in document order (SwFootnoteIdxs). */
  m_aFootnoteNums = new Map<string, string>();
  /** Endnote ids, in document order: their text is laid out at the end (SwEndNoteInfo). */
  m_aEndnotes: string[] = [];
  private m_aFootnoteFmts = new Map<string, SwNumFormat>();
  private cache = new WeakMap<SwTextNode, CacheEntry>();
  private doc: SwDoc;
  private m: TextMeasurer;
  /** Page context for field expansion while laying out. */
  private m_nPage = 1;
  private m_nPageCount = 1;
  /** The page of the last header or footer hit, where its caret is shown (it repeats on every page). */
  private m_nPreferPage = 0;
  private expand: FieldExpander = (f) => {
    if (f.fixed !== undefined) return f.fixed;
    switch (f.type) {
      case 'PageNumber': return String(this.m_nPage);
      case 'PageCount': return String(this.m_nPageCount);
      case 'Date': return new Date().toLocaleDateString();
      case 'Time': return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      case 'Sequence': return ExpandSeq(f, this.m_aSeqNums.get(f) ?? 1);
    }
  };
  /** The number range fields' numbers of the last layout pass. */
  private m_aSeqNums = new Map<SwField, number>();

  constructor(doc: SwDoc, measurer: TextMeasurer) {
    this.doc = doc;
    this.m = measurer;
  }

  private format(node: SwTextNode, width: number, opt?: { lineArea?: LineAreaFn; nStart?: number }): SwParaPortion {
    // Lines around objects depend on where the paragraph is: never cached.
    const hideDeleted = !this.doc.m_pDocumentRedlineManager.m_bShow;
    if (opt?.lineArea || opt?.nStart) {
      return FormatParagraph(node, width, this.m, this.m_aNums.get(node), this.expand, (id) => this.m_aFootnoteNums.get(id) ?? '', { ...opt, hideDeleted });
    }
    const hit = this.cache.get(node);
    const num = this.m_aNums.get(node);
    // Paragraphs with fields depend on the page context.
    const fields = node.GetText().includes(CH_TXTATR_BREAKWORD)
      ? `${this.m_nPage}/${this.m_nPageCount}/${new Date().toDateString()}/${node.m_aHints.filter((h) => h.aAttrs.RES_TXTATR_FTN).map((h) => this.m_aFootnoteNums.get(h.aAttrs.RES_TXTATR_FTN!.id)).join(',')}/${node.m_aHints.filter((h) => h.aAttrs.RES_TXTATR_FIELD?.type === 'Sequence').map((h) => this.m_aSeqNums.get(h.aAttrs.RES_TXTATR_FIELD!)).join(',')}`
      : '';
    const format = this.doc.m_nFormatVersion;
    if (hit && hit.version === node.m_nVersion && hit.format === format && hit.width === width && sameNum(hit.num, num) && hit.fields === fields) return hit.para;
    const para = FormatParagraph(node, width, this.m, num, this.expand, (id) => this.m_aFootnoteNums.get(id) ?? '', { hideDeleted });
    this.cache.set(node, { version: node.m_nVersion, format, width, num, fields, para });
    return para;
  }

  InvalidateFonts(): void { this.cache = new WeakMap(); }

  // --- paragraph borders (frmtool.cxx SwBorderAttrs) ---

  /** Space the border takes inside the paragraph area: line width and distance, where there is a line. */
  /**
   * SwFlowFrame::CalcUpperSpace: the space between two paragraphs is the sum of the lower and upper
   * spacing with PARA_SPACE_MAX ("Add spacing between paragraphs and tables"), else the larger.
   */
  private paraSpace(prevLower: number, upper: number): number {
    return this.doc.m_bParaSpaceMax ? prevLower + upper : Math.max(prevLower, upper);
  }

  /**
   * SwFrame::IsCollapseUpper: in Word 2013+ layout, a paragraph at the top of the body of a page
   * other than the first has no upper spacing, unless it starts a page style.
   */
  private IsCollapseUpper(node: SwTextNode, page: SwPageFrame): boolean {
    if (!this.doc.m_bTabOverSpacing || this.doc.m_bTabOverMargin) return false;
    return page.nIndex > 0 && node.m_aSet.RES_PAGEDESC === undefined;
  }

  /**
   * SwFlowFrame::CalcUpperSpace for a paragraph at the top of a page or column: its upper spacing
   * counts only with PARA_SPACE_MAX_AT_PAGES ("Add paragraph and table spacing at tops of pages"),
   * and then only on the first page or after a break (HasParaSpaceAtPages), unless IsCollapseUpper.
   */
  private UpperAtTop(node: SwTextNode, page: SwPageFrame, colIdx: number, hardBreak: boolean): number {
    if (!this.doc.m_bParaSpaceMaxAtPages) return 0;
    if (!hardBreak && (page.nIndex > 0 || colIdx > 0)) return 0;
    return this.IsCollapseUpper(node, page) ? 0 : node.GetAttr('RES_UL_SPACE').upper;
  }

  private borderInsets(n: SwTextNode): { l: number; r: number; t: number; b: number } {
    const box = n.GetAttr('RES_BOX');
    const side = (line: { width: number } | null) => (line ? line.width + (box?.padding ?? 0) : 0);
    return box ? { l: side(box.left), r: side(box.right), t: side(box.top), b: side(box.bottom) } : { l: 0, r: 0, t: 0, b: 0 };
  }

  /** SwBorderAttrs::JoinWithCmp: equal lines and equal left and right edges join two paragraphs' borders. */
  private joinedBorders(a: SwTextNode | undefined, b: SwTextNode | undefined): boolean {
    if (!a || !b || !a.IsTextNode() || !b.IsTextNode()) return false;
    const ba = a.GetAttr('RES_BOX'), bb = b.GetAttr('RES_BOX');
    if (!ba || !bb || !a.GetAttr('RES_PARATR_CONNECT_BORDER') || JSON.stringify(ba) !== JSON.stringify(bb)) return false;
    const la = ListIndents(a, this.m_aNums.get(a)), lb = ListIndents(b, this.m_aNums.get(b));
    return la.left === lb.left && la.right === lb.right;
  }

  /** The paragraph area (between its indents) from `top` to `bottom`, if it has borders or a background. */
  private paraBorder(n: SwTextNode, areaLeft: number, areaWidth: number, top: number, bottom: number, drawTop: boolean, drawBottom: boolean): SwParaBorder | undefined {
    const box = n.GetAttr('RES_BOX'), background = n.GetAttr('RES_BACKGROUND');
    if (!box && !background) return undefined;
    const lr = ListIndents(n, this.m_aNums.get(n));
    return { rect: new SwRect(areaLeft + lr.left, top, areaWidth - lr.left - lr.right, bottom - top), top: drawTop, bottom: drawBottom, box, background };
  }

  // --- flys (objectpositioning, txtfly.cxx) ---

  /**
   * SwAnchoredObjectPosition: the fly's frame from its orientation, against its anchor paragraph
   * (or none, for page anchors) and the page. Text frames lay out their content to find their height.
   */
  private positionFly(fmt: SwFlyFrameFormat, page: SwPageFrame, anchor: AnchorGeometry | null, node?: SwTextNode, nContent?: number): SwFlyFrame {
    const pf = page.aFrame, pp = page.aPrt;
    const h = fmt.m_aHoriOrient, v = fmt.m_aVertOrient;
    // SwToContentAnchoredObjectPosition: a character anchor's character rectangle.
    const ch = fmt.m_aAnchor.m_eAnchorId === RndStdIds.FLY_AT_CHAR && nContent !== undefined ? anchor?.charRect?.(nContent) ?? null : null;
    // SwEnvironmentOfAnchoredObject and _GetHoriAlignmentValues: the area the orientation relates to.
    let rel: { left: number; width: number };
    switch (h.m_eRelation) {
      case RelOrientation.PAGE_FRAME: rel = { left: pf.Left(), width: pf.Width() }; break;
      case RelOrientation.PAGE_PRINT_AREA: rel = { left: pp.Left(), width: pp.Width() }; break;
      case RelOrientation.PAGE_LEFT: rel = { left: pf.Left(), width: pp.Left() - pf.Left() }; break;
      case RelOrientation.PAGE_RIGHT: rel = { left: pp.Right(), width: pf.Right() - pp.Right() }; break;
      case RelOrientation.FRAME_LEFT: rel = anchor ? { left: anchor.left, width: anchor.printLeft - anchor.left } : { left: pf.Left(), width: pp.Left() - pf.Left() }; break;
      case RelOrientation.FRAME_RIGHT: rel = anchor ? { left: anchor.printLeft + anchor.printWidth, width: anchor.left + anchor.width - anchor.printLeft - anchor.printWidth } : { left: pp.Right(), width: pf.Right() - pp.Right() }; break;
      case RelOrientation.CHAR: rel = ch ? { left: ch.x, width: 0 } : anchor ? { left: anchor.printLeft, width: anchor.printWidth } : { left: pp.Left(), width: pp.Width() }; break;
      case RelOrientation.PRINT_AREA: rel = anchor ? { left: anchor.printLeft, width: anchor.printWidth } : { left: pp.Left(), width: pp.Width() }; break;
      default: rel = anchor ? { left: anchor.left, width: anchor.width } : { left: pf.Left(), width: pf.Width() };
    }
    let relV: { top: number; height: number };
    switch (v.m_eRelation) {
      case RelOrientation.PAGE_FRAME: relV = { top: pf.Top(), height: pf.Height() }; break;
      case RelOrientation.PAGE_PRINT_AREA: relV = { top: pp.Top(), height: pp.Height() }; break;
      case RelOrientation.PAGE_PRINT_AREA_TOP: relV = { top: pf.Top(), height: pp.Top() - pf.Top() }; break;
      case RelOrientation.PAGE_PRINT_AREA_BOTTOM: relV = { top: pp.Bottom(), height: pf.Bottom() - pp.Bottom() }; break;
      case RelOrientation.CHAR: case RelOrientation.TEXT_LINE:
        if (ch) { relV = { top: ch.lineTop, height: ch.lineHeight }; break; }
        relV = anchor ? { top: anchor.printTop, height: 0 } : { top: pp.Top(), height: pp.Height() }; break;
      case RelOrientation.PRINT_AREA:
        relV = anchor ? { top: anchor.printTop, height: 0 } : { top: pp.Top(), height: pp.Height() }; break;
      default: relV = anchor ? { top: anchor.top, height: 0 } : { top: pf.Top(), height: pf.Height() };
    }
    // Text frames: the content decides the height when it grows (SwFlyFreeFrame::MakeAll with auto height).
    const box = fmt.m_aBox, pad = box?.padding ?? 0;
    const ins = { l: (box?.left?.width ?? 0) + pad, r: (box?.right?.width ?? 0) + pad, t: (box?.top?.width ?? 0) + pad, b: (box?.bottom?.width ?? 0) + pad };
    const section = fmt.m_sContentId ? this.doc.GetNodes().FindFlySection(fmt.m_sContentId) : null;
    let w = fmt.m_nWidth;
    if (section && fmt.m_bAutoWidth) {
      // SwFlyFrame::CalcContent with a minimum width: as wide as the widest line, within the area.
      const most = Math.max(1, (w || rel.width) - ins.l - ins.r);
      const lines = this.placeSection(section, 0, 0, most).frames.flatMap((f) => {
        const lr = f.node.GetAttr('RES_LR_SPACE');
        // SwTextFrame::CalcFitToContent: the whole line, trailing blanks included, so that the
        // content needs no other break when formatted at this width.
        const full = (l: SwLineLayout) => Math.max(l.nWidth, ...l.portions.map((p) => p.nX + p.nWidth));
        return f.lines.map((l) => full(l) + lr.left + lr.right + (l === f.lines[0] ? Math.max(0, lr.firstLine) : 0));
      });
      w = Math.ceil(Math.max(0, ...lines)) + ins.l + ins.r + 1;
    }
    let height = fmt.m_nHeight;
    if (section && fmt.m_bAutoHeight) height = Math.max(height, this.placeSection(section, 0, 0, Math.max(1, w - ins.l - ins.r)).height + ins.t + ins.b);
    // _CalcRelPosX: alignment within the area, with the wrap spacing on the aligned side.
    let x: number;
    switch (h.m_eOrient) {
      case HoriOrientation.LEFT: case HoriOrientation.INSIDE: x = rel.left + fmt.m_nLeftSpace; break;
      case HoriOrientation.RIGHT: case HoriOrientation.OUTSIDE: x = rel.left + rel.width - w - fmt.m_nRightSpace; break;
      case HoriOrientation.CENTER: case HoriOrientation.FULL: x = rel.left + (rel.width - w) / 2; break;
      default: x = rel.left + h.m_nPos;
    }
    let y: number;
    switch (v.m_eOrient) {
      case VertOrientation.TOP: case VertOrientation.LINE_TOP: case VertOrientation.CHAR_TOP: y = relV.top + fmt.m_nUpperSpace; break;
      case VertOrientation.BOTTOM: case VertOrientation.LINE_BOTTOM: case VertOrientation.CHAR_BOTTOM: y = relV.top + relV.height - height - fmt.m_nLowerSpace; break;
      case VertOrientation.CENTER: case VertOrientation.LINE_CENTER: case VertOrientation.CHAR_CENTER: y = relV.top + (relV.height - height) / 2; break;
      default: y = relV.top + v.m_nPos;
    }
    // SwAnchoredObjectPosition::GetAdjustedRelPosY: the object stays within the page.
    if (fmt.m_aAnchor.m_eAnchorId !== RndStdIds.FLY_AT_PAGE) y = Math.max(pf.Top(), Math.min(y, pf.Bottom() - height));
    let aFrame = new SwRect(Math.round(x), Math.round(y), w, height);
    // RotateFlyFrame3: a rotated graphic's frame is the bounds of the rotated frame around its centre.
    if (fmt.m_nGrfRotation && fmt.graphic !== undefined) {
      const b = RotatedBoundSize(w, height, fmt.m_nGrfRotation);
      aFrame = new SwRect(Math.round(x + (w - b.width) / 2), Math.round(y + (height - b.height) / 2), b.width, b.height);
    }
    const aBound = new SwRect(aFrame.Left() - fmt.m_nLeftSpace, aFrame.Top() - fmt.m_nUpperSpace, aFrame.Width() + fmt.m_nLeftSpace + fmt.m_nRightSpace, aFrame.Height() + fmt.m_nUpperSpace + fmt.m_nLowerSpace);
    const fly: SwFlyFrame = { fmt, aFrame, aBound, node, frames: [], tabs: [], aRelH: rel, aRelV: relV };
    if (section && fmt.m_pShape) {
      // SdrTextObj in a custom shape: the text area of the geometry (EnhancedCustomShape2d::
      // GetTextRect) less the insets, with the text aligned vertically in it.
      const geom = fmt.m_pShape.m_aGeometry ?? GetCustomShapeContent(fmt.m_pShape.m_sType) ?? GetCustomShapeContent('rectangle')!;
      const tr = new EnhancedCustomShape2d(fmt.m_pShape.m_sType, geom, w, height, true, true, fmt.m_pShape.m_aAdjust).GetTextRect();
      const tw = Math.max(1, tr.w - ins.l - ins.r);
      const th = this.placeSection(section, 0, 0, tw).height;
      const adj = fmt.m_pShape.m_eTextVertAdjust ?? 'center';
      const free = tr.h - ins.t - ins.b - th;
      const top = aFrame.Top() + tr.y + ins.t + (adj === 'top' ? 0 : adj === 'bottom' ? free : free / 2);
      const placed = this.placeSection(section, aFrame.Left() + tr.x + ins.l, top, tw);
      for (const f of placed.frames) f.pArea = 'fly';
      fly.frames = placed.frames;
      fly.tabs = placed.tabs;
    } else if (section && fmt.m_eFrameDir) {
      // Vertical text (SwFrame::IsVertical): lines as long as the frame is high, laid out unrotated
      // and turned onto the page as a vertical cell's content is.
      const x0 = aFrame.Left() + ins.l, y0 = aFrame.Top() + ins.t;
      const placed = this.placeSection(section, x0, y0, Math.max(1, height - ins.t - ins.b));
      fly.aVert = fmt.m_eFrameDir === 'bt-lr'
        ? [0, -1, 1, 0, x0 - y0, aFrame.Top() + height - ins.b + x0]
        : [0, 1, -1, 0, aFrame.Left() + w - ins.r + y0, y0 - x0];
      for (const f of placed.frames) { f.pArea = 'fly'; f.aVert = fly.aVert; }
      fly.frames = placed.frames;
      fly.tabs = placed.tabs;
    } else if (section) {
      const placed = this.placeSection(section, aFrame.Left() + ins.l, aFrame.Top() + ins.t, Math.max(1, w - ins.l - ins.r));
      for (const f of placed.frames) f.pArea = 'fly';
      fly.frames = placed.frames;
      fly.tabs = placed.tabs;
    }
    return fly;
  }

  /** Positions the paragraph and character anchored flys of a paragraph on a page. */
  private placeAnchoredFlys(node: SwTextNode, page: SwPageFrame, g: AnchorGeometry): void {
    this.m_aParaGeometry.set(node, { page, g });
    for (const a of node.m_aAnchoredFlys) page.flys.push(this.positionFly(a.fmt, page, g, node, a.nContent));
  }

  /** SwTextFly::GetSurroundForTextWrap: "optimal" decides by the space beside the object. */
  private surroundFor(f: SwFlyFrame, areaL: number, areaR: number, self?: SwTextNode): WrapTextMode {
    // Wrap First Paragraph: the other paragraphs do not flow beside the object.
    const a = f.fmt.m_aAnchor.m_eAnchorId;
    if (f.fmt.m_aSurround.m_bAnchorOnly && f.node !== self && (a === RndStdIds.FLY_AT_PARA || a === RndStdIds.FLY_AT_CHAR)) return WrapTextMode.NONE;
    const e = f.fmt.m_aSurround.m_eSurround;
    if (e !== WrapTextMode.DYNAMIC) return e;
    const nFlyLeft = f.aBound.Left(), nFlyRight = f.aBound.Left() + f.aBound.Width();
    if (nFlyRight < areaL || nFlyLeft > areaR) return WrapTextMode.PARALLEL;
    let nLeft = nFlyLeft - areaL, nRight = areaR - nFlyRight;
    if (nFlyRight - nFlyLeft > FRAME_MAX) { if (nLeft < nRight) nLeft = 0; else nRight = 0; }
    if (nLeft <= 0 && nRight <= 0) return WrapTextMode.PARALLEL;
    if (nLeft < TEXT_MIN) nLeft = 0;
    if (nRight < TEXT_MIN) nRight = 0;
    if (nLeft) return nRight ? WrapTextMode.PARALLEL : WrapTextMode.LEFT;
    return nRight ? WrapTextMode.RIGHT : WrapTextMode.NONE;
  }

  /**
   * SwTextFly for a paragraph at `top` (absolute) whose text area is [left, left + width): the
   * spans its lines may use beside the wrapping objects on the page. Undefined when none matter.
   */
  private wrapArea(page: SwPageFrame, left: number, width: number, top: number, self?: SwTextNode): LineAreaFn | undefined {
    const areaL = left, areaR = left + width;
    // Edges are exclusive here: SwRect's Right() and Bottom() are the last covered twip.
    const right = (r: SwRect) => r.Left() + r.Width(), bottom = (r: SwRect) => r.Top() + r.Height();
    const obst = page.flys.filter((f) => f.fmt.m_aSurround.m_eSurround !== WrapTextMode.THROUGH && bottom(f.aBound) > top
      && right(f.aBound) > areaL && f.aBound.Left() < areaR && !(self && f.frames.some((fr) => fr.node === self)));
    if (!obst.length) return undefined;
    return (lineTop, h) => {
      const y0 = top + lineTop, y1 = y0 + h;
      const hits = obst.filter((f) => f.aBound.Top() < y1 && bottom(f.aBound) > y0);
      if (!hits.length) return null;
      let free: [number, number][] = [[areaL, areaR]];
      for (const f of hits) {
        const fl = f.aBound.Left(), fr = right(f.aBound);
        let block: [number, number];
        switch (this.surroundFor(f, areaL, areaR, self)) {
          case WrapTextMode.NONE: block = [areaL, areaR]; break;
          case WrapTextMode.LEFT: block = [fl, areaR]; break; // the text flows on the left
          case WrapTextMode.RIGHT: block = [areaL, fr]; break;
          default: block = [fl, fr];
        }
        free = free.flatMap(([a, b]) => {
          if (block[1] <= a || block[0] >= b) return [[a, b] as [number, number]];
          const out: [number, number][] = [];
          if (block[0] > a) out.push([a, block[0]]);
          if (block[1] < b) out.push([block[1], b]);
          return out;
        });
      }
      return { segs: free.map(([a, b]) => [a - left, b - left] as [number, number]), next: Math.min(...hits.map((f) => bottom(f.aBound))) - top };
    };
  }

  /** The fly at a document point, the topmost first (SwFEShell::GetSelectableFrameFormat by point). */
  GetFlyAt(pt: Point): SwFlyFrame | null {
    for (const a of this.m_aAsCharFlys) {
      if (!a.rect.Contains(pt)) continue;
      const loc = this.doc.FindFlyByName(a.name);
      if (loc?.asChar) {
        const fmt = { ...AsCharFormat(loc.asChar) };
        return { fmt, aFrame: a.rect, aBound: a.rect, node: loc.node, frames: [], tabs: [], aRelH: { left: a.rect.Left(), width: 0 }, aRelV: { top: a.rect.Top(), height: 0 } };
      }
    }
    for (const page of this.pages) {
      if (!page.aFrame.Contains(pt)) continue;
      for (let i = page.flys.length - 1; i >= 0; i--) {
        const f = page.flys[i]!;
        if (f.aFrame.Contains(pt) && f.fmt.m_bOpaque) return f;
      }
      for (let i = page.flys.length - 1; i >= 0; i--) {
        const f = page.flys[i]!;
        if (f.aFrame.Contains(pt)) return f;
      }
    }
    return null;
  }

  /** The laid out frame of the named fly, if it is on a page. */
  FindFly(name: string): { fly: SwFlyFrame; page: SwPageFrame } | null {
    for (const page of this.pages) for (const fly of page.flys) if (fly.fmt.m_aName === name) return { fly, page };
    const a = this.m_aAsCharFlys.find((x) => x.name === name);
    const loc = a && this.doc.FindFlyByName(name);
    if (a && loc?.asChar) return { fly: { fmt: AsCharFormat(loc.asChar), aFrame: a.rect, aBound: a.rect, node: loc.node, frames: [], tabs: [], aRelH: { left: a.rect.Left(), width: 0 }, aRelV: { top: a.rect.Top(), height: 0 } }, page: a.page };
    return null;
  }

  /** The page and geometry a paragraph's flys are positioned against, from the last layout. */
  GetAnchorGeometry(node: SwTextNode): { page: SwPageFrame; g: AnchorGeometry } | undefined { return this.m_aParaGeometry.get(node); }

  /** The page containing a document point, or the nearest. */
  GetPageAt(pt: Point): SwPageFrame {
    let best = this.pages[0]!, d = Infinity;
    for (const p of this.pages) {
      const dd = pt.Y() < p.aFrame.Top() ? p.aFrame.Top() - pt.Y() : pt.Y() > p.aFrame.Bottom() ? pt.Y() - p.aFrame.Bottom() : 0;
      if (dd < d) { d = dd; best = p; }
    }
    return best;
  }

  // --- tables (tabfrm.cxx) ---

  /** Table position and width within an area (SwTabFrame::Format with the table's HoriOrient). */
  private tableGeometry(t: SwTableNode, left: number, width: number): { x: number; w: number } {
    const a = t.m_pTable.m_aAttrs;
    if (a.adjust === 'full' || !a.width) return { x: left, w: width };
    const w = a.width;
    switch (a.adjust) {
      case 'center': return { x: left + (width - w) / 2, w };
      case 'right': return { x: left + width - w - (a.rightSpace ?? 0), w };
      default: return { x: left + a.leftSpace, w };
    }
  }

  /**
   * Lays out the content of a section (a cell) without page breaks. `onFlys` positions the flys
   * anchored in it; measuring passes leave it out.
   */
  /**
   * `bLastLineSpacing`: SwFlowFrame::CalcLowerSpace adds the last paragraph's line spacing below it in
   * table cells (ADD_PARA_LINE_SPACING_TO_TABLE_CELLS) and in headers and footers
   * (HEADER_SPACING_BELOW_LAST_PARA).
   */
  private placeSection(start: SwStartNode, x: number, y: number, width: number, onFlys?: FlyPlacer, bLastLineSpacing = false): Placed {
    const nodes = this.doc.GetNodes();
    const frames: SwTextFrame[] = [];
    const tabs: SwTabFrame[] = [];
    let top = y, prevLower = 0, prevLineSpace = 0, first = true;
    const end = start.EndOfSectionNode().GetIndex();
    for (let i = start.GetIndex() + 1; i < end;) {
      const n = nodes.node(i);
      if (n.IsTextNode()) {
        const ins = this.borderInsets(n);
        const prev = nodes.node(i - 1), next = nodes.node(i + 1);
        const jp = this.joinedBorders(prev.IsTextNode() ? prev : undefined, n), jn = this.joinedBorders(n, next.IsTextNode() ? next : undefined);
        const para = this.format(n, Math.max(1, width - ins.l - ins.r));
        const ul = n.GetAttr('RES_UL_SPACE');
        const upper = first ? ul.upper : (prev.IsTextNode() && SameContext(prev, n) ? 0 : this.paraSpace(prevLower, ul.upper)) + prevLineSpace;
        if (onFlys && n.m_aAnchoredFlys.length) {
          const lr = ListIndents(n, this.m_aNums.get(n));
          onFlys(n, { left: x, width, printLeft: x + lr.left, printWidth: width - lr.left - lr.right, top, printTop: top + upper });
        }
        top += upper;
        const boxTop = jp ? top - upper : top;
        if (!jp) top += ins.t;
        const frame: SwTextFrame = { node: n, nLeft: x + ins.l, nTop: top, nWidth: Math.max(1, width - ins.l - ins.r), lines: para.lines, nHeight: para.nHeight, bMaster: true, bHasFollow: false };
        top += para.nHeight;
        if (!jn) top += ins.b;
        frame.pBorder = this.paraBorder(n, x, width, boxTop, top, !jp, !jn);
        frames.push(frame);
        prevLineSpace = GetLineSpace(n, para.lines);
        prevLower = ul.lower;
        i++;
      } else if (n.IsTableNode()) {
        const t = n as SwTableNode;
        top += prevLower + prevLineSpace;
        const g = this.tableGeometry(t, x, width);
        const rows = this.measureRows(t, g.x, g.w);
        const tab: SwTabFrame = { node: t, aFrame: new SwRect(g.x, top, g.w, 0), rows: [] };
        for (const [ri, r] of rows.entries()) {
          const row = this.placeRow(t, r, top, rows.slice(ri + 1, ri + r.span).map((x) => x.height), onFlys);
          tab.rows.push(row);
          for (const c of row.cells) { frames.push(...c.frames); }
          top += r.height;
        }
        tab.aFrame = new SwRect(g.x, tab.aFrame.Top(), g.w, top - tab.aFrame.Top());
        tabs.push(tab);
        prevLower = 0; prevLineSpace = 0;
        i = t.EndOfSectionNode().GetIndex() + 1;
      } else i++;
      first = false;
    }
    const last = nodes.node(end - 1);
    const lastSpacing = bLastLineSpacing && last.IsTextNode() ? CalcLineSpacing(last) : 0;
    return { frames, tabs, height: top - y + prevLower + lastSpacing };
  }

  /** Column geometry and content height of every row, with vertical merges resolved. */
  private measureRows(t: SwTableNode, x: number, w: number): { line: number; cells: { box: SwTableBox; x: number; w: number }[]; height: number; span: number }[] {
    const lines = t.m_pTable.GetTabLines();
    const rows = lines.map((line, li) => {
      const total = line.m_aBoxes.reduce((s, b) => s + b.m_aAttrs.width, 0) || 1;
      let cx = x;
      const cells = line.m_aBoxes.map((box) => {
        const cw = (box.m_aAttrs.width / total) * w;
        const c = { box, x: cx, w: cw };
        cx += cw;
        return c;
      });
      return { line: li, cells, height: line.m_aAttrs.minHeight, span: 1 };
    });
    // Heights of single-row cells first, then grow the last row of each vertical merge.
    const needs: { from: number; to: number; need: number }[] = [];
    rows.forEach((r, li) => {
      for (const c of r.cells) {
        const span = c.box.getRowSpan();
        if (span < 0) continue;
        // A vertical cell's content takes the height it gets.
        const need = c.box.m_aAttrs.frameDir ? this.cellInsets(c.box).t + this.cellInsets(c.box).b : this.measureCell(c.box, c.w);
        // SwFrameSize::Fixed: the row has its height whatever its content needs.
        if (lines[li]!.m_aAttrs.fixHeight && lines[li]!.m_aAttrs.minHeight) continue;
        if (span <= 1) r.height = Math.max(r.height, need);
        else needs.push({ from: li, to: Math.min(rows.length - 1, li + span - 1), need });
      }
    });
    for (const { from, to, need } of needs) {
      const have = rows.slice(from, to + 1).reduce((s, r) => s + r.height, 0);
      if (need > have && !lines[to]!.m_aAttrs.fixHeight) rows[to]!.height += need - have;
      for (let k = from; k < to; k++) rows[k]!.span = Math.max(rows[k]!.span, to - k + 1);
    }
    return rows;
  }

  private cellInsets(box: SwTableBox): { l: number; t: number; r: number; b: number } {
    const a = box.m_aAttrs, bx = a.box, p = a.padding;
    return { l: p + (bx.left?.width ?? 0), t: (a.dist?.top ?? p) + (bx.top?.width ?? 0), r: p + (bx.right?.width ?? 0), b: (a.dist?.bottom ?? p) + (bx.bottom?.width ?? 0) };
  }

  private measureCell(box: SwTableBox, w: number): number {
    const ins = this.cellInsets(box);
    return this.placeSection(box.m_pStartNode!, 0, 0, Math.max(1, w - ins.l - ins.r), undefined, true).height + ins.t + ins.b;
  }

  /** Places one measured row at `top`. Merged cells extend over the rows they cover. */
  private placeRow(t: SwTableNode, r: ReturnType<SwRootFrame['measureRows']>[number], top: number, rowsBelow?: number[], onFlys?: FlyPlacer): SwRowFrame {
    const lines = t.m_pTable.GetTabLines();
    const row: SwRowFrame = { aFrame: new SwRect(r.cells[0]?.x ?? 0, top, r.cells.reduce((s, c) => s + c.w, 0), r.height), cells: [], bRepeated: false };
    for (const c of r.cells) {
      const span = c.box.getRowSpan();
      if (span < 0) continue;
      let h = r.height;
      if (span > 1) {
        // Heights of the covered rows follow this one.
        for (let k = 1; k < span && r.line + k < lines.length; k++) h += rowsBelow?.[k - 1] ?? 0;
      }
      const ins = this.cellInsets(c.box);
      const a = c.box.m_aAttrs, dir = a.frameDir;
      // The content's extent across its lines, and the room it has there.
      const lineW = Math.max(1, dir ? h - ins.t - ins.b : c.w - ins.l - ins.r);
      const room = dir ? c.w - ins.l - ins.r : h - ins.t - ins.b;
      // SwFormatVertOrient (lcl_ArrangeLowers): centred or at the bottom of the room.
      let off = 0;
      if (a.vertOrient) {
        const need = this.placeSection(c.box.m_pStartNode!, 0, 0, lineW, undefined, true).height;
        off = Math.max(0, a.vertOrient === 'center' ? (room - need) / 2 : room - need);
      }
      const x0 = c.x + ins.l, y0 = top + ins.t;
      const placed = this.placeSection(c.box.m_pStartNode!, x0, y0 + (dir ? 0 : off), lineW, onFlys, true);
      const cell: SwCellFrame = { box: c.box, aFrame: new SwRect(c.x, top, c.w, h), frames: placed.frames, tabs: placed.tabs };
      // Bottom to top: the lines' start is at the cell's bottom and they stack rightwards;
      // top to bottom: the lines start at the top and stack leftwards.
      if (dir === 'bt-lr') cell.aVert = [0, -1, 1, 0, x0 + off - y0, top + h - ins.b + x0];
      else if (dir === 'tb-rl') cell.aVert = [0, 1, -1, 0, c.x + c.w - ins.r - off + y0, y0 - x0];
      for (const f of placed.frames) f.pCell ??= cell;
      row.cells.push(cell);
    }
    return row;
  }

  /** Lays out the document; again if the page count that fields showed turned out different. */
  Layout(): void {
    this.m_nPageCount = Math.max(1, this.pages.length);
    for (let pass = 0; pass < 3; pass++) {
      this.LayoutPass();
      if (this.pages.length === this.m_nPageCount) break;
      this.m_nPageCount = this.pages.length;
    }
  }

  private LayoutPass(): void {
    let pd = this.doc.m_aPageDesc;
    const nodes = this.doc.GetNodes();
    let width = pd.PrintWidth();
    // Pages narrower than the widest are centred in the view.
    const maxWidth = Math.max(...[...this.doc.m_aPageDescs.values()].map((d) => d.nWidth));
    let virtNum = 0;
    let firstOfRun = true;
    const pages: SwPageFrame[] = [];
    let page!: SwPageFrame;
    let y = 0; // next free y on the current page, absolute
    let bottom = 0; // first y past the print area
    let atTop = true;
    let prevLower = 0, prevLineSpace = 0;

    // SwPageDesc: the first page uses the first page's header if there is one; even (left) pages
    // the left one; all others the master's.
    const areaFor = (eTyp: SwStartNodeType, nPage: number): SwStartNode | null => {
      const main = nodes.FindAreaSection(eTyp, 'default', pd.m_aName);
      if (!main) return null;
      // The first page of a run of pages of this style ("Same content on first page" off).
      if (firstOfRun) { const f = nodes.FindAreaSection(eTyp, 'first', pd.m_aName); if (f) return f; }
      if (nPage % 2 === 0) { const l = nodes.FindAreaSection(eTyp, 'left', pd.m_aName); if (l) return l; }
      return main;
    };

    // Footnotes of the current page and the height of its footnote area, separator included.
    let pageFtns: string[] = [];
    let ftnArea = 0;
    const ftnHeights = new Map<string, number>();
    const ftnHeight = (id: string): number => {
      let h = ftnHeights.get(id);
      if (h === undefined) {
        const sec = nodes.FindFootnoteSection(id);
        h = sec ? this.placeSection(sec, 0, 0, width).height : 0;
        ftnHeights.set(id, h);
      }
      return h;
    };
    /** Footnote ids anchored in a range of a paragraph's text (endnotes go to the end instead). */
    const anchorsIn = (n: SwTextNode, start: number, end: number): string[] =>
      n.m_aHints.filter((h) => h.aAttrs.RES_TXTATR_FTN && !h.aAttrs.RES_TXTATR_FTN.endnote && h.nStart >= start && h.nStart < end).map((h) => h.aAttrs.RES_TXTATR_FTN!.id);
    /** Extra footnote area height that these footnotes need on the current page. */
    const ftnNeed = (ids: string[]): number => {
      const fresh = ids.filter((id) => !pageFtns.includes(id));
      if (!fresh.length) return 0;
      return fresh.reduce((s, id) => s + ftnHeight(id), 0) + (ftnArea ? 0 : FTN_SEPARATOR);
    };
    const addFtns = (ids: string[]) => { ftnArea += ftnNeed(ids); for (const id of ids) if (!pageFtns.includes(id)) pageFtns.push(id); };
    /** SwFootnoteContFrame: footnotes at the bottom of the body area, below a separator line. */
    const finishFootnotes = () => {
      if (!pageFtns.length) return;
      const left = page.aPrt.Left();
      const top = bottom - ftnArea;
      page.aFootnote = new SwRect(left, top, width, ftnArea);
      page.aFootnoteSep = new SwRect(left, top + FTN_TOPDIST, Math.round(width / 4), FTN_LINEWIDTH);
      let fy = top + FTN_SEPARATOR;
      for (const id of pageFtns) {
        const sec = nodes.FindFootnoteSection(id);
        if (!sec) continue;
        const fpage = page;
        const placed = this.placeSection(sec, left, fy, width, (n, g) => this.placeAnchoredFlys(n, fpage, g));
        for (const f of placed.frames) f.pArea = 'footnote';
        page.frames.push(...placed.frames);
        page.tabs.push(...placed.tabs);
        fy += placed.height;
      }
    };

    /**
     * SwFrame::InsertPage: the next page, of the given style or the previous page's follow style,
     * numbered on from the previous page or from `numOffset`.
     */
    const newPage = (desc?: SwPageDesc, numOffset?: number | null) => {
      if (pages.length) { closeColumns(); finishFootnotes(); }
      pageFtns = [];
      ftnArea = 0;
      const prev = pages[pages.length - 1];
      const next = desc ?? (prev ? this.doc.FindPageDesc(prev.pDesc.m_sFollow) ?? this.doc.m_aPageDesc : pd);
      firstOfRun = !prev || next !== prev.pDesc || (numOffset ?? null) !== null;
      pd = next;
      width = pd.PrintWidth();
      virtNum = numOffset ?? virtNum + 1;
      const top = prev ? prev.aFrame.Top() + prev.aFrame.Height() + GAPBETWEENPAGES : DOCUMENTBORDER;
      const pageLeft = DOCUMENTBORDER + Math.round((maxWidth - pd.nWidth) / 2);
      const left = pageLeft + pd.nLeft;
      let bodyTop = top + pd.nTop, bodyBottom = top + pd.nHeight - pd.nBottom;
      page = { nIndex: pages.length, aFrame: new SwRect(pageLeft, top, pd.nWidth, pd.nHeight), aPrt: new SwRect(left, bodyTop, width, 0), frames: [], tabs: [], flys: [], colLines: [], pDesc: pd, nVirtNum: virtNum };
      const thisPage = page;
      // Header and footer flys are positioned once the page's print area is known (their page
      // relative orientations need it).
      const deferred: (() => void)[] = [];
      const flysHere: FlyPlacer = (n, g) => { deferred.push(() => this.placeAnchoredFlys(n, thisPage, g)); };
      pages.push(page);
      this.m_nPage = virtNum;
      const header = areaFor(SwStartNodeType.SwHeaderStartNode, virtNum);
      const footer = areaFor(SwStartNodeType.SwFooterStartNode, virtNum);
      const place = (start: SwStartNode, area: SwFrameArea, at: number) => {
        const placed = this.placeSection(start, left, at, width, flysHere, this.doc.m_bHeaderSpacingBelowLastPara);
        for (const f of placed.frames) f.pArea = area;
        page.frames.push(...placed.frames);
        page.tabs.push(...placed.tabs);
        return placed.height;
      };
      if (header) {
        const h = Math.max(pd.nHeaderMinHeight, place(header, 'header', bodyTop));
        page.aHeader = new SwRect(left, bodyTop, width, h);
        bodyTop += h + pd.nHeaderSpacing;
      }
      if (footer) {
        const content = this.placeSection(footer, left, 0, width, undefined, this.doc.m_bHeaderSpacingBelowLastPara).height;
        const h = Math.max(pd.nFooterMinHeight, content);
        place(footer, 'footer', bodyBottom - (pd.bFooterEatSpacing ? content : h));
        page.aFooter = new SwRect(left, bodyBottom - h, width, h);
        bodyBottom -= h + pd.nFooterSpacing;
      }
      page.aPrt = new SwRect(left, bodyTop, width, Math.max(0, bodyBottom - bodyTop));
      for (const d of deferred) d();
      // SwToLayoutAnchoredObjectPosition: the page anchored flys of this page.
      for (const f of this.doc.m_aPageFlys) if (Math.max(1, f.m_aAnchor.m_nPageNumber) === pages.length) page.flys.push(this.positionFly(f, page, null));
      y = bodyTop;
      bottom = bodyBottom;
      atTop = true;
      prevLower = 0; prevLineSpace = 0;
      // The body's columns: those of the section the text is in, else the page's.
      setColumns(flowSec ? flowSec.m_pSection.m_aCol : pd.m_aCol, left, width, bodyTop);
    };

    // --- flow areas: the columns text runs through (SwColumnFrame, reduced) ---
    let cols: { left: number; width: number }[] = [];
    let colSpec: SwFormatCol | null = null;
    let colIdx = 0, colTop = 0;
    let colBottoms: number[] = [];
    /** A trial bottom while columns are balanced (SwSectionFrame::CalcMinDiff, reduced). */
    let limit = Infinity;
    let trial = false;
    /** The section whose columns the text flows through, or null for the page's. */
    let flowSec: SwSectionNode | null = null;
    const OVERFLOW = new Error('column overflow');
    const areaBottom = () => Math.min(bottom, limit);
    const colLeft = () => cols[colIdx]!.left, colWidth = () => cols[colIdx]!.width;
    const setColumns = (spec: SwFormatCol | null, left: number, w: number, top: number) => {
      colSpec = spec;
      cols = CalcColumns(spec, left, w);
      colIdx = 0; colTop = top;
      colBottoms = cols.map(() => top);
    };
    const noteBottom = () => { colBottoms[colIdx] = Math.max(colBottoms[colIdx]!, y); };
    /** Ends the column area on this page: separator lines, and where the text below continues. */
    const closeColumns = (): number => {
      noteBottom();
      const end = Math.max(...colBottoms);
      if (colSpec?.m_bLine && cols.length > 1 && end > colTop) {
        for (let k = 1; k < cols.length; k++) {
          const gapMid = Math.round((cols[k - 1]!.left + cols[k - 1]!.width + cols[k]!.left) / 2);
          page.colLines.push(new SwRect(gapMid - 5, colTop, 10, end - colTop));
        }
      }
      return end;
    };
    /** SwFlowFrame::MoveFwd: on to the next column, or the next page after the last one. */
    const nextColumn = () => {
      noteBottom();
      if (colIdx + 1 < cols.length) { colIdx++; y = colTop; atTop = true; prevLower = 0; prevLineSpace = 0; return; }
      if (trial) throw OVERFLOW;
      newPage();
    };
    /** A page break: always a new page (and no balancing across it). */
    const breakPage = (desc?: SwPageDesc, numOffset?: number | null) => { if (trial) throw OVERFLOW; newPage(desc, numOffset); };
    /** A page style change where nothing is on the page yet: the page is made again in that style. */
    const restartPage = (desc: SwPageDesc, numOffset: number | null) => {
      if (trial) throw OVERFLOW;
      pages.pop();
      virtNum = Math.max(0, virtNum - 1);
      const prev = pages[pages.length - 1];
      if (prev) pd = prev.pDesc;
      newPage(desc, numOffset);
    };

    // Body blocks: paragraphs and tables of the content section and its sections, each with the
    // section whose columns it flows through. Hidden sections are left out (SwSectionFrame is not made).
    const blocks: (SwTextNode | SwTableNode)[] = [];
    const blockSec: (SwSectionNode | null)[] = [];
    const endOfContent = nodes.GetEndOfContent().GetIndex();
    const secStack: SwSectionNode[] = [];
    for (let i = nodes.BodyStart(); i < endOfContent;) {
      const n = nodes.node(i);
      while (secStack.length && i > secStack[secStack.length - 1]!.EndOfSectionNode().GetIndex()) secStack.pop();
      const hidden = secStack.some((x) => x.m_pSection.m_bHidden);
      const flow = [...secStack].reverse().find((x) => (x.m_pSection.m_aCol?.m_nCount ?? 1) > 1) ?? null;
      if (n.IsSectionNode()) { secStack.push(n as SwSectionNode); i++; }
      else if (n.IsTextNode()) { if (!hidden) { blocks.push(n); blockSec.push(flow); } i++; }
      else if (n.IsTableNode()) { if (!hidden) { blocks.push(n as SwTableNode); blockSec.push(flow); } i = (n as SwTableNode).EndOfSectionNode().GetIndex() + 1; }
      else i++;
    }
    // The first page takes the page style of the first paragraph, if it sets one.
    const first = blocks[0];
    const firstDesc = first?.IsTextNode() ? first.GetAttr('RES_PAGEDESC') : null;
    this.m_aParaGeometry = new Map();
    newPage(firstDesc ? this.doc.FindPageDesc(firstDesc.name) ?? this.doc.m_aPageDesc : this.doc.m_aPageDesc, firstDesc?.numOffset ?? null);
    const allText: SwTextNode[] = [];
    for (let n = nodes.GoNext(0); n; n = nodes.GoNext(n.GetIndex())) allText.push(n);
    this.m_aNums = NumberParagraphs(this.doc, allText);
    // Footnotes are numbered by their anchors' order in the body; each footnote's first paragraph
    // starts with its number (SwFootnoteNumPortion), and the text follows at the indent.
    // SwFootnoteInfo numbers footnotes 1, 2, 3; SwEndNoteInfo numbers endnotes i, ii, iii.
    this.m_aFootnoteNums = new Map();
    this.m_aSeqNums = GetSeqNumbers(this.doc);
    this.m_aEndnotes = [];
    let nFootnotes = 0;
    for (let n = nodes.GoNext(nodes.BodyStart() - 1); n; n = nodes.GoNext(n.GetIndex())) {
      for (const h of n.m_aHints) {
        const f = h.aAttrs.RES_TXTATR_FTN;
        if (!f) continue;
        if (f.endnote) { this.m_aEndnotes.push(f.id); this.m_aFootnoteNums.set(f.id, makeNumberingString(NumberingType.ROMAN_LOWER, this.m_aEndnotes.length)); }
        else this.m_aFootnoteNums.set(f.id, String(++nFootnotes));
      }
    }
    for (const [id, nr] of this.m_aFootnoteNums) {
      const sec = nodes.FindFootnoteSection(id);
      const first = sec && nodes.GoNext(sec.GetIndex());
      if (!first) continue;
      const lr = first.GetAttr('RES_LR_SPACE');
      const key = `${id}/${lr.left}/${lr.firstLine}`;
      let fmt = this.m_aFootnoteFmts.get(key);
      if (!fmt) {
        fmt = new SwNumFormat();
        fmt.SetIndentAt(lr.left); fmt.SetFirstLineIndent(lr.firstLine); fmt.SetListtabPos(lr.left); fmt.SetLabelFollowedBy('listtab');
        this.m_aFootnoteFmts.set(key, fmt);
      }
      this.m_aNums.set(first, { rule: FOOTNOTE_RULE, level: 0, fmt, counted: true, label: nr, footnote: true });
    }
    // SwEndNoteInfo: the endnotes' paragraphs follow the body on pages of the Endnote style.
    const endnoteStart = blocks.length;
    for (const id of this.m_aEndnotes) {
      const sec = nodes.FindFootnoteSection(id);
      if (!sec) continue;
      for (let i = sec.GetIndex() + 1; i < sec.EndOfSectionNode().GetIndex();) {
        const n = nodes.node(i);
        if (n.IsTextNode()) { blocks.push(n); blockSec.push(null); i++; }
        else if (n.IsTableNode()) { blocks.push(n as SwTableNode); blockSec.push(null); i = (n as SwTableNode).EndOfSectionNode().GetIndex() + 1; }
        else i++;
      }
    }

    const firstLinesHeight = (p: SwParaPortion, orphans: number) =>
      p.lines.slice(0, Math.max(1, Math.min(orphans, p.lines.length))).reduce((h, l) => h + l.nRealHeight, 0);

    let pendingPageBreak = false;
    const placeBlock = (idx: number) => {
      const block = blocks[idx]!;
      if (block.IsTableNode()) {
        this.layoutBodyTable(block as SwTableNode, () => page, () => y, (v) => { y = v; }, () => areaBottom() - ftnArea, () => atTop, (v) => { atTop = v; }, prevLower + prevLineSpace, nextColumn,
          (frames) => addFtns(frames.flatMap((f) => { const l = f.lines[f.lines.length - 1]; return l ? anchorsIn(f.node, f.lines[0]!.nStart, l.nStart + l.nLen) : []; })),
          () => ({ left: colLeft(), width: colWidth() }));
        prevLower = 0; prevLineSpace = 0;
        pendingPageBreak = false;
        return;
      }
      const node = block as SwTextNode;
      const ins = this.borderInsets(node);
      const prevBlock = blocks[idx - 1], nextBlock = blocks[idx + 1];
      const jp = this.joinedBorders(prevBlock?.IsTextNode() ? prevBlock : undefined, node);
      const jn = this.joinedBorders(node, nextBlock?.IsTextNode() ? nextBlock : undefined);
      const textWidth = Math.max(1, colWidth() - ins.l - ins.r);
      const para = this.format(node, textWidth);
      const ul = node.GetAttr('RES_UL_SPACE');
      const orphans = node.GetAttr('RES_PARATR_ORPHANS');
      const widows = node.GetAttr('RES_PARATR_WIDOWS');
      const brk = node.GetAttr('RES_BREAK');

      // SwFormatPageDesc: a page of another style; on an empty page, that page becomes one.
      const pdesc = idx > 0 ? node.GetAttr('RES_PAGEDESC') : null;
      const descTo = pdesc ? this.doc.FindPageDesc(pdesc.name) ?? this.doc.m_aPageDesc : null;
      if (descTo) {
        const empty = atTop && colIdx === 0 && !page.frames.some((f) => !f.pArea && !f.pCell) && !page.tabs.length;
        if (empty) restartPage(descTo, pdesc!.numOffset); else breakPage(descTo, pdesc!.numOffset);
      } else if ((pendingPageBreak || (brk === 'page-before' && idx > 0)) && !atTop) breakPage();
      else if (brk === 'column-before' && idx > 0 && !atTop) nextColumn();
      // SwFlowFrame::IsPageBreak / IsColBreak: this paragraph starts its page or column by a break.
      const hardBreak = !!descTo || pendingPageBreak || ((brk === 'page-before' || brk === 'column-before') && idx > 0);
      pendingPageBreak = false;

      // SwFlowFrame::CalcUpperSpace
      let upper = atTop ? this.UpperAtTop(node, page, colIdx, hardBreak) : this.paraSpace(prevLower, ul.upper) + prevLineSpace;
      if (!atTop && prevBlock?.IsTextNode() && SameContext(prevBlock, node)) upper = prevLineSpace;

      // Keep-with-next: everything chained must start on one page with the next paragraph's first lines.
      if (!atTop) {
        let need = upper + para.nHeight;
        let k = idx;
        while ((blocks[k] as SwTextNode).GetAttr('RES_KEEP') && k + 1 < blocks.length && blocks[k + 1]!.IsTextNode()) {
          const next = blocks[k + 1] as SwTextNode;
          const nextPara = this.format(next, colWidth());
          const nextUl = next.GetAttr('RES_UL_SPACE');
          need += (blocks[k] as SwTextNode).GetAttr('RES_UL_SPACE').lower + nextUl.upper;
          k++;
          if (next.GetAttr('RES_KEEP')) need += nextPara.nHeight;
          else need += firstLinesHeight(nextPara, next.GetAttr('RES_PARATR_ORPHANS'));
        }
        if (k > idx && y + need > areaBottom()) { nextColumn(); upper = this.UpperAtTop(node, page, colIdx, false); }
      }

      let lines = para.lines;
      let bMaster = true;
      const paraTop = y;
      y += upper;
      // A box joined with the previous paragraph's spans the spacing between them.
      let boxTop = jp && !atTop ? y - upper : y;
      if (!jp) y += ins.t;
      // The flys anchored here go on the page first; then the text goes around all flys there.
      const lrSpace = ListIndents(node, this.m_aNums.get(node));
      const placeFlys = (top: number, printTop: number) => {
        const left = colLeft(), w = colWidth();
        const textLeft = colLeft() + ins.l, unwrapped = lines;
        const charRect = (nContent: number) => {
          let lt = printTop;
          for (const l of unwrapped) {
            if (nContent < l.nStart + l.nLen || l === unwrapped[unwrapped.length - 1]) return { x: textLeft + LineXAt(node.GetText(), l, Math.min(nContent, l.nStart + l.nLen), this.m), lineTop: lt, lineHeight: l.nRealHeight };
            lt += l.nRealHeight;
          }
          return null;
        };
        const g: AnchorGeometry = { left, width: w, printLeft: left + lrSpace.left, printWidth: w - lrSpace.left - lrSpace.right, top, printTop, charRect };
        if (node.m_aAnchoredFlys.length) this.placeAnchoredFlys(node, page, g);
        else this.m_aParaGeometry.set(node, { page, g });
        const area = this.wrapArea(page, colLeft() + ins.l, textWidth, y, node);
        if (area) lines = this.format(node, textWidth, { lineArea: area }).lines;
      };
      // GetTopForObjPos: the frame's top with the previous paragraph's lower spacing (the upper space
      // amount considered for the previous frame), the paragraph's own upper spacing not.
      placeFlys(atTop ? paraTop : paraTop + Math.min(upper, prevLower + prevLineSpace), y);
      for (;;) {
        // How many lines fit in the remaining space, with the footnotes they anchor?
        const countFit = (): [number, number] => {
          let n = 0, hh = 0;
          const ids: string[] = [];
          while (n < lines.length) {
            const l = lines[n]!;
            const more = [...ids, ...anchorsIn(node, l.nStart, l.nStart + l.nLen)];
            if (y + hh + l.nRealHeight > areaBottom() - ftnArea - ftnNeed(more)) break;
            ids.splice(0, ids.length, ...more);
            hh += l.nRealHeight; n++;
          }
          return [n, hh];
        };
        let [fit, h] = countFit();

        if (fit < lines.length) {
          // WidowsAndOrphans::FindBreak: pull lines back so both rules hold.
          if (lines.length - fit < widows) fit = Math.max(0, lines.length - widows);
          if (fit < orphans) fit = 0;
          // Text must make progress on an empty page even if the rules cannot be met.
          if (fit === 0 && atTop) fit = Math.max(1, countFit()[0]);
          h = lines.slice(0, fit).reduce((s, l) => s + l.nRealHeight, 0);
        }

        const placed = lines.slice(0, fit);
        if (placed.length) {
          const last = placed[placed.length - 1]!;
          addFtns(anchorsIn(node, placed[0]!.nStart, last.nStart + last.nLen));
          const frame: SwTextFrame = { node, nLeft: colLeft() + ins.l, nTop: y, nWidth: textWidth, lines: placed, nHeight: h, bMaster, bHasFollow: fit < lines.length };
          y += h;
          const isLast = fit >= lines.length;
          if (isLast && !jn) y += ins.b;
          frame.pBorder = this.paraBorder(node, colLeft(), colWidth(), boxTop, y, bMaster && !jp, isLast && !jn);
          page.frames.push(frame);
          atTop = false;
        }
        if (fit >= lines.length) break;
        lines = lines.slice(fit);
        if (placed.length) bMaster = false;
        const oldPage = page;
        nextColumn();
        if (bMaster) {
          // The whole paragraph moved: first on the page, it keeps its upper, and its flys come along.
          oldPage.flys = oldPage.flys.filter((f) => f.node !== node);
          const top = y;
          y += this.UpperAtTop(node, page, colIdx, false);
          boxTop = y;
          if (!jp) y += ins.t;
          placeFlys(top, y);
        } else {
          boxTop = y;
          // SwTextFrame::Format of the follow: its lines go around the flys of its own page.
          const area = this.wrapArea(page, colLeft() + ins.l, textWidth, y, node);
          if (area) lines = this.format(node, textWidth, { lineArea: area, nStart: lines[0]!.nStart }).lines;
        }
      }
      // SwFlowFrame::CalcUpperSpace: the proportional line spacing of a paragraph's last line goes
      // above the next paragraph or table (the first line of a paragraph has none of its own).
      prevLineSpace = GetLineSpace(node, lines);
      prevLower = ul.lower;
      if (brk === 'page-after') pendingPageBreak = true;
    };

    /** The layout state a column balancing trial goes back to. */
    const save = () => ({ y, atTop, prevLower, prevLineSpace, pendingPageBreak, colIdx, colBottoms: [...colBottoms], frames: page.frames.length, tabs: page.tabs.length, flys: page.flys.length, ftns: [...pageFtns], ftnArea, page });
    const restore = (st: ReturnType<typeof save>) => {
      ({ y, atTop, prevLower, prevLineSpace, pendingPageBreak, colIdx } = st);
      colBottoms = [...st.colBottoms];
      page.frames.length = st.frames; page.tabs.length = st.tabs; page.flys.length = st.flys;
      pageFtns = [...st.ftns]; ftnArea = st.ftnArea;
    };

    for (let idx = 0; idx < blocks.length;) {
      if (idx === endnoteStart) {
        if (flowSec) { y = closeColumns(); setColumns(pd.m_aCol, page.aPrt.Left(), width, y); flowSec = null; }
        breakPage(this.doc.FindPageDesc('Endnote') ?? this.doc.m_aPageDesc);
      }
      const sec = blockSec[idx]!;
      if (sec !== flowSec) {
        // SwSectionFrame with columns: the text below a section starts under its longest column.
        if (flowSec) { y = closeColumns(); setColumns(pd.m_aCol, page.aPrt.Left(), width, y); }
        flowSec = sec;
        if (sec) setColumns(sec.m_pSection.m_aCol, colLeft(), colWidth(), y);
      }
      let end = idx;
      while (end + 1 < blocks.length && blockSec[end + 1] === sec && end + 1 !== endnoteStart) end++;
      if (!sec) { for (let k = idx; k <= end; k++) placeBlock(k); idx = end + 1; continue; }
      // A section's columns: place its blocks, then balance them if they stayed on one page.
      const st = save();
      for (let k = idx; k <= end; k++) placeBlock(k);
      const total = colBottoms.reduce((a, b, k) => a + (k === colIdx ? Math.max(b, y) : b) - colTop, 0);
      if (sec.m_pSection.m_aCol?.m_bBalanced !== false && page === st.page && cols.length > 1 && total > 0) {
        noteBottom();
        let lo = Math.max(1, Math.floor(total / cols.length)), hi = Math.max(...colBottoms) - colTop;
        const fits = (h: number): boolean => {
          restore(st);
          limit = colTop + h; trial = true;
          try { for (let k = idx; k <= end; k++) placeBlock(k); return true; } catch (e) { if (e !== OVERFLOW) throw e; return false; } finally { trial = false; limit = Infinity; }
        };
        while (hi - lo > 20) { const mid = Math.floor((lo + hi) / 2); if (fits(mid)) hi = mid; else lo = mid; }
        restore(st);
        limit = colTop + hi;
        try { for (let k = idx; k <= end; k++) placeBlock(k); } finally { limit = Infinity; }
      }
      idx = end + 1;
    }
    if (flowSec) { y = closeColumns(); flowSec = null; }

    closeColumns();
    finishFootnotes();
    // Page anchored flys on pages past the end stay on the last page.
    for (const f of this.doc.m_aPageFlys) if (f.m_aAnchor.m_nPageNumber > pages.length) page.flys.push(this.positionFly(f, page, null));
    for (const pg of pages) {
      // Drawing order, then the text frames' lines join the page's frames for the cursor (pArea 'fly').
      pg.flys.sort((x, y) => (x.fmt.m_nZOrder ?? 0) - (y.fmt.m_nZOrder ?? 0));
      for (const fly of pg.flys) pg.frames.push(...fly.frames);
    }
    this.pages = pages;
    this.m_aAnnotationAnchors = [];
    this.m_aAsCharFlys = [];
    for (const pg of pages) {
      for (const f of [...pg.frames, ...pg.flys.flatMap((fl) => fl.frames)]) {
        let top = f.nTop;
        for (const l of f.lines) {
          for (const p of l.portions) {
            if (p.pFly) {
              const base = top + (l.nRealHeight - l.nHeight) + l.nAscent;
              let spaces = 0;
              if (l.nSpaceAdd) for (let i = l.nStart; i < p.nStart; i++) if (f.node.GetText()[i] === ' ') spaces++;
              this.m_aAsCharFlys.push({ name: p.pFly.name, rect: ((b) => new SwRect(f.nLeft + l.nX + p.nX + spaces * l.nSpaceAdd, base - b.height, b.width, b.height))(RotatedBoundSize(p.pFly.width, p.pFly.height, p.pFly.rotation)), page: pg });
            }
            const field = p.kind === 'field' ? f.node.GetCharAttrAt('RES_TXTATR_ANNOTATION', p.nStart) : null;
            if (field) this.m_aAnnotationAnchors.push({ field, node: f.node, x: f.nLeft + l.nX + p.nX, y: top + l.nRealHeight - l.nHeight, h: l.nHeight, page: pg });
          }
          top += l.nRealHeight;
        }
      }
    }
  }

  /** Width of the comment sidebar (SwPostItMgr::GetSidebarWidth), or 0 without comments. */
  GetSidebarWidth(): number { return this.m_bShowComments && this.m_aAnnotationAnchors.length ? COMMENT_SIDEBAR : 0; }

  /** Places a body table row by row, starting new pages between rows and repeating heading rows. */
  private layoutBodyTable(t: SwTableNode, page: () => SwPageFrame, getY: () => number, setY: (v: number) => void, getBottom: () => number,
    pageEmpty: () => boolean, setAtTop: (v: boolean) => void, prevLower: number, newPage: () => void, placedFrames: (f: SwTextFrame[]) => void = () => {},
    area: () => { left: number; width: number } = () => ({ left: page().aPrt.Left(), width: page().aPrt.Width() })): void {
    // The table's geometry in its column; a piece continued in another column moves along.
    let g = this.tableGeometry(t, area().left, area().width);
    let rows = this.measureRows(t, g.x, g.w);
    const repeat = t.m_pTable.GetRowsToRepeat();
    if (!pageEmpty()) setY(getY() + prevLower);
    let tab!: SwTabFrame;
    // Whether this page already holds something above the next row.
    let occupied = !pageEmpty();
    const startPiece = () => {
      const ng = this.tableGeometry(t, area().left, area().width);
      if (ng.x !== g.x || ng.w !== g.w) { g = ng; rows = this.measureRows(t, g.x, g.w); }
      tab = { node: t, aFrame: new SwRect(g.x, getY(), g.w, 0), rows: [] };
      page().tabs.push(tab);
    };
    const pushRow = (row: SwRowFrame, repeated: boolean) => {
      row.bRepeated = repeated;
      tab.rows.push(row);
      if (!repeated) for (const c of row.cells) { page().frames.push(...c.frames); placedFrames(c.frames); }
      setY(row.aFrame.Top() + row.aFrame.Height());
      tab.aFrame = new SwRect(g.x, tab.aFrame.Top(), g.w, getY() - tab.aFrame.Top());
      setAtTop(false);
    };
    const put = (ri: number, repeated: boolean) => {
      const r = rows[ri]!;
      const below = rows.slice(ri + 1, ri + r.span).map((x) => x.height);
      pushRow(this.placeRow(t, r, getY(), below, repeated ? undefined : (n, g) => this.placeAnchoredFlys(n, page(), g)), repeated);
    };
    const lines = t.m_pTable.GetTabLines();
    /** SwRowFrame::IsRowSplitAllowed: a row of its own (no vertical merge), not fixed, in a table that may split. */
    const canSplit = (ri: number) => {
      const r = rows[ri]!, la = lines[ri]!.m_aAttrs;
      return r.span === 1 && !la.cantSplit && !(la.fixHeight && la.minHeight) && !t.m_pTable.m_aAttrs.dontSplit
        && r.cells.every((c) => c.box.getRowSpan() === 1 && !c.box.m_aAttrs.frameDir);
    };
    const newPiece = (ri: number) => {
      if (!tab.rows.length) page().tabs.pop();
      newPage();
      startPiece();
      for (let k = 0; k < repeat && k < ri; k++) put(k, true);
    };
    startPiece();
    // SwTabFrame::MakeAll for a table that may not split: it moves on whole when it fits a page.
    if (t.m_pTable.m_aAttrs.dontSplit && occupied) {
      const total = rows.reduce((x, r) => x + r.height, 0);
      if (getY() + total > getBottom() && total <= page().aPrt.Height()) { newPiece(0); occupied = false; }
    }
    for (let ri = 0; ri < rows.length;) {
      // Rows joined by vertical merges move as one.
      let end = ri, h = 0;
      for (let k = ri; k <= end && k < rows.length; k++) { end = Math.max(end, k + rows[k]!.span - 1); h += rows[k]!.height; }
      end = Math.min(end, rows.length - 1);
      // SwTabFrame::Split with a follow flow row: the lines of the row that fit stay on this page.
      if (end === ri && getY() + h > getBottom() && canSplit(ri)) {
        let row = this.placeRow(t, rows[ri]!, getY(), [], (n, g2) => this.placeAnchoredFlys(n, page(), g2));
        for (let guard = 0; row.aFrame.Top() + row.aFrame.Height() > getBottom() && guard < 1000; guard++) {
          const cut = this.cutRow(row, getBottom());
          if (!cut) {
            // Nothing of the row fits here: it starts on the next page (unless that is where it is).
            if (!occupied) break;
            newPiece(ri);
            this.shiftRow(row, getY() - row.aFrame.Top());
            occupied = false;
            continue;
          }
          pushRow(cut.master, false);
          newPiece(ri);
          this.shiftRow(cut.follow, getY() - cut.follow.aFrame.Top());
          row = cut.follow;
          occupied = false;
        }
        pushRow(row, false);
        occupied = true;
        ri++;
        continue;
      }
      if (getY() + h > getBottom() && occupied) {
        // A piece without rows is not left behind on the previous page.
        if (!tab.rows.length) page().tabs.pop();
        newPage();
        startPiece();
        occupied = false;
        for (let k = 0; k < repeat && k < ri; k++) put(k, true);
      }
      for (let k = ri; k <= end; k++) put(k, false);
      occupied = true;
      ri = end + 1;
    }
  }

  /** Moves a placed row with everything in it (cells, their paragraphs and tables). */
  private shiftRow(row: SwRowFrame, dy: number): void {
    if (!dy) return;
    const shiftRect = (r: SwRect) => new SwRect(r.Left(), r.Top() + dy, r.Width(), r.Height());
    row.aFrame = shiftRect(row.aFrame);
    for (const c of row.cells) {
      c.aFrame = shiftRect(c.aFrame);
      // Its own paragraphs here, those of nested tables with them.
      for (const f of c.frames) if (f.pCell === c) { f.nTop += dy; if (f.pBorder) f.pBorder = { ...f.pBorder, rect: shiftRect(f.pBorder.rect) }; }
      for (const tb of c.tabs) this.shiftTab(tb, dy);
    }
  }
  private shiftTab(tb: SwTabFrame, dy: number): void {
    tb.aFrame = new SwRect(tb.aFrame.Left(), tb.aFrame.Top() + dy, tb.aFrame.Width(), tb.aFrame.Height());
    for (const r of tb.rows) this.shiftRow(r, dy);
  }

  /**
   * SwRowFrame's split (SwTabFrame::Split, reduced): each cell keeps the lines and nested tables that
   * end above `cutY` less its bottom inset; the rest goes to a follow row, which starts at the row's
   * top. Null when no cell keeps anything.
   */
  private cutRow(row: SwRowFrame, cutY: number): { master: SwRowFrame; follow: SwRowFrame } | null {
    const top = row.aFrame.Top();
    let anyKept = false;
    const parts = row.cells.map((c) => {
      const ins = this.cellInsets(c.box);
      const limit = cutY - ins.b;
      const masterFrames: SwTextFrame[] = [], followFrames: SwTextFrame[] = [];
      const masterTabs: SwTabFrame[] = [], followTabs: SwTabFrame[] = [];
      let firstFollowTop: number | null = null;
      const own = c.frames.filter((f) => f.pCell === c);
      // Units in order: each paragraph's lines, the nested tables as blocks.
      type Unit = { top: number; bottom: number; frame?: SwTextFrame; line?: number; tab?: SwTabFrame };
      const units: Unit[] = [];
      for (const f of own) { let y = f.nTop; f.lines.forEach((l, i) => { units.push({ top: y, bottom: y + l.nRealHeight, frame: f, line: i }); y += l.nRealHeight; }); }
      for (const tb of c.tabs) units.push({ top: tb.aFrame.Top(), bottom: tb.aFrame.Top() + tb.aFrame.Height(), tab: tb });
      units.sort((a, b) => a.top - b.top);
      let cutAt = units.findIndex((u) => u.bottom > limit + 0.5);
      if (cutAt < 0) cutAt = units.length;
      if (cutAt > 0) anyKept = true;
      if (cutAt < units.length) firstFollowTop = units[cutAt]!.top;
      // Paragraphs: the lines before the cut stay, the others go to a follow frame.
      for (const f of own) {
        const keep = units.filter((u, i) => u.frame === f && i < cutAt).length;
        if (keep === f.lines.length) { masterFrames.push(f); continue; }
        const rest = f.lines.slice(keep);
        if (keep) {
          const kept = f.lines.slice(0, keep);
          masterFrames.push({ ...f, lines: kept, nHeight: kept.reduce((x, l) => x + l.nRealHeight, 0), bHasFollow: true });
        }
        const restTop = f.nTop + f.lines.slice(0, keep).reduce((x, l) => x + l.nRealHeight, 0);
        followFrames.push({ ...f, nTop: restTop, lines: rest, nHeight: rest.reduce((x, l) => x + l.nRealHeight, 0), bMaster: !keep && f.bMaster, bHasFollow: f.bHasFollow });
      }
      for (const tb of c.tabs) (units.findIndex((u) => u.tab === tb) < cutAt ? masterTabs : followTabs).push(tb);
      return { c, ins, masterFrames, followFrames, masterTabs, followTabs, firstFollowTop };
    });
    if (!anyKept) return null;
    const masterH = cutY - top;
    const master: SwRowFrame = { aFrame: new SwRect(row.aFrame.Left(), top, row.aFrame.Width(), masterH), cells: [], bRepeated: false };
    const follow: SwRowFrame = { aFrame: new SwRect(row.aFrame.Left(), top, row.aFrame.Width(), 0), cells: [], bRepeated: false };
    let followH = 0;
    for (const p of parts) {
      // A cell's frames include those of its nested tables (the page's frames are collected from them).
      const nested = (tabs: SwTabFrame[]): SwTextFrame[] => tabs.flatMap((tb) => tb.rows.flatMap((r) => r.cells.flatMap((x) => x.frames)));
      const mc: SwCellFrame = { box: p.c.box, aFrame: new SwRect(p.c.aFrame.Left(), top, p.c.aFrame.Width(), masterH), frames: [...p.masterFrames, ...nested(p.masterTabs)], tabs: p.masterTabs };
      for (const f of p.masterFrames) f.pCell = mc;
      master.cells.push(mc);
      const fc: SwCellFrame = { box: p.c.box, aFrame: new SwRect(p.c.aFrame.Left(), top, p.c.aFrame.Width(), 0), frames: [...p.followFrames, ...nested(p.followTabs)], tabs: p.followTabs };
      // The follow's content starts at the row's top.
      const dy = p.firstFollowTop === null ? 0 : top + p.ins.t - p.firstFollowTop;
      for (const f of p.followFrames) { f.nTop += dy; f.pCell = fc; if (f.pBorder) f.pBorder = { ...f.pBorder, rect: new SwRect(f.pBorder.rect.Left(), f.pBorder.rect.Top() + dy, f.pBorder.rect.Width(), f.pBorder.rect.Height()) }; }
      for (const tb of p.followTabs) this.shiftTab(tb, dy);
      let bottom = top + p.ins.t;
      for (const f of p.followFrames) bottom = Math.max(bottom, f.nTop + f.nHeight);
      for (const tb of p.followTabs) bottom = Math.max(bottom, tb.aFrame.Top() + tb.aFrame.Height());
      followH = Math.max(followH, bottom + p.ins.b - top);
      follow.cells.push(fc);
    }
    follow.aFrame = new SwRect(follow.aFrame.Left(), top, follow.aFrame.Width(), followH);
    for (const fc of follow.cells) fc.aFrame = new SwRect(fc.aFrame.Left(), top, fc.aFrame.Width(), followH);
    return { master, follow };
  }

  GetDocSize(): { width: number; height: number } {
    const last = this.pages[this.pages.length - 1]!;
    const widest = Math.max(...this.pages.map((p) => p.aFrame.Width()));
    return { width: DOCUMENTBORDER * 2 + widest + this.GetSidebarWidth(), height: last.aFrame.Top() + last.aFrame.Height() + DOCUMENTBORDER };
  }

  private frameLine(frame: SwTextFrame, y: number): { line: SwLineLayout; top: number } {
    let top = frame.nTop;
    for (let i = 0; i < frame.lines.length; i++) {
      const l = frame.lines[i]!;
      if (y < top + l.nRealHeight || i === frame.lines.length - 1) return { line: l, top };
      top += l.nRealHeight;
    }
    return { line: frame.lines[0]!, top };
  }

  /** All cells on a page, nested ones included. */
  private cellsOf(page: SwPageFrame): SwCellFrame[] {
    const out: SwCellFrame[] = [];
    const walk = (tabs: SwTabFrame[]) => { for (const t of tabs) for (const r of t.rows) if (!r.bRepeated) for (const c of r.cells) { out.push(c); walk(c.tabs); } };
    walk(page.tabs);
    return out;
  }

  /** Closest model position to a document point (SwTextFrame::GetModelPositionForViewPoint). */
  GetModelPositionForViewPoint(pt: Point): { node: SwTextNode; content: number } {
    // Nearest page by vertical distance, then the frame on it.
    let page = this.pages[0]!;
    let best = Infinity;
    for (const p of this.pages) {
      const d = pt.Y() < p.aFrame.Top() ? p.aFrame.Top() - pt.Y() : pt.Y() > p.aFrame.Bottom() ? pt.Y() - p.aFrame.Bottom() : 0;
      if (d < best) { best = d; page = p; }
    }
    if (!page.frames.length) {
      for (let i = page.nIndex; i >= 0; i--) {
        const fr = this.pages[i]!.frames;
        if (fr.length) { const f = fr[fr.length - 1]!; return { node: f.node, content: f.node.Len() }; }
      }
      const first = this.doc.GetNodes().FirstTextNode();
      return { node: first, content: 0 };
    }
    // Inside a text frame: its own paragraphs (the topmost frame wins).
    const flyHit = [...page.flys].reverse().find((f) => f.frames.length && f.aFrame.Contains(pt));
    if (flyHit) {
      const own = flyHit.frames.filter((f) => !f.pCell);
      // Vertical text: the point in the content's own (unrotated) coordinates.
      if (flyHit.aVert) pt = InvertVert(flyHit.aVert, pt);
      let frame = own[own.length - 1]!, bestD = Infinity;
      for (const f of own) {
        const d = pt.Y() < f.nTop ? f.nTop - pt.Y() : pt.Y() > f.nTop + f.nHeight ? pt.Y() - f.nTop - f.nHeight : 0;
        if (d < bestD) { bestD = d; frame = f; }
      }
      const { line } = this.frameLine(frame, pt.Y());
      return { node: frame.node, content: this.offsetInLine(frame, line, pt.X() - frame.nLeft - line.nX) };
    }
    // Above the body is the header, below it the footer, where the page has them.
    const area: SwFrameArea = page.aHeader && pt.Y() < page.aPrt.Top() ? 'header' : page.aFooter && pt.Y() > page.aPrt.Bottom() ? 'footer'
      : page.aFootnote && pt.Y() >= page.aFootnote.Top() ? 'footnote' : 'body';
    const inArea = (f: SwTextFrame) => (f.pArea ?? 'body') === area;
    if (area !== 'body') this.m_nPreferPage = page.nIndex;
    // The innermost cell containing the point; else the nearest cell of a table row at that height.
    const dist = (r: SwRect) => {
      const dx = pt.X() < r.Left() ? r.Left() - pt.X() : pt.X() > r.Left() + r.Width() ? pt.X() - r.Left() - r.Width() : 0;
      const dy = pt.Y() < r.Top() ? r.Top() - pt.Y() : pt.Y() > r.Top() + r.Height() ? pt.Y() - r.Top() - r.Height() : 0;
      return { dx, dy };
    };
    let cell: SwCellFrame | null = null;
    let cellArea = Infinity;
    const cells = this.cellsOf(page).filter((c) => c.frames.some(inArea));
    for (const c of cells) {
      const d = dist(c.aFrame);
      if (!d.dx && !d.dy && c.aFrame.Width() * c.aFrame.Height() < cellArea && c.frames.some((f) => f.pCell === c)) { cell = c; cellArea = c.aFrame.Width() * c.aFrame.Height(); }
    }
    let candidates: SwTextFrame[];
    if (cell) candidates = cell.frames.filter((f) => f.pCell === cell);
    else {
      const body = page.frames.filter((f) => !f.pCell && inArea(f));
      // Beside a table: the nearest cell in the row at that height.
      const rowCell = cells.filter((c) => !dist(c.aFrame).dy && c.frames.some((f) => f.pCell === c)).sort((a, b) => dist(a.aFrame).dx - dist(b.aFrame).dx)[0];
      const inBodyBand = body.some((f) => pt.Y() >= f.nTop && pt.Y() < f.nTop + f.nHeight);
      if (rowCell && !inBodyBand) candidates = rowCell.frames.filter((f) => f.pCell === rowCell);
      else if (body.length) candidates = body;
      else candidates = page.frames.filter(inArea).length ? page.frames.filter(inArea) : page.frames;
    }
    let frame = candidates[candidates.length - 1]!;
    // In a cell with vertical text, the point in the content's own (unrotated) coordinates.
    if (cell?.aVert) pt = InvertVert(cell.aVert, pt);
    if (cell) {
      for (const f of candidates) if (pt.Y() < f.nTop + f.nHeight) { frame = f; break; }
    } else {
      // In a gap, the nearer of the frames above and below.
      let bestD = Infinity;
      for (const f of candidates) {
        const d = dist(new SwRect(f.nLeft, f.nTop, f.nWidth, f.nHeight)).dy;
        if (d < bestD) { bestD = d; frame = f; }
      }
    }
    const { line } = this.frameLine(frame, pt.Y());
    return { node: frame.node, content: this.offsetInLine(frame, line, pt.X() - frame.nLeft - line.nX) };
  }

  /**
   * The nearest line above or below a line, preferring lines whose frame spans x (cursor up/down,
   * SwCursor::UpDown). Returns a point inside that line, or null at the document's edge.
   */
  NextLinePoint(x: number, lineTop: number, lineBottom: number, dir: -1 | 1, area: SwFrameArea = 'body', pageArg?: SwPageFrame, section?: SwStartNode): Point | null {
    let best: { y: number; px: number; d: number } | null = null;
    let bestSpan = false;
    // Headers and footers repeat on every page: moving within one stays on its page.
    for (const page of area === 'body' || area === 'fly' || !pageArg ? this.pages : [pageArg]) {
      for (const f of page.frames) {
        if ((f.pArea ?? 'body') !== area) continue;
        if (section && area === 'fly' && this.doc.GetNodes().AreaOf(f.node) !== section) continue;
        const spans = x >= f.nLeft && x <= f.nLeft + f.nWidth;
        let top = f.nTop;
        for (const l of f.lines) {
          const t = top, b = top + l.nRealHeight;
          top = b;
          const ok = dir > 0 ? t >= lineBottom - 1 : b <= lineTop + 1;
          if (!ok) continue;
          const d = dir > 0 ? t - lineBottom : lineTop - b;
          const px = Math.min(Math.max(x, f.nLeft), f.nLeft + f.nWidth);
          // A line in the same column wins over a nearer one beside it.
          if (!best || (spans && !bestSpan) || (spans === bestSpan && (d < best.d || (d === best.d && Math.abs(px - x) < Math.abs(best.px - x))))) {
            best = { y: t + l.nRealHeight / 2, px, d };
            bestSpan = spans;
          }
        }
      }
    }
    return best ? new Point(best.px, best.y) : null;
  }

  /** Nearest grapheme boundary to x within a line. */
  private offsetInLine(frame: SwTextFrame, line: SwLineLayout, x: number): number {
    const text = frame.node.GetText();
    const lineEnd = line.nStart + line.nLen;
    // The break character and a soft-wrap's hanging end are not caret stops past the line.
    let end = lineEnd;
    if (end > line.nStart && text[end - 1] === '\n') end--;
    else if (end < text.length && end > line.nStart) end = this.prevBoundary(text, end, line.nStart);
    let bestPos = line.nStart, bestDist = Infinity;
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const stops = [line.nStart];
    for (const s of seg.segment(text.slice(line.nStart, end))) if (s.index) stops.push(line.nStart + s.index);
    stops.push(end);
    for (const p of stops) {
      const d = Math.abs(LineXAt(text, line, p, this.m) - x);
      if (d < bestDist) { bestDist = d; bestPos = p; }
    }
    return bestPos;
  }

  private prevBoundary(text: string, end: number, min: number): number {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    let last = min;
    for (const s of seg.segment(text.slice(min, end))) last = min + s.index;
    return last;
  }

  /** The frame and line containing a content position, preferring the line it starts. */
  FindLine(node: SwTextNode, content: number): { frame: SwTextFrame; line: SwLineLayout; top: number; page: SwPageFrame } | null {
    let first: { frame: SwTextFrame; line: SwLineLayout; top: number; page: SwPageFrame } | null = null;
    for (const page of this.pages) {
      for (const frame of page.frames) {
        if (frame.node !== node) continue;
        let top = frame.nTop;
        for (let i = 0; i < frame.lines.length; i++) {
          const l = frame.lines[i]!;
          const last = i === frame.lines.length - 1 && !frame.bHasFollow;
          if (content < l.nStart + l.nLen || last) {
            const hit = { frame, line: l, top, page };
            // A header or footer line is shown on the page last clicked, if it has one.
            if (!frame.pArea || page.nIndex === this.m_nPreferPage) return hit;
            first ??= hit;
            break;
          }
          top += l.nRealHeight;
        }
      }
    }
    return first;
  }

  /**
   * The line pieces a text range covers, with their baselines (SwTextFrame::PaintParagraphStylesHighlighting
   * and the wrong list painting need them): one per line of every frame of the paragraph.
   */
  GetRangeRects(node: SwTextNode, start: number, end: number): { x: number; y: number; w: number; h: number; baseline: number; page: SwPageFrame }[] {
    const out: { x: number; y: number; w: number; h: number; baseline: number; page: SwPageFrame }[] = [];
    const text = node.GetText();
    for (const page of this.pages) {
      for (const frame of page.frames) {
        if (frame.node !== node) continue;
        let top = frame.nTop;
        for (const l of frame.lines) {
          const ls = l.nStart, le = l.nStart + l.nLen;
          if (start < le && end > ls) {
            for (const [x0, x1] of LineRangeX(text, l, Math.max(start, ls), Math.min(end, le), this.m)) {
              out.push({ x: frame.nLeft + l.nX + Math.min(x0, x1), y: top, w: Math.abs(x1 - x0), h: l.nRealHeight, baseline: top + (l.nRealHeight - l.nHeight) + l.nAscent, page });
            }
          }
          top += l.nRealHeight;
        }
      }
    }
    return out;
  }

  /** Caret rectangle of a position (SwTextFrame::GetCharRect). */
  GetCharRect(node: SwTextNode, content: number): SwRect | null {
    const hit = this.FindLine(node, content);
    if (!hit) return null;
    const { frame, line, top } = hit;
    const x = frame.nLeft + line.nX + LineXAt(node.GetText(), line, content, this.m);
    // The caret sits on the baseline area, below any proportional extra leading.
    const r = new SwRect(Math.round(x), top + line.nRealHeight - line.nHeight, 1, line.nHeight);
    const m = frame.pCell?.aVert ?? frame.aVert;
    if (!m) return r;
    // Rotated with the cell's vertical text.
    const p1 = ApplyVert(m, r.Left(), r.Top()), p2 = ApplyVert(m, r.Left() + r.Width(), r.Top() + r.Height());
    return new SwRect(Math.round(Math.min(p1[0], p2[0])), Math.round(Math.min(p1[1], p2[1])), Math.max(1, Math.round(Math.abs(p2[0] - p1[0]))), Math.max(1, Math.round(Math.abs(p2[1] - p1[1]))));
  }
}

export { displayText };
