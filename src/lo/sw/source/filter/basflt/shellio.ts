// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/filter/basflt/shellio.cxx reduced
// @upstream sw/source/filter/xml/xmlimp.cxx reduced
// @upstream sw/source/core/txtnode/thints.cxx reduced
// SwReader::Read with a cursor (insert mode, Insert > Content from Document). Upstream's readers
// insert while they read; here an importer has read the file into an SwDoc of its own, whose body
// is then copied to the cursor and placed as SwXMLImport's insert mode places it: startDocument
// splits the paragraph, endDocAdjustNodes joins the first new paragraph to the text before the
// cursor and the text after it to the last new paragraph, and MergeListsAtDocumentInsertPosition
// continues a list. With the body come its footnotes and endnotes, comments, bookmarks and
// reference marks, the objects anchored in it and the page anchored ones (keeping their page),
// sections, tables, and the paragraph, character and list styles and field types the document
// lacks (one it has keeps its own definition). As in upstream's insert mode, headers and footers,
// page styles, the default formatting and the document settings are not inserted. Left out: the
// recording of the inserted text as a tracked insertion, the update of indexes (FN_UPDATE_TOX),
// and the undo for new field types (they stay after Undo, unused).
import { SwDoc, snap, type NodeSnap } from '../../../inc/doc.ts';
import type { SwPaM } from '../../../inc/pam.ts';
import { SwPosition } from '../../../inc/pam.ts';
import type { SwTextNode, SwTextAttr } from '../../../inc/ndtxt.ts';
import type { SwNode, SwStartNode } from '../../../inc/node.ts';
import type { SwFlyFrameFormat, SwAnchoredFly } from '../../../inc/frmfmt.ts';
import type { SwAttrSet, SwCharAttrSet, SwField } from '../../../inc/hintids.ts';
import { ReferencesSubtype } from '../../core/fields/reffld.ts';
import { SwUserFieldType } from '../../core/fields/usrfld.ts';
import { SwSetExpFieldType } from '../../core/fields/expfld.ts';
import { MAXLEVEL } from '../../../inc/numrule.ts';

const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/** The paragraph's own character attributes (aCharFormatSetRange of its SwAttrSet). */
const charItems = (n: SwTextNode): [string, unknown][] => Object.entries(n.m_aSet).filter(([k]) => k.startsWith('RES_CHRATR_'));

/** Puts character attributes under the node's hints, over its whole text. */
function underlay(n: SwTextNode, chars: SwCharAttrSet): void {
  if (!Object.keys(chars).length || !n.Len()) return;
  const out: SwTextAttr[] = [];
  let cur = 0;
  for (const h of [...n.m_aHints].sort((a, b) => a.nStart - b.nStart)) {
    if (h.nStart > cur) out.push({ nStart: cur, nEnd: h.nStart, aAttrs: { ...chars } });
    out.push({ nStart: h.nStart, nEnd: h.nEnd, aAttrs: { ...chars, ...h.aAttrs } });
    cur = Math.max(cur, h.nEnd);
  }
  if (cur < n.Len()) out.push({ nStart: cur, nEnd: n.Len(), aAttrs: { ...chars } });
  n.m_aHints = out;
  n.MergePortions();
}

/**
 * SwTextNode::FormatToTextAttr(pNd) before this node and pNd (the 'main' node, whose paragraph
 * attributes the joined paragraph keeps) are joined: an item only this node has, or has with
 * another value, becomes a text attribute of this node; one only pNd has becomes a text attribute
 * of pNd; one both have alike is cleared in this node.
 */
export function FormatToTextAttr(pThis: SwTextNode, pNd: SwTextNode): void {
  const aThis: SwCharAttrSet = {}, aNd: SwCharAttrSet = {};
  const mine = new Map(charItems(pThis)), main = new Map(charItems(pNd));
  for (const [k, v] of mine) {
    if (!(main.has(k) && same(main.get(k), v))) (aThis as Record<string, unknown>)[k] = v;
    delete (pThis.m_aSet as Record<string, unknown>)[k];
  }
  for (const [k, v] of main) {
    if (mine.has(k)) continue;
    (aNd as Record<string, unknown>)[k] = v;
    delete (pNd.m_aSet as Record<string, unknown>)[k];
  }
  underlay(pThis, aThis);
  underlay(pNd, aNd);
}

