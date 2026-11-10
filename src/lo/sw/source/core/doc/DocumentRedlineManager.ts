// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/core/doc/DocumentRedlineManager.cxx reduced
// @upstream sw/inc/redline.hxx reduced
// @upstream sw/source/core/doc/docredln.cxx reduced
// Upstream keeps SwRangeRedline objects (a PaM each) in an SwRedlineTable. Here the change is
// stored on the text it covers (RES_TXTATR_REDLINE) and on paragraph end marks
// (RES_PARATR_REDLINE), so node snapshots carry it through undo; the table is built from them
// on demand, joining neighbouring pieces whose data can combine. Insertions and deletions are
// tracked; formatting changes, stacked changes and change comments are not.
import type { SwDoc } from '../../../inc/doc.ts';
import type { SwPaM } from '../../../inc/pam.ts';
import type { SwRedlineData } from '../../../inc/hintids.ts';
import { SameRedline, type SwTextNode } from '../../../inc/ndtxt.ts';

/** RedlineType */
export type RedlineType = SwRedlineData['type'];

/** One piece of a change: text in a paragraph, or the paragraph's end mark. */
export interface SwRedlinePiece { node: SwTextNode; start: number; end: number; mark: boolean }

/** SwRangeRedline: a change with its data and extent, from its first to its last piece. */
export interface SwRangeRedline { data: SwRedlineData; pieces: SwRedlinePiece[] }

/** The document position where a change starts and where it ends. */
export function RedlineStart(r: SwRangeRedline): { node: SwTextNode; content: number } {
  const p = r.pieces[0]!;
  return { node: p.node, content: p.mark ? p.node.Len() : p.start };
}
export function RedlineEnd(r: SwRangeRedline, next: (n: SwTextNode) => SwTextNode | null): { node: SwTextNode; content: number } {
  const p = r.pieces[r.pieces.length - 1]!;
  if (!p.mark) return { node: p.node, content: p.end };
  const n = next(p.node);
  return n ? { node: n, content: 0 } : { node: p.node, content: p.node.Len() };
}

export class DocumentRedlineManager {
  private m_rDoc: SwDoc;
  /** RedlineFlags::On: changes are recorded. */
  m_bRecord = false;
  /** RedlineFlags::ShowInsert | ShowDelete: deletions are shown struck through; otherwise hidden. */
  m_bShow = true;
  /** The author of new changes (SwModule::GetRedlineAuthor). */
  m_sAuthor = 'Unknown Author';

  constructor(doc: SwDoc) { this.m_rDoc = doc; }

  IsRedlineOn(): boolean { return this.m_bRecord; }

  /** New change data for the current author, now. */
  NewData(type: RedlineType): SwRedlineData {
    return { type, author: this.m_sAuthor, date: new Date().toISOString().replace(/\.\d+Z$/, 'Z') };
  }

  /** The text node after `n` in the same section, which a paragraph end mark leads to. */
  NextInSection(n: SwTextNode): SwTextNode | null {
    const next = this.m_rDoc.GetNodes().node(n.GetIndex() + 1);
    return next.IsTextNode() && next.StartOfSectionNode() === n.StartOfSectionNode() ? next : null;
  }

  /** SwRedlineTable: every change in document order, pieces joined where their data can combine. */
  GetRedlineTable(): SwRangeRedline[] {
    const out: SwRangeRedline[] = [];
    let cur: SwRangeRedline | null = null;
    let lastEnd: { node: SwTextNode; content: number } | null = null;
    const add = (piece: SwRedlinePiece, data: SwRedlineData) => {
      // Adjacent: right where the previous piece ended (a mark ends at the next paragraph's start).
      const adjacent = !!cur && !!lastEnd && lastEnd.node === piece.node && lastEnd.content === (piece.mark ? piece.node.Len() : piece.start) && SameRedline(cur.data, data);
      if (adjacent) cur!.pieces.push(piece);
      else { cur = { data, pieces: [piece] }; out.push(cur); }
      if (piece.mark) {
        const n = this.NextInSection(piece.node);
        lastEnd = n ? { node: n, content: 0 } : null;
      } else lastEnd = { node: piece.node, content: piece.end };
    };
    for (const n of this.m_rDoc.allText()) {
      for (const h of n.m_aHints) if (h.aAttrs.RES_TXTATR_REDLINE) add({ node: n, start: h.nStart, end: h.nEnd, mark: false }, h.aAttrs.RES_TXTATR_REDLINE);
      const m = n.m_aSet.RES_PARATR_REDLINE;
      if (m) add({ node: n, start: n.Len(), end: n.Len(), mark: true }, m);
    }
    return out;
  }

  /** The changes that a selection touches, or the one at the cursor. */
  GetRedlinesAt(pam: SwPaM): SwRangeRedline[] {
    const s = pam.Start(), e = pam.End();
    const key = (node: SwTextNode, c: number) => [node.GetIndex(), c] as const;
    const le = (a: readonly [number, number], b: readonly [number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]);
    const ps = key(s.GetNode(), s.GetContentIndex()), pe = key(e.GetNode(), e.GetContentIndex());
    return this.GetRedlineTable().filter((r) => r.pieces.some((p) => {
      const a = key(p.node, p.start), b = key(p.node, p.mark ? p.end + 1 : p.end);
      // A cursor inside a piece (or at its start) hits it; a selection hits what it overlaps.
      return pam.HasMark() ? le(a, pe) && !le(b, ps) && !(a[0] === pe[0] && a[1] === pe[1]) : le(a, ps) && !le(b, ps);
    }));
  }

