// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/filter/excel/xepage.cxx reduced
// @upstream sc/source/filter/excel/xehelper.cxx partial
// @upstream sc/source/filter/excel/xlpage.cxx partial
// XclExpPageSettings: the page style of a sheet as printOptions, pageMargins, pageSetup and
// headerFooter, with XclExpHFConverter (xehelper.cxx) for the header and footer codes (&L &C &R,
// fields as &P &N &D &T &A &F, font name and style, size, underline, colour, strikeout, super- and
// subscript). Reduced: page breaks and the background graphic are not written; the paper size is
// matched with msfilter's table (getMSPaperSizeIndex) and written as width and height when no
// Excel paper fits; a font style is written whenever bold or italic change (upstream needs the
// font list for that); the first page number is written whenever it is set.
import { escapeXml } from '../../../../xmloff/source/core/xmlparse.ts';
import type { EditTextObject } from '../../../../editeng/source/editeng/editobj.ts';
import { SC_POOL_DEFAULTS, type ScItems, type ScPageHFItem } from '../../../inc/scitems.ts';
import { SfxStyleFamily } from '../../../inc/stlsheet.ts';
import type { ScDocument } from '../../core/data/document.ts';
import { getMSPaperSizeIndex } from '../oox/pagesettings.ts';

const GetInchFromTwips = (n: number) => n / 1440;
const ToPsz = (b: boolean) => (b ? 'true' : 'false');
const twipToMm100 = (n: number) => Math.round((n * 127) / 72);

interface XclFontData { maName: string; mnHeight: number; mbBold: boolean; mbItalic: boolean; mnUnderline: string; mbStrikeout: boolean; maColor: string | null; mnEscapem: number }

/** XclExpHFConverter */
export class XclExpHFConverter {
  private maHFString = '';
  private mnTotalHeight = 0;
  private readonly maAppFont: XclFontData;

  constructor(rDefFontName: string, nDefFontHeight: number) {
    this.maAppFont = { maName: rDefFontName, mnHeight: Math.trunc((nDefFontHeight + 10) / 20), mbBold: false, mbItalic: false, mnUnderline: 'none', mbStrikeout: false, maColor: null, mnEscapem: 0 };
  }

  GenerateString(pLeftObj: EditTextObject | null, pCenterObj: EditTextObject | null, pRightObj: EditTextObject | null): void {
    this.maHFString = '';
    this.mnTotalHeight = 0;
    this.AppendPortion(pLeftObj, 'L');
    this.AppendPortion(pCenterObj, 'C');
    this.AppendPortion(pRightObj, 'R');
  }

  GetHFString(): string { return this.maHFString; }
  /** twips */
  GetTotalHeight(): number { return this.mnTotalHeight; }

