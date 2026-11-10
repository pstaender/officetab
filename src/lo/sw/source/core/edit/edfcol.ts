// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/core/edit/edfcol.cxx reduced
// @upstream sfx2/source/doc/watermarkitem.cxx reduced
// SwEditShell::GetWatermark and SetWatermark: the watermark is a Fontwork shape named
// "PowerPlusWaterMarkObject…" at the end of each header of each page style, centred on the page.
// Upstream goes through the UNO API; here the shape is a fly format on the header's last
// paragraph. Only the page styles the document has are given one (upstream also creates the pool
// page styles it has not used yet), and the header height needs no reset because the layout does
// not let the shape grow the header.
import { RndStdIds, HoriOrientation, VertOrientation, RelOrientation, WrapTextMode, type SwFlyFrameFormat } from '../../../inc/frmfmt.ts';
import { SwStartNodeType } from '../../../inc/ndtyp.ts';
import type { SwAreaKind, SwStartNode } from '../../../inc/node.ts';
import type { SwPageDesc } from '../../../inc/pagedesc.ts';
import { SwPaM, SwPosition } from '../../../inc/pam.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';
import type { SwWrtShell } from '../../uibase/wrtsh/wrtsh.ts';

/** SfxWatermarkItem; an empty text means no watermark. */
export interface SfxWatermarkItem { m_aText: string; m_aFont: string; m_nAngle: number; m_nTransparency: number; m_nColor: string }

export const DefaultWatermark = (): SfxWatermarkItem => ({ m_aText: '', m_aFont: 'Liberation Sans', m_nAngle: 45, m_nTransparency: 50, m_nColor: '#c0c0c0' });

const WATERMARK_NAME = 'PowerPlusWaterMarkObject';

/** The paragraphs of a header section. */
function headerParas(sh: SwWrtShell, sec: SwStartNode): SwTextNode[] {
  const nodes = sh.m_pDoc.GetNodes(), out: SwTextNode[] = [];
  for (let i = sec.GetIndex() + 1; i < sec.EndOfSectionNode().GetIndex(); i++) { const n = nodes.node(i); if (n.IsTextNode()) out.push(n); }
  return out;
}

/** lcl_getWatermark: the header's watermark shape. */
function lcl_getWatermark(sh: SwWrtShell, sec: SwStartNode): { node: SwTextNode; fmt: SwFlyFrameFormat } | null {
  for (const node of headerParas(sh, sec))
    for (const a of node.m_aAnchoredFlys) if (a.fmt.m_pShape && a.fmt.m_aName.startsWith(WATERMARK_NAME)) return { node, fmt: a.fmt };
  return null;
}

/** The counterclockwise angle of a shape (lcl_GetAngle); m_nRotate turns clockwise. */
const lcl_GetAngle = (fmt: SwFlyFrameFormat): number => (360 - Math.round(fmt.m_pShape!.m_nRotate ?? 0)) % 360;

/** lcl_getUsedPageStyles: the page styles of the laid-out pages. */
const lcl_getUsedPageStyles = (sh: SwWrtShell): SwPageDesc[] => [...new Set(sh.m_pRoot.pages.map((p) => p.pDesc))];

const headerOf = (sh: SwWrtShell, desc: string, kind: SwAreaKind = 'default') => sh.m_pDoc.GetNodes().FindAreaSection(SwStartNodeType.SwHeaderStartNode, kind, desc);

export function GetWatermark(sh: SwWrtShell): SfxWatermarkItem {
  for (const rPageStyle of lcl_getUsedPageStyles(sh)) {
    const header = headerOf(sh, rPageStyle.m_aName);
    if (!header) return DefaultWatermark();
    const w = lcl_getWatermark(sh, header);
    if (w) {
      const s = w.fmt.m_pShape!;
      return { m_aText: s.m_sText ?? '', m_aFont: s.m_sFontName ?? '', m_nColor: s.m_aFill ?? '#c0c0c0', m_nAngle: lcl_GetAngle(w.fmt), m_nTransparency: s.m_nFillTransparence ?? 0 };
    }
  }
  return DefaultWatermark();
}

