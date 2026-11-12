import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILES, FontKindOf, FontService, OFFERED_FONTS } from '../../src/app/fonts.ts';
import { catalogues, t } from '../../src/app/i18n.ts';
import { FindMetricCompatibleFont } from '../../src/lo/vcl/source/font/PhysicalFontCollection.ts';
import catalog from '../../src/app/generated/webfonts.json';

describe('font profiles', () => {
  it('draws a font with itself, then its replacement, then the default of its kind', () => {
    const fs = new FontService();
    fs.setActive('google');
    expect(fs.stack('Calibri')).toBe('"Calibri", "Carlito", "Inter", sans-serif');
    expect(fs.stack('Times New Roman')).toBe('"Times New Roman", "TeX Gyre Termes", sans-serif'.replace('sans-serif', 'serif'));
    expect(fs.stack('Consolas')).toBe('"Consolas", "JetBrains Mono", "Fira Code", monospace');
    expect(fs.stack('Some Unknown Font')).toBe('"Some Unknown Font", "Inter", sans-serif');
    fs.alwaysReplace = true;
    expect(fs.stack('Calibri')).toBe('"Carlito", "Calibri", "Inter", sans-serif');
  });

  it("uses LibreOffice's metric-compatible table, with open stand-ins for LibreOffice's own fonts", () => {
    const fs = new FontService();
    fs.setActive('libreoffice');
    expect(FindMetricCompatibleFont('calibri')).toBe('Carlito');
    expect(fs.stack('Arial')).toBe('"Arial", "Liberation Sans", "Arimo", sans-serif');
    expect(fs.stack('Calibri')).toBe('"Calibri", "Carlito", "Liberation Sans", "Arimo", sans-serif');
  });

  it('offers the requested Google fonts and knows the whole catalogue', () => {
    for (const f of ['Roboto', 'Open Sans', 'Google Sans', 'Inter', 'Montserrat', 'Poppins', 'Oswald', 'Roboto Condensed', 'Source Sans 3', 'Merriweather', 'IBM Plex Mono', 'Lato', 'Carlito', 'Fira Code', 'TeX Gyre Termes']) expect(OFFERED_FONTS).toContain(f);
    expect(catalog.fonts.length).toBeGreaterThan(1500);
    expect(new FontService().isWebFont('Playfair Display')).toBe(true);
    expect([FontKindOf('Fira Code'), FontKindOf('Merriweather'), FontKindOf('Courier New'), FontKindOf('Georgia')]).toEqual(['mono', 'serif', 'mono', 'serif']);
    // Every replacement of the built-in profiles can be loaded.
    const fs = new FontService();
    for (const p of BUILTIN_PROFILES) for (const r of [...Object.values(p.replacements), ...Object.values(p.defaults)]) {
      if (!r.startsWith('Liberation') && !['Calibri', 'Cambria'].includes(r)) expect(fs.isWebFont(r), r).toBe(true);
    }
  });

  it('clones, edits, exports and imports profiles', () => {
    const fs = new FontService();
    const copy = fs.cloneProfile(BUILTIN_PROFILES[1]!, 'Mine');
    fs.updateProfile({ ...copy, replacements: { ...copy.replacements, Calibri: 'Lato' } });
    expect(fs.stack('Calibri')).toContain('"Lato"');
    const json = fs.exportProfile(fs.active);
    expect(JSON.parse(json)).toMatchObject({ format: 'writer-font-profile', name: 'Mine', replacements: { Calibri: 'Lato' } });
    const imported = fs.importProfile(json);
    expect(imported.id).not.toBe(copy.id);
    expect(fs.active.replacements.Calibri).toBe('Lato');
    expect(() => fs.importProfile('{"foo": 1}')).toThrow(t('fonts.importError'));
    fs.deleteProfile(imported.id);
    expect(fs.profiles.some((p) => p.id === imported.id)).toBe(false);
  });
});

describe('translations', () => {
  it('has every text in every language', () => {
    const keys = Object.keys(catalogues.en!).sort();
    for (const [lang, cat] of Object.entries(catalogues)) expect(Object.keys(cat).sort(), lang).toEqual(keys);
    expect(t('fonts.copyOf', { name: 'X' }, 'de')).toBe('Kopie von X');
  });
});

describe('font families of the document', () => {
  it('give a font the system does not know its kind of fallback', async () => {
    const { SetFontFamilies } = await import('../../src/lo/vcl/source/outdev/text.ts');
    expect(FontKindOf('Bitstream Charter')).toBe('sans');
    SetFontFamilies(new Map([['Bitstream Charter', 'roman'], ['Letter Gothic', 'modern']]));
    expect(FontKindOf('Bitstream Charter')).toBe('serif');
    expect(FontKindOf('Letter Gothic')).toBe('mono');
    SetFontFamilies(new Map());
  });
});
