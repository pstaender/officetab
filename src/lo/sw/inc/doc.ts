// SPDX-License-Identifier: MPL-2.0
// @upstream sw/inc/doc.hxx reduced
// @upstream sw/source/core/doc/poolfmt.cxx reduced
// @upstream sw/source/core/doc/DocumentContentOperationsManager.cxx reduced
// @upstream sw/source/core/undo/docundo.cxx reduced
// @upstream sw/inc/undobj.hxx reduced
// Undo snapshots the touched paragraph range instead of using upstream's per-operation SwUndo classes.
import { SwNodes } from './ndarr.ts';
import { SwTextFormatColl, SwCharFormat } from './format.ts';
import { SwPageDesc } from './pagedesc.ts';
import { SwPaM, SwPosition } from './pam.ts';
import type { SwAttrSet, SwCharAttrSet } from './hintids.ts';
import type { SwTextAttr, SwTextNode } from './ndtxt.ts';

interface ParaSnap { text: string; hints: SwTextAttr[]; coll: SwTextFormatColl; set: SwAttrSet }
interface CursorSnap { node: number; content: number; markNode: number; markContent: number }

export interface SwUndo {
  kind: string;
  first: number;
  before: ParaSnap[];
  after: ParaSnap[];
  cursorBefore: CursorSnap;
  cursorAfter: CursorSnap;
}

const snap = (n: SwTextNode): ParaSnap => ({
  text: n.m_Text,
  hints: n.m_aHints.map((h) => ({ ...h, aAttrs: { ...h.aAttrs } })),
  coll: n.m_pColl,
  set: structuredClone(n.m_aSet),
});

export class SwDoc {
  m_aNodes = new SwNodes();
  m_aPageDesc = new SwPageDesc();
  m_aTextFormatColls = new Map<string, SwTextFormatColl>();
  m_aCharFormats = new Map<string, SwCharFormat>();
  m_aUndo: SwUndo[] = [];
  m_aRedo: SwUndo[] = [];
  private m_aListeners = new Set<() => void>();
  /** Undo depth at the last save, for the modified flag; -1 once that state is unreachable. */
  private m_nSavedDepth = 0;

  constructor() {
    const standard = this.MakeColl('Standard', null);
    const body = this.MakeColl('Text Body', standard, { RES_UL_SPACE: { upper: 0, lower: 140 } });
    const heading = this.MakeColl('Heading', standard, {
      RES_CHRATR_FONT: 'Liberation Sans', RES_CHRATR_FONTSIZE: 280, RES_UL_SPACE: { upper: 240, lower: 120 }, RES_KEEP: true,
    });
    heading.m_pNextTextFormatColl = body;
    const sizes: [number, number, boolean][] = [[1, 360, true], [2, 320, true], [3, 280, true], [4, 240, true], [5, 220, true], [6, 200, true]];
    for (const [lvl, size, bold] of sizes) {
      this.MakeColl(`Heading ${lvl}`, heading, { RES_CHRATR_FONTSIZE: size, RES_CHRATR_WEIGHT: bold }).m_pNextTextFormatColl = body;
    }
    this.MakeColl('Title', heading, { RES_CHRATR_FONTSIZE: 560, RES_CHRATR_WEIGHT: true, RES_PARATR_ADJUST: 'center' }).m_pNextTextFormatColl = body;
    this.MakeColl('Subtitle', heading, { RES_CHRATR_FONTSIZE: 360, RES_PARATR_ADJUST: 'center' }).m_pNextTextFormatColl = body;
    this.MakeColl('Quotations', standard, { RES_LR_SPACE: { left: 567, right: 567, firstLine: 0 }, RES_UL_SPACE: { upper: 0, lower: 283 } });
    this.MakeColl('Preformatted Text', standard, { RES_CHRATR_FONT: 'Liberation Mono', RES_CHRATR_FONTSIZE: 200, RES_UL_SPACE: { upper: 0, lower: 0 } });
    this.m_aNodes.MakeTextNode(1, standard);
  }

  MakeColl(name: string, parent: SwTextFormatColl | null, set: SwAttrSet = {}): SwTextFormatColl {
    const c = new SwTextFormatColl(name, parent, set);
    this.m_aTextFormatColls.set(name, c);
    return c;
  }

  FindTextFormatCollByName(name: string): SwTextFormatColl | undefined { return this.m_aTextFormatColls.get(name); }
  GetNodes(): SwNodes { return this.m_aNodes; }