/** Copies the content of another document into this one, renaming what would clash. */
class CopyContext {
  // Queued sections of the inserts area (footnotes) and the autotext area (text frames).
  readonly footnotes: { src: SwStartNode; id: string }[] = [];
  readonly flys: { src: SwStartNode; id: string }[] = [];
  /** The source text nodes copied, in the order of the snapshots made. */
  readonly copied: SwTextNode[] = [];
  private readonly ftnIds = new Map<string, string>();
  private readonly annIds = new Map<string, string>();
  private readonly flyNames = new Map<string, string>();
  private readonly listIds = new Map<string, string>();
  private readonly numRules = new Map<string, string>();
  private readonly toxIds = new Map<string, string>();
  private readonly seqNos = new Map<string, number>();
  private readonly graphics = new Map<string, string>();
  readonly markNames = new Map<string, string>();
  private readonly takenFly: Set<string>;
  private readonly takenSection: Set<string>;
  private readonly takenTable = new Set<string>();
  private readonly takenAnn: Set<string>;
  private readonly takenTox: Set<string>;
  private readonly takenSeq = new Map<string, Set<number>>();

  private readonly rDoc: SwDoc;
  private readonly rSrc: SwDoc;

  constructor(rDoc: SwDoc, rSrc: SwDoc) {
    this.rDoc = rDoc;
    this.rSrc = rSrc;
    this.takenFly = new Set(rDoc.GetFlyFormats().map((f) => f.name));
    this.takenSection = new Set(rDoc.GetSections().map((s) => s.m_pSection.m_sSectionName));
    const nodes = rDoc.GetNodes();
    for (let i = 0; i < nodes.Count(); i++) { const n = nodes.node(i); if (n.IsTableNode()) this.takenTable.add(n.GetTableNode()!.m_pTable.m_aAttrs.name); }
    this.takenAnn = new Set(rDoc.GetAnnotations().map((a) => a.field.id));
    this.takenTox = new Set<string>();
    for (const n of rDoc.allText()) {
      if (n.m_aSet.RES_PARATR_TOX_ID) this.takenTox.add(n.m_aSet.RES_PARATR_TOX_ID);
      for (const h of n.m_aHints) {
        const f = h.aAttrs.RES_TXTATR_FIELD;
        if (f?.type === 'Sequence' && f.seqNo !== undefined) this.seqSet(f.name ?? '').add(f.seqNo);
      }
    }
    // MarkManager::makeMark: a name that is taken gets "Copy N".
    const mm = rDoc.getIDocumentMarkAccess(), taken = new Set<string>();
    for (const m of rSrc.getIDocumentMarkAccess().m_vAllMarks) {
      const name = mm.getUniqueMarkName(m.GetName(), (n) => !mm.findMark(n) && !taken.has(n));
      taken.add(name);
      this.markNames.set(m.GetName(), name);
    }
  }

  private seqSet(name: string): Set<number> {
    let s = this.takenSeq.get(name);
    if (!s) this.takenSeq.set(name, (s = new Set()));
    return s;
  }

  private unique(taken: Set<string>, name: string, prefix: string): string {
    let n = name;
    for (let k = 1; !n || taken.has(n); k++) n = `${prefix}${k}`;
    taken.add(n);
    return n;
  }

  private footnoteId(id: string): string {
    let n = this.ftnIds.get(id);
    if (n === undefined) {
      const nodes = this.rDoc.GetNodes(), used = new Set(this.ftnIds.values());
      let k = 1;
      while (nodes.FindFootnoteSection(`ftn${k}`) || used.has(`ftn${k}`)) k++;
      this.ftnIds.set(id, (n = `ftn${k}`));
    }
    return n;
  }

  private annotationId(id: string): string {
    let n = this.annIds.get(id);
    if (n === undefined) this.annIds.set(id, (n = this.unique(this.takenAnn, '', 'c')));
    return n;
  }

