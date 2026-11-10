// SPDX-License-Identifier: MPL-2.0
// @upstream sw/inc/doc.hxx reduced
// @upstream sw/source/core/doc/poolfmt.cxx reduced
// @upstream sw/source/core/doc/DocumentContentOperationsManager.cxx reduced
// @upstream sw/source/core/undo/docundo.cxx reduced
// @upstream sw/inc/undobj.hxx reduced
// @upstream sw/source/core/doc/docnum.cxx reduced
// @upstream sw/source/core/docnode/ndtbl.cxx reduced
// Undo snapshots the touched node range instead of using upstream's per-operation SwUndo classes.
// Ranges are widened to whole sections, so tables are always restored complete.
import { SwNodes } from './ndarr.ts';
import { SwTextFormatColl, SwCharFormat } from './format.ts';
import { SwPageDesc } from './pagedesc.ts';
import { SwPaM, SwPosition } from './pam.ts';
import { CH_TXTATR_BREAKWORD, LIST_KEYS, type SwAttrSet, type SwCharAttrSet, type SwField, type SwFlyCnt } from './hintids.ts';
import { GetNumRuleFromPool, MAXLEVEL, POOL_NUMRULES, SwNumRule } from './numrule.ts';
import { SwTextNode, type SwTextAttr } from './ndtxt.ts';
import { SwEndNode, SwStartNode, SwTableNode, type SwNode } from './node.ts';
import { SwNodeType, SwStartNodeType } from './ndtyp.ts';
import { SnapTable, SwTableBox, SwTableLine, TableFromSnap, type SwTable, type SwTableSnap } from './swtable.ts';

type NodeSnap =
  | { t: 'text'; text: string; hints: SwTextAttr[]; coll: SwTextFormatColl; set: SwAttrSet }
  | { t: 'table'; table: SwTableSnap }
  | { t: 'start'; kind: SwStartNodeType }
  | { t: 'end' };
interface CursorSnap { node: number; content: number; markNode: number; markContent: number }

export interface SwUndo {
  kind: string;
  first: number;
  before: NodeSnap[];
  after: NodeSnap[];
  cursorBefore: CursorSnap;
  cursorAfter: CursorSnap;
  /** The rule table is copied, not diffed: rules are replaced, never changed in place. */
  numRulesBefore: Map<string, SwNumRule>;
  numRulesAfter: Map<string, SwNumRule>;
}

function snap(n: SwNode): NodeSnap {
  if (n.IsTextNode()) {
    return { t: 'text', text: n.m_Text, hints: n.m_aHints.map((h) => ({ ...h, aAttrs: { ...h.aAttrs } })), coll: n.m_pColl, set: structuredClone(n.m_aSet) };
  }
  if (n.IsTableNode()) return { t: 'table', table: SnapTable((n as SwTableNode).m_pTable) };
  return n.IsStartNode() ? { t: 'start', kind: (n as SwStartNode).m_eStartNodeType } : { t: 'end' };
}

