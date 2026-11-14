// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/util/model/GenericModelSerializer.java partial
// Left out: serialize.
import type { AbstractModel } from '../../ml/model/AbstractModel.ts';
import { BinaryFileDataReader } from '../../ml/model/BinaryFileDataReader.ts';
import { GenericModelReader } from '../../ml/model/GenericModelReader.ts';
import type { ArtifactSerializer } from './ArtifactSerializer.ts';

export class GenericModelSerializer implements ArtifactSerializer<AbstractModel> {
  create(input: Uint8Array): AbstractModel {
    return new GenericModelReader(new BinaryFileDataReader(input)).getModel();
  }

  static register(factories: Map<string, ArtifactSerializer<unknown>>): void {
    factories.set('model', new GenericModelSerializer());
  }
}
