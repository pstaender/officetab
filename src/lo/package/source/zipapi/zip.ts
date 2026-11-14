// SPDX-License-Identifier: MPL-2.0
// @upstream package/source/zipapi/ZipFile.cxx reduced
// @upstream package/source/zipapi/ZipOutputStream.cxx reduced
// Uses the platform's (De)CompressionStream instead of a bundled zlib. The package is in memory, so
// recover() scans it in one pass rather than in blocks of 32000 bytes, and Zip64 extra fields are
// not read (a browser does not open packages of 4 GB).

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/**
 * The checksums of stored streams, by their buffer: streams a package carries unchanged from one
 * save to the next (graphics, versions) are not summed again. Buffers are never mutated here.
 */
const storedCrc = new WeakMap<Uint8Array, number>();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function pipe(data: Uint8Array, transform: { readable: ReadableStream; writable: WritableStream }): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(transform as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export class ZipError extends Error {}

/**
 * ZipPackage's BrokenPackage error (ERRCODE_IO_BROKENPACKAGE): the package's directory cannot be
 * read. Reading it again with bRepairPackage (the RepairPackage argument) recovers its entries.
 */
export class BrokenPackageError extends ZipError {}

/**
 * ZipFile: the streams of a package by name. Without bForceRecovery the central directory is read
 * (readCEN), and a package whose directory is broken throws BrokenPackageError; with it the
 * entries are found from their local headers (recover).
 */
export async function readZip(bytes: Uint8Array, bForceRecovery = false): Promise<Map<string, Uint8Array>> {
  if (bForceRecovery) return recover(bytes);
  try {
    return await readCEN(bytes);
  } catch (e) {
    // "stream data looks to be broken"
    if (e instanceof ZipError) throw new BrokenPackageError(e.message);
    throw e;
  }
}

async function readCEN(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record sits at the end, followed by an optional comment.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipError('Not a zip archive');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || v.getUint32(p, true) !== 0x02014b50) throw new ZipError('Corrupt central directory');
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const dataStart = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = bytes.subarray(dataStart, dataStart + csize);
    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, await pipe(raw, new DecompressionStream('deflate-raw')));
    else throw new ZipError(`Unsupported compression method ${method} for ${name}`);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const STORED = 0, DEFLATED = 8;

/** A local header found by recover(): ZipEntry's fields that recovery uses. */
interface RecoveredEntry { sPath: string; nFlag: number; nMethod: number; nCrc: number; nCompressedSize: number; nSize: number; nOffset: number }

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  return pipe(data, new DecompressionStream('deflate-raw'));
}

/**
 * ZipFile::recover: a package whose central directory is missing or broken (cut off, or followed
 * by other data) is read from its local headers. An entry whose size and checksum do not match
 * its data is kept empty; an entry written with a data descriptor (flag 8) gets its sizes from it.
 */
