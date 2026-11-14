// SPDX-License-Identifier: MPL-2.0
// @upstream cui/source/dialogs/SignatureLineDialog.cxx reduced
// @upstream cui/source/dialogs/SignatureLineDialogBase.cxx partial
// @upstream svx/source/dialog/signaturelinehelper.cxx partial
// SignatureLineDialog apart from its widgets: reading a selected signature line, and Apply, which
// fills the signature line image (share/filter/signature-line.svg, here without its Inkscape
// metadata and the exporter's desc elements) and inserts or updates the graphic. Signing
// (SignSignatureLineDialog, certificates) is not ported, so the image stays the unsigned one.
import type { SwSignatureLine } from '../../../sw/inc/frmfmt.ts';
import type { SwWrtShell } from '../../../sw/source/uibase/wrtsh/wrtsh.ts';

/** The template of share/filter/signature-line.svg: a line, an X and the signer's texts. */
const SIGNATURE_LINE_SVG = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.2" width="90mm" height="45mm" viewBox="0 0 9000 4500" preserveAspectRatio="xMidYMid" fill-rule="evenodd" stroke-width="28.222" stroke-linejoin="round" xml:space="preserve">
  <defs><clipPath id="presentation_clip_path" clipPathUnits="userSpaceOnUse"><rect x="0" y="0" width="9000" height="4500"/></clipPath></defs>
  <g clip-path="url(#presentation_clip_path)">
    <path fill="none" stroke="rgb(0,0,0)" stroke-width="53" stroke-linejoin="round" d="M 0,2400 L 9000,2400"/>
    <path fill="rgb(0,0,0)" stroke="none" d="M 969,2200 C 880,2083 792,1967 704,1850 614,1967 523,2083 433,2200 389,2200 345,2200 301,2200 413,2061 525,1923 637,1784 533,1656 430,1528 327,1400 371,1400 415,1400 459,1400 541,1505 623,1609 704,1714 784,1609 863,1505 943,1400 987,1400 1031,1400 1075,1400 975,1527 874,1653 773,1780 882,1920 992,2060 1101,2200 1057,2200 1013,2200 969,2200 Z"/>
    <text font-family="Liberation Sans, sans-serif" font-size="600px" font-weight="400" x="1550" y="2171" fill="rgb(0,0,0)">[SIGNATURE]</text>
    <text font-family="Liberation Sans, sans-serif" font-size="423px" font-weight="400" x="350" y="3010" fill="rgb(0,0,0)">[SIGNER_NAME]</text>
    <text font-family="Liberation Sans, sans-serif" font-size="423px" font-weight="400" x="350" y="3585" fill="rgb(0,0,0)">[SIGNER_TITLE]</text>
    <text font-family="Liberation Sans, sans-serif" font-size="423px" font-weight="400" x="350" y="4170" fill="rgb(0,0,0)">[SIGNED_BY]</text>
    <text font-family="Liberation Sans, sans-serif" font-size="423px" font-weight="400" x="8792.835" y="510" text-anchor="end" fill="#000000">[DATE]</text>
    <text font-family="Liberation Sans, sans-serif" font-size="423px" font-weight="700" x="2180" y="511" fill="rgb(239,65,61)">[INVALID_SIGNATURE]</text>
  </g>[SIGNATURE_IMAGE]
