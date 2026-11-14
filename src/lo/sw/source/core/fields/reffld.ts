// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/core/fields/reffld.cxx reduced
// @upstream sw/inc/reffld.hxx partial
// @upstream sw/inc/reffldsubtype.hxx faithful
// SwGetRefField (Insert > Cross-reference): finding what a reference refers to (FindAnchor) and
// expanding it (UpdateField, MakeRefNumStr), with the number string of a referred list paragraph
// (SwNumRule::MakeRefNumString). Reduced: the layout supplies the page of a position and list
// numbering through SwRefContext; "Above/Below" compares document order instead of the frames'
// positions (IsFrameBehind); a footnote is referred to by its id instead of its sequence number;
// style references (ReferencesSubtype::Style, STYLEREF), hidden redlines and the reference
// language (lcl_formatReferenceLanguage) are not ported. Reference marks are kept as marks
// (MarkType.REFMARK), not as text attributes.
import { SwDoc } from '../../../inc/doc.ts';
import type { SwField } from '../../../inc/hintids.ts';
import { CH_TXTATR_BREAKWORD } from '../../../inc/hintids.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';
import { MAXLEVEL, type SwNumRule } from '../../../inc/numrule.ts';
import { NumberingType, makeNumberingString } from '../../../../i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';
import { MarkType } from '../doc/docbm.ts';
import type { SwNodeNum } from '../doc/list.ts';

/** ReferencesSubtype (reffldsubtype.hxx) */
export const ReferencesSubtype = { SetRefAttr: 0, SequenceField: 1, Bookmark: 2, Outline: 3, Footnote: 4, Endnote: 5, Style: 6 } as const;
export type ReferencesSubtype = (typeof ReferencesSubtype)[keyof typeof ReferencesSubtype];

/** RefFieldFormat */
export const RefFieldFormat = {
  Page: 0, Chapter: 1, Content: 2, UpDown: 3, AsPageStyle: 4, CategoryAndNumber: 5, CaptionText: 6, Numbering: 7,
  Number: 8, NumberNoContext: 9, NumberFullContext: 10,
} as const;
export type RefFieldFormat = (typeof RefFieldFormat)[keyof typeof RefFieldFormat];

/** STR_GETREFFLD_REFITEMNOTFOUND */
export const aGetRefField_RefItemNotFound = 'Error: Reference source not found';

/** What expanding a reference needs from the layout. */
export interface SwRefContext {
  /** The page a position is on: its virtual number and its style's numbering type, or null. */
  pageOf(node: SwTextNode, nPos: number): { nVirtNum: number; nNumType: number } | null;
  /** The list numbering of the last layout (SwTextNode::GetNum). */
  nums: Map<SwTextNode, SwNodeNum>;
  /** The number range fields' numbers (SwSetExpField::GetValue). */
  seqNums: Map<SwField, number>;
  /** The footnotes' and endnotes' numbers by id (SwFormatFootnote::GetViewNumStr). */
  footnoteNum(id: string): string;
}

/** SwGetRefField::m_sText: the expansion of the last update (SwGetRefField::SetExpand). */
const m_sText = new WeakMap<SwField, string>();
export function SetExpand(f: SwField, rStr: string): void { m_sText.set(f, rStr); }
/** SwGetRefField::ExpandImpl: the text of the last update, if it was updated. */
export function GetExpand(f: SwField): string | undefined { return m_sText.get(f); }

/** The text node of a footnote or endnote's first paragraph. */
function lcl_FootnoteText(doc: SwDoc, id: string): SwTextNode | null {
  const nodes = doc.GetNodes();
  const sec = nodes.FindFootnoteSection(id);
  const n = sec && nodes.GoNext(sec.GetIndex());
  return n && n.GetIndex() < sec.EndOfSectionNode().GetIndex() ? n : null;
}

/** Every text node with its index, body first (as SwSetExpFieldType::GatherFields finds them). */
function* lcl_AllText(doc: SwDoc): Generator<SwTextNode> {
  const nodes = doc.GetNodes();
  for (let n = nodes.GoNext(0); n; n = nodes.GoNext(n.GetIndex())) yield n;
}

