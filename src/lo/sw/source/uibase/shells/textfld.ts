// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/uibase/shells/textfld.cxx partial
// SwTextShell::ExecField for FN_PGNUMBER_WIZARD (Insert > Page Number): CreateSwPageNumberDlg
// opens SwPageNumberDlg with the page style's number format, ExecutePageNumberWizard is its RET_OK
// handler. Reduced where the model is: page style changes are made in place and are not part of
// the undo step (upstream instead empties the undo stack after changing the page style, to avoid
// crashes the model does not have); turning on mirrored margins (UseOnPage::Mirror) is not ported;
// "Fit into existing margins" measures only the Western font of the Header or Footer paragraph
// style (the model has no CTL and CJK fonts).
import { MarkType } from '../../core/doc/docbm.ts';
import { SwDocStatSubType } from '../../core/fields/docufld.ts';
import type { SwField } from '../../../inc/hintids.ts';
import type { SwPageDesc } from '../../../inc/pagedesc.ts';
import { SwPaM, SwPosition } from '../../../inc/pam.ts';
import { SwPageNumberDlg } from '../../ui/misc/pagenumberdlg.ts';
import type { SwWrtShell } from '../wrtsh/wrtsh.ts';

/** o3tl::toTwips(5, o3tl::Length::mm) */
const constTwips_5mm = 283;

/** FN_PGNUMBER_WIZARD up to StartExecuteAsync: the dialog, set to the page style's numbering. */
export function CreateSwPageNumberDlg(rSh: SwWrtShell): SwPageNumberDlg {
  const pDlg = new SwPageNumberDlg();

  const rCurrDesc = rSh.GetCurPageDesc();
  pDlg.SetPageNumberType(rCurrDesc.m_nNumType);
  return pDlg;
}

/** Deletes what a previously wizard-inserted bookmark spans (DeleteAndJoin of its range). */
function lcl_DeleteMarked(rSh: SwWrtShell, sName: string): void {
  const ppMark = rSh.getIDocumentMarkAccess().findMark(sName);
  if (!ppMark) return;
  const aDeleteOldPageNum = new SwPaM(new SwPosition(ppMark.GetMarkStart().GetNode(), ppMark.GetMarkStart().GetContentIndex()), new SwPosition(ppMark.GetMarkEnd().GetNode(), ppMark.GetMarkEnd().GetContentIndex()));
  if (aDeleteOldPageNum.HasMark()) rSh.m_pDoc.DeleteAndJoin(aDeleteOldPageNum);
  aDeleteOldPageNum.Release();
}

/** The RES_PARATR_ADJUST of the page number's paragraph: SvxAdjust Left, Center, Right. */
const ADJUST = ['left', 'center', 'right'] as const;