</svg>
`;

/** svx::SignatureLineHelper::getSignatureImage */
export function getSignatureImage(): string { return SIGNATURE_LINE_SVG; }

/** SignatureLineDialogBase::getCDataString */
export function getCDataString(rString: string): string { return `<![CDATA[${rString.replaceAll(']]>', ']]]]><![CDATA[>')}]]>`; }

/** comphelper::xml::generateGUIDString: a GUID in braces, upper case. */
function generateGUIDString(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `{${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}}`;
}

/** The dialog's fields (signatureline.ui). */
export interface SignatureLineDialog {
  m_aSignatureLineId: string;
  m_xEditName: string;
  m_xEditTitle: string;
  m_xEditEmail: string;
  m_xEditInstructions: string;
  m_xCheckboxCanAddComments: boolean;
  m_xCheckboxShowSignDate: boolean;
  /** The selected signature line's name when editing it (m_xExistingShapeProperties). */
  m_sExistingShape: string | null;
}

/**
 * SignatureLineDialog::SignatureLineDialog: empty with comments and the sign date on, or the
 * selected signature line's properties with `bEditExisting`.
 */
export function SignatureLineDialogInit(rSh: SwWrtShell, bEditExisting: boolean): SignatureLineDialog {
  const sel = bEditExisting ? rSh.GetFlyFrameFormat() : null;
  const s = sel?.m_aSignatureLine;
  // No signature line selected - start with empty dialog and set some default values
  if (!sel || !s) return { m_aSignatureLineId: '', m_xEditName: '', m_xEditTitle: '', m_xEditEmail: '', m_xEditInstructions: '', m_xCheckboxCanAddComments: true, m_xCheckboxShowSignDate: true, m_sExistingShape: null };
  // Read properties from selected signature line
  return {
    m_aSignatureLineId: s.m_aId, m_xEditName: s.m_aSuggestedSignerName ?? '', m_xEditTitle: s.m_aSuggestedSignerTitle ?? '',
    m_xEditEmail: s.m_aSuggestedSignerEmail ?? '', m_xEditInstructions: s.m_aSigningInstructions ?? '',
    m_xCheckboxCanAddComments: s.m_bCanAddComment, m_xCheckboxShowSignDate: s.m_bShowSignDate,
    // Mark this as existing shape
    m_sExistingShape: sel.m_aName,
  };
}

/** SignatureLineDialog::Apply: inserts the signature line at the cursor, or updates the selected one. */
export function SignatureLineDialogApply(rSh: SwWrtShell, d: SignatureLineDialog): string {
  const m_aSignatureLineId = d.m_aSignatureLineId || generateGUIDString();
  const aSignerName = d.m_xEditName, aSignerTitle = d.m_xEditTitle, aSignerEmail = d.m_xEditEmail;
  const aSigningInstructions = d.m_xEditInstructions;

  // Read svg and replace placeholder texts
  let aSvgImage = getSignatureImage();
  aSvgImage = aSvgImage.replaceAll('[SIGNER_NAME]', getCDataString(aSignerName));
  aSvgImage = aSvgImage.replaceAll('[SIGNER_TITLE]', getCDataString(aSignerTitle));

  // These are only filled if the signature line is signed.
  aSvgImage = aSvgImage.replaceAll('[SIGNATURE]', '');
  aSvgImage = aSvgImage.replaceAll('[SIGNED_BY]', '');
  aSvgImage = aSvgImage.replaceAll('[INVALID_SIGNATURE]', '');
  aSvgImage = aSvgImage.replaceAll('[DATE]', '');
  aSvgImage = aSvgImage.replaceAll('[SIGNATURE_IMAGE]', '');

  // Set signature line properties
  const props: SwSignatureLine = {
    m_aId: m_aSignatureLineId,
    ...(aSignerName ? { m_aSuggestedSignerName: aSignerName } : {}),
    ...(aSignerTitle ? { m_aSuggestedSignerTitle: aSignerTitle } : {}),
    ...(aSignerEmail ? { m_aSuggestedSignerEmail: aSignerEmail } : {}),
    ...(aSigningInstructions ? { m_aSigningInstructions: aSigningInstructions } : {}),
    m_bShowSignDate: d.m_xCheckboxShowSignDate,
    m_bCanAddComment: d.m_xCheckboxCanAddComments,
  };
  // Insert/Update graphic
  return rSh.InsertSignatureLine(new TextEncoder().encode(aSvgImage), props, d.m_sExistingShape);
}