  // --- change notification (stands in for SwModify/SwClient at document level) ---
  Subscribe(f: () => void): () => void { this.m_aListeners.add(f); return () => this.m_aListeners.delete(f); }
  Changed(): void { for (const f of this.m_aListeners) f(); }

  IsModified(): boolean { return this.m_aUndo.length !== this.m_nSavedDepth; }
  SetUnmodified(): void { this.m_nSavedDepth = this.m_aUndo.length; }

  // --- undo ---
  private cursorSnap(p: SwPaM): CursorSnap {
    return { node: p.GetPoint().GetNodeIndex(), content: p.GetPoint().GetContentIndex(), markNode: p.GetMark().GetNodeIndex(), markContent: p.GetMark().GetContentIndex() };
  }

  /** Runs `op`, which must only change text nodes in [first, last + delta]. */
  private recorded(kind: string, pam: SwPaM, first: number, last: number, op: () => void, merge = false): void {
    const nodes = this.m_aNodes;
    const before: ParaSnap[] = [];
    for (let i = first; i <= last; i++) before.push(snap(nodes.node(i) as SwTextNode));
    const cursorBefore = this.cursorSnap(pam);
    const count = nodes.Count();
    op();
    const after: ParaSnap[] = [];
    for (let i = first, end = last + nodes.Count() - count; i <= end; i++) after.push(snap(nodes.node(i) as SwTextNode));
    const cursorAfter = this.cursorSnap(pam);
    const top = this.m_aUndo[this.m_aUndo.length - 1];
    if (merge && top?.kind === kind && top.first === first && top.after.length === 1 && after.length === 1
      && top.cursorAfter.node === cursorBefore.node && top.cursorAfter.content === cursorBefore.content
      && this.m_nSavedDepth !== this.m_aUndo.length) {
      top.after = after;
      top.cursorAfter = cursorAfter;
    } else {
      // A save point that lies in the discarded redo branch can no longer be reached.
      if (this.m_nSavedDepth > this.m_aUndo.length) this.m_nSavedDepth = -1;
      this.m_aUndo.push({ kind, first, before, after, cursorBefore, cursorAfter });
    }
    this.m_aRedo.length = 0;
    this.Changed();
  }

  private restore(first: number, currentCount: number, target: ParaSnap[]): void {
    const nodes = this.m_aNodes;
    const shared = Math.min(currentCount, target.length);
    const fill = (i: number, s: ParaSnap) => {
      const n = nodes.node(first + i) as SwTextNode;
      n.m_Text = s.text;
      n.m_aHints = s.hints.map((h) => ({ ...h, aAttrs: { ...h.aAttrs } }));
      n.m_pColl = s.coll;
      n.m_aSet = structuredClone(s.set);
      n.m_nVersion++;
    };
    for (let i = 0; i < shared; i++) fill(i, target[i]!);
    if (currentCount > target.length) {
      // Keep registered positions alive by moving them to the last surviving paragraph.
      const survivor = nodes.node(first + target.length - 1) as SwTextNode;
      for (let i = target.length; i < currentCount; i++) {
        const n = nodes.node(first + target.length) as SwTextNode;
        for (const p of [...n.m_aIndices]) p.Assign(survivor, 0);
        nodes.Remove(first + target.length);
      }
    }
    for (let i = currentCount; i < target.length; i++) {
      const s = target[i]!;
      const prev = nodes.node(first + i - 1) as SwTextNode;
      const n = prev.SplitContentNode(prev.Len());
      fill(i, s);
      n.m_nVersion++;
    }
    for (let i = 0; i < target.length; i++) {
      const n = nodes.node(first + i) as SwTextNode;
      for (const p of n.m_aIndices) if (p.m_nContent > n.Len()) p.m_nContent = n.Len();
    }
  }

  private applyCursor(pam: SwPaM, c: CursorSnap): void {
    const nodes = this.m_aNodes;
    pam.GetPoint().Assign(nodes.node(c.node) as SwTextNode, c.content);
    pam.GetMark().Assign(nodes.node(c.markNode) as SwTextNode, c.markContent);
  }

  Undo(pam: SwPaM): boolean {
    const u = this.m_aUndo.pop();
    if (!u) return false;
    this.restore(u.first, u.after.length, u.before);
    this.applyCursor(pam, u.cursorBefore);
    this.m_aRedo.push(u);
    this.Changed();
    return true;
  }