  /** SwDoc::GetUniqueGrfName, GetUniqueFrameName, GetUniqueShapeName, GetUniqueOLEName for a taken name. */
  private flyName(name: string, fmt: { graphic?: string; m_pShape?: unknown; m_pMath?: unknown; shape?: unknown; math?: unknown; m_sContentId?: string }): string {
    let n = this.flyNames.get(name);
    if (n === undefined) {
      const prefix = fmt.m_pMath || fmt.math ? 'Object' : fmt.m_pShape || fmt.shape ? 'Shape' : fmt.m_sContentId !== undefined ? 'Frame' : 'Image';
      this.flyNames.set(name, (n = this.unique(this.takenFly, name, prefix)));
    }
    return n;
  }

  private graphic(key: string | undefined): string | undefined {
    if (key === undefined) return undefined;
    let n = this.graphics.get(key);
    const g = this.rSrc.m_aGraphics.get(key);
    if (n === undefined && g) this.graphics.set(key, (n = this.rDoc.AddGraphic(g.data, g.mime)));
    return n ?? key;
  }

  private seqNo(name: string, no: number): number {
    const key = `${name}\u0000${no}`;
    let n = this.seqNos.get(key);
    if (n === undefined) {
      const used = this.seqSet(name);
      n = 0;
      while (used.has(n)) n++;
      used.add(n);
      this.seqNos.set(key, n);
    }
    return n;
  }

  /** CopyLayoutFormat: the format under its new name, with its graphic, text and chain. */
  flyFormat(fmt: SwFlyFrameFormat): SwFlyFrameFormat {
    const name = this.flyName(fmt.m_aName, fmt);
    const out: SwFlyFrameFormat = { ...fmt, m_aName: name };
    if (fmt.graphic !== undefined) out.graphic = this.graphic(fmt.graphic);
    if (fmt.m_sContentId !== undefined) {
      const sec = this.rSrc.GetNodes().FindFlySection(fmt.m_sContentId);
      if (sec) { out.m_sContentId = name; this.flys.push({ src: sec, id: name }); } else delete out.m_sContentId;
    }
    // SwFormatChain: the frames chained to it by their new names.
    if (fmt.m_aChain) {
      const { m_sPrev, m_sNext } = fmt.m_aChain;
      out.m_aChain = { ...(m_sPrev ? { m_sPrev: this.flyName(m_sPrev, { m_sContentId: '' }) } : {}), ...(m_sNext ? { m_sNext: this.flyName(m_sNext, { m_sContentId: '' }) } : {}) };
    }
    return out;
  }

  private field(f: SwField): SwField {
    if (f.type === 'Sequence' && f.seqNo !== undefined) return { ...f, seqNo: this.seqNo(f.name ?? '', f.seqNo) };
    if (f.type !== 'GetRef' || f.name === undefined) return f;
    switch (f.subType ?? ReferencesSubtype.SetRefAttr) {
      case ReferencesSubtype.SequenceField: return f.seqNo !== undefined ? { ...f, seqNo: this.seqNo(f.name, f.seqNo) } : f;
      case ReferencesSubtype.Footnote: case ReferencesSubtype.Endnote: return { ...f, name: this.footnoteId(f.name) };
      case ReferencesSubtype.Style: return f;
      default: return { ...f, name: this.markNames.get(f.name) ?? f.name };
    }
  }

  /** The paragraph's attributes as this document names its lists, indexes and page styles. */
  private paraSet(set: SwAttrSet): SwAttrSet {
    const s = set;
    const rule = s.RES_PARATR_NUMRULE;
    if (rule) {
      const r = this.rSrc.FindNumRulePtr(rule);
      // An automatic list style (one of the content) is copied, renamed when the name is taken.
      if (r?.IsAutoRule()) {
        let n = this.numRules.get(rule);
        if (n === undefined) {
          n = this.rDoc.m_aNumRules.has(rule) ? this.rDoc.GetUniqueNumRuleName() : rule;
          this.rDoc.PutNumRule(r.Clone(n));
          this.numRules.set(rule, n);
        }
        s.RES_PARATR_NUMRULE = n;
      }
    }
    // XMLTextListsHelper::GenerateNewListId: a list of the inserted document is a new list.
    if (s.RES_PARATR_LIST_ID) {
      let n = this.listIds.get(s.RES_PARATR_LIST_ID);
      if (n === undefined) this.listIds.set(s.RES_PARATR_LIST_ID, (n = this.rDoc.CreateListId()));
      s.RES_PARATR_LIST_ID = n;
    }
    if (s.RES_PARATR_TOX_ID) {
      const old = s.RES_PARATR_TOX_ID;
      let n = this.toxIds.get(old);
      if (n === undefined) {
        n = this.unique(this.takenTox, this.takenTox.has(old) ? '' : old, 'Table of Contents');
        this.toxIds.set(old, n);
        const settings = this.rSrc.m_aTocSettings.get(old);
        if (settings) this.rDoc.m_aTocSettings.set(n, { ...settings });
      }
      s.RES_PARATR_TOX_ID = n;
    }
    // The page styles are not inserted (XMLTextMasterStylesContext in insert mode).
    if (s.RES_PAGEDESC && !this.rDoc.FindPageDesc(s.RES_PAGEDESC.name)) delete s.RES_PAGEDESC;
    return s;
  }