/** SwGetRefFieldType::FindAnchor: the paragraph referred to and the position (and end) in it. */
export function FindAnchor(pDoc: SwDoc, rRefMark: string, nSubType: number, nSeqNo: number): { pTextNd: SwTextNode; nStart: number; nEnd: number } | null {
  switch (nSubType) {
    case ReferencesSubtype.SetRefAttr: {
      const pRef = pDoc.getIDocumentMarkAccess().getRefMarks().find((m) => m.GetName() === rRefMark);
      if (!pRef) return null;
      const s = pRef.GetMarkStart(), e = pRef.GetMarkEnd();
      return { pTextNd: s.GetNode(), nStart: s.GetContentIndex(), nEnd: e.GetNode() === s.GetNode() ? e.GetContentIndex() : s.GetNode().Len() };
    }
    case ReferencesSubtype.SequenceField: {
      for (const n of lcl_AllText(pDoc)) for (const h of n.m_aHints) {
        const f = h.aAttrs.RES_TXTATR_FIELD;
        if (f?.type === 'Sequence' && f.name === rRefMark && f.seqNo === nSeqNo) return { pTextNd: n, nStart: h.nStart, nEnd: h.nStart + 1 };
      }
      return null;
    }
    case ReferencesSubtype.Bookmark: {
      const pBkmk = pDoc.getIDocumentMarkAccess().findMark(rRefMark);
      if (!pBkmk || pBkmk.m_eType === MarkType.REFMARK) return null;
      const pPos = pBkmk.GetMarkStart();
      const pTextNd = pPos.GetNode();
      const nStart = pPos.GetContentIndex();
      let nEnd: number;
      if (!pBkmk.IsExpanded()) {
        nEnd = nStart;
        // #i81002#
        if (pBkmk.m_eType === MarkType.CROSSREF_HEADING_BOOKMARK || pBkmk.m_eType === MarkType.CROSSREF_NUMITEM_BOOKMARK) nEnd = pTextNd.Len();
      } else if (pBkmk.GetMarkEnd().GetNode() === pTextNd) nEnd = pBkmk.GetMarkEnd().GetContentIndex();
      else nEnd = -1;
      return { pTextNd, nStart, nEnd };
    }
    case ReferencesSubtype.Footnote:
    case ReferencesSubtype.Endnote: {
      // the position at the start of the footnote
      const pTextNd = lcl_FootnoteText(pDoc, rRefMark);
      return pTextNd ? { pTextNd, nStart: 0, nEnd: 0 } : null;
    }
  }
  return null;
}

/** SwTextNode::GetExpandText: the text without the placeholders of fields and objects. */
function lcl_ExpandText(n: SwTextNode, nStart: number, nEnd: number): string {
  return n.GetText().slice(nStart, nEnd).split(CH_TXTATR_BREAKWORD).join('');
}

/** SwGetExpField::GetReferenceTextPos: the caption text after the number and its separator. */
function GetReferenceTextPos(sNodeText: string, nFrom: number): number {
  let nRet = nFrom;
  // skip separator characters ("1: ", "1 - ", "1. ")
  while (nRet < sNodeText.length && !/[\p{L}\p{N}]/u.test(sNodeText[nRet]!)) nRet++;
  return nRet;
}

/** The chapter of a paragraph: the closest outline paragraph at or before it (SwChapterField). */
function lcl_ChapterNumber(doc: SwDoc, pTextNd: SwTextNode, ctx: SwRefContext): string {
  const nodes = doc.GetNodes();
  for (let i = pTextNd.GetIndex(); i >= nodes.BodyStart(); i--) {
    const n = nodes.node(i);
    if (!n.IsTextNode()) continue;
    const lvl = SwDoc.OutlineLevel(n);
    if (!lvl || lvl > MAXLEVEL) continue;
    const num = ctx.nums.get(n);
    // SwChapterField::GetNumber: the number without prefix and suffix.
    return num?.counted && num.vector && !num.fmt.IsItemize() ? num.rule.MakeNumString(num.vector, false) : '';
  }
  return '';
}

/** The prefix and suffix lengths of a level's number string (SwNumRule::Extremities). */
function lcl_Extremities(rule: SwNumRule, nLevel: number): { nPrefixChars: number; nSuffixChars: number } {
  const f = rule.Get(nLevel);
  if (f.HasListFormat()) {
    const s = f.GetListFormat(true);
    const first = s.indexOf('%'), last = s.lastIndexOf('%');
    return first < 0 ? { nPrefixChars: s.length, nSuffixChars: 0 } : { nPrefixChars: first, nSuffixChars: s.length - last - 1 };
  }
  return { nPrefixChars: f.GetPrefix().length, nSuffixChars: f.GetSuffix().length };
}

