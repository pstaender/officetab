// SPDX-License-Identifier: MPL-2.0
// @upstream vcl/source/bitmap/BitmapConvolutionMatrixFilter.cxx reduced
// @upstream include/vcl/bitmap/BitmapConvolutionMatrixFilter.hxx faithful
// @upstream include/vcl/bitmap/BitmapSharpenFilter.hxx faithful
// Statement by statement on RGBA buffers; the rows of BitmapColor are arrays of RGB triples and
// scanline access is array indexing. The result is a new 24 bit bitmap, so it is opaque.
import { BitmapFilter, type BitmapBuffer } from './bitmapfilter.ts';

export class BitmapConvolutionMatrixFilter extends BitmapFilter {
  private mrMatrix: readonly number[];

  constructor(rMatrix: readonly number[]) {
    super();
    this.mrMatrix = rMatrix;
  }

  override execute(rBitmap: BitmapBuffer): BitmapBuffer | null {
    const aBitmap = rBitmap;
    if (!aBitmap.width || !aBitmap.height) return null;
    const pRead = aBitmap.data;

    const aNewBmp: BitmapBuffer = {
      width: aBitmap.width, height: aBitmap.height,
      data: new Uint8ClampedArray(aBitmap.width * aBitmap.height * 4),
    };
    const pWrite = aNewBmp.data;

    const aCoeff: Int32Array[] = [];

    // create LUT of products of matrix value and possible color component values
    for (let nY = 0; nY < 9; nY++) {
      aCoeff[nY] = new Int32Array(256);
      for (let nX = 0, nTmp = 0, nMatrixVal = this.mrMatrix[nY]; nX < 256; nX++, nTmp += nMatrixVal) {
        aCoeff[nY][nX] = nTmp;
      }
    }

    const nWidth = aNewBmp.width;
    const nWidth2 = nWidth + 2;
    const pColm = new Int32Array(nWidth2);

    // create column LUT
    for (let nColIdx = 0; nColIdx < nWidth2; nColIdx++) {
      pColm[nColIdx] = nColIdx > 0 ? nColIdx - 1 : 0;
    }

    pColm[nWidth + 1] = pColm[nWidth];

    const nHeight = aNewBmp.height;
    const nHeight2 = nHeight + 2;
    const pRows = new Int32Array(nHeight2);

    // create row LUT
    for (let nRowIdx = 0; nRowIdx < nHeight2; nRowIdx++) {
      pRows[nRowIdx] = nRowIdx > 0 ? nRowIdx - 1 : 0;
    }

    pRows[nHeight + 1] = pRows[nHeight];

    // rows of BitmapColor, 3 components per entry
    const pColRow1 = new Int32Array(nWidth2 * 3);
    const pColRow2 = new Int32Array(nWidth2 * 3);
    const pColRow3 = new Int32Array(nWidth2 * 3);
    let pRowTmp1 = pColRow1;
    let pRowTmp2 = pColRow2;
    let pRowTmp3 = pColRow3;
    const GetColor = (pRow: Int32Array, i: number, nY: number, nX: number) => {
      const p = (nY * nWidth + nX) * 4;
      pRow[i * 3] = pRead[p];
      pRow[i * 3 + 1] = pRead[p + 1];
      pRow[i * 3 + 2] = pRead[p + 2];
    };

    // read first three rows of bitmap color
    for (let nRowIdx = 0; nRowIdx < nWidth2; nRowIdx++) {
      GetColor(pColRow1, nRowIdx, pRows[0], pColm[nRowIdx]);
      GetColor(pColRow2, nRowIdx, pRows[1], pColm[nRowIdx]);
      GetColor(pColRow3, nRowIdx, pRows[2], pColm[nRowIdx]);
    }

    // do convolution
    for (let nY = 0; nY < nHeight;) {
      for (let nX = 0; nX < nWidth; nX++) {
        // first row
        let pTmp = aCoeff[0];
        let pColor = nX * 3;
        let nSumR = pTmp[pRowTmp1[pColor]];
        let nSumG = pTmp[pRowTmp1[pColor + 1]];
        let nSumB = pTmp[pRowTmp1[pColor + 2]];

        pTmp = aCoeff[1];
        pColor += 3;
        nSumR += pTmp[pRowTmp1[pColor]];
        nSumG += pTmp[pRowTmp1[pColor + 1]];
        nSumB += pTmp[pRowTmp1[pColor + 2]];

        pTmp = aCoeff[2];
        pColor += 3;
        nSumR += pTmp[pRowTmp1[pColor]];
        nSumG += pTmp[pRowTmp1[pColor + 1]];
        nSumB += pTmp[pRowTmp1[pColor + 2]];

        // second row
        pTmp = aCoeff[3];
        pColor = nX * 3;
        nSumR += pTmp[pRowTmp2[pColor]];
        nSumG += pTmp[pRowTmp2[pColor + 1]];
        nSumB += pTmp[pRowTmp2[pColor + 2]];

        pTmp = aCoeff[4];
        pColor += 3;
        nSumR += pTmp[pRowTmp2[pColor]];
        nSumG += pTmp[pRowTmp2[pColor + 1]];
        nSumB += pTmp[pRowTmp2[pColor + 2]];

        pTmp = aCoeff[5];
        pColor += 3;
        nSumR += pTmp[pRowTmp2[pColor]];
        nSumG += pTmp[pRowTmp2[pColor + 1]];
        nSumB += pTmp[pRowTmp2[pColor + 2]];

        // third row
        pTmp = aCoeff[6];
        pColor = nX * 3;
        nSumR += pTmp[pRowTmp3[pColor]];
        nSumG += pTmp[pRowTmp3[pColor + 1]];
        nSumB += pTmp[pRowTmp3[pColor + 2]];

        pTmp = aCoeff[7];
        pColor += 3;
        nSumR += pTmp[pRowTmp3[pColor]];
        nSumG += pTmp[pRowTmp3[pColor + 1]];
        nSumB += pTmp[pRowTmp3[pColor + 2]];

        pTmp = aCoeff[8];
        pColor += 3;
        nSumR += pTmp[pRowTmp3[pColor]];
        nSumG += pTmp[pRowTmp3[pColor + 1]];
        nSumB += pTmp[pRowTmp3[pColor + 2]];

        const nDivisor = 8;

        // calculate destination color
        const p = (nY * nWidth + nX) * 4;
        pWrite[p] = Math.min(Math.max(Math.trunc(nSumR / nDivisor), 0), 255);
        pWrite[p + 1] = Math.min(Math.max(Math.trunc(nSumG / nDivisor), 0), 255);
        pWrite[p + 2] = Math.min(Math.max(Math.trunc(nSumB / nDivisor), 0), 255);
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

        for (let i = 0; i < nWidth2; i++) {
          GetColor(pRowTmp3, i, pRows[nY + 2], pColm[i]);
        }
      }
    }

    return aNewBmp;
  }
}

const g_SharpenMatrix = [-1, -1, -1, -1, 16, -1, -1, -1, -1] as const;

export class BitmapSharpenFilter extends BitmapConvolutionMatrixFilter {
  constructor() {
    super(g_SharpenMatrix);
  }
}
