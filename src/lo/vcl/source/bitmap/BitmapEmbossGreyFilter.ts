// SPDX-License-Identifier: MPL-2.0
// @upstream vcl/source/bitmap/BitmapEmbossGreyFilter.cxx reduced
// @upstream include/vcl/bitmap/BitmapEmbossGreyFilter.hxx faithful
// Statement by statement on RGBA buffers, with scanline access as array indexing. The angles are
// in hundredths of a degree (Degree100). The result is an 8 bit bitmap with the grey palette,
// which has no alpha: it is opaque.
import { BitmapFilter, type BitmapBuffer } from './bitmapfilter.ts';
import { CreatePaletteBitmap, ImplMakeGreyscales, PaletteBitmapToBuffer } from './bitmap.ts';

/** basegfx::fround<sal_uInt8> */
function froundUInt8(fVal: number): number {
  if (fVal >= 0.0) {
    if (fVal >= 255 - 0.5) return 255;
    return Math.trunc(fVal + 0.5);
  }
  return 0;
}

/** toRadians(Degree100): basegfx::deg2rad<100> */
function toRadians(x: number): number {
  return (x / (90.0 * 100)) * (Math.PI / 2);
}

export class BitmapEmbossGreyFilter extends BitmapFilter {
  private mnAzimuthAngle: number;
  private mnElevationAngle: number;

  constructor(nAzimuthAngle: number, nElevationAngle: number) {
    super();
    this.mnAzimuthAngle = nAzimuthAngle;
    this.mnElevationAngle = nElevationAngle;
  }

  override execute(rBitmap: BitmapBuffer): BitmapBuffer | null {
    const aBitmap = ImplMakeGreyscales(rBitmap);
    if (!aBitmap) return null;

    const pReadAcc = aBitmap;
    const aNewBmp = CreatePaletteBitmap(aBitmap.width, aBitmap.height, pReadAcc.palette);
    const pWriteAcc = aNewBmp;

    const nWidth = pWriteAcc.width;
    const nHeight = pWriteAcc.height;
    const pHMap = new Int32Array(nWidth + 2);
    const pVMap = new Int32Array(nHeight + 2);
    const GetPixel = (nRow: number, nCol: number) => pReadAcc.indices[nRow * nWidth + nCol];

    // fill mapping tables
    pHMap[0] = 0;

    for (let nX = 1; nX <= nWidth; nX++) {
      pHMap[nX] = nX - 1;
    }

    pHMap[nWidth + 1] = nWidth - 1;

    pVMap[0] = 0;

    for (let nY = 1; nY <= nHeight; nY++) {
      pVMap[nY] = nY - 1;
    }

    pVMap[nHeight + 1] = nHeight - 1;

    const fAzim = toRadians(this.mnAzimuthAngle);
    const fElev = toRadians(this.mnElevationAngle);
    const nLx = Math.cos(fAzim) * Math.cos(fElev) * 255.0;
    const nLy = Math.sin(fAzim) * Math.cos(fElev) * 255.0;
    const nLz = Math.sin(fElev) * 255.0;
    const nNz = (6 * 255.0) / 4;
    const nNzLz = nNz * nLz;
    const cLz = froundUInt8(nLz);

    for (let nY = 0; nY < nHeight; nY++) {
      let nGrey11 = GetPixel(pVMap[nY], pHMap[0]);
      let nGrey12 = GetPixel(pVMap[nY], pHMap[1]);
      let nGrey13 = GetPixel(pVMap[nY], pHMap[2]);
      let nGrey21 = GetPixel(pVMap[nY + 1], pHMap[0]);
      let nGrey22 = GetPixel(pVMap[nY + 1], pHMap[1]);
      let nGrey23 = GetPixel(pVMap[nY + 1], pHMap[2]);
      let nGrey31 = GetPixel(pVMap[nY + 2], pHMap[0]);
      let nGrey32 = GetPixel(pVMap[nY + 2], pHMap[1]);
      let nGrey33 = GetPixel(pVMap[nY + 2], pHMap[2]);

      let aGrey = 0;

      for (let nX = 0; nX < nWidth; nX++) {
        const nNx = nGrey11 + nGrey21 + nGrey31 - nGrey13 - nGrey23 - nGrey33;
        const nNy = nGrey31 + nGrey32 + nGrey33 - nGrey11 - nGrey12 - nGrey13;
        let nDotL: number;

        if (!nNx && !nNy) {
          aGrey = cLz;
        } else if ((nDotL = nNx * nLx + nNy * nLy + nNzLz) < 0) {
          aGrey = 0;
        } else {
          const fGrey = nDotL / Math.hypot(nNx, nNy, nNz);
          aGrey = froundUInt8(fGrey);
        }

        pWriteAcc.indices[nY * nWidth + nX] = aGrey;

        if (nX < nWidth - 1) {
          const nNextX = pHMap[nX + 3];

          nGrey11 = nGrey12;
          nGrey12 = nGrey13;
          nGrey13 = GetPixel(pVMap[nY], nNextX);
          nGrey21 = nGrey22;
          nGrey22 = nGrey23;
          nGrey23 = GetPixel(pVMap[nY + 1], nNextX);
          nGrey31 = nGrey32;
          nGrey32 = nGrey33;
          nGrey33 = GetPixel(pVMap[nY + 2], nNextX);
        }
      }
    }

    return PaletteBitmapToBuffer(aNewBmp);
  }
}
