// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/util/model/PropertiesSerializer.java partial
// Left out: serialize.
import { Properties } from '../../../../../../jdk/java/util/Properties.ts';
import type { ArtifactSerializer } from './ArtifactSerializer.ts';

export class PropertiesSerializer implements ArtifactSerializer<Properties> {
  create(input: Uint8Array): Properties {
    const properties = new Properties();
    properties.load(input);
    return properties;
  }

  static register(factories: Map<string, ArtifactSerializer<unknown>>): void {
    factories.set('properties', new PropertiesSerializer());
  }
}
