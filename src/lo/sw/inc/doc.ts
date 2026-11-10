// SPDX-License-Identifier: MPL-2.0
// @upstream sw/inc/doc.hxx reduced
// @upstream sw/source/core/doc/poolfmt.cxx reduced
// @upstream sw/source/core/doc/DocumentContentOperationsManager.cxx reduced
// @upstream sw/source/core/undo/docundo.cxx reduced
// @upstream sw/inc/undobj.hxx reduced
// @upstream sw/source/core/doc/docnum.cxx reduced
// Undo snapshots the touched paragraph range instead of using upstream's per-operation SwUndo classes.
import { SwNodes } from './ndarr.ts';
import { SwTextFormatColl, SwCharFormat } from './format.ts';
import { SwPageDesc } from './pagedesc.ts';
import { SwPaM, SwPosition } from './pam.ts';
import { LIST_KEYS, type SwAttrSet, type SwCharAttrSet } from './hintids.ts';
import { GetNumRuleFromPool, MAXLEVEL, POOL_NUMRULES, SwNumRule } from './numrule.ts';
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
  /** The rule table is copied, not diffed: rules are replaced, never changed in place. */
  numRulesBefore: Map<string, SwNumRule>;
  numRulesAfter: Map<string, SwNumRule>;
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
  /** SwNumRuleTable, by name. Rules are immutable once inserted, so undo can share them. */
  m_aNumRules = new Map<string, SwNumRule>();
  private m_nListIdCounter = 0;
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
    for (let n = this.m_aNodes.GoNext(0); n; n = this.m_aNodes.GoNext(n.GetIndex())) yield n;
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

  /** Runs `op`, which must only change text nodes in [first, last + delta]. */
  private recorded(kind: string, pam: SwPaM, first: number, last: number, op: () => void, merge = false): void {
    const nodes = this.m_aNodes;
    const before: ParaSnap[] = [];
    for (let i = first; i <= last; i++) before.push(snap(nodes.node(i) as SwTextNode));
    const cursorBefore = this.cursorSnap(pam);
    const numRulesBefore = new Map(this.m_aNumRules);
    const count = nodes.Count();
    op();
    const after: ParaSnap[] = [];
    for (let i = first, end = last + nodes.Count() - count; i <= end; i++) after.push(snap(nodes.node(i) as SwTextNode));
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
