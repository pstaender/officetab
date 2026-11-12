// File > Versions: the version list of a package (xmloff XMLVersionListPersistence), SfxMedium's
// version list and SfxObjectShell::SaveTo_Impl storing a version, against a document whose
// versions LibreOffice saved (specs/writer/versions.odt: "First state" saved, "Second state" and
// "Third state" saved as versions, "Current state" saved last).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import type { SwTextNode } from '../../src/lo/sw/inc/ndtxt.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { readZip } from '../../src/lo/package/source/zipapi/zip.ts';
import { SfxMedium } from '../../src/lo/sfx2/source/doc/docfile.ts';
import { SaveTo_Impl } from '../../src/lo/sfx2/source/doc/objstor.ts';
import { IsSaveVersionOnClose, SetSaveVersionOnClose } from '../../src/lo/sfx2/source/doc/objcont.ts';
import { ParseISODateTimeString, XMLVersionListExport, XMLVersionListImport } from '../../src/lo/xmloff/source/meta/xmlversion.ts';

const text = (doc: SwDoc) => {
  const out: string[] = [];
  for (let n: SwTextNode | null = doc.GetNodes().FirstTextNode(); n; n = doc.GetNodes().GoNext(n.GetIndex())) out.push(n.GetText());
  return out.join('\n');
};

const load = async (bytes: Uint8Array) => {
  const { doc, storage } = await ImportODT(bytes);
  return { doc, medium: new SfxMedium(storage) };
};

describe('version list', () => {
  it('reads the versions LibreOffice saved, and opens each', async () => {
    const { doc, medium } = await load(readFileSync('specs/writer/versions.odt'));
    expect(text(doc)).toBe('Current state');
    const v = medium.GetVersionList();
    expect(v.map((x) => x.Identifier)).toEqual(['Version1', 'Version2']);
    expect(v.map((x) => x.Comment)).toEqual(['Second, with a comment\nover two lines', 'Third']);
    expect(v[0]!.TimeStamp.Year).toBe(2026);
    expect(text((await ImportODT(medium.GetVersionStorage_Impl(1)!)).doc)).toBe('Second state');
    expect(text((await ImportODT(medium.GetVersionStorage_Impl(2)!)).doc)).toBe('Third state');
    // Negative numbers count back from the current version.
    expect(text((await ImportODT(medium.GetVersionStorage_Impl(-1)!)).doc)).toBe('Third state');
    expect(medium.GetVersionStorage_Impl(3)).toBeNull();
  });

  it('writes the list as upstream and reads it back', () => {
    const tags = [{ Identifier: 'Version1', Comment: 'a "b"\nc', Author: 'Ada', TimeStamp: { NanoSeconds: 5, Seconds: 3, Minutes: 2, Hours: 1, Day: 9, Month: 8, Year: 2026 } }];
    const xml = XMLVersionListExport(tags);
    expect(xml).toContain('<VL:version-entry VL:title="Version1" VL:comment="a &quot;b&quot;&#x0a;c" VL:creator="Ada" dc:date-time="2026-08-09T01:02:03"/>');
    expect(XMLVersionListImport(xml)).toEqual([{ ...tags[0], TimeStamp: { ...tags[0]!.TimeStamp, NanoSeconds: 0 } }]);
    // The namespace counts, not the prefix; StarOffice's framework namespace is read too.
    expect(XMLVersionListImport('<x:version-list xmlns:x="http://openoffice.org/2001/framework" xmlns:d="http://purl.org/dc/elements/1.1/"><x:version-entry x:title="Version7" d:date-time="2001-02-03"/></x:version-list>'))
      .toEqual([{ Identifier: 'Version7', Comment: '', Author: '', TimeStamp: { NanoSeconds: 0, Seconds: 0, Minutes: 0, Hours: 0, Day: 3, Month: 2, Year: 2001 } }]);
  });

  it('parses dates as XMLVersionContext::ParseISODateTimeString', () => {
    expect(ParseISODateTimeString('2026-11-12T17:06:48')).toMatchObject({ Year: 2026, Month: 11, Day: 12, Hours: 17, Minutes: 6, Seconds: 48 });
    expect(ParseISODateTimeString('2026')).toMatchObject({ Year: 2026, Month: 1, Day: 1 });
    expect(ParseISODateTimeString('2026-13-01')).toBeNull();
    expect(ParseISODateTimeString('2026-01-01T24:00')).toBeNull();
    expect(ParseISODateTimeString('')).toBeNull();
  });
});

