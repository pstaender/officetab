// Font colour Automatic and no highlighting (the colour window's first entry), in the model and
// through ODT and DOCX.
import { describe, expect, it } from 'vitest';
import { SwDoc, SwPosition } from '../../src/lo/sw/inc/doc.ts';
import { SwPaM } from '../../src/lo/sw/inc/pam.ts';
import type { SwTextNode } from '../../src/lo/sw/inc/ndtxt.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { ExportDOCX } from '../../src/lo/sw/source/filter/ww8/docxexport.ts';
import { ImportDOCX } from '../../src/lo/sw/source/writerfilter/dmapper/DomainMapper.ts';
import { readZip } from '../../src/lo/package/source/zipapi/zip.ts';
import { documentColors } from '../../src/writer/colors.ts';

/** "aaa bbb ccc" in red, highlighted yellow; "bbb" then set to Automatic without highlighting. */
function setup() {
  const doc = new SwDoc();
  const node = doc.GetNodes().FirstTextNode();
  const pam = new SwPaM(new SwPosition(node, 0));
  doc.InsertString(pam, 'aaa bbb ccc');
  pam.GetMark().Assign(node, 0); pam.GetPoint().Assign(node, 11);
  doc.InsertAttr(pam, { RES_CHRATR_COLOR: '#ff0000', RES_CHRATR_BACKGROUND: '#ffff00' });
  pam.GetMark().Assign(node, 4); pam.GetPoint().Assign(node, 7);
  doc.InsertAttr(pam, { RES_CHRATR_COLOR: null, RES_CHRATR_BACKGROUND: null });
  return { doc, node };
}
const colors = (n: SwTextNode) => [0, 5, 9].map((i) => [n.GetCharAttrAt('RES_CHRATR_COLOR', i), n.GetCharAttrAt('RES_CHRATR_BACKGROUND', i)]);
const EXPECTED = [['#ff0000', '#ffff00'], [null, null], ['#ff0000', '#ffff00']];
const xml = async (bytes: Uint8Array, name: string) => new TextDecoder().decode((await readZip(bytes)).get(name)!);

describe('Automatic font colour and no highlighting', () => {
  it('override the colours around them', () => {
    expect(colors(setup().node)).toEqual(EXPECTED);
  });

  it('survive ODT: style:use-window-font-color and a transparent background', async () => {
    const odt = await ExportODT(setup().doc);
    expect(await xml(odt, 'content.xml')).toContain('style:use-window-font-color="true"');
    expect(colors((await ImportODT(odt)).doc.GetNodes().FirstTextNode())).toEqual(EXPECTED);
  });

  it('survive DOCX: w:color auto and no shading', async () => {
    const docx = await ExportDOCX(setup().doc);
    expect(await xml(docx, 'word/document.xml')).toContain('<w:color w:val="auto"/>');
    expect(colors((await ImportDOCX(docx)).doc.GetNodes().FirstTextNode())).toEqual(EXPECTED);
  });

  it('are not among the document colours, which the colour window offers', () => {
    expect(documentColors(setup().doc)).toEqual(['#ff0000', '#ffff00']);
  });
});
