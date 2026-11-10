// SPDX-License-Identifier: MPL-2.0
// @upstream vcl/source/bitmap/Octree.cxx reduced
// @upstream vcl/inc/bitmap/Octree.hxx reduced
// Colour reduction by octree and the inverse colour map, as upstream, reading an RGBA buffer
// instead of a BitmapReadAccess (the palette input branch is left out: the input never has one).
// Child nodes are plain references instead of unique_ptr.
import type { BitmapBuffer } from './bitmapfilter.ts';
import { BitmapColor, BitmapPalette } from './bitmappalette.ts';

const OCTREE_BITS = 5;
const OCTREE_BITS_1 = 10;
const gnBits = 8 - OCTREE_BITS;

export class OctreeNode {
  nCount = 0;
  nRed = 0;
  nGreen = 0;
  nBlue = 0;
  pChild: (OctreeNode | null)[] = [null, null, null, null, null, null, null, null];
  pNext: OctreeNode | null = null;
  nPalIndex = 0;
  bLeaf = false;
}

export class Octree {
  private maPalette = new BitmapPalette();
  private mnLeafCount: number;
  private mnLevel: number;
  private pTree: OctreeNode | null = null;
  private mpReduce: (OctreeNode | null)[];
  private mnPalIndex: number;

  constructor(rReadAcc: BitmapBuffer, nColors: number) {
    this.mnLeafCount = 0;
    this.mnLevel = 0;
    this.mpReduce = new Array<OctreeNode | null>(OCTREE_BITS + 1).fill(null);
    this.mnPalIndex = 0;

    const pAccess = rReadAcc;
    const nMax = nColors;

    if (!pAccess.width || !pAccess.height) return;

    const nWidth = pAccess.width;
    const nHeight = pAccess.height;
    const pData = pAccess.data;

    for (let nY = 0; nY < nHeight; nY++) {
      for (let nX = 0; nX < nWidth; nX++) {
        const p = (nY * nWidth + nX) * 4;
        this.mnLevel = 0;
        this.pTree = this.add(this.pTree, pData[p], pData[p + 1], pData[p + 2]);
        while (this.mnLeafCount > nMax) this.reduce();
      }
    }
  }

  /** Returns the node, created when rpNode is null (upstream resets the unique_ptr reference). */
  private add(rpNode: OctreeNode | null, nR: number, nG: number, nB: number): OctreeNode {
    // possibly generate new nodes
    if (!rpNode) {
      rpNode = new OctreeNode();
      rpNode.bLeaf = OCTREE_BITS === this.mnLevel;

      if (rpNode.bLeaf) this.mnLeafCount++;
      else {
        rpNode.pNext = this.mpReduce[this.mnLevel];
        this.mpReduce[this.mnLevel] = rpNode;
      }
    }

    if (rpNode.bLeaf) {
      rpNode.nCount++;
      rpNode.nRed += nR;
      rpNode.nGreen += nG;
      rpNode.nBlue += nB;
    } else {
      const nShift = 7 - this.mnLevel;
      const cMask = 0x80 >> this.mnLevel;
      const nIndex = (((nR & cMask) >> nShift) << 2) | (((nG & cMask) >> nShift) << 1) | ((nB & cMask) >> nShift);
      this.mnLevel++;
      rpNode.pChild[nIndex] = this.add(rpNode.pChild[nIndex], nR, nG, nB);
    }
    return rpNode;
  }

  private reduce(): void {
    let nRedSum = 0;
    let nGreenSum = 0;
    let nBlueSum = 0;
    let nChildren = 0;

    let nIndex = OCTREE_BITS - 1;
    while (nIndex > 0 && !this.mpReduce[nIndex]) {
      nIndex--;
    }

    const pNode = this.mpReduce[nIndex]!;
    this.mpReduce[nIndex] = pNode.pNext;

    for (let i = 0; i < 8; i++) {
      const pChild = pNode.pChild[i];
      if (pChild) {
        nRedSum += pChild.nRed;
        nGreenSum += pChild.nGreen;
        nBlueSum += pChild.nBlue;
        pNode.nCount += pChild.nCount;

        pNode.pChild[i] = null;
        nChildren++;
      }
    }

    pNode.bLeaf = true;
    pNode.nRed = nRedSum;
    pNode.nGreen = nGreenSum;
    pNode.nBlue = nBlueSum;
    this.mnLeafCount -= --nChildren;
  }

