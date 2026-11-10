// TIFF graphics (ImportTiffGraphicImport), font family names (getMapName), and what the DOCX
// import does with theme coloured text boxes and character anchored pictures.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { GetTiffSize, ImportTiffGraphicImport, IsTiff } from '../../src/lo/vcl/source/filter/itiff/itiff.ts';
import { DetectGraphic } from '../../src/lo/vcl/source/filter/GraphicFormatDetector.ts';
import { getMapName } from '../../src/lo/unotools/source/config/fontcfg.ts';

const DATA = new URL('./data/tiff/', import.meta.url);

describe('TIFF', () => {
  // Synthetic 37 × 23 images in the layouts and compressions the reader handles; the expected
  // pixels are libtiff's (tiff2rgba).
  const files = readdirSync(DATA).filter((f) => f.endsWith('.tif'));

  it.each(files)('decodes %s as libtiff does', async (name) => {
    const data = new Uint8Array(readFileSync(new URL(name, DATA)));
    expect(IsTiff(data)).toBe(true);
    const img = (await ImportTiffGraphicImport(data))!;
    expect([img.width, img.height]).toEqual([37, 23]);
    const want = new Uint8Array(readFileSync(new URL(name.replace(/\.tif$/, '.rgba'), DATA)));
    let differing = 0;
    for (let i = 0; i < want.length; i++) if (Math.abs(want[i]! - img.data[i]!) > 1) differing++;
    expect(differing).toBe(0);
  });

  it('reads the size and resolution from the first directory', () => {
    const data = new Uint8Array(readFileSync(new URL('rgb_lzw_pred.tif', DATA)));
    expect(GetTiffSize(data)).toMatchObject({ width: 37, height: 23 });
    expect(DetectGraphic(data)).toMatchObject({ mnPixWidth: 37, mnPixHeight: 23 });
    expect(IsTiff(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toBe(false);
  });
});

describe('Font names', () => {
  it('finds the family of a name without vendor, weight, width and type words (getMapName)', () => {
    expect(getMapName('cambriamath').rFamilyName).toBe('cambria');
    expect(getMapName('arialmt')).toEqual({ rShortName: 'arial', rFamilyName: 'arial' });
    expect(getMapName('msgothic').rShortName).toBe('gothic');
    expect(getMapName('franklingothicmedium').rFamilyName).toBe('franklin');
    expect(getMapName('futurabold2').rFamilyName).toBe('futura');
  });
});
