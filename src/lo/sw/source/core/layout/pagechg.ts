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
// Upstream's frame tree converges through repeated invalidation; here one forward pass places
// cached paragraph layouts on pages. Tables break between rows only (rows joined by a vertical
// merge stay together) and repeat their heading rows; rows do not split across pages.
import { Point } from '../../../../tools/source/generic/gen.ts';
import { SwRect } from '../../../inc/swrect.ts';
import type { SwDoc } from '../../../inc/doc.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';
import type { SwStartNode, SwTableNode } from '../../../inc/node.ts';
import type { SwTableBox } from '../../../inc/swtable.ts';
import type { TextMeasurer } from '../../../../vcl/source/outdev/text.ts';
import { NumberParagraphs, type SwNodeNum } from '../doc/list.ts';
import { FormatParagraph, LineXAt, displayText, type SwLineLayout, type SwParaPortion } from '../text/itrform2.ts';

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
}

export interface SwCellFrame { box: SwTableBox; aFrame: SwRect; frames: SwTextFrame[]; tabs: SwTabFrame[] }
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
}

interface CacheEntry { version: number; width: number; num: SwNodeNum | undefined; para: SwParaPortion }

const sameNum = (a: SwNodeNum | undefined, b: SwNodeNum | undefined): boolean =>
  a === b || (!!a && !!b && a.fmt === b.fmt && a.label === b.label && a.counted === b.counted);

/** Cell content placed at a position: its frames, nested tables and height. */
interface Placed { frames: SwTextFrame[]; tabs: SwTabFrame[]; height: number }

export class SwRootFrame {
  pages: SwPageFrame[] = [];
  /** List numbering of the last layout pass. */
  m_aNums = new Map<SwTextNode, SwNodeNum>();
  private cache = new WeakMap<SwTextNode, CacheEntry>();
  private doc: SwDoc;
  private m: TextMeasurer;

  constructor(doc: SwDoc, measurer: TextMeasurer) {
    this.doc = doc;
    this.m = measurer;
  }

  private format(node: SwTextNode, width: number): SwParaPortion {
    const hit = this.cache.get(node);
    const num = this.m_aNums.get(node);
    if (hit && hit.version === node.m_nVersion && hit.width === width && sameNum(hit.num, num)) return hit.para;
    const para = FormatParagraph(node, width, this.m, num);
    this.cache.set(node, { version: node.m_nVersion, width, num, para });
    return para;
  }

  InvalidateFonts(): void { this.cache = new WeakMap(); }

  // --- tables (tabfrm.cxx) ---

  /** Table position and width within an area (SwTabFrame::Format with the table's HoriOrient). */
  private tableGeometry(t: SwTableNode, left: number, width: number): { x: number; w: number } {
    const a = t.m_pTable.m_aAttrs;
    if (a.adjust === 'full' || !a.width) return { x: left, w: width };
    const w = a.width;
    switch (a.adjust) {
      case 'center': return { x: left + (width - w) / 2, w };
      case 'right': return { x: left + width - w, w };
      default: return { x: left + a.leftSpace, w };
    }
  }

