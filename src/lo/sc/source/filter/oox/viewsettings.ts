// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/filter/oox/viewsettings.cxx reduced
// SheetViewSettings and ViewSettings: the sheetView (with pane and selection) of each sheet and
// the workbook's bookViews, converted into the view settings the shell's view uses (ScViewSettings
// of the ODS filter, the properties upstream puts into the document's view data). Reduced: only
// the first sheet view and workbook view are used (as upstream); the selection ranges, window
// positions, the OLE size and the chart sheet special case are left out; a split (not frozen)
// position is converted from twips to the pixels ScViewSettings keeps.
import { ScSplitMode, ScSplitPos, DefaultViewSettings, DefaultViewSettingsTable, type ScViewSettings, type ScViewSettingsTable } from '../xml/ods.ts';
import type { AttributeList } from '../../../../oox/source/helper/attributelist.ts';
import { parseOoxAddress2d } from './addressconverter.ts';
import { OOX_COLOR_WINDOWTEXT, XlsColor, type StylesBuffer } from './stylesbuffer.ts';

const OOX_SHEETVIEW_NORMALZOOM_DEF = 100; /// Default zoom for normal view.
const OOX_SHEETVIEW_SHEETLAYZOOM_DEF = 60; /// Default zoom for pagebreak preview.
const API_ZOOMVALUE_MIN = 20; /// Minimum zoom in Calc.
const API_ZOOMVALUE_MAX = 400; /// Maximum zoom in Calc.

interface PaneSelectionModel { maActiveCell: { nCol: number; nRow: number } | null }

export interface SheetViewModel {
  maGridColor: XlsColor;
  maFirstPos: { nCol: number; nRow: number };
  maSecondPos: { nCol: number; nRow: number };
  mnViewType: string;
  mnActivePaneId: string;
  mnPaneState: string;
  mfSplitX: number;
  mfSplitY: number;
  mnCurrentZoom: number;
  mnNormalZoom: number;
  mnSheetLayoutZoom: number;
  mbSelected: boolean;
  mbRightToLeft: boolean;
  mbDefGridColor: boolean;
  mbShowFormulas: boolean;
  mbShowGrid: boolean;
  mbShowHeadings: boolean;
  mbShowZeros: boolean;
  mbShowOutline: boolean;
  maPaneSelMap: Map<string, PaneSelectionModel>;
}

const newSheetViewModel = (): SheetViewModel => {
  const c = new XlsColor(); c.setIndexed(OOX_COLOR_WINDOWTEXT);
  return {
    maGridColor: c, maFirstPos: { nCol: 0, nRow: 0 }, maSecondPos: { nCol: 0, nRow: 0 }, mnViewType: 'normal', mnActivePaneId: 'topLeft',
    mnPaneState: 'split', mfSplitX: 0, mfSplitY: 0, mnCurrentZoom: 0, mnNormalZoom: 0, mnSheetLayoutZoom: 0, mbSelected: false,
    mbRightToLeft: false, mbDefGridColor: true, mbShowFormulas: false, mbShowGrid: true, mbShowHeadings: true, mbShowZeros: true,
    mbShowOutline: true, maPaneSelMap: new Map(),
  };
};

const isPageBreakPreview = (m: SheetViewModel) => m.mnViewType === 'pageBreakPreview';
function getNormalZoom(m: SheetViewModel): number {
  const rnZoom = isPageBreakPreview(m) ? m.mnNormalZoom : m.mnCurrentZoom;
  const nZoom = (rnZoom > 0) ? rnZoom : OOX_SHEETVIEW_NORMALZOOM_DEF;
  return Math.max(API_ZOOMVALUE_MIN, Math.min(API_ZOOMVALUE_MAX, nZoom));
}
function getPageBreakZoom(m: SheetViewModel): number {
  const rnZoom = isPageBreakPreview(m) ? m.mnCurrentZoom : m.mnSheetLayoutZoom;
  const nZoom = (rnZoom > 0) ? rnZoom : OOX_SHEETVIEW_SHEETLAYZOOM_DEF;
  return Math.max(API_ZOOMVALUE_MIN, Math.min(API_ZOOMVALUE_MAX, nZoom));
}
/** getActiveSelection: the selection of the active pane. */
const getActiveSelection = (m: SheetViewModel): PaneSelectionModel | undefined => m.maPaneSelMap.get(m.mnActivePaneId);

