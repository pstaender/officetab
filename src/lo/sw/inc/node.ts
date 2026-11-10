// SPDX-License-Identifier: MPL-2.0
// @upstream sw/inc/node.hxx partial
// @upstream sw/source/core/docnode/node.cxx partial
import { BigPtrEntry } from './bparr.ts';
import { SwNodeType, SwStartNodeType } from './ndtyp.ts';
import type { SwNodes } from './ndarr.ts';
import type { SwTextNode } from './ndtxt.ts';
import type { SwTable } from './swtable.ts';
import type { SwFormatCol } from './fmtclds.ts';

export class SwNode extends BigPtrEntry {
  m_nNodeType: SwNodeType;
  m_pNodes: SwNodes;
  /** Nearest enclosing start node; a start node's outer section is reached via its own m_pStartOfSection. */
  m_pStartOfSection: SwStartNode | null = null;

  constructor(nodes: SwNodes, type: SwNodeType) {
    super();
    this.m_pNodes = nodes;
    this.m_nNodeType = type;
  }

  GetIndex(): number { return this.GetPos(); }
  GetNodeType(): SwNodeType { return this.m_nNodeType; }
  GetNodes(): SwNodes { return this.m_pNodes; }
  IsStartNode(): boolean { return (this.m_nNodeType & SwNodeType.Start) !== 0; }
  IsEndNode(): boolean { return this.m_nNodeType === SwNodeType.End; }
  IsContentNode(): boolean { return (this.m_nNodeType & SwNodeType.ContentMask) !== 0; }
  IsTextNode(): this is SwTextNode { return this.m_nNodeType === SwNodeType.Text; }
  IsTableNode(): boolean { return this.m_nNodeType === SwNodeType.Table; }
  IsSectionNode(): boolean { return this.m_nNodeType === SwNodeType.Section; }
  GetTextNode(): SwTextNode | null { return this.IsTextNode() ? this : null; }
  StartOfSectionNode(): SwStartNode | null { return this.m_pStartOfSection; }

  GetTableNode(): SwTableNode | null { return this.IsTableNode() ? (this as unknown as SwTableNode) : null; }
  GetSectionNode(): SwSectionNode | null { return this.IsSectionNode() ? (this as unknown as SwSectionNode) : null; }

  /** Innermost section node enclosing this node (SwNode::FindSectionNode), or null. */
  FindSectionNode(): SwSectionNode | null {
    for (let n: SwStartNode | null = this.m_pStartOfSection; n; n = n.m_pStartOfSection) if (n.IsSectionNode()) return n as SwSectionNode;
    return null;
  }

  /** Innermost table node enclosing this node, or null. */
  FindTableNode(): SwTableNode | null {
    for (let n: SwStartNode | null = this.IsTableNode() ? (this as unknown as SwStartNode) : this.m_pStartOfSection; n; n = n.m_pStartOfSection) {
      if (n.IsTableNode()) return n as SwTableNode;
    }
    return null;
  }

  /** SwNode::FindStartNodeByType: the nearest enclosing start node of a type. */
  FindStartNodeByType(eTyp: SwStartNodeType): SwStartNode | null {
    for (let n: SwStartNode | null = this.IsStartNode() ? (this as unknown as SwStartNode) : this.m_pStartOfSection; n; n = n.m_pStartOfSection) {
      if (n.m_eStartNodeType === eTyp) return n;
    }
    return null;
  }
  FindHeaderStartNode(): SwStartNode | null { return this.FindStartNodeByType(SwStartNodeType.SwHeaderStartNode); }
  FindFooterStartNode(): SwStartNode | null { return this.FindStartNodeByType(SwStartNodeType.SwFooterStartNode); }
  FindFootnoteStartNode(): SwStartNode | null { return this.FindStartNodeByType(SwStartNodeType.SwFootnoteStartNode); }
  FindFlyStartNode(): SwStartNode | null { return this.FindStartNodeByType(SwStartNodeType.SwFlyStartNode); }

  /** The start node of the table box containing this node, or null (SwNode::FindTableBoxStartNode). */
  FindTableBoxStartNode(): SwStartNode | null {
    for (let n: SwStartNode | null = this.m_pStartOfSection; n; n = n.m_pStartOfSection) {
      if (n.m_pStartOfSection?.IsTableNode()) return n;
    }
    return null;
  }
}

export type SwAreaKind = 'default' | 'first' | 'left';

export class SwStartNode extends SwNode {
  m_pEndOfSection: SwEndNode | null = null;
  m_eStartNodeType: SwStartNodeType;
  /** On footnote sections: the id that the anchor's SwFormatFootnote refers to. */
  m_sFootnoteId = '';
  /** On header and footer sections: which pages use it (SwPageDesc's master, first or left format). */
  m_eAreaKind: SwAreaKind = 'default';
  /** On header and footer sections: the page style they belong to. */
  m_sPageDesc = 'Default Page Style';
  /** On text frame sections: the name of the SwFlyFrameFormat whose content this is. */
  m_sFlyId = '';
  constructor(nodes: SwNodes, type: SwNodeType = SwNodeType.Start, eSttNd: SwStartNodeType = SwStartNodeType.SwNormalStartNode) {
    super(nodes, type);
    this.m_eStartNodeType = eSttNd;
  }
  EndOfSectionNode(): SwEndNode { return this.m_pEndOfSection!; }
  GetStartNodeType(): SwStartNodeType { return this.m_eStartNodeType; }
}

export class SwEndNode extends SwNode {
  constructor(nodes: SwNodes, start: SwStartNode) {
    super(nodes, SwNodeType.End);
    this.m_pStartOfSection = start;
    start.m_pEndOfSection = this;
  }
}

export class SwContentNode extends SwNode {}

export class SwTableNode extends SwStartNode {
  m_pTable: SwTable;
  constructor(nodes: SwNodes, table: SwTable) {
    super(nodes, SwNodeType.Table);
    this.m_pTable = table;
  }
  GetTable(): SwTable { return this.m_pTable; }
}

/**
 * SwSectionData with its SwSectionFormat's columns, reduced: content sections only (no links, no
 * hide conditions, no passwords).
 */
export interface SwSectionData {
  m_sSectionName: string;
  m_bHidden: boolean;
  m_bProtectFlag: boolean;
  m_aCol: SwFormatCol | null;
  /** The section format's background colour (RES_BACKGROUND). */
  m_aBackground?: string | null;
}

export class SwSectionNode extends SwStartNode {
  m_pSection: SwSectionData;
  constructor(nodes: SwNodes, data: SwSectionData) {
    super(nodes, SwNodeType.Section);
    this.m_pSection = data;
  }
  GetSection(): SwSectionData { return this.m_pSection; }
}
