// SPDX-License-Identifier: MPL-2.0
// @upstream sw/inc/swtable.hxx reduced
// @upstream sw/source/core/table/swtable.cxx reduced
// @upstream sw/source/core/table/swnewtable.cxx partial
// Upstream keeps table, line and box properties in shared frame formats; here each object carries
// its own attribute record. Boxes hold no nested lines: only the "new table model" (simple rows of
// boxes with row spans) is ported. Box widths are relative; the layout scales them to the table width.
import type { SwStartNode } from './node.ts';

import type { SvxBorderLine } from './hintids.ts';
export type { SvxBorderLine };
export interface SvxBoxItem { left: SvxBorderLine | null; top: SvxBorderLine | null; right: SvxBorderLine | null; bottom: SvxBorderLine | null }

/** text::HoriOrientation for tables. */
export type SwTableAdjust = 'full' | 'left' | 'center' | 'right' | 'none';

export interface SwTableFormatAttrs {
  name: string;
  adjust: SwTableAdjust;
  /** Table width in twips; ignored for 'full'. */
  width: number;
  /** Left indent for 'none' and 'left'. */
  leftSpace: number;
  upper: number;
  lower: number;
}

export interface SwTableBoxAttrs {
  /** Relative width (SwFormatFrameSize of the box format). */
  width: number;
  box: SvxBoxItem;
  /** Spacing to contents, twips (SvxBoxItem's left and right distance, and top and bottom unless `dist` says otherwise). */
  padding: number;
  /** SvxBoxItem's top and bottom distance where they differ from the left and right one. */
  dist?: { top: number; bottom: number };
  background: string | null;
  /** SwFormatVertOrient of the box: where the content sits in the cell (top by default). */
  vertOrient?: 'center' | 'bottom';
  /** SvxFrameDirectionItem: Vertical_LR_BT (bottom to top) or Vertical_RL_TB (top to bottom). */
  frameDir?: 'bt-lr' | 'tb-rl';
  /** SvxProtectItem's content protection (Table > Protect Cells). */
  protect?: boolean;
}

export interface SwTableLineAttrs { minHeight: number }

/** Writer's default table border: 0.5 pt, black (SwInsertTableFlags::DefaultBorder). */
export const DEF_BORDER: SvxBorderLine = { color: '#000000', width: 10 };
/** Default spacing to contents, 0.10 cm. */
export const DEF_BOX_PADDING = 55;

export const defaultBoxAttrs = (width: number, borders = true): SwTableBoxAttrs => ({
  width,
  box: borders ? { left: { ...DEF_BORDER }, top: { ...DEF_BORDER }, right: { ...DEF_BORDER }, bottom: { ...DEF_BORDER } } : { left: null, top: null, right: null, bottom: null },
  padding: DEF_BOX_PADDING,
  background: null,
});

export class SwTableBox {
  m_pStartNode: SwStartNode | null = null;
  m_pUpper: SwTableLine;
  /** 1 for a normal box, > 1 for the top box of a vertical merge, < 0 for boxes it covers. */
  mnRowSpan = 1;
  m_aAttrs: SwTableBoxAttrs;

  constructor(upper: SwTableLine, attrs: SwTableBoxAttrs) {
    this.m_pUpper = upper;
    this.m_aAttrs = attrs;
  }

  GetSttNd(): SwStartNode | null { return this.m_pStartNode; }
  GetUpper(): SwTableLine { return this.m_pUpper; }
  getRowSpan(): number { return this.mnRowSpan; }
  setRowSpan(n: number): void { this.mnRowSpan = n; }
}

export class SwTableLine {
  m_aBoxes: SwTableBox[] = [];
  m_aAttrs: SwTableLineAttrs = { minHeight: 0 };
  GetTabBoxes(): SwTableBox[] { return this.m_aBoxes; }
}

export class SwTable {
  m_aLines: SwTableLine[] = [];
  m_aAttrs: SwTableFormatAttrs;
  m_nRowsToRepeat = 0;