/**
 * SwNumRule::MakeRefNumString: the number of a list paragraph, with the labels of its superior
 * levels from the deepest one included down to `nRestrictInclToThisLevel` when asked to.
 */
export function MakeRefNumString(rule: SwNumRule, vector: number[], bInclSuperiorNumLabels: boolean, nRestrictInclToThisLevel: number): string {
  let aRefNumStr = '';
  let bOldHadPrefix = true;
  let nLevel = vector.length - 1;
  do {
    const aFormat = rule.Get(nLevel);
    if (aFormat.IsEnumeration() || aFormat.GetNumberingType() !== NumberingType.NUMBER_NONE) {
      let aPrevStr = rule.MakeNumString(vector.slice(0, nLevel + 1), true);
      const aExtremities = lcl_Extremities(rule, nLevel);
      let nStrip = 0;
      while (nStrip < aExtremities.nPrefixChars) {
        const c = aPrevStr[nStrip];
        if (c !== '\t' && c !== ' ') break;
        ++nStrip;
      }
      if (nStrip) {
        aPrevStr = aPrevStr.slice(nStrip);
        aExtremities.nPrefixChars -= nStrip;
      }
      if (bOldHadPrefix && aExtremities.nSuffixChars && !aExtremities.nPrefixChars) aPrevStr = aPrevStr.slice(0, aPrevStr.length - aExtremities.nSuffixChars);
      bOldHadPrefix = aExtremities.nPrefixChars > 0;
      aRefNumStr = aPrevStr + aRefNumStr;
    }
    if (bInclSuperiorNumLabels && nLevel > 0) {
      let n = rule.Get(nLevel).GetIncludeUpperLevels();
      nLevel--;
      // skip parents, whose list label is already contained in the actual list label.
      while (nLevel >= 0 && n > 1) { nLevel--; --n; }
    } else break;
  } while (nLevel >= 0 && nLevel >= nRestrictInclToThisLevel);
  // tdf#144563: looks like a special case for refs by MS Word: if numbering is ending with dot, this dot is removed
  if (aRefNumStr.endsWith('.')) aRefNumStr = aRefNumStr.slice(0, -1);
  return aRefNumStr;
}

/** MakeRefNumStr (reffld.cxx, #i81002#): the number formats of a reference to a list paragraph. */
function MakeRefNumStr(doc: SwDoc, rTextNodeOfField: SwTextNode, rTextNodeOfReferencedItem: SwTextNode, nRefNumFormat: number, ctx: SwRefContext): string {
  const refNum = ctx.nums.get(rTextNodeOfReferencedItem);
  if (!refNum?.counted || !refNum.vector || refNum.fmt.IsItemize()) return '';
  // Determine, up to which level the superior list labels have to be included - default is to
  // include all superior list labels.
  let nRestrictInclToThisLevel = 0;
  // Determine for format REF_NUMBER the level, up to which the superior list labels have to be
  // restricted, if the text node of the reference field and the text node of the referenced item
  // are in the same document context.
  const nodes = doc.GetNodes();
  if (nRefNumFormat === RefFieldFormat.Number && nodes.AreaOf(rTextNodeOfField) === nodes.AreaOf(rTextNodeOfReferencedItem)
    && rTextNodeOfField.FindFlyStartNode() === rTextNodeOfReferencedItem.FindFlyStartNode()) {
    let fieldVec: number[] | undefined;
    const own = ctx.nums.get(rTextNodeOfField);
    if (own?.counted && own.rule === refNum.rule) fieldVec = own.vector;
    else {
      // SwNodeNum::GetPrecedingNodeNumOf: the last paragraph of the list before the field's.
      for (let i = rTextNodeOfField.GetIndex() - 1; i >= 0 && !fieldVec; i--) {
        const n = nodes.node(i);
        const num = n.IsTextNode() ? ctx.nums.get(n) : undefined;
        if (num?.counted && num.rule === refNum.rule) fieldVec = num.vector;
      }
    }
    if (fieldVec) {
      for (let nLevel = 0; nLevel < fieldVec.length && nLevel < refNum.vector.length; nLevel++) {
        if (refNum.vector[nLevel] === fieldVec[nLevel]) nRestrictInclToThisLevel = nLevel + 1;
        else break;
      }
    }
  }
  // Determine, if superior list labels have to be included
  const bInclSuperiorNumLabels = nRestrictInclToThisLevel < refNum.level
    && (nRefNumFormat === RefFieldFormat.Number || nRefNumFormat === RefFieldFormat.NumberFullContext);
  return MakeRefNumString(refNum.rule, refNum.vector, bInclSuperiorNumLabels, nRestrictInclToThisLevel);
}