  private hint(a: SwCharAttrSet): SwCharAttrSet {
    const d = this.rDoc;
    if (a.RES_TXTATR_CHARFMT) { const f = d.FindCharFormatByName(a.RES_TXTATR_CHARFMT.GetName()); if (f) a.RES_TXTATR_CHARFMT = f; else delete a.RES_TXTATR_CHARFMT; }
    if (a.RES_TXTATR_INETFMT_CHARFMT) { const f = d.FindCharFormatByName(a.RES_TXTATR_INETFMT_CHARFMT.GetName()); if (f) a.RES_TXTATR_INETFMT_CHARFMT = f; else delete a.RES_TXTATR_INETFMT_CHARFMT; }
    if (a.RES_TXTATR_FTN) {
      const sec = this.rSrc.GetNodes().FindFootnoteSection(a.RES_TXTATR_FTN.id);
      const id = this.footnoteId(a.RES_TXTATR_FTN.id);
      if (sec) this.footnotes.push({ src: sec, id });
      a.RES_TXTATR_FTN = { ...a.RES_TXTATR_FTN, id };
    }
    if (a.RES_TXTATR_ANNOTATION) a.RES_TXTATR_ANNOTATION = { ...a.RES_TXTATR_ANNOTATION, id: this.annotationId(a.RES_TXTATR_ANNOTATION.id) };
    if (a.RES_TXTATR_ANNOTMARK) a.RES_TXTATR_ANNOTMARK = this.annotationId(a.RES_TXTATR_ANNOTMARK);
    if (a.RES_TXTATR_FLYCNT) {
      const c = a.RES_TXTATR_FLYCNT;
      a.RES_TXTATR_FLYCNT = { ...c, name: this.flyName(c.name, c), graphic: c.graphic ? this.graphic(c.graphic)! : c.graphic };
    }
    if (a.RES_TXTATR_FIELD) a.RES_TXTATR_FIELD = this.field(a.RES_TXTATR_FIELD);
    return a;
  }

  /** Snapshots of the source nodes [first, last], as this document is to hold them. */
  Snap(first: number, last: number, startId?: { footnote?: string; fly?: string }): NodeSnap[] {
    const nodes = this.rSrc.GetNodes(), d = this.rDoc;
    const out: NodeSnap[] = [];
    const standard = d.FindTextFormatCollByName('Standard')!;
    for (let i = first; i <= last; i++) {
      const n: SwNode = nodes.node(i);
      const s = snap(n);
      if (s.t === 'text') {
        this.copied.push(n as SwTextNode);
        s.coll = d.FindTextFormatCollByName(s.coll.GetName()) ?? standard;
        s.set = this.paraSet(s.set);
        s.hints = s.hints.map((h) => ({ ...h, aAttrs: this.hint(h.aAttrs) }));
        s.flys = s.flys.map((f): SwAnchoredFly => ({ fmt: this.flyFormat(f.fmt), nContent: f.nContent }));
      } else if (s.t === 'table') {
        s.table.attrs.name = this.unique(this.takenTable, s.table.attrs.name, 'Table');
        if (s.table.attrs.pageDesc && !d.FindPageDesc(s.table.attrs.pageDesc.name)) delete s.table.attrs.pageDesc;
      } else if (s.t === 'section') {
        s.data.m_sSectionName = this.unique(this.takenSection, s.data.m_sSectionName, 'Section');
      } else if (s.t === 'start' && i === first && startId) {
        if (startId.footnote !== undefined) s.footnote = startId.footnote;
        if (startId.fly !== undefined) s.fly = startId.fly;
      }
      out.push(s);
    }
    return out;
  }
}

