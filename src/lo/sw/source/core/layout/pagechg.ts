// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/core/layout/pagechg.cxx reduced
// @upstream sw/source/core/layout/flowfrm.cxx reduced
// @upstream sw/source/core/layout/frmtool.cxx reduced
// @upstream sw/source/core/text/widorp.cxx reduced
// @upstream sw/source/core/text/frmcrsr.cxx reduced
// @upstream sw/source/core/inc/rootfrm.hxx reduced
// @upstream sw/source/core/inc/pagefrm.hxx reduced
// @upstream sw/source/core/inc/txtfrm.hxx reduced
// Upstream's frame tree converges through repeated invalidation; here one forward pass places
// cached paragraph layouts on pages. It has the same results for the features ported so far.
import { Point } from '../../../../tools/source/generic/gen.ts';
import { SwRect } from '../../../inc/swrect.ts';
import type { SwDoc } from '../../../inc/doc.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';
import type { TextMeasurer } from '../../../../vcl/source/outdev/text.ts';
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
}

export interface SwPageFrame { nIndex: number; aFrame: SwRect; aPrt: SwRect; frames: SwTextFrame[] }

interface CacheEntry { version: number; width: number; para: SwParaPortion }

export class SwRootFrame {
  pages: SwPageFrame[] = [];
  private cache = new WeakMap<SwTextNode, CacheEntry>();
  private doc: SwDoc;
  private m: TextMeasurer;

  constructor(doc: SwDoc, measurer: TextMeasurer) {
    this.doc = doc;
    this.m = measurer;
  }

  private format(node: SwTextNode, width: number): SwParaPortion {
    const hit = this.cache.get(node);
    if (hit && hit.version === node.m_nVersion && hit.width === width) return hit.para;
    const para = FormatParagraph(node, width, this.m);
    this.cache.set(node, { version: node.m_nVersion, width, para });
    return para;
  }

  InvalidateFonts(): void { this.cache = new WeakMap(); }

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
      };
      pages.push(page);
      y = top + pd.nTop;
      bottom = y + pd.PrintHeight();
      atTop = true;
      prevLower = 0;
    };
    newPage();

    const paras: SwTextNode[] = [];
    for (let n = nodes.GoNext(0); n; n = nodes.GoNext(n.GetIndex())) paras.push(n);

    const firstLinesHeight = (p: SwParaPortion, orphans: number) =>
      p.lines.slice(0, Math.max(1, Math.min(orphans, p.lines.length))).reduce((h, l) => h + l.nRealHeight, 0);

    let pendingPageBreak = false;
    paras.forEach((node, idx) => {
      const para = this.format(node, width);
      const ul = node.GetAttr('RES_UL_SPACE');
      const orphans = node.GetAttr('RES_PARATR_ORPHANS');
      const widows = node.GetAttr('RES_PARATR_WIDOWS');
      const brk = node.GetAttr('RES_BREAK');

      if ((pendingPageBreak || (brk === 'page-before' && idx > 0)) && !(atTop && !page.frames.length)) newPage();
      pendingPageBreak = false;

      // SwFlowFrame::CalcUpperSpace with PARA_SPACE_MAX and PARA_SPACE_MAX_AT_PAGES enabled.
      let upper = atTop ? ul.upper : prevLower + ul.upper;

      // Keep-with-next: everything chained must start on one page with the next paragraph's first lines.
      if (!atTop) {
        let need = upper + para.nHeight;
        let k = idx;
        while (paras[k]!.GetAttr('RES_KEEP') && k + 1 < paras.length) {
          const next = paras[k + 1]!;
          const nextPara = this.format(next, width);
          const nextUl = next.GetAttr('RES_UL_SPACE');
          need += paras[k]!.GetAttr('RES_UL_SPACE').lower + nextUl.upper;
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
    let frame = page.frames[page.frames.length - 1]!;
    for (const f of page.frames) if (pt.Y() < f.nTop + f.nHeight) { frame = f; break; }
    const { line } = this.frameLine(frame, pt.Y());
    return { node: frame.node, content: this.offsetInLine(frame, line, pt.X() - frame.nLeft - line.nX) };
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
