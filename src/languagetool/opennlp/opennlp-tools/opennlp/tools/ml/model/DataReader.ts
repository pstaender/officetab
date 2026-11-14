// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/ml/model/DataReader.java faithful

export interface DataReader {
  readDouble(): number;

  readInt(): number;

  readUTF(): string;
}
