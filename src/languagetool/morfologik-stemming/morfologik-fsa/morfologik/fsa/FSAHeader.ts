// SPDX-License-Identifier: MPL-2.0
// @upstream morfologik-fsa/src/main/java/morfologik/fsa/FSAHeader.java partial
// read() only: write() belongs to the builders, which are not ported. The stream is a
// DataInputStream over the dictionary's bytes; InputStream.read() is "a byte or -1 at the end".
import type { DataInputStream } from '../../../../jdk/java/io/DataInputStream.ts';

/** java.io.IOException. */
export class IOException extends Error {}

/** InputStream.read(): the next byte (0..255), or -1 at the end of the stream. */
export function readByteOrEOF(input: DataInputStream): number {
  return input.available() > 0 ? input.readUnsignedByte() : -1;
}

/**
 * Standard FSA file header, as described in <code>fsa</code> package
 * documentation.
 */
export class FSAHeader {
  /**
   * FSA magic (4 bytes).
   */
  static readonly FSA_MAGIC =
      ('\\'.charCodeAt(0) << 24) |
      ('f'.charCodeAt(0)  << 16) |
      ('s'.charCodeAt(0)  << 8)  |
      ('a'.charCodeAt(0));

  /**
   * Maximum length of the header block.
   */
  static readonly MAX_HEADER_LENGTH = 4 + 8;

  /** FSA version number. */
  readonly version: number;

  constructor(version: number) {
    this.version = version;
  }

  /**
   * Read FSA header and version from a stream, consuming read bytes.
   *
   * @param in The input stream to read data from.
   * @return Returns a valid {@link FSAHeader} with version information.
   * @throws IOException If the stream ends prematurely or if it contains invalid data.
   */
  static read(input: DataInputStream): FSAHeader {
    if (readByteOrEOF(input) != ((FSAHeader.FSA_MAGIC >>> 24)       ) ||
        readByteOrEOF(input) != ((FSAHeader.FSA_MAGIC >>> 16) & 0xff) ||
        readByteOrEOF(input) != ((FSAHeader.FSA_MAGIC >>>  8) & 0xff) ||
        readByteOrEOF(input) != ((FSAHeader.FSA_MAGIC       ) & 0xff)) {
      throw new IOException("Invalid file header, probably not an FSA.");
    }

    const version = readByteOrEOF(input);
    if (version == -1) {
      throw new IOException("Truncated file, no version number.");
    }

    return new FSAHeader((version << 24) >> 24);
  }
}
