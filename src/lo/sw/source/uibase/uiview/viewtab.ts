// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/uibase/uiview/viewtab.cxx reduced
// The rulers' state for the cursor's paragraph (SwView::StateTabWin) and the changes dragged on
// them (SwView::ExecTabWin): page, header, footer, frame or table cell edges as the frame margins,
// the paragraph indents and its tab stops. Left out: table columns and rows on the rulers
// (SID_RULER_BORDERS, SID_RULER_ROWS) and text columns; in a table cell the cell's edges are the
// frame margins, which cannot be dragged, as those of a text frame or a header. Tab stops are
// always relative to the indent, as this layout places them, and the paragraph's style is never
// updated from the direct formatting (IsAutoUpdateOnDirectFormat). In browse mode the margins
// come from the browse border, so dragging them does not change the page style.
import type { SvxLRSpace, SvxTabStop } from '../../../inc/hintids.ts';
import type { SwPageDesc } from '../../../inc/pagedesc.ts';
import type { SwWrtShell } from '../wrtsh/wrtsh.ts';
import { DEFAULT_TAB } from '../../core/text/itrform2.ts';

/** SvxPagePosSizeItem: the page's position in the document and its size. */
export interface SvxPagePosSizeItem { nPosX: number; nPosY: number; nWidth: number; nHeight: number }
/** SvxLongLRSpaceItem: the frame margins from the page's left and right edges. */
export interface SvxLongLRSpaceItem { mlLeft: number; mlRight: number }
/** SvxLongULSpaceItem: the frame margins from the page's top and bottom edges. */
export interface SvxLongULSpaceItem { mlLeft: number; mlRight: number }

/** The items SwView::StateTabWin puts for the rulers; null where the item is disabled. */
export interface SwTabWinState {
  /** SID_RULER_PAGE_POS */
  aPagePosSize: SvxPagePosSizeItem;
  /** SID_ATTR_LONG_LRSPACE and SID_ATTR_LONG_ULSPACE */
  aLongLR: SvxLongLRSpaceItem;
  aLongUL: SvxLongULSpaceItem;
  /** SID_RULER_PROTECT, reduced: whether the frame margins are the page style's and can be dragged. */
  bPageMargins: boolean;
  /** SID_ATTR_PARA_LRSPACE */
  aParaLR: SvxLRSpace | null;
  /** RES_PARATR_TABSTOP, without default tabs, and the default tab distance (SetDefTabDist). */
  aTabStops: SvxTabStop[] | null;
  nDefTabDist: number;
  /** SID_RULER_TEXT_RIGHT_TO_LEFT */
  bTextRTL: boolean;
  /** The page style the margins belong to. */
  pDesc: SwPageDesc;
}