/** FN_PGNUMBER_WIZARD's RET_OK handler: one undo step (SwUndoId::INSERT_PAGE_NUMBER). */
export function ExecutePageNumberWizard(rSh: SwWrtShell, pDlg: SwPageNumberDlg): void {
  const rDoc = rSh.m_pDoc;

  const aPushed = rSh.SaveCursor();
  const nUndo = rSh.StartUndo();

  const rDesc: SwPageDesc = rSh.GetCurPageDesc();
  const bHeader = !pDlg.GetPageNumberPosition();
  const bHeaderAlreadyOn = rSh.IsHeaderOn(true, rDesc.m_aName);
  const bFooterAlreadyOn = rSh.IsHeaderOn(false, rDesc.m_aName);
  const bIsSinglePage = rDesc.m_sFollow !== rDesc.m_aName;
  const nMirrorPagesNeeded = rSh.HasFirstHeaderFooter(rDesc.m_aName) ? 3 : 2;
  const sBookmarkName = `PageNumWizard_${bHeader ? 'HEADER' : 'FOOTER'}_${rDesc.m_aName}`;
  const rIDMA = rSh.getIDocumentMarkAccess();

  // Allow wizard to be re-run: delete previously wizard-inserted page number.
  // Try before creating non-shared header: avoid copying ODD bookmark onto EVEN page.
  let sBookmarkOddPage = sBookmarkName + String(rSh.GetVirtPageNum());
  lcl_DeleteMarked(rSh, sBookmarkOddPage);

  if (pDlg.GetPageNumberType() !== rDesc.m_nNumType) rSh.ChgPageDesc(rDesc, (d) => { d.m_nNumType = pDlg.GetPageNumberType(); });

  // Insert header/footer
  if ((bHeader && !bHeaderAlreadyOn) || (!bHeader && !bFooterAlreadyOn)) {
    rSh.ChangeHeaderOrFooter(bHeader, true, false, rDesc.m_aName);

    // Init copied from ChangeHeaderOrFooter: keep in sync
    rSh.ChgPageDesc(rDesc, (d) => { if (bHeader) d.nHeaderSpacing = constTwips_5mm; else d.nFooterSpacing = constTwips_5mm; });

    if (pDlg.GetFitIntoExistingMargins()) {
      let nPageMargin = bHeader ? rDesc.nTop : rDesc.nBottom;

      // most printers can't print to paper edge - use arbitrary ~14pt as minimum
      if (nPageMargin > constTwips_5mm) {
        // reduce existing margin by the "Spacing"
        nPageMargin -= constTwips_5mm;

        // also reduce by the "Height" (as calculated from the font)
        let nFontHeight = constTwips_5mm; // appropriate for 12pt font
        const sParaStyle = bHeader ? 'Header' : 'Footer';
        const pStyle = rDoc.FindTextFormatCollByName(sParaStyle);
        if (pStyle) {
          // The Western font only: the model has no CTL and CJK fonts to take the tallest of.
          const aMetric = rSh.GetTextMeasurer().GetFontMetric({
            family: pStyle.GetFormatAttr('RES_CHRATR_FONT'), size: pStyle.GetFormatAttr('RES_CHRATR_FONTSIZE'),
            bold: pStyle.GetFormatAttr('RES_CHRATR_WEIGHT'), italic: pStyle.GetFormatAttr('RES_CHRATR_POSTURE'),
          });
          nFontHeight = Math.round(aMetric.ascent + aMetric.descent);

          // Spacing: above and below paragraph
          const rParaStyleUL = pStyle.GetFormatAttr('RES_UL_SPACE');
          nFontHeight += rParaStyleUL.upper + rParaStyleUL.lower;

          // Border padding: top and bottom (CalcLineSpace with bEvenIfNoLine)
          const rBorders = pStyle.GetFormatAttr('RES_BOX');
          if (rBorders) {
            nFontHeight += (rBorders.top?.width ?? 0) + rBorders.padding;
            nFontHeight += (rBorders.bottom?.width ?? 0) + rBorders.padding;
          }
        }
        nPageMargin -= nFontHeight;

        nPageMargin = Math.max(nPageMargin, constTwips_5mm);
        rSh.ChgPageDesc(rDesc, (d) => {
          if (bHeader) d.nTop = nPageMargin; else d.nBottom = nPageMargin;
          // force aggressively calculated font height as minimum to ensure
          // effective margin stays the same (instead of getting smaller);
          // frame size property includes both Spacing + Height
          if (bHeader) d.nHeaderMinHeight = constTwips_5mm + nFontHeight; else d.nFooterMinHeight = constTwips_5mm + nFontHeight;
          // in case the calculated font height isn't actually large enough,
          // eat into spacing first before pushing into the content area.
          if (bHeader) d.bHeaderEatSpacing = true; else d.bFooterEatSpacing = true;
        });
      }
    }
  }

  const bCreateMirror = !bIsSinglePage && pDlg.GetMirrorOnEvenPages() && nMirrorPagesNeeded <= rSh.GetPageCnt();
  // Use different left/right header/footer
  if (bCreateMirror) rSh.UnshareHeaderFooter(rDesc.m_aName, bHeader);

  // Go to the header or footer insert position
  let bSkipMirror = true;
  let nEvenPage = 0;
  // Where the cursor went: the first page's header or footer, or the master's (ODD pages).
  let bFirst = false;
  if (bCreateMirror) {
    let bInHF = rSh.SetCursorInHdFt(rDesc.m_aName, bHeader, /*Even=*/true);
    // Remember valid EVEN page. Mirror it if also a valid ODD or FIRST page
    if (bInHF) nEvenPage = rSh.GetVirtPageNum();
    bInHF = rSh.SetCursorInHdFt(rDesc.m_aName, bHeader, /*Even=*/false);
    // Even though the cursor may be on a FIRST page,
    // the user requested mirrored pages, and we have both ODD and EVEN,
    // so set page numbers on these two pages, and leave FIRST alone.
    if (bInHF && nEvenPage) bSkipMirror = false;
    if (!bInHF) {
      // no ODD page, look for FIRST page
      bInHF = rSh.SetCursorInHdFt(rDesc.m_aName, bHeader, false, /*First=*/true);
      bFirst = bInHF;
      // Unlikely but valid situation: EVEN and FIRST pages, but no ODD page.
      if (bInHF && nEvenPage) bSkipMirror = false;
    }
  } else {
    rSh.SetCursorInHdFt(rDesc.m_aName, bHeader, false);
  }

  // Allow wizard to be re-run: delete previously wizard-inserted page number.
  // Now that the cursor may have moved to a different page, try delete again.
  sBookmarkOddPage = sBookmarkName + String(rSh.GetVirtPageNum());
  lcl_DeleteMarked(rSh, sBookmarkOddPage);

  /**
   * The new line with the page number and its bookmark. The mirrored EVEN copy adds only the page
   * total, never the total of the page numbering range, as upstream's does.
   */
  const insertPageNumber = (nAlignment: number, sBookmark: string, bEven: boolean, bPageTotal: boolean) => {
    // Insert new line if there is already text in header/footer
    const pTextNode = rSh.m_pCursor.GetPoint().GetNode();
    if (pTextNode.GetText()) {
      rDoc.SplitNode(rSh.m_pCursor);
      // Go back to start of header/footer
      rSh.SetCursorInHdFt(rDesc.m_aName, bHeader, bEven, !bEven && bFirst);
    }

    // Set alignment for the new line
    rSh.SetParaAttr({ RES_PARATR_ADJUST: ADJUST[nAlignment]! });

    const nStartContentIndex = rSh.m_pCursor.Start().GetContentIndex();

    // Insert page number
    rSh.InsertFormatField({ type: 'PageNumber' });
    if (bPageTotal) {
      rSh.Insert(' / ');
      // SwDocStatSubType::Page is the model's 'PageCount' field.
      const aPageTotalData: SwField = pDlg.GetIncludePageTotal() ? { type: 'PageCount' } : { type: 'DocStat', subType: SwDocStatSubType.PageRange };
      rSh.InsertFormatField(aPageTotalData);
    }

    // Mark inserted fields with a bookmark - so it can be found/removed if re-run
    const pEnd = rSh.m_pCursor.Start();
    const aNewBookmarkPaM = new SwPaM(new SwPosition(pEnd.GetNode(), pEnd.GetContentIndex()), new SwPosition(pEnd.GetNode(), nStartContentIndex));
    rDoc.recorded('bookmark', rSh.m_pCursor, aNewBookmarkPaM.Start().GetNodeIndex(), aNewBookmarkPaM.Start().GetNodeIndex() - 1, () => {
      rIDMA.makeMark(aNewBookmarkPaM, sBookmark, MarkType.BOOKMARK);
    });
    aNewBookmarkPaM.Release();
  };
  insertPageNumber(pDlg.GetPageNumberAlignment(), sBookmarkOddPage, false, pDlg.GetIncludePageTotal() || pDlg.GetIncludePageRangeTotal());

  // Mirror on the even pages
  if (!bSkipMirror && bCreateMirror && rSh.SetCursorInHdFt(rDesc.m_aName, bHeader, /*Even=*/true)) {
    const sBookmarkEvenPage = sBookmarkName + String(rSh.GetVirtPageNum());
    lcl_DeleteMarked(rSh, sBookmarkEvenPage);
    // mirror the adjustment
    insertPageNumber(!pDlg.GetPageNumberAlignment() ? 2 : 0, sBookmarkEvenPage, true, pDlg.GetIncludePageTotal());
  }

  rSh.RestoreCursor(aPushed);
  rSh.EndUndo(nUndo);
  rDoc.SetModified();
}
