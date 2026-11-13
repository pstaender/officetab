// Templates: LibreOffice's own Writer templates (src/app/generated/templates), the template a
// document is made from (meta:template, ResetFromTemplate), and Load Styles from Template
// (SwDoc::LoadStyles through LoadStylesFromFile).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { ResetFromTemplate } from '../../src/lo/sfx2/source/doc/objcont.ts';
import { DateTimeNow } from '../../src/lo/sfx2/source/doc/SfxDocumentMetaData.ts';
import { DefaultTemplateFlags, LoadStylesFromFile, ReaderOptions, SfxTemplateFlags } from '../../src/lo/sw/source/uibase/app/docsh2.ts';
import { readZip, writeZip } from '../../src/lo/package/source/zipapi/zip.ts';
import { SwNumRule } from '../../src/lo/sw/inc/numrule.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';
import builtIn from '../../src/app/generated/templates/templates.json';

const mono: TextMeasurer = { GetTextWidth: (f: FontDesc, t: string) => (t.length * f.size) / 2.4, GetFontMetric: (f) => ({ ascent: f.size * 0.8, descent: f.size * 0.2 }) };
const DIR = join(import.meta.dirname, '../../src/app/generated/templates');

describe("LibreOffice's templates", () => {
  it('open as text templates with their styles and thumbnails', async () => {
    expect(builtIn.map((b) => b.title)).toEqual([
      'Modern business letter sans-serif', 'Modern business letter serif', 'Businesscard with logo', 'CV', 'Resume',
      'Default', 'Modern', 'Simple', 'Simplified Chinese Normal', 'Japanese Normal',
    ]);
    for (const b of builtIn) {
      const bytes = new Uint8Array(readFileSync(join(DIR, b.file)));
      const r = await ImportODT(bytes);
      expect(r.template, b.file).toBe(true);
      expect(r.doc.m_xDocProps.getTitle()).toBe(b.title);
      expect((await readZip(bytes)).has('Thumbnails/thumbnail.png'), b.file).toBe(true);
    }
  });

  it('a package of styles only (no content.xml) opens with an empty body', async () => {
    const r = await ImportODT(new Uint8Array(readFileSync(join(DIR, 'styles/Modern.ott'))));
    expect(r.lost).toEqual([]);
    const sh = new SwWrtShell(r.doc, mono);
    expect(sh.m_pRoot.pages).toHaveLength(1);
    expect([...r.doc.allText()].map((n) => n.m_Text)).toEqual(['']);
    // The styles are the template's: its Heading 1 differs from a new document's.
    expect(r.doc.FindTextFormatCollByName('Heading 1')!.m_aSet).not.toEqual(new SwDoc().FindTextFormatCollByName('Heading 1')!.m_aSet);
  });
});

describe('a document made from a template', () => {
  it('forgets the user data and records the template in meta:template', async () => {
    const tpl = new SwDoc();
    tpl.m_xDocProps.setAuthor('Template Author');
    tpl.m_xDocProps.setModifiedBy('Someone');
    tpl.m_xDocProps.setEditingCycles(7);
    const { doc } = await ImportODT(await ExportODT(tpl, [], true));
    const now = new Date(2026, 10, 13, 9, 30, 0);
    ResetFromTemplate(doc, 'Letter', 'Letter.ott', now);
    const p = doc.m_xDocProps;
    expect(p.getAuthor()).toBe('');
    expect(p.getModifiedBy()).toBe('');
    expect(p.getEditingCycles()).toBe(1);
    expect(p.getTemplateName()).toBe('Letter');
    expect(p.getTemplateURL()).toBe('Letter.ott');
    expect(p.getTemplateDate()).toEqual({ ...DateTimeNow(now), NanoSeconds: 0 });
    // meta:template survives saving and loading, after meta:print-date.
    const files = await readZip(await ExportODT(doc));
    const meta = new TextDecoder().decode(files.get('meta.xml'));
    expect(meta).toContain('<meta:template xlink:type="simple" xlink:actuate="onRequest" xlink:title="Letter" xlink:href="Letter.ott" meta:date="2026-11-13T09:30:00"/>');
    const again = (await ImportODT(await ExportODT(doc))).doc.m_xDocProps;
    expect([again.getTemplateName(), again.getTemplateURL(), again.getTemplateDate().Hours]).toEqual(['Letter', 'Letter.ott', 9]);
  });

  it('without a template location records none', () => {
    const doc = new SwDoc();
    doc.m_xDocProps.setTemplateName('Old');
    ResetFromTemplate(doc, 'Letter', '');
    expect(doc.m_xDocProps.getTemplateName()).toBe('');
  });
});

