// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/uibase/utlui/content.cxx reduced
// @upstream sw/source/uibase/inc/swcont.hxx partial
// The Navigator's content (SwContentType and SwContent, and SwContentTree's GotoContent and
// ExecCommand): each type's members with their names and document order, going to one, and
// promoting, demoting and moving headings. The tree view itself is the web shell's.
// Left out: the drag and drop of headings and the global document view; headings in frames,
// headers and footers (outline nodes are the body's, GetOutLineNds); members that are not in the
// model (reference marks, and drawing objects other than shapes in frames); alphabetical sorting;
// expanding fields other than page numbers and counts. Text in frames sorts before the body
// instead of at its anchor.
import { SwDoc } from '../../../inc/doc.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';
import type { SwNode, SwSectionNode, SwTableNode } from '../../../inc/node.ts';
import { MAXLEVEL } from '../../../inc/numrule.ts';
import { RndStdIds } from '../../../inc/frmfmt.ts';
import { CH_TXTATR_BREAKWORD } from '../../../inc/hintids.ts';
import type { SwField } from '../../../inc/hintids.ts';
import { NumberingType } from '../../../../i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';
import type { SwWrtShell } from '../wrtsh/wrtsh.ts';

/** swcont.hxx */
export const ContentTypeId = {
  OUTLINE: 0,
  TABLE: 1,
  FRAME: 2,
  GRAPHIC: 3,
  OLE: 4,
  BOOKMARK: 5,
  REGION: 6,
  URLFIELD: 7,
  REFERENCE: 8,
  INDEX: 9,
  POSTIT: 10,
  DRAWOBJECT: 11,
  TEXTFIELD: 12,
  FOOTNOTE: 13,
  ENDNOTE: 14,
  LAST: 14,
  UNKNOWN: -1,
} as const;
export type ContentTypeId = (typeof ContentTypeId)[keyof typeof ContentTypeId];

