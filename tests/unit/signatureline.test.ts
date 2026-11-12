// Insert > Signature Line (SignatureLineDialog).
import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { RndStdIds } from '../../src/lo/sw/inc/frmfmt.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { SignatureLineDialogApply, SignatureLineDialogInit } from '../../src/lo/cui/source/dialogs/SignatureLineDialog.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };
const svgOf = (doc: SwDoc, key: string) => new TextDecoder().decode(doc.m_aGraphics.get(key)!.data);

describe('Signature line', () => {
  it('inserts a 6 x 3 cm SVG graphic with the signer and its properties', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('Contract');
    const d = SignatureLineDialogInit(sh, false);
    expect(d).toMatchObject({ m_xCheckboxCanAddComments: true, m_xCheckboxShowSignDate: true, m_sExistingShape: null });
    const name = SignatureLineDialogApply(sh, { ...d, m_xEditName: 'Jane <Doe>', m_xEditTitle: 'CEO', m_xEditEmail: 'jane@example.org' });
    const fmt = sh.GetFlyFrameFormat(name)!;
    expect(fmt).toMatchObject({ m_nWidth: 3402, m_nHeight: 1701, m_aAnchor: { m_eAnchorId: RndStdIds.FLY_AT_PARA } });
    expect(fmt.m_aSignatureLine).toMatchObject({ m_aSuggestedSignerName: 'Jane <Doe>', m_aSuggestedSignerTitle: 'CEO', m_aSuggestedSignerEmail: 'jane@example.org', m_bShowSignDate: true, m_bCanAddComment: true });
    expect(fmt.m_aSignatureLine!.m_aId).toMatch(/^\{[0-9A-F-]{36}\}$/);
    const svg = svgOf(sh.m_pDoc, fmt.graphic!);
    expect(svg).toContain('<![CDATA[Jane <Doe>]]>');
    expect(svg).not.toMatch(/\[(SIGNATURE|SIGNED_BY|DATE|INVALID_SIGNATURE|SIGNATURE_IMAGE)\]/);
    expect(sh.IsSignatureLineSelected()).toBe(true);
  });

  it('edits the selected signature line, keeping its id', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    const name = SignatureLineDialogApply(sh, { ...SignatureLineDialogInit(sh, false), m_xEditName: 'A' });
    const id = sh.GetFlyFrameFormat(name)!.m_aSignatureLine!.m_aId;
    const d = SignatureLineDialogInit(sh, true);
    expect(d).toMatchObject({ m_xEditName: 'A', m_sExistingShape: name, m_aSignatureLineId: id });
    SignatureLineDialogApply(sh, { ...d, m_xEditName: 'B', m_xCheckboxShowSignDate: false });
    expect(sh.m_pDoc.GetFlyFormats().length).toBe(1);
    expect(sh.GetFlyFrameFormat(name)!.m_aSignatureLine).toMatchObject({ m_aId: id, m_aSuggestedSignerName: 'B', m_bShowSignDate: false });
    expect(svgOf(sh.m_pDoc, sh.GetFlyFrameFormat(name)!.graphic!)).toContain('CDATA[B]');
  });

  it('keeps the signature line through ODT (loext:signatureline)', async () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    const name = SignatureLineDialogApply(sh, { ...SignatureLineDialogInit(sh, false), m_xEditName: 'Jane', m_xEditInstructions: 'Sign here', m_xCheckboxCanAddComments: false });
    const doc = (await ImportODT(await ExportODT(sh.m_pDoc))).doc;
    const fmt = doc.GetFlyFormats()[0]!.fmt!;
    expect(fmt.m_aSignatureLine).toEqual(sh.GetFlyFrameFormat(name)!.m_aSignatureLine);
    expect(doc.m_aGraphics.get(fmt.graphic!)!.mime).toBe('image/svg+xml');
  });
});
