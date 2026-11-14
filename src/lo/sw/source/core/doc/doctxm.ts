// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/core/doc/doctxm.cxx partial
// @upstream sw/source/core/doc/DocumentContentOperationsManager.cxx partial
// SwDoc's index marks: iterating them, the keys of the alphabetical index, the marks at a
// position, inserting (InsertPoolItem of an SwTOXMark), deleting and travelling between them, and
// the index types. The marks are RES_TXTATR_TOXMARK on their text (see tox.ts); a mark's position
// is the first run that carries it. GotoTOXMark orders marks at the same position by document
// order instead of by their addresses in memory.
import { CH_TXTATR_BREAKWORD } from '../../../inc/hintids.ts';
import type { SwDoc } from '../../../inc/doc.ts';
import type { SwPaM, SwPosition } from '../../../inc/pam.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';
import { SwTOXMark, SwTOXType } from '../../../inc/tox.ts';
import { SwTOIKeyType, SwTOXSearch, TOXTypes } from '../../../inc/toxe.ts';

/** Where a mark is: its paragraph, its start and end (start + 1 for a mark with an alternative text). */
export interface SwTextTOXMark { pMark: SwTOXMark; pTextNd: SwTextNode; nStart: number; nEnd: number }

/** The marks of one paragraph, in the order of their start. */
export function GetTextTOXMarks(pTextNd: SwTextNode): SwTextTOXMark[] {
  const out = new Map<SwTOXMark, SwTextTOXMark>();
  for (const h of pTextNd.m_aHints) {
    for (const m of h.aAttrs.RES_TXTATR_TOXMARK ?? []) {
      const got = out.get(m);
      if (got) got.nEnd = Math.max(got.nEnd, h.nEnd);
      else out.set(m, { pMark: m, pTextNd, nStart: h.nStart, nEnd: h.nEnd });
    }
  }
  return [...out.values()].sort((a, b) => a.nStart - b.nStart);
}

/** Iterate over all SwTOXMark, if the function returns false, iteration is stopped */
export function ForEachTOXMark(rDoc: SwDoc, rFunc: (rTextMark: SwTextTOXMark) => boolean): void {
  const nodes = rDoc.GetNodes();
  for (let i = 0; i < nodes.Count(); ++i) {
    const pNode = nodes.node(i);
    if (!pNode.IsTextNode() || !pNode.m_aHints.length) continue;
    for (const m of GetTextTOXMarks(pNode)) if (!rFunc(m)) return;
  }
}

/** SwTOXMark::GetTextTOXMark: where the mark is in the document, or null. */
export function FindTextTOXMark(rDoc: SwDoc, pMark: SwTOXMark): SwTextTOXMark | null {
  let found: SwTextTOXMark | null = null;
  ForEachTOXMark(rDoc, (m) => { if (m.pMark === pMark) found = m; return !found; });
  return found;
}

/** SwTOXMark::GetText with the mark's text in the document. */
export function GetTOXMarkText(rDoc: SwDoc, pMark: SwTOXMark): string {
  const t = FindTextTOXMark(rDoc, pMark);
  return pMark.GetText(t?.pTextNd.GetText(), t?.nStart, t?.nEnd);
}

export function GetTOIKeys(rDoc: SwDoc, eTyp: SwTOIKeyType): string[] {
  const rArr: string[] = [];
  // Look up all Primary and Secondary via the Pool
  ForEachTOXMark(rDoc, ({ pMark: rItem }) => {
    const pTOXType = rItem.GetTOXType();
    if (pTOXType.GetType() !== TOXTypes.TOX_INDEX) return true;
    const sStr = SwTOIKeyType.TOI_PRIMARY === eTyp ? rItem.GetPrimaryKey() : rItem.GetSecondaryKey();
    if (sStr) rArr.push(sStr);
    return true;
  });
  return rArr;
}