  /**
   * DocumentRedlineManager::AcceptRedline / RejectRedline for several changes as one undo step.
   * Accepting an insertion or rejecting a deletion keeps the text; the other two remove it,
   * a removed paragraph end mark joining its paragraph with the next.
   */
  AcceptRejectRedlines(pam: SwPaM, redlines: SwRangeRedline[], bAccept: boolean): boolean {
    if (!redlines.length) return false;
    const pieces = redlines.flatMap((r) => r.pieces.map((p) => ({ p, data: r.data })));
    const idx = pieces.map((x) => x.p.node.GetIndex());
    const first = Math.min(...idx);
    let last = Math.max(...idx);
    // A joined mark takes the following paragraph along.
    for (const { p } of pieces) if (p.mark) { const n = this.NextInSection(p.node); if (n) last = Math.max(last, n.GetIndex()); }
    this.m_rDoc.recorded(bAccept ? 'redline-accept' : 'redline-reject', pam, first, last, () => {
      // Last to first, so that earlier pieces keep their offsets.
      pieces.sort((a, b) => b.p.node.GetIndex() - a.p.node.GetIndex() || (b.p.mark ? 1 : 0) - (a.p.mark ? 1 : 0) || b.p.start - a.p.start);
      for (const { p, data } of pieces) {
        const remove = (data.type === 'Insert') !== bAccept;
        if (p.mark) {
          delete p.node.m_aSet.RES_PARATR_REDLINE;
          if (remove) this.JoinNext(p.node);
        } else if (remove) p.node.EraseText(p.start, p.end - p.start);
        else p.node.ResetAttr(p.start, p.end, ['RES_TXTATR_REDLINE']);
        p.node.m_nVersion++;
      }
      pam.DeleteMark();
    });
    return true;
  }

  /** Joins a paragraph with the next one of its section; the joined paragraph has the next one's end mark. */
  JoinNext(n: SwTextNode): void {
    const next = this.NextInSection(n);
    if (!next) return;
    const mark = next.m_aSet.RES_PARATR_REDLINE;
    n.JoinNext();
    if (mark) n.m_aSet.RES_PARATR_REDLINE = mark; else delete n.m_aSet.RES_PARATR_REDLINE;
  }

  /**
   * DocumentContentOperationsManager::DeleteAndJoin with redlining on (DeleteRangeImpl via
   * AppendRedline of a Delete): the range is marked deleted. The current author's own insertions
   * in it are removed at once (SwRangeRedline's "delete own insert" rule); text already deleted
   * stays as it is.
   */
  DeleteRedlineRange(pam: SwPaM): void {
    const doc = this.m_rDoc, nodes = doc.GetNodes();
    const start = pam.Start(), end = pam.End();
    const nFirst = start.GetNodeIndex(), nLast = end.GetNodeIndex();
    const sNode = start.GetNode(), eNode = end.GetNode();
    const sC = start.GetContentIndex(), eC = end.GetContentIndex();
    const data = this.NewData('Delete');
    const own = (d: SwRedlineData | null | undefined) => d?.type === 'Insert' && d.author === data.author;
    doc.recorded('delete', pam, nFirst, nLast, () => {
      for (let i = nLast; i >= nFirst; i--) {
        const n = nodes.node(i);
        if (!n.IsTextNode()) continue;
        const a = n === sNode ? sC : 0, b = n === eNode ? eC : n.Len();
        if (n !== eNode && i < nLast) {
          // The paragraph's end mark is in the range.
          const mark = n.m_aSet.RES_PARATR_REDLINE;
          if (own(mark) && this.NextInSection(n)) this.JoinNext(n);
          else if (mark?.type !== 'Delete') n.m_aSet.RES_PARATR_REDLINE = data;
        }
        // Text runs right to left: own insertions go, the rest is marked.
        const cuts = new Set([a, b]);
        for (const h of n.m_aHints) { if (h.nStart > a && h.nStart < b) cuts.add(h.nStart); if (h.nEnd > a && h.nEnd < b) cuts.add(h.nEnd); }
        const sorted = [...cuts].sort((x, y) => y - x);
        for (let k = 0; k + 1 < sorted.length; k++) {
          const to = sorted[k]!, from = sorted[k + 1]!;
          if (from >= to) continue;
          const d = n.GetCharAttrAt('RES_TXTATR_REDLINE', from);
          if (own(d)) n.EraseText(from, to - from);
          else if (d?.type !== 'Delete') n.SetAttr(from, to, { RES_TXTATR_REDLINE: data });
        }
        n.m_nVersion++;
      }
      pam.GetPoint().Assign(sNode, Math.min(sC, sNode.Len()));
      pam.DeleteMark();
    });
  }
}