  constructor(attrs: SwTableFormatAttrs) { this.m_aAttrs = attrs; }

  GetTabLines(): SwTableLine[] { return this.m_aLines; }
  GetRowsToRepeat(): number { return Math.min(this.m_aLines.length, this.m_nRowsToRepeat); }
  GetFrameFormat(): SwTableFormatAttrs { return this.m_aAttrs; }

  /** Boxes in document (row-major) order, matching the order of their start nodes. */
  GetTabSortBoxes(): SwTableBox[] { return this.m_aLines.flatMap((l) => l.m_aBoxes); }

  GetTableBox(startNode: SwStartNode): SwTableBox | undefined {
    return this.GetTabSortBoxes().find((b) => b.m_pStartNode === startNode);
  }

  /** The line index of a box. */
  GetLineIndex(box: SwTableBox): number { return this.m_aLines.indexOf(box.m_pUpper); }

  /**
   * SwTable::CreateSelection: the boxes between the boxes of two start nodes, as a rectangle by
   * their logical borders; SEARCH_ROW takes whole rows, SEARCH_COL whole columns. Protected boxes
   * are left out with bChkProtected.
   */
  CreateSelection(pStartNd: SwStartNode, pEndNd: SwStartNode, eSearch: SearchType = SearchType.SEARCH_NONE, bChkProtected = false): SwTableBox[] {
    const rBoxes = new Set<SwTableBox>();
    const isProt = (b: SwTableBox) => bChkProtected && !!b.m_aAttrs.protect;
    // Looking for start and end of the selection given by SwNode-pointer
    const nLines = this.m_aLines.length;
    let nTop = 0, nBottom = 0;
    let nUpperMin = 0, nUpperMax = 0, nLowerMin = 0, nLowerMax = 0;
    // nFound will incremented if a box is found
    // 0 => no box found; 1 => the upper box has been found; 2 => both found
    let nFound = 0;
    for (let nRow = 0; nFound < 2 && nRow < nLines; ++nRow) {
      const pLine = this.m_aLines[nRow]!;
      const nCols = pLine.m_aBoxes.length;
      for (let nCol = 0; nCol < nCols; ++nCol) {
        const pBox = pLine.m_aBoxes[nCol]!;
        if (pBox.m_pStartNode === pEndNd || pBox.m_pStartNode === pStartNd) {
          if (!isProt(pBox)) rBoxes.add(pBox);
          if (nFound) {
            //if box is hiding cells bottom needs to be moved
            if (pBox.getRowSpan() > 1) nBottom = Math.max(nBottom, nRow + pBox.getRowSpan() - 1);
            else nBottom = Math.max(nRow, nBottom);
            [nLowerMin, nLowerMax] = lcl_CheckMinMax(nLowerMin, nLowerMax, pLine, nCol, true);
            ++nFound;
            break;
          } else {
            nTop = nRow;
            //if box is hiding cells bottom needs to be moved
            if (pBox.getRowSpan() > 1) nBottom = nRow + pBox.getRowSpan() - 1;
            [nUpperMin, nUpperMax] = lcl_CheckMinMax(nUpperMin, nUpperMax, pLine, nCol, true);
            ++nFound;
            // If start and end node are identical, we're nearly done...
            if (pEndNd === pStartNd) {
              nBottom = nTop;
              nLowerMin = nUpperMin;
              nLowerMax = nUpperMax;
              ++nFound;
            }
          }
        }
      }
    }
    if (nFound < 2) return []; // At least one node was not a part of the given table
    if (eSearch === SearchType.SEARCH_ROW) {
      // every (unprotected) box between start and end line with a positive row span
      for (let nRow = nTop; nRow <= nBottom; ++nRow) for (const pBox of this.m_aLines[nRow]!.m_aBoxes) if (pBox.getRowSpan() > 0 && !isProt(pBox)) rBoxes.add(pBox);
      return this.sorted(rBoxes);
    }
    let bCombine = nTop === nBottom;
    if (!bCombine) {
      let nMinWidth = nUpperMax - nUpperMin;
      let nTmp = nLowerMax - nLowerMin;
      if (nMinWidth > nTmp) nMinWidth = nTmp;
      nTmp = Math.min(nLowerMax, nUpperMax);
      nTmp -= nLowerMin < nUpperMin ? nUpperMin : nLowerMin;
      // If the overlapping between upper and lower box is less than half
      // of the width (of the smaller cell), bCombine is set,
      // e.g. if upper and lower cell are in different columns
      bCombine = nTmp + nTmp < nMinWidth;
    }
    if (bCombine) {
      if (nUpperMin < nLowerMin) nLowerMin = nUpperMin; else nUpperMin = nLowerMin;
      if (nUpperMax > nLowerMax) nLowerMax = nUpperMax; else nUpperMax = nLowerMax;
    }
    const bColumn = eSearch === SearchType.SEARCH_COL;
    if (bColumn) for (let i = 0; i < nTop; ++i) lcl_SearchSelBox(this, rBoxes, nUpperMin, nUpperMax, this.m_aLines[i]!, bChkProtected, bColumn);
    {
      const nMin = Math.min(nUpperMin, nLowerMin);
      const nMax = nUpperMax < nLowerMax ? nLowerMax : nUpperMax;
      for (let i = nTop; i <= nBottom; ++i) lcl_SearchSelBox(this, rBoxes, nMin, nMax, this.m_aLines[i]!, bChkProtected, bColumn);
    }
    if (bColumn) for (let i = nBottom + 1; i < nLines; ++i) lcl_SearchSelBox(this, rBoxes, nLowerMin, nLowerMax, this.m_aLines[i]!, bChkProtected, true);
    return this.sorted(rBoxes);
  }

