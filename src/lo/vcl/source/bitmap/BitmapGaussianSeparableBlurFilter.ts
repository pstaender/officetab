// SPDX-License-Identifier: MPL-2.0
// @upstream vcl/source/bitmap/BitmapGaussianSeparableBlurFilter.cxx reduced
// @upstream include/vcl/bitmap/BitmapGaussianSeparableBlurFilter.hxx faithful
// Statement by statement on RGBA buffers, with pixel access as array indexing. Upstream reads a
// pixel even for a contribution whose weight is 0 because it lies outside a small bitmap; here
// such a pixel counts as black, which gives the same sum. Each pass writes a new 24 bit bitmap,
// so the result is opaque.
import { BitmapFilter, type BitmapBuffer } from './bitmapfilter.ts';

function NewBitmap(nWidth: number, nHeight: number): BitmapBuffer {
  return { width: nWidth, height: nHeight, data: new Uint8ClampedArray(nWidth * nHeight * 4) };
}

export class BitmapGaussianSeparableBlurFilter extends BitmapFilter {
  private mfRadius: number;

  constructor(fRadius: number) {
    super();
    this.mfRadius = fRadius;
  }

  /** Separable Gaussian Blur filter and accepts a blur radius
      as a parameter so the user can change the strength of the blur.
      Radius of 1.0 is 3 * standard deviation of gauss function.

      Separable Blur implementation uses 2x separable 1D convolution
      to process the image. */
  override execute(rBitmap: BitmapBuffer): BitmapBuffer | null {
    let aBitmap = rBitmap;
    if (!aBitmap.width || !aBitmap.height) return null;

    const nWidth = aBitmap.width;
    const nHeight = aBitmap.height;

    // Prepare Blur Vector
    const aNumberOfContributions = { value: 0 };
    let aBlurVector = BitmapGaussianSeparableBlurFilter.makeBlurKernel(this.mfRadius, aNumberOfContributions);
    let aWeights: number[] = [];
    let aPixels: number[] = [];
    let aCounts: number[] = [];

    // Do horizontal filtering
    BitmapGaussianSeparableBlurFilter.blurContributions(nWidth, aNumberOfContributions.value, aBlurVector,
      aWeights, aPixels, aCounts);

    // switch coordinates as convolution pass transposes result
    let aNewBitmap = NewBitmap(nHeight, nWidth);

    let bResult = BitmapGaussianSeparableBlurFilter.convolutionPass(aBitmap, aNewBitmap,
      aNumberOfContributions.value, aWeights, aPixels, aCounts);

    // Cleanup
    aWeights = [];
    aPixels = [];
    aCounts = [];

    if (!bResult) {
      aBlurVector = [];
    } else {
      // Swap current bitmap with new bitmap
      aBitmap = aNewBitmap;

      // Do vertical filtering
      BitmapGaussianSeparableBlurFilter.blurContributions(nHeight, aNumberOfContributions.value, aBlurVector,
        aWeights, aPixels, aCounts);

      aNewBitmap = NewBitmap(nWidth, nHeight);
      bResult = BitmapGaussianSeparableBlurFilter.convolutionPass(aBitmap, aNewBitmap,
        aNumberOfContributions.value, aWeights, aPixels, aCounts);

      // Cleanup
      aBlurVector = [];

      if (bResult) aBitmap = aNewBitmap; // swap current bitmap with new bitmap
    }

    if (bResult) return aBitmap;

    return null;
  }

  private static convolutionPass(rBitmap: BitmapBuffer, aNewBitmap: BitmapBuffer,
    aNumberOfContributions: number, pWeights: number[], pPixels: number[], pCount: number[]): boolean {
    const nHeight = rBitmap.height;
    const nWidth = rBitmap.width;
    const pRead = rBitmap.data;
    const pWrite = aNewBitmap.data;
    const nNewWidth = aNewBitmap.width;

    let aValueRed: number, aValueGreen: number, aValueBlue: number;
    let aSum: number, aWeight: number;
    let aBaseIndex: number, aIndex: number;

    for (let nSourceY = 0; nSourceY < nHeight; ++nSourceY) {
      for (let nSourceX = 0; nSourceX < nWidth; ++nSourceX) {
        aBaseIndex = nSourceX * aNumberOfContributions;
        aSum = aValueRed = aValueGreen = aValueBlue = 0.0;

        for (let j = 0; j < pCount[nSourceX]; ++j) {
          aIndex = aBaseIndex + j;

          aWeight = pWeights[aIndex];
          aSum += aWeight;

          // aColor = pReadAcc->GetColor(nSourceY, pPixels[aIndex]);
          const nPixel = pPixels[aIndex];
          if (nPixel < 0 || nPixel >= nWidth) continue;
          const p = (nSourceY * nWidth + nPixel) * 4;

          aValueRed += aWeight * pRead[p];
          aValueGreen += aWeight * pRead[p + 1];
          aValueBlue += aWeight * pRead[p + 2];
        }

        const nDestX = nSourceY;
        const nDestY = nSourceX;

        const q = (nDestY * nNewWidth + nDestX) * 4;
        pWrite[q] = Math.trunc(Math.min(Math.max(aValueRed / aSum, 0.0), 255.0));
        pWrite[q + 1] = Math.trunc(Math.min(Math.max(aValueGreen / aSum, 0.0), 255.0));
        pWrite[q + 2] = Math.trunc(Math.min(Math.max(aValueBlue / aSum, 0.0), 255.0));
        pWrite[q + 3] = 255;
      }
    }
    return true;
  }

  static makeBlurKernel(radius: number, rows: { value: number }): number[] {
    const intRadius = Math.trunc(radius + 1.0);
    rows.value = intRadius * 2 + 1;
    const matrix = new Array<number>(rows.value);

    const sigma = radius / 3;
    const radius2 = radius * radius;
    let index = 0;
    for (let row = -intRadius; row <= intRadius; row++) {
      const distance = row * row;
      if (distance > radius2) {
        matrix[index] = 0.0;
      } else {
        matrix[index] = Math.exp(-distance / (2.0 * sigma * sigma)) / Math.sqrt(2.0 * Math.PI * sigma);
      }
      index++;
    }
    return matrix;
  }

  static blurContributions(aSize: number, aNumberOfContributions: number, rBlurVector: number[],
    rWeights: number[], rPixels: number[], rCounts: number[]): void {
    rWeights.length = aSize * aNumberOfContributions;
    rPixels.length = aSize * aNumberOfContributions;
    rCounts.length = aSize;

    let aLeft: number, aRight: number, aCurrentCount: number, aPixelIndex: number;
    let aWeight: number;

    for (let i = 0; i < aSize; i++) {
      aLeft = i - Math.trunc(aNumberOfContributions / 2);
      aRight = i + Math.trunc(aNumberOfContributions / 2);
      aCurrentCount = 0;
      for (let j = aLeft; j <= aRight; j++) {
        aWeight = rBlurVector[aCurrentCount];

        // Mirror edges
        if (j < 0) {
          aPixelIndex = -j;
        } else if (j >= aSize) {
          aPixelIndex = aSize - j + aSize - 1;
        } else {
          aPixelIndex = j;
        }

        // Edge case for small bitmaps
        if (aPixelIndex < 0 || aPixelIndex >= aSize) {
          aWeight = 0.0;
        }

        rWeights[i * aNumberOfContributions + aCurrentCount] = aWeight;
        rPixels[i * aNumberOfContributions + aCurrentCount] = aPixelIndex;
        aCurrentCount++;
      }
      rCounts[i] = aCurrentCount;
    }
  }
}
