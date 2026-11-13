// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/core/text/frminf.cxx reduced
// @upstream sw/source/core/inc/frminf.hxx reduced
// SwTextFrameInfo: what AutoFormat asks the layout about a paragraph. It works on the layout
// frames of a paragraph (the master and its follows) instead of an SwTextFrame with text cursors;
// positions are model positions, as the frames show the text unmerged. IsBullet recognises the
// symbol fonts by name, as no font character set is known.
import type { SwRootFrame, SwTextFrame } from '../layout/pagechg.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';
import type { SwLineLayout } from './itrform2.ts';

const CH_TAB = '\t', CH_BREAK = '\n';

/** A line of the paragraph with the frame it is on. */
interface Line { frame: SwTextFrame; line: SwLineLayout }

export class SwTextFrameInfo {
  m_pRoot: SwRootFrame;
  m_pFrame: SwTextNode | null;

  constructor(pRoot: SwRootFrame, pFrame: SwTextNode | null) { this.m_pRoot = pRoot; this.m_pFrame = pFrame; }

  GetFrame(): SwTextNode | null { return this.m_pFrame; }
  SetFrame(pNew: SwTextNode | null): void { this.m_pFrame = pNew; }

  private frames(): SwTextFrame[] {
    const out: SwTextFrame[] = [];
    if (!this.m_pFrame) return out;
    for (const page of this.m_pRoot.pages) for (const f of page.frames) if (f.node === this.m_pFrame && !f.pArea) out.push(f);
    return out;
  }

  private lines(): Line[] { return this.frames().flatMap((frame) => frame.lines.map((line) => ({ frame, line }))); }

  private text(): string { return this.m_pFrame?.GetText() ?? ''; }

  /** SwTextMargin::GetTextStart */
  private GetTextStart(l: SwLineLayout): number {
    const rText = this.text();
    const nEnd = l.nStart + l.nLen;
    for (let i = l.nStart; i < nEnd; ++i) {
      const aChar = rText[i];
      if (CH_TAB !== aChar && ' ' !== aChar) return i;
    }
    return nEnd;
  }

  /** SwTextMargin::GetTextEnd */
  private GetTextEnd(l: SwLineLayout): number {
    const rText = this.text();
    const nEnd = l.nStart + l.nLen;
    for (let i = nEnd - 1; i >= l.nStart; --i) {
      const aChar = rText[i];
      if (CH_TAB !== aChar && CH_BREAK !== aChar && ' ' !== aChar) return i + 1;
    }
    return l.nStart;
  }

  /** The x position of a character, relative to the frame's print area. */
  private charX(f: SwTextFrame, nChar: number): number {
    const r = this.m_pRoot.GetCharRect(this.m_pFrame!, nChar);
    return r ? r.Left() - f.nLeft : 0;
  }

  // Where does the text start (without whitespace)? (relative in the Frame)
  private LineStart(l: Line): number {
    const nTextStart = this.GetTextStart(l.line);
    if (l.line.nStart === nTextStart) return l.line.nX;
    return this.charX(l.frame, nTextStart);
  }

  // Does the paragraph fit into one line?
  IsOneLine(): boolean {
    const fr = this.frames();
    if (!fr.length) return false;
    // For follows false of course
    if (fr.length > 1) return false;
    return fr[0]!.lines.slice(1).every((l) => !l.nLen);
  }

  // Is the line filled for X percent?
  IsFilled(nPercent: number): boolean {
    const fr = this.frames();
    const pLay = fr[0]?.lines[0];
    if (!pLay) return false;
    const nWidth = (fr[0]!.nWidth * nPercent) / 100;
    return nWidth <= pLay.nWidth;
  }

  // Where does the text start (without whitespace)? (relative in the Frame)
  GetLineStart(): number {
    const l = this.lines()[0];
    return l ? this.LineStart(l) : 0;
  }

  // Calculates the character's position and returns the middle position
  GetCharPos(nChar: number, bCenter = true): number {
    const f = this.frames()[0];
    if (!f) return 0;
    const nStt = this.charX(f, nChar);
    if (!bCenter) return nStt;
    const nNext = this.charX(f, nChar + 1);
    return Math.trunc((nNext + nStt) / 2);
  }

  // Accumulates the whitespace at line start and end in the vector
  GetSpaces(rRanges: [number, number][], bWithLineBreak: boolean): void {
    const AddRange = (nPos: number, nLen: number) => {
      if (!nLen) return;
      const last = rRanges[rRanges.length - 1];
      if (last && nPos === last[1]) last[1] += nLen;
      else rRanges.push([nPos, nPos + nLen]);
    };
    const all = this.lines(), rText = this.text();
    let bFirstLine = true;
    all.forEach((l, i) => {
      if (l.line.nLen) {
        const nPos = this.GetTextStart(l.line);
        // Do NOT include the blanks/tabs from the first line
        // in the selection
        if (!bFirstLine && nPos > l.line.nStart)
          AddRange(l.line.nStart, nPos - l.line.nStart);
        // Do NOT include the blanks/tabs from the last line
        // in the selection
        if (i + 1 < all.length) {
          const nEndPos = this.GetTextEnd(l.line);
          const nEnd = l.line.nStart + l.line.nLen;
          // if only whitespace in line, nEndPos < nPos !
          if (nPos < nEndPos && nEndPos < nEnd) {
            const nOff = !bWithLineBreak && CH_BREAK === rText[nEnd - 1] ? 1 : 0;
            AddRange(nEndPos, nEnd - nEndPos - nOff);
          }
        }
      }
      bFirstLine = false;
    });
  }

  // Is there a bullet/symbol etc. at the text position?
  // Fonts: CharSet, SYMBOL and DONTKNOW
  IsBullet(nTextStart: number): boolean {
    if (!this.m_pFrame) return false;
    const font = this.m_pFrame.GetCharAttrAt('RES_CHRATR_FONT', nTextStart);
    return /^(OpenSymbol|StarSymbol|Symbol|Wingdings[ 0-9]*|Webdings|Marlett)$/i.test(font);
  }

  // Get first line indent
  // The precondition for a positive or negative first line indent:
  // All lines (except for the first one) have the same left margin.
  // We do not want to be so picky and work with a tolerance of TOLERANCE twips.
  GetFirstIndent(): number {
    const all = this.lines();
    if (!all.length) return 0;
    const nFirst = this.LineStart(all[0]!);
    const TOLERANCE = 20;
    if (all.length < 2) return 0;
    const nLeft = this.LineStart(all[1]!);
    for (const l of all.slice(2)) {
      if (l.line.nLen) {
        const nCurrLeft = this.LineStart(l);
        if (nLeft + TOLERANCE < nCurrLeft ||
          nLeft - TOLERANCE > nCurrLeft)
          return 0;
      }
    }
    // At first we only return +1, -1 and 0
    if (nLeft === nFirst) return 0;
    if (nLeft > nFirst) return -1;
    return 1;
  }
}