  /** SwSelBoxes are sorted by their start node's position. */
  private sorted(boxes: Set<SwTableBox>): SwTableBox[] {
    const order = this.GetTabSortBoxes();
    return [...boxes].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }

  /**
   * SwTable::CollectBoxSelection: the rectangle of boxes between two boxes, line by line, for
   * merging; null when the selection is no rectangle. Boxes overlapping its edges are resized to
   * end at them (the widths of their neighbours change accordingly), unless `bApply` is off.
   */
  CollectBoxSelection(pStartNd: SwStartNode, pEndNd: SwStartNode, bApply = true): SwBoxSelection | null {
    if (!this.m_aLines.length || pStartNd === pEndNd) return null;
    const nLines = this.m_aLines.length;
    let nTop = 0, nBottom = 0, nMin = 0, nMax = 0, nFound = 0;
    for (let nRow = 0; nFound < 2 && nRow < nLines; ++nRow) {
      const pLine = this.m_aLines[nRow]!;
      for (let nCol = 0; nCol < pLine.m_aBoxes.length; ++nCol) {
        const pBox = pLine.m_aBoxes[nCol]!;
        if (nFound) {
          if (pBox.m_pStartNode === pEndNd) { nBottom = nRow; [nMin, nMax] = lcl_CheckMinMax(nMin, nMax, pLine, nCol, false); ++nFound; break; }
        } else if (pBox.m_pStartNode === pStartNd) { nTop = nRow; [nMin, nMax] = lcl_CheckMinMax(nMin, nMax, pLine, nCol, true); ++nFound; }
      }
    }
    if (nFound < 2) return null;
    let bOkay = true;
    const nMid = (nMin + nMax) / 2;
    const pRet: SwBoxSelection = { maBoxes: [], mnMergeWidth: 0 };
    const aNewWidthVector: [SwTableBox, number][] = [];
    let nCheckBottom = nBottom;
    let nLeftSpan = 0, nRightSpan = 0, nLeftSpanCnt = 0, nRightSpanCnt = 0;
    for (let nRow = nTop; nRow <= nBottom && bOkay && nRow < nLines; ++nRow) {
      const pLine = this.m_aLines[nRow]!;
      const aBoxes: SwTableBox[] = [];
      let nRight = 0;
      const nCount = pLine.m_aBoxes.length;
      for (let nCurrBox = 0; nCurrBox < nCount; ++nCurrBox) {
        const pBox = pLine.m_aBoxes[nCurrBox]!;
        const nLeft = nRight;
        nRight += pBox.m_aAttrs.width;
        const nRowSpan = pBox.getRowSpan();
        if (nRight <= nMin) {
          if (nRight === nMin && nLeftSpanCnt) bOkay = false;
          continue;
        }
        let pInnerBox: SwTableBox | null = null, pLeftBox: SwTableBox | null = null, pRightBox: SwTableBox | null = null;
        let nDiff = 0, nDiff2 = 0;
        if (nLeft < nMin) {
          if (nRight >= nMid || nRight + nLeft >= nMin + nMin) {
            if (nCurrBox) {
              aBoxes.push(pBox);
              pInnerBox = pBox;
              pLeftBox = pLine.m_aBoxes[nCurrBox - 1]!;
              nDiff = nMin - nLeft;
              if (nRight > nMax) {
                if (nCurrBox + 1 < nCount) { pRightBox = pLine.m_aBoxes[nCurrBox + 1]!; nDiff2 = nRight - nMax; }
                else bOkay = false;
              } else if (nRightSpanCnt && nRight === nMax) bOkay = false;
            } else bOkay = false;
          } else if (nCurrBox + 1 < nCount) {
            pLeftBox = pBox;
            pInnerBox = pLine.m_aBoxes[nCurrBox + 1]!;
            nDiff = nMin - nRight;
          } else bOkay = false;
        } else if (nRight <= nMax) {
          aBoxes.push(pBox);
          if (nRow === nTop && nRowSpan < 0) { bOkay = false; break; }
          if (nRowSpan > 1 && nRow + nRowSpan - 1 > nBottom) nBottom = nRow + nRowSpan - 1;
          if (nRowSpan < -1 && nRow - nRowSpan - 1 > nBottom) nBottom = nRow - nRowSpan - 1;
          if (nRightSpanCnt && nRight === nMax) bOkay = false;
        } else if (nLeft < nMax) {
          if (nLeft <= nMid || nRight + nLeft <= nMax) {
            if (nCurrBox + 1 < nCount) {
              aBoxes.push(pBox);
              pInnerBox = pBox;
              pRightBox = pLine.m_aBoxes[nCurrBox + 1]!;
              nDiff = nRight - nMax;
            } else bOkay = false;
          } else if (nCurrBox) {
            pRightBox = pBox;
            pInnerBox = pLine.m_aBoxes[nCurrBox - 1]!;
            nDiff = nLeft - nMax;
          } else bOkay = false;
        } else break;
        if (pInnerBox) {
          if (nRow === nBottom) {
            const nTmpSpan = pInnerBox.getRowSpan();
            if (nTmpSpan > 1) nBottom += nTmpSpan - 1;
            else if (nTmpSpan < -1) nBottom -= nTmpSpan + 1;
          }
          let pOuterBox: SwTableBox | null = pLeftBox;
          do {
            if (pOuterBox) {
              let nOutSpan = pOuterBox.getRowSpan();
              if (nOutSpan !== 1) {
                let nCheck = nRow;
                if (nOutSpan < 0) {
                  const rBox = this.FindStartOfRowSpan(pOuterBox);
                  nOutSpan = rBox.getRowSpan();
                  nCheck = this.GetLineIndex(rBox);
                  if (nCheck < nTop) bOkay = false;
                  if (pOuterBox === pLeftBox) { if (!nLeftSpanCnt || nMin - nDiff !== nLeftSpan) bOkay = false; }
                  else if (!nRightSpanCnt || nMax + nDiff !== nRightSpan) bOkay = false;
                } else if (pOuterBox === pLeftBox) {
                  if (nLeftSpanCnt) bOkay = false;
                  nLeftSpan = nMin - nDiff;
                  nLeftSpanCnt = nOutSpan;
                } else {
                  if (nRightSpanCnt) bOkay = false;
                  nRightSpan = nMax + nDiff;
                  nRightSpanCnt = nOutSpan;
                }
                nCheck += nOutSpan - 1;
                if (nCheck > nCheckBottom) nCheckBottom = nCheck;
              } else if ((nLeftSpanCnt && pLeftBox === pOuterBox) || (nRightSpanCnt && pRightBox === pOuterBox)) bOkay = false;
              aNewWidthVector.push([pInnerBox, -nDiff], [pOuterBox, nDiff]);
            }
            pOuterBox = pOuterBox === pRightBox ? null : pRightBox;
            if (nDiff2) nDiff = nDiff2;
          } while (pOuterBox);
        }
      }
      if (nLeftSpanCnt) --nLeftSpanCnt;
      if (nRightSpanCnt) --nRightSpanCnt;
      pRet.maBoxes.push(aBoxes);
    }
    if (nCheckBottom > nBottom) bOkay = false;
    if (!bOkay) return null;
    pRet.mnMergeWidth = nMax - nMin;
    if (bApply) for (const [box, diff] of aNewWidthVector) box.m_aAttrs = { ...box.m_aAttrs, width: box.m_aAttrs.width + diff };
    return pRet;
  }

