// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/core/doc/docsort.cxx reduced
// @upstream sw/inc/sortopt.hxx reduced
// SwDoc::SortTable: the rows (or columns) of a rectangle of boxes, sorted by up to three keys, move
// their boxes' content to the new order. The flat box array (FlatFndBox) is the rectangle; a
// selection with merged cells is not symmetric and is refused, as upstream. Keys are compared as
// numbers (the box text read as a number; box values and number formats are not ported) or with
// the browser's collator for the document language, instead of i18npool's collator algorithms.
// Not ported: sorting text outside tables (SortText) and deleting tracked changes first.
import type { SwDoc } from '../../../inc/doc.ts';
import type { SwPaM } from '../../../inc/pam.ts';
import type { SwNode, SwTableNode } from '../../../inc/node.ts';
import type { SwTableBox } from '../../../inc/swtable.ts';

export const SwSortOrder = { Ascending: 0, Descending: 1 } as const;
export type SwSortOrder = (typeof SwSortOrder)[keyof typeof SwSortOrder];
export const SwSortDirection = { Columns: 0, Rows: 1 } as const;
export type SwSortDirection = (typeof SwSortDirection)[keyof typeof SwSortDirection];

export interface SwSortKey { nColumnId: number; bIsNumeric: boolean; eSortOrder: SwSortOrder }
export interface SwSortOptions { aKeys: SwSortKey[]; eDirection: SwSortDirection; bIgnoreCase: boolean; nLanguage: string }

/** SwSortElement::StrToDouble: the number at the start of the text in the locale's notation, else 0. */
export function StrToDouble(rStr: string, locale: string): number {
  const dec = (1.5).toLocaleString(locale).replace(/\d/g, '') || '.';
  const group = (1000).toLocaleString(locale).replace(/\d/g, '');
  let s = rStr.trim();
  if (group) s = s.split(group).join('');
  if (dec !== '.') s = s.replace(dec, '.');
  const m = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s);
  return m ? Number(m[0]) : 0;
}

/** SwSortBoxElement::GetKey: the text of a box's paragraphs. */
function boxText(doc: SwDoc, box: SwTableBox): string {
  const nodes = doc.GetNodes(), sn = box.m_pStartNode!;
  let out = '';
  for (let i = sn.GetIndex() + 1; i < sn.EndOfSectionNode().GetIndex(); i++) { const n = nodes.node(i); if (n.IsTextNode()) out += n.GetText(); }
  return out;
}

/** FlatFndBox: the boxes of the rectangle by row; null when its rows differ in length or cells are merged. */
function FlatFndBox(rBoxes: SwTableBox[]): SwTableBox[][] | null {
  const rows: SwTableBox[][] = [];
  for (const b of rBoxes) {
    if (b.getRowSpan() !== 1) return null;
    const last = rows[rows.length - 1];
    if (last && last[0]!.m_pUpper === b.m_pUpper) last.push(b); else rows.push([b]);
  }
  if (!rows.length || rows.some((r) => r.length !== rows[0]!.length)) return null; // IsSymmetric
  return rows;
}

export function SortTable(doc: SwDoc, pam: SwPaM, rBoxes: SwTableBox[], rOpt: SwSortOptions): boolean {
  const flat = FlatFndBox(rBoxes);
  if (!flat || !rOpt.aKeys.length) return false;
  const table = rBoxes[0]!.m_pStartNode!.m_pStartOfSection;
  if (!table?.IsTableNode()) return false;
  const tab = (table as SwTableNode).m_pTable;
  const byRows = rOpt.eDirection === SwSortDirection.Rows;
  // A grid of positions: byRows sorts the rows, else the columns.
  const nCount = byRows ? flat.length : flat[0]!.length;
  const at = (elem: number, key: number) => (byRows ? flat[elem]![key] : flat[key]![elem]);
  // When sorting, do not include the first row if the HeaderLine is repeated
  let nStart = 0;
  if (tab.GetRowsToRepeat() > 0 && byRows) {
    while (nStart < flat.length && tab.m_aLines.indexOf(flat[nStart]![0]!.m_pUpper) < tab.GetRowsToRepeat()) nStart++;
    // Are all selected in the HeaderLine?  -> no Offset
    if (nStart === flat.length) nStart = 0;
  }
  const collator = new Intl.Collator(rOpt.nLanguage || undefined, { sensitivity: rOpt.bIgnoreCase ? 'accent' : 'variant', caseFirst: 'upper' });
  /** SwSortElement::keycompare */
  const keycompare = (a: number, b: number, nKey: number): number => {
    const rSrtKey = rOpt.aKeys[nKey]!;
    const [pOrig, pCmp] = rSrtKey.eSortOrder === SwSortOrder.Ascending ? [a, b] : [b, a];
    const col = rSrtKey.nColumnId - 1;
    const ka = at(pOrig, col), kb = at(pCmp, col);
    const ta = ka ? boxText(doc, ka) : '', tb = kb ? boxText(doc, kb) : '';
    if (rSrtKey.bIsNumeric) {
      const n1 = StrToDouble(ta, rOpt.nLanguage), n2 = StrToDouble(tb, rOpt.nLanguage);
      return n1 < n2 ? -1 : n1 === n2 ? 0 : 1;
    }
    return collator.compare(ta, tb);
  };
  // std::multiset: equal elements keep their order.
  const order: number[] = [];
  for (let i = nStart; i < nCount; ++i) order.push(i);
  order.sort((a, b) => {
    for (let nKey = 0; nKey < rOpt.aKeys.length; ++nKey) { const c = keycompare(a, b, nKey); if (c) return c; }
    return a - b;
  });
  if (order.every((v, i) => v === i + nStart)) return true;
  return doc.SetTableAttr(pam, () => {
    const nodes = doc.GetNodes();
    // MoveRow / MoveCol: every box of the target row (column) takes the content of the source's.
    const content = new Map<SwTableBox, SwNode[]>();
    const all = flat.flat();
    for (const box of all) {
      const sn = box.m_pStartNode!, s = sn.GetIndex() + 1, n = sn.EndOfSectionNode().GetIndex() - s;
      const list: SwNode[] = [];
      for (let i = 0; i < n; i++) list.push(nodes.node(s + i));
      content.set(box, list);
    }
    const starts = new Set(all.map((b) => b.m_pStartNode));
    const target = new Map<SwTableBox, SwNode[]>();
    const nOther = byRows ? flat[0]!.length : flat.length;
    order.forEach((src, k) => {
      for (let j = 0; j < nOther; j++) target.set(byRows ? flat[k + nStart]![j]! : flat[j]![k + nStart]!, content.get(byRows ? flat[src]![j]! : flat[j]![src]!)!);
    });
    for (const box of all) {
      if (!target.has(box)) continue;
      const sn = box.m_pStartNode!;
      nodes.Remove(sn.GetIndex() + 1, content.get(box)!.length);
    }
    for (const box of all) {
      const list = target.get(box);
      if (!list) continue;
      const sn = box.m_pStartNode!;
      list.forEach((n, k) => {
        if (n.m_pStartOfSection && starts.has(n.m_pStartOfSection)) n.m_pStartOfSection = sn;
        nodes.Insert(n, sn.GetIndex() + 1 + k);
      });
    }
  });
}