const pos = (s: string | undefined) => (s && parseOoxAddress2d(s)) || { nCol: 0, nRow: 0 };

export class SheetViewSettings {
  private maSheetViews: SheetViewModel[] = [];

  importSheetView(rAttribs: AttributeList): void {
    const xModel = this.createSheetView();
    xModel.maGridColor.setIndexed(rAttribs.getInteger('colorId', OOX_COLOR_WINDOWTEXT));
    xModel.maFirstPos = pos(rAttribs.getString('topLeftCell'));
    xModel.mnViewType = rAttribs.getToken('view', 'normal');
    xModel.mnCurrentZoom = rAttribs.getInteger('zoomScale', 100);
    xModel.mnNormalZoom = rAttribs.getInteger('zoomScaleNormal', 0);
    xModel.mnSheetLayoutZoom = rAttribs.getInteger('zoomScaleSheetLayoutView', 0);
    xModel.mbSelected = rAttribs.getBool('tabSelected', false);
    xModel.mbRightToLeft = rAttribs.getBool('rightToLeft', false);
    xModel.mbDefGridColor = rAttribs.getBool('defaultGridColor', true);
    xModel.mbShowFormulas = rAttribs.getBool('showFormulas', false);
    xModel.mbShowGrid = rAttribs.getBool('showGridLines', true);
    xModel.mbShowHeadings = rAttribs.getBool('showRowColHeaders', true);
    xModel.mbShowZeros = rAttribs.getBool('showZeros', true);
    xModel.mbShowOutline = rAttribs.getBool('showOutlineSymbols', true);
  }

  importPane(rAttribs: AttributeList): void {
    const rModel = this.maSheetViews[this.maSheetViews.length - 1];
    if (!rModel) return;
    rModel.maSecondPos = pos(rAttribs.getString('topLeftCell'));
    rModel.mnActivePaneId = rAttribs.getToken('activePane', 'topLeft');
    rModel.mnPaneState = rAttribs.getToken('state', 'split');
    rModel.mfSplitX = rAttribs.getDouble('xSplit', 0.0);
    rModel.mfSplitY = rAttribs.getDouble('ySplit', 0.0);
  }

  importSelection(rAttribs: AttributeList): void {
    const rModel = this.maSheetViews[this.maSheetViews.length - 1];
    if (!rModel) return;
    // pane this selection belongs to
    const nPaneId = rAttribs.getToken('pane', 'topLeft');
    // cursor position
    const s = rAttribs.getString('activeCell');
    rModel.maPaneSelMap.set(nPaneId, { maActiveCell: s ? parseOoxAddress2d(s) : null });
  }

  isSheetRightToLeft(): boolean { return this.maSheetViews.length > 0 && this.maSheetViews[0]!.mbRightToLeft; }