/** SwView::StateTabWin */
export function StateTabWin(rSh: SwWrtShell): SwTabWinState | null {
  const bBrowse = rSh.m_pRoot.m_pViewOpt.getBrowseMode();
  const pos = rSh.m_pCursor.GetPoint();
  const pNode = pos.GetNode();
  const hit = rSh.m_pRoot.FindLine(pNode, pos.GetContentIndex());
  if (!hit) return null;
  const pPage = hit.page;
  const bFrameSelection = rSh.IsFrameSelected();
  // PageOffset/limiter
  const rPageRect = pPage.aFrame;
  const rPagePrtRect = pPage.aPrt;
  const nPageWidth = rPageRect.Width();
  const nPageHeight = rPageRect.Height();
  const rDesc = rSh.GetCurPageDesc();

  // SID_ATTR_LONG_LRSPACE
  const aLongLR: SvxLongLRSpaceItem = { mlLeft: rDesc.nLeft, mlRight: rDesc.nRight };
  // SID_ATTR_LONG_ULSPACE: Page margin top bottom
  const aLongUL: SvxLongULSpaceItem = { mlLeft: rDesc.nTop, mlRight: rDesc.nBottom };
  if (bBrowse) {
    aLongLR.mlLeft = rPagePrtRect.Left() - rPageRect.Left();
    aLongLR.mlRight = rPageRect.Right() - rPagePrtRect.Right();
    aLongUL.mlLeft = rPagePrtRect.Top() - rPageRect.Top();
    aLongUL.mlRight = rPageRect.Bottom() - rPagePrtRect.Bottom();
  }
  let bPageMargins = !bFrameSelection && !bBrowse;
  const frame = hit.frame;
  const aHF = frame.pArea === 'header' ? pPage.aHeader : frame.pArea === 'footer' ? pPage.aFooter : undefined;
  const pFly = frame.pArea === 'fly' ? pPage.flys.find((f) => f.frames.includes(frame)) : undefined;
  // In a cell, the cell's edges (reduced from the table's column item).
  const aRect = frame.pCell?.aFrame ?? pFly?.aFrame ?? aHF;
  if (aRect && aRect.Width()) {
    // make relative to page position:
    aLongLR.mlLeft = aRect.Left() - rPageRect.Left();
    aLongLR.mlRight = rPageRect.Right() - aRect.Right();
    if (!frame.pCell) {
      aLongUL.mlLeft = aRect.Top() - rPageRect.Top();
      aLongUL.mlRight = rPageRect.Bottom() - aRect.Bottom();
    }
    bPageMargins = false;
  }

  const aParaLR = bFrameSelection ? null : { ...pNode.GetAttr('RES_LR_SPACE') };
  const aTabStops = bFrameSelection ? null : pNode.GetAttr('RES_PARATR_TABSTOP').map((t) => ({ ...t }));
  return {
    aPagePosSize: { nPosX: rPageRect.Left(), nPosY: rPageRect.Top(), nWidth: nPageWidth, nHeight: nPageHeight },
    aLongLR, aLongUL, bPageMargins, aParaLR, aTabStops,
    nDefTabDist: DEFAULT_TAB,
    bTextRTL: pNode.GetAttr('RES_FRAMEDIR') === 'rl-tb',
    pDesc: rDesc,
  };
}

/** The requests SwView::ExecTabWin handles here. */
export type SwTabWinRequest =
  | { nSlot: 'SID_ATTR_LONG_LRSPACE'; item: SvxLongLRSpaceItem }
  | { nSlot: 'SID_ATTR_LONG_ULSPACE'; item: SvxLongULSpaceItem }
  | { nSlot: 'SID_ATTR_PARA_LRSPACE'; item: SvxLRSpace }
  | { nSlot: 'SID_ATTR_TABSTOP'; item: SvxTabStop[] };

/** SwView::ExecTabWin */
export function ExecTabWin(rSh: SwWrtShell, rReq: SwTabWinRequest): void {
  const rDesc = rSh.GetCurPageDesc();
  switch (rReq.nSlot) {
    case 'SID_ATTR_LONG_LRSPACE': {
      // Adjust page margins (rSh.ChgPageDesc)
      rDesc.nLeft = rReq.item.mlLeft;
      rDesc.nRight = rReq.item.mlRight;
      rSh.m_pDoc.m_nFormatVersion++;
      rSh.m_pDoc.Changed();
      break;
    }
    // apply new top and bottom margins to current page style
    case 'SID_ATTR_LONG_ULSPACE': {
      rDesc.nTop = rReq.item.mlLeft;
      rDesc.nBottom = rReq.item.mlRight;
      rSh.m_pDoc.m_nFormatVersion++;
      rSh.m_pDoc.Changed();
      break;
    }
    case 'SID_ATTR_TABSTOP':
      rSh.SetParaAttr({ RES_PARATR_TABSTOP: [...rReq.item].sort((a, b) => a.pos - b.pos) });
      break;
    case 'SID_ATTR_PARA_LRSPACE':
      rSh.SetParaAttr({ RES_LR_SPACE: rReq.item });
      break;
  }
}
