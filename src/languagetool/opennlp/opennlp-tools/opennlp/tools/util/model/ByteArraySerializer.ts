// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/util/model/ByteArraySerializer.java partial
// Left out: serialize.
import type { ArtifactSerializer } from './ArtifactSerializer.ts';

export class ByteArraySerializer implements ArtifactSerializer<Uint8Array> {
  create(input: Uint8Array): Uint8Array {
    return input.slice();
  }
}