  private AppendPortion(pTextObj: EditTextObject | null, cPortionCode: string): void {
    if (!pTextObj) return;
    const aLines: string[] = [];
    let nHeight = 0;
    // font information
    let aFontData: XclFontData = { ...this.maAppFont };
    for (const para of pTextObj.GetParagraphs()) {
      let aParaText = '';
      let nParaHeight = 0;
      const cuts = new Set([0, para.aText.length]);
      for (const r of para.maCharAttribs) { cuts.add(r.nStart); cuts.add(r.nEnd); }
      const pos = [...cuts].filter((x) => x >= 0 && x <= para.aText.length).sort((a, b) => a - b);
      for (let i = 0; i + 1 < pos.length; i++) {
        const a = pos[i]!, b = pos[i + 1]!;
        if (a >= b) continue;
        const attr: Record<string, unknown> = {};
        for (const r of para.maCharAttribs) if (r.nStart <= a && r.nEnd >= b) Object.assign(attr, r.aAttribs);

        // --- font attributes ---
        const aNewData: XclFontData = {
          maName: (attr.ATTR_FONT as string | undefined) ?? this.maAppFont.maName,
          mnHeight: attr.ATTR_FONT_HEIGHT !== undefined ? Math.trunc(((attr.ATTR_FONT_HEIGHT as number) + 10) / 20) : this.maAppFont.mnHeight,
          mbBold: !!attr.ATTR_FONT_WEIGHT, mbItalic: !!attr.ATTR_FONT_POSTURE,
          mnUnderline: (attr.ATTR_FONT_UNDERLINE as string | undefined) ?? 'none',
          mbStrikeout: !!attr.ATTR_FONT_CROSSEDOUT,
          maColor: (attr.ATTR_FONT_COLOR as string | null | undefined) ?? null,
          mnEscapem: Math.sign((attr.ESCAPEMENT as number | undefined) ?? 0),
        };
        // font name and style
        const bNewFont = aFontData.maName !== aNewData.maName;
        const bNewStyle = (aFontData.mbBold !== aNewData.mbBold) || (aFontData.mbItalic !== aNewData.mbItalic);
        if (bNewFont || bNewStyle) {
          const aStyle = aNewData.mbBold && aNewData.mbItalic ? 'Bold Italic' : aNewData.mbBold ? 'Bold' : aNewData.mbItalic ? 'Italic' : 'Regular';
          aParaText += `&"${aNewData.maName},${aStyle}"`;
        }
        // height
        const bFontHtChanged = aFontData.mnHeight !== aNewData.mnHeight;
        if (bFontHtChanged) aParaText += `&${aNewData.mnHeight}`;
        // update maximum paragraph height, convert to twips
        nParaHeight = Math.max(nParaHeight, aNewData.mnHeight * 20);
        // underline
        if (aFontData.mnUnderline !== aNewData.mnUnderline) {
          const nTmpUnderl = aNewData.mnUnderline === 'none' ? aFontData.mnUnderline : aNewData.mnUnderline;
          aParaText += nTmpUnderl === 'double' ? '&E' : '&U';
        }
        // font color
        if ((aFontData.maColor ?? '#000000') !== (aNewData.maColor ?? '#000000')) aParaText += `&K${(aNewData.maColor ?? '#000000').slice(1).toUpperCase()}`;
        // strikeout
        if (aFontData.mbStrikeout !== aNewData.mbStrikeout) aParaText += '&S';
        // super/sub script
        if (aFontData.mnEscapem !== aNewData.mnEscapem) {
          switch (aNewData.mnEscapem) {
            // close the previous super/sub script.
            case 0: aParaText += aFontData.mnEscapem > 0 ? '&X' : '&Y'; break;
            case 1: aParaText += '&X'; break;
            case -1: aParaText += '&Y'; break;
          }
        }
        aFontData = aNewData;

        // --- text content or text fields ---
        const field = attr.FIELD as string | undefined;
        if (field) {
          switch (field) {
            case 'PAGE': aParaText += '&P'; break;
            case 'PAGES': aParaText += '&N'; break;
            case 'DATE': aParaText += '&D'; break;
            case 'TIME': aParaText += '&T'; break;
            case 'TABLE': aParaText += '&A'; break;
            case 'FILE': case 'TITLE': aParaText += '&F'; break; // title -> file name
          }
        } else {
          const aPortionText = para.aText.slice(a, b).replace(/&/g, '&&');
          // #i17440# space between font height and numbers in text
          if (bFontHtChanged && aParaText.length && aPortionText) {
            const cLast = aParaText[aParaText.length - 1]!, cFirst = aPortionText[0]!;
            if (cLast >= '0' && cLast <= '9' && cFirst >= '0' && cFirst <= '9') aParaText += ' ';
          }
          aParaText += aPortionText;
        }
      }
      aLines.push(aParaText);
      if (nParaHeight === 0) nParaHeight = aFontData.mnHeight * 20; // points -> twips
      nHeight += nParaHeight;
    }
    const aText = aLines.join('\n');
    if (aText) {
      this.maHFString += `&${cPortionCode}${aText}`;
      this.mnTotalHeight = Math.max(this.mnTotalHeight, nHeight);
    }
  }
}

