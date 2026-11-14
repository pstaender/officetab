// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/postag/POSModel.java partial
// Only the InputStream constructor (here: the model package's entries) and the accessors; left
// out: the constructors from trained parts and getArtifactSerializerClass. MaxentModel and
// SequenceClassificationModel are interfaces: instanceof tests AbstractModel and a
// bestSequences method.
import type { Properties } from '../../../../../jdk/java/util/Properties.ts';
import { BeamSearch } from '../ml/BeamSearch.ts';
import { AbstractModel } from '../ml/model/AbstractModel.ts';
import type { MaxentModel } from '../ml/model/MaxentModel.ts';
import type { SequenceClassificationModel } from '../ml/model/SequenceClassificationModel.ts';
import type { Dictionary } from '../dictionary/Dictionary.ts';
import type { BaseToolFactory } from '../util/BaseToolFactory.ts';
import { InvalidFormatException } from '../util/InvalidFormatException.ts';
import { BaseModel, type ModelPackage } from '../util/model/BaseModel.ts';
import type { ArtifactSerializer } from '../util/model/ArtifactSerializer.ts';
import { ByteArraySerializer } from '../util/model/ByteArraySerializer.ts';
import { POSTaggerFactory } from './POSTaggerFactory.ts';
import { POSTaggerME } from './POSTaggerME.ts';

/**
 * The POSModel is the model used
 * by a learnable POSTagger.
 *
 * @see POSTaggerME
 */
export class POSModel extends BaseModel {
  private static readonly COMPONENT_NAME = 'POSTaggerME';
  static readonly POS_MODEL_ENTRY_NAME = 'pos.model';
  static readonly GENERATOR_DESCRIPTOR_ENTRY_NAME = 'generator.featuregen';

  /**
   * @param input the model package to load the model from (readZip of the .bin file)
   */
  constructor(input: ModelPackage) {
    super(POSModel.COMPONENT_NAME, input);
  }

  protected override getDefaultFactory(): new () => BaseToolFactory {
    return POSTaggerFactory;
  }

  protected override validateArtifactMap(): void {
    super.validateArtifactMap();

    if (!(this.artifactMap.get(POSModel.POS_MODEL_ENTRY_NAME) instanceof AbstractModel)) {
      throw new InvalidFormatException('POS model is incomplete!');
    }
  }

  /**
   * @deprecated use getPosSequenceModel instead. This method will be removed soon.
   * Only required for Parser 1.5.x backward compatibility. Newer models don't need this anymore.
   */
  getPosModel(): MaxentModel | null {
    if (this.artifactMap.get(POSModel.POS_MODEL_ENTRY_NAME) instanceof AbstractModel) {
      return this.artifactMap.get(POSModel.POS_MODEL_ENTRY_NAME) as MaxentModel;
    }
    else {
      return null;
    }
  }

  getPosSequenceModel(): SequenceClassificationModel<string> | null {
    const manifest = this.artifactMap.get(BaseModel.MANIFEST_ENTRY) as Properties;

    const artifact = this.artifactMap.get(POSModel.POS_MODEL_ENTRY_NAME);
    if (artifact instanceof AbstractModel) {
      const beamSizeString = manifest.getProperty(BeamSearch.BEAM_SIZE_PARAMETER);

      let beamSize = POSTaggerME.DEFAULT_BEAM_SIZE;
      if (beamSizeString != null) {
        beamSize = parseInt(beamSizeString, 10);
      }

      return new BeamSearch<string>(beamSize, artifact);
    }
    else if (artifact != null && typeof (artifact as SequenceClassificationModel<string>).bestSequences === 'function') {
      return artifact as SequenceClassificationModel<string>;
    }
    else {
      return null;
    }
  }

  getFactory(): POSTaggerFactory {
    return this.toolFactory as POSTaggerFactory;
  }

  protected override createArtifactSerializers(serializers: Map<string, ArtifactSerializer<unknown>>): void {
    super.createArtifactSerializers(serializers);

    serializers.set('featuregen', new ByteArraySerializer());
  }

  getNgramDictionary(): Dictionary | null {
    if (this.getFactory() != null)
      return this.getFactory().getDictionary();
    return null;
  }
}
