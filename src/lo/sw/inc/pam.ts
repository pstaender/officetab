// SPDX-License-Identifier: MPL-2.0
// @upstream sw/inc/pam.hxx reduced
// @upstream sw/source/core/crsr/pam.cxx reduced
// @upstream sw/inc/contentindex.hxx reduced
import type { SwNode } from './node.ts';
import type { SwTextNode } from './ndtxt.ts';

/** A position registers with its text node so edits keep it valid, like SwContentIndex. */
export class SwPosition {
  m_pNode: SwTextNode;
  m_nContent: number;

  constructor(node: SwTextNode, content = 0) {
    this.m_pNode = node;
    this.m_nContent = content;
    node.m_aIndices.add(this);
  }

  GetNode(): SwTextNode { return this.m_pNode; }
  GetNodeIndex(): number { return this.m_pNode.GetIndex(); }
  GetContentIndex(): number { return this.m_nContent; }

  Assign(node: SwTextNode, content: number): void {
    if (node !== this.m_pNode) {
      this.m_pNode.m_aIndices.delete(this);
      node.m_aIndices.add(this);
      this.m_pNode = node;
    }
    this.m_nContent = content;
  }

  /** Must be called for temporary positions: the node's index registry holds them strongly. */
  Release(): void { this.m_pNode.m_aIndices.delete(this); }

  compare(o: SwPosition): number {
    return this.GetNodeIndex() - o.GetNodeIndex() || this.m_nContent - o.m_nContent;
  }
}

export class SwPaM {
  m_Bound1: SwPosition;
  m_Bound2: SwPosition;

  constructor(point: SwPosition, mark?: SwPosition) {
    this.m_Bound1 = point;
    this.m_Bound2 = mark ?? new SwPosition(point.GetNode(), point.GetContentIndex());
  }

  GetPoint(): SwPosition { return this.m_Bound1; }
  GetMark(): SwPosition { return this.m_Bound2; }
  HasMark(): boolean { return this.m_Bound1.compare(this.m_Bound2) !== 0; }
  DeleteMark(): void { this.m_Bound2.Assign(this.m_Bound1.GetNode(), this.m_Bound1.GetContentIndex()); }
  Start(): SwPosition { return this.m_Bound1.compare(this.m_Bound2) <= 0 ? this.m_Bound1 : this.m_Bound2; }
  End(): SwPosition { return this.m_Bound1.compare(this.m_Bound2) <= 0 ? this.m_Bound2 : this.m_Bound1; }
  Release(): void { this.m_Bound1.Release(); this.m_Bound2.Release(); }
}

export type { SwNode };