describe('SaveTo_Impl', () => {
  it('keeps the versions and adds the saved state as a new one', async () => {
    const { doc, medium } = await load(readFileSync('specs/writer/versions.odt'));
    const bytes = await SaveTo_Impl((extra) => ExportODT(doc, extra), medium, { pVersionItem: 'Mine', aUserName: 'Me' });
    const files = await readZip(bytes);
    expect([...files.keys()].filter((k) => k.startsWith('Versions/'))).toEqual(['Versions/Version1', 'Versions/Version2', 'Versions/Version3']);
    const manifest = new TextDecoder().decode(files.get('META-INF/manifest.xml'));
    expect(manifest).toContain('manifest:full-path="VersionList.xml" manifest:media-type=""');
    expect(manifest).toContain('manifest:full-path="Versions/Version3" manifest:media-type=""');
    // The saved package opens with its three versions; the new one is the state saved, without versions.
    const again = await load(bytes);
    expect(text(again.doc)).toBe('Current state');
    const v = again.medium.GetVersionList();
    expect(v.map((x) => [x.Identifier, x.Comment, x.Author])).toEqual([['Version1', 'Second, with a comment\nover two lines', ''], ['Version2', 'Third', ''], ['Version3', 'Mine', 'Me']]);
    const v3 = await readZip(again.medium.GetVersionStorage_Impl(3)!);
    expect(v3.has('VersionList.xml')).toBe(false);
    expect(text((await ImportODT(again.medium.GetVersionStorage_Impl(2)!)).doc)).toBe('Third state');
    expect(text((await ImportODT(again.medium.GetVersionStorage_Impl(3)!)).doc)).toBe('Current state');
  });

  it('drops deleted versions, reuses their names and stores none of an empty list', async () => {
    const { doc, medium } = await load(readFileSync('specs/writer/versions.odt'));
    // The dialog lists the versions before one is deleted.
    expect(medium.GetVersionList()).toHaveLength(2);
    medium.RemoveVersion_Impl('Version1');
    let files = await readZip(await SaveTo_Impl((extra) => ExportODT(doc, extra), medium));
    expect([...files.keys()].filter((k) => k.startsWith('Versions/'))).toEqual(['Versions/Version2']);
    // SfxMedium::AddVersion_Impl: the first free number.
    await SaveTo_Impl((extra) => ExportODT(doc, extra), medium, { pVersionItem: '' });
    expect(medium.GetVersionList().map((x) => x.Identifier)).toEqual(['Version2', 'Version1']);
    medium.RemoveVersion_Impl('Version1');
    medium.RemoveVersion_Impl('Version2');
    files = await readZip(await SaveTo_Impl((extra) => ExportODT(doc, extra), medium));
    expect([...files.keys()].some((k) => k.startsWith('Version'))).toBe(false);
  });

  it('starts the version list of a new document with its first save', async () => {
    const doc = new SwDoc();
    const medium = new SfxMedium();
    // A medium without storage (a new document) has no versions; the first save is to a storage.
    expect(medium.GetVersionList()).toEqual([]);
    const first = await load(await SaveTo_Impl((extra) => ExportODT(doc, extra), medium, { pVersionItem: 'x' }));
    expect(first.medium.GetVersionList().map((x) => [x.Identifier, x.Comment])).toEqual([['Version1', 'x']]);
    const second = await load(await SaveTo_Impl((extra) => ExportODT(doc, extra), medium, { pVersionItem: 'y', aVersionTime: { NanoSeconds: 0, Seconds: 0, Minutes: 0, Hours: 9, Day: 1, Month: 2, Year: 2025 } }));
    expect(second.medium.GetVersionList().map((x) => [x.Identifier, x.Comment, x.TimeStamp.Year])).toEqual([['Version1', 'x', 2026], ['Version2', 'y', 2025]]);
  });

  it('keeps "Always save a new version on closing" in settings.xml', async () => {
    const doc = new SwDoc();
    expect(IsSaveVersionOnClose(doc)).toBe(false);
    SetSaveVersionOnClose(doc, true);
    expect(doc.IsModified()).toBe(true);
    expect(IsSaveVersionOnClose((await ImportODT(await ExportODT(doc))).doc)).toBe(true);
  });
});