  /** SwTable::PrepareDelBoxes: the row spans of merges that lose boxes. */
  PrepareDelBoxes(rBoxes: SwTableBox[]): void {
    for (let pBox of rBoxes) {
      let nRowSpan = pBox.getRowSpan();
      if (nRowSpan !== 1 && pBox.m_aAttrs.width) {
        const nLeft = lcl_Box2LeftBorder(pBox);
        let nLinePos = this.GetLineIndex(pBox);
        if (nRowSpan > 1) {
          if (++nLinePos < this.m_aLines.length) {
            const b = lcl_LeftBorder2Box(nLeft, this.m_aLines[nLinePos]);
            if (b) b.setRowSpan(--nRowSpan);
          }
        } else if (nLinePos > 0) {
          do {
            const b = lcl_LeftBorder2Box(nLeft, this.m_aLines[--nLinePos]);
            if (b) {
              pBox = b;
              nRowSpan = pBox.getRowSpan();
              if (nRowSpan > 1) --nRowSpan; else ++nRowSpan;
              pBox.setRowSpan(nRowSpan);
            } else nRowSpan = 1;
          } while (nRowSpan < 0 && nLinePos > 0);
        }
      }
    }
  }

  /** SwTable::FindSuperfluousRows_: rows of the selection with covered cells only go with the merge. */
  FindSuperfluousRows_(rBoxes: Set<SwTableBox>, pFirstLn: SwTableLine | null, pLastLn: SwTableLine | null): void {
    if (!pFirstLn || !pLastLn) {
      if (!rBoxes.size) return;
      const all = [...rBoxes];
      pFirstLn = all[0]!.m_pUpper;
      pLastLn = all[all.length - 1]!.m_pUpper;
    }
    const nFirstLn = this.m_aLines.indexOf(pFirstLn), nLastLn = this.m_aLines.indexOf(pLastLn);
    for (let nRow = nFirstLn; nRow <= nLastLn; ++nRow) {
      const pLine = this.m_aLines[nRow]!;
      const bSuperfl = pLine.m_aBoxes.every((pBox) => !(pBox.getRowSpan() > 0 && !rBoxes.has(pBox)));
      if (bSuperfl) for (const pBox of pLine.m_aBoxes) rBoxes.add(pBox);
    }
  }

