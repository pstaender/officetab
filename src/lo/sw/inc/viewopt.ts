// SPDX-License-Identifier: MPL-2.0
// @upstream sw/inc/viewopt.hxx partial
// @upstream sw/source/uibase/config/viewopt.cxx partial
// Only the options of View > Web, View > Rulers and View > Grid and Helplines. The snap size is
// the metric one (1 cm); upstream uses 1/2" where the locale measures in inches. The rulers'
// defaults are those of Office.Writer/Layout/Window (HorizontalRuler on, VerticalRuler off),
// which SwMasterUsrPref loads over the constructor's.
import { Size } from '../../tools/source/generic/gen.ts';

export const ViewOptFlags2 = {
  HRuler: 0x00000400,
  VScrollbar: 0x00000800,
  HScrollbar: 0x00001000,
  VRuler: 0x00004000,
  AnyRuler: 0x00008000,
  Modified: 0x00010000,
  KeepAspectRatio: 0x00020000,
  GrfKeepZoom: 0x00040000,
  ContentTips: 0x00100000,
  ScrollbarTips: 0x00400000,
  PrintFormat: 0x00800000,
  ShadowCursor: 0x01000000,
  VRulerRight: 0x02000000,
  ResolvedPostits: 0x04000000,
} as const;

/** svtools::ColorConfig's WRITERTEXTGRID: COL_GRAY7 in both the light and the dark scheme. */
const COL_GRAY7 = '#666666';

export class SwViewOption {
  /** ViewOptFlags1, the bits of SwViewShell used here. */
  m_nCoreOptions = { bSnap: false, bGridVisible: false, bCrosshair: false };
  m_nUIOptions: number;
  /** Describes horizontal and vertical snap. */
  m_aSnapSize = new Size();
  /** Grid division. */
  m_nDivisionX: number;
  m_nDivisionY: number;
  m_aTextGridColor = COL_GRAY7;
  m_bReadonly = false;
  mbBrowseMode = false;

  constructor() {
    this.m_nUIOptions =
      ViewOptFlags2.Modified |
      ViewOptFlags2.GrfKeepZoom |
      ViewOptFlags2.ResolvedPostits |
      ViewOptFlags2.AnyRuler;

    this.m_aSnapSize.setWidth(567); // 1 cm
    this.m_aSnapSize.setHeight(567); // 1 cm
    this.m_nDivisionX = this.m_nDivisionY = 1;
    // Office.Writer/Layout/Window/HorizontalRuler and VerticalRuler.
    this.SetViewHRuler(true);
    this.SetViewVRuler(false);
  }

  IsSnap(): boolean { return this.m_nCoreOptions.bSnap; }
  SetSnap(b: boolean): void { this.m_nCoreOptions.bSnap = b; }

  SetSnapSize(rSz: Size): void { this.m_aSnapSize = rSz; }
  GetSnapSize(): Size { return this.m_aSnapSize; }

  IsGridVisible(): boolean { return !this.m_bReadonly && this.m_nCoreOptions.bGridVisible; }
  SetGridVisible(b: boolean): void { this.m_nCoreOptions.bGridVisible = b; }

  IsCrossHair(): boolean { return this.m_nCoreOptions.bCrosshair; }
  SetCrossHair(b: boolean): void { this.m_nCoreOptions.bCrosshair = b; }

  GetDivisionX(): number { return this.m_nDivisionX; }
  SetDivisionX(n: number): void { this.m_nDivisionX = n; }
  GetDivisionY(): number { return this.m_nDivisionY; }
  SetDivisionY(n: number): void { this.m_nDivisionY = n; }

  getBrowseMode(): boolean { return this.mbBrowseMode; }
  setBrowseMode(bSet: boolean): void { this.mbBrowseMode = bSet; }

  SetUIOption(b: boolean, f: number): void {
    if (b) this.m_nUIOptions |= f;
    else this.m_nUIOptions &= ~f;
  }

  IsViewAnyRuler(): boolean { return !!(this.m_nUIOptions & ViewOptFlags2.AnyRuler); }
  SetViewAnyRuler(bSet: boolean): void { this.SetUIOption(bSet, ViewOptFlags2.AnyRuler); }

  IsViewHRuler(bDirect = false): boolean {
    return bDirect
      ? !!(this.m_nUIOptions & ViewOptFlags2.HRuler)
      : !this.m_bReadonly && (this.m_nUIOptions & (ViewOptFlags2.AnyRuler | ViewOptFlags2.HRuler)) === (ViewOptFlags2.AnyRuler | ViewOptFlags2.HRuler);
  }
  SetViewHRuler(b: boolean): void { this.SetUIOption(b, ViewOptFlags2.HRuler); }

  IsViewVRuler(bDirect = false): boolean {
    return bDirect
      ? !!(this.m_nUIOptions & ViewOptFlags2.VRuler)
      : !this.m_bReadonly && (this.m_nUIOptions & (ViewOptFlags2.AnyRuler | ViewOptFlags2.VRuler)) === (ViewOptFlags2.AnyRuler | ViewOptFlags2.VRuler);
  }
  SetViewVRuler(b: boolean): void { this.SetUIOption(b, ViewOptFlags2.VRuler); }

  /** Move the vertical ruler to the right. */
  IsVRulerRight(): boolean { return !!(this.m_nUIOptions & ViewOptFlags2.VRulerRight); }
  SetVRulerRight(b: boolean): void { this.SetUIOption(b, ViewOptFlags2.VRulerRight); }

  GetTextGridColor(): string { return this.m_aTextGridColor; }
}
