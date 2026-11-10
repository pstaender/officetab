// SPDX-License-Identifier: MPL-2.0
// @upstream vcl/source/bitmap/BitmapMedianFilter.cxx reduced
// @upstream include/vcl/bitmap/BitmapMedianFilter.hxx faithful
// Statement by statement on RGBA buffers; the sorting network macros work on an array of the
// nine values per channel, the rows of BitmapColor are arrays of RGB triples. The result is a
// new 24 bit bitmap, so it is opaque.
import { BitmapFilter, type BitmapBuffer } from './bitmapfilter.ts';

// The macros operate on v[1] .. v[9].
function S2(v: Int32Array, a: number, b: number): void {
  let t: number;
  if ((t = v[b] - v[a]) < 0) {
    v[a] += t;
    v[b] -= t;
  }
}

function MN3(v: Int32Array, a: number, b: number, c: number): void {
  S2(v, a, b);
  S2(v, a, c);
}

function MX3(v: Int32Array, a: number, b: number, c: number): void {
  S2(v, b, c);
  S2(v, a, c);
}

function MNMX3(v: Int32Array, a: number, b: number, c: number): void {
  MX3(v, a, b, c);
  S2(v, a, b);
}

function MNMX4(v: Int32Array, a: number, b: number, c: number, d: number): void {
  S2(v, a, b);
  S2(v, c, d);
  S2(v, a, c);
  S2(v, b, d);
}

function MNMX5(v: Int32Array, a: number, b: number, c: number, d: number, e: number): void {
  S2(v, a, b);
  S2(v, c, d);
  MN3(v, a, c, e);
  MX3(v, b, d, e);
}

function MNMX6(v: Int32Array, a: number, b: number, c: number, d: number, e: number, f: number): void {
  S2(v, a, d);
  S2(v, b, e);
  S2(v, c, f);
  MN3(v, a, b, c);
  MX3(v, d, e, f);
}

export class BitmapMedianFilter extends BitmapFilter {
  override execute(rBitmap: BitmapBuffer): BitmapBuffer | null {
    const aBitmap = rBitmap;
    if (!aBitmap.width || !aBitmap.height) return null;
    const pRead = aBitmap.data;

    const aNewBmp: BitmapBuffer = {
      width: aBitmap.width, height: aBitmap.height,
      data: new Uint8ClampedArray(aBitmap.width * aBitmap.height * 4),
    };
    const pWrite = aNewBmp.data;

    const nWidth = aNewBmp.width, nWidth2 = nWidth + 2;
    const nHeight = aNewBmp.height, nHeight2 = nHeight + 2;
    const pColm = new Int32Array(nWidth2);
    const pRows = new Int32Array(nHeight2);
    const pColRow1 = new Int32Array(nWidth2 * 3);
    const pColRow2 = new Int32Array(nWidth2 * 3);
    const pColRow3 = new Int32Array(nWidth2 * 3);
    let pRowTmp1 = pColRow1;
    let pRowTmp2 = pColRow2;
    let pRowTmp3 = pColRow3;
    let pColor: number;
    let nY: number, nX: number, i: number;
    const nR = new Int32Array(10);
    const nG = new Int32Array(10);
    const nB = new Int32Array(10);
    const GetColor = (pRow: Int32Array, j: number, nRow: number, nCol: number) => {
      const p = (nRow * nWidth + nCol) * 4;
      pRow[j * 3] = pRead[p];
      pRow[j * 3 + 1] = pRead[p + 1];
      pRow[j * 3 + 2] = pRead[p + 2];
    };
    const ReadColor = (pRow: Int32Array, j: number, k: number) => {
      nR[k] = pRow[j * 3];
      nG[k] = pRow[j * 3 + 1];
      nB[k] = pRow[j * 3 + 2];
    };

    // create column LUT
    for (i = 0; i < nWidth2; i++) pColm[i] = i > 0 ? i - 1 : 0;

    pColm[nWidth + 1] = pColm[nWidth];

    // create row LUT
    for (i = 0; i < nHeight2; i++) pRows[i] = i > 0 ? i - 1 : 0;

    pRows[nHeight + 1] = pRows[nHeight];

    // read first three rows of bitmap color
    if (nHeight2 > 2) {
      for (i = 0; i < nWidth2; i++) {
        GetColor(pColRow1, i, pRows[0], pColm[i]);
        GetColor(pColRow2, i, pRows[1], pColm[i]);
        GetColor(pColRow3, i, pRows[2], pColm[i]);
      }
    }

    // do median filtering
    for (nY = 0; nY < nHeight;) {
      for (nX = 0; nX < nWidth; nX++) {
        pColor = nX;
        ReadColor(pRowTmp1, pColor, 1);
        ReadColor(pRowTmp1, ++pColor, 2);
        ReadColor(pRowTmp1, ++pColor, 3);

        pColor = nX;
        ReadColor(pRowTmp2, pColor, 4);
        ReadColor(pRowTmp2, ++pColor, 5);
        ReadColor(pRowTmp2, ++pColor, 6);

        pColor = nX;
        ReadColor(pRowTmp3, pColor, 7);
        ReadColor(pRowTmp3, ++pColor, 8);
        ReadColor(pRowTmp3, ++pColor, 9);

        MNMX6(nR, 1, 2, 3, 4, 5, 6);
        MNMX5(nR, 7, 2, 3, 4, 5);
        MNMX4(nR, 8, 2, 3, 4);
        MNMX3(nR, 9, 2, 3);

        MNMX6(nG, 1, 2, 3, 4, 5, 6);
        MNMX5(nG, 7, 2, 3, 4, 5);
        MNMX4(nG, 8, 2, 3, 4);
        MNMX3(nG, 9, 2, 3);

        MNMX6(nB, 1, 2, 3, 4, 5, 6);
        MNMX5(nB, 7, 2, 3, 4, 5);
        MNMX4(nB, 8, 2, 3, 4);
        MNMX3(nB, 9, 2, 3);

        // set destination color
        const p = (nY * nWidth + nX) * 4;
        pWrite[p] = nR[2] & 0xff;
        pWrite[p + 1] = nG[2] & 0xff;
        pWrite[p + 2] = nB[2] & 0xff;
        pWrite[p + 3] = 255;
      }

      if (++nY < nHeight) {
        if (pRowTmp1 === pColRow1) {
          pRowTmp1 = pColRow2;
          pRowTmp2 = pColRow3;
          pRowTmp3 = pColRow1;
        } else if (pRowTmp1 === pColRow2) {
          pRowTmp1 = pColRow3;
          pRowTmp2 = pColRow1;
          pRowTmp3 = pColRow2;
        } else {
          pRowTmp1 = pColRow1;
          pRowTmp2 = pColRow2;
          pRowTmp3 = pColRow3;
        }

        for (i = 0; i < nWidth2; i++) GetColor(pRowTmp3, i, pRows[nY + 2], pColm[i]);
      }
    }

    return aNewBmp;
  }
}