/**
 * SwXMLImport::MergeListsAtDocumentInsertPosition (tdf#113877): when the paragraph before the
 * inserted content and the first inserted one after it are in lists of the same list style (or
 * of list styles alike on every level), the inserted paragraphs of that list continue the list
 * of the document.
 */
function MergeListsAtDocumentInsertPosition(pDoc: SwDoc, node1: SwTextNode): void {
  const nodes = pDoc.GetNodes();
  let index = 1;
  let node2: SwNode | null = nodes.node(node1.GetIndex() + index);
  if (!node2?.IsTextNode()) return;
  const sListId1 = node1.m_aSet.RES_PARATR_LIST_ID, sListId2Initial = node2.m_aSet.RES_PARATR_LIST_ID;
  if (!sListId1 || !sListId2Initial) return;
  const sName1 = node1.m_aSet.RES_PARATR_NUMRULE ?? '', sName2 = node2.m_aSet.RES_PARATR_NUMRULE ?? '';
  if (sName1 !== sName2) {
    const pNumRule1 = pDoc.FindNumRulePtr(sName1), pNumRule2 = pDoc.FindNumRulePtr(sName2);
    if (!pNumRule1 || !pNumRule2) return;
    // check style of the each list level
    for (let n = 0; n < MAXLEVEL; ++n) if (!same(pNumRule1.Get(n), pNumRule2.Get(n))) return;
  }
  // merge two lists
  while (node2?.IsTextNode()) {
    const sListId2 = node2.m_aSet.RES_PARATR_LIST_ID;
    // no more list items of the first list inside inserted document
    if (!sListId2 || sListId2 !== sListId2Initial) return;
    node2.m_aSet.RES_PARATR_LIST_ID = sListId1;
    node2.m_nVersion++;
    index++;
    if (node1.GetIndex() + index >= nodes.Count()) return;
    node2 = nodes.node(node1.GetIndex() + index);
  }
}

/**
 * SwReader::Read with a cursor: inserts the content of `rSrc`, a document an importer has read,
 * at the point of `rPam` (which has no selection), as one undo step with the styles it brings.
 * Afterwards the point is at the end of the inserted content.
 */
