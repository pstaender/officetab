// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/core/doc/DocumentStatisticsManager.cxx reduced
// @upstream sw/inc/docstat.hxx partial
// The document statistics (SwDocStat) the word count and the statistics fields show, counted at
// once instead of incrementally on idle. SwTextNode::CountWords is reduced to the word
// boundaries of Intl.Segmenter and the characters as graphemes, each paragraph counted again only
// when its text changed; a field counts as one character and its text is not counted (upstream
// counts the fields' expansions); numbering labels, hidden paragraphs, deleted tracked changes
// and the paragraphs of comments are not counted separately. Images and OLE objects are the graphics and
// formulas in frames (the model keeps no SwGrfNode or SwOLENode), tables the table nodes. The
// counts are not written to the document properties.
import type { SwDoc } from '../../../inc/doc.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';

/** SwDocStat */
export interface SwDocStat {
  nTable: number;
  nGrf: number;
  nOLE: number;
  nPage: number;
  /** paragraphs with text */
  nPara: number;
  nWord: number;
  nChar: number;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const words = new Intl.Segmenter(undefined, { granularity: 'word' });
/** SwTextNode::CountWords' cached counts (m_pParaIdleData_Impl's word and character counts), by paragraph. */
const paraStats = new WeakMap<SwTextNode, { text: string; words: number; chars: number }>();

/** SwTextNode::CountWords for the whole paragraph: its words and characters. */
export function CountWords(n: SwTextNode): { words: number; chars: number } {
  const text = n.GetText();
  let stat = paraStats.get(n);
  if (!stat || stat.text !== text) {
    let nWords = 0;
    for (const seg of words.segment(text)) if (seg.isWordLike) nWords++;
    stat = { text, words: nWords, chars: [...graphemes.segment(text)].length };
    paraStats.set(n, stat);
  }
  return stat;
}

/**
 * DocumentStatisticsManager::IncrementalDocStatCalculate, all at once: the text paragraphs from
 * the first of the body on, the tables, graphics and objects; `nPage` from the layout.
 */
export function GetUpdatedDocStat(rDoc: SwDoc, nPage = 0): SwDocStat {
  const aDocStat: SwDocStat = { nTable: 0, nGrf: 0, nOLE: 0, nPage, nPara: 0, nWord: 0, nChar: 0 };
  const nodes = rDoc.GetNodes();
  for (let n: SwTextNode | null = nodes.FirstTextNode(); n; n = nodes.GoNext(n.GetIndex())) {
    const stat = CountWords(n);
    // count of non-empty paras
    if (n.GetText()) ++aDocStat.nPara;
    aDocStat.nWord += stat.words;
    aDocStat.nChar += stat.chars;
  }
  for (let i = 0; i < nodes.Count(); i++) if (nodes.node(i).IsTableNode()) ++aDocStat.nTable;
  for (const f of rDoc.GetFlyFormats()) {
    if (f.asChar ? f.asChar.math : f.fmt?.m_pMath) ++aDocStat.nOLE;
    else if (f.asChar ? f.asChar.graphic && !f.asChar.shape : f.fmt?.graphic) ++aDocStat.nGrf;
  }
  return aDocStat;
}