  /** finalizeImport: the sheet's view settings, and whether the sheet is selected. */
  finalizeImport(bActive: boolean, nMaxCol: number, nMaxRow: number): { aTable: ScViewSettingsTable; xModel: SheetViewModel; bSelected: boolean } {
    // force creation of sheet view model to get the Excel defaults
    const xModel = this.maSheetViews.length ? this.maSheetViews[0]! : this.createSheetView();

    // sheet selected (active sheet must be selected)
    const bSelected = xModel.mbSelected || bActive;

    // visible area and current cursor position (selection not supported via API)
    const aFirstPos = xModel.maFirstPos;
    const pPaneSel = getActiveSelection(xModel);
    const aCursor = pPaneSel?.maActiveCell ?? aFirstPos;

    // freeze/split position default
    let nHSplitMode: ScSplitMode = ScSplitMode.SC_SPLIT_NONE;
    let nVSplitMode: ScSplitMode = ScSplitMode.SC_SPLIT_NONE;
    let nHSplitPos = 0;
    let nVSplitPos = 0;
    // active pane default
    let nActivePane: ScSplitPos = ScSplitPos.SC_SPLIT_BOTTOMLEFT;

    // freeze/split position
    if ((xModel.mnPaneState === 'frozen') || (xModel.mnPaneState === 'frozenSplit')) {
      /*  Frozen panes: handle split position as row/column positions.
          #i35812# Excel uses number of visible rows/columns in the
              frozen area (rows/columns scrolled outside are not included),
              Calc uses absolute position of first unfrozen row/column. */
      if ((xModel.mfSplitX >= 1.0) && (xModel.maFirstPos.nCol + xModel.mfSplitX <= nMaxCol)) nHSplitPos = Math.trunc(xModel.maFirstPos.nCol + xModel.mfSplitX);
      nHSplitMode = (nHSplitPos > 0) ? ScSplitMode.SC_SPLIT_FIX : ScSplitMode.SC_SPLIT_NONE;
      if ((xModel.mfSplitY >= 1.0) && (xModel.maFirstPos.nRow + xModel.mfSplitY <= nMaxRow)) nVSplitPos = Math.trunc(xModel.maFirstPos.nRow + xModel.mfSplitY);
      nVSplitMode = (nVSplitPos > 0) ? ScSplitMode.SC_SPLIT_FIX : ScSplitMode.SC_SPLIT_NONE;
    } else if (xModel.mnPaneState === 'split') {
      // split window: view settings API uses twips (here: pixels at 96 dpi)
      nHSplitPos = Math.round(Math.max(0, Math.trunc(xModel.mfSplitX + 0.5)) / 15);
      nHSplitMode = (nHSplitPos > 0) ? ScSplitMode.SC_SPLIT_NORMAL : ScSplitMode.SC_SPLIT_NONE;
      nVSplitPos = Math.round(Math.max(0, Math.trunc(xModel.mfSplitY + 0.5)) / 15);
      nVSplitMode = (nVSplitPos > 0) ? ScSplitMode.SC_SPLIT_NORMAL : ScSplitMode.SC_SPLIT_NONE;
    }

    // active pane
    switch (xModel.mnActivePaneId) {
      // no horizontal split -> always use left panes
      // no vertical split -> always use *bottom* panes
      case 'topLeft':
        nActivePane = (nVSplitMode === ScSplitMode.SC_SPLIT_NONE) ? ScSplitPos.SC_SPLIT_BOTTOMLEFT : ScSplitPos.SC_SPLIT_TOPLEFT;
        break;
      case 'topRight':
        nActivePane = (nHSplitMode === ScSplitMode.SC_SPLIT_NONE)
          ? ((nVSplitMode === ScSplitMode.SC_SPLIT_NONE) ? ScSplitPos.SC_SPLIT_BOTTOMLEFT : ScSplitPos.SC_SPLIT_TOPLEFT)
          : ((nVSplitMode === ScSplitMode.SC_SPLIT_NONE) ? ScSplitPos.SC_SPLIT_BOTTOMRIGHT : ScSplitPos.SC_SPLIT_TOPRIGHT);
        break;
      case 'bottomLeft':
        nActivePane = ScSplitPos.SC_SPLIT_BOTTOMLEFT;
        break;
      case 'bottomRight':
        nActivePane = (nHSplitMode === ScSplitMode.SC_SPLIT_NONE) ? ScSplitPos.SC_SPLIT_BOTTOMLEFT : ScSplitPos.SC_SPLIT_BOTTOMRIGHT;
        break;
    }

    // write the sheet view settings into the property sequence
    const aTable: ScViewSettingsTable = {
      ...DefaultViewSettingsTable(),
      CursorPositionX: aCursor.nCol, CursorPositionY: aCursor.nRow,
      HorizontalSplitMode: nHSplitMode, VerticalSplitMode: nVSplitMode,
      HorizontalSplitPosition: nHSplitPos, VerticalSplitPosition: nVSplitPos,
      ActiveSplitRange: nActivePane,
      PositionLeft: aFirstPos.nCol, PositionTop: aFirstPos.nRow,
      PositionRight: xModel.maSecondPos.nCol,
      PositionBottom: (nVSplitPos > 0) ? xModel.maSecondPos.nRow : xModel.maFirstPos.nRow,
      ZoomType: 0, ZoomValue: getNormalZoom(xModel), PageViewZoomValue: getPageBreakZoom(xModel),
      ShowGrid: xModel.mbShowGrid,
    };
    return { aTable, xModel, bSelected };
  }

