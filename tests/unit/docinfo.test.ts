// File > Properties (SfxDocumentMetaData through ODT and DOCX, UpdateDocInfoForSave) and
// Format > Image > Graphic Size Check.
import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { DateTimeNow, SfxDocumentMetaData, durationToText, textToDuration } from '../../src/lo/sfx2/source/doc/SfxDocumentMetaData.ts';
import { UpdateDocInfoForSave } from '../../src/lo/sfx2/source/doc/objcont.ts';
import { GetDateTimeFromW3CDTF } from '../../src/lo/oox/source/docprop/docprophandler.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { ExportDOCX } from '../../src/lo/sw/source/filter/ww8/docxexport.ts';
import { ImportDOCX } from '../../src/lo/sw/source/writerfilter/dmapper/DomainMapper.ts';
import { readZip } from '../../src/lo/package/source/zipapi/zip.ts';
import { DetectGraphic } from '../../src/lo/vcl/source/filter/GraphicFormatDetector.ts';
import { GraphicSizeCheckGUIEntryText, GraphicSizeCheckGUIResult } from '../../src/lo/sw/source/core/graphic/GraphicSizeCheck.ts';
import { parseXml } from '../../src/lo/xmloff/source/core/xmlparse.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };

/** The header of a PNG of w × h pixels (all DetectGraphic reads). */
function png(w: number, h: number): Uint8Array {
  const d = new Uint8Array(33), v = new DataView(d.buffer);
  d.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  v.setUint32(8, 13); d.set([...'IHDR'].map((ch) => ch.charCodeAt(0)), 12);
  v.setUint32(16, w); v.setUint32(20, h);
  return d;
}

function props(): SfxDocumentMetaData {
  const p = new SfxDocumentMetaData();
  p.setTitle('Report & summary'); p.setSubject('Quarter'); p.setKeywords(['alpha', 'beta']); p.setDescription('Line one\nline two');
  p.setAuthor('Ada'); p.setCreationDate({ Year: 2024, Month: 3, Day: 4, Hours: 5, Minutes: 6, Seconds: 7, NanoSeconds: 0 });
  p.setModifiedBy('Grace'); p.setModificationDate({ Year: 2025, Month: 6, Day: 7, Hours: 8, Minutes: 9, Seconds: 10, NanoSeconds: 0 });
  p.setEditingCycles(4); p.setEditingDuration(3725);
  return p;
}

describe('Document properties', () => {
  it('writes durations and dates as upstream does', () => {
    expect(durationToText(0)).toBe('P0D');
    expect(durationToText(3725)).toBe('PT1H2M5S');
    expect(durationToText(90061)).toBe('P1DT1H1M1S');
    expect(textToDuration('PT1H2M5S')).toBe(3725);
    expect(textToDuration('P1Y')).toBe(365 * 86400);
    // W3CDTF with a time zone is read as UTC.
    expect(GetDateTimeFromW3CDTF('2024-01-01T01:30:00+02:00')).toMatchObject({ Year: 2023, Month: 12, Day: 31, Hours: 23, Minutes: 30 });
  });

  it('keeps the properties and the image resolution through ODT', async () => {
    const doc = new SwDoc();
    doc.m_xDocProps = props();
    doc.m_xDocProps.m_aUserDefined.push({ name: 'Client', type: 'string', value: 'ACME' });
    doc.m_nImagePreferredDPI = 300;
    doc.m_bUseUserData = false;
    const back = (await ImportODT(await ExportODT(doc))).doc;
    const p = back.m_xDocProps;
    expect([p.getTitle(), p.getSubject(), p.getKeywords(), p.getDescription(), p.getAuthor(), p.getModifiedBy()]).toEqual(['Report & summary', 'Quarter', ['alpha', 'beta'], 'Line one\nline two', 'Ada', 'Grace']);
    expect(p.getCreationDate()).toMatchObject({ Year: 2024, Month: 3, Day: 4, Hours: 5 });
    expect([p.getEditingCycles(), p.getEditingDuration()]).toEqual([4, 3725]);
    expect(p.m_aUserDefined).toEqual([{ name: 'Client', type: 'string', value: 'ACME' }]);
    expect(p.getGenerator()).toMatch(/^Workspace_Office\/\d/);
    expect([back.m_nImagePreferredDPI, back.m_bUseUserData]).toEqual([300, false]);
  });

  it('writes docProps/core.xml and app.xml and reads them back', async () => {
    const doc = new SwDoc();
    doc.m_xDocProps = props();
    const bytes = await ExportDOCX(doc);
    const files = await readZip(bytes);
    const core = new TextDecoder().decode(files.get('docProps/core.xml')!);
    expect(core).toContain('<dcterms:created xsi:type="dcterms:W3CDTF">2024-03-04T05:06:07Z</dcterms:created>');
    expect(core).toContain('<cp:keywords>alpha beta</cp:keywords>');
    expect(core).toContain('<dc:title>Report &amp; summary</dc:title>');
    expect(new TextDecoder().decode(files.get('docProps/app.xml')!)).toContain('<TotalTime>62</TotalTime>');
    expect(new TextDecoder().decode(files.get('[Content_Types].xml')!)).toContain('/docProps/core.xml');
    expect(parseXml(new TextDecoder().decode(files.get('_rels/.rels')!))).toBeTruthy();
    const p = (await ImportDOCX(bytes)).doc.m_xDocProps;
    expect([p.getTitle(), p.getSubject(), p.getKeywords(), p.getAuthor(), p.getModifiedBy(), p.getEditingCycles()]).toEqual(['Report & summary', 'Quarter', ['alpha', 'beta'], 'Ada', 'Grace', 4]);
    // TotalTime is in minutes.
    expect(p.getEditingDuration()).toBe(62 * 60);
    expect(p.getModificationDate()).toMatchObject({ Year: 2025, Month: 6, Day: 7, Hours: 8, Minutes: 9, Seconds: 10 });
  });

  it('records the modification, the revision and the editing time on save (UpdateDocInfoForSave)', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    const doc = sh.m_pDoc;
    doc.m_nTime = new Date(2026, 0, 1, 10, 0, 0);
    // Unmodified: nothing changes.
    UpdateDocInfoForSave(doc, 'Ada', new Date(2026, 0, 1, 10, 5, 0));
    expect(doc.m_xDocProps.getEditingCycles()).toBe(0);
    sh.Insert('x');
    UpdateDocInfoForSave(doc, 'Ada', new Date(2026, 0, 1, 10, 5, 0));
    expect([doc.m_xDocProps.getModifiedBy(), doc.m_xDocProps.getEditingCycles(), doc.m_xDocProps.getEditingDuration()]).toEqual(['Ada', 1, 300]);
    expect(doc.m_xDocProps.getModificationDate()).toMatchObject({ Year: 2026, Month: 1, Day: 1, Hours: 10, Minutes: 5 });
    // Without user data, the user's name goes.
    doc.m_xDocProps.setAuthor('Ada');
    doc.m_bUseUserData = false;
    UpdateDocInfoForSave(doc, 'Ada');
    expect([doc.m_xDocProps.getAuthor(), doc.m_xDocProps.getModifiedBy()]).toEqual(['', '']);
  });

  it('resets the user data', () => {
    const p = props();
    p.resetUserData('Linus', DateTimeNow(new Date(2026, 4, 5, 6, 7, 8)));
    expect([p.getAuthor(), p.getModifiedBy(), p.getEditingCycles(), p.getEditingDuration(), p.getModificationDate().Year]).toEqual(['Linus', '', 1, 0, 0]);
    expect(p.getCreationDate()).toMatchObject({ Year: 2026, Month: 5, Day: 5, Hours: 6, Minutes: 7, Seconds: 8 });
  });
});