/** Every content type, in the Navigator's order. */
export const CONTENT_TYPES: readonly ContentTypeId[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

/**
 * SwContent and its subclasses (SwOutlineContent, SwRegionContent, SwURLFieldContent,
 * SwTextFieldContent, SwTextFootnoteContent, SwPostItContent, SwTOXBaseContent), as one record.
 */
export interface SwContent {
  m_sContentName: string;
  /** The sort key: the position in the document (getYPos). */
  m_nYPosition: number;
  /** The content is hidden (in a hidden section): shown greyed. */
  m_bInvisible: boolean;
  /** Where the content is: its paragraph and position there (null for an object anchored to a page). */
  m_pNode: SwTextNode | null;
  m_nContent: number;
  /** SwOutlineContent: the position in GetOutLineNds, the outline level from 0, and IsOutlineMovable. */
  m_nOutlinePos?: number;
  m_nOutlineLevel?: number;
  m_bIsMoveable?: boolean;
  /** SwRegionContent: how deeply the section is nested. */
  m_nRegionLevel?: number;
  /** SwURLFieldContent: the link's target. */
  m_sURL?: string;
  /** SwTextFootnoteContent, SwPostItContent, SwTOXBaseContent: the footnote, comment or index id. */
  m_sId?: string;
}

/** SwNavigationPI::CleanEntry: line breaks and tabs become spaces. */
export function CleanEntry(rEntry: string): string { return rEntry.replace(/[\n\t]/g, ' '); }
/** SwContentType::RemoveNewline */
export function RemoveNewline(rEntry: string): string { return rEntry.replace(/[\n\r]/g, ' '); }

/** A paragraph's text without the placeholders of fields, objects and anchors. */
const plain = (n: SwTextNode, nStart = 0, nEnd = n.Len()) => n.GetText().slice(nStart, nEnd).split(CH_TXTATR_BREAKWORD).join('');

/** SwField::GetFieldName with SwField::GetDescription ("field") before it, and the expanded value. */
function fieldText(sh: SwWrtShell, f: SwField, n: SwTextNode): string | null {
  const page = () => (sh.m_pRoot.FindLine(n, 0)?.page.nVirtNum ?? 1);
  let sName: string, sExpand = '';
  switch (f.type) {
    case 'PageNumber': sName = 'Page number'; sExpand = String(page()); break;
    // DocumentStatistics: its sub type, Pages.
    case 'PageCount': sName = 'Statistics - Pages'; sExpand = String(sh.GetPageCnt()); break;
    case 'Date': sName = 'Date'; break;
    case 'Time': sName = 'Time'; break;
    case 'Sequence': sName = 'Number range'; break;
    // A form field is a fieldmark, not a field.
    default: return null;
  }
  if (f.fixed !== undefined) { sName += ' (fixed)'; sExpand = f.fixed; }
  return `field - ${sName}${sExpand ? ` - ${sExpand}` : ''}`;
}

/** lcl_MaybeSetInvisible, reduced: content in a hidden section has no frame to show. */
function IsHidden(pNode: SwNode | null): boolean {
  for (let s = pNode?.FindSectionNode() ?? null; s; s = s.StartOfSectionNode()?.FindSectionNode() ?? null) {
    if (s.m_pSection.m_bHidden) return true;
  }
  return false;
}

export class SwContentType {
  readonly m_pWrtShell: SwWrtShell;
  readonly m_nContentType: ContentTypeId;
  /** The outline levels shown (headings up to this level). */
  m_nOutlineLevel: number;
  m_aMember: SwContent[] = [];
  /** The members can be edited, deleted or renamed. */
  m_bEdit = false;
  m_bDelete = true;
  m_bRenamable = false;

  constructor(pShell: SwWrtShell, nType: ContentTypeId, nLevel = MAXLEVEL) {
    this.m_pWrtShell = pShell;
    this.m_nContentType = nType;
    this.m_nOutlineLevel = nLevel;
    switch (nType) {
      case ContentTypeId.TABLE: case ContentTypeId.FRAME: case ContentTypeId.GRAPHIC: case ContentTypeId.OLE:
      case ContentTypeId.REGION: case ContentTypeId.INDEX: case ContentTypeId.DRAWOBJECT:
        this.m_bEdit = true; this.m_bRenamable = true; break;
      case ContentTypeId.BOOKMARK: this.m_bEdit = true; this.m_bRenamable = true; break;
      case ContentTypeId.TEXTFIELD: case ContentTypeId.FOOTNOTE: case ContentTypeId.ENDNOTE:
      case ContentTypeId.URLFIELD: case ContentTypeId.POSTIT:
        this.m_bEdit = true; break;
      case ContentTypeId.REFERENCE: this.m_bEdit = false; break;
      default: break;
    }
    this.FillMemberList();
  }

  GetMemberCount(): number { return this.m_aMember.length; }
  GetMember(nIndex: number): SwContent | undefined { return this.m_aMember[nIndex]; }

  /** getYPos: a text position's place in the document; text in a frame sorts by the frame's anchor. */
  private getYPos(pNode: SwTextNode | null, nContent = 0): number {
    if (!pNode) return 0;
    const doc = this.m_pWrtShell.m_pDoc;
    const nIndex = pNode.GetIndex();
    if (nIndex < doc.GetNodes().BodyStart()) {
      const fly = pNode.FindFlyStartNode();
      if (fly?.m_sFlyId) {
        const loc = doc.GetFlyFormats().find((f) => f.fmt?.m_sContentId === fly.m_sFlyId);
        if (loc?.node) return loc.node.GetIndex() + (loc.nContent ?? 0) / 1e6;
      }
    }
    return nIndex + nContent / 1e6;
  }

  private add(name: string, pNode: SwTextNode | null, nContent: number, extra: Partial<SwContent> = {}, nYPos = this.getYPos(pNode, nContent)): void {
    this.m_aMember.push({ m_sContentName: name, m_nYPosition: nYPos, m_bInvisible: IsHidden(pNode), m_pNode: pNode, m_nContent: nContent, ...extra });
  }

  FillMemberList(): void {
    this.m_aMember = [];
    const sh = this.m_pWrtShell, doc = sh.m_pDoc, nodes = doc.GetNodes();
    switch (this.m_nContentType) {
      case ContentTypeId.OUTLINE: {
        const rOutlineNodes = doc.GetOutLineNds();
        rOutlineNodes.forEach((pNode, i) => {
          // getOutlineText with its number (SwTextNode::GetNumString), without leading spaces.
          const num = sh.m_pRoot.m_aNums.get(pNode);
          const sNum = num?.counted && num.fmt.GetNumberingType() !== NumberingType.CHAR_SPECIAL && num.label ? `${num.label} ` : '';
          const aEntry = CleanEntry(`${sNum}${plain(pNode)}`.replace(/^ +/, ''));
          const nLevel = SwDoc.OutlineLevel(pNode) - 1;
          if (nLevel >= this.m_nOutlineLevel) return;
          // IsOutlineMovable: not in a table.
          this.add(aEntry, pNode, 0, { m_nOutlinePos: i, m_nOutlineLevel: nLevel, m_bIsMoveable: !pNode.FindTableNode() });
        });
        break;
      }
      case ContentTypeId.TABLE: {
        for (let i = 0; i < nodes.Count(); i++) {
          const n = nodes.node(i);
          if (!n.IsTableNode()) continue;
          const first = nodes.GoNext(i);
          this.add((n as SwTableNode).m_pTable.m_aAttrs.name, first, 0);
        }
        break;
      }
      case ContentTypeId.OLE:
      case ContentTypeId.FRAME:
      case ContentTypeId.GRAPHIC:
      case ContentTypeId.DRAWOBJECT: {
        for (const loc of doc.GetFlyFormats()) {
          const fmt = loc.fmt;
          const kind: ContentTypeId = fmt
            ? (fmt.m_pMath ? ContentTypeId.OLE : fmt.m_pShape ? ContentTypeId.DRAWOBJECT : fmt.graphic ? ContentTypeId.GRAPHIC : ContentTypeId.FRAME)
            : (loc.asChar?.math ? ContentTypeId.OLE : loc.asChar?.shape ? ContentTypeId.DRAWOBJECT : ContentTypeId.GRAPHIC);
          if (kind !== this.m_nContentType || !loc.name) continue;
          let nYPos = this.getYPos(loc.node ?? null, loc.nContent ?? 0);
          // A page anchored object: where its page starts.
          if (!loc.node && fmt?.m_aAnchor.m_eAnchorId === RndStdIds.FLY_AT_PAGE) {
            const page = sh.m_pRoot.pages[Math.max(0, fmt.m_aAnchor.m_nPageNumber - 1)];
            nYPos = page?.frames[0] ? this.getYPos(page.frames[0].node) : 0;
          }
          this.add(loc.name, loc.node ?? null, loc.nContent ?? 0, {}, nYPos);
        }
        break;
      }
      case ContentTypeId.BOOKMARK: {
        let nYPos = 0;
        for (const pBookmark of sh.getIDocumentMarkAccess().getBookmarks()) {
          const rPosition = pBookmark.GetMarkStart();
          this.add(pBookmark.GetName(), rPosition.GetNode(), rPosition.GetContentIndex(), {}, nYPos++);
        }
        break;
      }
      case ContentTypeId.TEXTFIELD: {
        for (const n of doc.allText()) {
          // fields in header footer don't behave well, skip them
          if (n.FindHeaderStartNode() || n.FindFooterStartNode()) continue;
          for (const h of n.m_aHints) {
            const f = h.aAttrs.RES_TXTATR_FIELD;
            if (!f) continue;
            const sText = fieldText(sh, f, n);
            if (sText) this.add(sText, n, h.nStart);
          }
        }
        break;
      }
      // We will separate footnotes and endnotes here.
      case ContentTypeId.FOOTNOTE:
      case ContentTypeId.ENDNOTE: {
        let nPos = 0;
        for (const n of doc.allText()) {
          for (const h of n.m_aHints) {
            const ftn = h.aAttrs.RES_TXTATR_FTN;
            if (!ftn || !!ftn.endnote !== (this.m_nContentType === ContentTypeId.ENDNOTE)) continue;
            // lcl_GetFootnoteText: the footnote's first paragraph.
            const sec = nodes.FindFootnoteSection(ftn.id);
            const first = sec ? nodes.GoNext(sec.GetIndex()) : null;
            const sText = `${sh.m_pRoot.m_aFootnoteNums.get(ftn.id) ?? ''} ${first ? plain(first) : ''}`;
            this.add(sText, n, h.nStart, { m_sId: ftn.id }, ++nPos);
          }
        }
        this.m_aMember.sort((a, b) => this.getYPos(a.m_pNode, a.m_nContent) - this.getYPos(b.m_pNode, b.m_nContent));
        this.m_aMember.forEach((m, i) => { m.m_nYPosition = i + 1; });
        break;
      }
      case ContentTypeId.REGION: {
        for (let i = 0; i < nodes.Count(); i++) {
          const n = nodes.node(i);
          if (!n.IsSectionNode()) continue;
          let nLevel = 0;
          for (let p = n.StartOfSectionNode()?.FindSectionNode() ?? null; p; p = p.StartOfSectionNode()?.FindSectionNode() ?? null) nLevel++;
          const first = nodes.GoNext(i);
          this.add((n as SwSectionNode).m_pSection.m_sSectionName, first, 0, { m_nRegionLevel: nLevel });
        }
        break;
      }
      case ContentTypeId.URLFIELD: {
        for (const n of doc.allText()) {
          // tdf#52113, tdf#148312 Don't include table of contents hyperlinks
          if (n.m_aSet.RES_PARATR_TOX_ID) continue;
          // One SwTextINetFormat may be several hints here: the runs of one link are joined.
          const hints = n.m_aHints.filter((h) => h.aAttrs.RES_TXTATR_INETFMT).sort((a, b) => a.nStart - b.nStart);
          for (let k = 0; k < hints.length; k++) {
            const h = hints[k]!;
            let nEnd = h.nEnd;
            while (hints[k + 1] && hints[k + 1]!.nStart === nEnd && hints[k + 1]!.aAttrs.RES_TXTATR_INETFMT === h.aAttrs.RES_TXTATR_INETFMT) nEnd = hints[++k]!.nEnd;
            const sText = plain(n, h.nStart, nEnd).replaceAll('\n', '').trim();
            if (sText) this.add(sText, n, h.nStart, { m_sURL: h.aAttrs.RES_TXTATR_INETFMT! });
          }
        }
        break;
      }
      case ContentTypeId.REFERENCE:
        // Reference marks are not in the model.
        break;
      case ContentTypeId.INDEX: {
        const seen = new Set<string>();
        let nTox = 0;
        for (const n of doc.allText()) {
          const id = n.m_aSet.RES_PARATR_TOX_ID;
          if (!id || seen.has(id)) continue;
          seen.add(id);
          this.add(id, n, 0, { m_sId: id }, nTox++);
        }
        break;
      }
      case ContentTypeId.POSTIT: {
        let nYPos = 0;
        for (const n of doc.allText()) {
          for (const h of n.m_aHints) {
            const f = h.aAttrs.RES_TXTATR_ANNOTATION;
            if (f) this.add(RemoveNewline(f.text), n, h.nStart, { m_sId: f.id }, nYPos++);
          }
        }
        break;
      }
      default: break;
    }
    // SwContentArr is sorted by position; equal positions keep their order.
    this.m_aMember.sort((a, b) => a.m_nYPosition - b.m_nYPosition);
  }
}

/** SwContentTree::GotoContent: the cursor to the content, or the object selected. */
export function GotoContent(sh: SwWrtShell, pCnt: SwContent, nType: ContentTypeId): boolean {
  switch (nType) {
    case ContentTypeId.OUTLINE: return sh.GotoOutline(pCnt.m_nOutlinePos!);
    case ContentTypeId.TABLE: return sh.GotoTable(pCnt.m_sContentName);
    case ContentTypeId.FRAME:
    case ContentTypeId.GRAPHIC:
    case ContentTypeId.OLE:
    case ContentTypeId.DRAWOBJECT:
      return sh.GotoFly(pCnt.m_sContentName);
    case ContentTypeId.BOOKMARK: {
      const pMark = sh.getIDocumentMarkAccess().findMark(pCnt.m_sContentName);
      return !!pMark && sh.GotoMark(pMark);
    }
    case ContentTypeId.REGION: return sh.GotoRegion(pCnt.m_sContentName);
    case ContentTypeId.INDEX: return sh.GotoTOXBase(pCnt.m_sId!);
    case ContentTypeId.FOOTNOTE:
    case ContentTypeId.ENDNOTE:
      return sh.GotoFootnoteAnchor(pCnt.m_sId!);
    // GotoINetAttr (then one character right), GotoFormatField
    case ContentTypeId.URLFIELD:
    case ContentTypeId.TEXTFIELD:
    case ContentTypeId.POSTIT:
      return !!pCnt.m_pNode && sh.GotoTextPos(pCnt.m_pNode, pCnt.m_nContent + (nType === ContentTypeId.URLFIELD ? 1 : 0));
    default: return false;
  }
}

/**
 * SwView::MoveNavigationHdl, reduced: to the next (or previous) member of a type after (or before)
 * the cursor, from the start (or end) again when there is none. `wrapped` says it started again.
 */
export function MoveNavigation(sh: SwWrtShell, nType: ContentTypeId, bNext: boolean): { ok: boolean; wrapped: boolean } {
  const members = new SwContentType(sh, nType).m_aMember.filter((m) => !m.m_bInvisible && (m.m_pNode || nType === ContentTypeId.FRAME || nType === ContentTypeId.GRAPHIC || nType === ContentTypeId.OLE || nType === ContentTypeId.DRAWOBJECT));
  if (!members.length) return { ok: false, wrapped: false };
  const cur = sh.m_pCursor.GetPoint();
  const here = cur.GetNodeIndex() + cur.GetContentIndex() / 1e6;
  const pos = (m: SwContent) => (m.m_pNode ? m.m_pNode.GetIndex() + m.m_nContent / 1e6 : m.m_nYPosition);
  const selFly = sh.m_sSelFly;
  // A selected object counts as being at its anchor: the next one is after it.
  const at = selFly ? members.find((m) => m.m_sContentName === selFly) : undefined;
  const ref = at ? pos(at) : here;
  const sorted = [...members].sort((a, b) => pos(a) - pos(b));
  let target = bNext ? sorted.find((m) => pos(m) > ref && m !== at) : [...sorted].reverse().find((m) => pos(m) < ref && m !== at);
  let wrapped = false;
  if (!target) { target = bNext ? sorted[0] : sorted[sorted.length - 1]; wrapped = true; }
  return { ok: !!target && GotoContent(sh, target, nType), wrapped };
}

/**
 * SwContentTree::ExecCommand for one heading: "promote" and "demote" change its outline level
 * (with its sub-headings when bOutlineWithChildren), "chapterup" and "chapterdown" move it with
 * its text (and sub-chapters) before the previous or after the next heading of its level. One
 * undo step; the cursor stays where it was. False when nothing changed.
 */
export function ExecCommand(sh: SwWrtShell, rCmd: string, nActPos: number, bOutlineWithChildren = true): boolean {
  const bUp = rCmd === 'chapterup';
  const bUpDown = bUp || rCmd === 'chapterdown';
  const bLeft = rCmd === 'promote';
  const bLeftRight = bLeft || rCmd === 'demote';
  if (!bUpDown && !bLeftRight) return false;
  const doc = sh.m_pDoc, nodes = doc.GetNodes();
  const rOutlineNodes = doc.GetOutLineNds();
  const nOutlineNdsSize = rOutlineNodes.length;
  const pAct = rOutlineNodes[nActPos];
  if (!pAct) return false;
  const level = (i: number) => SwDoc.OutlineLevel(rOutlineNodes[i]!);
  const nActPosOutlineLevel = level(nActPos);
  // outline nodes in tables are not up/down moveable
  if (bUpDown && pAct.FindTableNode()) return false;

  const saved = sh.SaveCursor();
  const nUndo = sh.StartUndo();
  let bChanged = false;
  if (bUpDown) {
    // move outline position up/down (outline position promote/demote)
    let nDir = bUp ? -1 : 1;
    if ((nDir === -1 && nActPos > 0) || (nDir === 1 && nActPos < nOutlineNdsSize - 1)) {
      let nPos = nActPos;
      if (!bUp) {
        // move down
        let nPosOutlineLevel = -1;
        while (++nPos < nOutlineNdsSize) {
          nPosOutlineLevel = level(nPos);
          // discontinue if moving out of parent or equal level is found
          if (nPosOutlineLevel <= nActPosOutlineLevel) break;
          // count the children of the node when they are not included in the move
          if (!bOutlineWithChildren) nDir++;
        }
        if (nPosOutlineLevel >= nActPosOutlineLevel) {
          // move past children
          while (++nPos < nOutlineNdsSize) {
            nPosOutlineLevel = level(nPos);
            // discontinue if moving out of parent or equal level is found
            if (nPosOutlineLevel <= nActPosOutlineLevel) break;
            nDir++;
          }
        }
      } else {
        // move up
        while (nPos && --nPos >= 0) {
          const nPosOutlineLevel = level(nPos);
          // discontinue if equal level is found
          if (nPosOutlineLevel === nActPosOutlineLevel) break;
          // discontinue if moving out of parent
          if (nPosOutlineLevel < nActPosOutlineLevel) {
            if (nDir < -1) nDir++;
            break;
          }
          nDir--;
        }
      }
      bChanged = MoveOutlinePara(sh, nActPos, bOutlineWithChildren, nDir);
    }
  } else {
    // move outline left/right (outline level promote/demote)
    let bAllow = true;
    if (!bLeft) {
      // disallow if any outline node to demote will exceed MAXLEVEL
      let nPos = nActPos;
      do {
        if (level(nPos) === MAXLEVEL) { bAllow = false; break; }
      } while (bOutlineWithChildren && ++nPos < nOutlineNdsSize && level(nPos) > nActPosOutlineLevel);
    } else if (nActPosOutlineLevel === 1) {
      // disallow if trying to promote outline of level 1
      bAllow = false;
    }
    if (bAllow) {
      let nPos = nActPos;
      const targets: SwTextNode[] = [];
      do targets.push(rOutlineNodes[nPos]!);
      while (bOutlineWithChildren && ++nPos < nOutlineNdsSize && level(nPos) > nActPosOutlineLevel);
      for (const n of targets) {
        sh.GotoTextPos(n, 0);
        if (doc.OutlineUpDown(sh.m_pCursor, bLeft ? -1 : 1)) bChanged = true;
      }
    }
  }
  sh.EndUndo(nUndo);
  // Cursor is now back at the current heading.
  sh.RestoreCursor(saved);
  if (bChanged) doc.Changed();
  return bChanged;
}

/**
 * SwEditShell::MakeOutlineSel and SwDoc::MoveOutlinePara, reduced: the chapter of the heading at
 * nActPos (its paragraphs up to the next heading, or with bWithChildren up to the next one of its
 * level or higher) moved before the heading nOffset headings away; down, before the one nOffset
 * after the chapter's end, or to the body's end. Sections around the range are not adjusted: a
 * move across a section boundary fails.
 */
function MoveOutlinePara(sh: SwWrtShell, nActPos: number, bWithChildren: boolean, nOffset: number): boolean {
  const doc = sh.m_pDoc, nodes = doc.GetNodes();
  const rOutlineNodes = doc.GetOutLineNds();
  const nLevel = SwDoc.OutlineLevel(rOutlineNodes[nActPos]!);
  let nTmpPos = nActPos + 1;
  if (bWithChildren) while (nTmpPos < rOutlineNodes.length && SwDoc.OutlineLevel(rOutlineNodes[nTmpPos]!) > nLevel) nTmpPos++;
  const nEndOfContent = nodes.GetEndOfContent().GetIndex();
  const at = (i: number) => (i < rOutlineNodes.length ? rOutlineNodes[i]!.GetIndex() : nEndOfContent);
  const nStt = rOutlineNodes[nActPos]!.GetIndex();
  const nEnd = at(nTmpPos) - 1;
  const pam = sh.m_pCursor;
  // The chapter already where it would go: nothing to move.
  const nNodeOffset = nOffset < 0 ? at(nActPos + nOffset) - nStt : at(nTmpPos + nOffset) - 1 - nEnd;
  return nNodeOffset !== 0 && doc.MoveParagraphImpl(pam, nNodeOffset, nStt, nEnd);
}
