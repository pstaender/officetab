import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { MakeDocInfoField, SwDocInfoSubType, SwDocStatSubType } from '../../src/lo/sw/source/core/fields/docufld.ts';
import type { SwField } from '../../src/lo/sw/inc/hintids.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };

/** The text of every frame of a page area, fields expanded. */
const texts = (sh: SwWrtShell, area?: string) => sh.m_pRoot.pages.map((p) => p.frames.filter((f) => f.pArea === area).flatMap((f) => f.lines.flatMap((l) => l.portions.map((x) => (x.kind === 'field' ? x.aExpand : f.node.GetText().slice(x.nStart, x.nStart + x.nLen))))).join(''));
const fields = (doc: SwDoc): SwField[] => {
  const out: SwField[] = [];
  const nodes = doc.GetNodes();
  for (let n = nodes.FirstTextNode() as ReturnType<typeof nodes.GoNext>; n; n = nodes.GoNext(n.GetIndex())) for (const h of n.m_aHints) if (h.aAttrs.RES_TXTATR_FIELD) out.push(h.aAttrs.RES_TXTATR_FIELD);
  return out;
};

describe('document fields', () => {
  it('shows the title, subject and author, following the properties unless fixed', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    const props = sh.m_pDoc.m_xDocProps;
    props.setTitle('Report');
    props.setSubject('Fields');
    props.setAuthor('Ada');
    sh.InsertFormatField(MakeDocInfoField(props, SwDocInfoSubType.Title));
    sh.Insert('|');
    sh.InsertFormatField(MakeDocInfoField(props, SwDocInfoSubType.Subject));
    sh.Insert('|');
    sh.InsertFormatField(MakeDocInfoField(props, SwDocInfoSubType.Create | SwDocInfoSubType.SubAuthor));
    sh.Insert('|');
    sh.InsertFormatField(MakeDocInfoField(props, SwDocInfoSubType.Title, '', true));
    expect(texts(sh)[0]).toBe('Report|Fields|Ada|Report');
    props.setTitle('Summary');
    sh.m_pDoc.SetModified();
    sh.m_pRoot.Layout();
    expect(texts(sh)[0]).toBe('Summary|Fields|Ada|Report');
  });

  it('counts the pages of the page numbering range', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    for (let i = 0; i < 150; i++) { if (i) sh.SplitNode(); sh.Insert(`line ${i}`); }
    const total = sh.m_pRoot.pages.length;
    expect(total).toBeGreaterThan(2);
    // Restart the numbering at the paragraph starting the second page.
    const second = sh.m_pRoot.pages[1]!.frames.find((f) => !f.pArea)!.node;
    sh.SelectRange(second, 0, 0);
    sh.SetPageDescAttr({ name: sh.m_pDoc.m_aPageDesc.m_aName, numOffset: 1 });
    sh.ChangeHeaderOrFooter(false, true);
    sh.InsertField('PageNumber');
    sh.Insert('/');
    sh.InsertFormatField({ type: 'DocStat', subType: SwDocStatSubType.PageRange });
    const n = sh.m_pRoot.pages.length;
    const k = sh.m_pRoot.pages.findIndex((p) => p.bNumOffset);
    expect(k).toBeGreaterThan(0);
    expect(texts(sh, 'footer')).toEqual([...Array.from({ length: k }, (_, i) => `${i + 1}/${k}`), ...Array.from({ length: n - k }, (_, i) => `${i + 1}/${n - k}`)]);
  });

  it('counts words, characters, paragraphs and tables', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('one two three');
    sh.SplitNode();
    sh.SplitNode();
    sh.Insert('four');
    sh.SplitNode();
    for (const nSub of [SwDocStatSubType.Word, SwDocStatSubType.Character, SwDocStatSubType.Paragraph, SwDocStatSubType.Table]) {
      sh.InsertFormatField({ type: 'DocStat', subType: nSub });
      sh.Insert(' ');
    }
    // The last paragraph's own fields and spaces count as characters (the fields' placeholders) too.
    expect(texts(sh)[0]).toBe('one two threefour4 25 3 0 ');
  });

  it('keeps document fields through ODT', async () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    const props = sh.m_pDoc.m_xDocProps;
    props.setTitle('Report');
    props.setModifiedBy('Grace');
    props.m_aUserDefined.push({ name: 'Client', type: 'string', value: 'ACME' });
    sh.InsertFormatField(MakeDocInfoField(props, SwDocInfoSubType.Title));
    sh.InsertFormatField(MakeDocInfoField(props, SwDocInfoSubType.Change | SwDocInfoSubType.SubAuthor, '', true));
    sh.InsertFormatField(MakeDocInfoField(props, SwDocInfoSubType.Custom, 'Client'));
    sh.InsertFormatField({ type: 'DocStat', subType: SwDocStatSubType.PageRange });
    sh.InsertFormatField({ type: 'DocStat', subType: SwDocStatSubType.Word, numType: 1 });
    const { doc, lost } = await ImportODT(await ExportODT(sh.m_pDoc));
    expect(lost).toEqual([]);
    expect(fields(doc)).toEqual([
      { type: 'DocInfo', subType: SwDocInfoSubType.Title },
      { type: 'DocInfo', subType: SwDocInfoSubType.Change | SwDocInfoSubType.SubAuthor, fixed: 'Grace' },
      { type: 'DocInfo', subType: SwDocInfoSubType.Custom, name: 'Client' },
      { type: 'DocStat', subType: SwDocStatSubType.PageRange },
      { type: 'DocStat', subType: SwDocStatSubType.Word, numType: 1 },
    ]);
  });
});

describe('document fields in Word documents', () => {
  it('keeps document information and statistics fields through DOCX', async () => {
    const { ExportDOCX } = await import('../../src/lo/sw/source/filter/ww8/docxexport.ts');
    const { ImportDOCX } = await import('../../src/lo/sw/source/writerfilter/dmapper/DomainMapper.ts');
    const sh = new SwWrtShell(new SwDoc(), mono);
    const props = sh.m_pDoc.m_xDocProps;
    props.setTitle('Report');
    props.setAuthor('Ada');
    props.setModifiedBy('Grace');
    sh.InsertFormatField(MakeDocInfoField(props, SwDocInfoSubType.Title));
    sh.InsertFormatField(MakeDocInfoField(props, SwDocInfoSubType.Create | SwDocInfoSubType.SubAuthor));
    sh.InsertFormatField(MakeDocInfoField(props, SwDocInfoSubType.Change | SwDocInfoSubType.SubAuthor, '', true));
    sh.InsertFormatField(MakeDocInfoField(props, SwDocInfoSubType.Custom, 'Client'));
    sh.InsertFormatField({ type: 'DocStat', subType: SwDocStatSubType.Word });
    const { doc } = await ImportDOCX(await ExportDOCX(sh.m_pDoc));
    // AUTHOR and LASTSAVEDBY come back fixed with the text they showed, as Word only updates them on request.
    expect(fields(doc)).toEqual([
      { type: 'DocInfo', subType: SwDocInfoSubType.Title },
      { type: 'DocInfo', subType: SwDocInfoSubType.Create | SwDocInfoSubType.SubAuthor, fixed: 'Ada' },
      { type: 'DocInfo', subType: SwDocInfoSubType.Change | SwDocInfoSubType.SubAuthor, fixed: 'Grace' },
      // with the text it showed, while the document has no such property
      { type: 'DocInfo', subType: SwDocInfoSubType.Custom, name: 'Client', content: '' },
      { type: 'DocStat', subType: SwDocStatSubType.Word },
    ]);
    expect(doc.m_xDocProps.getTitle()).toBe('Report');
  });
});