/** SwGetRefField::UpdateField: the field's text, the field being at `nFieldPos` of `pFieldNode`. */
export function UpdateField(doc: SwDoc, f: SwField, pFieldNode: SwTextNode | null, nFieldPos: number, ctx: SwRefContext): string {
  const m_nSubType = f.subType ?? ReferencesSubtype.SetRefAttr;
  const nFormat = f.format ?? RefFieldFormat.Content;
  const m_sSetRefName = f.name ?? '';
  // finding the reference target (the number)
  const found = FindAnchor(doc, m_sSetRefName, m_nSubType, f.seqNo ?? 0);
  // not found?
  if (!found) return aGetRefField_RefItemNotFound;
  const { pTextNd, nStart: nNumStart, nEnd: nNumEnd } = found;

  // where is the category name (e.g. "Illustration")?
  const aText = pTextNd.GetText();
  const nCatStart = m_sSetRefName ? aText.indexOf(m_sSetRefName) : -1;
  const bHasCat = nCatStart >= 0;
  const nCatEnd = bHasCat ? nCatStart + m_sSetRefName.length : -1;
  // length of the referenced text
  const nLen = aText.length;

  switch (nFormat) {
    case RefFieldFormat.Content:
    case RefFieldFormat.CategoryAndNumber:
    case RefFieldFormat.CaptionText:
    case RefFieldFormat.Numbering: {
      // needed part of Text
      let nStart: number;
      let nEnd: number;
      switch (m_nSubType) {
        case ReferencesSubtype.SequenceField: {
          // The number range field shows its number: the expansion is built around it.
          const seq = pTextNd.m_aHints.find((h) => h.nStart === nNumStart)?.aAttrs.RES_TXTATR_FIELD;
          const sNum = seq ? makeNumberingString((seq.numType ?? NumberingType.ARABIC) as NumberingType, ctx.seqNums.get(seq) ?? 1) : '';
          const expand = (a: number, b: number) => (a <= nNumStart && nNumStart < b ? lcl_ExpandText(pTextNd, a, nNumStart) + sNum + lcl_ExpandText(pTextNd, nNumStart + 1, b) : lcl_ExpandText(pTextNd, a, b));
          switch (nFormat) {
            // "Category and Number"
            case RefFieldFormat.CategoryAndNumber:
              if (bHasCat) { nStart = Math.min(nNumStart, nCatStart); nEnd = Math.max(nNumEnd, nCatEnd); }
              else { nStart = nNumStart; nEnd = nNumEnd; }
              break;
            // "Caption Text": next alphanumeric character after category+number
            case RefFieldFormat.CaptionText:
              nStart = GetReferenceTextPos(aText, bHasCat ? Math.max(nNumStart + 1, nCatEnd) : nNumStart + 1);
              nEnd = nLen;
              break;
            // "Numbering"
            case RefFieldFormat.Numbering:
              nStart = nNumStart;
              nEnd = Math.min(nStart + 1, nLen);
              break;
            // "Reference" (whole Text)
            default:
              nStart = 0;
              nEnd = nLen;
          }
          return nStart !== nEnd ? expand(nStart, nEnd) : '';
        }
        case ReferencesSubtype.Bookmark:
          nStart = nNumStart;
          // text is spread across multiple nodes - get whole text or only until end of node?
          nEnd = nNumEnd < 0 ? nLen : nNumEnd;
          break;
        case ReferencesSubtype.Footnote:
        case ReferencesSubtype.Endnote:
          // get number or numString
          return ctx.footnoteNum(m_sSetRefName);
        default:
          nStart = nNumStart;
          nEnd = nNumEnd;
      }
      return nStart !== nEnd ? lcl_ExpandText(pTextNd, nStart, nEnd) : '';
    }
    case RefFieldFormat.Page:
    case RefFieldFormat.AsPageStyle: {
      const page = ctx.pageOf(pTextNd, nNumStart);
      if (!page) return '';
      return nFormat === RefFieldFormat.AsPageStyle ? makeNumberingString(page.nNumType as NumberingType, page.nVirtNum) : String(page.nVirtNum);
    }
    case RefFieldFormat.Chapter:
      return lcl_ChapterNumber(doc, pTextNd, ctx);
    case RefFieldFormat.UpDown: {
      if (!pFieldNode) return '';
      // LocaleDataWrapper::getAboveWord / getBelowWord of en-US.
      const bAbove = pFieldNode === pTextNd ? nNumStart < nFieldPos : pTextNd.GetIndex() < pFieldNode.GetIndex();
      return bAbove ? 'above' : 'below';
    }
    case RefFieldFormat.Number:
    case RefFieldFormat.NumberNoContext:
    case RefFieldFormat.NumberFullContext:
      return pFieldNode ? MakeRefNumStr(doc, pFieldNode, pTextNd, nFormat, ctx) : '';
  }
  return '';
}