/** Get current table of contents Mark. */
export function GetCurTOXMark(rPos: SwPosition): SwTOXMark[] {
  const rArr: SwTOXMark[] = [];
  // search on Position rPos for all SwTOXMarks
  const pTextNd = rPos.GetNode();
  if (!pTextNd?.IsTextNode() || !pTextNd.m_aHints.length) return rArr;
  const nCurrentPos = rPos.GetContentIndex();
  for (const pHt of GetTextTOXMarks(pTextNd)) {
    const nSttIdx = pHt.nStart;
    if (nSttIdx < nCurrentPos) {
      // also check the end
      if (pHt.pMark.IsAlternativeText() || pHt.nEnd <= nCurrentPos) continue; // keep searching
    } else if (nSttIdx > nCurrentPos) {
      // If Hint's Start is greater than rPos, break, because
      // the attributes are sorted by Start!
      break;
    }
    rArr.push(pHt.pMark);
  }
  return rArr;
}

/** The marks of [nStart, nEnd) of a paragraph with `pMark` added to (or, when null, `pOld` taken from) each run. */
export function SetMarks(pTextNd: SwTextNode, nStart: number, nEnd: number, pMark: SwTOXMark | null, pOld: SwTOXMark | null): void {
  const cuts = new Set([nStart, nEnd]);
  for (const h of pTextNd.m_aHints) for (const c of [h.nStart, h.nEnd]) if (c > nStart && c < nEnd) cuts.add(c);
  const sorted = [...cuts].sort((a, b) => a - b);
  for (let i = 0; i + 1 < sorted.length; i++) {
    const s = sorted[i]!, e = sorted[i + 1]!;
    const have = (pTextNd.GetCharAttrAt('RES_TXTATR_TOXMARK', s) ?? []).filter((m) => m !== pOld);
    const marks = pMark ? [...have, pMark] : have;
    if (marks.length) pTextNd.SetAttr(s, e, { RES_TXTATR_TOXMARK: marks });
    else pTextNd.ResetAttr(s, e, ['RES_TXTATR_TOXMARK']);
  }
}

/**
 * SwEditShell::Insert(const SwTOXMark&) and DocumentContentOperationsManager::InsertPoolItem for
 * each range: a mark with an alternative text is inserted at the start of each range on a
 * placeholder character; one without marks each non-empty range (up to the end of its first
 * paragraph). Every range gets a copy of the mark of its own. Returns the marks inserted.
 */
export function InsertTOXMark(rDoc: SwDoc, pam: SwPaM, rMark: SwTOXMark, aRanges?: { node: SwTextNode; nStart: number; nEnd: number }[]): SwTOXMark[] {
  const bInsAtPos = rMark.IsAlternativeText();
  const ranges = aRanges ?? (() => {
    const s = pam.Start(), e = pam.End();
    return [{ node: s.GetNode(), nStart: s.GetContentIndex(), nEnd: e.GetNode() === s.GetNode() ? e.GetContentIndex() : s.GetNode().Len() }];
  })();
  const todo = ranges.filter((r) => bInsAtPos || r.nEnd > r.nStart);
  if (!todo.length) return [];
  const idx = todo.map((r) => r.node.GetIndex());
  const out: SwTOXMark[] = [];
  rDoc.recorded('toxmark', pam, Math.min(...idx), Math.max(...idx), () => {
    // From the end, so that the placeholders do not move the ranges still to come.
    for (const r of [...todo].sort((a, b) => b.node.GetIndex() - a.node.GetIndex() || b.nStart - a.nStart)) {
      const pMark = out.length ? rMark.Clone() : rMark;
      out.push(pMark);
      if (bInsAtPos) {
        // Inside a marked text, the placeholder belongs to the marks around it too.
        r.node.InsertText(CH_TXTATR_BREAKWORD, r.nStart);
        r.node.SetAttr(r.nStart, r.nStart + 1, { RES_TXTATR_TOXMARK: [...(r.node.GetCharAttrAt('RES_TXTATR_TOXMARK', r.nStart) ?? []), pMark] });
      } else SetMarks(r.node, r.nStart, r.nEnd, pMark, null);
    }
  });
  return out.reverse();
}