export function SwReader_Read(rDoc: SwDoc, rPam: SwPaM, rSrc: SwDoc): void {
  const nUndo = rDoc.m_aUndo.length;
  // The styles the document lacks (the styles of an import in insert mode never overwrite).
  rDoc.LoadStyles(rPam, rSrc, { bText: true, bPage: false, bNum: true, bOverwrite: false });
  for (const t of rSrc.m_aUserFieldTypes.values()) {
    if (rDoc.m_aUserFieldTypes.has(t.GetName())) continue;
    rDoc.InsertFieldType(Object.assign(new SwUserFieldType(t.GetName()), t));
  }
  for (const t of rSrc.m_aSetExpFieldTypes.values()) {
    if (!rDoc.m_aSetExpFieldTypes.has(t.GetName())) rDoc.InsertFieldType(new SwSetExpFieldType(t.GetName(), t.GetType()));
  }
  const nodes = rDoc.GetNodes(), srcNodes = rSrc.GetNodes();
  const pt = rPam.GetPoint();
  const ranges: [number, number][] = [
    [nodes.GetEndOfInserts().GetIndex(), nodes.GetEndOfInserts().GetIndex() - 1],
    [nodes.GetEndOfAutotext().GetIndex(), nodes.GetEndOfAutotext().GetIndex() - 1],
    [pt.GetNodeIndex(), pt.GetNodeIndex()],
  ];
  rDoc.recordedRanges('insert-doc', rPam, ranges, () => {
    rPam.DeleteMark();
    const cx = new CopyContext(rDoc, rSrc);
    // SwXMLImport::startDocument: split once and remember the node that has been split.
    const pTextNode = pt.GetNode();
    const pNext = pTextNode.SplitContentNode(pt.GetContentIndex());
    // The end of the inserted content, before the text that followed the cursor.
    const aEnd = new SwPosition(pNext, 0);

    // The content, then the footnote and text frame sections it refers to (which may refer to more).
    const built: { srcs: SwTextNode[]; texts: SwTextNode[] }[] = [];
    const build = (at: () => number, make: () => NodeSnap[]) => {
      const from = cx.copied.length;
      const snaps = make();
      built.push({ srcs: cx.copied.slice(from), texts: rDoc.BuildNodes(at(), snaps) });
    };
    build(() => pNext.GetIndex(), () => cx.Snap(srcNodes.BodyStart(), srcNodes.GetEndOfContent().GetIndex() - 1));
    for (const f of rSrc.m_aPageFlys) rDoc.m_aPageFlys.push(cx.flyFormat(f));
    for (let nFootnote = 0, nFly = 0; nFootnote < cx.footnotes.length || nFly < cx.flys.length;) {
      if (nFootnote < cx.footnotes.length) {
        const q = cx.footnotes[nFootnote++]!;
        build(() => nodes.GetEndOfInserts().GetIndex(), () => cx.Snap(q.src.GetIndex(), q.src.EndOfSectionNode().GetIndex(), { footnote: q.id }));
      } else {
        const q = cx.flys[nFly++]!;
        build(() => nodes.GetEndOfAutotext().GetIndex(), () => cx.Snap(q.src.GetIndex(), q.src.EndOfSectionNode().GetIndex(), { fly: q.id }));
      }
    }

    // The marks of the copied text, before the joins move them.
    const map = new Map<SwTextNode, SwTextNode>();
    for (const b of built) b.srcs.forEach((s, i) => map.set(s, b.texts[i]!));
    const mm = rDoc.getIDocumentMarkAccess();
    for (const m of rSrc.getIDocumentMarkAccess().m_vAllMarks) {
      const n1 = map.get(m.GetMarkPos().GetNode()), n2 = m.IsExpanded() ? map.get(m.GetOtherMarkPos().GetNode()) : n1;
      if (!n1 || !n2) continue;
      const p1 = new SwPosition(n1, m.GetMarkPos().GetContentIndex()), p2 = new SwPosition(n2, m.IsExpanded() ? m.GetOtherMarkPos().GetContentIndex() : p1.GetContentIndex());
      mm.makeMark({ GetPoint: () => p1, GetMark: () => p2, HasMark: () => m.IsExpanded() }, cx.markNames.get(m.GetName()) ?? m.GetName(), m.m_eType);
      p1.Release(); p2.Release();
    }

    // SwXMLImport::endDocAdjustNodes: join the split node that is in front of the new content
    // with the first new node.
    const pDelNd = nodes.node(pTextNode.GetIndex() + 1);
    if (pDelNd.IsTextNode() && pDelNd !== pNext) {
      // If the first new node isn't empty, convert the node's text attributes into hints.
      // Otherwise, set the new node's paragraph style at the previous (empty) node.
      if (pTextNode.GetText()) FormatToTextAttr(pDelNd, pTextNode);
      else {
        for (const [k] of charItems(pTextNode)) delete (pTextNode.m_aSet as Record<string, unknown>)[k];
        pTextNode.m_pColl = pDelNd.GetTextColl();
        // MergeListsAtDocumentInsertPosition() will deal with lists below, copy paragraph
        // direct formatting otherwise.
        if (!pDelNd.m_aSet.RES_PARATR_LIST_ID) pTextNode.m_aSet = structuredClone(pDelNd.m_aSet);
      }
      pTextNode.JoinNext();
    }
    // In insert mode the text after the cursor is joined with the last new paragraph, which gives
    // it its paragraph style, unless the content ends with a table or section.
    const pLastPar = nodes.node(pNext.GetIndex() - 1);
    if (pLastPar.IsTextNode() && pLastPar.m_pStartOfSection === pNext.m_pStartOfSection) {
      FormatToTextAttr(pLastPar, pNext);
      pLastPar.m_aSet = pNext.m_aSet;
      pLastPar.JoinNext();
    }
    pTextNode.m_nVersion++;
    MergeListsAtDocumentInsertPosition(rDoc, pTextNode);

    pt.Assign(aEnd.GetNode(), aEnd.GetContentIndex());
    rPam.DeleteMark();
    aEnd.Release();
  });
  while (rDoc.m_aUndo.length > nUndo + 1) rDoc.MergeLastUndo();
}