async function recover(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nLength = bytes.length;
  const aEntries = new Map<string, RecoveredEntry>();
  const m_EntriesInsensitive = new Set<string>();
  const ENDHDR = 22;
  if (nLength < ENDHDR) throw new BrokenPackageError('Zip END signature not found!');

  /** ZipFile::getSizeAndCRC */
  const getSizeAndCRC = async (nOffset: number, nCompressedSize: number): Promise<{ nSize: number; nCRC: number }> => {
    try {
      const data = await inflate(bytes.subarray(nOffset, nOffset + nCompressedSize));
      return { nSize: data.length, nCRC: crc32(data) };
    } catch {
      return { nSize: -1, nCRC: 0 };
    }
  };
  /** ZipFile::checkSizeAndCRC */
  const checkSizeAndCRC = async (aEntry: RecoveredEntry): Promise<boolean> => {
    if (aEntry.nMethod === STORED) return crc32(bytes.subarray(aEntry.nOffset, aEntry.nOffset + aEntry.nSize)) === aEntry.nCrc;
    if (aEntry.nCompressedSize < 0) return false;
    const { nSize, nCRC } = await getSizeAndCRC(aEntry.nOffset, aEntry.nCompressedSize);
    return aEntry.nSize === nSize && aEntry.nCrc === nCRC;
  };

  /** ZipFile::HandlePK34: a local file header. True when its sizes are to come from a data descriptor. */
  const HandlePK34 = async (dataOffset: number, totalSize: number): Promise<boolean> => {
    const nFlag = v.getUint16(dataOffset + 6, true);
    if ((nFlag & 1) === 1) return false;
    const nMethod = v.getUint16(dataOffset + 8, true);
    if (nMethod !== STORED && nMethod !== DEFLATED) return false;
    const nCrc = v.getUint32(dataOffset + 14, true);
    const nCompressedSize = v.getUint32(dataOffset + 18, true);
    const nSize = v.getUint32(dataOffset + 22, true);
    const nPathLen = v.getUint16(dataOffset + 26, true);
    const nExtraLen = v.getUint16(dataOffset + 28, true);

    const nDescrLength = nMethod === DEFLATED && nFlag & 8 ? 16 : 0;
    const nBlockHeaderLength = nPathLen + nExtraLen + 30 + nDescrLength;
    if (dataOffset + nBlockHeaderLength > totalSize) return false;

    // read always in UTF8, some tools seem not to set UTF8 bit
    const sPath = new TextDecoder().decode(bytes.subarray(dataOffset + 30, dataOffset + 30 + nPathLen)).replaceAll('\\', '/');

    const nDataSize = nMethod === DEFLATED ? nCompressedSize : nSize;
    const nBlockLength = nDataSize + nBlockHeaderLength;
    if (dataOffset + nBlockLength > totalSize) return false;

    const aEntry: RecoveredEntry = { sPath, nFlag, nMethod, nCrc, nCompressedSize, nSize, nOffset: dataOffset + 30 + nPathLen + nExtraLen };

    if ((aEntry.nSize || aEntry.nCompressedSize) && !(await checkSizeAndCRC(aEntry))) {
      aEntry.nCrc = 0;
      aEntry.nCompressedSize = 0;
      aEntry.nSize = 0;
    }

    // Do not add this entry, if it is empty and is a directory of an already existing entry
    if (aEntry.nSize === 0 && aEntry.nCompressedSize === 0 && [...aEntries.keys()].some((k) => k.startsWith(`${aEntry.sPath}/`))) return false;

    const lowerPath = aEntry.sPath.toLowerCase();
    // this is required for OOXML, but not for ODF
    if (m_EntriesInsensitive.has(lowerPath)) return false;
    m_EntriesInsensitive.add(lowerPath);
    aEntries.set(aEntry.sPath, aEntry);

    // Drop any "directory" entry corresponding to this one's path; since we don't use
    // central directory, we don't see external file attributes, so sanitize here
    const tokens = aEntry.sPath.split('/');
    for (let i = 1; i < tokens.length; i++) {
      const subdir = tokens.slice(0, i).join('/');
      const it = aEntries.get(subdir);
      // if not empty, let it fail later in ZipPackage::getZipFileContents
      if (it && it.nSize === 0 && it.nCompressedSize === 0) aEntries.delete(subdir);
    }
    return (aEntry.nFlag & 8) !== 0 && aEntry.nCompressedSize === 0;
  };

  /** ZipFile::TryDDImpl: a data descriptor ending the stream of an entry written with flag 8. */
  const TryDDImpl = async (dataOffset: number, nCRC32: number, nCompressedSize: number, nSize: number): Promise<boolean> => {
    for (const rEntry of aEntries.values()) {
      // this is a broken package, accept this block not only for DEFLATED streams
      if ((rEntry.nFlag & 8) === 0) continue;
      const nStreamOffset = dataOffset - nCompressedSize;
      if (nStreamOffset === rEntry.nOffset && nCompressedSize > rEntry.nCompressedSize) {
        // only DEFLATED blocks need to be checked
        let bAcceptBlock = rEntry.nMethod === STORED && nCompressedSize === nSize;
        if (!bAcceptBlock) {
          const real = await getSizeAndCRC(nStreamOffset, nCompressedSize);
          bAcceptBlock = real.nSize === nSize && real.nCRC === nCRC32;
        }
        if (bAcceptBlock) {
          rEntry.nCrc = nCRC32;
          rEntry.nCompressedSize = nCompressedSize;
          rEntry.nSize = nSize;
          return true;
        }
      }
    }
    return false;
  };

  /** ZipFile::HandlePK78: a data descriptor with its signature. */
  const HandlePK78 = async (dataOffset: number): Promise<void> => {
    const at = (k: number) => bytes[dataOffset + k] ?? 0;
    const sig = (k: number) => at(k) === 0x50 && at(k + 1) === 0x4b && at(k + 3) === at(k + 2) + 1 && (at(k + 2) === 3 || at(k + 2) === 1);
    const nCRC32 = v.getUint32(dataOffset + 4, true);
    let nCompressedSize: number, nSize: number;
    // FIXME64: find a better way to recognize if Zip64 mode is used
    if (sig(16) || !sig(24) || dataOffset + 24 > nLength) {
      nCompressedSize = v.getUint32(dataOffset + 8, true);
      nSize = v.getUint32(dataOffset + 12, true);
    } else {
      nCompressedSize = Number(v.getBigUint64(dataOffset + 8, true));
      nSize = Number(v.getBigUint64(dataOffset + 16, true));
    }
    await TryDDImpl(dataOffset, nCRC32, nCompressedSize, nSize);
  };

  /** ZipFile::TryDDEndAt: a data descriptor without its signature, ending at dataOffset + 20. */
  const TryDDEndAt = async (dataOffset: number): Promise<boolean> => {
    if (await TryDDImpl(dataOffset + 8, v.getUint32(dataOffset + 8, true), v.getUint32(dataOffset + 12, true), v.getUint32(dataOffset + 16, true))) return true;
    // then try if Zip64 crc/sizes are plausible
    return TryDDImpl(dataOffset, v.getUint32(dataOffset, true), Number(v.getBigUint64(dataOffset + 4, true)), Number(v.getBigUint64(dataOffset + 12, true)));
  };

  let findDD = false;
  for (let nPos = 0; nPos < nLength - 16;) {
    if (bytes[nPos] === 0x50 && bytes[nPos + 1] === 0x4b) {
      if (bytes[nPos + 2] === 7 && bytes[nPos + 3] === 8) {
        findDD = false;
        if (nPos + 16 <= nLength) await HandlePK78(nPos);
        nPos += 4;
      } else {
        if (findDD && 30 < nPos && (await TryDDEndAt(nPos - 20))) findDD = false;
        if (nPos < nLength - 30 && bytes[nPos + 2] === 3 && bytes[nPos + 3] === 4) {
          findDD = await HandlePK34(nPos, nLength);
          nPos += 4;
        } else {
          ++nPos;
        }
      }
    } else nPos++;
  }

  // ZipFile::getInputStream of each entry.
  const out = new Map<string, Uint8Array>();
  for (const e of aEntries.values()) {
    const raw = bytes.subarray(e.nOffset, e.nOffset + (e.nMethod === STORED ? e.nSize : e.nCompressedSize));
    out.set(e.sPath, e.nMethod === STORED || !e.nCompressedSize ? raw : await inflate(raw));
  }
  // Nothing found: the package stays broken (NotifyBrokenPackage).
  if (!out.size) throw new BrokenPackageError('No entries found');
  return out;
}

export interface ZipEntry { name: string; data: Uint8Array; store?: boolean }

export async function writeZip(entries: ZipEntry[]): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const body = e.store ? e.data : await pipe(e.data, new CompressionStream('deflate-raw'));
    let crc = e.store ? storedCrc.get(e.data) : undefined;
    if (crc === undefined) { crc = crc32(e.data); if (e.store) storedCrc.set(e.data, crc); }
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, e.store ? 0 : 8, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, e.data.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, body);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, e.store ? 0 : 8, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, body.length, true);
    cd.setUint32(24, e.data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Uint8Array(await new Blob([...chunks, ...central, new Uint8Array(end.buffer)] as BlobPart[]).arrayBuffer());
}