function lcl_placeWatermarkInHeader(sh: SwWrtShell, rWatermark: SfxWatermarkItem, rPageStyle: SwPageDesc, header: SwStartNode | null): void {
  if (!header) return;
  const doc = sh.m_pDoc;
  let xWatermark = lcl_getWatermark(sh, header);

  const bDeleteWatermark = !rWatermark.m_aText;
  if (xWatermark) {
    const s = xWatermark.fmt.m_pShape!;
    // If the header already contains a watermark, see if it its text is up to date.
    if (s.m_sText !== rWatermark.m_aText || s.m_sFontName !== rWatermark.m_aFont || s.m_aFill !== rWatermark.m_nColor
      || lcl_GetAngle(xWatermark.fmt) !== rWatermark.m_nAngle || (s.m_nFillTransparence ?? 0) !== rWatermark.m_nTransparency || bDeleteWatermark) {
      // No: delete it and we'll insert a replacement.
      const pam = new SwPaM(new SwPosition(xWatermark.node, 0));
      doc.DelFly(pam, xWatermark.fmt.m_aName);
      pam.Release();
      xWatermark = null;
    }
  }

  if (xWatermark || bDeleteWatermark) return;

  // Calc the ratio.
  let fRatio = 0;
  const font = { family: rWatermark.m_aFont, size: 96, bold: false, italic: false };
  const nTextWidth = sh.GetTextMeasurer().GetTextWidth(font, rWatermark.m_aText);
  if (nTextWidth) {
    const m = sh.GetTextMeasurer().GetFontMetric(font);
    fRatio = (m.ascent + m.descent) / nTextWidth;
  }

  // Calc the size.
  let nWidth: number;
  if (rPageStyle.nWidth < rPageStyle.nHeight) nWidth = rPageStyle.nWidth - rPageStyle.nLeft - rPageStyle.nRight; // Portrait.
  else nWidth = rPageStyle.nHeight - rPageStyle.nTop - rPageStyle.nBottom; // Landscape.
  const nHeight = Math.trunc(fRatio * nWidth);

  // Create and insert the shape: at the end of the header text.
  const paras = headerParas(sh, header);
  const last = paras[paras.length - 1]!;
  const fmt: SwFlyFrameFormat = {
    m_aName: doc.GetUniqueFlyName(WATERMARK_NAME), m_nWidth: nWidth, m_nHeight: Math.max(1, nHeight),
    m_pShape: {
      m_sType: 'fontwork-plain-text', m_bTextPath: true, m_sText: rWatermark.m_aText, m_sFontName: rWatermark.m_aFont,
      m_aFill: rWatermark.m_nColor, m_nFillTransparence: rWatermark.m_nTransparency, m_aLine: null,
      m_nRotate: (360 - rWatermark.m_nAngle) % 360,
    },
    m_aAnchor: { m_eAnchorId: RndStdIds.FLY_AT_CHAR, m_nPageNumber: 0 },
    m_aHoriOrient: { m_eOrient: HoriOrientation.CENTER, m_eRelation: RelOrientation.PAGE_PRINT_AREA, m_nPos: 0 },
    m_aVertOrient: { m_eOrient: VertOrientation.CENTER, m_eRelation: RelOrientation.PAGE_PRINT_AREA, m_nPos: 0 },
    m_aSurround: { m_eSurround: WrapTextMode.THROUGH },
    m_nLeftSpace: 0, m_nRightSpace: 0, m_nUpperSpace: 0, m_nLowerSpace: 0, m_bOpaque: false,
  };
  const pam = new SwPaM(new SwPosition(last, last.Len()));
  doc.MakeFlyFrameFormat(pam, fmt);
  pam.Release();
}

/** SwEditShell::SetWatermark: one undo step. */
export function SetWatermark(sh: SwWrtShell, rWatermark: SfxWatermarkItem): void {
  const doc = sh.m_pDoc;
  const bNoWatermark = !rWatermark.m_aText;
  const nUndo = sh.StartUndo();

  for (const rPageStyle of [...doc.m_aPageDescs.values()]) {
    const name = rPageStyle.m_aName;
    // If the header is off, turn it on.
    if (!headerOf(sh, name)) {
      if (bNoWatermark) continue; // the style doesn't have any watermark - no need to do anything
      sh.ChangeHeaderOrFooter(true, true, false, name);
    }

    lcl_placeWatermarkInHeader(sh, rWatermark, rPageStyle, headerOf(sh, name));
    lcl_placeWatermarkInHeader(sh, rWatermark, rPageStyle, headerOf(sh, name, 'first'));
    lcl_placeWatermarkInHeader(sh, rWatermark, rPageStyle, headerOf(sh, name, 'left'));
  }
  sh.EndUndo(nUndo);
}