export class SwDoc {
  m_aNodes = new SwNodes();
  m_aPageDesc = new SwPageDesc();
  m_aTextFormatColls = new Map<string, SwTextFormatColl>();
  m_aCharFormats = new Map<string, SwCharFormat>();
  /** SwNumRuleTable, by name. Rules are immutable once inserted, so undo can share them. */
  m_aNumRules = new Map<string, SwNumRule>();
  private m_nListIdCounter = 0;
  /** Graphic data by key, shared by every as-character graphic that shows it. Entries are never removed while the document is open, so undo can bring a graphic back. */
  m_aGraphics = new Map<string, { data: Uint8Array; mime: string }>();
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
    // RES_POOLCOLL_HEADERFOOTER, RES_POOLCOLL_HEADER and RES_POOLCOLL_FOOTER; their tab stops are not ported.
    const hf = this.MakeColl('Header and Footer', standard);
    this.MakeColl('Header', hf);
    this.MakeColl('Footer', hf);
    // RES_POOLCOLL_TABLE and RES_POOLCOLL_TABLE_HDLN
    const tableContents = this.MakeColl('Table Contents', standard);
    this.MakeColl('Table Heading', tableContents, { RES_PARATR_ADJUST: 'center', RES_CHRATR_WEIGHT: true });
    this.m_aNodes.MakeTextNode(this.m_aNodes.GetEndOfContent().GetIndex(), standard);
  }

  MakeColl(name: string, parent: SwTextFormatColl | null, set: SwAttrSet = {}): SwTextFormatColl {
    const c = new SwTextFormatColl(name, parent, set);
    this.m_aTextFormatColls.set(name, c);
    return c;
  }

  FindTextFormatCollByName(name: string): SwTextFormatColl | undefined { return this.m_aTextFormatColls.get(name); }

  // --- numbering rules (docnum.cxx) ---
  FindNumRulePtr(name: string): SwNumRule | undefined {
    if (!name) return undefined;
    const r = this.m_aNumRules.get(name);
    if (r) return r;
    // Pool list styles are created on first use, as GetNumRuleFromPool does.
    if ((POOL_NUMRULES as readonly string[]).includes(name)) {
      const p = GetNumRuleFromPool(name as (typeof POOL_NUMRULES)[number]);
      this.m_aNumRules.set(name, p);
      return p;
    }
    return undefined;
  }

  /** Inserts or replaces a rule by name. Call inside a recorded operation so undo restores the old one. */
  PutNumRule(rule: SwNumRule): void { this.m_aNumRules.set(rule.GetName(), rule); }

  GetUniqueNumRuleName(): string {
    let n = this.m_aNumRules.size + 1;
    while (this.m_aNumRules.has(`Numbering ${n}`)) n++;
    return `Numbering ${n}`;
  }

  /** SwDoc::CreateListId */
  CreateListId(): string {
    let id: string;
    do id = `list${++this.m_nListIdCounter}`; while ([...this.allText()].some((n) => n.m_aSet.RES_PARATR_LIST_ID === id));
    return id;
  }

  private *allText(): Generator<SwTextNode> {
    for (let n = this.m_aNodes.GoNext(0); n; n = this.m_aNodes.GoNext(n.GetIndex())) yield n; // headers and footers too
  }
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

  /** Widens [first, last] until every start node in it has its end node in it and vice versa. */
  private balance(first: number, last: number): [number, number] {
    const nodes = this.m_aNodes;
    for (let changed = true; changed;) {
      changed = false;
      for (let i = first; i <= last; i++) {
        const n = nodes.node(i);
        if (n.IsEndNode()) {
          const s = n.m_pStartOfSection!.GetIndex();
          if (s < first) { first = s; changed = true; }
        } else if (n.IsStartNode()) {
          const e = (n as SwStartNode).EndOfSectionNode().GetIndex();
          if (e > last) { last = e; changed = true; }
        }
      }
    }
    return [first, last];
  }

  /** Runs `op`, which must only change nodes in [first, last + delta], delta being the change in node count. */
  private recorded(kind: string, pam: SwPaM, first: number, last: number, op: () => void, merge = false): void {
    const nodes = this.m_aNodes;
    [first, last] = this.balance(first, last);
    const before: NodeSnap[] = [];
    for (let i = first; i <= last; i++) before.push(snap(nodes.node(i)));
    const cursorBefore = this.cursorSnap(pam);
    const numRulesBefore = new Map(this.m_aNumRules);
    const count = nodes.Count();
    op();
    const after: NodeSnap[] = [];
    for (let i = first, end = last + nodes.Count() - count; i <= end; i++) after.push(snap(nodes.node(i)));
    const cursorAfter = this.cursorSnap(pam);
    const numRulesAfter = new Map(this.m_aNumRules);
    const top = this.m_aUndo[this.m_aUndo.length - 1];
    if (merge && top?.kind === kind && top.first === first && top.after.length === 1 && after.length === 1
      && top.cursorAfter.node === cursorBefore.node && top.cursorAfter.content === cursorBefore.content
      && this.m_nSavedDepth !== this.m_aUndo.length) {
      top.after = after;
      top.cursorAfter = cursorAfter;
    } else {
      // A save point that lies in the discarded redo branch can no longer be reached.
      if (this.m_nSavedDepth > this.m_aUndo.length) this.m_nSavedDepth = -1;
      this.m_aUndo.push({ kind, first, before, after, cursorBefore, cursorAfter, numRulesBefore, numRulesAfter });
    }
    this.m_aRedo.length = 0;
    this.Changed();
  }

  /** Replaces the `currentCount` nodes at `first` with nodes rebuilt from `target`. */
  private restore(first: number, currentCount: number, target: NodeSnap[]): void {
    const nodes = this.m_aNodes;
    // In place when only text changes, so that positions and cached layouts survive.
    if (currentCount === target.length && target.every((t, i) => t.t === 'text' && nodes.node(first + i).IsTextNode())) {
      target.forEach((t, i) => this.fill(nodes.node(first + i) as SwTextNode, t as Extract<NodeSnap, { t: 'text' }>));
      return;
    }
    // Remember registered positions by text node ordinal, to move them to the rebuilt nodes.
    const moved: { pos: SwPosition; ordinal: number }[] = [];
    let ordinal = 0;
    for (let i = 0; i < currentCount; i++) {
      const n = nodes.node(first + i);
      if (n.IsTextNode()) { for (const p of n.m_aIndices) moved.push({ pos: p, ordinal }); ordinal++; }
    }
    const parent = nodes.SectionAt(first);
    nodes.Remove(first, currentCount);
    const stack: SwStartNode[] = [parent];
    const boxQueues = new Map<SwTableNode, SwTableBox[]>();
    const texts: SwTextNode[] = [];
    let at = first;
    for (const t of target) {
      const up = stack[stack.length - 1]!;
      let n: SwNode;
      if (t.t === 'text') {
        const tn = new SwTextNode(nodes, t.coll);
        this.fill(tn, t);
        texts.push(tn);
        n = tn;
      } else if (t.t === 'table') {
        const tn = new SwTableNode(nodes, TableFromSnap(t.table));
        boxQueues.set(tn, tn.m_pTable.GetTabSortBoxes());
        stack.push(tn);
        n = tn;
      } else if (t.t === 'start') {
        const sn = new SwStartNode(nodes, SwNodeType.Start, t.kind);
        const box = up.IsTableNode() ? boxQueues.get(up as SwTableNode)?.shift() : undefined;
        if (box) box.m_pStartNode = sn;
        stack.push(sn);
        n = sn;
      } else {
        const start = stack.pop()!;
        n = new SwEndNode(nodes, start);
        nodes.Insert(n, at++);
        continue;
      }
      n.m_pStartOfSection = up;
      nodes.Insert(n, at++);
    }
    for (const { pos, ordinal: o } of moved) {
      const tn = texts[Math.min(o, texts.length - 1)];
      if (tn) pos.Assign(tn, Math.min(pos.m_nContent, tn.Len()));
    }
  }

  private fill(n: SwTextNode, s: Extract<NodeSnap, { t: 'text' }>): void {
    n.m_Text = s.text;
    n.m_aHints = s.hints.map((h) => ({ ...h, aAttrs: { ...h.aAttrs } }));
    n.m_pColl = s.coll;
    n.m_aSet = structuredClone(s.set);
    n.m_nVersion++;
    for (const p of n.m_aIndices) if (p.m_nContent > n.Len()) p.m_nContent = n.Len();
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
    this.m_aNumRules = new Map(u.numRulesBefore);
    this.applyCursor(pam, u.cursorBefore);
    this.m_aRedo.push(u);
    this.Changed();
    return true;
  }

  Redo(pam: SwPaM): boolean {
    const u = this.m_aRedo.pop();
    if (!u) return false;
    this.restore(u.first, u.before.length, u.after);
    this.m_aNumRules = new Map(u.numRulesAfter);
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
      if (first.StartOfSectionNode() !== last.StartOfSectionNode()) {
        // Across a table boundary only text goes: cells and paragraphs keep their structure.
        for (let i = nFirst; i <= nLast; i++) {
          const n = this.m_aNodes.node(i);
          if (!n.IsTextNode()) continue;
          const a = n === first ? startContent : 0, b = n === last ? endContent : n.Len();
          n.EraseText(a, b - a);
        }
      } else if (first === last) {
        first.EraseText(startContent, endContent - startContent);
      } else {
        first.EraseText(startContent, first.Len() - startContent);
        last.EraseText(0, endContent);
        for (let i = nFirst + 1; i < nLast; i++) {
          const dead = this.m_aNodes.node(nFirst + 1);
          if (dead.IsTextNode()) for (const p of [...dead.m_aIndices]) p.Assign(first, startContent);
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

  /** Removes character attributes on the selection: the given ones, or all. */
  ResetAttrs(pam: SwPaM, keys?: (keyof SwCharAttrSet)[]): void {
    this.overRange(pam, 'reset', (n, s, e) => n.ResetAttr(s, e, keys));
  }

  /** Applies direct paragraph attributes to every paragraph touched by the selection. */
  SetParaAttr(pam: SwPaM, attrs: SwAttrSet): void {
    this.overRange(pam, 'para', (n) => { Object.assign(n.m_aSet, attrs); n.m_nVersion++; });
  }

  SetTextFormatColl(pam: SwPaM, coll: SwTextFormatColl): void {
    this.overRange(pam, 'style', (n) => { n.m_pColl = coll; n.m_aSet = {}; n.m_nVersion++; });
  }

  // --- headers and footers (DocumentLayoutManager::MakeLayoutFormat, SwWrtShell::ChangeHeaderOrFooter) ---

  /** Turns the page style's header or footer on (with an empty paragraph) or off (deleting its content). */
  SetHeaderFooter(pam: SwPaM, bHeader: boolean, bOn: boolean): void {
    const nodes = this.m_aNodes;
    const eTyp = bHeader ? SwStartNodeType.SwHeaderStartNode : SwStartNodeType.SwFooterStartNode;
    const existing = nodes.FindAreaSection(eTyp);
    if (!!existing === bOn) return;
    if (bOn) {
      const at = nodes.GetEndOfAutotext().GetIndex();
      // An empty range before the end of the autotext area: the new section is all that changes.
      this.recorded(bHeader ? 'header' : 'footer', pam, at, at - 1, () => {
        nodes.MakeAreaSection(eTyp, this.FindTextFormatCollByName(bHeader ? 'Header' : 'Footer')!);
      });
      return;
    }
    const s = existing!.GetIndex(), e = existing!.EndOfSectionNode().GetIndex();
    this.recorded(bHeader ? 'header' : 'footer', pam, s, e, () => {
      const body = nodes.FirstTextNode();
      for (let i = s; i <= e; i++) {
        const n = nodes.node(i);
        if (n.IsTextNode()) for (const p of [...n.m_aIndices]) p.Assign(body, 0);
      }
      nodes.Remove(s, e - s + 1);
      pam.DeleteMark();
    });
  }

  /** Stores graphic data and returns its key; identical data shares one key. */
  AddGraphic(data: Uint8Array, mime: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < data.length; i += Math.max(1, data.length >> 12)) h = Math.imul(h ^ data[i]!, 0x01000193);
    let key = `${(h >>> 0).toString(16)}${data.length.toString(16)}`;
    while (this.m_aGraphics.has(key) && this.m_aGraphics.get(key)!.data.length !== data.length) key += 'x';
    this.m_aGraphics.set(key, { data, mime });
    return key;
  }

  GetUniqueGrfName(): string {
    const used = new Set<string>();
    for (const n of this.allText()) for (const h of n.m_aHints) if (h.aAttrs.RES_TXTATR_FLYCNT) used.add(h.aAttrs.RES_TXTATR_FLYCNT.name);
    let k = 1;
    while (used.has(`Image${k}`)) k++;
    return `Image${k}`;
  }

  /** SwDoc::InsertGraphic anchored as character at the point. */
  InsertGraphic(pam: SwPaM, fly: SwFlyCnt): void {
    this.InsertString(pam, CH_TXTATR_BREAKWORD, { RES_TXTATR_FLYCNT: fly });
  }

  /** SwDoc::InsertField at the point (DocumentContentOperationsManager::InsertPoolItem for RES_TXTATR_FIELD). */
  InsertField(pam: SwPaM, field: SwField, attrs?: SwCharAttrSet): void {
    this.InsertString(pam, CH_TXTATR_BREAKWORD, { ...attrs, RES_TXTATR_FIELD: field });
  }

  // --- tables (ndtbl.cxx) ---

  GetUniqueTableName(): string {
    const used = new Set<string>();
    for (let i = 0; i < this.m_aNodes.Count(); i++) {
      const n = this.m_aNodes.node(i);
      if (n.IsTableNode()) used.add((n as SwTableNode).m_pTable.m_aAttrs.name);
    }
    let k = 1;
    while (used.has(`Table${k}`)) k++;
    return `Table${k}`;
  }

  /**
   * SwEditShell::InsertTable + SwDoc::InsertTable: splits the paragraph if the point is inside it,
   * then inserts the table before the point's paragraph and moves the point into the first cell.
   */
  InsertTable(pam: SwPaM, nRows: number, nCols: number, opts: { heading: boolean; repeatHeading: boolean; borders: boolean }): SwTableNode | null {
    if (pam.HasMark()) this.DeleteAndJoin(pam);
    const pt = pam.GetPoint();
    const idx = pt.GetNodeIndex();
    let table: SwTableNode | null = null;
    this.recorded('instable', pam, idx, idx, () => {
      let node = pt.GetNode();
      if (pt.GetContentIndex() !== 0) {
        node = node.SplitContentNode(pt.GetContentIndex());
        pt.Assign(node, 0);
      }
      const body = this.FindTextFormatCollByName('Table Contents')!;
      const head = opts.heading ? this.FindTextFormatCollByName('Table Heading')! : null;
      table = this.m_aNodes.InsertTable(node.GetIndex(), nCols, body, nRows, opts.heading && opts.repeatHeading ? 1 : 0, head,
        { name: this.GetUniqueTableName(), adjust: 'full', width: 0, leftSpace: 0, upper: 0, lower: 0 }, node.m_aSet, opts.borders);
      pt.Assign(this.m_aNodes.GoNext(table.GetIndex())!, 0);
      pam.DeleteMark();
    });
    return table;
  }

  /** The box and line containing a position, with the box's column (by left edge in relative units). */
  GetTableBoxAt(node: SwTextNode): { tableNode: SwTableNode; box: SwTableBox; line: number; left: number } | null {
    const start = node.FindTableBoxStartNode();
    const tableNode = start?.m_pStartOfSection as SwTableNode | null;
    if (!start || !tableNode?.IsTableNode()) return null;
    const lines = tableNode.m_pTable.GetTabLines();
    for (let l = 0; l < lines.length; l++) {
      let left = 0;
      for (const b of lines[l]!.m_aBoxes) {
        if (b.m_pStartNode === start) return { tableNode, box: b, line: l, left };
        left += b.m_aAttrs.width;
      }
    }
    return null;
  }

  private tableOp(pam: SwPaM, kind: string, f: (tableNode: SwTableNode, at: NonNullable<ReturnType<SwDoc['GetTableBoxAt']>>) => void): boolean {
    const at = this.GetTableBoxAt(pam.GetPoint().GetNode());
    if (!at) return false;
    const t = at.tableNode, first = t.GetIndex(), last = t.EndOfSectionNode().GetIndex();
    this.recorded(kind, pam, first, last, () => f(t, at));
    return true;
  }

  /** Creates the nodes of one empty box before `where` and returns its start node. */
  private makeBoxNodes(tableNode: SwTableNode, where: number, coll: SwTextFormatColl): SwStartNode {
    const sn = new SwStartNode(this.m_aNodes, SwNodeType.Start, SwStartNodeType.SwTableBoxStartNode);
    sn.m_pStartOfSection = tableNode;
    this.m_aNodes.Insert(sn, where);
    const tn = new SwTextNode(this.m_aNodes, coll);
    tn.m_pStartOfSection = sn;
    this.m_aNodes.Insert(tn, where + 1);
    this.m_aNodes.Insert(new SwEndNode(this.m_aNodes, sn), where + 2);
    return sn;
  }

  private boxColl(box: SwTableBox): SwTextFormatColl {
    return this.m_aNodes.GoNext(box.m_pStartNode!.GetIndex())?.GetTextColl() ?? this.FindTextFormatCollByName('Table Contents')!;
  }

  /** Removes a box's nodes; positions in it move to `refuge`. */
  private removeBoxNodes(box: SwTableBox, refuge: SwTextNode): void {
    const s = box.m_pStartNode!.GetIndex(), e = box.m_pStartNode!.EndOfSectionNode().GetIndex();
    for (let i = s; i <= e; i++) {
      const n = this.m_aNodes.node(i);
      if (n.IsTextNode()) for (const p of [...n.m_aIndices]) p.Assign(refuge, 0);
    }
    this.m_aNodes.Remove(s, e - s + 1);
  }

  /** SwDoc::InsertRow: copies the current row's box layout and paragraph styles. */
  InsertRow(pam: SwPaM, bBehind: boolean, nCnt = 1): boolean {
    return this.tableOp(pam, 'insrow', (t, at) => {
      const table = t.m_pTable;
      const src = table.m_aLines[at.line]!;
      for (let k = 0; k < nCnt; k++) {
        const line = new SwTableLine();
        line.m_aAttrs = structuredClone(src.m_aAttrs);
        const anchorLine = bBehind ? table.m_aLines[at.line + k]! : src;
        const anchorBox = bBehind ? anchorLine.m_aBoxes[anchorLine.m_aBoxes.length - 1]! : anchorLine.m_aBoxes[0]!;
        let where = bBehind ? anchorBox.m_pStartNode!.EndOfSectionNode().GetIndex() + 1 : anchorBox.m_pStartNode!.GetIndex();
        for (const b of src.m_aBoxes) {
          const box = new SwTableBox(line, structuredClone(b.m_aAttrs));
          box.m_pStartNode = this.makeBoxNodes(t, where, this.boxColl(b));
          where += 3;
          line.m_aBoxes.push(box);
        }
        table.m_aLines.splice(bBehind ? at.line + 1 + k : at.line + k, 0, line);
        if (!bBehind && table.m_nRowsToRepeat > at.line) table.m_nRowsToRepeat++;
      }
    });
  }

  /** Index of the box in `line` covering the relative x position `left`. */
  private boxAtLeft(line: SwTableLine, left: number): number {
    let x = 0;
    for (let i = 0; i < line.m_aBoxes.length; i++) {
      const w = line.m_aBoxes[i]!.m_aAttrs.width;
      if (left < x + w - 1e-6) return i;
      x += w;
    }
    return line.m_aBoxes.length - 1;
  }

  /** SwDoc::InsertCol: a column as wide as the current one, in every row. */
  InsertCol(pam: SwPaM, bBehind: boolean, nCnt = 1): boolean {
    return this.tableOp(pam, 'inscol', (t, at) => {
      for (const line of t.m_pTable.m_aLines) {
        const i = this.boxAtLeft(line, at.left);
        const ref = line.m_aBoxes[i]!;
        let where = bBehind ? ref.m_pStartNode!.EndOfSectionNode().GetIndex() + 1 : ref.m_pStartNode!.GetIndex();
        for (let k = 0; k < nCnt; k++) {
          const box = new SwTableBox(line, { ...structuredClone(ref.m_aAttrs), width: at.box.m_aAttrs.width });
          box.m_pStartNode = this.makeBoxNodes(t, where, this.boxColl(ref));
          where += 3;
          line.m_aBoxes.splice(bBehind ? i + 1 + k : i + k, 0, box);
        }
      }
    });
  }

  /** SwDoc::DeleteRowCol for the rows of the selection; the whole table goes with its last row. */
  DeleteRow(pam: SwPaM): boolean {
    const a = this.GetTableBoxAt(pam.Start().GetNode()), b = this.GetTableBoxAt(pam.End().GetNode());
    if (!a) return false;
    const lines = a.tableNode.m_pTable.m_aLines;
    const from = a.line, to = b && b.tableNode === a.tableNode ? b.line : a.line;
    if (to - from + 1 >= lines.length) return this.DeleteTable(pam);
    return this.tableOp(pam, 'delrow', (t) => {
      const table = t.m_pTable;
      // The cursor goes to the row after, or before when the last rows go.
      const refugeLine = table.m_aLines[to + 1] ?? table.m_aLines[from - 1]!;
      const refuge = this.m_aNodes.GoNext(refugeLine.m_aBoxes[0]!.m_pStartNode!.GetIndex())!;
      for (let l = to; l >= from; l--) for (const box of [...table.m_aLines[l]!.m_aBoxes].reverse()) this.removeBoxNodes(box, refuge);
      table.m_aLines.splice(from, to - from + 1);
      table.m_nRowsToRepeat = Math.min(table.m_nRowsToRepeat, table.m_aLines.length);
      pam.GetPoint().Assign(refuge, 0);
      pam.DeleteMark();
    });
  }

  DeleteCol(pam: SwPaM): boolean {
    const a = this.GetTableBoxAt(pam.GetPoint().GetNode());
    if (!a) return false;
    if (a.tableNode.m_pTable.m_aLines.every((l) => l.m_aBoxes.length <= 1)) return this.DeleteTable(pam);
    return this.tableOp(pam, 'delcol', (t, at) => {
      let refuge: SwTextNode | null = null;
      for (const line of t.m_pTable.m_aLines) {
        const i = this.boxAtLeft(line, at.left);
        if (line.m_aBoxes.length <= 1) continue;
        const neighbour = line.m_aBoxes[i + 1] ?? line.m_aBoxes[i - 1]!;
        const r = this.m_aNodes.GoNext(neighbour.m_pStartNode!.GetIndex())!;
        if (line === t.m_pTable.m_aLines[at.line]) refuge = r;
        this.removeBoxNodes(line.m_aBoxes[i]!, r);
        line.m_aBoxes.splice(i, 1);
      }
      if (refuge) pam.GetPoint().Assign(refuge, 0);
      pam.DeleteMark();
    });
  }

  /** SwDoc::DeleteTable: keeps a paragraph where the table was if nothing else is left there. */
  DeleteTable(pam: SwPaM): boolean {
    const at = this.GetTableBoxAt(pam.GetPoint().GetNode());
    if (!at) return false;
    const t = at.tableNode, first = t.GetIndex(), last = t.EndOfSectionNode().GetIndex();
    const after = this.m_aNodes.node(last + 1), before = this.m_aNodes.node(first - 1);
    // Include the paragraph after (or before) the table so that the cursor has a home.
    const home = after.IsTextNode() ? last + 1 : before.IsTextNode() ? first - 1 : -1;
    const rFirst = home === first - 1 ? first - 1 : first, rLast = home === last + 1 ? last + 1 : last;
    this.recorded('deltable', pam, rFirst, rLast, () => {
      let target: SwTextNode;
      if (home < 0) {
        target = new SwTextNode(this.m_aNodes, this.FindTextFormatCollByName('Standard')!);
        target.m_pStartOfSection = t.m_pStartOfSection;
        this.m_aNodes.Insert(target, last + 1);
      } else target = this.m_aNodes.node(home) as SwTextNode;
      for (let i = first; i <= last; i++) {
        const n = this.m_aNodes.node(i);
        if (n.IsTextNode()) for (const p of [...n.m_aIndices]) p.Assign(target, home === first - 1 ? target.Len() : 0);
      }
      this.m_aNodes.Remove(first, last - first + 1);
      pam.DeleteMark();
    });
    return true;
  }

  /** Sets attributes of the boxes of the selection, or of every box with `whole`. */
  SetBoxAttr(pam: SwPaM, f: (box: SwTableBox) => void, whole = false): boolean {
    const a = this.GetTableBoxAt(pam.Start().GetNode()), b = this.GetTableBoxAt(pam.End().GetNode());
    if (!a) return false;
    return this.tableOp(pam, 'boxattr', (t) => {
      const boxes = t.m_pTable.GetTabSortBoxes();
      const i0 = boxes.indexOf(a.box), i1 = b && b.tableNode === t ? boxes.indexOf(b.box) : i0;
      boxes.forEach((box, i) => { if (whole || (i >= Math.min(i0, i1) && i <= Math.max(i0, i1))) f(box); });
    });
  }

  /** Sets attributes of the table at the point. */
  SetTableAttr(pam: SwPaM, f: (t: SwTable) => void): boolean {
    return this.tableOp(pam, 'tableattr', (t) => f(t.m_pTable));
  }

  // --- lists (docnum.cxx) ---

  /**
   * SwDoc::SetNumRule: puts the paragraphs of the selection into a list with `rule`, replacing a rule
   * of the same name. `listId` continues that list; `bCreateNewList` starts a new one; otherwise
   * paragraphs keep their list. With `bResetIndentAttrs` direct indents go, so the list's apply.
   */
  SetNumRule(pam: SwPaM, rule: SwNumRule, bCreateNewList: boolean, listId = '', bResetIndentAttrs = true): void {
    const newId = bCreateNewList && !listId ? this.CreateListId() : listId;
    this.overRange(pam, 'numrule', (n) => {
      if (n === pam.Start().GetNode()) this.PutNumRule(rule);
      // A paragraph moving to another rule leaves its old list, unless a list is given.
      if (n.GetAttr('RES_PARATR_NUMRULE') !== rule.GetName()) delete n.m_aSet.RES_PARATR_LIST_ID;
      n.m_aSet.RES_PARATR_NUMRULE = rule.GetName();
      if (newId) n.m_aSet.RES_PARATR_LIST_ID = newId;
      if (bResetIndentAttrs) delete n.m_aSet.RES_LR_SPACE;
      n.m_nVersion++;
    });
  }

  /** SwDoc::DelNumRules */
  DelNumRules(pam: SwPaM): void {
    this.overRange(pam, 'delnum', (n) => {
      for (const k of LIST_KEYS) delete n.m_aSet[k];
      // A list set by the paragraph style must be switched off explicitly.
      if (n.GetAttr('RES_PARATR_NUMRULE')) n.m_aSet.RES_PARATR_NUMRULE = '';
      n.m_nVersion++;
    });
  }

  /** SwDoc::NumUpDown: fails without change if any paragraph is already at the outermost level. */
  NumUpDown(pam: SwPaM, bDown: boolean): boolean {
    const paras = this.listParas(pam);
    if (!paras.length) return false;
    const limit = bDown ? MAXLEVEL - 1 : 0;
    if (paras.some((n) => n.GetAttr('RES_PARATR_LIST_LEVEL') === limit)) return false;
    this.overRange(pam, 'numupdown', (n) => {
      if (!n.GetAttr('RES_PARATR_NUMRULE')) return;
      n.m_aSet.RES_PARATR_LIST_LEVEL = n.GetAttr('RES_PARATR_LIST_LEVEL') + (bDown ? 1 : -1);
      n.m_nVersion++;
    });
    return true;
  }

  /** SwDoc::NumOrNoNum: makes the paragraph at the point counted or not. Returns whether it changed. */
  NumOrNoNum(pam: SwPaM, bCounted: boolean): boolean {
    const n = pam.GetPoint().GetNode();
    if (!n.GetAttr('RES_PARATR_NUMRULE') || n.GetAttr('RES_PARATR_LIST_ISCOUNTED') === bCounted) return false;
    const idx = n.GetIndex();
    this.recorded('numornonum', pam, idx, idx, () => { n.m_aSet.RES_PARATR_LIST_ISCOUNTED = bCounted; n.m_nVersion++; });
    return true;
  }

  /** SwDoc::SetNumRuleStart */
  SetNumRuleStart(pam: SwPaM, bFlag: boolean): void {
    this.overRange(pam, 'numstart', (n) => {
      if (!n.GetAttr('RES_PARATR_NUMRULE')) return;
      if (bFlag) n.m_aSet.RES_PARATR_LIST_ISRESTART = true; else delete n.m_aSet.RES_PARATR_LIST_ISRESTART;
      n.m_nVersion++;
    });
  }

  private listParas(pam: SwPaM): SwTextNode[] {
    const out: SwTextNode[] = [];
    for (let i = pam.Start().GetNodeIndex(); i <= pam.End().GetNodeIndex(); i++) {
      const n = this.m_aNodes.node(i);
      if (n.IsTextNode() && n.GetAttr('RES_PARATR_NUMRULE')) out.push(n);
    }
    return out;
  }

  /**
   * SwDoc::SearchNumRule, backwards with nNonEmptyAllowed = 0: the rule of the nearest preceding
   * list paragraph, if only empty paragraphs lie between, and only if it is of the wanted kind.
   */
  SearchNumRule(node: SwTextNode, bNum: boolean): { rule: SwNumRule; listId: string } | null {
    for (let n = this.m_aNodes.GoPrevious(node.GetIndex()); n; n = this.m_aNodes.GoPrevious(n.GetIndex())) {
      if (n.StartOfSectionNode() !== node.StartOfSectionNode()) return null;
      const rule = this.FindNumRulePtr(n.GetAttr('RES_PARATR_NUMRULE'));
      if (rule) {
        const f = rule.Get(0);
        return (bNum && f.IsEnumeration()) || (!bNum && f.IsItemize())
          ? { rule, listId: n.GetAttr('RES_PARATR_LIST_ID') || `rule:${rule.GetName()}` }
          : null;
      }
      if (n.Len() > 0) return null;
    }
    return null;
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
