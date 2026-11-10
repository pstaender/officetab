// SPDX-License-Identifier: MPL-2.0
// @upstream sw/inc/ndarr.hxx reduced
// @upstream sw/source/core/docnode/nodes.cxx reduced
// @upstream sw/source/core/docnode/ndtbl.cxx reduced
// Upstream's auxiliary sections (footnotes, autotext, redlines) are not created yet: only the content section.
import { BigPtrArray } from './bparr.ts';
import { SwEndNode, SwNode, SwStartNode, SwTableNode } from './node.ts';
import { SwTextNode } from './ndtxt.ts';
import type { SwTextFormatColl } from './format.ts';
import type { SwAttrSet } from './hintids.ts';
import { SwTable, SwTableBox, SwTableLine, defaultBoxAttrs, type SwTableFormatAttrs } from './swtable.ts';

export class SwNodes extends BigPtrArray {
  m_pEndOfContent: SwEndNode;
  m_pStartOfContent: SwStartNode;

  constructor() {
    super();
    this.m_pStartOfContent = new SwStartNode(this);
    this.Insert(this.m_pStartOfContent, 0);
    this.m_pEndOfContent = new SwEndNode(this, this.m_pStartOfContent);
    this.Insert(this.m_pEndOfContent, 1);
  }

  GetEndOfContent(): SwEndNode { return this.m_pEndOfContent; }

  node(i: number): SwNode { return this.at(i) as SwNode; }

  /** Creates a text node before position `where`, in the section containing it. */
  MakeTextNode(where: number, coll: SwTextFormatColl, text = ''): SwTextNode {
    const n = new SwTextNode(this, coll, text);
    const after = this.node(where);
    n.m_pStartOfSection = after.IsEndNode() ? after.m_pStartOfSection : after.m_pStartOfSection;
    this.Insert(n, where);
    return n;
  }

  /** The section containing a new node inserted at `where` (before the node now there). */
  SectionAt(where: number): SwStartNode {
    const prev = this.node(where - 1);
    if (prev.IsStartNode()) return prev as SwStartNode;
    if (prev.IsEndNode()) return prev.m_pStartOfSection!.m_pStartOfSection!;
    return prev.m_pStartOfSection!;
  }

  /**
   * SwNodes::InsertTable: a table node, then per box a start node, one text node and an end node,
   * then the table's end node, all before `where`. Also builds the SwTable lines and boxes.
   */
  InsertTable(where: number, nBoxes: number, pContentTextColl: SwTextFormatColl, nLines: number, nRepeat: number,
    pHeadlineTextColl: SwTextFormatColl | null, attrs: SwTableFormatAttrs, pAttrSet?: SwAttrSet, bBorders = true): SwTableNode {
    // If Lines is given, create the Matrix from Lines and Boxes
    if (!pHeadlineTextColl || !nLines) pHeadlineTextColl = pContentTextColl;
    const parent = this.SectionAt(where);
    const table = new SwTable(attrs);
    table.m_nRowsToRepeat = nRepeat;
    const pTableNd = new SwTableNode(this, table);
    pTableNd.m_pStartOfSection = parent;
    let at = where;
    this.Insert(pTableNd, at++);
    if (!nLines) ++nLines; // For the for loop
    let pTextColl = pHeadlineTextColl;
    for (let nL = 0; nL < nLines; ++nL) {
      const line = new SwTableLine();
      table.m_aLines.push(line);
      for (let nB = 0; nB < nBoxes; ++nB) {
        const pSttNd = new SwStartNode(this);
        pSttNd.m_pStartOfSection = pTableNd;
        this.Insert(pSttNd, at++);
        const pTmpNd = new SwTextNode(this, pTextColl);
        pTmpNd.m_pStartOfSection = pSttNd;
        // #i60422# Propagate some more attributes.
        if (pAttrSet) {
          for (const k of ['RES_PARATR_ADJUST', 'RES_CHRATR_FONT', 'RES_CHRATR_FONTSIZE'] as const) {
            if (pAttrSet[k] !== undefined) (pTmpNd.m_aSet as Record<string, unknown>)[k] = pAttrSet[k];
          }
        }
        this.Insert(pTmpNd, at++);
        const pEnd = new SwEndNode(this, pSttNd);
        pEnd.m_pStartOfSection = pSttNd;
        this.Insert(pEnd, at++);
        const box = new SwTableBox(line, defaultBoxAttrs(1, bBorders));
        box.m_pStartNode = pSttNd;
        line.m_aBoxes.push(box);
      }
      if (nL + 1 >= nRepeat) pTextColl = pContentTextColl;
    }
    this.Insert(new SwEndNode(this, pTableNd), at);
    return pTableNd;
  }

  /** Next text node after index `i` in document order, skipping structure nodes. */
  GoNext(i: number): SwTextNode | null {
    for (let k = i + 1; k < this.Count(); k++) { const n = this.node(k); if (n.IsTextNode()) return n; }
    return null;
  }

  GoPrevious(i: number): SwTextNode | null {
    for (let k = i - 1; k >= 0; k--) { const n = this.node(k); if (n.IsTextNode()) return n; }
    return null;
  }

  FirstTextNode(): SwTextNode { return this.GoNext(0)!; }
  LastTextNode(): SwTextNode { return this.GoPrevious(this.Count() - 1)!; }
}