  /** SwTableBox::FindStartOfRowSpan: the master box of a box covered by a vertical merge. */
  FindStartOfRowSpan(rBox: SwTableBox): SwTableBox {
    if (rBox.getRowSpan() > 0) return rBox;
    const nLeft = lcl_Box2LeftBorder(rBox);
    let nLine = this.GetLineIndex(rBox);
    let pBox = rBox;
    while (nLine > 0 && pBox.getRowSpan() < 1) {
      const pNext = lcl_LeftBorder2Box(nLeft, this.m_aLines[--nLine]!);
      if (!pNext) break;
      pBox = pNext;
    }
    return pBox;
  }
}

/** SwBoxSelection: the boxes of a rectangle, line by line, and the width of a merged box. */
export interface SwBoxSelection { maBoxes: SwTableBox[][]; mnMergeWidth: number }

/** SwTable::SearchType */
export const SearchType = { SEARCH_NONE: 0, SEARCH_ROW: 1, SEARCH_COL: 2 } as const;
export type SearchType = (typeof SearchType)[keyof typeof SearchType];

/** lcl_CheckMinMax: [min, max] widened to (or with bSet set to) the borders of box nCheck. */
function lcl_CheckMinMax(rMin: number, rMax: number, rLine: SwTableLine, nCheck: number, bSet: boolean): [number, number] {
  ++nCheck;
  if (rLine.m_aBoxes.length < nCheck) nCheck = rLine.m_aBoxes.length; // robust
  let nNew = 0; // will be the right border of the current box
  let nWidth = 0; // the width of the current box
  for (let nCurrBox = 0; nCurrBox < nCheck; ++nCurrBox) { nWidth = rLine.m_aBoxes[nCurrBox]!.m_aAttrs.width; nNew += nWidth; }
  // nNew is the right border of the wished box
  if (bSet || nNew > rMax) rMax = nNew;
  nNew -= nWidth; // nNew becomes the left border of the wished box
  if (bSet || nNew < rMin) rMin = nNew;
  return [rMin, rMax];
}

