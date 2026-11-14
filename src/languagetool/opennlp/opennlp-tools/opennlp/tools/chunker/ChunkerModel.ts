// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/chunker/ChunkerModel.java partial
// Only the InputStream constructor (here: the model package's entries) and the accessors; left
// out: the constructors from trained parts. MaxentModel and SequenceClassificationModel are
// interfaces: instanceof tests AbstractModel and a bestSequences method.
import type { Properties } from '../../../../../jdk/java/util/Properties.ts';
import { BeamSearch } from '../ml/BeamSearch.ts';
import { AbstractModel } from '../ml/model/AbstractModel.ts';
import type { MaxentModel } from '../ml/model/MaxentModel.ts';
import type { SequenceClassificationModel } from '../ml/model/SequenceClassificationModel.ts';
import type { BaseToolFactory } from '../util/BaseToolFactory.ts';
import { InvalidFormatException } from '../util/InvalidFormatException.ts';
import { BaseModel, type ModelPackage } from '../util/model/BaseModel.ts';
import type { TokenTag } from '../util/TokenTag.ts';
import { ChunkerFactory } from './ChunkerFactory.ts';
import { ChunkerME } from './ChunkerME.ts';

/**
 * The ChunkerModel is the model used
 * by a learnable Chunker.
 *
 * @see ChunkerME
 */
export class ChunkerModel extends BaseModel {
  private static readonly COMPONENT_NAME = 'ChunkerME';
  private static readonly CHUNKER_MODEL_ENTRY_NAME = 'chunker.model';

  /**
   * @param input the model package to load the model from (readZip of the .bin file)
   */
  constructor(input: ModelPackage) {
    super(ChunkerModel.COMPONENT_NAME, input);
  }

  protected override validateArtifactMap(): void {
    super.validateArtifactMap();

    if (!(this.artifactMap.get(ChunkerModel.CHUNKER_MODEL_ENTRY_NAME) instanceof AbstractModel)) {
      throw new InvalidFormatException('Chunker model is incomplete!');
    }

    // Since 1.8.0 we changed the ChunkerFactory signature. This will check the if the model
    // declares a not default factory, and if yes, check if it was created before 1.8
    if ( (this.getManifestProperty(BaseModel.FACTORY_NAME) != null
            && this.getManifestProperty(BaseModel.FACTORY_NAME) !== 'opennlp.tools.chunker.ChunkerFactory' )
        && this.getVersion().getMajor() <= 1
        && this.getVersion().getMinor() < 8) {
      throw new InvalidFormatException("The Chunker factory '" + this.getManifestProperty(BaseModel.FACTORY_NAME) +
      "' is no longer compatible. Please update it to match the latest ChunkerFactory.");
    }
  }

  /**
   * @deprecated use getChunkerSequenceModel instead. This method will be removed soon.
   */
  getChunkerModel(): MaxentModel | null {
    if (this.artifactMap.get(ChunkerModel.CHUNKER_MODEL_ENTRY_NAME) instanceof AbstractModel) {
      return this.artifactMap.get(ChunkerModel.CHUNKER_MODEL_ENTRY_NAME) as MaxentModel;
    }
    else {
      return null;
    }
  }

  getChunkerSequenceModel(): SequenceClassificationModel<TokenTag> | null {
    const manifest = this.artifactMap.get(BaseModel.MANIFEST_ENTRY) as Properties;

    const artifact = this.artifactMap.get(ChunkerModel.CHUNKER_MODEL_ENTRY_NAME);
    if (artifact instanceof AbstractModel) {
      const beamSizeString = manifest.getProperty(BeamSearch.BEAM_SIZE_PARAMETER);

      let beamSize = ChunkerME.DEFAULT_BEAM_SIZE;
      if (beamSizeString != null) {
        beamSize = parseInt(beamSizeString, 10);
      }

      return new BeamSearch<TokenTag>(beamSize, artifact);
    }
    else if (artifact != null && typeof (artifact as SequenceClassificationModel<TokenTag>).bestSequences === 'function') {
      return artifact as SequenceClassificationModel<TokenTag>;
    }
    else {
      return null;
    }
  }

  protected override getDefaultFactory(): new () => BaseToolFactory {
    return ChunkerFactory;
  }

  getFactory(): ChunkerFactory {
    return this.toolFactory as ChunkerFactory;
  }
}