  private CreatePalette(pNode: OctreeNode): void {
    if (pNode.bLeaf) {
      pNode.nPalIndex = this.mnPalIndex;
      this.maPalette.set(this.mnPalIndex++, new BitmapColor(
        Math.trunc(pNode.nRed / pNode.nCount),
        Math.trunc(pNode.nGreen / pNode.nCount),
        Math.trunc(pNode.nBlue / pNode.nCount)));
    } else {
      for (const i of pNode.pChild) {
        if (i) {
          this.CreatePalette(i);
        }
      }
    }
  }

  private GetPalIndex(pNode: OctreeNode, color: BitmapColor): void {
    if (pNode.bLeaf) this.mnPalIndex = pNode.nPalIndex;
    else {
      const nShift = 7 - this.mnLevel;
      const cMask = 0x80 >> this.mnLevel;
      this.mnLevel++;
      const nIndex = (((color.GetRed() & cMask) >> nShift) << 2)
        | (((color.GetGreen() & cMask) >> nShift) << 1)
        | ((color.GetBlue() & cMask) >> nShift);

      this.GetPalIndex(pNode.pChild[nIndex]!, color);
    }
  }

  GetPalette(): BitmapPalette {
    this.maPalette.SetEntryCount(this.mnLeafCount & 0xffff);
    this.mnPalIndex = 0;
    if (this.pTree) this.CreatePalette(this.pTree);
    return this.maPalette;
  }

  GetBestPaletteIndex(rColor: BitmapColor): number {
    this.mnPalIndex = 65535;
    this.mnLevel = 0;
    if (this.pTree) this.GetPalIndex(this.pTree, rColor);
    return this.mnPalIndex;
  }
}

const nColorMax = 1 << OCTREE_BITS;

export class InverseColorMap {
  private mpBuffer: Float64Array = new Float64Array(0);
  private mpMap: Uint8Array = new Uint8Array(0);

  constructor(rPal: BitmapPalette) {
    const xsqr = 1 << (gnBits << 1);
    const xsqr2 = xsqr << 1;
    const nColors = rPal.GetEntryCount();
    const x = 1 << gnBits;
    const x2 = x >> 1;
    let r: number, g: number, b: number;
    let rxx: number, gxx: number, bxx: number;

    this.ImplCreateBuffers();

    for (let nIndex = 0; nIndex < nColors; nIndex++) {
      const rColor = rPal.get(nIndex);
      const cRed = rColor.GetRed();
      const cGreen = rColor.GetGreen();
      const cBlue = rColor.GetBlue();

      let rdist = cRed - x2;
      let gdist = cGreen - x2;
      let bdist = cBlue - x2;
      rdist = rdist * rdist + gdist * gdist + bdist * bdist;

      const crinc = (xsqr - (cRed << gnBits)) << 1;
      const cginc = (xsqr - (cGreen << gnBits)) << 1;
      const cbinc = (xsqr - (cBlue << gnBits)) << 1;

      let cdp = 0;
      let crgbp = 0;

      for (r = 0, rxx = crinc; r < nColorMax; rdist += rxx, r++, rxx += xsqr2) {
        for (g = 0, gdist = rdist, gxx = cginc; g < nColorMax; gdist += gxx, g++, gxx += xsqr2) {
          for (b = 0, bdist = gdist, bxx = cbinc; b < nColorMax; bdist += bxx, b++, cdp++, crgbp++, bxx += xsqr2)
            if (!nIndex || this.mpBuffer[cdp] > bdist) {
              this.mpBuffer[cdp] = bdist;
              this.mpMap[crgbp] = nIndex;
            }
        }
      }
    }
  }

  private ImplCreateBuffers(): void {
    const nCount = nColorMax * nColorMax * nColorMax;

    this.mpMap = new Uint8Array(nCount);
    this.mpBuffer = new Float64Array(nCount).fill(Number.MAX_VALUE);
  }

  GetBestPaletteIndex(rColor: BitmapColor): number {
    return this.mpMap[((rColor.GetRed() >> gnBits) << OCTREE_BITS_1)
      | ((rColor.GetGreen() >> gnBits) << OCTREE_BITS)
      | (rColor.GetBlue() >> gnBits)];
  }
}
