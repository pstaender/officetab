// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/core/doc/list.cxx reduced
// @upstream sw/source/core/SwNumberTree/SwNumberTree.cxx reduced
// @upstream sw/source/core/SwNumberTree/SwNodeNum.cxx reduced
// Upstream keeps a number tree per list and updates it incrementally. Here the counters are
// recomputed in one pass in document order, with the same results for counted, uncounted,
// restarted and phantom (skipped-level) entries. Phantoms are counted, as mbCountPhantoms is
// true for every rule Writer creates.
import { MAXLEVEL, type SwNumFormat, type SwNumRule } from '../../../inc/numrule.ts';
import type { SwDoc } from '../../../inc/doc.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';

/** What the layout needs of a paragraph's list membership (SwNodeNum plus its rule's format). */
export interface SwNodeNum {
  rule: SwNumRule;
  level: number;
  fmt: SwNumFormat;
  counted: boolean;
  /** The label: the expanded number string or the bullet; '' when not counted. */
  label: string;
  /** A footnote's number in the footnote area (SwFootnoteNumPortion) instead of a list label. */
  footnote?: boolean;
}

/** SwTextNode::GetListId: a paragraph without an explicit list belongs to its rule's default list. */
export const GetListId = (n: SwTextNode): string => n.GetAttr('RES_PARATR_LIST_ID') || `rule:${n.GetAttr('RES_PARATR_NUMRULE')}`;

export function GetActualListLevel(n: SwTextNode): number {
  return Math.max(0, Math.min(MAXLEVEL - 1, n.GetAttr('RES_PARATR_LIST_LEVEL')));
}

/** Numbers every list paragraph of `paras`, which must be in document order. */
export function NumberParagraphs(doc: SwDoc, paras: Iterable<SwTextNode>): Map<SwTextNode, SwNodeNum> {
  const out = new Map<SwTextNode, SwNodeNum>();
  const lists = new Map<string, (number | undefined)[]>();
  for (const n of paras) {
    const rule = doc.FindNumRulePtr(n.GetAttr('RES_PARATR_NUMRULE'));
    if (!rule) continue;
    const level = GetActualListLevel(n);
    const id = GetListId(n);
    let counters = lists.get(id);
    if (!counters) { counters = []; lists.set(id, counters); }
    const counted = n.GetAttr('RES_PARATR_LIST_ISCOUNTED');
    // A new entry ends every deeper level: their next entries start again.
    counters.length = Math.min(counters.length, level + 1);
    // Phantoms for skipped upper levels count with their start value.
    for (let l = 0; l < level; l++) counters[l] ??= rule.Get(l).GetStart();
    if (counted) {
      if (n.GetAttr('RES_PARATR_LIST_ISRESTART')) {
        const v = n.GetAttr('RES_PARATR_LIST_RESTARTVALUE');
        counters[level] = v >= 0 ? v : rule.Get(level).GetStart();
      } else {
        const prev = counters[level];
        counters[level] = prev === undefined ? rule.Get(level).GetStart() : prev + 1;
      }
    }
    const fmt = rule.Get(level);
    let label = '';
    if (counted) {
      if (fmt.IsItemize()) label = fmt.GetBulletChar();
      else label = rule.MakeNumString(counters.slice(0, level + 1).map((c) => c ?? 0));
    }
    out.set(n, { rule, level, fmt, counted, label });
  }
  return out;
}
