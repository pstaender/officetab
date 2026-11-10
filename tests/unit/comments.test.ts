import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { COMMENT_SIDEBAR } from '../../src/lo/sw/source/core/layout/pagechg.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };

function commented() {
  const sh = new SwWrtShell(new SwDoc(), mono);
  sh.Insert('Please review this sentence.');
  const n = sh.m_pCursor.GetPoint().GetNode();
  sh.SelectRange(n, 7, 13);
  const id = sh.InsertPostIt('Ada');
  sh.m_pDoc.SetAnnotation(id, { text: 'Is "review"\nthe right word?' });
  return { sh, n, id };
}

describe('comments', () => {
  it('anchors at the selection start, marks the range and takes no space', () => {
    const { sh, n, id } = commented();
    expect(n.GetText()).toBe('Please \u0001review this sentence.');
    expect(n.GetCharAttrAt('RES_TXTATR_ANNOTMARK', 8)).toBe(id);
    expect(n.GetCharAttrAt('RES_TXTATR_ANNOTMARK', 14)).toBeNull();
    const line = sh.m_pRoot.pages[0]!.frames[0]!.lines[0]!;
    expect(line.portions.find((p) => p.kind === 'field')!.nWidth).toBe(0);
    const anchors = sh.m_pRoot.m_aAnnotationAnchors;
    expect(anchors.map((a) => a.field.text)).toEqual(['Is "review"\nthe right word?']);
    expect(sh.m_pRoot.GetDocSize().width).toBe(568 * 2 + 11906 + COMMENT_SIDEBAR);
    expect(sh.GetSelText()).toBe('');
    sh.SelectRange(n, 10, 10);
    expect(sh.GetCurrentPostIt()?.id).toBe(id);
  });

  it('resolves, deletes and undoes', () => {
    const { sh, n, id } = commented();
    sh.m_pDoc.SetAnnotation(id, { resolved: true });
    expect(sh.m_pDoc.GetAnnotations()[0]!.field.resolved).toBe(true);
    sh.m_pDoc.DeleteAnnotations(sh.m_pCursor, [id]);
    expect(n.GetText()).toBe('Please review this sentence.');
    expect(n.m_aHints).toEqual([]);
    expect(sh.m_pRoot.GetDocSize().width).toBe(568 * 2 + 11906);
    sh.Undo();
    expect(sh.m_pDoc.GetAnnotations()[0]!.field).toMatchObject({ id, resolved: true, author: 'Ada' });
  });

  it('round-trips through ODT with its range', async () => {
    const { sh } = commented();
    const { doc, lost } = await ImportODT(await ExportODT(sh.m_pDoc));
    expect(lost).toEqual([]);
    const [a] = doc.GetAnnotations();
    expect(a!.field).toMatchObject({ author: 'Ada', text: 'Is "review"\nthe right word?', resolved: false });
    expect(a!.node.GetText()).toBe('Please \u0001review this sentence.');
    expect(a!.node.GetCharAttrAt('RES_TXTATR_ANNOTMARK', 12)).toBe(a!.field.id);
    expect(a!.node.GetCharAttrAt('RES_TXTATR_ANNOTMARK', 14)).toBeNull();
  });
});