  /** Lays out the content of a section (a cell) without page breaks. */
  private placeSection(start: SwStartNode, x: number, y: number, width: number): Placed {
    const nodes = this.doc.GetNodes();
    const frames: SwTextFrame[] = [];
    const tabs: SwTabFrame[] = [];
    let top = y, prevLower = 0, first = true;
    const end = start.EndOfSectionNode().GetIndex();
    for (let i = start.GetIndex() + 1; i < end;) {
      const n = nodes.node(i);
      if (n.IsTextNode()) {
        const para = this.format(n, width);
        const ul = n.GetAttr('RES_UL_SPACE');
        top += first ? ul.upper : prevLower + ul.upper;
        frames.push({ node: n, nLeft: x, nTop: top, nWidth: width, lines: para.lines, nHeight: para.nHeight, bMaster: true, bHasFollow: false });
        top += para.nHeight;
        prevLower = ul.lower;
        i++;
      } else if (n.IsTableNode()) {
        const t = n as SwTableNode;
        top += prevLower;
        const g = this.tableGeometry(t, x, width);
        const rows = this.measureRows(t, g.x, g.w);
        const tab: SwTabFrame = { node: t, aFrame: new SwRect(g.x, top, g.w, 0), rows: [] };
        for (const [ri, r] of rows.entries()) {
          const row = this.placeRow(t, r, top, rows.slice(ri + 1, ri + r.span).map((x) => x.height));
          tab.rows.push(row);
          for (const c of row.cells) { frames.push(...c.frames); }
          top += r.height;
        }
        tab.aFrame = new SwRect(g.x, tab.aFrame.Top(), g.w, top - tab.aFrame.Top());
        tabs.push(tab);
        prevLower = 0;
        i = t.EndOfSectionNode().GetIndex() + 1;
      } else i++;
      first = false;
    }
    return { frames, tabs, height: top - y + prevLower };
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
        const need = this.measureCell(c.box, c.w);
        if (span <= 1) r.height = Math.max(r.height, need);
        else needs.push({ from: li, to: Math.min(rows.length - 1, li + span - 1), need });
      }
    });
    for (const { from, to, need } of needs) {
      const have = rows.slice(from, to + 1).reduce((s, r) => s + r.height, 0);
      if (need > have) rows[to]!.height += need - have;
      for (let k = from; k < to; k++) rows[k]!.span = Math.max(rows[k]!.span, to - k + 1);
    }
    return rows;
  }

  private cellInsets(box: SwTableBox): { l: number; t: number; r: number; b: number } {
    const a = box.m_aAttrs, bx = a.box, p = a.padding;
    return { l: p + (bx.left?.width ?? 0), t: p + (bx.top?.width ?? 0), r: p + (bx.right?.width ?? 0), b: p + (bx.bottom?.width ?? 0) };
  }

  private measureCell(box: SwTableBox, w: number): number {
    const ins = this.cellInsets(box);
    return this.placeSection(box.m_pStartNode!, 0, 0, Math.max(1, w - ins.l - ins.r)).height + ins.t + ins.b;
  }

  /** Places one measured row at `top`. Merged cells extend over the rows they cover. */
  private placeRow(t: SwTableNode, r: ReturnType<SwRootFrame['measureRows']>[number], top: number, rowsBelow?: number[]): SwRowFrame {
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
      const placed = this.placeSection(c.box.m_pStartNode!, c.x + ins.l, top + ins.t, Math.max(1, c.w - ins.l - ins.r));
      const cell: SwCellFrame = { box: c.box, aFrame: new SwRect(c.x, top, c.w, h), frames: placed.frames, tabs: placed.tabs };
      for (const f of placed.frames) f.pCell ??= cell;
      row.cells.push(cell);
    }
    return row;
  }

  Layout(): void {
    const pd = this.doc.m_aPageDesc;
    const nodes = this.doc.GetNodes();
    const width = pd.PrintWidth();
    const pages: SwPageFrame[] = [];
    let page!: SwPageFrame;
    let y = 0; // next free y on the current page, absolute
    let bottom = 0; // first y past the print area
    let atTop = true;
    let prevLower = 0;

    const newPage = () => {
      const top = pages.length ? pages[pages.length - 1]!.aFrame.Top() + pd.nHeight + GAPBETWEENPAGES : DOCUMENTBORDER;
      page = {
        nIndex: pages.length,
        aFrame: new SwRect(DOCUMENTBORDER, top, pd.nWidth, pd.nHeight),
        aPrt: new SwRect(DOCUMENTBORDER + pd.nLeft, top + pd.nTop, width, pd.PrintHeight()),
        frames: [],
        tabs: [],
      };
      pages.push(page);
      y = top + pd.nTop;
      bottom = y + pd.PrintHeight();
      atTop = true;
      prevLower = 0;
    };
    newPage();

    // Body blocks: paragraphs and tables directly in the content section.
    const blocks: (SwTextNode | SwTableNode)[] = [];
    const endOfContent = nodes.GetEndOfContent().GetIndex();
    for (let i = 1; i < endOfContent;) {
      const n = nodes.node(i);
      if (n.IsTextNode()) { blocks.push(n); i++; }
      else if (n.IsTableNode()) { blocks.push(n as SwTableNode); i = (n as SwTableNode).EndOfSectionNode().GetIndex() + 1; }
      else i++;
    }
    const allText: SwTextNode[] = [];
    for (let n = nodes.GoNext(0); n; n = nodes.GoNext(n.GetIndex())) allText.push(n);
    this.m_aNums = NumberParagraphs(this.doc, allText);

    const firstLinesHeight = (p: SwParaPortion, orphans: number) =>
      p.lines.slice(0, Math.max(1, Math.min(orphans, p.lines.length))).reduce((h, l) => h + l.nRealHeight, 0);

    let pendingPageBreak = false;
    blocks.forEach((block, idx) => {
      if (block.IsTableNode()) {
        this.layoutBodyTable(block as SwTableNode, () => page, () => y, (v) => { y = v; }, () => bottom, () => atTop && !page.frames.length && !page.tabs.length, (v) => { atTop = v; }, prevLower, newPage);
        prevLower = 0;
        pendingPageBreak = false;
        return;
      }
      const node = block as SwTextNode;
      const para = this.format(node, width);
      const ul = node.GetAttr('RES_UL_SPACE');
      const orphans = node.GetAttr('RES_PARATR_ORPHANS');
      const widows = node.GetAttr('RES_PARATR_WIDOWS');
      const brk = node.GetAttr('RES_BREAK');

      if ((pendingPageBreak || (brk === 'page-before' && idx > 0)) && !(atTop && !page.frames.length && !page.tabs.length)) newPage();
      pendingPageBreak = false;

      // SwFlowFrame::CalcUpperSpace with PARA_SPACE_MAX and PARA_SPACE_MAX_AT_PAGES enabled.
      let upper = atTop ? ul.upper : prevLower + ul.upper;

      // Keep-with-next: everything chained must start on one page with the next paragraph's first lines.
      if (!atTop) {
        let need = upper + para.nHeight;
        let k = idx;
        while ((blocks[k] as SwTextNode).GetAttr('RES_KEEP') && k + 1 < blocks.length && blocks[k + 1]!.IsTextNode()) {
          const next = blocks[k + 1] as SwTextNode;
          const nextPara = this.format(next, width);
          const nextUl = next.GetAttr('RES_UL_SPACE');
          need += (blocks[k] as SwTextNode).GetAttr('RES_UL_SPACE').lower + nextUl.upper;
          k++;
          if (next.GetAttr('RES_KEEP')) need += nextPara.nHeight;
          else need += firstLinesHeight(nextPara, next.GetAttr('RES_PARATR_ORPHANS'));
        }
        if (k > idx && y + need > bottom) { newPage(); upper = ul.upper; }
      }

      let lines = para.lines;
      let bMaster = true;
      y += upper;
      for (;;) {
        // How many lines fit in the remaining space?
        let fit = 0, h = 0;
        while (fit < lines.length && y + h + lines[fit]!.nRealHeight <= bottom) { h += lines[fit]!.nRealHeight; fit++; }

        if (fit < lines.length) {
          // WidowsAndOrphans::FindBreak: pull lines back so both rules hold.
          if (lines.length - fit < widows) fit = Math.max(0, lines.length - widows);
          if (fit < orphans) fit = 0;
          // Text must make progress on an empty page even if the rules cannot be met.
          if (fit === 0 && atTop) {
            fit = 0; h = 0;
            while (fit < lines.length && y + h + lines[fit]!.nRealHeight <= bottom) { h += lines[fit]!.nRealHeight; fit++; }
            fit = Math.max(1, fit);
          }
          h = lines.slice(0, fit).reduce((s, l) => s + l.nRealHeight, 0);
        }

        const placed = lines.slice(0, fit);
        if (placed.length) {
          page.frames.push({ node, nLeft: page.aPrt.Left(), nTop: y, nWidth: width, lines: placed, nHeight: h, bMaster, bHasFollow: fit < lines.length });
          y += h;
          atTop = false;
        }
        if (fit >= lines.length) break;
        lines = lines.slice(fit);
        if (placed.length) bMaster = false;
        newPage();
        if (bMaster) y += ul.upper; // the whole paragraph moved: first on the page, it keeps its upper
      }
      prevLower = ul.lower;
      if (brk === 'page-after') pendingPageBreak = true;
    });

    this.pages = pages;
  }

  /** Places a body table row by row, starting new pages between rows and repeating heading rows. */
  private layoutBodyTable(t: SwTableNode, page: () => SwPageFrame, getY: () => number, setY: (v: number) => void, getBottom: () => number,
    pageEmpty: () => boolean, setAtTop: (v: boolean) => void, prevLower: number, newPage: () => void): void {
    const prt = page().aPrt;
    const g = this.tableGeometry(t, prt.Left(), prt.Width());
    const rows = this.measureRows(t, g.x, g.w);
    const repeat = t.m_pTable.GetRowsToRepeat();
    if (!pageEmpty()) setY(getY() + prevLower);
    let tab!: SwTabFrame;
    // Whether this page already holds something above the next row.
    let occupied = !pageEmpty();
    const startPiece = () => {
      tab = { node: t, aFrame: new SwRect(g.x, getY(), g.w, 0), rows: [] };
      page().tabs.push(tab);
    };
    const put = (ri: number, repeated: boolean) => {
      const r = rows[ri]!;
      const below = rows.slice(ri + 1, ri + r.span).map((x) => x.height);
      const row = this.placeRow(t, r, getY(), below);
      row.bRepeated = repeated;
      tab.rows.push(row);
      if (!repeated) for (const c of row.cells) page().frames.push(...c.frames);
      setY(getY() + r.height);
      tab.aFrame = new SwRect(g.x, tab.aFrame.Top(), g.w, getY() - tab.aFrame.Top());
      setAtTop(false);
    };
    startPiece();
    for (let ri = 0; ri < rows.length;) {
      // Rows joined by vertical merges move as one.
      let end = ri, h = 0;
      for (let k = ri; k <= end && k < rows.length; k++) { end = Math.max(end, k + rows[k]!.span - 1); h += rows[k]!.height; }
      end = Math.min(end, rows.length - 1);
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

  GetDocSize(): { width: number; height: number } {
    const last = this.pages[this.pages.length - 1]!;
    return { width: DOCUMENTBORDER * 2 + this.doc.m_aPageDesc.nWidth, height: last.aFrame.Top() + last.aFrame.Height() + DOCUMENTBORDER };
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
    // The innermost cell containing the point; else the nearest cell of a table row at that height.
    const dist = (r: SwRect) => {
      const dx = pt.X() < r.Left() ? r.Left() - pt.X() : pt.X() > r.Left() + r.Width() ? pt.X() - r.Left() - r.Width() : 0;
      const dy = pt.Y() < r.Top() ? r.Top() - pt.Y() : pt.Y() > r.Top() + r.Height() ? pt.Y() - r.Top() - r.Height() : 0;
      return { dx, dy };
    };
    let cell: SwCellFrame | null = null;
    let cellArea = Infinity;
    for (const c of this.cellsOf(page)) {
      const d = dist(c.aFrame);
      if (!d.dx && !d.dy && c.aFrame.Width() * c.aFrame.Height() < cellArea && c.frames.some((f) => f.pCell === c)) { cell = c; cellArea = c.aFrame.Width() * c.aFrame.Height(); }
    }
    let candidates: SwTextFrame[];
    if (cell) candidates = cell.frames.filter((f) => f.pCell === cell);
    else {
      const body = page.frames.filter((f) => !f.pCell);
      // Beside a table: the nearest cell in the row at that height.
      const rowCell = this.cellsOf(page).filter((c) => !dist(c.aFrame).dy && c.frames.some((f) => f.pCell === c)).sort((a, b) => dist(a.aFrame).dx - dist(b.aFrame).dx)[0];
      const inBodyBand = body.some((f) => pt.Y() >= f.nTop && pt.Y() < f.nTop + f.nHeight);
      if (rowCell && !inBodyBand) candidates = rowCell.frames.filter((f) => f.pCell === rowCell);
      else if (body.length) candidates = body;
      else candidates = page.frames;
    }
    let frame = candidates[candidates.length - 1]!;
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
  NextLinePoint(x: number, lineTop: number, lineBottom: number, dir: -1 | 1): Point | null {
    let best: { y: number; px: number; d: number } | null = null;
    let bestSpan = false;
    for (const page of this.pages) {
      for (const f of page.frames) {
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
    for (const page of this.pages) {
      for (const frame of page.frames) {
        if (frame.node !== node) continue;
        let top = frame.nTop;
        for (let i = 0; i < frame.lines.length; i++) {
          const l = frame.lines[i]!;
          const last = i === frame.lines.length - 1 && !frame.bHasFollow;
          if (content < l.nStart + l.nLen || last) return { frame, line: l, top, page };
          top += l.nRealHeight;
        }
      }
    }
    return null;
  }

  /** Caret rectangle of a position (SwTextFrame::GetCharRect). */
  GetCharRect(node: SwTextNode, content: number): SwRect | null {
    const hit = this.FindLine(node, content);
    if (!hit) return null;
    const { frame, line, top } = hit;
    const x = frame.nLeft + line.nX + LineXAt(node.GetText(), line, content, this.m);
    // The caret sits on the baseline area, below any proportional extra leading.
    return new SwRect(Math.round(x), top + line.nRealHeight - line.nHeight, 1, line.nHeight);
  }
}

export { displayText };