/** lcl_Box2LeftBorder: the sum of the widths of the boxes before it in its line. */
export function lcl_Box2LeftBorder(rBox: SwTableBox): number {
  let nLeft = 0;
  for (const pBox of rBox.m_pUpper.m_aBoxes) { if (pBox === rBox) return nLeft; nLeft += pBox.m_aAttrs.width; }
  return nLeft;
}

/** lcl_LeftBorder2Box: the box of a line with the given left border (a little tolerance for rounding). */
export function lcl_LeftBorder2Box(nLeft: number, pLine: SwTableLine | undefined): SwTableBox | null {
  if (!pLine) return null;
  let nCurrLeft = 0;
  for (const pBox of pLine.m_aBoxes) {
    if (pBox.m_aAttrs.width) {
      if (nCurrLeft === nLeft) return pBox;
      // HACK: It appears that rounding errors may result in positions not matching exactly.
      if (Math.abs(nCurrLeft - nLeft) <= nLeft / 1000) return pBox;
      if (nCurrLeft >= nLeft) return pBox;
    }
    nCurrLeft += pBox.m_aAttrs.width;
  }
  return null;
}

/**
 * lcl_ChangeRowSpan: the row spans of earlier rows after nDiff rows were inserted (nDiff > 0) or
 * deleted at nRowIdx; bSingle keeps spans ending just above inserted rows from growing.
 */
export function lcl_ChangeRowSpan(rTable: SwTable, nDiff: number, nRowIdx: number, bSingle: boolean): void {
  if (!nDiff || nRowIdx >= rTable.m_aLines.length) return;
  let bGoOn: boolean;
  // nDistance is the distance between the current row and the critical row,
  // e.g. the deleted rows or the inserted rows.
  let nDistance = bSingle ? 1 : 0;
  do {
    bGoOn = false; // will be set to true if we found a non-master cell
    const pLine = rTable.m_aLines[nRowIdx]!;
    for (const box of pLine.m_aBoxes) {
      let nRowSpan = box.getRowSpan();
      const nAbsSpan = nRowSpan > 0 ? nRowSpan : -nRowSpan;
      // Check if the last overlapped cell is above or below the critical area
      if (nAbsSpan > nDistance) {
        if (nDiff > 0) {
          if (nRowSpan > 0) nRowSpan += nDiff; // increment row span of master cell
          else { nRowSpan -= nDiff; bGoOn = true; } // increment row span of non-master cell
        } else if (nRowSpan > 0) {
          // A master cell: end of row span behind the deleted area .. or inside the deleted area
          if (nRowSpan - nDistance > -nDiff) nRowSpan += nDiff; else nRowSpan = nDistance + 1;
        } else {
          // Same for a non-master cell
          if (nRowSpan + nDistance < nDiff) nRowSpan -= nDiff; else nRowSpan = -nDistance - 1;
          bGoOn = true; // We have to continue
        }
        box.setRowSpan(nRowSpan);
      }
    }
    ++nDistance;
    if (nRowIdx) --nRowIdx;
    else bGoOn = false; //robust
  } while (bGoOn);
}

