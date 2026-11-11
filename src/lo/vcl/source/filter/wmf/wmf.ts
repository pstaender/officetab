// SPDX-License-Identifier: MPL-2.0
// @upstream vcl/source/filter/wmf/wmf.cxx partial
// ReadWindowMetafile: a WMF or EMF file as a GDIMetaFile. Upstream goes through VectorGraphicData
// (emfio's XEmfParser, which picks the reader by the file's header); here the readers are called
// directly. Compressed metafiles (WMZ, EMZ) are not read.

import { SvStream } from '../../../../tools/source/stream/stream.ts';
import { GDIMetaFile } from '../../gdi/gdimtf.ts';
import { EmfReader } from '../../../../emfio/source/reader/emfreader.ts';
import { WmfReader } from '../../../../emfio/source/reader/wmfreader.ts';

/** GraphicFormatDetector::checkWMF: a placeable header (0x9AC6CDD7) or a WMF header. */
export function IsWMF(d: Uint8Array): boolean {
  if (d.length < 4) return false;
  const nFirstLong = ((d[0]! << 24) | (d[1]! << 16) | (d[2]! << 8) | d[3]!) >>> 0;
  return nFirstLong === 0xd7cdc69a || nFirstLong === 0x01000900;
}

/** GraphicFormatDetector::checkEMF: an EMR_HEADER record with the " EMF" signature. */
export function IsEMF(d: Uint8Array): boolean {
  return d.length >= 44 && d[0] === 1 && d[1] === 0 && d[2] === 0 && d[3] === 0 && d[40] === 0x20 && d[41] === 0x45 && d[42] === 0x4d && d[43] === 0x46;
}

/** The metafile of WMF or EMF data, or null when it cannot be read. */
export function ReadWindowMetafile(aData: Uint8Array): GDIMetaFile | null {
  const rMTF = new GDIMetaFile();
  if (IsEMF(aData)) {
    const pReader = new EmfReader(new SvStream(aData), rMTF);
    const bOk = pReader.ReadEnhWMF();
    pReader.Finish();
    return bOk || rMTF.GetActionSize() > 1 ? rMTF : null;
  }
  if (IsWMF(aData)) {
    const pReader = new WmfReader(new SvStream(aData), rMTF);
    const bOk = pReader.ReadWMF();
    pReader.Finish();
    return bOk || rMTF.GetActionSize() > 1 ? rMTF : null;
  }
  return null;
}
