// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/core/text/inftxt.cxx reduced
// The lookup of SwTextPaintInfo::DrawCSDFHighlighting: what the styles spotlight marks on a
// portion of text. Upstream reads the CharStyleName and the direct values of the character
// auto-style properties through a SwXTextRange; here they are the portion's hint. Styles are
// numbered and coloured as in LibreOfficeKit mode (the position in the document's style table,
// ColorHash of the name), because there is no style list panel to number the styles it shows.
import { ColorHash } from '../../../../sfx2/source/dialog/StyleList.ts';
import type { SwDoc } from '../../../inc/doc.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';

/** View > Styles spotlight (SwView::m_bIsSpotlightCharDF, m_bIsSpotlightParaStyles, m_bIsSpotlightCharStyles). */
export interface SwSpotlight { charDF: boolean; paraStyles: boolean; charStyles: boolean }

/** STR_CHARACTER_DIRECT_FORMATTING_TAG */
export const STR_CHARACTER_DIRECT_FORMATTING_TAG = 'df';
/** COL_LIGHTGRAY */
const COL_LIGHTGRAY = '#c0c0c0';

export interface SwCSDFHighlight {
  /** The character style's number, or "df". */
  label: string;
  color: string;
  /** The character style, or null for direct formatting. */
  charStyle: string | null;
}

/** The position of a style in its table (SwFormatsBase::GetPos); -1 if it is not there. */
const GetPos = <T>(table: Map<string, T>, name: string): number => [...table.keys()].indexOf(name);

/** Whether the text at `pos` has direct character formatting (a direct value of a character property). */
export function HasCharDirectFormatting(node: SwTextNode, pos: number): boolean {
  const hint = node.m_aHints.find((h) => h.nStart <= pos && pos < h.nEnd);
  return !!hint && Object.keys(hint.aAttrs).some((k) => k.startsWith('RES_CHRATR_'));
}

/** The character style at `pos`, if one is set (CharStyleName). */
export function CharStyleAt(node: SwTextNode, pos: number): string | null {
  return node.m_aHints.find((h) => h.nStart <= pos && pos < h.nEnd)?.aAttrs.RES_TXTATR_CHARFMT?.GetName() ?? null;
}

/** DrawCSDFHighlighting's choice for the text at `pos`: its character style, else its direct formatting. */
export function CSDFHighlight(doc: SwDoc, node: SwTextNode, pos: number, s: SwSpotlight): SwCSDFHighlight | null {
  if (!s.charStyles && !s.charDF) return null;
  const sCurrentCharStyle = CharStyleAt(node, pos);
  // check for CS formatting, if not CS formatted check for direct character formatting
  if (sCurrentCharStyle) {
    if (!s.charStyles) return null;
    const n = GetPos(doc.m_aCharFormats, sCurrentCharStyle);
    return n < 0 ? null : { label: String(n), color: ColorHash(sCurrentCharStyle), charStyle: sCurrentCharStyle };
  }
  // not character style formatted
  if (s.charDF && HasCharDirectFormatting(node, pos)) return { label: STR_CHARACTER_DIRECT_FORMATTING_TAG, color: COL_LIGHTGRAY, charStyle: null };
  return null;
}

/** PaintParagraphStylesHighlighting's number and colour of a paragraph style. */
export function ParaStyleHighlight(doc: SwDoc, node: SwTextNode): { label: string; color: string } {
  const sStyleName = node.GetTextColl().GetName();
  return { label: String(GetPos(doc.m_aTextFormatColls, sStyleName)), color: ColorHash(sStyleName) };
}