  private createSheetView(): SheetViewModel {
    const xModel = newSheetViewModel();
    this.maSheetViews.push(xModel);
    return xModel;
  }
}

export interface WorkbookViewModel { mnActiveSheet: number; mnFirstVisSheet: number; mnTabBarWidth: number; mbShowTabBar: boolean; mbShowHorScroll: boolean; mbShowVerScroll: boolean }

export class ViewSettings {
  private maBookViews: WorkbookViewModel[] = [];
  private maSheetViews = new Map<number, { aTable: ScViewSettingsTable; xModel: SheetViewModel }>();

  importWorkbookView(rAttribs: AttributeList): void {
    this.maBookViews.push({
      mnActiveSheet: rAttribs.getInteger('activeTab', 0),
      mnFirstVisSheet: rAttribs.getInteger('firstSheet', 0),
      mnTabBarWidth: rAttribs.getInteger('tabRatio', 600),
      mbShowTabBar: rAttribs.getBool('showSheetTabs', true),
      mbShowHorScroll: rAttribs.getBool('showHorizontalScroll', true),
      mbShowVerScroll: rAttribs.getBool('showVerticalScroll', true),
    });
  }

  setSheetViewSettings(nSheet: number, aTable: ScViewSettingsTable, xModel: SheetViewModel): void { this.maSheetViews.set(nSheet, { aTable, xModel }); }

  /** getActiveCalcSheet: the active sheet (of the first workbook view). */
  getActiveCalcSheet(nSheetCount: number): number {
    return this.maBookViews.length ? Math.max(0, Math.min(nSheetCount - 1, this.maBookViews[0]!.mnActiveSheet)) : 0;
  }

  /** finalizeImport: the document's view settings. */
  finalizeImport(aSheetNames: string[], rStyles: StylesBuffer): ScViewSettings | undefined {
    if (aSheetNames.length <= 0) return undefined;
    // force creation of workbook view model to get the Excel defaults
    const rModel = this.maBookViews[0] ?? { mnActiveSheet: 0, mnFirstVisSheet: 0, mnTabBarWidth: 600, mbShowTabBar: true, mbShowHorScroll: true, mbShowVerScroll: true };
    const v = DefaultViewSettings();
    for (const [nSheet, { aTable }] of this.maSheetViews) if (aSheetNames[nSheet] !== undefined) v.Tables[aSheetNames[nSheet]!] = aTable;
    // use active sheet to set sheet properties that are document-global in Calc
    const nActiveSheet = this.getActiveCalcSheet(aSheetNames.length);
    const rxActiveSheetView = this.maSheetViews.get(nActiveSheet)?.xModel ?? newSheetViewModel();
    v.ActiveTable = aSheetNames[nActiveSheet] ?? '';
    v.HasSheetTabs = rModel.mbShowTabBar;
    if (!rxActiveSheetView.mbDefGridColor) v.GridColor = rStyles.getColor(rxActiveSheetView.maGridColor, null) ?? v.GridColor;
    v.ShowPageBreakPreview = isPageBreakPreview(rxActiveSheetView);
    // tdf#126541 sheet based grid visibility shouldn't overwrite the global grid visibility
    v.ShowGrid = true;
    v.HasColumnRowHeaders = rxActiveSheetView.mbShowHeadings;
    v.ShowZeroValues = rxActiveSheetView.mbShowZeros;
    v.IsOutlineSymbolsSet = rxActiveSheetView.mbShowOutline;
    v.ZoomValue = getNormalZoom(rxActiveSheetView);
    v.PageViewZoomValue = getPageBreakZoom(rxActiveSheetView);
    return v;
  }
}