/** lcl_UnMerge: splits the merge of a master box into nCnt merges (of rows evenly shared). */
export function lcl_UnMerge(rTable: SwTable, rBox: SwTableBox, nCnt: number): void {
  const set = new Set<SwTableBox>();
  lcl_getAllMergedBoxes(rTable, set, rBox);
  const aBoxes = [...set];
  const nCount = aBoxes.length;
  if (nCount < 2) return;
  if (nCnt > nCount) nCnt = nCount;
  const pSplitIdx: number[] = [];
  for (let i = 1; i <= nCnt; ++i) pSplitIdx[i - 1] = Math.trunc((i * nCount) / nCnt);
  let nIdx = 0;
  for (let i = 0; i < nCnt; ++i) {
    const nNextIdx = pSplitIdx[i]!;
    aBoxes[nIdx]!.setRowSpan(nNextIdx - nIdx);
    while (++nIdx < nNextIdx) aBoxes[nIdx]!.setRowSpan(nIdx - nNextIdx);
  }
}

/** lcl_SophisticatedFillLineIndices: where and how many rows to insert to split boxes into nCnt rows. */
export function lcl_SophisticatedFillLineIndices(rTable: SwTable, rBoxes: SwTableBox[], nCnt: number): [number, number][] {
  const rArr: [number, number][] = [];
  let aBoxes: [number, number][] = [];
  let aLnOfs: [number, number] = [-1, -1];
  for (const b of rBoxes) {
    // Collect all end line indices and the row spans
    const rBox = rTable.FindStartOfRowSpan(b);
    if (nCnt > rBox.getRowSpan()) {
      const nEnd = rBox.getRowSpan() + rTable.GetLineIndex(rBox);
      // The next if statement is a small optimization
      if (aLnOfs[0] !== nEnd || aLnOfs[1] !== rBox.getRowSpan()) {
        aLnOfs = [nEnd, rBox.getRowSpan()]; // the line behind the box, the row span
        aBoxes.push([...aLnOfs]);
      }
    }
  }
  // the line index _behind_ the last line of the boxes; in the resulting array the index has to be _on_ the line
  let nSum = 1;
  while (aBoxes.length) {
    // I. step: Looking for the "smallest" line end with the smallest row span
    aLnOfs = [...aBoxes[0]!];
    for (const c of aBoxes.slice(1)) {
      if (aLnOfs[0] > c[0]) aLnOfs = [c[0], c[1]]; // Found a smaller line end
      else if (aLnOfs[0] === c[0] && aLnOfs[1] < c[1]) aLnOfs[1] = c[1]; // Found a smaller row span
    }
    aLnOfs[1] = nCnt - aLnOfs[1]; // the number of rows to insert
    rArr.push([aLnOfs[0] - nSum, aLnOfs[1]]);
    // the correction has to be incremented because in the following loops the line ends were manipulated
    nSum += aLnOfs[1];
    const next: [number, number][] = [];
    for (const c of aBoxes) {
      // These boxes can be removed because the last insertion of rows will expand their row span above the needed value
      if (c[0] === aLnOfs[0]) continue;
      const bBefore = c[0] - c[1] < aLnOfs[0];
      // Manipulation of the end line indices as if the rows are already inserted
      c[0] += aLnOfs[1];
      if (bBefore) {
        // If the insertion is inside the box, its row span has to be incremented
        c[1] += aLnOfs[1];
        if (c[1] >= nCnt) continue; // if the row span is bigger than the split factor this box is done
      }
      next.push(c);
    }
    aBoxes = next;
  }
  return rArr;
}