/** Every reference field of the document with its paragraph and position. */
export function GatherGetRefFields(doc: SwDoc): { f: SwField; node: SwTextNode; nPos: number }[] {
  const out: { f: SwField; node: SwTextNode; nPos: number }[] = [];
  for (const n of lcl_AllText(doc)) for (const h of n.m_aHints) if (h.aAttrs.RES_TXTATR_FIELD?.type === 'GetRef') out.push({ f: h.aAttrs.RES_TXTATR_FIELD, node: n, nPos: h.nStart });
  return out;
}

// --- what the Cross-references page lists (SwFieldRefPage::UpdateSubType) ---

/** The headings of the body (IDocumentOutlineNodes::getOutlineNodes): outline paragraphs. */
export function GetOutlineNodes(doc: SwDoc): SwTextNode[] {
  const out: SwTextNode[] = [];
  const nodes = doc.GetNodes();
  for (let n = nodes.GoNext(nodes.BodyStart() - 1); n; n = nodes.GoNext(n.GetIndex())) if (SwDoc.OutlineLevel(n)) out.push(n);
  return out;
}

/** IDocumentListItems::getNumItems: the counted list paragraphs with a number (not bullets) of the body. */
export function GetNumItems(doc: SwDoc, nums: Map<SwTextNode, SwNodeNum>): SwTextNode[] {
  const out: SwTextNode[] = [];
  const nodes = doc.GetNodes();
  for (let n = nodes.GoNext(nodes.BodyStart() - 1); n; n = nodes.GoNext(n.GetIndex())) {
    const num = nums.get(n);
    if (num?.counted && !num.fmt.IsItemize() && !SwDoc.OutlineLevel(n)) out.push(n);
  }
  return out;
}

/** The number range fields of a category, with their numbers and paragraphs (SwGetSetExpType::Sequence). */
export function GetSeqFields(doc: SwDoc, rCategory: string): { f: SwField; node: SwTextNode }[] {
  const out: { f: SwField; node: SwTextNode }[] = [];
  for (const n of lcl_AllText(doc)) for (const h of n.m_aHints) {
    const f = h.aAttrs.RES_TXTATR_FIELD;
    if (f?.type === 'Sequence' && f.name === rCategory) out.push({ f, node: n });
  }
  return out;
}

/** The categories of the number range fields in the document. */
export function GetSeqCategories(doc: SwDoc): string[] {
  const out = new Set<string>();
  for (const n of lcl_AllText(doc)) for (const h of n.m_aHints) { const f = h.aAttrs.RES_TXTATR_FIELD; if (f?.type === 'Sequence' && f.name) out.add(f.name); }
  return [...out];
}

/** The footnotes or endnotes in document order, by id. */
export function GetFootnotes(doc: SwDoc, bEndnote: boolean): string[] {
  const out: string[] = [];
  const nodes = doc.GetNodes();
  for (let n = nodes.GoNext(nodes.BodyStart() - 1); n; n = nodes.GoNext(n.GetIndex())) for (const h of n.m_aHints) {
    const ftn = h.aAttrs.RES_TXTATR_FTN;
    if (ftn && !!ftn.endnote === bEndnote) out.push(ftn.id);
  }
  return out;
}
