// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/util/model/DictionarySerializer.java partial
// Left out: serialize.
import { Dictionary } from '../../dictionary/Dictionary.ts';
import type { ArtifactSerializer } from './ArtifactSerializer.ts';

export class DictionarySerializer implements ArtifactSerializer<Dictionary> {
  create(input: Uint8Array): Dictionary {
    return new Dictionary(input);
  }

  static register(factories: Map<string, ArtifactSerializer<unknown>>): void {
    factories.set('dictionary', new DictionarySerializer());
  }
}
