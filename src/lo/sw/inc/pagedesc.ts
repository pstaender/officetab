// SPDX-License-Identifier: MPL-2.0
// @upstream sw/inc/pagedesc.hxx reduced

/** Page geometry in twips; defaults are A4 with 2 cm margins, as in Writer's Default Page Style. */
export class SwPageDesc {
  m_aName = 'Default Page Style';
  nWidth = 11906;
  nHeight = 16838;
  nLeft = 1134;
  nRight = 1134;
  nTop = 1134;
  nBottom = 1134;

  /** Header and footer frame formats: minimum height and spacing to the body (5 mm by default). */
  nHeaderMinHeight = 0;
  nHeaderSpacing = 283;
  nFooterMinHeight = 0;
  nFooterSpacing = 283;

  PrintWidth(): number { return this.nWidth - this.nLeft - this.nRight; }
  PrintHeight(): number { return this.nHeight - this.nTop - this.nBottom; }
}
