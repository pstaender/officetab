// SPDX-License-Identifier: MPL-2.0
// @upstream vcl/source/graphic/Manager.cxx reduced
// Upstream swaps graphics in and out of memory; here decoded bitmaps are cached per document data
// and decoding is asynchronous, so painting asks again once a graphic is ready. A graphic with
// colour attributes is shown as its modified bitmap (Bitmap::Modify with the attributes' modifier
// stack), cached per graphic and attributes as upstream buffers it (BufferedData_ModifiedBitmap).
import type { SwDoc } from '../../../sw/inc/doc.ts';
import { GraphicModifierKey, GraphicModifierStack, type GraphicAttr } from '../../../drawinglayer/source/primitive2d/graphicprimitivehelper2d.ts';
import { Modify } from '../bitmap/bitmap.ts';

export class GraphicManager {
  private m_aDecoded = new Map<string, ImageBitmap | 'pending' | 'failed'>();
  private m_aPending = new Map<string, Promise<ImageBitmap | null>>();
  /** Called after a graphic finished decoding, to repaint. */
  onLoaded: () => void = () => {};

  private decode(doc: SwDoc, key: string): Promise<ImageBitmap | null> {
    let p = this.m_aPending.get(key);
    if (p) return p;
    const g = doc.m_aGraphics.get(key);
    if (!g) return Promise.resolve(null);
    this.m_aDecoded.set(key, 'pending');
    p = createImageBitmap(new Blob([g.data as BlobPart], { type: g.mime }))
      .then((b) => { this.m_aDecoded.set(key, b); this.onLoaded(); return b; })
      .catch(() => { this.m_aDecoded.set(key, 'failed'); return null; });
    this.m_aPending.set(key, p);
    return p;
  }

  /** The decoded graphic, or null while it decodes (decoding starts on the first request). */
  Get(doc: SwDoc, key: string, attr?: GraphicAttr): ImageBitmap | null {
    const mod = GraphicModifierKey(attr);
    if (mod) {
      const m = this.m_aDecoded.get(`${key}|${mod}`);
      if (m === undefined) { void this.modified(doc, key, attr!); return null; }
      return typeof m === 'string' ? null : m;
    }
    const d = this.m_aDecoded.get(key);
    if (d === undefined) { void this.decode(doc, key); return null; }
    return typeof d === 'string' ? null : d;
  }

  /** The modified pixels of a graphic, for its colour attributes. */
  private async modifiedPixels(doc: SwDoc, key: string, attr: GraphicAttr): Promise<ImageData | null> {
    const b = await this.decode(doc, key);
    if (!b) return null;
    const cv = new OffscreenCanvas(b.width, b.height);
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(b, 0, 0);
    const src = ctx.getImageData(0, 0, b.width, b.height);
    const out = Modify({ width: src.width, height: src.height, data: src.data }, GraphicModifierStack(attr));
    return new ImageData(out.data as Uint8ClampedArray<ArrayBuffer>, out.width, out.height);
  }

  private modified(doc: SwDoc, key: string, attr: GraphicAttr): Promise<ImageBitmap | null> {
    const id = `${key}|${GraphicModifierKey(attr)}`;
    let p = this.m_aPending.get(id);
    if (p) return p;
    this.m_aDecoded.set(id, 'pending');
    p = this.modifiedPixels(doc, key, attr)
      .then((img) => (img ? createImageBitmap(img) : null))
      .then((b) => { this.m_aDecoded.set(id, b ?? 'failed'); if (b) this.onLoaded(); return b; })
      .catch(() => { this.m_aDecoded.set(id, 'failed'); return null; });
    this.m_aPending.set(id, p);
    return p;
  }

  /** The graphic as it is shown, as image data for printing: the stored data, or a PNG of the modified bitmap. */
  async GetPrintBlob(doc: SwDoc, key: string, attr?: GraphicAttr): Promise<Blob | null> {
    const g = doc.m_aGraphics.get(key);
    if (!g) return null;
    if (!GraphicModifierKey(attr)) return new Blob([g.data as BlobPart], { type: g.mime });
    const img = await this.modifiedPixels(doc, key, attr!);
    if (!img) return null;
    const cv = new OffscreenCanvas(img.width, img.height);
    cv.getContext('2d')!.putImageData(img, 0, 0);
    return cv.convertToBlob({ type: 'image/png' });
  }

  /** Waits for every graphic of the document, for printing. */
  async LoadAll(doc: SwDoc): Promise<void> {
    await Promise.all([...doc.m_aGraphics.keys()].map((k) => this.decode(doc, k)));
  }
}

/** Natural size of graphic data in twips at 96 dpi, as Writer sizes pixel graphics without a resolution. */
export async function GetPrefSize(data: Uint8Array, mime: string): Promise<{ width: number; height: number }> {
  const b = await createImageBitmap(new Blob([data as BlobPart], { type: mime }));
  const size = { width: b.width * 15, height: b.height * 15 };
  b.close();
  return size;
}
