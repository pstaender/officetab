// SPDX-License-Identifier: MPL-2.0
// @upstream vcl/source/graphic/Manager.cxx reduced
// Upstream swaps graphics in and out of memory; here decoded bitmaps are cached per document data
// and decoding is asynchronous, so painting asks again once a graphic is ready.
import type { SwDoc } from '../../../sw/inc/doc.ts';

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
  Get(doc: SwDoc, key: string): ImageBitmap | null {
    const d = this.m_aDecoded.get(key);
    if (d === undefined) { void this.decode(doc, key); return null; }
    return typeof d === 'string' ? null : d;
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
