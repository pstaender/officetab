// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/filter/excel/xeview.cxx reduced
// XclExpTabViewSettings and XclExpWindow1: a sheet's sheetView (with pane and selection) and the
// workbook's bookViews, from the view settings the shell's view keeps (ScViewSettings).
// Reduced: only the cursor is written as selection; the grid colour, page break preview and
// zoom of the page layout view are left out; without view settings a default view is written.
import { ScSplitMode, ScSplitPos, type ScViewSettings } from '../xml/ods.ts';
import { FormatOoxAddress } from '../oox/addressconverter.ts';

const ToPsz = (b: boolean) => (b ? 'true' : 'false');
const PANE_NAMES: Record<number, string> = { [ScSplitPos.SC_SPLIT_TOPLEFT]: 'topLeft', [ScSplitPos.SC_SPLIT_TOPRIGHT]: 'topRight', [ScSplitPos.SC_SPLIT_BOTTOMLEFT]: 'bottomLeft', [ScSplitPos.SC_SPLIT_BOTTOMRIGHT]: 'bottomRight' };

/** XclExpTabViewSettings::SaveXml */
export function SaveSheetViewXml(v: ScViewSettings | undefined, aName: string, bSelected: boolean, bRTL: boolean): string {
  const t = v?.Tables[aName];
  if (!t) return `<sheetViews><sheetView${bRTL ? ' rightToLeft="true"' : ''} tabSelected="${ToPsz(bSelected)}" workbookViewId="0"><selection activeCell="A1" sqref="A1"/></sheetView></sheetViews>`;
  const bFrozenH = t.HorizontalSplitMode === ScSplitMode.SC_SPLIT_FIX, bFrozenV = t.VerticalSplitMode === ScSplitMode.SC_SPLIT_FIX;
  const bSplitH = t.HorizontalSplitMode !== ScSplitMode.SC_SPLIT_NONE, bSplitV = t.VerticalSplitMode !== ScSplitMode.SC_SPLIT_NONE;
  let s = `<sheetView showFormulas="false" showGridLines="${ToPsz(t.ShowGrid)}" showRowColHeaders="${ToPsz(v!.HasColumnRowHeaders)}" showZeros="${ToPsz(v!.ShowZeroValues)}"`
    + `${bRTL ? ' rightToLeft="true"' : ''} tabSelected="${ToPsz(bSelected)}" showOutlineSymbols="${ToPsz(v!.IsOutlineSymbolsSet)}" defaultGridColor="true" view="normal"`
    + ` topLeftCell="${FormatOoxAddress(t.PositionLeft, t.PositionTop)}" colorId="64" zoomScale="${t.ZoomValue}" zoomScaleNormal="${t.ZoomValue}" zoomScalePageLayoutView="${t.PageViewZoomValue}" workbookViewId="0">`;
  let aPane = 'topLeft';
  if (bSplitH || bSplitV) {
    aPane = PANE_NAMES[t.ActiveSplitRange] ?? 'bottomRight';
    if (bFrozenH || bFrozenV) {
      // frozen: the number of columns and rows in the frozen area
      const nX = bFrozenH ? t.HorizontalSplitPosition - t.PositionLeft : 0;
      const nY = bFrozenV ? t.VerticalSplitPosition - t.PositionTop : 0;
      const aSecond = FormatOoxAddress(bFrozenH ? Math.max(t.PositionRight, t.HorizontalSplitPosition) : t.PositionLeft, bFrozenV ? Math.max(t.PositionBottom, t.VerticalSplitPosition) : t.PositionTop);
      // the pane of the scrolling area (Excel's active pane of frozen panes)
      aPane = bFrozenH && bFrozenV ? 'bottomRight' : bFrozenH ? 'topRight' : 'bottomLeft';
      s += `<pane${nX > 0 ? ` xSplit="${nX}"` : ''}${nY > 0 ? ` ySplit="${nY}"` : ''} topLeftCell="${aSecond}" activePane="${aPane}" state="frozen"/>`;
    } else {
      // split: twips (the view settings keep pixels)
      s += `<pane${bSplitH ? ` xSplit="${t.HorizontalSplitPosition * 15}"` : ''}${bSplitV ? ` ySplit="${t.VerticalSplitPosition * 15}"` : ''} topLeftCell="${FormatOoxAddress(t.PositionRight, t.PositionBottom)}" activePane="${aPane}" state="split"/>`;
    }
  }
  const aCursor = FormatOoxAddress(t.CursorPositionX, t.CursorPositionY);
  s += `<selection${aPane !== 'topLeft' ? ` pane="${aPane}"` : ''} activeCell="${aCursor}" sqref="${aCursor}"/>`;
  return `<sheetViews>${s}</sheetView></sheetViews>`;
}

/** XclExpWindow1::SaveXml */
export function SaveBookViewsXml(v: ScViewSettings | undefined, nActiveTab: number): string {
  return `<bookViews><workbookView showHorizontalScroll="true" showVerticalScroll="true" showSheetTabs="${ToPsz(v ? v.HasSheetTabs : true)}" xWindow="0" yWindow="0" windowWidth="16384" windowHeight="8192" tabRatio="600" firstSheet="0" activeTab="${nActiveTab}"/></bookViews>`;
}