/** Delete table of contents Mark */
export function DeleteTOXMark(rDoc: SwDoc, pam: SwPaM, pTOXMark: SwTOXMark): void {
  const pTextTOXMark = FindTextTOXMark(rDoc, pTOXMark);
  if (!pTextTOXMark) return;
  const rTextNd = pTextTOXMark.pTextNd;
  rDoc.recorded('toxmark-delete', pam, rTextNd.GetIndex(), rTextNd.GetIndex(), () => {
    if (pTOXMark.IsAlternativeText()) rTextNd.EraseText(pTextTOXMark.nStart, 1);
    else SetMarks(rTextNd, pTextTOXMark.nStart, pTextTOXMark.nEnd, null, pTOXMark);
  });
}

/** Replaces a mark by a changed copy of it, where it is (SwTOXMgr::UpdateTOXMark changes it in place). */
export function ReplaceTOXMark(rDoc: SwDoc, pam: SwPaM, pOld: SwTOXMark, pNew: SwTOXMark): void {
  const t = FindTextTOXMark(rDoc, pOld);
  if (!t) return;
  rDoc.recorded('toxmark', pam, t.pTextNd.GetIndex(), t.pTextNd.GetIndex(), () => {
    for (const h of t.pTextNd.m_aHints) {
      const marks = h.aAttrs.RES_TXTATR_TOXMARK;
      if (marks?.includes(pOld)) h.aAttrs = { ...h.aAttrs, RES_TXTATR_TOXMARK: marks.map((m) => (m === pOld ? pNew : m)) };
    }
    t.pTextNd.m_nVersion++;
  });
}

/** Travel between table of content Marks */
export function GotoTOXMark(rDoc: SwDoc, rCurTOXMark: SwTOXMark, eDir: SwTOXSearch): SwTOXMark {
  const pType = rCurTOXMark.GetTOXType();
  const aMarks: SwTextTOXMark[] = [];
  ForEachTOXMark(rDoc, (m) => { if (m.pMark.GetTOXType() === pType) aMarks.push(m); return true; });
  const nCur = aMarks.findIndex((m) => m.pMark === rCurTOXMark);
  if (nCur < 0) return rCurTOXMark;
  const text = (m: SwTextTOXMark) => m.pMark.GetText(m.pTextNd.GetText(), m.nStart, m.nEnd);
  const sCur = text(aMarks[nCur]!);
  const bSame = eDir === SwTOXSearch.TOX_SAME_NXT || eDir === SwTOXSearch.TOX_SAME_PRV;
  const nStep = eDir === SwTOXSearch.TOX_NXT || eDir === SwTOXSearch.TOX_SAME_NXT ? 1 : -1;
  for (let i = nCur + nStep; i >= 0 && i < aMarks.length; i += nStep) {
    if (bSame && text(aMarks[i]!) !== sCur) continue;
    return aMarks[i]!.pMark;
  }
  // We couldn't find a successor
  return rCurTOXMark;
}

export function GetTOXTypeCount(rDoc: SwDoc, eTyp: TOXTypes): number {
  return rDoc.m_pTOXTypes.filter((t) => t.GetType() === eTyp).length;
}

export function GetTOXType(rDoc: SwDoc, eTyp: TOXTypes, nId: number): SwTOXType | null {
  return rDoc.m_pTOXTypes.filter((t) => t.GetType() === eTyp)[nId] ?? null;
}

export function InsertTOXType(rDoc: SwDoc, rTyp: SwTOXType): SwTOXType {
  rDoc.m_pTOXTypes.push(rTyp);
  return rTyp;
}

/** SwTOXMgr::GetUserTypeID: the user-defined index of that name, created when missing. */
export function GetUserTOXType(rDoc: SwDoc, rStr: string): SwTOXType {
  const got = rDoc.m_pTOXTypes.find((t) => t.GetType() === TOXTypes.TOX_USER && t.GetTypeName() === rStr);
  return got ?? InsertTOXType(rDoc, new SwTOXType(TOXTypes.TOX_USER, rStr));
}