/** A template with a changed Text Body, a new paragraph style, a character style, a list style and a page style. */
async function template(): Promise<Uint8Array> {
  const t = new SwDoc();
  const body = t.FindTextFormatCollByName('Text Body')!;
  body.m_aSet = { ...body.m_aSet, RES_CHRATR_FONTSIZE: 300 };
  const quote = t.MakeColl('Fancy Quote', body, { RES_CHRATR_POSTURE: true });
  quote.m_pNextTextFormatColl = body;
  t.MakeCharFormat('Highlight', { RES_CHRATR_WEIGHT: true });
  const rule = new SwNumRule('My List');
  rule.SetAutoRule(false);
  t.PutNumRule(rule);
  const page = t.FindPageDesc('Landscape')!;
  page.nLeft = 2000;
  return ExportODT(t, [], true);
}

describe('Load Styles from Template', () => {
  it('adds the styles a document lacks and keeps its own without Overwrite', async () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    const doc = sh.m_pDoc;
    const ok = await LoadStylesFromFile(doc, sh.m_pCursor, await template(), ReaderOptions(DefaultTemplateFlags()));
    expect(ok).toBe(true);
    const quote = doc.FindTextFormatCollByName('Fancy Quote')!;
    expect(quote.GetFormatAttr('RES_CHRATR_POSTURE')).toBe(true);
    // Its parent and follow are the document's own styles of those names.
    expect(quote.m_pDerivedFrom).toBe(doc.FindTextFormatCollByName('Text Body'));
    expect(quote.m_pNextTextFormatColl).toBe(doc.FindTextFormatCollByName('Text Body'));
    expect(doc.FindCharFormatByName('Highlight')!.GetFormatAttr('RES_CHRATR_WEIGHT')).toBe(true);
    // Text Body exists already: unchanged; the list style was not asked for.
    expect(doc.FindTextFormatCollByName('Text Body')!.m_aSet.RES_CHRATR_FONTSIZE).toBeUndefined();
    expect(doc.m_aNumRules.has('My List')).toBe(false);
    // One undo step takes the loaded styles away again.
    sh.Undo();
    expect(doc.FindTextFormatCollByName('Fancy Quote')).toBeUndefined();
    expect(doc.FindCharFormatByName('Highlight')).toBeUndefined();
    sh.Redo();
    expect(doc.FindTextFormatCollByName('Fancy Quote')).toBeDefined();
  });

  it('with Overwrite replaces the styles of the same names, and loads list styles', async () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    const doc = sh.m_pDoc;
    const flags = SfxTemplateFlags.LOAD_TEXT_STYLES | SfxTemplateFlags.LOAD_NUM_STYLES | SfxTemplateFlags.MERGE_STYLES;
    await LoadStylesFromFile(doc, sh.m_pCursor, await template(), ReaderOptions(flags));
    expect(doc.FindTextFormatCollByName('Text Body')!.GetFormatAttr('RES_CHRATR_FONTSIZE')).toBe(300);
    expect(doc.m_aNumRules.get('My List')?.GetName()).toBe('My List');
    sh.Undo();
    expect(doc.FindTextFormatCollByName('Text Body')!.m_aSet.RES_CHRATR_FONTSIZE).toBeUndefined();
    expect(doc.m_aNumRules.has('My List')).toBe(false);
  });

  it('page styles bring their format, and cannot be undone', async () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    const doc = sh.m_pDoc;
    sh.Insert('x');
    expect(doc.m_aUndo.length).toBeGreaterThan(0);
    await LoadStylesFromFile(doc, sh.m_pCursor, await template(), ReaderOptions(SfxTemplateFlags.LOAD_PAGE_STYLES));
    expect(doc.m_aPageDescs.get('Landscape')?.nLeft).toBe(2000);
    // shellio's SwReader::Read: reading page styles deletes the undo history.
    expect(doc.m_aUndo).toHaveLength(0);
    expect(doc.IsModified()).toBe(true);
  });

  it('only from OpenDocument files', async () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    const zip = await writeZip([{ name: 'mimetype', data: new TextEncoder().encode('application/zip'), store: true }]);
    expect(await LoadStylesFromFile(sh.m_pDoc, sh.m_pCursor, zip, ReaderOptions(DefaultTemplateFlags()))).toBe(false);
    expect(await LoadStylesFromFile(sh.m_pDoc, sh.m_pCursor, new TextEncoder().encode('plain'), ReaderOptions(DefaultTemplateFlags()))).toBe(false);
  });

  it('SID_TEMPLATE_LOAD loads text styles when nothing else is chosen', () => {
    expect(DefaultTemplateFlags(false)).toBe(SfxTemplateFlags.LOAD_TEXT_STYLES);
    expect(DefaultTemplateFlags(false, false, true)).toBe(SfxTemplateFlags.LOAD_PAGE_STYLES);
    // The Overwrite box sets MERGE_STYLES, which is the reader's Merge off.
    expect(ReaderOptions(SfxTemplateFlags.LOAD_TEXT_STYLES | SfxTemplateFlags.MERGE_STYLES).m_bMerge).toBe(false);
  });
});
