// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/core/doc/docbm.cxx reduced
// @upstream sw/inc/IDocumentMarkAccess.hxx partial
// @upstream sw/source/core/crsr/bookmark.cxx reduced
// @upstream sw/source/core/crsr/crossrefbookmark.cxx reduced
// Bookmarks (sw::mark::Bookmark) and the cross-reference bookmarks of headings, kept by the
// MarkManager. Their positions are SwPositions registered with their text nodes, so they follow
// edits; undo snapshots them by node index (Snapshot/Restore) instead of SwUndoDeleteBookmark and
// friends. Not ported: fieldmarks, annotation, DDE, UNO and navigator marks, the key codes, hidden
// bookmarks and their conditions, and deleting the marks of a deleted range (DelBookmarks): those
// move to where the deleted text was.
import type { SwTextNode } from '../../../inc/ndtxt.ts';
import { SwPosition, type SwPaM } from '../../../inc/pam.ts';

/** IDocumentMarkAccess::MarkType, of the marks ported. */
export const MarkType = {
  BOOKMARK: 'BOOKMARK',
  CROSSREF_HEADING_BOOKMARK: 'CROSSREF_HEADING_BOOKMARK',
} as const;
export type MarkType = (typeof MarkType)[keyof typeof MarkType];

/** IDocumentMarkAccess::GetCrossRefHeadingBookmarkNamePrefix */
export function GetCrossRefHeadingBookmarkNamePrefix(): string { return '__RefHeading__'; }

let sUniquePostfix = '';
let nCount = Number.MAX_SAFE_INTEGER;

/** sw::mark::MarkBase */
export class MarkBase {
  m_oPos1: SwPosition;
  m_oPos2: SwPosition | null = null;
  m_aName: string;
  m_eType: MarkType;

  constructor(rPaM: SwPaM | { GetPoint(): SwPosition; GetMark(): SwPosition; HasMark(): boolean }, rName: string, eType: MarkType) {
    this.m_oPos1 = new SwPosition(rPaM.GetPoint().GetNode(), rPaM.GetPoint().GetContentIndex());
    this.m_aName = rName;
    this.m_eType = eType;
    if (rPaM.HasMark()) this.m_oPos2 = new SwPosition(rPaM.GetMark().GetNode(), rPaM.GetMark().GetContentIndex());
  }

  GetName(): string { return this.m_aName; }
  SetName(rName: string): void { this.m_aName = rName; }
  GetMarkPos(): SwPosition { return this.m_oPos1; }
  GetOtherMarkPos(): SwPosition { return this.m_oPos2!; }
  IsExpanded(): boolean { return this.m_oPos2 !== null; }
  GetMarkStart(): SwPosition { return !this.IsExpanded() || this.m_oPos1.compare(this.m_oPos2!) <= 0 ? this.m_oPos1 : this.m_oPos2!; }
  GetMarkEnd(): SwPosition { return !this.IsExpanded() || this.m_oPos1.compare(this.m_oPos2!) >= 0 ? this.m_oPos1 : this.m_oPos2!; }

  SetMarkPos(rNewPos: SwPosition): void { this.m_oPos1.Assign(rNewPos.GetNode(), rNewPos.GetContentIndex()); }
  SetOtherMarkPos(rNewPos: SwPosition): void {
    if (this.m_oPos2) this.m_oPos2.Assign(rNewPos.GetNode(), rNewPos.GetContentIndex());
    else this.m_oPos2 = new SwPosition(rNewPos.GetNode(), rNewPos.GetContentIndex());
  }
  ClearOtherMarkPos(): void { this.m_oPos2?.Release(); this.m_oPos2 = null; }

  /** The mark's start before its end (MarkManager::makeMark swaps them). */
  Swap(): void { if (this.m_oPos2) [this.m_oPos1, this.m_oPos2] = [this.m_oPos2, this.m_oPos1]; }

  /** Unregisters the positions from their nodes (the mark's destructor). */
  Release(): void { this.m_oPos1.Release(); this.m_oPos2?.Release(); }

