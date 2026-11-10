// SPDX-License-Identifier: MPL-2.0
// @upstream sw/inc/ndarr.hxx reduced
// @upstream sw/source/core/docnode/nodes.cxx reduced
// Upstream's auxiliary sections (footnotes, autotext, redlines) are not created yet: only the content section.
import { BigPtrArray } from './bparr.ts';
import { SwEndNode, SwNode, SwStartNode } from './node.ts';
import { SwTextNode } from './ndtxt.ts';
import type { SwTextFormatColl } from './format.ts';

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