describe('Graphic Size Check', () => {
  it('reads the pixel size of BMP and WebP headers', () => {
    const bmp = new Uint8Array(54), b = new DataView(bmp.buffer);
    bmp.set([0x42, 0x4d]); b.setUint32(14, 40, true); b.setUint32(18, 640, true); b.setInt32(22, -480, true); b.setUint16(28, 24, true);
    b.setUint32(38, 11811, true); b.setUint32(42, 11811, true);
    expect(DetectGraphic(bmp)).toMatchObject({ mnPixWidth: 640, mnPixHeight: 480 });
    expect(Math.round(DetectGraphic(bmp)!.mnDpiX)).toBe(300);
    const webp = new Uint8Array(30), w = new DataView(webp.buffer);
    webp.set([...'RIFF'].map((ch) => ch.charCodeAt(0))); webp.set([...'WEBPVP8X'].map((ch) => ch.charCodeAt(0)), 8);
    w.setUint16(24, 799, true); w.setUint16(27, 599, true);
    expect(DetectGraphic(webp)).toMatchObject({ mnPixWidth: 800, mnPixHeight: 600 });
  });

  it('lists the images with too few or too many pixels at the preferred resolution', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    const doc = sh.m_pDoc;
    // 2 × 1 inches each: 100 pixels across is 50 DPI, 300 is 150, 1000 is 500.
    for (const px of [100, 300, 1000]) sh.InsertGraphic(png(px, px / 2), 'image/png', { width: 2880, height: 1440 }, true);
    expect(GraphicSizeCheckGUIResult(doc)).toEqual([]); // no preferred resolution
    doc.m_nImagePreferredDPI = 150;
    const list = GraphicSizeCheckGUIResult(doc);
    expect(list.map((v) => [v.getGraphicName(), v.getDPIX(), v.getDPIY(), v.isDPITooLow(), v.isDPITooHigh()])).toEqual([['Image1', 50, 50, true, false], ['Image3', 500, 500, false, true]]);
    expect(GraphicSizeCheckGUIEntryText(list[0]!, "Image '%NAME%' has too few pixels for the current size (%DPIX% x %DPIY% DPI)", '')).toBe("Image 'Image1' has too few pixels for the current size (50 x 50 DPI)");
  });

  it('inserts an image at the preferred resolution (SwWrtShell::InsertGraphic)', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.m_pDoc.m_nImagePreferredDPI = 300;
    const name = sh.InsertGraphic(png(600, 300), 'image/png', { width: 9000, height: 4500 }, true);
    const fly = sh.m_pDoc.FindFlyByName(name)!.asChar!;
    expect([fly.width, fly.height]).toEqual([2880, 1440]);
  });
});