  /** MarkBase::GenerateNewName: the prefix, a counter and a random part. */
  static GenerateNewName(rPrefix: string): string {
    if (nCount === Number.MAX_SAFE_INTEGER) {
      sUniquePostfix = `_${Math.floor(Math.random() * 0xffffffff)}`;
      nCount = 0;
    }
    return `${rPrefix}${nCount++}${sUniquePostfix}`;
  }
}

/** A mark's place by node index, as undo keeps it. */
export interface MarkSnap { name: string; type: MarkType; p1: [number, number]; p2: [number, number] | null }

/** sw::mark::MarkManager */
export class MarkManager {
  m_vAllMarks: MarkBase[] = [];
  private m_aMarkBasenameMapUniqueOffset = new Map<string, number>();

  /** MarkManager::makeMark: a cross-reference heading bookmark is collapsed at its paragraph's start. */
  makeMark(rPaM: SwPaM | { GetPoint(): SwPosition; GetMark(): SwPosition; HasMark(): boolean }, rName: string, eType: MarkType = MarkType.BOOKMARK): MarkBase {
    let pMark: MarkBase;
    if (eType === MarkType.CROSSREF_HEADING_BOOKMARK) {
      // CrossRefBookmark: only the start, at the paragraph's start.
      const start = rPaM.HasMark() && rPaM.GetMark().compare(rPaM.GetPoint()) < 0 ? rPaM.GetMark() : rPaM.GetPoint();
      pMark = new MarkBase({ GetPoint: () => start, GetMark: () => start, HasMark: () => false }, rName, eType);
      if (!rName) pMark.m_aName = MarkBase.GenerateNewName(`${GetCrossRefHeadingBookmarkNamePrefix()}_Toc`);
    } else {
      const expanded = rPaM.HasMark() && rPaM.GetMark().compare(rPaM.GetPoint()) !== 0;
      pMark = new MarkBase({ GetPoint: () => rPaM.GetPoint(), GetMark: () => rPaM.GetMark(), HasMark: () => expanded }, rName, eType);
    }
    if (pMark.GetMarkPos() !== pMark.GetMarkStart()) pMark.Swap();
    pMark.SetName(this.getUniqueMarkName(pMark.GetName(), (n) => !this.findMark(n)));
    this.m_vAllMarks.push(pMark);
    this.sortMarks();
    return pMark;
  }

  /** MarkManager::getMarkForTextNode: the paragraph's mark of that type, made on first use. */
  getMarkForTextNode(rTextNode: SwTextNode, eType: MarkType): MarkBase {
    const existing = this.m_vAllMarks.find((m) => m.m_eType === eType && m.GetMarkStart().GetNode() === rTextNode && m.GetMarkStart().GetContentIndex() === 0);
    if (existing) return existing;
    const aPos = new SwPosition(rTextNode, 0);
    const pMark = this.makeMark({ GetPoint: () => aPos, GetMark: () => aPos, HasMark: () => false }, '', eType);
    aPos.Release();
    return pMark;
  }

  /** MarkManager::renameMark */
  renameMark(io_pMark: MarkBase, rNewName: string): boolean {
    if (io_pMark.GetName() === rNewName) return true;
    if (this.findMark(rNewName)) return false;
    io_pMark.SetName(rNewName);
    return true;
  }

  /** MarkManager::repositionMark */
  repositionMark(io_pMark: MarkBase, rPaM: SwPaM): void {
    io_pMark.SetMarkPos(rPaM.GetPoint());
    if (rPaM.HasMark()) io_pMark.SetOtherMarkPos(rPaM.GetMark());
    else io_pMark.ClearOtherMarkPos();
    if (io_pMark.GetMarkPos() !== io_pMark.GetMarkStart()) io_pMark.Swap();
    this.sortMarks();
  }

