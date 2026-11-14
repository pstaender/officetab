// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/ui/misc/pagenumberdlg.cxx reduced
// @upstream sw/source/uibase/inc/pagenumberdlg.hxx faithful
// SwPageNumberDlg without its widgets: each weld control is a plain state (the active entry, the
// check state and whether it is sensitive) that the view shows and changes through the dialog's
// handlers. updateImage describes what it draws on its VirtualDevice (the text, its rectangle and
// DrawTextFlags) instead of setting an image, and the entries of the numbering type list box
// (SvxPageNumberListBox, GetI18nNumbering) are left to the view. OkHdl is the view's submit.
import { NumberingType } from '../../../../i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';

/** weld::ComboBox: the active entry. */
export interface SwPageNumberDlgComboBox { active: number }
/** weld::CheckButton: TRISTATE_TRUE or TRISTATE_FALSE, and whether it can be changed. */
export interface SwPageNumberDlgCheckButton { state: boolean; sensitive: boolean }

/** The DrawTextFlags updateImage combines. */
export const DrawTextFlags = { Left: 0x0002, Center: 0x0004, Right: 0x0008, Top: 0x0010, Bottom: 0x0040 } as const;

/** What updateImage draws on its VirtualDevice. */
export interface SwPageNumberDlgImage {
  /** The output size of the VirtualDevice, in pixels. */
  nWidth: number;
  nHeight: number;
  /** SetBackground: Color(0xF0, 0xF0, 0xF0). */
  aBackground: string;
  sText: string;
  /** The rectangle the text is drawn in: left, top, right, bottom. */
  aRect: [number, number, number, number];
  eFlags: number;
}

const checkButton = (state: boolean): SwPageNumberDlgCheckButton => ({ state, sensitive: true });

/// Page number wizard for easy header/footer page number insertion
export class SwPageNumberDlg {
  m_xPageNumberPosition: SwPageNumberDlgComboBox;
  m_xPageNumberAlignment: SwPageNumberDlgComboBox;
  m_xMirrorOnEvenPages: SwPageNumberDlgCheckButton;
  m_xIncludePageTotal: SwPageNumberDlgCheckButton;
  m_xIncludePageRangeTotal: SwPageNumberDlgCheckButton;
  m_xFitIntoExistingMargins: SwPageNumberDlgCheckButton;
  /** SvxPageNumberListBox: the active entry's id, a css::style::NumberingType. */
  m_xPageNumberTypeLB: { active_id: number };

  m_xPreviewImage: SwPageNumberDlgImage | null = null;

  m_aPageNumberPosition: number;
  m_aPageNumberAlignment: number;
  m_nPageNumberType: number;

  constructor() {
    this.m_xPageNumberPosition = { active: 0 };
    this.m_xPageNumberAlignment = { active: 0 };
    this.m_xMirrorOnEvenPages = checkButton(false);
    this.m_xIncludePageTotal = checkButton(false);
    this.m_xIncludePageRangeTotal = checkButton(false);
    this.m_xFitIntoExistingMargins = checkButton(false);
    this.m_xPageNumberTypeLB = { active_id: NumberingType.CHARS_UPPER_LETTER };
    this.m_aPageNumberPosition = 1; // bottom
    this.m_aPageNumberAlignment = 1; // center
    this.m_nPageNumberType = NumberingType.CHARS_UPPER_LETTER;

    this.m_xPageNumberPosition.active = this.m_aPageNumberPosition;
    this.m_xPageNumberAlignment.active = this.m_aPageNumberAlignment;
    this.m_xMirrorOnEvenPages.sensitive = false;
    this.m_xMirrorOnEvenPages.state = true;
    this.m_xIncludePageTotal.state = false;
    this.m_xIncludePageRangeTotal.state = false;
    this.m_xFitIntoExistingMargins.state = false;
    this.updateImage();
  }

  PositionSelectHdl(nActive: number): void {
    this.m_xPageNumberPosition.active = nActive;
    this.m_aPageNumberPosition = this.m_xPageNumberPosition.active;
    this.updateImage();
  }

  AlignmentSelectHdl(nActive: number): void {
    this.m_xPageNumberAlignment.active = nActive;
    this.m_aPageNumberAlignment = this.m_xPageNumberAlignment.active;
    this.updateImage();

    if (this.m_aPageNumberAlignment === 1) // centered
      this.m_xMirrorOnEvenPages.sensitive = false;
    else
      this.m_xMirrorOnEvenPages.sensitive = true;
  }

  NumberTypeSelectHdl(nActiveId: number): void {
    this.m_xPageNumberTypeLB.active_id = nActiveId;
    this.m_nPageNumberType = this.m_xPageNumberTypeLB.active_id;
  }

  IncludePageTotalChangeHdl(bState: boolean): void {
    this.m_xIncludePageTotal.state = bState;
    this.m_xIncludePageRangeTotal.sensitive = !this.m_xIncludePageTotal.state;
    this.updateImage();
  }

  IncludePageRangeTotalChangeHdl(bState: boolean): void {
    this.m_xIncludePageRangeTotal.state = bState;
    this.m_xIncludePageTotal.sensitive = !this.m_xIncludePageRangeTotal.state;
    this.updateImage();
  }

  /** The mirror check box has no handler upstream: toggling it only changes its state. */
  MirrorOnEvenPagesToggled(bState: boolean): void { this.m_xMirrorOnEvenPages.state = bState; }
  /** As MirrorOnEvenPagesToggled, for "Fit into existing margins". */
  FitIntoExistingMarginsToggled(bState: boolean): void { this.m_xFitIntoExistingMargins.state = bState; }

  GetPageNumberPosition(): number { return this.m_aPageNumberPosition; }
  GetPageNumberAlignment(): number { return this.m_aPageNumberAlignment; }

  GetMirrorOnEvenPages(): boolean {
    return this.m_xMirrorOnEvenPages.sensitive
      && this.m_xMirrorOnEvenPages.state;
  }

  GetIncludePageTotal(): boolean {
    return this.m_xIncludePageTotal.state;
  }

  GetIncludePageRangeTotal(): boolean {
    return this.m_xIncludePageRangeTotal.state;
  }

  GetFitIntoExistingMargins(): boolean {
    return this.m_xFitIntoExistingMargins.state;
  }

  GetPageNumberType(): number { return this.m_nPageNumberType; }

  SetPageNumberType(nSet: number): void {
    this.m_nPageNumberType = nSet;
    this.m_xPageNumberTypeLB.active_id = nSet;
  }

  updateImage(): void {
    const nBackgroundWidth = 75;
    const nBackgroundHeight = 105;

    const nMargin = 7;

    let sText = '#';

    if (this.m_xIncludePageTotal.state
      || this.m_xIncludePageRangeTotal.state) {
      sText += ' / #';
    }

    let eFlags: number = DrawTextFlags.Left;

    if (this.m_aPageNumberAlignment === 1) {
      eFlags = DrawTextFlags.Center;
    } else if (this.m_aPageNumberAlignment === 2) {
      eFlags = DrawTextFlags.Right;
    }

    eFlags |= this.m_aPageNumberPosition ? DrawTextFlags.Bottom : DrawTextFlags.Top;

    this.m_xPreviewImage = {
      nWidth: nBackgroundWidth, nHeight: nBackgroundHeight, aBackground: '#f0f0f0', sText,
      aRect: [nMargin, nMargin, nBackgroundWidth - nMargin, nBackgroundHeight - nMargin], eFlags,
    };
  }
}
