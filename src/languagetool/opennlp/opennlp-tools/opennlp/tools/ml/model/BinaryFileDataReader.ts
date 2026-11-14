// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/ml/model/BinaryFileDataReader.java partial
// Left out: the File constructor. An InputStream is a byte array.
import { DataInputStream } from '../../../../../../jdk/java/io/DataInputStream.ts';
import type { DataReader } from './DataReader.ts';

export class BinaryFileDataReader implements DataReader {
  private input: DataInputStream;

  constructor(input: Uint8Array | DataInputStream) {
    this.input = input instanceof DataInputStream ? input : new DataInputStream(input);
  }

  readDouble(): number {
    return this.input.readDouble();
  }

  readInt(): number {
    return this.input.readInt();
  }

  readUTF(): string {
    return this.input.readUTF();
  }
}