  /** MarkManager::deleteMark */
  deleteMark(pMark: MarkBase): void {
    const i = this.m_vAllMarks.indexOf(pMark);
    if (i < 0) return;
    this.m_vAllMarks.splice(i, 1);
    pMark.Release();
  }

  /** MarkManager::clearAllMarks */
  clearAllMarks(): void {
    for (const m of this.m_vAllMarks) m.Release();
    this.m_vAllMarks = [];
  }

  findMark(rName: string): MarkBase | undefined { return this.m_vAllMarks.find((m) => m.GetName() === rName); }
  getAllMarksCount(): number { return this.m_vAllMarks.length; }
  /** The bookmarks the user sees and edits (the Bookmark dialog and the Navigator list these). */
  getBookmarks(): MarkBase[] { return this.m_vAllMarks.filter((m) => m.m_eType === MarkType.BOOKMARK); }
  getBookmarksCount(): number { return this.getBookmarks().length; }
  findBookmark(rName: string): MarkBase | undefined { return this.getBookmarks().find((m) => m.GetName() === rName); }

  /** The marks starting or ending in a text node, in order (the export filters write them there). */
  getMarksIn(node: SwTextNode): MarkBase[] {
    return this.m_vAllMarks.filter((m) => m.GetMarkStart().GetNode() === node || m.GetMarkEnd().GetNode() === node);
  }

  /**
   * getMarksIn for every text node at once, in one pass (as upstream's sorted mark array finds a
   * paragraph's marks without looking at the others): for filters writing a whole document.
   */
  getMarksByNode(): Map<SwTextNode, MarkBase[]> {
    const out = new Map<SwTextNode, MarkBase[]>();
    for (const m of this.m_vAllMarks) {
      const a = m.GetMarkStart().GetNode(), b = m.GetMarkEnd().GetNode();
      for (const n of a === b ? [a] : [a, b]) {
        const list = out.get(n);
        if (list) list.push(m); else out.set(n, [m]);
      }
    }
    return out;
  }

  /** MarkManager::getUniqueMarkName: the name, else "<name> Copy N" (STR_MARK_COPY). */
  getUniqueMarkName(rName: string, f: (n: string) => boolean): string {
    if (f(rName)) return rName;
    let nCnt = this.m_aMarkBasenameMapUniqueOffset.get(rName) ?? 1;
    let sTmp = '';
    for (;;) {
      sTmp = `${rName} Copy ${nCnt}`;
      nCnt++;
      if (f(sTmp)) break;
    }
    this.m_aMarkBasenameMapUniqueOffset.set(rName, nCnt);
    return sTmp;
  }

  /** MarkManager::sortMarks: by start. */
  sortMarks(): void { this.m_vAllMarks.sort((a, b) => a.GetMarkStart().compare(b.GetMarkStart())); }

  Snapshot(): MarkSnap[] {
    const at = (p: SwPosition): [number, number] => [p.GetNodeIndex(), p.GetContentIndex()];
    return this.m_vAllMarks.map((m) => ({ name: m.GetName(), type: m.m_eType, p1: at(m.m_oPos1), p2: m.m_oPos2 ? at(m.m_oPos2) : null }));
  }

  /** Replaces the marks with those of a snapshot; `nodeAt` resolves a node index to its text node. */
  Restore(s: MarkSnap[], nodeAt: (i: number) => SwTextNode | null): void {
    this.clearAllMarks();
    for (const m of s) {
      const n1 = nodeAt(m.p1[0]);
      if (!n1) continue;
      const p1 = new SwPosition(n1, Math.min(m.p1[1], n1.Len()));
      const n2 = m.p2 ? nodeAt(m.p2[0]) : null;
      const p2 = n2 ? new SwPosition(n2, Math.min(m.p2![1], n2.Len())) : null;
      const mark = new MarkBase({ GetPoint: () => p1, GetMark: () => p2 ?? p1, HasMark: () => !!p2 }, m.name, m.type);
      p1.Release(); p2?.Release();
      this.m_vAllMarks.push(mark);
    }
  }
}