  Redo(pam: SwPaM): boolean {
    const u = this.m_aRedo.pop();
    if (!u) return false;
    this.restore(u.first, u.before.length, u.after);
    this.applyCursor(pam, u.cursorAfter);
    this.m_aUndo.push(u);
    this.Changed();
    return true;
  }

  // --- content operations (IDocumentContentOperations) ---

  /** Inserts at the point, replacing any selection first. */
  InsertString(pam: SwPaM, text: string, attrs?: SwCharAttrSet): void {
    if (pam.HasMark()) this.DeleteAndJoin(pam);
    const pt = pam.GetPoint();
    const idx = pt.GetNodeIndex();
    // SwUndoInsert::CanGrouping: only runs of the same class (word characters or delimiters) group.
    const kind = /^[\p{L}\p{N}]+$/u.test(text) ? 'insert-word' : 'insert-delim';
    this.recorded(kind, pam, idx, idx, () => {
      const start = pt.GetContentIndex();
      pt.GetNode().InsertText(text, start);
      if (attrs) pt.GetNode().SetAttr(start, start + text.length, attrs);
    }, true);
  }

  /** Splits the paragraph at the point; the new paragraph takes the style's follow style at the end. */
  SplitNode(pam: SwPaM): void {
    if (pam.HasMark()) this.DeleteAndJoin(pam);
    const pt = pam.GetPoint();
    const idx = pt.GetNodeIndex();
    this.recorded('split', pam, idx, idx, () => {
      const node = pt.GetNode();
      const atEnd = pt.GetContentIndex() === node.Len();
      const next = node.SplitContentNode(pt.GetContentIndex());
      if (atEnd) next.m_pColl = node.m_pColl.GetNextTextFormatColl();
      pt.Assign(next, 0);
      pam.DeleteMark();
    });
  }

  /** Deletes the selection and joins the first and last paragraphs. */
  DeleteAndJoin(pam: SwPaM): void {
    if (!pam.HasMark()) return;
    const start = pam.Start(), end = pam.End();
    const nFirst = start.GetNodeIndex(), nLast = end.GetNodeIndex();
    this.recorded('delete', pam, nFirst, nLast, () => {
      const first = start.GetNode(), last = end.GetNode();
      const startContent = start.GetContentIndex(), endContent = end.GetContentIndex();
      if (first === last) {
        first.EraseText(startContent, endContent - startContent);
      } else {
        first.EraseText(startContent, first.Len() - startContent);
        last.EraseText(0, endContent);
        for (let i = nFirst + 1; i < nLast; i++) {
          const dead = this.m_aNodes.node(nFirst + 1) as SwTextNode;
          for (const p of [...dead.m_aIndices]) p.Assign(first, startContent);
          this.m_aNodes.Remove(nFirst + 1);
        }
        first.JoinNext();
      }
      pam.GetPoint().Assign(first, startContent);
      pam.DeleteMark();
    });
  }

  /** Applies character attributes over the selection. */
  InsertAttr(pam: SwPaM, attrs: SwCharAttrSet): void {
    if (!pam.HasMark()) return;
    this.overRange(pam, 'attr', (n, s, e) => n.SetAttr(s, e, attrs));
  }

  ResetAttrs(pam: SwPaM): void {
    this.overRange(pam, 'reset', (n, s, e) => n.ResetAttr(s, e));
  }

  /** Applies direct paragraph attributes to every paragraph touched by the selection. */
  SetParaAttr(pam: SwPaM, attrs: SwAttrSet): void {
    this.overRange(pam, 'para', (n) => { Object.assign(n.m_aSet, attrs); n.m_nVersion++; });
  }

  SetTextFormatColl(pam: SwPaM, coll: SwTextFormatColl): void {
    this.overRange(pam, 'style', (n) => { n.m_pColl = coll; n.m_aSet = {}; n.m_nVersion++; });
  }

  private overRange(pam: SwPaM, kind: string, f: (n: SwTextNode, start: number, end: number) => void): void {
    const start = pam.Start(), end = pam.End();
    const nFirst = start.GetNodeIndex(), nLast = end.GetNodeIndex();
    this.recorded(kind, pam, nFirst, nLast, () => {
      for (let i = nFirst; i <= nLast; i++) {
        const n = this.m_aNodes.node(i);
        if (!n.IsTextNode()) continue;
        f(n, i === nFirst ? start.GetContentIndex() : 0, i === nLast ? end.GetContentIndex() : n.Len());
      }
    });
  }
}

export { SwPosition };
