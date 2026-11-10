// SPDX-License-Identifier: MPL-2.0
// @upstream sw/inc/ndarr.hxx reduced
// @upstream sw/source/core/docnode/nodes.cxx reduced
// @upstream sw/source/core/docnode/ndtbl.cxx reduced
// Of upstream's auxiliary sections only the autotext one exists, holding headers and footers; it
// comes before the content section as upstream's does. Footnote and redline sections are not created.
import { BigPtrArray } from './bparr.ts';
import { SwNodeType, SwStartNodeType } from './ndtyp.ts';
import { SwEndNode, SwNode, SwStartNode, SwTableNode } from './node.ts';
import { SwTextNode } from './ndtxt.ts';
import type { SwTextFormatColl } from './format.ts';
import type { SwAttrSet } from './hintids.ts';
import { SwTable, SwTableBox, SwTableLine, defaultBoxAttrs, type SwTableFormatAttrs } from './swtable.ts';

export class SwNodes extends BigPtrArray {
  m_pEndOfAutotext: SwEndNode;
  m_pEndOfContent: SwEndNode;
  m_pStartOfContent: SwStartNode;

  constructor() {
    super();
    const autotext = new SwStartNode(this);
    this.Insert(autotext, 0);
    this.m_pEndOfAutotext = new SwEndNode(this, autotext);
    this.Insert(this.m_pEndOfAutotext, 1);
    this.m_pStartOfContent = new SwStartNode(this);
    this.Insert(this.m_pStartOfContent, 2);
    this.m_pEndOfContent = new SwEndNode(this, this.m_pStartOfContent);
    this.Insert(this.m_pEndOfContent, 3);
  }

  GetEndOfContent(): SwEndNode { return this.m_pEndOfContent; }
  GetEndOfAutotext(): SwEndNode { return this.m_pEndOfAutotext; }
  /** Index of the first node of the body (after the content section's start node). */
  BodyStart(): number { return this.m_pStartOfContent.GetIndex() + 1; }

  /**
   * The top-level area a node belongs to: its header or footer section, or the body. The cursor
   * moves within one area (SwCursor never leaves a header by arrow keys).
   */
  AreaOf(n: SwNode): SwStartNode {
    return n.FindHeaderStartNode() ?? n.FindFooterStartNode() ?? this.m_pStartOfContent;
  }

  /** The header or footer section of the given type, if the page style has one. */
  FindAreaSection(eTyp: SwStartNodeType): SwStartNode | null {
    for (let i = 1; i < this.m_pEndOfAutotext.GetIndex(); i++) {
      const n = this.node(i);
      if (n.IsStartNode() && (n as SwStartNode).m_eStartNodeType === eTyp) return n as SwStartNode;
    }
    return null;
  }

  /** Creates an empty header or footer section at the end of the autotext area. */
  MakeAreaSection(eTyp: SwStartNodeType, coll: SwTextFormatColl): SwStartNode {
    const at = this.m_pEndOfAutotext.GetIndex();
    const sn = new SwStartNode(this, SwNodeType.Start, eTyp);
    sn.m_pStartOfSection = this.m_pEndOfAutotext.m_pStartOfSection;
    this.Insert(sn, at);
    const tn = new SwTextNode(this, coll);
    tn.m_pStartOfSection = sn;
    this.Insert(tn, at + 1);
    this.Insert(new SwEndNode(this, sn), at + 2);
    return sn;
  }

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
        const pSttNd = new SwStartNode(this, SwNodeType.Start, SwStartNodeType.SwTableBoxStartNode);
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

  /** First and last paragraph of the body. */
  FirstTextNode(): SwTextNode { return this.GoNext(this.m_pStartOfContent.GetIndex())!; }
  LastTextNode(): SwTextNode { return this.GoPrevious(this.m_pEndOfContent.GetIndex())!; }
}