const hfOf = (it: ScPageHFItem) => [it.pLeftArea, it.pCenterArea, it.pRightArea] as const;

/** XclExpPageSettings::SaveXml: the page setup elements of a sheet, and fitToPage for sheetPr. */
export function SavePageSettingsXml(rDoc: ScDocument, nTab: number, rDefFontName: string, nDefFontHeight: number): { xml: string; bFitToPages: boolean } {
  const pStyle = rDoc.GetStyleSheetPool().Find(rDoc.GetPageStyle(nTab), SfxStyleFamily.Page);
  const get = <K extends keyof ScItems>(k: K): ScItems[K] => (pStyle ? pStyle.GetItem(k) : SC_POOL_DEFAULTS[k]);
  const has = (k: keyof ScItems) => !!pStyle && pStyle.GetItemSet()[k] !== undefined;

  // *** page settings ***
  const mbPrintInRows = !get('ATTR_PAGE_TOPDOWN');
  const nStartPage = get('ATTR_PAGE_FIRSTPAGENO');
  const mbManualStart = !!nStartPage;
  const rLR = get('ATTR_LRSPACE'), rUL = get('ATTR_ULSPACE');
  const mfLeftMargin = GetInchFromTwips(rLR.nLeft);
  const mfRightMargin = GetInchFromTwips(rLR.nRight);
  let mfTopMargin = GetInchFromTwips(rUL.nUpper);
  let mfBottomMargin = GetInchFromTwips(rUL.nLower);
  let mfHeaderMargin = 0.5, mfFooterMargin = 0.5;
  const bLandscape = get('ATTR_PAGE').bLandscape;
  const rSize = get('ATTR_PAGE_SIZE');
  // SetScPaperSize: the size in portrait orientation
  const nWidth = bLandscape ? Math.min(rSize.nWidth, rSize.nHeight) : rSize.nWidth;
  const nHeight = bLandscape ? Math.max(rSize.nWidth, rSize.nHeight) : rSize.nHeight;
  const nPaperSize = getMSPaperSizeIndex(twipToMm100(nWidth), twipToMm100(nHeight));

  const rScaleTo = get('ATTR_PAGE_SCALETO');
  const nPages = get('ATTR_PAGE_SCALETOPAGES');
  const nScale = get('ATTR_PAGE_SCALE');
  let mnFitToWidth = 1, mnFitToHeight = 1, mnScaling = 100, mbFitToPages = false;
  if (has('ATTR_PAGE_SCALETO') && (rScaleTo.nWidth || rScaleTo.nHeight)) {
    mnFitToWidth = rScaleTo.nWidth;
    mnFitToHeight = rScaleTo.nHeight;
    mbFitToPages = true;
  } else if (has('ATTR_PAGE_SCALETOPAGES') && nPages) {
    mnFitToWidth = 1;
    mnFitToHeight = nPages;
    mbFitToPages = true;
  } else if (nScale) {
    mnScaling = nScale;
  }

  // *** header and footer ***
  const aHFConv = new XclExpHFConverter(rDefFontName, nDefFontHeight);
  let mbUseEvenHF = false, mbUseFirstHF = false;
  const hf = { header: '', footer: '', headerEven: '', footerEven: '', headerFirst: '', footerFirst: '' };
  const one = (bHeader: boolean) => {
    const rSet = get(bHeader ? 'ATTR_PAGE_HEADERSET' : 'ATTR_PAGE_FOOTERSET');
    if (!rSet.bOn) return;
    aHFConv.GenerateString(...hfOf(get(bHeader ? 'ATTR_PAGE_HEADERRIGHT' : 'ATTR_PAGE_FOOTERRIGHT')));
    const aMain = aHFConv.GetHFString();
    const nMainHeight = aHFConv.GetTotalHeight();
    let aEven = aMain, aFirst = aMain;
    if (!rSet.bShared) {
      aHFConv.GenerateString(...hfOf(get(bHeader ? 'ATTR_PAGE_HEADERLEFT' : 'ATTR_PAGE_FOOTERLEFT')));
      aEven = aHFConv.GetHFString();
      mbUseEvenHF = true;
    }
    if (!rSet.bSharedFirst) {
      aHFConv.GenerateString(...hfOf(get(bHeader ? 'ATTR_PAGE_HEADERFIRST' : 'ATTR_PAGE_FOOTERFIRST')));
      aFirst = aHFConv.GetHFString();
      mbUseFirstHF = true;
    }
    // height (Excel excludes header and footer from the margins)
    const nHdrHeight = rSet.bDynamic
      // dynamic height: calculate header height, add header <-> sheet area distance
      ? nMainHeight + (bHeader ? rSet.nLower : rSet.nUpper)
      // static height: ATTR_PAGE_SIZE already includes header <-> sheet area distance
      : rSet.nHeight;
    if (bHeader) {
      hf.header = aMain; hf.headerEven = aEven; hf.headerFirst = aFirst;
      mfHeaderMargin = mfTopMargin;
      mfTopMargin += GetInchFromTwips(nHdrHeight);
    } else {
      hf.footer = aMain; hf.footerEven = aEven; hf.footerFirst = aFirst;
      mfFooterMargin = mfBottomMargin;
      mfBottomMargin += GetInchFromTwips(nHdrHeight);
    }
  };
  one(true);
  one(false);

  const n = (f: number) => String(Math.round(f * 1e10) / 1e10);
  let xml = `<printOptions headings="${ToPsz(get('ATTR_PAGE_HEADERS'))}" gridLines="${ToPsz(get('ATTR_PAGE_GRID'))}" gridLinesSet="true" horizontalCentered="${ToPsz(get('ATTR_PAGE_HORCENTER'))}" verticalCentered="${ToPsz(get('ATTR_PAGE_VERCENTER'))}"/>`;
  xml += `<pageMargins left="${n(mfLeftMargin)}" right="${n(mfRightMargin)}" top="${n(mfTopMargin)}" bottom="${n(mfBottomMargin)}" header="${n(mfHeaderMargin)}" footer="${n(mfFooterMargin)}"/>`;
  // XclExpSetup::SaveXml
  xml += '<pageSetup' + (nPaperSize ? ` paperSize="${nPaperSize}"` : ` paperHeight="${Math.round(twipToMm100(nHeight) / 100)}mm" paperWidth="${Math.round(twipToMm100(nWidth) / 100)}mm"`)
    + ` scale="${mnScaling}" fitToWidth="${mnFitToWidth}" fitToHeight="${mnFitToHeight}" pageOrder="${mbPrintInRows ? 'overThenDown' : 'downThenOver'}" orientation="${bLandscape ? 'landscape' : 'portrait'}"`
    + ` blackAndWhite="false" draft="false" cellComments="${get('ATTR_PAGE_NOTES') ? 'atEnd' : 'none'}"`
    + (mbManualStart ? ` firstPageNumber="${nStartPage}" useFirstPageNumber="true"` : '')
    + ' horizontalDpi="300" verticalDpi="300" copies="1"/>';
  xml += `<headerFooter differentFirst="${ToPsz(mbUseFirstHF)}" differentOddEven="${ToPsz(mbUseEvenHF)}">`;
  const el = (name: string, s: string) => (s ? `<${name}>${escapeXml(s)}</${name}>` : '');
  xml += el('oddHeader', hf.header) + el('oddFooter', hf.footer);
  if (mbUseEvenHF) xml += el('evenHeader', hf.headerEven) + el('evenFooter', hf.footerEven);
  if (mbUseFirstHF) xml += el('firstHeader', hf.headerFirst) + el('firstFooter', hf.footerFirst);
  xml += '</headerFooter>';
  return { xml, bFitToPages: mbFitToPages };
}