/** SwTable::ExpandSelection: a merged box's covered boxes and master join the selection. */
export function ExpandSelection(rTable: SwTable, rBoxes: SwTableBox[]): SwTableBox[] {
  const set = new Set(rBoxes);
  for (const pBox of rBoxes) {
    const nRowSpan = pBox.getRowSpan();
    if (nRowSpan !== 1) lcl_getAllMergedBoxes(rTable, set, nRowSpan > 0 ? pBox : rTable.FindStartOfRowSpan(pBox));
  }
  const order = rTable.GetTabSortBoxes();
  return [...set].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

/** lcl_getAllMergedBoxes: the master box and every box it covers. */
function lcl_getAllMergedBoxes(rTable: SwTable, rBoxes: Set<SwTableBox>, rBox: SwTableBox): void {
  let pBox: SwTableBox | null = rBox;
  rBoxes.add(pBox);
  if (pBox.getRowSpan() === 1) return;
  const nLeft = lcl_Box2LeftBorder(pBox);
  const nCount = rTable.m_aLines.length;
  for (let nLine = rTable.GetLineIndex(pBox) + 1; nLine < nCount; ++nLine) {
    pBox = lcl_LeftBorder2Box(nLeft, rTable.m_aLines[nLine]);
    if (pBox && pBox.getRowSpan() < 0) rBoxes.add(pBox);
    else break;
  }
}

function lcl_SearchSelBox(rTable: SwTable, rBoxes: Set<SwTableBox>, nMin: number, nMax: number, rLine: SwTableLine, bChkProtected: boolean, bColumn: boolean): void {
  let nLeft = 0;
  let nRight = 0;
  const nMid = (nMax + nMin) / 2;
  for (const pBox of rLine.m_aBoxes) {
    const nWidth = pBox.m_aAttrs.width;
    nRight += nWidth;
    if (nRight > nMin) {
      let bAdd: boolean;
      if (nRight <= nMax) bAdd = nLeft >= nMin || nRight >= nMid || nRight - nMin > nMin - nLeft;
      else bAdd = nLeft <= nMid || nRight - nMax < nMax - nLeft;
      const nRowSpan = pBox.getRowSpan();
      if (bAdd && (!bChkProtected || !pBox.m_aAttrs.protect)) {
        const nOldCnt = rBoxes.size;
        rBoxes.add(pBox);
        if (bColumn && nRowSpan !== 1 && nOldCnt < rBoxes.size) lcl_getAllMergedBoxes(rTable, rBoxes, rTable.FindStartOfRowSpan(pBox));
      }
    }
    if (nRight >= nMax) break;
    nLeft = nRight;
  }
}

/** A copy of the table structure without node references, for undo snapshots. */
export interface SwTableSnap {
  attrs: SwTableFormatAttrs;
  rowsToRepeat: number;
  lines: { attrs: SwTableLineAttrs; boxes: { attrs: SwTableBoxAttrs; rowSpan: number }[] }[];
}

export function SnapTable(t: SwTable): SwTableSnap {
  return structuredClone({
    attrs: t.m_aAttrs,
    rowsToRepeat: t.m_nRowsToRepeat,
    lines: t.m_aLines.map((l) => ({ attrs: l.m_aAttrs, boxes: l.m_aBoxes.map((b) => ({ attrs: b.m_aAttrs, rowSpan: b.mnRowSpan })) })),
  });
}

export function TableFromSnap(s: SwTableSnap): SwTable {
  const c = structuredClone(s);
  const t = new SwTable(c.attrs);
  t.m_nRowsToRepeat = c.rowsToRepeat;
  for (const ls of c.lines) {
    const line = new SwTableLine();
    line.m_aAttrs = ls.attrs;
    for (const bs of ls.boxes) {
      const box = new SwTableBox(line, bs.attrs);
      box.mnRowSpan = bs.rowSpan;
      line.m_aBoxes.push(box);
    }
    t.m_aLines.push(line);
  }
  return t;
}
